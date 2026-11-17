const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const n = require('../src/notify');

const at = (h, m = 0, day = 17) => new Date(2026, 10, day, h, m, 0);
function make(over = {}, clock = { t: at(12) }) {
  const cfg = { enabled: true, private: true, quiet: { on: true, start: '22:00', end: '07:00' }, events: true, lead: 15, mailMode: 'rules', vips: 'mama@, schule.de', keywords: n.DEFAULT_KEYWORDS, morning: true, morningTime: '07:30', state: {}, log: [], ...over };
  const sent = []; let saves = 0;
  const data = { events: [], mails: [], failSend: false };
  const nt = new n.Notifier({ cfg: () => cfg, save: () => { saves++; }, now: () => clock.t,
    send: async (m) => { if (data.failSend) throw new Error('offline'); sent.push(m); },
    getEvents: async () => data.events, getMails: async () => data.mails, phoneUrl: () => 'http://100.64.0.5:8484/' });
  return { cfg, nt, sent, data, clock, saves: () => saves };
}
const ev = (min, now = at(12), extra = {}) => ({ id: 'e1', title: 'Mathe', start: now.getTime() + min * 60000, end: now.getTime() + (min + 45) * 60000, allDay: false, ...extra });

test('Ruhezeit über Mitternacht', () => {
  const q = { on: true, start: '22:00', end: '07:00' };
  assert.ok(n.inQuiet(at(23), q) && n.inQuiet(at(3), q) && n.inQuiet(at(6, 59), q));
  assert.ok(!n.inQuiet(at(7), q) && !n.inQuiet(at(12), q) && !n.inQuiet(at(21, 59), q));
  assert.ok(!n.inQuiet(at(23), { ...q, on: false }));
});

test('Termin-Erinnerung: einmal, privat ohne Titel, mit Klick-Adresse', async () => {
  const t = make();
  t.data.events = [ev(10), ev(40, at(12), { id: 'spaet' }), { ...ev(5), id: 'ganz', allDay: true }];
  await t.nt.tick(); await t.nt.tick();
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].title, 'Termin in 10 Min');
  assert.doesNotMatch(t.sent[0].message, /Mathe/);
  assert.equal(t.sent[0].click, 'http://100.64.0.5:8484/');
  const o = make({ private: false }); o.data.events = [ev(10, at(12), { location: 'Raum 5' })];
  await o.nt.tick(); assert.match(o.sent[0].message, /Mathe um \d\d:\d\d \(Raum 5\)/);
});

test('Ruhezeit: keine Termin-Push nachts; fehlgeschlagener Versand wird wiederholt', async () => {
  const night = make({}, { t: at(23) }); night.data.events = [ev(5, at(23))];
  await night.nt.tick(); assert.equal(night.sent.length, 0);
  const t = make(); t.data.events = [ev(5)]; t.data.failSend = true;
  await t.nt.tick(); assert.equal(t.sent.length, 0);
  t.data.failSend = false; await t.nt.tick(); assert.equal(t.sent.length, 1);
});

test('Mails: erste Prüfung meldet nichts, danach nur dringende (Stichwort/VIP)', async () => {
  const t = make();
  const m = (from, subject, text = '') => ({ from, subject, text, date: 'x' + subject });
  t.data.mails = [m('a@b.de', 'Alt dringend')];
  await t.nt.tick({ mailDue: true }); assert.equal(t.sent.length, 0, 'Baseline');
  t.data.mails = [m('a@b.de', 'Alt dringend'), m('shop@x.de', 'Angebot'), m('Frau X <x@schule.de>', 'Hallo'), m('b@c.de', 'Letzte Mahnung'), m('d@e.de', 'Frage', 'bis zur Frist Freitag')];
  await t.nt.tick({ mailDue: true });
  assert.equal(t.sent.length, 3);
  assert.ok(t.sent.every((s) => s.priority === 5 && s.title === 'Wichtige E-Mail' && !/schule|Mahnung/.test(s.message)));
  await t.nt.tick({ mailDue: true }); assert.equal(t.sent.length, 3, 'keine Doppelmeldung, auch nicht für "Angebot"');
});

