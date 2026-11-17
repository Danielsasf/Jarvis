const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProviderError, runWithFallback } = require('../src/router');
const accounts = require('../src/accounts');
const speed = require('../src/speed');
const { ChatStore } = require('../src/chats');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const noSleep = { sleep: async () => {}, random: () => 0.5, maxRetries: 0 };

// Ein "KI"-Schritt, der nach delay ms das erste Wort liefert (mit claim wie in main.js)
const step = (id, delay, text = id) => ({
  id, label: id,
  run: (signal, beat, ctx) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { if (ctx.claim()) resolve(text); else reject(new Error('verworfen')); }, delay);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('x'), { name: 'AbortError' })); });
  }),
});

test('Rennen: zwei KIs gleichzeitig, die schnellere gewinnt, die langsame wird abgebrochen', async () => {
  const t0 = Date.now();
  const r = await runWithFallback([step('langsam', 400), step('schnell', 30), step('dritte', 10)], { ...noSleep, parallel: 2 });
  assert.equal(r.text, 'schnell');
  assert.ok(Date.now() - t0 < 300);
  assert.deepEqual(r.losers.map((l) => l.id), ['langsam']);
});

test('Hedging: antwortet die erste nicht rechtzeitig, startet die zweite zusätzlich', async () => {
  const launched = [];
  const r = await runWithFallback([step('a', 500), step('b', 20)], { ...noSleep, parallel: 1, hedgeMs: 60, onLaunch: (s, why) => launched.push(`${s.id}:${why}`) });
  assert.equal(r.text, 'b');
  assert.deepEqual(launched, ['a:start', 'b:slow']);
});

test('Hedging: ist die erste schnell genug, startet keine zweite', async () => {
  const launched = [];
  const r = await runWithFallback([step('a', 20), step('b', 20)], { ...noSleep, parallel: 1, hedgeMs: 200, onLaunch: (s) => launched.push(s.id) });
  assert.equal(r.text, 'a');
  assert.deepEqual(launched, ['a']);
});

test('Rennen: fällt eine KI aus, antwortet die andere; Ausfall wird gemeldet', async () => {
  const bad = { id: 'kaputt', label: 'kaputt', run: async () => { throw new ProviderError('HTTP 401', { status: 401 }); } };
  const r = await runWithFallback([bad, step('gut', 40)], { ...noSleep, parallel: 2 });
  assert.equal(r.text, 'gut');
  assert.equal(r.failures[0].id, 'kaputt');
});

test('Rennen: alle fallen aus -> Fehlermeldung mit Liste', async () => {
  const bad = (id) => ({ id, label: id, run: async () => { throw new ProviderError('HTTP 401', { status: 401 }); } });
  await assert.rejects(runWithFallback([bad('a'), bad('b'), bad('c')], { ...noSleep, parallel: 2 }), /Keine KI konnte antworten:\n• a.*\n• b.*\n• c/);
});

test('Rennen: verlierer sendet keinen Text mehr (claim verweigert)', async () => {
  const claims = [];
  const mk = (id, delay) => ({ id, label: id, run: (signal, beat, ctx) => new Promise((res) => setTimeout(() => { claims.push(`${id}:${ctx.claim()}`); res(id); }, delay)) });
  const r = await runWithFallback([mk('a', 20), mk('b', 50)], { ...noSleep, parallel: 2 });
  await sleep(80);
  assert.equal(r.text, 'a');
  assert.ok(!claims.includes('b:true'));
});

test('Tempo: sortiert nach Geschwindigkeit, ähnliche behalten deine Reihenfolge', () => {
  const ms = { claude: 2600, gemini: 700, groq: 300, neu: undefined };
  assert.deepEqual(speed.sortBySpeed(['claude', 'gemini', 'groq'], (id) => ms[id]), ['gemini', 'groq', 'claude']);
  assert.deepEqual(speed.sortBySpeed(['a', 'b'], () => 1000), ['a', 'b']);
  assert.deepEqual(speed.sortBySpeed(['claude', 'neu'], (id) => ms[id]), ['claude', 'neu']);
  assert.equal(speed.record(undefined, 800), 800);
  assert.equal(speed.record(1000, 2000), 1400);
  assert.ok(speed.record(1000, 100, false) > 4000);
});

test('Zugänge: alte Konfiguration wird übernommen, mehrere Schlüssel pro Anbieter', () => {
  const c = accounts.migrate({
    providers: { gemini: { connected: true, enabled: true, key: 'enc:x', models: ['m'], model: 'm' }, groq: { connected: false } },
    order: ['groq', 'gemini', 'openai'],
  });
  assert.deepEqual(Object.keys(c.accounts), ['gemini']);
  assert.deepEqual(c.order, ['gemini']);
  assert.equal(c.providers, undefined);
  assert.equal(accounts.newId(c.accounts, 'gemini'), 'gemini-2');
  c.accounts['gemini-2'] = { type: 'gemini' };
  assert.equal(accounts.newId(c.accounts, 'gemini'), 'gemini-3');
  assert.equal(accounts.displayName('gemini-2', c.accounts['gemini-2']), 'Gemini (Google) #2');
  assert.equal(accounts.displayName('gemini', { type: 'gemini', label: 'Privat' }), 'Privat');
  assert.throws(() => accounts.cleanBase('kaputt'));
  assert.equal(accounts.cleanBase('https://x.de/v1/'), 'https://x.de/v1');
  assert.equal(accounts.providerFor('c', { type: 'custom', base: 'https://x.de/v1' }).base, 'https://x.de/v1');
});

test('Chats: speichern, laden, löschen, leere werden nicht gespeichert', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chats-')), 'chats.json');
  const s = new ChatStore(file);
  s.upsert({ id: 'c1', title: 'Hallo', created: 1, updated: 5, messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hallo!', by: 'X' }, { role: 'system', content: 'weg' }] });
  s.upsert({ id: 'c2', title: 'Leer', messages: [] });
  s.upsert({ id: 'c3', title: 'Neuer', updated: 9, messages: [{ role: 'user', content: 'x' }] });
  const again = new ChatStore(file).all();
  assert.deepEqual(again.map((c) => c.id), ['c3', 'c1']);
  assert.equal(again[1].messages.length, 2);
  assert.throws(() => s.upsert({ id: '../böse', messages: [] }));
  s.remove('c3');
  assert.deepEqual(new ChatStore(file).all().map((c) => c.id), ['c1']);
});
