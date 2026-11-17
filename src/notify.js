// Benachrichtigungen aufs Handy über ntfy (kostenlos, https://ntfy.sh – oder eigener Server).
// Regeln laufen lokal auf dem PC: Termin-Erinnerung, dringende Mails (Absender/Stichwörter), Morgen-Überblick.
// Standard "privat": Die Push-Texte enthalten keine Absender, Betreffe oder Titel – Details sieht man erst im Handy-Chat.
const crypto = require('crypto');

const DEFAULT_KEYWORDS = 'dringend, dringlich, frist, mahnung, zahlungserinnerung, letzte erinnerung, abgabe, klausur, sicherheitswarnung, urgent, asap, deadline';
const newTopic = () => 'jarvis-' + crypto.randomBytes(12).toString('hex');

// Nur https (oder lokale/Tailscale-Adressen für eigene Server) – nie Klartext über das offene Internet.
function checkServer(url) {
  let u; try { u = new URL(String(url).trim()); } catch { throw new Error('Ungültige Server-Adresse.'); }
  const local = /^(localhost|127\.0\.0\.1|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Der Server muss mit https:// beginnen.');
  return u.origin;
}
async function ntfySend({ server, topic, title, message, click, priority = 3, tags }, fetchImpl = fetch) {
  const base = checkServer(server);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(topic || '')) throw new Error('Ungültiges Thema.');
  const res = await fetchImpl(base, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(12000),
    body: JSON.stringify({ topic, title, message, priority, ...(click ? { click } : {}), ...(tags ? { tags } : {}) }) });
  if (!res.ok) throw new Error(`Push-Server meldet Fehler ${res.status}.`);
}

