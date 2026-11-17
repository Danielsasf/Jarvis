const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const g = require('../src/gcal');
const cal = require('../src/calendar');

function fakeGoogle() {
  const log = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      log.push({ m: req.method, u: req.url, auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/token') {
        const p = new URLSearchParams(body);
        if (p.get('grant_type') === 'refresh_token') return p.get('refresh_token') === 'gut' ? res.end(JSON.stringify({ access_token: 'AT', expires_in: 3600 })) : (res.statusCode = 400, res.end(JSON.stringify({ error: 'invalid_grant' })));
        return res.end(JSON.stringify({ access_token: 'AT', refresh_token: 'RT-neu', expires_in: 3600 }));
      }
      if (req.method === 'GET' && req.url.startsWith('/calendars/primary/events?')) return res.end(JSON.stringify({ items: [
        { id: 'abc12345', summary: 'Mathe', start: { dateTime: '2026-11-18T09:00:00+01:00' }, end: { dateTime: '2026-11-18T10:00:00+01:00' } },
        { id: 'tag99999', summary: 'Ausflug', start: { date: '2026-11-19' }, end: { date: '2026-11-20' } },
        { id: 'weg00000', summary: 'Abgesagt', status: 'cancelled', start: { date: '2026-11-19' }, end: { date: '2026-11-20' } }] }));
      if (req.method === 'POST') return res.end(JSON.stringify({ id: 'neu12345', summary: JSON.parse(body).summary, start: JSON.parse(body).start, end: JSON.parse(body).end, htmlLink: 'https://x/e' }));
      if (req.method === 'PATCH') return req.url.includes('nix') ? (res.statusCode = 404, res.end('{}')) : res.end(JSON.stringify({ id: 'abc12345', summary: 'Mathe', start: { dateTime: '2026-11-19T10:00:00+01:00' }, end: { dateTime: '2026-11-19T11:00:00+01:00' } }));
      res.statusCode = 404; res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, log, base: `http://127.0.0.1:${srv.address().port}` })));
}

test('Termine lesen (mit ID, ohne Abgesagte), anlegen, verschieben', async () => {
  const { srv, log, base } = await fakeGoogle();
  try {
    const c = new g.GCal({ clientId: 'i', clientSecret: 's', refreshToken: 'gut', tokenUrl: base + '/token', apiBase: base, tz: 'Europe/Berlin' });
    const list = await c.listEvents(Date.UTC(2026, 10, 18), Date.UTC(2026, 10, 25));
    assert.deepEqual(list.map((e) => e.id), ['abc12345', 'tag99999']);
    assert.equal(list[1].allDay, true);
    assert.ok(cal.promptBlock(list, { label: 'x', canWrite: true }).includes('<termin>'));
    assert.match(cal.fmtEvent(list[0]), /ID: abc12345/);
    const n = await c.insert({ title: 'Zahnarzt', start: '2026-11-20T14:00', end: '2026-11-20T15:00', location: 'Hauptstr' });
    assert.equal(n.id, 'neu12345');
    const post = log.find((l) => l.m === 'POST' && l.u.startsWith('/calendars')); const pb = JSON.parse(post.body);
    assert.deepEqual(pb.start, { dateTime: '2026-11-20T14:00:00', timeZone: 'Europe/Berlin' });
    assert.equal(post.auth, 'Bearer AT');
    await c.move('abc12345', { start: '2026-11-19T10:00', end: '2026-11-19T11:00' });
    const patch = log.find((l) => l.m === 'PATCH'); assert.equal(JSON.parse(patch.body).summary, undefined);
    assert.equal(log.filter((l) => l.u === '/token').length, 1, 'Token wird wiederverwendet');
    await assert.rejects(c.move('nix12345', { start: '2026-11-19T10:00', end: '2026-11-19T11:00' }), /nicht gefunden/);
  } finally { srv.close(); }
});

test('abgelaufene Anmeldung → klare Meldung', async () => {
  const { srv, base } = await fakeGoogle();
  try {
    const c = new g.GCal({ clientId: 'i', clientSecret: 's', refreshToken: 'alt', tokenUrl: base + '/token', apiBase: base });
    await assert.rejects(c.listEvents(0, 1), /neu verbinden/);
  } finally { srv.close(); }
});

test('Anmeldung (OAuth/PKCE) über lokale Adresse', async () => {
  const { srv, log, base } = await fakeGoogle();
  try {
    let authUrl;
    const r = await g.authorize({ clientId: 'cid', clientSecret: 'sec', tokenUrl: base + '/token', authUrl: 'https://accounts.example/auth',
      openUrl: async (url) => { authUrl = new URL(url); const redirect = authUrl.searchParams.get('redirect_uri');
        const bad = await fetch(`${redirect}/?code=x&state=falsch`); assert.match(await bad.text(), /Ungültig/);
        await fetch(`${redirect}/?code=CODE&state=${authUrl.searchParams.get('state')}`); } });
    assert.equal(r.refreshToken, 'RT-neu');
    assert.equal(authUrl.searchParams.get('scope'), g.SCOPE);
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.match(authUrl.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+$/);
    const ex = new URLSearchParams(log.find((l) => l.u === '/token').body);
    assert.equal(ex.get('code'), 'CODE'); assert.ok(ex.get('code_verifier').length >= 43);
    await assert.rejects(g.authorize({ clientId: 'c', clientSecret: 's', openUrl: async () => {}, timeoutMs: 150 }), /Zeit abgelaufen/);
  } finally { srv.close(); }
});

test('Vorschläge: gültig, ungültig, Text bleibt sauber', () => {
  const t = 'Ich schlage vor:\n<termin>{"aktion":"neu","titel":"Zahnarzt","start":"2026-11-20T14:00"}</termin>\n<termin>{"aktion":"verschieben","id":"abc12345","start":"2026-11-19T10:00","ende":"2026-11-19T11:30"}</termin>\n<termin>{"aktion":"loeschen","id":"abc12345"}</termin>\n<termin>kaputt</termin>\n<termin>{"aktion":"neu","titel":"x","start":"morgen"}</termin>\n<termin>{"aktion":"neu","titel":"offen"';
  const r = g.extract(t);
  assert.equal(r.proposals.length, 2);
  assert.equal(r.proposals[0].end, '2026-11-20T15:00'); // Standard 1 Stunde
  assert.equal(r.proposals[1].id, 'abc12345');
  assert.equal(r.rejected, 3);
  assert.equal(r.clean, 'Ich schlage vor:');
  assert.equal(g.extract('<termin>{"aktion":"neu","titel":"Ganztag","start":"2026-12-24"}</termin>').proposals[0].end, '2026-12-25');
  assert.equal(g.validate({ aktion: 'neu', titel: 't', start: '2026-11-20T14:00', ende: '2026-11-20T13:00' }).error, 'Ende liegt nicht nach dem Start');
  assert.equal(g.validate({ aktion: 'verschieben', id: '../etc', start: '2026-11-20T14:00' }).error, 'Termin-ID fehlt');
  assert.equal(g.extract('a<termin>{"aktion":"neu","titel":"1","start":"2026-11-20T14:00"}</termin>'.repeat(7)).proposals.length, 5);
});

test('Änderungswunsch erkannt', () => {
  for (const t of ['Trag morgen um 15 Uhr Zahnarzt ein', 'Leg einen Termin am Freitag an', 'Verschiebe Mathe auf 10 Uhr', 'Erstelle einen neuen Termin']) assert.ok(cal.asksToChange(t), t);
  assert.ok(!cal.asksToChange('Was steht morgen an?'));
});
