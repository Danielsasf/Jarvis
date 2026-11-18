const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const packs = require('../src/packs');

const SAMPLE = { name: 'Fitness', befehl: '/fitness', beschreibung: 'Trainingspläne', beispiele: ['Plan für 3 Tage'], instructions: 'Geheime Anweisung: antworte wie ein Coach.' };

test('Siegel: verschlüsselt und wieder lesbar', () => {
  const sealed = packs.seal(packs.serializePack(SAMPLE));
  assert.ok(sealed.startsWith('JARVISPAKET1:'));
  assert.ok(!sealed.includes('Geheime Anweisung'), 'kein Klartext im Siegel');
  const back = packs.parsePack(packs.unseal(sealed));
  assert.strictEqual(back.befehl, '/fitness');
  assert.strictEqual(back.instructions, SAMPLE.instructions);
});

test('Siegel: Veränderung und Fremddateien werden abgelehnt', () => {
  const sealed = packs.seal(packs.serializePack(SAMPLE));
  const tampered = sealed.slice(0, -6) + (sealed.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
  assert.throws(() => packs.unseal(tampered), /beschädigt/);
  assert.throws(() => packs.unseal('hallo'), /kein Jarvis-Paket/);
});

test('Laden: .jpaket wird als geschützt markiert, kaputte Datei als Fehler', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jp-'));
  fs.writeFileSync(path.join(dir, 'fitness.jpaket'), packs.seal(packs.serializePack(SAMPLE)));
  fs.writeFileSync(path.join(dir, 'kaputt.jpaket'), 'JARVISPAKET1:xxxx');
  const all = packs.loadAll(path.join(dir, 'nix'), dir);
  const ok = all.find((p) => p.id === 'fitness');
  assert.ok(ok && ok.locked === true && !ok.error);
  assert.ok(all.find((p) => p.error));
});

// ---- Weckwort: Wiederholung bei vergänglichen Fehlern ----
const { WakeWord } = require('../src/wake');
const { EventEmitter } = require('events');
function fakeProc() {
  const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stdout.setEncoding = () => {}; p.stderr = new EventEmitter();
  p.kill = () => { p.killed = true; }; p.say = (l) => p.stdout.emit('data', l + '\n'); return p;
}
test('Weckwort: Mikrofon-Fehler wird mit Pause erneut versucht, nicht aufgegeben', async () => {
  const procs = []; const statuses = [];
  const w = new WakeWord({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')), platform: 'win32', spawnImpl: () => { const p = fakeProc(); procs.push(p); return p; }, onStatus: (s) => statuses.push(s) });
  w.set(true);
  procs[0].say('ERROR:Kein Mikrofon gefunden');
  procs[0].emit('exit', 1);
  const last = statuses.at(-1);
  assert.strictEqual(last.state, 'retry');
  assert.match(last.detail, /Neuer Versuch in 5 Sekunden/);
  w.stop();
});
test('Weckwort: Doppeltreffer innerhalb 1,5 s zählt einmal', () => {
  const procs = []; const hits = [];
  const w = new WakeWord({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')), platform: 'win32', spawnImpl: () => { const p = fakeProc(); procs.push(p); return p; }, onHit: (h) => hits.push(h) });
  w.set(true);
  procs[0].say('READY:de-DE'); procs[0].say('WAKE:0.9:Hey Jarvis'); procs[0].say('WAKE:0.9:Hey Jarvis');
  assert.strictEqual(hits.length, 1);
  w.stop();
});
test('Weckwort: restart() startet einen neuen Prozess', () => {
  const procs = [];
  const w = new WakeWord({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')), platform: 'win32', spawnImpl: () => { const p = fakeProc(); procs.push(p); return p; } });
  w.set(true); w.restart();
  assert.strictEqual(procs.length, 2); assert.ok(procs[0].killed);
  w.stop();
});
