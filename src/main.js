const { app, BrowserWindow, ipcMain, safeStorage, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { runWithFallback, callWithRetry } = require('./router');
const { PROVIDERS, getProvider, listModels, chatStream, transcribe, pickDefaultModel } = require('./providers');
const { CODE_VERSION, UPDATE_REPO } = require('./version');
const updater = require('./updater');
const packsLib = require('./packs');
const { Memory, stripTags } = require('./memory');
const { WakeWord } = require('./wake');
const accountsLib = require('./accounts');
const speed = require('./speed');
const { ChatStore } = require('./chats');
const { RemoteServer, findTailscaleIp } = require('./remote');
const mailLib = require('./mail');

const BOOT = global.JARVIS || { shellVersion: CODE_VERSION, appDir: path.join(app.getPath('userData'), 'app'), markHealthy: () => {} };

const DEFAULT_SYSTEM = `Du bist Jarvis, ein persönlicher KI-Assistent.
Antworte auf Deutsch, kurz, klar und freundlich. Komm direkt zur Sache.
Deine Antworten werden oft vorgelesen: schreib natürlich und benutze keine Emojis.
Wenn du etwas nicht weißt oder nicht kannst, sag es ehrlich.`;
const OLD_DEFAULT_START = 'Du bist Jarvis, ein persönlicher KI-Assistent.\nAntworte auf Deutsch, kurz, klar und freundlich. Komm direkt zur Sache.\nWenn du';

const WIDGET_GUIDE = `Darstellung (Jarvis zeigt das grafisch an):
- Tabellen als Markdown-Tabelle (| Spalte | Spalte |) – erscheinen als Tafel.
- Widgets als Codeblock mit der Sprache "widget" und gültigem JSON, eins pro Block:
  {"typ":"kennzahlen","titel":"…","werte":[{"label":"…","wert":"…"}]}
  {"typ":"checkliste","titel":"…","punkte":["…","…"]}
  {"typ":"balken","titel":"…","einheit":"€","daten":[{"label":"…","wert":123}]}
  {"typ":"zeitplan","titel":"…","eintraege":[{"zeit":"09:00","text":"…"}]}
- Tafeln und Widgets nur, wenn sie wirklich helfen. Kurze Fragen bekommen kurze Antworten ohne Widget.`;

const MEMORY_GUIDE = `Gedächtnis:
- Wenn der Nutzer etwas Dauerhaftes über sich erzählt (Name, Vorlieben, Ziele, wichtige Termine) oder dich bittet, dir etwas zu merken, schreib ganz am Ende deiner Antwort <merken>kurzer Fakt</merken> (ein Tag pro Fakt).
- Merk dir keine Passwörter, Schlüssel, Konto- oder Ausweisnummern.
- Soll etwas vergessen werden, schreib <vergessen>ID</vergessen> mit der ID aus der Liste.
- Erwähne diese Markierungen nie im Text; sag einfach natürlich, dass du es dir merkst.`;

let win;
let memory;
let chatStore;
let remote;
let wake;
let packs = [];
const userPackDir = () => path.join(app.getPath('userData'), 'pakete');
const builtinPackDir = path.join(__dirname, 'packs');
function reloadPacks() {
  fs.mkdirSync(userPackDir(), { recursive: true });
  packs = packsLib.loadAll(builtinPackDir, userPackDir());
}
const packOn = (p) => !p.error && (cfg.packs?.[p.id] ?? true);

function buildSystem(invoked) {
  const now = new Date();
  const parts = [cfg.settings.systemPrompt,
    `Heute ist ${now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.`,
    WIDGET_GUIDE, MEMORY_GUIDE];
  const mem = memory.promptBlock();
  parts.push(mem ? `Was du über den Nutzer weißt:\n${mem}` : 'Du weißt noch nichts Persönliches über den Nutzer.');
  const active = packs.filter(packOn);
  if (active.length) {
    let budget = 9000;
    const blocks = [];
    for (const p of active) {
      const full = `## Paket ${p.name} (${p.befehl}) – ${p.beschreibung}\n${p.instructions}`;
      if (p === invoked || full.length <= budget) { blocks.push(full); budget -= full.length; }
      else blocks.push(`## Paket ${p.name} (${p.befehl}) – ${p.beschreibung}`);
    }
    parts.push(`Installierte Pakete. Passt eine Anfrage zu einem Paket, arbeite nach seinen Anweisungen. Den Befehl kannst du dem Nutzer nennen.\n\n${blocks.join('\n\n')}`);
  }
  if (invoked) parts.push(`Der Nutzer hat gerade das Paket „${invoked.name}“ aufgerufen. Arbeite jetzt genau nach dessen Anweisungen.`);
  return parts.join('\n\n');
}

const cfgPath = () => path.join(app.getPath('userData'), 'jarvis-config.json');
const logPath = () => path.join(app.getPath('userData'), 'jarvis.log');

// ---------- Konfiguration ----------
function loadCfg() {
  try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { return {}; }
}
let cfg = {};
function normalize(c) {
  accountsLib.migrate(c);
  c.remote = { enabled: false, port: 8484, devices: [], ...(c.remote || {}) };
  if (!Array.isArray(c.remote.devices)) c.remote.devices = [];
  c.mail = { enabled: false, preset: 'webde', host: 'imap.web.de', port: 993, user: '', pass: '', days: 3, ...(c.mail || {}) };
  c.settings = { systemPrompt: DEFAULT_SYSTEM, speak: true, timeoutSec: 60, autoUpdate: true, wakeWord: false, wakeSens: 'mid', voice: '', rate: 1.1,
    race: true, hedgeSec: 5, speedOrder: true, ...(c.settings || {}) };
  // alte Standard-Persönlichkeit aus V1 automatisch auf die neue (ohne Emojis) heben
  if (c.settings.systemPrompt.startsWith(OLD_DEFAULT_START)) c.settings.systemPrompt = DEFAULT_SYSTEM;
  return c;
}
function saveCfg() {
  fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
  fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2));
}
function encrypt(text) {
  if (!text) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64');
  return 'raw:' + Buffer.from(text).toString('base64');
}
function decrypt(stored) {
  if (!stored) return '';
  const [kind, data] = [stored.slice(0, 4), stored.slice(4)];
  if (kind === 'enc:') return safeStorage.decryptString(Buffer.from(data, 'base64'));
  return Buffer.from(data, 'base64').toString('utf8');
}
function log(line) {
  // Nie Schlüssel oder Nachrichteninhalte protokollieren
  try { fs.appendFileSync(logPath(), `${new Date().toISOString()} ${line}\n`); } catch { /* egal */ }
  emit('jarvis:log', line);
}
function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function publicState() {
  return {
    version: CODE_VERSION,
    order: cfg.order,
    packs: packs.map((p) => ({ id: p.id, name: p.name, befehl: p.befehl, beschreibung: p.beschreibung, symbol: p.symbol,
      beispiele: p.beispiele, builtin: p.builtin, error: p.error, enabled: packOn(p), instructions: p.instructions })),
    memory: memory.list(),
    remote: remoteInfo(),
    mail: { enabled: cfg.mail.enabled, preset: cfg.mail.preset, host: cfg.mail.host, port: cfg.mail.port, user: cfg.mail.user, hasPass: !!cfg.mail.pass, days: cfg.mail.days },
    settings: cfg.settings,
    providers: cfg.order.map((id) => {
      const acc = cfg.accounts[id];
      const t = accountsLib.typeOf(acc.type);
      return {
        id, type: acc.type, name: accountsLib.displayName(id, acc, t), desc: t.desc, local: !!t.local, custom: !!t.custom, base: acc.base || '',
        keyUrl: t.keyUrl, stt: !!t.stt, connected: true, enabled: acc.enabled !== false, model: acc.model || '', models: acc.models || [],
        ms: Number.isFinite(acc.ms) ? acc.ms : null,
      };
    }),
    catalog: PROVIDERS.map((t) => ({ type: t.id, name: t.name, desc: t.desc, local: !!t.local, custom: !!t.custom, keyOptional: !!t.keyOptional, keyUrl: t.keyUrl })),
  };
}
function remoteInfo() {
  const r = cfg.remote;
  const st = remote?.status() || { running: false };
  return {
    enabled: r.enabled, port: r.port, running: st.running, url: st.url,
    tailscale: !!(process.env.JARVIS_REMOTE_HOST || findTailscaleIp()),
    devices: r.devices.map((d) => ({ id: d.id, name: d.name, created: d.created, last: d.last })),
  };
}
async function remoteApply() {
  const r = cfg.remote;
  if (!r.enabled) { remote.stop(); return; }
  const host = process.env.JARVIS_REMOTE_HOST || findTailscaleIp(); // nur Tailscale (oder Testadresse), nie das ganze Netzwerk
  if (!host) { remote.stop(); return; }
  if (remote.status().running && (remote.host !== host || remote.port !== r.port)) remote.stop();
  try { await remote.start({ host, port: r.port }); } catch (err) { log(`Handy-Zugang konnte nicht starten: ${err.message}`); remote.stop(); }
}
const P = (id) => accountsLib.providerFor(id, cfg.accounts[id]);
const activeChain = () => cfg.order.filter((id) => cfg.accounts[id] && cfg.accounts[id].enabled !== false);
const orderedChain = () => (cfg.settings.speedOrder ? speed.sortBySpeed(activeChain(), (id) => cfg.accounts[id].ms) : activeChain());
function recordSpeed(id, ms, ok = true) {
  const acc = cfg.accounts[id];
  if (acc) acc.ms = speed.record(acc.ms, ms, ok);
}

