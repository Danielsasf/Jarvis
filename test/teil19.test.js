const test = require('node:test');
const assert = require('node:assert/strict');
const comp = require('../src/computer');

const allOn = () => comp.setAll(comp.normalize({}), true);
function deps(calls = []) {
  return {
    shell: { openPath: async (p) => { calls.push(['openPath', p]); return ''; }, openExternal: async (u) => { calls.push(['openExternal', u]); } },
    spawn: (exe, args) => { calls.push(['spawn', exe, args]); return { on() {}, unref() {} }; },
    getPath: (k) => `/home/x/${k}`,
    fsp: require('fs/promises'),
  };
}

test('Standard: alles aus, nichts wird erlaubt oder ausgeführt', async () => {
  const c = comp.normalize({});
  assert.equal(c.enabled, false);
  assert.deepEqual(comp.allowedSummary(c), []);
  assert.equal(comp.promptBlock(c), '');
  const calls = [];
  const r = await comp.run(c, { typ: 'programm_oeffnen', name: 'Rechner' }, deps(calls));
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

test('Hauptschalter aus sperrt alles, auch wenn Einzelschalter an sind', async () => {
  const c = allOn(); c.enabled = false;
  const calls = [];
  assert.equal((await comp.run(c, { typ: 'webseite_oeffnen', url: 'https://a.de' }, deps(calls))).ok, false);
  assert.equal(calls.length, 0);
});

test('Programm öffnen nur aus der Liste und nur wenn einzeln erlaubt', async () => {
  const c = comp.normalize({ enabled: true, caps: { programm_oeffnen: true }, apps: { rechner: true } });
  const calls = [];
  assert.equal((await comp.run(c, { typ: 'programm_oeffnen', name: 'Taschenrechner' }, deps(calls))).ok, true);
  assert.deepEqual(calls[0], ['spawn', 'calc.exe', []]);
  assert.equal((await comp.run(c, { typ: 'programm_oeffnen', name: 'Paint' }, deps(calls))).ok, false); // nicht erlaubt
  assert.equal((await comp.run(c, { typ: 'programm_oeffnen', name: 'cmd.exe /c del *' }, deps(calls))).ok, false); // frei geht nicht
  assert.equal(calls.length, 1);
});

test('Eigene Programme nur, wenn in der Liste und an', async () => {
  const c = comp.normalize({ enabled: true, caps: { programm_oeffnen: true }, customApps: [{ id: 'c1', name: 'Spotify', path: 'C:/S/spotify.exe', on: true }, { id: 'c2', name: 'Aus', path: 'C:/A.exe', on: false }] });
  const calls = [];
  assert.equal((await comp.run(c, { typ: 'programm_oeffnen', name: 'spotify' }, deps(calls))).ok, true);
  assert.equal(calls[0][1], 'C:/S/spotify.exe');
  assert.equal((await comp.run(c, { typ: 'programm_oeffnen', name: 'Aus' }, deps(calls))).ok, false);
});

test('Webseiten: nur https', async () => {
  const c = allOn();
  const calls = [];
  assert.equal((await comp.run(c, { typ: 'webseite_oeffnen', url: 'https://example.com/x' }, deps(calls))).ok, true);
  for (const bad of ['http://example.com', 'file:///C:/Windows', 'javascript:alert(1)', 'ms-settings:', 'nope']) {
    assert.equal((await comp.run(c, { typ: 'webseite_oeffnen', url: bad }, deps(calls))).ok, false, bad);
  }
  assert.equal(calls.length, 1);
});

test('Ordner: nur bekannte und erlaubte', async () => {
  const c = comp.normalize({ enabled: true, caps: { ordner_zeigen: true }, folders: { downloads: true } });
  const calls = [];
  assert.equal((await comp.run(c, { typ: 'ordner_zeigen', ort: 'Downloads' }, deps(calls))).ok, true);
  assert.deepEqual(calls[0], ['openPath', '/home/x/downloads']);
  assert.equal((await comp.run(c, { typ: 'ordner_zeigen', ort: 'desktop' }, deps(calls))).ok, false);
  assert.equal((await comp.run(c, { typ: 'ordner_zeigen', ort: 'C:\\Windows' }, deps(calls))).ok, false);
});

test('Medien: feste Tastencodes, keine freie Eingabe', async () => {
  const c = allOn();
  const calls = [];
  assert.equal((await comp.run(c, { typ: 'medien_steuern', befehl: 'lauter' }, deps(calls))).ok, true);
  assert.match(calls[0][2][3], /SendKeys\(\[char\]175\)$/);
  assert.equal((await comp.run(c, { typ: 'medien_steuern', befehl: '1);calc;(' }, deps(calls))).ok, false);
});

test('Nicht eingebaute Aktionen (Löschen, Tippen, Klicken) werden abgelehnt', async () => {
  const c = allOn();
  const calls = [];
  for (const typ of ['datei_loeschen', 'delete', 'tippen', 'klicken', 'befehl', 'shell']) {
    assert.equal((await comp.run(c, { typ, pfad: 'C:/x' }, deps(calls))).ok, false, typ);
  }
  assert.equal(calls.length, 0);
});

test('extract: Markierungen raus, höchstens 3, kaputtes wird verworfen', () => {
  const t = 'Mach ich. <aktion>{"typ":"a"}</aktion><aktion>kein json</aktion><aktion>{"typ":"b"}</aktion><aktion>{"typ":"c"}</aktion><aktion>{"typ":"d"}</aktion> Fertig <aktion>{"typ"';
  const r = comp.extract(t);
  assert.equal(r.actions.length, 3);
  assert.equal(r.rejected, 2);
  assert.equal(/aktion/i.test(r.clean), false);
  assert.match(r.clean, /Mach ich\./);
});

test('Dateisuche findet Namen, überspringt versteckte Ordner', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-'));
  fs.mkdirSync(path.join(d, 'sub')); fs.mkdirSync(path.join(d, '.git'));
  fs.writeFileSync(path.join(d, 'Rechnung_2026.pdf'), ''); fs.writeFileSync(path.join(d, 'sub', 'rechnung-alt.txt'), ''); fs.writeFileSync(path.join(d, '.git', 'rechnung'), '');
  const hits = await comp.searchFiles(require('fs/promises'), [d], 'rechnung');
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => !h.includes('.git')));
});

test('Alles sperren schaltet auch den Hauptschalter aus; promptBlock nennt nur Erlaubtes', () => {
  const c = comp.normalize({ enabled: true, caps: { webseite_oeffnen: true } });
  const b = comp.promptBlock(c);
  assert.match(b, /webseite_oeffnen/); assert.doesNotMatch(b, /medien_steuern|ordner_zeigen/);
  comp.setAll(c, false);
  assert.equal(c.enabled, false); assert.equal(comp.promptBlock(c), '');
});

test('looksLikeCommand erkennt Befehle, keine normalen Fragen', () => {
  assert.equal(comp.looksLikeCommand('Öffne den Rechner und mach jetzt Musik an'), true);
  assert.equal(comp.looksLikeCommand('Mach die Musik leiser'), true);
  assert.equal(comp.looksLikeCommand('Wie ist das Wetter heute?'), false);
});
