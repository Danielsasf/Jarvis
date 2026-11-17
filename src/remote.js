// Handy-Zugang: kleiner Chat-Server, nur im privaten Tailscale-Netz erreichbar.
// Nur Chat: kein Zugriff auf Dateien, Programme oder Einstellungen. Schlüssel bleiben auf dem PC.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BODY = 64 * 1024;
const CODE_TTL_MS = 5 * 60 * 1000;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

/** Tailscale-Adresse dieses PCs (100.64.0.0/10), falls Tailscale läuft. */
function findTailscaleIp(interfaces = os.networkInterfaces()) {
  for (const list of Object.values(interfaces)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address)) return i.address;
    }
  }
  return null;
}

class RemoteServer {
  /**
   * store: ChatStore · answer(messages, {onDelta, abortSignal}) -> {text, by,…} · devices: {get(), save(list)}
   * onChat(chat): wird nach jeder Handy-Antwort gerufen (PC-Fenster aktualisieren)
   */
  constructor({ store, answer, devices, log = () => {}, onChat = () => {}, now = Date.now }) {
    Object.assign(this, { store, answer, devices, log, onChat, now });
    this.server = null; this.host = null; this.port = null;
    this.pairing = null; this.attempts = []; this.busy = new Set();
  }

  status() { return { running: !!this.server, host: this.host, port: this.port, url: this.server ? `http://${this.host}:${this.port}` : null }; }

  newCode() {
    this.pairing = { code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expires: this.now() + CODE_TTL_MS, tries: 0 };
    return { code: this.pairing.code, expires: this.pairing.expires };
  }
  clearCode() { this.pairing = null; }

  start({ host, port }) {
    if (this.server) return Promise.resolve(this.status());
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handle(req, res).catch((err) => {
        this.log(`Handy-Server Fehler: ${err.message}`);
        if (!res.headersSent) this.json(res, 500, { error: 'Interner Fehler' }); else res.end();
      }));
      srv.once('error', reject);
      srv.listen(port, host, () => {
        srv.removeListener('error', reject);
        this.server = srv; this.host = host; this.port = srv.address().port;
        this.log(`Handy-Zugang an: http://${host}:${this.port}`);
        resolve(this.status());
      });
    });
  }
  stop() {
    const s = this.server;
    this.server = null; this.pairing = null;
    if (s) { s.closeAllConnections?.(); s.close(); this.log('Handy-Zugang aus'); }
  }

  json(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(obj));
  }
  async body(req) {
    let size = 0; const parts = [];
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('Zu groß'), { status: 413 }); parts.push(c); }
    try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Ungültige Anfrage'), { status: 400 }); }
  }
  authDevice(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer ([a-f0-9]{48})$/);
    if (!m) return null;
    const h = Buffer.from(sha(m[1]), 'hex');
    const list = this.devices.get();
    for (const d of list) {
      const dh = Buffer.from(d.hash, 'hex');
      if (dh.length === h.length && crypto.timingSafeEqual(dh, h)) return d;
    }
    return null;
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'GET /' || route === 'GET /index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; manifest-src 'self'; img-src data:" });
        return res.end(fs.readFileSync(path.join(__dirname, 'remote', 'phone.html')));
      }
      if (route === 'GET /manifest.webmanifest') {
        res.writeHead(200, { 'content-type': 'application/manifest+json' });
        return res.end(JSON.stringify({ name: 'Jarvis', short_name: 'Jarvis', start_url: '/', display: 'standalone', background_color: '#03070c', theme_color: '#03070c' }));
      }
      if (route === 'POST /api/pair') return await this.pair(req, res);

      const dev = this.authDevice(req);
      if (!dev) return this.json(res, 401, { error: 'Nicht gekoppelt' });
      dev.last = this.now();
      if (route === 'GET /api/chats') {
        return this.json(res, 200, this.store.all().map((c) => ({ id: c.id, title: c.title, updated: c.updated, count: c.messages.length })));
      }
      if (route === 'GET /api/chat') {
        const c = this.store.all().find((x) => x.id === url.searchParams.get('id'));
        return c ? this.json(res, 200, c) : this.json(res, 404, { error: 'Chat nicht gefunden' });
      }
      if (route === 'POST /api/send') return await this.send(req, res);
      return this.json(res, 404, { error: 'Nicht gefunden' });
    } catch (err) {
      if (err.status) return this.json(res, err.status, { error: err.message });
      throw err;
    }
  }

  async pair(req, res) {
    const t = this.now();
    this.attempts = this.attempts.filter((x) => t - x < 60000);
    if (this.attempts.length >= 10) return this.json(res, 429, { error: 'Zu viele Versuche. Warte eine Minute.' });
    this.attempts.push(t);
    const { code, name } = await this.body(req);
    const p = this.pairing;
    if (!p || p.expires < t) return this.json(res, 403, { error: 'Kein gültiger Kopplungscode. Erzeuge am PC einen neuen.' });
    if (String(code || '').trim() !== p.code) {
      if (++p.tries >= 5) this.pairing = null;
      return this.json(res, 403, { error: this.pairing ? 'Code falsch' : 'Zu oft falsch – erzeuge am PC einen neuen Code.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    const list = this.devices.get();
    list.push({ id: crypto.randomBytes(4).toString('hex'), name: String(name || 'Handy').slice(0, 40), hash: sha(token), created: t, last: t });
    this.devices.save(list);
    this.pairing = null;
    this.log('Neues Handy gekoppelt');
    return this.json(res, 200, { token });
  }

  async send(req, res) {
    const { chatId, text } = await this.body(req);
    const msg = String(text || '').trim().slice(0, 8000);
    if (!msg) return this.json(res, 400, { error: 'Leere Nachricht' });
    const id = /^[\w-]{1,40}$/.test(String(chatId || '')) ? String(chatId) : `p${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
    if (this.busy.has(id) || this.busy.size >= 2) return this.json(res, 429, { error: 'Jarvis antwortet gerade noch.' });
    this.busy.add(id);
    const existing = this.store.all().find((c) => c.id === id);
    const chat = existing || { id, title: msg.replace(/\s+/g, ' ').slice(0, 40), created: this.now(), updated: this.now(), messages: [] };
    chat.messages.push({ role: 'user', content: msg });
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const out = (o) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    out({ t: 'start', chatId: id });
    try {
      const r = await this.answer(chat.messages, { abortSignal: abort.signal, onDelta: (text) => out({ t: 'delta', text }) });
      if (r.stopped) { chat.messages.pop(); return; }
      chat.messages.push({ role: 'assistant', content: r.text, by: r.by });
      chat.updated = this.now();
      this.store.upsert(chat);
      this.onChat(chat);
      out({ t: 'done', chatId: id, text: r.text, by: r.by });
    } catch (err) {
      out({ t: 'error', message: String(err.message || err).slice(0, 400) });
    } finally {
      this.busy.delete(id);
      res.end();
    }
  }
}

module.exports = { RemoteServer, findTailscaleIp };