// Modellliste neu holen; ist das gewählte Modell weg (oder kaputt), automatisch das beste aktuelle nehmen
async function refreshModels(id, { exclude = [] } = {}) {
  const s = cfg.accounts[id];
  if (!s) return false;
  const p = P(id);
  const models = await callWithRetry((signal) => listModels(p, decrypt(s.key), fetch, signal), { maxRetries: 1, timeoutMs: p.local ? 4000 : 15000 });
  s.models = models;
  const old = s.model;
  if (!models.includes(s.model) || exclude.includes(s.model)) s.model = pickDefaultModel(p, models, exclude);
  saveCfg();
  if (s.model !== old) {
    log(`[${p.name}] Modell automatisch gewechselt: ${old || '–'} → ${s.model}`);
    emit('jarvis:state', publicState());
  }
  return s.model !== old && !!s.model;
}

// ---------- IPC ----------
ipcMain.handle('state:get', () => publicState());
ipcMain.handle('wake:get', () => wake?.state || { state: 'off' });

ipcMain.handle('account:add', async (_e, { type, key, label, base } = {}) => {
  const t = accountsLib.typeOf(type);
  if (!t) throw new Error('Unbekannter Anbieter.');
  key = String(key || '').trim();
  if (!t.local && !t.keyOptional && !key) throw new Error('Bitte einen API-Schlüssel eingeben.');
  const acc = { type, label: String(label || '').trim().slice(0, 40), enabled: true, connected: true, key: encrypt(key), models: [], model: '' };
  if (t.custom) acc.base = accountsLib.cleanBase(base);
  const id = accountsLib.newId(cfg.accounts, type);
  const p = accountsLib.providerFor(id, acc);
  const models = await callWithRetry((signal) => listModels(p, key, fetch, signal), { maxRetries: 1, timeoutMs: t.local ? 4000 : 20000 });
  acc.models = models;
  acc.model = pickDefaultModel(p, models);
  cfg.accounts[id] = acc;
  cfg.order.push(id);
  saveCfg();
  log(`[${p.name}] verbunden (${models.length} Modelle)`);
  return publicState();
});

