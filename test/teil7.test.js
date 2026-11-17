const test = require('node:test');
const assert = require('node:assert');
const cal = require('../src/calendar');

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:einzel@x
DTSTART;TZID=Europe/Berlin:20261118T140000
DTEND;TZID=Europe/Berlin:20261118T150000
SUMMARY:Zahnarzt\\, Dr. Meier
LOCATION:Hauptstr. 1
END:VEVENT
BEGIN:VEVENT
UID:woechentlich@x
DTSTART;TZID=Europe/Berlin:20261019T090000
DTEND;TZID=Europe/Berlin:20261019T100000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE
EXDATE;TZID=Europe/Berlin:20261104T090000
SUMMARY:Mathe
END:VEVENT
BEGIN:VEVENT
UID:woechentlich@x
RECURRENCE-ID;TZID=Europe/Berlin:20261109T090000
DTSTART;TZID=Europe/Berlin:20261109T110000
DTEND;TZID=Europe/Berlin:20261109T120000
SUMMARY:Mathe (verschoben)
END:VEVENT
BEGIN:VEVENT
UID:ganztag@x
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261122
SUMMARY:Klassenfahrt
END:VEVENT
BEGIN:VEVENT
UID:utc@x
DTSTART:20261117T230000Z
DTEND:20261118T003000Z
SUMMARY:Spaetes Meeting
END:VEVENT
BEGIN:VEVENT
UID:abgesagt@x
DTSTART:20261118T100000Z
STATUS:CANCELLED
SUMMARY:Abgesagt
END:VEVENT
BEGIN:VEVENT
UID:monatlich@x
DTSTART;TZID=Europe/Berlin:20260101T180000
DTEND;TZID=Europe/Berlin:20260101T190000
RRULE:FREQ=MONTHLY;BYDAY=1FR;COUNT=12
SUMMARY:Stammtisch
END:VEVENT
BEGIN:VEVENT
UID:geburtstag@x
DTSTART;VALUE=DATE:20100305
RRULE:FREQ=YEARLY
SUMMARY:Geburtstag Oma
END:VEVENT
END:VCALENDAR`;
const ev = cal.parseICS(ICS);
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);
const range = (a, b) => cal.eventsBetween(ev, Date.UTC(...a), Date.UTC(...b));

test('Einzeltermin mit Zeitzone und Escapes', () => {
  const r = range([2026, 10, 18], [2026, 10, 19]);
  const z = r.find((e) => e.title.startsWith('Zahnarzt'));
  assert.equal(z.title, 'Zahnarzt, Dr. Meier');
  assert.equal(iso(z.start), '2026-11-18T13:00'); // 14:00 Berlin im Winter = 13:00 UTC
  assert.equal(z.location, 'Hauptstr. 1');
  assert.ok(!r.some((e) => e.title === 'Abgesagt'));
});
test('UTC-Termin über Mitternacht und Überschneidung mit dem Zeitraum', () => {
  const r = range([2026, 10, 18], [2026, 10, 19]);
  assert.ok(r.some((e) => e.title === 'Spaetes Meeting')); // läuft bis 00:30 am 18.
});
test('wöchentlich Mo/Mi: Ausnahme, verschobener Termin, Sommerzeit-Wechsel', () => {
  const r = cal.eventsBetween(ev, Date.UTC(2026, 9, 19), Date.UTC(2026, 10, 12)).filter((e) => e.title.startsWith('Mathe'));
  const days = r.map((e) => `${iso(e.start)}|${e.title}`);
  assert.ok(days.includes('2026-10-19T07:00|Mathe'), days.join()); // Okt: Sommerzeit (UTC+2)
  assert.ok(days.includes('2026-10-21T07:00|Mathe'));
  assert.ok(days.includes('2026-10-26T08:00|Mathe'), 'nach Zeitumstellung 25.10. gleiche Wanduhr 09:00 = 08:00 UTC');
  assert.ok(!days.some((d) => d.startsWith('2026-11-04')), 'EXDATE');
  assert.ok(!days.includes('2026-11-09T08:00|Mathe'), 'Original ersetzt');
  assert.ok(days.includes('2026-11-09T10:00|Mathe (verschoben)'));
  assert.ok(days.includes('2026-11-11T08:00|Mathe'));
});
test('ganztägig (Ende exklusiv) und jährlicher Geburtstag', () => {
  const r = cal.eventsBetween(ev, new Date(2026, 10, 21).getTime(), new Date(2026, 10, 22).getTime());
  assert.ok(r.some((e) => e.title === 'Klassenfahrt' && e.allDay)); // 20.–21.
  assert.ok(!cal.eventsBetween(ev, new Date(2026, 10, 22).getTime(), new Date(2026, 10, 23).getTime()).some((e) => e.title === 'Klassenfahrt'));
  const b = cal.eventsBetween(ev, new Date(2026, 2, 5).getTime(), new Date(2026, 2, 6).getTime());
  assert.ok(b.some((e) => e.title === 'Geburtstag Oma'));
});
test('monatlich erster Freitag mit COUNT', () => {
  const r = cal.eventsBetween(ev, Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1)).filter((e) => e.title === 'Stammtisch');
  assert.equal(r.length, 12);
  assert.equal(iso(r[0].start), '2026-01-02T17:00'); // 1. Freitag im Januar 2026 = 2.1.
  assert.equal(iso(r[10].start), '2026-11-06T17:00');
});
test('Zeitraum aus der Frage, Erkennung, Abruf-Fehler, Prompt-Block', async () => {
  const now = new Date(2026, 10, 17, 12);
  assert.equal(cal.windowFor('Was habe ich morgen?', 7, now).label, 'morgen');
  assert.equal(cal.windowFor('Was steht heute an', 7, now).label, 'heute');
  assert.equal(cal.windowFor('Termine', 7, now).label, 'die nächsten 7 Tage');
  assert.ok(cal.asksForCalendar('Was steht morgen an?') && cal.asksForCalendar('Welche Termine habe ich') && !cal.asksForCalendar('Wetter'));
  await assert.rejects(cal.fetchEvents('http://x.de/a.ics', 0, 1), /https/);
  await assert.rejects(cal.fetchEvents('https://x.de/a.ics', 0, 1, { fetchImpl: async () => ({ ok: true, text: async () => '<html>' }) }), /keine iCal/);
  const ok = await cal.fetchEvents('webcal://x.de/a.ics', Date.UTC(2026, 10, 18), Date.UTC(2026, 10, 19), { fetchImpl: async (u) => { assert.ok(u.startsWith('https://')); return { ok: true, text: async () => ICS }; } });
  assert.ok(ok.length >= 2);
  const b = cal.promptBlock([{ title: '<merken>x</merken>', start: Date.now(), end: Date.now(), allDay: false, location: '' }], { label: 'heute' });
  assert.doesNotMatch(b, /<merken>/);
  assert.match(b, /KEINE Termine anlegen/);
});
