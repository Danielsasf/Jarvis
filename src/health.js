// Jarvis Gesundheit der KIs: merkt sich, welche KI gerade nicht kann (Limit leer, Schlüssel falsch, überlastet)
// und legt sie für eine Weile zur Seite. Reine Logik ohne Electron, damit sie testbar bleibt.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const REASON = {
  limit: 'Limit aufgebraucht',
  billing: 'Guthaben aufgebraucht',
  auth: 'Schlüssel ungültig',
  overloaded: 'überlastet',
  transient: 'kurz nicht erreichbar',
};

// Fehler -> { kind, pauseMs } oder null (z. B. Modell veraltet / abgebrochen: keine Pause)
function classify(err, { local = false } = {}) {
  if (!err || err.lost || err.streamed) return null;
  const s = err.status;
  if (err.modelGone) return null;
  if (s === 402) return { kind: 'billing', pauseMs: 6 * HOUR };
  if (s === 401 || s === 403) return { kind: 'auth', pauseMs: 6 * HOUR };
  if (err.limit || s === 429) {
    const ra = err.retryAfterMs;
    const pauseMs = ra != null ? Math.min(24 * HOUR, Math.max(MIN, ra)) : (err.limit ? HOUR : 2 * MIN);
    return { kind: 'limit', pauseMs };
  }
  if (s === 529 || s === 503) return { kind: 'overloaded', pauseMs: 2 * MIN };
  if (err.network || err.timeout || (s != null && s >= 500)) return { kind: 'transient', pauseMs: local ? 15 * 1000 : 45 * 1000 };
  return null;
}

function reasonText(kind) { return REASON[kind] || 'nicht verfügbar'; }

const isPaused = (acc, now = Date.now()) => !!acc && Number.isFinite(acc.pausedUntil) && acc.pausedUntil > now;

function pause(acc, c, now = Date.now()) {
  if (!acc || !c) return false;
  acc.pausedUntil = now + c.pauseMs;
  acc.pauseKind = c.kind;
  return true;
}

function clear(acc) {
  if (!acc) return false;
  const had = acc.pausedUntil != null;
  delete acc.pausedUntil;
  delete acc.pauseKind;
  return had;
}

// Reihenfolge: erst alle freien KIs (in der Liste des Nutzers), dann pausierte – die am frühesten freie zuerst.
// So wird immer irgendetwas versucht, auch wenn alles pausiert ist.
function arrange(ids, accounts, now = Date.now()) {
  const free = ids.filter((id) => !isPaused(accounts[id], now));
  const paused = ids.filter((id) => isPaused(accounts[id], now)).sort((a, b) => accounts[a].pausedUntil - accounts[b].pausedUntil);
  return { chain: free.concat(paused), free, paused };
}

function untilText(ts, now = Date.now()) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return ts - now > 20 * HOUR ? `morgen ${hh}` : hh;
}

module.exports = { classify, reasonText, isPaused, pause, clear, arrange, untilText, REASON };