ipcMain.handle('provider:disconnect', (_e, id) => {
  delete cfg.accounts[id];
  cfg.order = cfg.order.filter((x) => x !== id);
  saveCfg();
  return publicState();
});

ipcMain.handle('provider:update', (_e, id, patch) => {
  const s = cfg.accounts[id];
  if (!s) return publicState();
  if (typeof patch.model === 'string' && s.models.includes(patch.model)) s.model = patch.model;
  if (typeof patch.enabled === 'boolean') s.enabled = patch.enabled;
  if (typeof patch.label === 'string') s.label = patch.label.trim().slice(0, 40);
  if (patch.resetSpeed) delete s.ms;
  saveCfg();
  return publicState();
});

ipcMain.handle('order:set', (_e, order) => {
  if (Array.isArray(order) && order.length === cfg.order.length && order.every((id) => cfg.order.includes(id))) { cfg.order = order; saveCfg(); }
  return publicState();
});

ipcMain.handle('settings:set', (_e, patch) => {
  const s = cfg.settings;
  if (typeof patch.systemPrompt === 'string') s.systemPrompt = patch.systemPrompt.trim() || DEFAULT_SYSTEM;
  if (typeof patch.speak === 'boolean') s.speak = patch.speak;
  if (typeof patch.autoUpdate === 'boolean') s.autoUpdate = patch.autoUpdate;
  if (typeof patch.voice === 'string') s.voice = patch.voice.slice(0, 200);
  if (Number.isFinite(patch.rate)) s.rate = Math.min(2, Math.max(0.5, patch.rate));
  if (['low', 'mid', 'high'].includes(patch.wakeSens)) s.wakeSens = patch.wakeSens;
  if (typeof patch.wakeWord === 'boolean') s.wakeWord = patch.wakeWord;
  if ('wakeWord' in patch || 'wakeSens' in patch) wake?.set(s.wakeWord, s.wakeSens);
  if (typeof patch.race === 'boolean') s.race = patch.race;
  if (typeof patch.speedOrder === 'boolean') s.speedOrder = patch.speedOrder;
  if (Number.isFinite(patch.hedgeSec)) s.hedgeSec = Math.min(30, Math.max(0, Math.round(patch.hedgeSec)));
  if (Number.isFinite(patch.timeoutSec)) s.timeoutSec = Math.min(300, Math.max(10, patch.timeoutSec));
  if (patch.resetPrompt) s.systemPrompt = DEFAULT_SYSTEM;
  saveCfg();
  return publicState();
});

