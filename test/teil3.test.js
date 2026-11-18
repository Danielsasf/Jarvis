const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { WakeWord, SCRIPT } = require('../src/wake');

function fakeSpawn() {
  const procs = [];
  const fn = (cmd, args) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter(); p.stdout.setEncoding = () => {};
    p.stderr = new EventEmitter();
    p.cmd = cmd; p.args = args; p.killed = false;
    p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit', 0)); };
    p.say = (line) => p.stdout.emit('data', `${line}\r\n`);
    procs.push(p);
    return p;
  };
  fn.procs = procs;
  return fn;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wake-'));

test('Weckwort: startet PowerShell mit Schwelle, meldet bereit und Treffer', async () => {
  const sp = fakeSpawn(); const statuses = []; const hits = [];
  const w = new WakeWord({ dir: tmp(), platform: 'win32', spawnImpl: sp, onStatus: (s) => statuses.push(s.state), onHit: (h) => hits.push(h) });
  w.set(true, 'high');
  const p = sp.procs[0];
  assert.equal(p.cmd, 'powershell.exe');
  assert.deepEqual(p.args.slice(-2), ['-Min', '0.7']);
  p.say('READY:de-DE');
  p.stdout.emit('data', 'WAKE:0.93:Hey ');
  p.stdout.emit('data', 'Jarvis\n');
  assert.deepEqual(statuses, ['starting', 'ready']);
  assert.deepEqual(hits, [{ confidence: 0.93, text: 'Hey Jarvis' }]);
  w.stop();
  assert.equal(statuses.at(-1), 'off');
  assert.ok(p.killed);
});

test('Weckwort: Fehler „keine Spracherkennung“ wird angezeigt, kein Neustart', async () => {
  const sp = fakeSpawn(); let last;
  const w = new WakeWord({ dir: tmp(), platform: 'win32', spawnImpl: sp, onStatus: (s) => { last = s; } });
  w.set(true);
  sp.procs[0].say('ERROR:Keine Windows-Spracherkennung installiert.');
  sp.procs[0].emit('exit', 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(last.state, 'error');
  assert.match(last.detail, /Spracherkennung/);
  assert.equal(sp.procs.length, 1);
});

test('Weckwort: Absturz -> automatischer Neustart', async () => {
  const sp = fakeSpawn();
  const w = new WakeWord({ dir: tmp(), platform: 'win32', spawnImpl: sp });
  w.set(true);
  sp.procs[0].emit('exit', 1);
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(sp.procs.length, 2);
  w.stop();
});

test('Weckwort: Empfindlichkeit ändern startet mit neuer Schwelle', async () => {
  const sp = fakeSpawn();
  const w = new WakeWord({ dir: tmp(), platform: 'win32', spawnImpl: sp });
  w.set(true, 'mid');
  w.set(true, 'low');
  assert.equal(sp.procs.length, 2);
  assert.equal(sp.procs[1].args.at(-1), '0.88');
  w.stop();
});

test('Weckwort: außerhalb von Windows ehrlich „nicht verfügbar“', () => {
  let last;
  const w = new WakeWord({ dir: tmp(), platform: 'linux', spawnImpl: () => { throw new Error('darf nicht starten'); }, onStatus: (s) => { last = s; } });
  w.set(true);
  assert.equal(last.state, 'unsupported');
});

test('PowerShell-Skript: Weckwort-Grammatik, Diktat-Fang, Schwelle', () => {
  assert.match(SCRIPT, /'Hey Jarvis'/);
  assert.match(SCRIPT, /DictationGrammar/);
  assert.match(SCRIPT, /\$r\.Grammar\.Name -eq 'wake' -and \$r\.Confidence -ge \$Min/);
  assert.match(SCRIPT, /HEARD:/);
  assert.match(SCRIPT, /SetInputToDefaultAudioDevice/);
});
