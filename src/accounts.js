// Zugänge: Jeder Zugang ist eine Verbindung zu einem Anbieter (mehrere pro Anbieter möglich, z. B. zwei Gemini-Schlüssel).
const { PROVIDERS } = require('./providers');

const typeOf = (id) => PROVIDERS.find((p) => p.id === id);

/** Alte Konfiguration (ein Eintrag pro Anbieter) -> Zugänge. */
function migrate(c) {
  c.accounts ||= {};
  if (c.providers) {
    for (const [id, s] of Object.entries(c.providers)) {
      if (s?.connected && typeOf(id) && !c.accounts[id]) c.accounts[id] = { type: id, label: '', ...s };
    }
    delete c.providers;
  }
  for (const [id, a] of Object.entries(c.accounts)) {
    if (!a || !typeOf(a.type)) { delete c.accounts[id]; continue; }
    a.connected = true;
    a.models ||= [];
    a.label = String(a.label || '').slice(0, 40);
  }
  c.order = (c.order || []).filter((id, i, arr) => c.accounts[id] && arr.indexOf(id) === i);
  for (const id of Object.keys(c.accounts)) if (!c.order.includes(id)) c.order.push(id);
  return c;
}

function newId(accounts, type) {
  if (!accounts[type]) return type;
  let n = 2;
  while (accounts[`${type}-${n}`]) n++;
  return `${type}-${n}`;
}

/** Anbieter-Beschreibung für einen Zugang (Adresse und Name können abweichen). */
function providerFor(id, acc) {
  const t = typeOf(acc.type);
  return { ...t, base: acc.base || t.base, name: displayName(id, acc, t) };
}

function displayName(id, acc, t = typeOf(acc.type)) {
  if (acc.label) return acc.label;
  const m = id.match(/-(\d+)$/);
  return m ? `${t.name} #${m[1]}` : t.name;
}

function cleanBase(url) {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s]+$/i.test(u)) throw new Error('Bitte eine gültige Adresse eingeben, z. B. https://api.beispiel.de/v1');
  return u;
}

module.exports = { migrate, newId, providerFor, displayName, cleanBase, typeOf };