ipcMain.handle('local:detect', async () => {
  await Promise.all(PROVIDERS.filter((x) => x.local && !Object.values(cfg.accounts).some((a) => a.type === x.id)).map(async (p) => {
    try {
      const models = await callWithRetry((signal) => listModels(p, '', fetch, signal), { maxRetries: 0, timeoutMs: 2500 });
      cfg.accounts[p.id] = { type: p.id, label: '', connected: true, enabled: true, key: '', models, model: pickDefaultModel(p, models) };
      if (!cfg.order.includes(p.id)) cfg.order.push(p.id);
      log(`[${p.name}] automatisch gefunden`);
    } catch { /* läuft nicht */ }
  }));
  saveCfg();
  return publicState();
});

// Eine Antwort erzeugen (PC-Fenster und Handy-Zugang nutzen dieselbe Funktion).
// onStatus(payload) / onDelta(text) melden den Fortschritt; abortSignal bricht ab.
async function runChat(messages, { onStatus = () => {}, onDelta = () => {}, abortSignal = new AbortController().signal } = {}) {
  const clean = (messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-30);
  // "/befehl …" ruft ein Paket auf
  let invoked = null;
  const last = clean[clean.length - 1];
  const hit = last?.role === 'user' ? packsLib.matchCommand(last.content, packs.filter(packOn)) : null;
  if (hit) {
    invoked = hit.pack;
    last.content = hit.rest || `Ich möchte das Paket „${invoked.name}“ nutzen. Sag kurz, wobei du helfen kannst, und frag, womit wir anfangen.`;
    onStatus({ phase: 'pack', pack: invoked.name });
  }
  let system = buildSystem(invoked);
  if (cfg.mail.enabled && cfg.mail.pass && last?.role === 'user' && mailLib.asksForMail(last.content)) {
    onStatus({ phase: 'mail' });
    const unseenOnly = /ungelesen|neue\b/i.test(last.content) && !/alle/i.test(last.content);
    try {
      const mails = await mailLib.fetchRecent(mailCreds(), { days: cfg.mail.days, max: 12, unseenOnly });
      system += '\n\n' + mailLib.promptBlock(mails, { days: cfg.mail.days });
      log(`E-Mail: ${mails.length} Mails gelesen`);
    } catch (err) {
      system += '\n\n' + mailLib.promptBlock([], { error: String(err.message).slice(0, 200), days: cfg.mail.days });
      log(`E-Mail-Abruf fehlgeschlagen: ${String(err.message).slice(0, 120)}`);
    }
  }
  const t0 = Date.now();
  let firstAt = null;

  const chain = orderedChain().map((id) => {
    const p = P(id);
    const s = cfg.accounts[id];
    const tried = [];
    return {
      id,
      get label() { return `${p.name} · ${s.model}`; },
      run: (signal, beat, ctx) => {
        const both = AbortSignal.any([signal, abortSignal]);
        const startedAt = Date.now();
        let seen = false;
        onStatus({ phase: 'asking', provider: p.name, model: s.model });
        return chatStream(p, decrypt(s.key), s.model, clean, system, {
          signal: both, beat,
          onDelta: (text) => {
            if (!seen) { seen = true; recordSpeed(id, Date.now() - startedAt, true); }
            if (ctx && !ctx.claim()) return; // eine andere KI war schneller
            if (!firstAt) { firstAt = Date.now(); onStatus({ phase: 'streaming', provider: p.name, model: s.model, firstMs: firstAt - t0 }); }
            onDelta(text);
          },
        });
      },
      repair: async () => { tried.push(s.model); return refreshModels(id, { exclude: tried }); },
    };
  });
  const byId = (id) => P(id).name;

  try {
    const result = await runWithFallback(chain, {
      log, timeoutMs: cfg.settings.timeoutSec * 1000, maxRetries: 2,
      parallel: cfg.settings.race ? 2 : 1,
      hedgeMs: cfg.settings.hedgeSec * 1000,
      onSwitch: (step, failed) => onStatus({ phase: 'switch', provider: byId(step.id), failed: byId(failed.id) }),
      onLaunch: (step, reason) => { if (reason === 'slow') onStatus({ phase: 'slow', provider: byId(step.id) }); },
    });
    for (const f of result.failures) recordSpeed(f.id, f.ms, false);
    for (const l of result.losers) if (cfg.accounts[l.id] && l.ms >= 1000 && !(cfg.accounts[l.id].ms >= l.ms)) recordSpeed(l.id, l.ms, true); // abgebrochen: mindestens so langsam
    saveCfg();
    const mem = memory.apply(result.text);
    if (mem.saved.length || mem.forgotten.length) emit('jarvis:state', publicState());
    return { text: stripTags(result.text).trim(), memorySaved: mem.saved, memoryForgotten: mem.forgotten, pack: invoked?.name || null, by: result.used.label, providerId: result.used.id, fallbacks: result.failures, firstMs: firstAt ? firstAt - t0 : null, totalMs: Date.now() - t0 };
  } catch (err) {
    if (abortSignal.aborted) return { stopped: true };
    for (const f of err.failures || []) recordSpeed(f.id, f.ms, false);
    throw err;
  }
}

