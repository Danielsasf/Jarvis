// Google Kalender per offizieller API: Termine lesen (mit ID), anlegen, verschieben.
// Anmeldung: OAuth "Desktop-App" mit PKCE über eine kurzlebige lokale Adresse (127.0.0.1). Nur der Bereich "calendar.events".
// Nichts hier wird automatisch ausgeführt: Änderungen löst nur die Bestätigung des Nutzers im Fenster aus (siehe main.js).
const http = require('http');
const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pad = (n) => String(n).padStart(2, '0');
// 'YYYY-MM-DDTHH:MM' + Minuten → gleiche Schreibweise (reine Kalenderrechnung, keine Zeitzone nötig)
function addMinutes(local, min) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + min));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function addDays(date, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const localMs = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : NaN; };

class GCal {
  constructor({ clientId, clientSecret, refreshToken, fetchImpl = fetch, tokenUrl = TOKEN_URL, apiBase = API_BASE, tz = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
    Object.assign(this, { clientId, clientSecret, refreshToken, fetchImpl, tokenUrl, apiBase, tz });
    this.access = null; this.exp = 0;
  }
  async token() {
    if (this.access && Date.now() < this.exp - 60000) return this.access;
    const res = await this.fetchImpl(this.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, refresh_token: this.refreshToken, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(12000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) {
      if (j.error === 'invalid_grant') throw new Error('Die Google-Anmeldung ist abgelaufen. Bitte unter Einstellungen → Kalender neu verbinden.');
      throw new Error(`Google-Anmeldung fehlgeschlagen: ${j.error_description || j.error || res.status}`);
    }
    this.access = j.access_token; this.exp = Date.now() + (j.expires_in || 3600) * 1000;
    return this.access;
  }
  async api(method, path, body) {
    const res = await this.fetchImpl(this.apiBase + path, { method, signal: AbortSignal.timeout(15000),
      headers: { authorization: 'Bearer ' + await this.token(), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 404 ? 'Termin nicht gefunden.' : `Google Kalender: ${j.error?.message || res.status}`);
    return j;
  }
  fromApi(it) {
    const allDay = !!it.start?.date;
    const t = (x) => (x?.dateTime ? Date.parse(x.dateTime) : x?.date ? new Date(+x.date.slice(0, 4), +x.date.slice(5, 7) - 1, +x.date.slice(8, 10)).getTime() : NaN);
    return { id: it.id, title: it.summary || '(ohne Titel)', start: t(it.start), end: t(it.end), allDay, location: it.location || '', desc: it.description || '', link: it.htmlLink || '' };
  }
  async listEvents(from, to) {
    const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '100', timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString() });
    const j = await this.api('GET', `/calendars/primary/events?${q}`);
    return (j.items || []).filter((x) => x.status !== 'cancelled').map((x) => this.fromApi(x));
  }
  async getEvent(id) { return this.fromApi(await this.api('GET', `/calendars/primary/events/${encodeURIComponent(id)}`)); }
  // p: { title, start, end, allDay, location } – start/end als 'YYYY-MM-DDTHH:MM' (lokale Zeit) bzw. 'YYYY-MM-DD'
  timeFields(p) {
    if (p.allDay) return { start: { date: p.start }, end: { date: p.end || addDays(p.start, 1) } };
    return { start: { dateTime: p.start + ':00', timeZone: this.tz }, end: { dateTime: p.end + ':00', timeZone: this.tz } };
  }
  async insert(p) {
    const body = { summary: p.title, ...(p.location ? { location: p.location } : {}), ...this.timeFields(p) };
    return this.fromApi(await this.api('POST', '/calendars/primary/events', body));
  }
  async move(id, p) {
    const body = { ...(p.title ? { summary: p.title } : {}), ...(p.location ? { location: p.location } : {}), ...(p.start ? this.timeFields(p) : {}) };
    return this.fromApi(await this.api('PATCH', `/calendars/primary/events/${encodeURIComponent(id)}`, body));
  }
}

// Einmalige Anmeldung im Browser. openUrl(url) öffnet den Browser. Liefert { refreshToken }.
async function authorize({ clientId, clientSecret, openUrl, fetchImpl = fetch, authUrl = AUTH_URL, tokenUrl = TOKEN_URL, timeoutMs = 180000 }) {
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(16));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  let finish; const done = new Promise((res, rej) => { finish = { res, rej }; });
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
    const page = (t) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;background:#03070c;color:#d8f3ff;padding:40px"><h2>Jarvis</h2><p>${t}</p>`); };
    if (u.searchParams.get('state') !== state) { page('Ungültige Anfrage.'); return; }
    if (u.searchParams.get('error')) { page('Abgebrochen. Du kannst dieses Fenster schließen.'); finish.rej(new Error(`Google: ${u.searchParams.get('error')}`)); return; }
    const code = u.searchParams.get('code');
    if (!code) { page('Kein Code erhalten.'); return; }
    page('Verbunden. Du kannst dieses Fenster schließen und zu Jarvis zurückgehen.');
    finish.res(code);
  });
  await new Promise((r, j) => { srv.once('error', j); srv.listen(0, '127.0.0.1', r); });
  const redirect = `http://127.0.0.1:${srv.address().port}`;
  const timer = setTimeout(() => finish.rej(new Error('Zeit abgelaufen. Bitte nochmal auf „Mit Google verbinden“ klicken.')), timeoutMs);
  try {
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' });
    await openUrl(`${authUrl}?${q}`);
    const code = await done;
    const res = await fetchImpl(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect }), signal: AbortSignal.timeout(15000) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.refresh_token) throw new Error(`Anmeldung fehlgeschlagen: ${j.error_description || j.error || 'kein Zugriffstoken erhalten'}`);
    return { refreshToken: j.refresh_token };
  } finally { clearTimeout(timer); srv.close(); srv.closeAllConnections?.(); }
}

