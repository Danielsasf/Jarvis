// Jarvis Router: verteilt Anfragen an die verbundenen KIs.
// Wiederholt nur bei vorübergehenden Fehlern, wechselt danach zur nächsten KI.
// Bei Live-Antworten wird nur gewechselt, solange noch kein Wort angezeigt wurde.

const MAX_WAIT_MS = 10000; // länger wartet Jarvis nie auf dieselbe KI
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

class ProviderError extends Error {
  constructor(message, { status = null, retryAfterMs = null, network = false, timeout = false, streamed = false, modelGone = false, lost = false, limit = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.network = network;
    this.timeout = timeout;
    this.streamed = streamed; // es wurde schon Text angezeigt
    this.modelGone = modelGone; // Modell abgeschaltet / nicht gefunden
    this.lost = lost; // eine andere KI war schneller
    this.limit = limit; // Nutzungslimit / Guthaben aufgebraucht: Warten lohnt nicht
  }
}

function isRetryable(err) {
  if (!(err instanceof ProviderError) || err.streamed || err.lost) return false;
  if (err.limit) return false; // Limit leer: sofort die nächste KI
  if (err.timeout) return false; // lieber gleich wechseln als nochmal lange warten
  if (err.network) return true;
  if (err.status === 429 && err.retryAfterMs != null && err.retryAfterMs > MAX_WAIT_MS) return false;
  return err.status != null && RETRYABLE_STATUS.has(err.status);
}

function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return null;
}