// Live-Antwort im Fenster: Stücke gehen per 'chat:delta' an das Fenster
const running = new Map();
ipcMain.handle('chat:send', async (_e, reqId, messages) => {
  const userAbort = new AbortController();
  running.set(reqId, userAbort);
  try {
    return await runChat(messages, {
      abortSignal: userAbort.signal,
      onStatus: (st) => emit('chat:status', { reqId, ...st }),
      onDelta: (text) => emit('chat:delta', { reqId, text }),
    });
  } finally {
    running.delete(reqId);
  }
});
ipcMain.handle('chat:stop', (_e, reqId) => { running.get(reqId)?.abort(); });

ipcMain.handle('stt:transcribe', async (_e, audio, mime) => {
  const candidates = activeChain().filter((id) => P(id).stt);
  if (!candidates.length) throw new Error('Für Spracheingabe bitte ChatGPT, Groq oder Gemini verbinden.');
  const chain = candidates.map((id) => {
    const p = P(id);
    const s = cfg.accounts[id];
    return { id, label: `${p.name} (Sprache)`, run: (signal) => transcribe(p, decrypt(s.key), s.model, Buffer.from(audio), mime, signal),
      repair: async () => refreshModels(id, { exclude: [s.model] }) };
  });
  const result = await runWithFallback(chain, { log, timeoutMs: 45000, maxRetries: 1 });
  return result.text;
});