test('Mails: Modus alle, Sammelmeldung, Ruhezeit, aus', async () => {
  const mk = (i) => ({ from: 'a' + i + '@x.de', subject: 's' + i, text: '', date: 'd' + i });
  const t = make({ mailMode: 'all' });
  t.data.mails = []; await t.nt.tick({ mailDue: true });
  t.data.mails = [1, 2, 3, 4, 5].map(mk); await t.nt.tick({ mailDue: true });
  assert.equal(t.sent.length, 4); assert.equal(t.sent[3].title, 'Weitere E-Mails'); assert.match(t.sent[3].message, /^2 weitere/);
  const q = make({}, { t: at(23) }); q.data.mails = []; await q.nt.tick({ mailDue: true });
  q.data.mails = [{ from: 'x', subject: 'dringend', text: '', date: '1' }]; await q.nt.tick({ mailDue: true });
  assert.equal(q.sent.length, 0);
  q.clock.t = at(12); await q.nt.tick({ mailDue: true }); assert.equal(q.sent.length, 0, 'nachts Eingegangenes wird nicht nachträglich gemeldet');
  const off = make({ mailMode: 'off' }); off.data.mails = [mk(1)]; await off.nt.tick({ mailDue: true }); await off.nt.tick({ mailDue: true }); assert.equal(off.sent.length, 0);
  const d = make({ enabled: false }); d.data.events = [ev(5)]; await d.nt.tick(); assert.equal(d.sent.length, 0);
});

test('Nicht-privat zeigt Absender und Betreff', async () => {
  const t = make({ private: false });
  t.data.mails = []; await t.nt.tick({ mailDue: true });
  t.data.mails = [{ from: 'Mama <mama@x.de>', subject: 'Abendessen', text: '', date: '1' }]; await t.nt.tick({ mailDue: true });
  assert.equal(t.sent[0].message, 'Mama <mama@x.de>: Abendessen');
});

test('Morgen-Überblick: einmal pro Tag, nur im Zeitfenster, öffnet #briefing', async () => {
  const clock = { t: at(7, 29) };
  const t = make({}, clock); t.data.events = [ev(60, at(7, 29))]; t.data.mails = [{ from: 'a', subject: 'x', text: '', date: '1' }, { from: 'b', subject: 'y', text: '', date: '2' }];
  await t.nt.tick(); assert.equal(t.sent.length, 0);
  clock.t = at(7, 31); await t.nt.tick();
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].title, 'Guten Morgen');
  assert.equal(t.sent[0].message, 'Heute: 1 Termin, 2 ungelesene Mails. Tippe für den Überblick.');
  assert.ok(t.sent[0].click.endsWith('/#briefing'));
  clock.t = at(8, 0); await t.nt.tick(); assert.equal(t.sent.length, 1, 'nur einmal');
  clock.t = at(8, 0, 18); const late = make({}, { t: at(11, 0, 18) }); await late.nt.tick(); assert.equal(late.sent.length, 0, 'zu spät (nach 3 Stunden)');
});

test('ntfy: JSON-Versand, nur https, Thema geprüft', async () => {
  let got;
  const srv = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { got = { m: q.method, b: JSON.parse(b) }; r.end('{}'); }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    await n.ntfySend({ server: `http://127.0.0.1:${srv.address().port}`, topic: n.newTopic(), title: 'Grüße', message: 'ä', click: 'http://x/', priority: 5 });
    assert.equal(got.b.title, 'Grüße'); assert.equal(got.b.priority, 5); assert.equal(got.b.click, 'http://x/');
    await assert.rejects(n.ntfySend({ server: 'http://ntfy.sh', topic: 'abcdef12', title: 't', message: 'm' }), /https/);
    await assert.rejects(n.ntfySend({ server: 'https://ntfy.sh', topic: 'a b', title: 't', message: 'm' }), /Thema/);
    assert.match(n.newTopic(), /^jarvis-[0-9a-f]{24}$/);
  } finally { srv.close(); }
});

test('Limit: höchstens 12 Pushes pro Stunde', async () => {
  const t = make({ mailMode: 'all' });
  for (let i = 0; i < 15; i++) { t.data.mails = []; t.data.events = [ev(5, at(12), { id: 'x' + i })]; await t.nt.tick(); }
  assert.equal(t.sent.length, 12);
});

test('Morgen-Überblick ohne Kalender/Mail-Zugang behauptet nichts', async () => {
  const t = make({}, { t: at(7, 31) }); t.data.events = null; t.data.mails = null;
  await t.nt.tick();
  assert.equal(t.sent[0].message, 'Heute: nichts eingerichtet, was ich melden könnte. Tippe für den Überblick.');
});
