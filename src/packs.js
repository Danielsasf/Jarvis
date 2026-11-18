// Pakete: kleine Textdateien (*.paket.md), die Jarvis neue Fähigkeiten geben – ohne App-Update.
//
// ---
// name: Bewerbung
// befehl: /bewerbung
// beschreibung: Anschreiben, Lebenslauf, Gesprächstraining
// beispiele:
//   - Schreib mir ein Anschreiben
// ---
// Anweisungen für Jarvis …
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function slug(s) {
  return String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function parsePack(text, source = '') {
  const m = String(text).replace(/^﻿/, '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('Paket braucht oben einen Kopf zwischen zwei Zeilen „---“.');
  const meta = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) { meta[listKey].push(unquote(item[1])); continue; }
    const kv = line.match(/^([\wäöüÄÖÜß]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    if (kv[2].trim() === '') { meta[key] = []; listKey = key; } else { meta[key] = unquote(kv[2]); listKey = null; }
  }
  const name = String(meta.name || '').trim();
  if (!name) throw new Error('Paket braucht einen Namen (name: …).');
  const instructions = m[2].trim();
  if (!instructions) throw new Error('Paket braucht Anweisungen unter dem Kopf.');
  let befehl = String(meta.befehl || meta.command || `/${slug(name)}`).trim().toLowerCase();
  if (!befehl.startsWith('/')) befehl = `/${befehl}`;
  if (!/^\/[a-z0-9äöüß-]{2,30}$/.test(befehl)) throw new Error(`Ungültiger Befehl: ${befehl}`);
  return {
    id: slug(befehl.slice(1)),
    name: name.slice(0, 60),
    befehl,
    beschreibung: String(meta.beschreibung || meta.description || '').slice(0, 200),
    symbol: String(meta.symbol || '').slice(0, 4),
    beispiele: (Array.isArray(meta.beispiele) ? meta.beispiele : []).slice(0, 6).map((s) => String(s).slice(0, 140)),
    instructions: instructions.slice(0, 12000),
    source,
  };
}
function unquote(s) { return String(s).trim().replace(/^(["'])(.*)\1$/, '$2'); }

function serializePack({ name, befehl, beschreibung = '', symbol = '', beispiele = [], instructions }) {
  const esc = (s) => (/[:#]/.test(s) ? `"${String(s).replace(/"/g, "'")}"` : s);
  return ['---', `name: ${esc(name)}`, `befehl: ${befehl}`, `beschreibung: ${esc(beschreibung)}`, symbol ? `symbol: ${symbol}` : null,
    'beispiele:', ...beispiele.filter(Boolean).map((b) => `  - ${esc(b)}`), '---', '', instructions.trim(), ''].filter((l) => l !== null).join('\n');
}


// ---- Versiegelte Pakete (.jpaket): verschlüsselt (AES-256-GCM), nur von Jarvis lesbar ----
// Hinweis: Der Schlüssel steckt im Programm. Das hält Neugierige ab (kein Klartext, keine Anzeige in der App),
// ist aber kein Schutz gegen jemanden, der den Programmcode gezielt auseinandernimmt.
const SEAL_MAGIC = 'JARVISPAKET1:';
const sealKey = () => crypto.scryptSync('jarvis-paket-siegel-v1', 'jarvis-paket-salz', 32);
function seal(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return SEAL_MAGIC + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function unseal(data) {
  const t = String(data).trim();
  if (!t.startsWith(SEAL_MAGIC)) throw new Error('Das ist kein Jarvis-Paket (.jpaket).');
  try {
    const raw = Buffer.from(t.slice(SEAL_MAGIC.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { throw new Error('Das Paket ist beschädigt oder wurde verändert.'); }
}

function loadDir(dir, builtin) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names.filter((x) => x.endsWith('.paket.md') || x.endsWith('.jpaket')).sort()) {
    const file = path.join(dir, n);
    const locked = n.endsWith('.jpaket');
    try {
      const raw = fs.readFileSync(file, 'utf8');
      out.push({ ...parsePack(locked ? unseal(raw) : raw, file), builtin, locked });
    }
    catch (err) { out.push({ id: `fehler-${slug(n)}`, name: n, error: err.message, builtin, source: file }); }
  }
  return out;
}

/** Eingebaute + eigene Pakete; eigene überschreiben eingebaute mit gleichem Befehl. */
function loadAll(builtinDir, userDir) {
  const map = new Map();
  for (const p of [...loadDir(builtinDir, true), ...loadDir(userDir, false)]) map.set(p.id, p);
  return [...map.values()];
}

/** "/bewerbung Schreib mir …" -> { pack, rest } */
function matchCommand(text, packs) {
  const m = String(text).match(/^\s*(\/[a-z0-9äöüß-]+)\b\s*([\s\S]*)$/i);
  if (!m) return null;
  const pack = packs.find((p) => !p.error && p.befehl === m[1].toLowerCase());
  return pack ? { pack, rest: m[2].trim() } : null;
}

module.exports = { parsePack, serializePack, loadAll, matchCommand, slug, seal, unseal };