ipcMain.handle('open:external', (_e, url) => {
  if (PROVIDERS.some((p) => p.keyUrl === url) || url === `https://github.com/${UPDATE_REPO}/releases`) shell.openExternal(url);
});

// ---------- E-Mail (nur lesen) ----------
const mailCreds = () => ({ host: cfg.mail.host, port: cfg.mail.port, user: cfg.mail.user, pass: decrypt(cfg.mail.pass) });
ipcMain.handle('mail:set', (_e, p = {}) => {
  const m = cfg.mail;
  if (typeof p.enabled === 'boolean') m.enabled = p.enabled;
  if (typeof p.preset === 'string') m.preset = p.preset.slice(0, 20);
  if (typeof p.host === 'string') m.host = p.host.trim().slice(0, 200);
  if (Number.isInteger(p.port) && p.port > 0 && p.port < 65536) m.port = p.port;
  if (typeof p.user === 'string') m.user = p.user.trim().slice(0, 200);
  if (typeof p.pass === 'string' && p.pass) m.pass = encrypt(p.pass);
  if (Number.isInteger(p.days)) m.days = Math.min(14, Math.max(1, p.days));
  if (p.clearPass) { m.pass = ''; m.enabled = false; }
  saveCfg();
  return publicState();
});
ipcMain.handle('mail:test', async () => {
  const list = await mailLib.fetchRecent(mailCreds(), { days: cfg.mail.days, max: 50, bodyChars: 50 });
  return { total: list.length, unseen: list.filter((x) => x.unseen).length };
});

// ---------- Handy-Zugang ----------
ipcMain.handle('remote:set', async (_e, patch = {}) => {
  if (typeof patch.enabled === 'boolean') cfg.remote.enabled = patch.enabled;
  if (Number.isInteger(patch.port) && patch.port >= 1024 && patch.port <= 65535) cfg.remote.port = patch.port;
  saveCfg();
  await remoteApply();
  return publicState();
});
ipcMain.handle('remote:code', async () => {
  if (!cfg.remote.enabled) throw new Error('Schalte den Handy-Zugang zuerst ein.');
  await remoteApply();
  if (!remote.status().running) throw new Error('Tailscale wurde nicht gefunden. Starte Tailscale am PC und versuche es nochmal.');
  return remote.newCode();
});
ipcMain.handle('remote:revoke', (_e, id) => {
  cfg.remote.devices = cfg.remote.devices.filter((d) => d.id !== id);
  saveCfg();
  return publicState();
});
ipcMain.handle('remote:recheck', async () => { await remoteApply(); return publicState(); });

// ---------- Chats ----------
ipcMain.handle('chats:all', () => chatStore.all());
ipcMain.handle('chats:save', (_e, chat) => { chatStore.upsert(chat); return true; });
ipcMain.handle('chats:delete', (_e, id) => { chatStore.remove(String(id)); return true; });

// ---------- Pakete ----------
ipcMain.handle('packs:toggle', (_e, id, on) => { cfg.packs ||= {}; cfg.packs[id] = !!on; saveCfg(); return publicState(); });
ipcMain.handle('packs:save', (_e, data) => {
  const text = packsLib.serializePack(data);
  const pack = packsLib.parsePack(text); // prüft alles
  const clash = packs.find((p) => !p.builtin && p.befehl === pack.befehl && p.id !== data.originalId);
  if (clash) throw new Error(`Der Befehl ${pack.befehl} ist schon vergeben (Paket „${clash.name}“).`);
  if (data.originalId && data.originalId !== pack.id) {
    const old = packs.find((p) => p.id === data.originalId && !p.builtin);
    if (old) fs.rmSync(old.source, { force: true });
  }
  fs.writeFileSync(path.join(userPackDir(), `${pack.id}.paket.md`), text);
  reloadPacks();
  log(`Paket „${pack.name}“ gespeichert`);
  return publicState();
});
ipcMain.handle('packs:import', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Paket hinzufügen', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Jarvis-Pakete', extensions: ['md'] }] });
  if (r.canceled) return { state: publicState(), added: [] };
  const added = [];
  for (const file of r.filePaths) {
    const pack = packsLib.parsePack(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(path.join(userPackDir(), `${pack.id}.paket.md`), fs.readFileSync(file, 'utf8'));
    added.push(pack.name);
  }
  reloadPacks();
  log(`Paket(e) hinzugefügt: ${added.join(', ')}`);
  return { state: publicState(), added };
});
ipcMain.handle('packs:delete', (_e, id) => {
  const p = packs.find((x) => x.id === id && !x.builtin);
  if (p) { fs.rmSync(p.source, { force: true }); log(`Paket „${p.name}“ entfernt`); }
  reloadPacks();
  return publicState();
});
ipcMain.handle('packs:folder', () => shell.openPath(userPackDir()));