function backoffDelay(attempt, { baseMs = 800, maxMs = 15000, random = Math.random } = {}) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + random() * (exp / 2));
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// timeoutMs = Zeit bis zum ersten Lebenszeichen; jedes beat() startet die Uhr neu (für Live-Antworten)
async function callOnce(fn, timeoutMs) {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const beat = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), timeoutMs); };
  try {
    return await fn(ctrl.signal, beat);
  } catch (err) {
    if (err instanceof ProviderError && !ctrl.signal.aborted) throw err;
    if (ctrl.signal.aborted || err?.name === 'AbortError') {
      throw new ProviderError(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s`, { timeout: true, streamed: !!err?.streamed });
    }
    throw new ProviderError(`Netzwerkfehler: ${err?.message || err}`, { network: true });
  } finally {
    clearTimeout(timer);
  }
}

async function callWithRetry(fn, { maxRetries = 2, timeoutMs = 60000, sleep = defaultSleep, random = Math.random, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await callOnce(fn, timeoutMs);
    } catch (err) {
      if (!isRetryable(err) || attempt >= maxRetries) throw err;
      const wait = err.retryAfterMs != null ? Math.min(err.retryAfterMs, MAX_WAIT_MS) : backoffDelay(attempt, { random });
      onRetry?.({ attempt: attempt + 1, waitMs: wait, error: err });
      await sleep(wait);
      attempt++;
    }
  }
}

/**
 * chain: [{ id, label, run: (signal, beat, ctx) => Promise<string>, repair?: (err) => Promise<boolean> }]
 * ctx.claim(): vor dem ersten angezeigten Text aufrufen – nur die KI, die zuerst "claimt", gewinnt;
 *   alle anderen laufenden KIs werden sofort abgebrochen. false = zu spät, Text verwerfen.
 * repair: darf z. B. ein abgeschaltetes Modell ersetzen; true = gleiche KI nochmal versuchen
 *
 * opts.parallel  Wie viele KIs gleichzeitig starten (1 = nacheinander)
 * opts.hedgeMs   Antwortet noch keine KI nach dieser Zeit, wird zusätzlich die nächste gestartet (0 = aus)
 * opts.maxActive Obergrenze gleichzeitig laufender Anfragen
 */
function runWithFallback(chain, opts = {}) {
  const { log = () => {}, onSwitch = () => {}, onLaunch = () => {}, parallel = 1, hedgeMs = 0, maxActive = 3 } = opts;
  if (!chain.length) return Promise.reject(new ProviderError('Keine KI verbunden. Öffne die Einstellungen und verbinde mindestens einen Anbieter.'));
  const failures = [];
  const active = new Set();
  let next = 0;
  let winner = null;
  let settled = false;
  let hedgeTimer = null;
  const losers = [];

  return new Promise((resolve, reject) => {
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(hedgeTimer); fn(value); };

    function claim(att) {
      if (winner && winner !== att) return false;
      if (!winner) {
        winner = att;
        clearTimeout(hedgeTimer);
        for (const other of active) if (other !== att) { other.lost = true; losers.push({ id: other.step.id, ms: Date.now() - other.startedAt }); other.ctrl.abort(); }
      }
      return true;
    }

    async function runAttempt(att) {
      const { step } = att;
      const wrapped = (signal, beat) => {
        if (att.lost) throw new ProviderError('Eine andere KI war schneller', { lost: true });
        return step.run(AbortSignal.any([signal, att.ctrl.signal]), beat, { claim: () => claim(att) });
      };
      let repaired = false;
      for (;;) {
        try {
          return await callWithRetry(wrapped, {
            ...opts,
            timeoutMs: step.timeoutMs || opts.timeoutMs,
            onRetry: ({ attempt, waitMs, error }) => log(`[${step.label}] Versuch ${attempt} in ${waitMs} ms – ${error.message}`),
          });
        } catch (err) {
          if (att.lost) throw new ProviderError('Eine andere KI war schneller', { lost: true });
          if (err.streamed) throw err; // schon Text angezeigt -> nicht doppelt antworten
          if (!repaired && err.modelGone && step.repair) {
            repaired = true;
            try {
              if (await step.repair(err)) { log(`[${step.label.split(' · ')[0]}] Modell veraltet – auf neues Modell umgestellt`); continue; }
            } catch { /* Reparatur fehlgeschlagen */ }
          }
          throw err;
        }
      }
    }

    function scheduleHedge() {
      clearTimeout(hedgeTimer);
      if (!(hedgeMs > 0) || winner || settled || next >= chain.length) return;
      hedgeTimer = setTimeout(() => {
        if (winner || settled || next >= chain.length) return;
        if (active.size < maxActive) launch('slow'); else scheduleHedge();
      }, hedgeMs);
    }

    function launch(reason) {
      const step = chain[next++];
      const att = { step, ctrl: new AbortController(), lost: false, startedAt: Date.now() };
      active.add(att);
      if (reason === 'failed' && failures.length) onSwitch(step, failures[failures.length - 1]);
      onLaunch(step, reason, failures[failures.length - 1]);
      runAttempt(att).then((text) => onDone(att, text), (err) => onFail(att, err));
      scheduleHedge();
    }

    function onDone(att, text) {
      if (settled || (winner && winner !== att)) return;
      claim(att);
      active.delete(att);
      log(failures.length ? `[${att.step.label}] hat übernommen` : `[${att.step.label}] hat geantwortet`);
      finish(resolve, { text, used: att.step, failures, losers, ms: Date.now() - att.startedAt });
    }

    function onFail(att, err) {
      active.delete(att);
      if (settled || err.lost || att.lost) return;
      if (err.streamed) {
        log(`[${att.step.label}] mitten in der Antwort abgebrochen: ${err.message}`);
        finish(reject, err);
        return;
      }
      log(`[${att.step.label}] fehlgeschlagen: ${err.message}`);
      failures.push({ id: att.step.id, label: att.step.label, error: err.message, ms: Date.now() - att.startedAt, err });
      if (winner) return;
      if (next < chain.length && (active.size === 0 || active.size < parallel)) { launch('failed'); return; }
      if (active.size === 0) {
        const summary = failures.map((f) => `• ${f.label}: ${f.error}`).join('\n');
        const e = new ProviderError(`Keine KI konnte antworten:\n${summary}`);
        e.failures = failures;
        finish(reject, e);
      }
    }

    const first = Math.max(1, Math.min(parallel, chain.length));
    for (let i = 0; i < first; i++) launch(i === 0 ? 'start' : 'parallel');
  });
}

module.exports = { ProviderError, isRetryable, parseRetryAfter, backoffDelay, callWithRetry, runWithFallback, RETRYABLE_STATUS };