// ---------- Vorschläge der KI (<termin>{…}</termin>) ----------
const TAG = /<termin>([\s\S]*?)<\/termin>/gi;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const txt = (v, n) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, n) : '');
function validate(o) {
  if (!o || typeof o !== 'object') return { error: 'kein Objekt' };
  const action = o.aktion === 'neu' ? 'create' : o.aktion === 'verschieben' ? 'move' : null;
  if (!action) return { error: 'unbekannte Aktion' };
  const title = txt(o.titel, 200), location = txt(o.ort, 200);
  const start = typeof o.start === 'string' ? o.start.trim() : '';
  let end = typeof o.ende === 'string' ? o.ende.trim() : '';
  const allDay = DATE.test(start);
  if (action === 'create' && !title) return { error: 'Titel fehlt' };
  if (action === 'move' && !/^[A-Za-z0-9_-]{5,1024}$/.test(String(o.id || ''))) return { error: 'Termin-ID fehlt' };
  if (start && !allDay && !LOCAL.test(start)) return { error: 'Startzeit ungültig' };
  if (action === 'create' && !start) return { error: 'Startzeit fehlt' };
  if (end && !(allDay ? DATE.test(end) : LOCAL.test(end))) return { error: 'Endzeit ungültig' };
  if (start) {
    if (!end) end = allDay ? addDays(start, 1) : addMinutes(start, 60);
    if (!(localMs(end) > localMs(start))) return { error: 'Ende liegt nicht nach dem Start' };
  }
  if (action === 'move' && !start && !title && !location) return { error: 'nichts zu ändern' };
  return { p: { action, id: action === 'move' ? String(o.id) : undefined, title, start, end, allDay, location } };
}
// Entfernt alle <termin>-Blöcke aus dem Text. Gibt { clean, proposals, rejected } zurück (maximal 5 Vorschläge).
function extract(text) {
  const proposals = []; let rejected = 0;
  const clean = String(text).replace(TAG, (_m, body) => {
    let o; try { o = JSON.parse(body); } catch { rejected++; return ''; }
    const v = validate(o);
    if (v.error || proposals.length >= 5) rejected++; else proposals.push(v.p);
    return '';
  }).replace(/<termin>[\s\S]*$/i, '').trim();
  return { clean, proposals, rejected };
}

module.exports = { GCal, authorize, extract, validate, addMinutes, addDays, SCOPE };