// ---------- Gedächtnis ----------
ipcMain.handle('memory:add', (_e, text) => { memory.add(text, 'du'); return publicState(); });
ipcMain.handle('memory:remove', (_e, id) => { memory.remove(id); return publicState(); });
ipcMain.handle('memory:clear', () => { memory.clear(); log('Gedächtnis gelöscht'); return publicState(); });

// ---------- Updates ----------
let pendingUpdate = null;
async function checkUpdate(manual = false) {
  try {
    const r = await updater.checkForUpdate({ repo: UPDATE_REPO, currentVersion: CODE_VERSION, shellVersion: BOOT.shellVersion });
    if (r.available) { pendingUpdate = r; log(`Update ${r.version} verfügbar`); }
    emit('update:status', r);
    return r;
  } catch (err) {
    if (manual) throw err;
    return { available: false, reason: err.message };
  }
}
ipcMain.handle('update:check', () => checkUpdate(true));
ipcMain.handle('update:install', async () => {
  if (!pendingUpdate) throw new Error('Kein Update verfügbar.');
  await updater.downloadUpdate({ url: pendingUpdate.url, expectedVersion: pendingUpdate.version, appDir: BOOT.appDir, shellVersion: BOOT.shellVersion });
  log(`Update ${pendingUpdate.version} installiert – starte neu`);
  setTimeout(() => { app.relaunch(); app.exit(0); }, 600);
  return true;
});

// ---------- Fenster ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 800, minWidth: 460, minHeight: 560,
    backgroundColor: '#02060b', title: 'Jarvis', autoHideMenuBar: true,
    ...(fs.existsSync(path.join(__dirname, '..', 'assets', 'icon.png')) ? { icon: path.join(__dirname, '..', 'assets', 'icon.png') } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.once('did-finish-load', () => {
    BOOT.markHealthy();
    // im Hintergrund: Modelllisten auffrischen und nach Updates schauen
    setTimeout(async () => {
      for (const id of activeChain()) if (!P(id).local) refreshModels(id).catch(() => {});
      if (cfg.settings.autoUpdate) checkUpdate(false);
      if (cfg.settings.wakeWord) wake.set(true, cfg.settings.wakeSens);
      remoteApply().catch(() => {});
      setInterval(() => { if (cfg.remote.enabled && !remote.status().running) remoteApply().catch(() => {}); }, 30000); // Tailscale später gestartet?
    }, 1500);
  });
}

app.whenReady().then(() => {
  cfg = normalize(loadCfg());
  saveCfg();
  chatStore = new ChatStore(path.join(app.getPath('userData'), 'chats.json'));
  remote = new RemoteServer({
    store: chatStore, log,
    answer: (messages, opts) => runChat(messages, opts),
    devices: { get: () => cfg.remote.devices, save: (list) => { cfg.remote.devices = list; saveCfg(); } },
    onChat: (chat) => emit('chats:remote', chat),
  });
  memory = new Memory(path.join(app.getPath('userData'), 'gedaechtnis.json'));
  wake = new WakeWord({
    dir: app.getPath('userData'), log,
    onStatus: (st) => emit('wake:event', { type: 'status', ...st }),
    onHit: (hit) => emit('wake:event', { type: 'hit', ...hit }),
  });
  reloadPacks();
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  createWindow();
  log(`Jarvis ${CODE_VERSION} gestartet`);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { wake?.stop(); remote?.stop(); app.quit(); });
app.on('before-quit', () => { wake?.stop(); remote?.stop(); });
