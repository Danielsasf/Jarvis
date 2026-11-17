const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const packs = require('../src/packs');
const { Memory, stripTags } = require('../src/memory');

// ---------- Pakete ----------
test('Paket wird gelesen (Kopf, Liste, Anweisungen)', () => {
  const p = packs.parsePack('---\nname: Fitness\nbefehl: fit\nbeschreibung: "Training: Pläne"\nbeispiele:\n  - Plan für Montag\n  - Dehnen\n---\nDu bist Trainer.\n');
  assert.equal(p.befehl, '/fit');
  assert.equal(p.id, 'fit');
  assert.equal(p.beschreibung, 'Training: Pläne');
  assert.deepEqual(p.beispiele, ['Plan für Montag', 'Dehnen']);
  assert.equal(p.instructions, 'Du bist Trainer.');
});

test('Kaputte Pakete geben verständliche Fehler', () => {
  assert.throws(() => packs.parsePack('kein kopf'), /Kopf/);
  assert.throws(() => packs.parsePack('---\nbefehl: /x\n---\nText'), /Namen/);
  assert.throws(() => packs.parsePack('---\nname: X\n---\n'), /Anweisungen/);
});

test('Speichern und wieder Lesen ergibt dasselbe', () => {
  const data = { name: 'Reisen', befehl: '/reisen', beschreibung: 'Packliste: alles dabei', beispiele: ['Wochenende Berlin'], instructions: 'Plane Reisen.' };
  const p = packs.parsePack(packs.serializePack(data));
  assert.equal(p.name, 'Reisen');
  assert.equal(p.beschreibung, 'Packliste: alles dabei');
  assert.deepEqual(p.beispiele, ['Wochenende Berlin']);
});

test('Alle eingebauten Pakete sind gültig, eigene überschreiben eingebaute', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pakete-'));
  fs.writeFileSync(path.join(dir, 'lernen.paket.md'), '---\nname: Mein Lernen\nbefehl: /lernen\n---\nEigene Regeln.');
  const all = packs.loadAll(path.join(__dirname, '../src/packs'), dir);
  assert.equal(all.length, 6);
  assert.ok(all.every((p) => !p.error), all.filter((p) => p.error).map((p) => p.error).join());
  assert.equal(all.find((p) => p.befehl === '/lernen').name, 'Mein Lernen');
  assert.deepEqual(all.map((p) => p.befehl).sort(), ['/alltag', '/arbeit', '/bewerbung', '/creator', '/finanzen', '/lernen']);
});

test('Befehl im Text wird erkannt', () => {
  const all = packs.loadAll(path.join(__dirname, '../src/packs'), '/gibtsnicht');
  const hit = packs.matchCommand('/bewerbung Schreib ein Anschreiben', all);
  assert.equal(hit.pack.name, 'Bewerbung');
  assert.equal(hit.rest, 'Schreib ein Anschreiben');
  assert.equal(packs.matchCommand('/unbekannt hallo', all), null);
  assert.equal(packs.matchCommand('Hallo /lernen', all), null);
});

// ---------- Gedächtnis ----------
test('Gedächtnis: merken, doppelt ignorieren, vergessen, speichern', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')), 'g.json');
  const m = new Memory(file);
  const r = m.apply('Klar, mach ich! <merken>Heißt Daniel</merken><merken>Mag kurze Antworten</merken>');
  assert.equal(r.saved.length, 2);
  m.apply('<merken>heißt daniel</merken>');
  assert.equal(m.list().length, 2);
  const again = new Memory(file);
  assert.equal(again.list().length, 2);
  const id = again.list()[1].id;
  again.apply(`Okay. <vergessen>${id}</vergessen>`);
  assert.deepEqual(again.list().map((i) => i.text), ['Heißt Daniel']);
  assert.match(again.promptBlock(), /\[m1\] Heißt Daniel/);
});

test('Markierungen werden aus der Antwort entfernt', () => {
  assert.equal(stripTags('Gemerkt! <merken>X</merken>').trim(), 'Gemerkt!');
  assert.equal(stripTags('Text <merken>halb'), 'Text ');
});

// ---------- Anzeige ----------
function loadRender() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/render.js'), 'utf8'), sandbox);
  return sandbox.window.JarvisRender;
}

test('Tabelle wird zur Tafel', () => {
  const { render } = loadRender();
  const html = render('Hier:\n\n| Posten | Betrag |\n|---|---:|\n| Miete | 600 € |\n| Essen | 250 € |');
  assert.match(html, /<div class="tafel"><table>/);
  assert.match(html, /<td class="a-right">600 €<\/td>/);
});

test('Widgets: Kennzahlen, Checkliste, Balken, Zeitplan', () => {
  const { render } = loadRender();
  const w = (o) => render('```widget\n' + JSON.stringify(o) + '\n```');
  assert.match(w({ typ: 'kennzahlen', werte: [{ label: 'Übrig', wert: '150 €' }] }), /w-stat.*Übrig.*150 €/s);
  assert.match(w({ typ: 'checkliste', punkte: ['Milch', 'Brot'] }), /type="checkbox".*Milch.*Brot/s);
  assert.match(w({ typ: 'balken', einheit: '€', daten: [{ label: 'Miete', wert: 600 }, { label: 'Essen', wert: 300 }] }), /data-w="100".*data-w="50"/s);
  assert.match(w({ typ: 'zeitplan', eintraege: [{ zeit: '09:00', text: 'Sport' }] }), /<time>09:00<\/time>/);
});

test('Widgets sind sicher gegen eingeschleustes HTML', () => {
  const { render } = loadRender();
  const html = render('```widget\n{"typ":"checkliste","punkte":["<img src=x onerror=alert(1)>"]}\n```');
  assert.ok(!html.includes('<img'));
});

test('Während des Schreibens: halbes Widget und halbe Markierung', () => {
  const { render } = loadRender();
  assert.match(render('Moment\n```widget\n{"typ":"kenn', true), /Widget wird erstellt/);
  assert.ok(!render('Mach ich. <merk', true).includes('merk'));
  assert.ok(!render('Mach ich. <merken>Daniel mag', true).includes('Daniel'));
});

test('Vorlesen überspringt Gedächtnis-Markierungen und Tabellen', () => {
  const spoken = [];
  class Utt { constructor(t) { this.text = t; } }
  const sandbox = { window: {}, speechSynthesis: { speak: (u) => spoken.push(u.text), cancel() {}, getVoices: () => [], speaking: false, pending: false }, SpeechSynthesisUtterance: Utt };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/speech.js'), 'utf8'), sandbox);
  const s = new sandbox.window.JarvisSpeech.Speaker();
  for (const piece of ['Alles klar, ich merk mir das. ', '<merken>Daniel ', 'mag Pizza.</merken>', ' Sonst noch was?']) s.feed(piece);
  s.finish();
  const all = spoken.join(' ');
  assert.ok(!/Pizza|merken/.test(all), all);
  assert.match(all, /Sonst noch was\?/);
});