const minutes = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
function inQuiet(now, q) {
  if (!q?.on) return false;
  const a = minutes(q.start), b = minutes(q.end); if (a == null || b == null || a === b) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return a < b ? t >= a && t < b : t >= a || t < b;
}
const list = (s) => String(s || '').split(/[,\n;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
function isUrgent(mail, cfg) {
  const from = String(mail.from || '').toLowerCase();
  if (list(cfg.vips).some((v) => from.includes(v))) return true;
  const hay = `${mail.subject || ''} ${String(mail.text || '').slice(0, 300)}`.toLowerCase();
  return list(cfg.keywords).some((k) => hay.includes(k));
}
const mailKey = (m) => 'm:' + crypto.createHash('sha1').update(`${m.from}|${m.subject}|${m.date}`).digest('hex').slice(0, 16);
const hm = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

class Notifier {
  // cfg(): Einstellungen (live), save(): speichern, send(msg): Push senden,
  // getEvents(from,to) / getMails(): Daten holen (oder null, wenn nicht eingerichtet)
  constructor({ cfg, save, send, getEvents, getMails, phoneUrl = () => null, now = () => new Date(), log = () => {} }) {
    Object.assign(this, { cfg, save, send, getEvents, getMails, phoneUrl, now, log });
    this.busy = false; this.recent = [];
  }
  state() { const c = this.cfg(); c.state ||= {}; c.state.sent ||= {}; return c.state; }
  prune() { const s = this.state().sent; const keys = Object.keys(s); if (keys.length > 600) for (const k of keys.sort((a, b) => s[a] - s[b]).slice(0, keys.length - 400)) delete s[k]; }
  limited() { const t = this.now().getTime(); this.recent = this.recent.filter((x) => t - x < 3600000); return this.recent.length >= 12; }
  async push(msg) {
    if (this.limited()) { this.log('Benachrichtigung übersprungen (Limit 12 pro Stunde)'); return false; }
    const click = this.phoneUrl();
    await this.send({ ...msg, click: click ? click + (msg.hash || '') : undefined });
    this.recent.push(this.now().getTime());
    const c = this.cfg(); c.log = [{ t: this.now().getTime(), title: msg.title }, ...(c.log || [])].slice(0, 10);
    return true;
  }
  // Wird jede Minute aufgerufen. mailDue: Postfach jetzt prüfen (alle ~5 Min).
  async tick({ mailDue = false } = {}) {
    const c = this.cfg();
    if (!c.enabled || this.busy) return;
    this.busy = true;
    try {
      const now = this.now(); const quiet = inQuiet(now, c.quiet); const st = this.state();
      let dirty = false;
      // 1) Termin-Erinnerung
      if (c.events && !quiet && this.getEvents) {
        try {
          const lead = Math.max(1, Number(c.lead) || 15) * 60000;
          const evs = await this.getEvents(now.getTime(), now.getTime() + lead + 60000);
          for (const e of evs || []) {
            if (e.allDay || e.start <= now.getTime() - 60000 || e.start > now.getTime() + lead) continue;
            const key = `e:${e.id || e.title}:${e.start}`;
            if (st.sent[key]) continue;
            const mins = Math.max(1, Math.round((e.start - now.getTime()) / 60000));
            const ok = await this.push({ title: `Termin in ${mins} Min`, priority: 4, tags: 'calendar',
              message: c.private ? 'Gleich beginnt ein Termin. Tippe, um Jarvis zu öffnen.' : `${e.title} um ${hm(e.start)}${e.location ? ` (${e.location})` : ''}` });
            if (ok) { st.sent[key] = now.getTime(); dirty = true; }
          }
        } catch (err) { this.log(`Termin-Erinnerung fehlgeschlagen: ${String(err.message).slice(0, 100)}`); }
      }
      // 2) Mails
      let unseen = null;
      if ((mailDue || (c.morning && this.morningDue(now))) && c.mailMode !== 'off' && this.getMails) {
        try { unseen = await this.getMails(); } catch (err) { this.log(`Mail-Prüfung fehlgeschlagen: ${String(err.message).slice(0, 100)}`); }
      }
      if (mailDue && unseen && c.mailMode !== 'off') {
        const fresh = unseen.filter((m) => !st.sent[mailKey(m)]);
        if (!st.mailBaseline) { for (const m of unseen) st.sent[mailKey(m)] = now.getTime(); st.mailBaseline = true; dirty = true; } // erste Prüfung: nichts melden, nur merken
        else if (fresh.length) {
          const want = fresh.filter((m) => c.mailMode === 'all' || isUrgent(m, c));
          for (const m of fresh) if (!want.includes(m) || quiet) { st.sent[mailKey(m)] = now.getTime(); dirty = true; } // nicht gemeldet, aber nicht später nachmelden
          if (!quiet) {
            for (const m of want.slice(0, 3)) {
              const urgent = isUrgent(m, c);
              const ok = await this.push({ title: urgent ? 'Wichtige E-Mail' : 'Neue E-Mail', priority: urgent ? 5 : 3, tags: urgent ? 'rotating_light,email' : 'email',
                message: c.private ? (urgent ? 'Eine wichtige Mail ist angekommen. Tippe zum Nachsehen.' : 'Eine neue Mail ist angekommen.') : `${m.from}: ${m.subject}` });
              if (ok) { st.sent[mailKey(m)] = now.getTime(); dirty = true; }
            }
            if (want.length > 3) { // Rest als Sammelmeldung
              const rest = want.slice(3);
              if (await this.push({ title: 'Weitere E-Mails', priority: 3, tags: 'email', message: `${rest.length} weitere neue Mails.` })) for (const m of rest) st.sent[mailKey(m)] = now.getTime();
              dirty = true;
            }
          }
        }
      }
      // 3) Morgen-Überblick (einmal pro Tag, ignoriert die Ruhezeit, nur bis 3 Stunden nach der Wunschzeit)
      if (c.morning && this.morningDue(now)) {
        const r = await this.briefing(unseen);
        if (r) { st.lastMorning = dayKey(now); dirty = true; }
      }
      if (dirty) { this.prune(); this.save(); }
    } finally { this.busy = false; }
  }
  morningDue(now) {
    const c = this.cfg(); const t = minutes(c.morningTime); if (t == null) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    return cur >= t && cur < t + 180 && this.state().lastMorning !== dayKey(now);
  }
  async briefing(unseen) {
    const c = this.cfg(); const now = this.now();
    let evs = []; let evOk = false;
    if (this.getEvents) { try { const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime(); const got = await this.getEvents(now.getTime() - 3600000, end); if (got) { evs = got.filter((e) => e.allDay || e.end > now.getTime()); evOk = true; } } catch { /* ohne Termine */ } }
    const parts = [];
    if (evOk) {
      const next = evs.find((e) => !e.allDay);
      parts.push(evs.length ? (c.private ? `${evs.length} Termin${evs.length === 1 ? '' : 'e'}` : `${evs.length} Termin${evs.length === 1 ? '' : 'e'}${next ? ` (nächster: ${next.title} um ${hm(next.start)})` : ''}`) : 'keine Termine');
    }
    if (unseen) { const n = unseen.length; parts.push(n ? `${n} ungelesene Mail${n === 1 ? '' : 's'}${!c.private && unseen.some((m) => isUrgent(m, c)) ? ' (davon wichtige)' : ''}` : 'keine neuen Mails'); }
    if (!parts.length) parts.push('nichts eingerichtet, was ich melden könnte');
    return this.push({ title: 'Guten Morgen', priority: 3, tags: 'sunny', hash: '#briefing', message: `Heute: ${parts.join(', ')}. Tippe für den Überblick.` });
  }
}

module.exports = { Notifier, ntfySend, checkServer, inQuiet, isUrgent, newTopic, DEFAULT_KEYWORDS, mailKey };
