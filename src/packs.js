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

function loadDir(dir, builtin) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names.filter((x) => x.endsWith('.paket.md')).sort()) {
    const file = path.join(dir, n);
    try { out.push({ ...parsePack(fs.readFileSync(file, 'utf8'), file), builtin }); }
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

module.exports = { parsePack, serializePack, loadAll, matchCommand, slug };
