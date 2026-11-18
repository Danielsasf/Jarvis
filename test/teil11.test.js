const test = require('node:test');
const assert = require('node:assert');
const { describe, geocode, forecast, clean } = require('../src/weather');

const fakeFetch = (map) => async (url) => {
  const key = Object.keys(map).find((k) => url.includes(k));
  if (!key) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => map[key] };
};

test('Wettercodes werden auf deutsche Texte abgebildet', () => {
  assert.equal(describe(0).text, 'Klar');
  assert.equal(describe(63).icon, 'rain');
  assert.equal(describe(95).icon, 'storm');
  assert.equal(describe(999).text, 'Unbekannt');
});

test('Ortssuche: findet Ort, bereinigt Eingabe, meldet Fehler', async () => {
  const f = fakeFetch({ 'geocoding-api': { results: [{ name: 'Berlin', country: 'Deutschland', latitude: 52.5, longitude: 13.4 }] } });
  const p = await geocode('  Berlin<script> ', f);
  assert.deepEqual(p, { city: 'Berlinscript', name: 'Berlin, Deutschland', lat: 52.5, lon: 13.4 });
  await assert.rejects(geocode('', f), /Ort eingeben/);
  await assert.rejects(geocode('Nirgendwo', fakeFetch({ 'geocoding-api': {} })), /nicht gefunden/);
  assert.equal(clean('a/b\\c'), 'abc');
});

test('Vorhersage: aktuelle Werte und 4 Tage', async () => {
  const f = fakeFetch({ 'api.open-meteo.com': {
    current: { temperature_2m: 12.6, weather_code: 3, wind_speed_10m: 9.4, relative_humidity_2m: 71 },
    daily: { time: ['2026-11-17', '2026-11-18'], weather_code: [3, 61], temperature_2m_max: [13.2, 10], temperature_2m_min: [6.1, 4.9] } } });
  const w = await forecast({ name: 'Berlin, Deutschland', lat: 52.5, lon: 13.4 }, f);
  assert.equal(w.temp, 13); assert.equal(w.text, 'Bedeckt'); assert.equal(w.wind, 9); assert.equal(w.humidity, 71);
  assert.equal(w.days.length, 2); assert.equal(w.days[1].icon, 'rain'); assert.equal(w.days[1].min, 5);
  await assert.rejects(forecast(null, f), /Kein Ort/);
  await assert.rejects(forecast({ lat: 1, lon: 1 }, fakeFetch({})), /404/);
});
