const { app, BrowserWindow, ipcMain, safeStorage, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { runWithFallback, callWithRetry } = require('./router');
const { PROVIDERS, getProvider, listModels, chatStream, transcribe, pickDefaultModel } = require('./providers');
const { CODE_VERSION, UPDATE_REPO } = require('./version');
const updater = require('./updater');
const packsLib = require('./packs');
const { Memory, stripTags } = require('./memory');

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
  c.providers ||= {};
  c.order ||= [];
  for (const p of PROVIDERS) if (!c.order.includes(p.id)) c.order.push(p.id);
  c.order = c.order.filter((id) => PROVIDERS.some((p) => p.id === id));
  c.settings = { systemPrompt: DEFAULT_SYSTEM, speak: true, timeoutSec: 60, autoUpdate: true, ...(c.settings || {}) };
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
    settings: cfg.settings,
    providers: cfg.order.map((id) => {
      const p = getProvider(id);
      const s = cfg.providers[id] || {};
      return {
        id, name: p.name, desc: p.desc, local: !!p.local, keyUrl: p.keyUrl, stt: !!p.stt,
        connected: !!s.connected, enabled: s.enabled !== false, model: s.model || '', models: s.models || [],
      };
    }),
  };
}
const activeChain = () => cfg.order.filter((id) => cfg.providers[id]?.connected && cfg.providers[id]?.enabled !== false);

// Modellliste neu holen; ist das gewählte Modell weg (oder kaputt), automatisch das beste aktuelle nehmen
async function refreshModels(id, { exclude = [] } = {}) {
  const p = getProvider(id);
  const s = cfg.providers[id];
  if (!s?.connected) return false;
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

ipcMain.handle('provider:connect', async (_e, id, key) => {
  const p = getProvider(id);
  key = (key || '').trim();
  if (!p.local && !key) throw new Error('Bitte einen API-Schlüssel eingeben.');
  const models = await callWithRetry((signal) => listModels(p, key, fetch, signal), { maxRetries: 1, timeoutMs: p.local ? 4000 : 20000 });
  const prev = cfg.providers[id] || {};
  cfg.providers[id] = { ...prev, connected: true, enabled: true, key: encrypt(key), models,
    model: models.includes(prev.model) ? prev.model : pickDefaultModel(p, models) };
  saveCfg();
  log(`[${p.name}] verbunden (${models.length} Modelle)`);
  return publicState();
});

ipcMain.handle('provider:disconnect', (_e, id) => { delete cfg.providers[id]; saveCfg(); return publicState(); });

ipcMain.handle('provider:update', (_e, id, patch) => {
  const s = cfg.providers[id];
  if (!s) return publicState();
  if (typeof patch.model === 'string' && s.models.includes(patch.model)) s.model = patch.model;
  if (typeof patch.enabled === 'boolean') s.enabled = patch.enabled;
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
  if (Number.isFinite(patch.timeoutSec)) s.timeoutSec = Math.min(300, Math.max(10, patch.timeoutSec));
  if (patch.resetPrompt) s.systemPrompt = DEFAULT_SYSTEM;
  saveCfg();
  return publicState();
});

ipcMain.handle('local:detect', async () => {
  await Promise.all(PROVIDERS.filter((x) => x.local && !cfg.providers[x.id]?.connected).map(async (p) => {
    try {
      const models = await callWithRetry((signal) => listModels(p, '', fetch, signal), { maxRetries: 0, timeoutMs: 2500 });
      cfg.providers[p.id] = { connected: true, enabled: true, key: '', models, model: pickDefaultModel(p, models) };
      log(`[${p.name}] automatisch gefunden`);
    } catch { /* läuft nicht */ }
  }));
  saveCfg();
  return publicState();
});

// Live-Antwort: Stücke gehen per 'chat:delta' an das Fenster
const running = new Map();
ipcMain.handle('chat:send', async (_e, reqId, messages) => {
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
    emit('chat:status', { reqId, phase: 'pack', pack: invoked.name });
  }
  const system = buildSystem(invoked);
  const t0 = Date.now();
  let firstAt = null;
  const userAbort = new AbortController();
  running.set(reqId, userAbort);

  const chain = activeChain().map((id) => {
    const p = getProvider(id);
    const s = cfg.providers[id];
    const tried = [];
    return {
      id,
      get label() { return `${p.name} · ${s.model}`; },
      run: (signal, beat) => {
        const both = AbortSignal.any([signal, userAbort.signal]);
        emit('chat:status', { reqId, phase: 'asking', provider: p.name, model: s.model });
        return chatStream(p, decrypt(s.key), s.model, clean, system, {
          signal: both, beat,
          onDelta: (text) => {
            if (!firstAt) { firstAt = Date.now(); emit('chat:status', { reqId, phase: 'streaming', provider: p.name, model: s.model, firstMs: firstAt - t0 }); }
            emit('chat:delta', { reqId, text });
          },
        });
      },
      repair: async () => { tried.push(s.model); return refreshModels(id, { exclude: tried }); },
    };
  });

  try {
    const result = await runWithFallback(chain, {
      log, timeoutMs: cfg.settings.timeoutSec * 1000, maxRetries: 2,
      onSwitch: (step, failed) => emit('chat:status', { reqId, phase: 'switch', provider: step.label.split(' · ')[0], failed: failed.label.split(' · ')[0] }),
    });
    const mem = memory.apply(result.text);
    if (mem.saved.length || mem.forgotten.length) emit('jarvis:state', publicState());
    return { text: stripTags(result.text).trim(), memorySaved: mem.saved, memoryForgotten: mem.forgotten, pack: invoked?.name || null, by: result.used.label, providerId: result.used.id, fallbacks: result.failures, firstMs: firstAt ? firstAt - t0 : null, totalMs: Date.now() - t0 };
  } catch (err) {
    if (userAbort.signal.aborted) return { stopped: true };
    throw err;
  } finally {
    running.delete(reqId);
  }
});
ipcMain.handle('chat:stop', (_e, reqId) => { running.get(reqId)?.abort(); });

ipcMain.handle('stt:transcribe', async (_e, audio, mime) => {
  const candidates = activeChain().filter((id) => getProvider(id).stt);
  if (!candidates.length) throw new Error('Für Spracheingabe bitte ChatGPT, Groq oder Gemini verbinden.');
  const chain = candidates.map((id) => {
    const p = getProvider(id);
    const s = cfg.providers[id];
    return { id, label: `${p.name} (Sprache)`, run: (signal) => transcribe(p, decrypt(s.key), s.model, Buffer.from(audio), mime, signal),
      repair: async () => refreshModels(id, { exclude: [s.model] }) };
  });
  const result = await runWithFallback(chain, { log, timeoutMs: 45000, maxRetries: 1 });
  return result.text;
});

ipcMain.handle('open:external', (_e, url) => {
  if (PROVIDERS.some((p) => p.keyUrl === url) || url === `https://github.com/${UPDATE_REPO}/releases`) shell.openExternal(url);
});

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
      for (const id of activeChain()) if (!getProvider(id).local) refreshModels(id).catch(() => {});
      if (cfg.settings.autoUpdate) checkUpdate(false);
    }, 1500);
  });
}

app.whenReady().then(() => {
  cfg = normalize(loadCfg());
  saveCfg();
  memory = new Memory(path.join(app.getPath('userData'), 'gedaechtnis.json'));
  reloadPacks();
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  createWindow();
  log(`Jarvis ${CODE_VERSION} gestartet`);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
