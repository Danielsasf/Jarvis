const test = require('node:test');
const assert = require('node:assert/strict');
const lp = require('../src/localparse');
const comp = require('../src/computer');

test('extractJson findet das JSON auch mit Text drumherum', () => {
  assert.deepEqual(lp.extractJson('Klar: {"typ":"programm_oeffnen","name":"Rechner"} – fertig'), { typ: 'programm_oeffnen', name: 'Rechner' });
  assert.equal(lp.extractJson('kein json'), null);
  assert.equal(lp.extractJson('{kaputt'), null);
});

test('parse: erlaubte Aktion wird zurückgegeben, nicht erlaubte nicht', async () => {
  const cfg = comp.normalize({ enabled: true, caps: { programm_oeffnen: true }, apps: { rechner: true } });
  const fake = (reply) => async (_p, _k, _m, _msgs, _sys, { onDelta }) => { onDelta(reply); return reply; };
  const ok = await lp.parse(cfg, 'Öffne den Taschenrechner', { provider: {}, key: '', model: 'm', signal: undefined, chatStream: fake('{"typ":"programm_oeffnen","name":"Rechner"}') });
  assert.equal(ok.action.name, 'Rechner');
  assert.equal(ok.text, 'Programm „Rechner“ öffnen');
  assert.equal(await lp.parse(cfg, 'Öffne Paint', { provider: {}, key: '', model: 'm', chatStream: fake('{"typ":"programm_oeffnen","name":"Paint"}') }), null);
  assert.equal(await lp.parse(cfg, 'lösch alles', { provider: {}, key: '', model: 'm', chatStream: fake('{"typ":"datei_loeschen"}') }), null);
  assert.equal(await lp.parse(cfg, 'hallo', { provider: {}, key: '', model: 'm', chatStream: fake('{"typ":"keine"}') }), null);
});

test('systemPrompt nennt nur Erlaubtes und verbietet Einstellungsänderungen', () => {
  const cfg = comp.normalize({ enabled: true, caps: { medien_steuern: true } });
  const s = lp.systemPrompt(cfg);
  assert.match(s, /medien_steuern/); assert.doesNotMatch(s, /programm_oeffnen/);
  assert.match(s, /keine Einstellungen ändern/);
});
