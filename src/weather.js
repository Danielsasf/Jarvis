// Wetter über Open-Meteo (kostenlos, kein Schlüssel). Gesendet wird nur der Ortsname bzw. die Koordinaten.
const CODES = [
  [[0], 'Klar', 'sun'], [[1], 'Überwiegend klar', 'sun'], [[2], 'Wolkig', 'cloud'], [[3], 'Bedeckt', 'cloud'],
  [[45, 48], 'Nebel', 'fog'], [[51, 53, 55, 56, 57], 'Nieselregen', 'rain'], [[61, 63, 65, 66, 67, 80, 81, 82], 'Regen', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Schnee', 'snow'], [[95, 96, 99], 'Gewitter', 'storm'],
];
function describe(code) {
  const hit = CODES.find(([list]) => list.includes(code));
  return hit ? { text: hit[1], icon: hit[2] } : { text: 'Unbekannt', icon: 'cloud' };
}
const clean = (s) => String(s || '').replace(/[^\p{L}\p{N} .,'-]/gu, '').trim().slice(0, 80);

async function getJson(url, fetchFn) {
  const r = await fetchFn(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Wetterdienst antwortet mit ${r.status}`);
  return r.json();
}
async function geocode(city, fetchFn = fetch) {
  const name = clean(city);
  if (!name) throw new Error('Bitte einen Ort eingeben.');
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=de`, fetchFn);
  const hit = j?.results?.[0];
  if (!hit) throw new Error(`Ort „${name}“ nicht gefunden.`);
  return { city: name, name: [hit.name, hit.country].filter(Boolean).join(', '), lat: Number(hit.latitude), lon: Number(hit.longitude) };
}
async function forecast(place, fetchFn = fetch) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) throw new Error('Kein Ort eingestellt.');
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}`
    + '&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4';
  const j = await getJson(u, fetchFn);
  const c = j.current || {};
  const now = describe(c.weather_code);
  const d = j.daily || {};
  const days = (d.time || []).map((t, i) => ({
    date: t, ...describe(d.weather_code?.[i]), max: Math.round(d.temperature_2m_max?.[i]), min: Math.round(d.temperature_2m_min?.[i]),
  }));
  return {
    place: place.name, temp: Math.round(c.temperature_2m), text: now.text, icon: now.icon,
    wind: Math.round(c.wind_speed_10m), humidity: Math.round(c.relative_humidity_2m), days, at: Date.now(),
  };
}
module.exports = { describe, geocode, forecast, clean };
