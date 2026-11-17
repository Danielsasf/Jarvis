// Jarvis Router: verteilt Anfragen an die verbundenen KIs.
// Wiederholt nur bei vorübergehenden Fehlern, wechselt danach zur nächsten KI.
// Bei Live-Antworten wird nur gewechselt, solange noch kein Wort angezeigt wurde.

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

class ProviderError extends Error {
  constructor(message, { status = null, retryAfterMs = null, network = false, timeout = false, streamed = false, modelGone = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.network = network;
    this.timeout = timeout;
    this.streamed = streamed; // es wurde schon Text angezeigt
    this.modelGone = modelGone; // Modell abgeschaltet / nicht gefunden
  }
}

function isRetryable(err) {
  if (!(err instanceof ProviderError) || err.streamed) return false;
  if (err.timeout || err.network) return true;
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
      const wait = err.retryAfterMs != null ? Math.min(err.retryAfterMs, 60000) : backoffDelay(attempt, { random });
      onRetry?.({ attempt: attempt + 1, waitMs: wait, error: err });
      await sleep(wait);
      attempt++;
    }
  }
}

/**
 * chain: [{ id, label, run: (signal, beat) => Promise<string>, repair?: (err) => Promise<boolean> }]
 * repair: darf z. B. ein abgeschaltetes Modell ersetzen; true = gleiche KI nochmal versuchen
 */
async function runWithFallback(chain, opts = {}) {
  const { log = () => {}, onSwitch = () => {} } = opts;
  const failures = [];
  if (!chain.length) throw new ProviderError('Keine KI verbunden. Öffne die Einstellungen und verbinde mindestens einen Anbieter.');
  for (const step of chain) {
    if (failures.length) onSwitch(step, failures[failures.length - 1]);
    let repaired = false;
    for (;;) {
      try {
        const text = await callWithRetry(step.run, {
          ...opts,
          onRetry: ({ attempt, waitMs, error }) => log(`[${step.label}] Versuch ${attempt} in ${waitMs} ms – ${error.message}`),
        });
        log(failures.length ? `[${step.label}] hat übernommen` : `[${step.label}] hat geantwortet`);
        return { text, used: step, failures };
      } catch (err) {
        if (err.streamed) {
          log(`[${step.label}] mitten in der Antwort abgebrochen: ${err.message}`);
          throw err; // schon Text angezeigt -> nicht doppelt antworten
        }
        if (!repaired && err.modelGone && step.repair) {
          repaired = true;
          try {
            if (await step.repair(err)) { log(`[${step.label.split(' · ')[0]}] Modell veraltet – auf neues Modell umgestellt`); continue; }
          } catch { /* Reparatur fehlgeschlagen */ }
        }
        log(`[${step.label}] fehlgeschlagen: ${err.message}`);
        failures.push({ id: step.id, label: step.label, error: err.message });
        break;
      }
    }
  }
  const summary = failures.map((f) => `• ${f.label}: ${f.error}`).join('\n');
  throw new ProviderError(`Keine KI konnte antworten:\n${summary}`);
}

module.exports = { ProviderError, isRetryable, parseRetryAfter, backoffDelay, callWithRetry, runWithFallback, RETRYABLE_STATUS };
