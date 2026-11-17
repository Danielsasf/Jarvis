const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RemoteServer, findTailscaleIp } = require('../src/remote');
const { ChatStore } = require('../src/chats');

async function setup() {
  const store = new ChatStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rem-')), 'chats.json'));
  let list = [];
  const seen = [];
  const answer = async (messages, { onDelta, abortSignal }) => {
    seen.push(messages.map((m) => m.content));
    if (messages.at(-1).content === 'BOOM') throw new Error('Keine KI konnte antworten');
    if (messages.at(-1).content === 'WARTE') await new Promise((r, j) => abortSignal.addEventListener('abort', () => j(new Error('abgebrochen'))));
    for (const w of ['Hallo ', 'Handy']) onDelta(w);
    return { text: 'Hallo Handy', by: 'Test-KI' };
  };
  const chats = [];
  const srv = new RemoteServer({ store, answer, devices: { get: () => list, save: (l) => { list = l; } }, onChat: (c) => chats.push(c.id) });
  await srv.start({ host: '127.0.0.1', port: 0 });
  const base = `http://127.0.0.1:${srv.port}`;
  const call = (p, o = {}) => fetch(base + p, { ...o, headers: { 'content-type': 'application/json', ...(o.headers || {}) } });
  const pairWith = async () => {
    const { code } = srv.newCode();
    const r = await call('/api/pair', { method: 'POST', body: JSON.stringify({ code, name: 'Testhandy' }) });
    return (await r.json()).token;
  };
  return { srv, store, call, pairWith, seen, chats, devices: () => list };
}
const authed = (token) => ({ headers: { authorization: `Bearer ${token}` } });

test('Handy: Seite ist ohne Anmeldung erreichbar, API nicht', async () => {
  const { srv, call } = await setup();
  const page = await call('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Kopplungscode/);
  assert.equal((await call('/api/chats')).status, 401);
  assert.equal((await call('/api/chats', { headers: { authorization: 'Bearer ' + 'a'.repeat(48) } })).status, 401);
  srv.stop();
});

test('Handy: Kopplung mit Code, Code nur einmal gültig, Token wird nur als Hash gespeichert', async () => {
  const { srv, call, devices } = await setup();
  const { code } = srv.newCode();
  const bad = await call('/api/pair', { method: 'POST', body: JSON.stringify({ code: code === '000000' ? '111111' : '000000' }) });
  assert.equal(bad.status, 403);
  const ok = await call('/api/pair', { method: 'POST', body: JSON.stringify({ code, name: 'Pixel' }) });
  const { token } = await ok.json();
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.equal(devices()[0].name, 'Pixel');
  assert.ok(!JSON.stringify(devices()).includes(token));
  const again = await call('/api/pair', { method: 'POST', body: JSON.stringify({ code }) });
  assert.equal(again.status, 403);
  assert.equal((await call('/api/chats', authed(token))).status, 200);
  srv.stop();
});

test('Handy: nach 5 falschen Codes ist der Code ungültig', async () => {
  const { srv, call } = await setup();
  const { code } = srv.newCode();
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await call('/api/pair', { method: 'POST', body: JSON.stringify({ code: wrong }) });
  const r = await call('/api/pair', { method: 'POST', body: JSON.stringify({ code }) });
  assert.equal(r.status, 403);
  srv.stop();
});

test('Handy: abgelaufener Code wird abgelehnt', async () => {
  const { srv, call } = await setup();
  const { code } = srv.newCode();
  srv.pairing.expires = Date.now() - 1;
  assert.equal((await call('/api/pair', { method: 'POST', body: JSON.stringify({ code }) })).status, 403);
  srv.stop();
});

test('Handy: Nachricht senden streamt die Antwort und speichert den Chat', async () => {
  const { srv, call, pairWith, store, chats, seen } = await setup();
  const token = await pairWith();
  const r = await call('/api/send', { method: 'POST', ...authed(token), body: JSON.stringify({ text: 'Wie geht es?' }) });
  const events = (await r.text()).trim().split('\n\n').map((l) => JSON.parse(l.replace(/^data: /, '')));
  assert.deepEqual(events.map((e) => e.t), ['start', 'delta', 'delta', 'done']);
  const id = events[0].chatId;
  assert.equal(store.all()[0].messages.length, 2);
  assert.deepEqual(chats, [id]);
  // zweite Nachricht im selben Chat bekommt den Verlauf
  await (await call('/api/send', { method: 'POST', ...authed(token), body: JSON.stringify({ chatId: id, text: 'Und weiter?' }) })).text();
  assert.deepEqual(seen[1], ['Wie geht es?', 'Hallo Handy', 'Und weiter?']);
  const list = await (await call('/api/chats', authed(token))).json();
  assert.equal(list[0].count, 4);
  assert.equal((await call(`/api/chat?id=${id}`, authed(token))).status, 200);
  srv.stop();
});

test('Handy: Fehler der KI kommt als Meldung an, nichts wird gespeichert', async () => {
  const { srv, call, pairWith, store } = await setup();
  const token = await pairWith();
  const r = await call('/api/send', { method: 'POST', ...authed(token), body: JSON.stringify({ text: 'BOOM' }) });
  assert.match(await r.text(), /"t":"error".*Keine KI/);
  assert.equal(store.all().length, 0);
  srv.stop();
});

test('Handy: zu große Anfrage und leere Nachricht werden abgelehnt', async () => {
  const { srv, call, pairWith } = await setup();
  const token = await pairWith();
  assert.equal((await call('/api/send', { method: 'POST', ...authed(token), body: JSON.stringify({ text: 'x'.repeat(70000) }) })).status, 413);
  assert.equal((await call('/api/send', { method: 'POST', ...authed(token), body: JSON.stringify({ text: '   ' }) })).status, 400);
  srv.stop();
});

test('Handy: gesperrtes Gerät kommt nicht mehr rein', async () => {
  const { srv, call, pairWith, devices } = await setup();
  const token = await pairWith();
  assert.equal((await call('/api/chats', authed(token))).status, 200);
  devices().length = 0;
  assert.equal((await call('/api/chats', authed(token))).status, 401);
  srv.stop();
});

test('Tailscale-Adresse wird erkannt, normale Netzwerke nicht', () => {
  assert.equal(findTailscaleIp({ ts: [{ family: 'IPv4', address: '100.101.102.103', internal: false }] }), '100.101.102.103');
  assert.equal(findTailscaleIp({ lan: [{ family: 'IPv4', address: '192.168.1.5', internal: false }], lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] }), null);
  assert.equal(findTailscaleIp({ x: [{ family: 'IPv4', address: '100.200.1.1', internal: false }] }), null);
});
