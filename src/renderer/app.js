/* global jarvis, HUD, JarvisSpeech, JarvisRender */
const $ = (id) => document.getElementById(id);
const els = {
  chatList: $('chatList'), sidePacks: $('sidePacks'), statusEl: $('status'), statusText: $('statusText'), welcome: $('welcome'), welcomeHint: $('welcomeHint'), welcomeConnect: $('welcomeConnect'),
  messages: $('messages'), chat: $('chat'), input: $('input'), send: $('send'), mic: $('mic'),
  speakToggle: $('speakToggle'), newChat: $('newChat'), settings: $('settings'), scrim: $('scrim'), providerList: $('providerList'),
  systemPrompt: $('systemPrompt'), log: $('log'), toast: $('toast'), roLink: $('roLink'), roSpeed: $('roSpeed'), roCount: $('roCount'),
  roClock: $('roClock'), roMemory: $('roMemory'), suggest: $('suggest'), packList: $('packList'), memList: $('memList'), version: $('version'), updateBanner: $('updateBanner'), updateVersion: $('updateVersion'), updateInstall: $('updateInstall'),
  updateInfo: $('updateInfo'), checkUpdate: $('checkUpdate'), autoUpdate: $('autoUpdate'), roWake: $('roWake'), wakeStatus: $('wakeStatus'),
};

const hud = HUD.create($('core'));
let state = null;
let chats = [];            // alle Chats (nur Chats mit Nachrichten werden gespeichert)
let activeId = null;
const runs = new Map();    // chatId -> laufende Anfrage (mehrere Chats können gleichzeitig arbeiten)
const activeChat = () => chats.find((c) => c.id === activeId);
const activeRun = () => runs.get(activeId);

// ---------- Hilfen ----------
const { render: renderMarkdown, esc: escapeHtml } = JarvisRender;
function applyBars(root) { root.querySelectorAll('[data-w]').forEach((i) => { i.style.width = `${i.dataset.w}%`; }); }
function toast(text, ms = 3200) {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => els.toast.classList.remove('show'), ms);
}
const MODE_LABEL = { idle: 'BEREIT', thinking: 'VERARBEITE', listening: 'HÖRE ZU', speaking: 'SPRECHE', error: 'FEHLER' };
function setMode(mode, label) {
  hud.setMode(mode, label || MODE_LABEL[mode]);
  els.statusEl.className = `status ${mode}`;
  els.statusText.textContent = label || MODE_LABEL[mode];
}
function settle() {
  if (runs.size) setMode('thinking');
  else if (recording) setMode('listening');
  else if (speaker.speaking) setMode('speaking');
  else setMode('idle');
}
function connectedCount() { return state.providers.filter((p) => p.connected && p.enabled).length; }
function primary() { return state.providers.find((p) => p.connected && p.enabled); }
function updateReadouts() {
  const p = primary();
  els.roLink.textContent = p ? `${p.name.split(' (')[0]} · ${p.model}` : 'Keine KI verbunden';
  els.roLink.title = els.roLink.textContent;
  els.roCount.textContent = String(connectedCount()).padStart(2, '0');
  const n = state.memory?.length || 0;
  els.roMemory.textContent = n === 1 ? '1 Eintrag' : `${n} Einträge`;
  $('sideMemCount').textContent = String(n);
  els.version.textContent = `v${state.version}`;
  els.updateInfo.textContent = `Installiert: Version ${state.version}`;
  els.autoUpdate.checked = state.settings.autoUpdate !== false;
}
function updateWelcome() {
  const none = connectedCount() === 0;
  els.welcomeConnect.classList.toggle('hidden', !none);
  els.welcomeHint.textContent = none
    ? 'Verbinde zuerst mindestens eine KI in den Einstellungen.'
    : (state.settings.wakeWord ? 'Sag „Hey Jarvis“, schreib eine Nachricht oder tipp / für Pakete.' : 'Schreib eine Nachricht, halte die Leertaste zum Sprechen oder tipp / für Pakete.');
  const empty = !(activeChat()?.messages.length) && !activeRun();
  els.welcome.classList.toggle('hidden', !empty);
  document.body.classList.toggle('chatting', !empty);
}
const activePacks = () => (state.packs || []).filter((p) => p.enabled && !p.error);
setInterval(() => { els.roClock.textContent = new Date().toLocaleTimeString('de-DE'); }, 1000);

// ---------- Vorlesen ----------
const speaker = new JarvisSpeech.Speaker({
  voice: () => state?.settings?.voice || '',
  rate: () => state?.settings?.rate || 1.1,
  onStart: () => settle(),
  onEnd: () => settle(),
  onWord: () => hud.bump(0.55 + Math.random() * 0.35),
});
function stopSpeaking() { speaker.stop(); settle(); }

// ---------- Chat ----------
function makeBubble(role, text = '') {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (role === 'error') { div.textContent = text; }
  else {
    div.innerHTML = `<span class="who">${role === 'user' ? 'DU' : 'JARVIS'}</span><div class="steps"></div><div class="body"></div>`;
    div.querySelector('.body').innerHTML = role === 'assistant' ? renderMarkdown(text) : escapeHtml(text).replace(/\n/g, '<br>');
    applyBars(div);
  }
  els.messages.appendChild(div);
  scrollDown(true);
  return div;
}
function scrollDown(force) {
  const nearBottom = els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight < 140;
  if (force || nearBottom) els.chat.scrollTop = els.chat.scrollHeight;
}
function addStep(bubble, text, warn = false) {
  const s = document.createElement('div');
  if (warn) s.className = 'warn';
  s.textContent = `› ${text}`;
  bubble.querySelector('.steps').appendChild(s);
  scrollDown();
}
function addMeta(bubble, text, res) {
  const m = document.createElement('div');
  m.className = 'meta';
  if (res?.by) {
    const by = document.createElement('span');
    by.textContent = res.by;
    m.appendChild(by);
  }
  if (res?.totalMs && res.firstMs != null) {
    const t = document.createElement('span');
    t.textContent = `${(res.firstMs / 1000).toFixed(1)} s bis zum ersten Wort`;
    m.appendChild(t);
  }
  if (res?.fallbacks?.length) {
    const fb = document.createElement('span');
    fb.className = 'fb';
    fb.textContent = `↪ übernommen (${res.fallbacks.map((f) => f.label.split(' · ')[0]).join(', ')} ausgefallen)`;
    fb.title = res.fallbacks.map((f) => `${f.label}: ${f.error}`).join('\n');
    m.appendChild(fb);
  }
  const copy = document.createElement('button');
  copy.textContent = 'Kopieren';
  copy.onclick = () => { navigator.clipboard.writeText(text); toast('Kopiert'); };
  const read = document.createElement('button');
  read.textContent = 'Vorlesen';
  read.onclick = () => speaker.sayAll(text);
  m.append(copy, read);
  bubble.appendChild(m);
}

// ---- Chats verwalten ----
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const titleFrom = (text) => { const t = text.replace(/^\/[\wäöüß-]+\s*/i, '').replace(/\s+/g, ' ').trim() || text.trim(); return t.length > 42 ? `${t.slice(0, 40)}…` : t; };
function sortChats() { chats.sort((a, b) => (b.updated || 0) - (a.updated || 0)); }
function persist(chat) {
  if (!chat.messages.length) return;
  jarvis.saveChat({ id: chat.id, title: chat.title, created: chat.created, updated: chat.updated, messages: chat.messages }).catch(() => {});
}
function openNewChat() {
  const cur = activeChat();
  if (cur && !cur.messages.length && !runs.has(cur.id)) { els.input.focus(); return cur; }
  const c = { id: newId(), title: 'Neuer Chat', created: Date.now(), updated: Date.now(), messages: [] };
  chats.unshift(c);
  switchChat(c.id);
  return c;
}
function switchChat(id) {
  if (id === activeId || !chats.some((c) => c.id === id)) return;
  const prev = activeChat();
  stopSpeaking();
  activeId = id;
  if (prev && !prev.messages.length && !runs.has(prev.id)) chats = chats.filter((c) => c !== prev);
  const c = activeChat();
  c.unread = false;
  renderMessages(c);
  renderChatList(); updateWelcome(); updateSendButton(); settle();
  els.input.focus();
}
function renderMessages(chat) {
  els.messages.innerHTML = '';
  for (const m of chat.messages) {
    const b = makeBubble(m.role, m.content);
    if (m.role === 'assistant') addMeta(b, m.content, { by: m.by });
  }
  const run = runs.get(chat.id);
  if (run) {
    run.bubble = makeBubble('assistant');
    run.body = run.bubble.querySelector('.body');
    paint(run);
  }
  scrollDown(true);
}
function deleteChat(id) {
  const run = runs.get(id);
  if (run) jarvis.stop(run.reqId);
  chats = chats.filter((c) => c.id !== id);
  jarvis.deleteChat(id).catch(() => {});
  if (activeId === id) {
    activeId = null;
    const next = chats[0];
    if (next) switchChat(next.id); else { const c = { id: newId(), title: 'Neuer Chat', created: Date.now(), updated: Date.now(), messages: [] }; chats.unshift(c); activeId = c.id; els.messages.innerHTML = ''; }
  }
  renderChatList(); updateWelcome(); updateSendButton(); settle();
}
function dayLabel(ts) {
  const d = new Date(ts); const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  if (diff < 7) return 'Diese Woche';
  if (diff < 31) return 'Dieser Monat';
  return 'Älter';
}
let chatQuery = '';
// Treffer in Titel oder Nachrichten; liefert einen kurzen Textausschnitt
function searchHit(c, q) {
  if (c.title.toLowerCase().includes(q)) return { snippet: '' };
  for (const m of c.messages) {
    const i = m.content.toLowerCase().indexOf(q);
    if (i !== -1) {
      const from = Math.max(0, i - 24);
      const text = m.content.slice(from, i + q.length + 40).replace(/\s+/g, ' ');
      return { snippet: `${from > 0 ? '…' : ''}${text}…` };
    }
  }
  return null;
}
function renderChatList() {
  const box = els.chatList;
  box.innerHTML = '';
  sortChats();
  const q = chatQuery.trim().toLowerCase();
  let lastGroup = '';
  let shown = 0;
  for (const c of chats) {
    let hit = null;
    if (q) { hit = searchHit(c, q); if (!hit) continue; }
    shown++;
    const group = q ? 'Treffer' : (c.messages.length ? dayLabel(c.updated) : 'Jetzt');
    if (group !== lastGroup) { const g = document.createElement('div'); g.className = 'chat-group'; g.textContent = group; box.appendChild(g); lastGroup = group; }
    const row = document.createElement('div');
    row.className = `chat-item${c.id === activeId ? ' on' : ''}`;
    row.title = c.title;
    const running = runs.has(c.id);
    row.innerHTML = `<span class="t">${escapeHtml(c.title)}</span>${running ? '<i class="dot run" title="Antwortet gerade"></i>' : (c.unread ? '<i class="dot" title="Neue Antwort"></i>' : '')}<button class="x" title="Chat löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${hit?.snippet ? `<span class="sn">${escapeHtml(hit.snippet)}</span>` : ''}`;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.x')) { if (!c.messages.length || confirm(`Chat „${c.title}“ löschen?`)) deleteChat(c.id); return; }
      if (e.target.tagName === 'INPUT') return;
      switchChat(c.id);
    });
    row.addEventListener('dblclick', (e) => {
      if (e.target.closest('.x') || !c.messages.length) return;
      const t = row.querySelector('.t');
      const inp = document.createElement('input');
      inp.type = 'text'; inp.value = c.title; inp.maxLength = 80;
      t.replaceWith(inp); inp.focus(); inp.select();
      const done = (save) => { if (save && inp.value.trim()) { c.title = inp.value.trim(); persist(c); } renderChatList(); };
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => done(true));
    });
    box.appendChild(row);
  }
  if (q && !shown) box.innerHTML = `<p class="muted" style="padding:8px">Nichts gefunden für „${escapeHtml(chatQuery.trim())}“.</p>`;
}
function renderSidePacks() {
  els.sidePacks.innerHTML = activePacks().map((p) => `<button class="side-pack" data-cmd="${escapeHtml(p.befehl)}" title="${escapeHtml(p.beschreibung)}"><span class="sym">${escapeHtml(p.symbol || '◇')}</span>${escapeHtml(p.name)}<code>${escapeHtml(p.befehl)}</code></button>`).join('')
    || '<p class="muted" style="padding:4px 8px;font-size:12px">Keine Pakete aktiv.</p>';
}
function updateSendButton() {
  const busy = runs.has(activeId);
  els.send.classList.toggle('stop', busy);
  els.send.title = busy ? 'Stoppen' : 'Senden';
}

const isShown = (run) => run.chatId === activeId && run.body?.isConnected;
const runByReq = (reqId) => [...runs.values()].find((r) => r.reqId === reqId);

async function sendMessage(text) {
  text = (text ?? els.input.value).trim();
  if (!text) return;
  const chat = activeChat() || openNewChat();
  if (runs.has(chat.id)) return;
  if (connectedCount() === 0) { openSettings(); toast('Verbinde zuerst eine KI.'); return; }
  stopSpeaking();
  els.input.value = '';
  autoGrow();
  chat.messages.push({ role: 'user', content: text });
  if (chat.messages.length === 1) chat.title = titleFrom(text);
  chat.updated = Date.now();
  persist(chat);
  makeBubble('user', text);

  const reqId = `r${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
  const bubble = makeBubble('assistant');
  const body = bubble.querySelector('.body');
  body.innerHTML = '<span class="cursor"></span>';
  const run = { reqId, chatId: chat.id, bubble, body, text: '', raf: 0 };
  runs.set(chat.id, run);
  updateWelcome(); renderChatList(); updateSendButton();
  setMode('thinking');

  try {
    const res = await jarvis.send(reqId, chat.messages.map(({ role, content }) => ({ role, content })));
    if (res.stopped) throw Object.assign(new Error('gestoppt'), { stopped: true });
    run.text = res.text;
    chat.messages.push({ role: 'assistant', content: res.text, by: res.by });
    chat.updated = Date.now();
    persist(chat);
    if (isShown(run)) {
      paint(run, true);
      addMeta(run.bubble, res.text, res);
      for (const m of res.memorySaved || []) addStep(run.bubble, `Gemerkt: ${m.text}`);
      for (const m of res.memoryForgotten || []) addStep(run.bubble, `Vergessen: ${m.text}`);
      if (state.settings.speak) speaker.finish();
    } else if (chat.id !== activeId) { chat.unread = true; toast(`Antwort fertig: ${chat.title}`); }
    if (res.memorySaved?.length || res.memoryForgotten?.length) { state = await jarvis.getState(); updateReadouts(); }
    if (res.firstMs != null) els.roSpeed.textContent = `${(res.firstMs / 1000).toFixed(2)} s`;
  } catch (err) {
    const partial = run.text;
    if (partial) {
      // abgebrochen, aber schon Text da: behalten
      chat.messages.push({ role: 'assistant', content: partial });
      chat.updated = Date.now();
      persist(chat);
      if (isShown(run)) {
        paint(run, true);
        addStep(run.bubble, err.stopped ? 'Gestoppt.' : `Abgebrochen: ${err.message}`, true);
        if (state.settings.speak && !err.stopped) speaker.finish();
      }
    } else {
      if (isShown(run)) run.bubble.remove();
      const last = chat.messages[chat.messages.length - 1];
      if (last?.role === 'user') chat.messages.pop();
      persist(chat);
      if (!err.stopped) {
        if (isShown(run)) { makeBubble('error', err.message); setMode('error'); setTimeout(settle, 1500); }
        else toast(`Chat „${chat.title}“: ${err.message}`, 6000);
      }
    }
  } finally {
    cancelAnimationFrame(run.raf);
    runs.delete(chat.id);
    updateWelcome(); renderChatList(); updateSendButton();
    settle();
    if (chat.id === activeId) els.input.focus();
  }
}

function paint(run, final = false) {
  run.raf = 0;
  if (!isShown(run)) return;
  run.body.innerHTML = renderMarkdown(run.text, !final) + (final ? '' : '<span class="cursor"></span>');
  applyBars(run.body);
  scrollDown();
}
jarvis.onDelta(({ reqId, text }) => {
  const run = runByReq(reqId);
  if (!run) return;
  run.text += text;
  if (!isShown(run)) return;
  if (state.settings.speak) speaker.feed(text);
  if (!run.raf) run.raf = requestAnimationFrame(() => paint(run, false));
});
jarvis.onStatus((s) => {
  const run = runByReq(s.reqId);
  if (!run) return;
  const shown = isShown(run);
  const short = (n) => String(n).split(' (')[0];
  if (s.phase === 'streaming') els.roSpeed.textContent = `${(s.firstMs / 1000).toFixed(2)} s`;
  if (!shown) return;
  if (s.phase === 'asking') addStep(run.bubble, `Frage ${short(s.provider)} (${s.model}) …`);
  if (s.phase === 'slow') addStep(run.bubble, `Noch keine Antwort – frage zusätzlich ${short(s.provider)}`, true);
  if (s.phase === 'switch') addStep(run.bubble, `${short(s.failed)} ausgefallen – wechsle zu ${short(s.provider)}`, true);
  if (s.phase === 'pack') addStep(run.bubble, `Paket „${s.pack}“ aktiv`);
  if (s.phase === 'mail') addStep(run.bubble, 'Lese deine E-Mails (nur lesen) …');
  if (s.phase === 'streaming') run.bubble.querySelectorAll('.steps > div').forEach((d) => { if (!/^› (Paket|Lese deine)/.test(d.textContent)) d.remove(); });
});

function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 180) + 'px';
}

// ---------- Spracheingabe ----------
let recorder = null; let recording = false; let chunks = []; let micStream = null; let audioCtx = null; let meterRaf = 0;

// auto = durch "Hey Jarvis" gestartet: stoppt selbst, wenn du fertig gesprochen hast
async function startRecording({ auto = false } = {}) {
  if (recording || runs.has(activeId)) return;
  if (!state.providers.some((p) => p.stt && p.connected && p.enabled)) {
    toast('Für Spracheingabe bitte ChatGPT, Groq oder Gemini verbinden.', 4500);
    return;
  }
  stopSpeaking();
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    toast('Kein Zugriff aufs Mikrofon. Prüfe die Windows-Datenschutzeinstellungen.', 5000);
    return;
  }
  chunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  recorder = new MediaRecorder(micStream, { mimeType: mime });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = onRecordingDone;
  recorder.start();
  recorder.startedAt = Date.now();
  recording = true;
  els.mic.classList.add('rec');
  setMode('listening');
  // Mikrofon-Pegel an den Kern
  try {
    audioCtx = new AudioContext();
    const an = audioCtx.createAnalyser();
    an.fftSize = 512;
    audioCtx.createMediaStreamSource(micStream).connect(an);
    const data = new Uint8Array(an.fftSize);
    let heard = false; let lastLoud = Date.now();
    const tick = () => {
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      const lvl = Math.min(1, Math.sqrt(sum / data.length) * 4);
      hud.setLevel(lvl);
      if (auto && recording) {
        const now = Date.now();
        if (lvl > 0.12) { heard = true; lastLoud = now; }
        if (heard && now - lastLoud > 1300) { stopRecording(); return; }          // fertig gesprochen
        if (!heard && now - recorder.startedAt > 6000) { recorder.cancelled = true; stopRecording(); return; } // nichts gesagt
        if (now - recorder.startedAt > 20000) { stopRecording(); return; }       // Sicherheitsgrenze
      }
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch { /* Pegel ist nur Deko */ }
}
function stopRecording() {
  if (!recording) return;
  recording = false;
  els.mic.classList.remove('rec');
  cancelAnimationFrame(meterRaf);
  hud.setLevel(0);
  audioCtx?.close().catch(() => {});
  recorder.stop();
  micStream.getTracks().forEach((t) => t.stop());
}
async function onRecordingDone() {
  if (recorder.cancelled) { settle(); toast('Ich habe nichts gehört.'); return; }
  if (Date.now() - recorder.startedAt < 400 || !chunks.length) { settle(); return; }
  setMode('thinking', 'VERSTEHE');
  try {
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const text = await jarvis.transcribe(await blob.arrayBuffer(), 'audio/webm');
    settle();
    if (!text) { toast('Ich habe nichts verstanden.'); return; }
    sendMessage(text);
  } catch (err) {
    settle();
    toast(err.message, 6000);
  }
}

// Klicken = an/aus, gedrückt halten = Push-to-Talk
let pressStart = 0;
els.mic.addEventListener('pointerdown', () => {
  pressStart = Date.now();
  if (recording) stopRecording(); else startRecording();
});
els.mic.addEventListener('pointerup', () => { if (recording && Date.now() - pressStart > 450) stopRecording(); });

let spaceDown = false;
window.addEventListener('keydown', (e) => {
  const typing = ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName);
  if (e.code === 'Space' && !spaceDown && !typing && !els.settings.classList.contains('open')) {
    e.preventDefault(); spaceDown = true; startRecording();
  }
  if (e.key === 'Escape') {
    if (els.settings.classList.contains('open')) closeSettings();
    else if (activeRun()) jarvis.stop(activeRun().reqId);
    else stopSpeaking();
  }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space' && spaceDown) { spaceDown = false; stopRecording(); } });

// ---------- Einstellungen ----------
function showTab(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
}
function openSettings(tab = 'kis') {
  if (typeof tab !== 'string') tab = 'kis';
  showTab(tab);
  els.settings.classList.add('open');
  els.scrim.classList.add('open');
  els.settings.setAttribute('aria-hidden', 'false');
  els.systemPrompt.value = state.settings.systemPrompt;
  jarvis.getState().then((st) => { if (els.settings.classList.contains('open') && !document.activeElement?.closest?.('#addForm')) { state = st; renderAll(); } }).catch(() => {});
}
function closeSettings() {
  els.settings.classList.remove('open');
  els.scrim.classList.remove('open');
  els.settings.setAttribute('aria-hidden', 'true');
}
const icon = {
  up: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
};

let addType = null; // Anbieter, für den gerade das Formular offen ist
const fmtMs = (ms) => (ms == null ? 'noch nicht gemessen' : `Ø ${(ms / 1000).toFixed(1).replace('.', ',')} s`);

function renderProviders() {
  els.providerList.innerHTML = '';
  if (!state.providers.length) els.providerList.innerHTML = '<p class="muted">Noch keine KI verbunden. Wähle unten einen Anbieter.</p>';
  state.providers.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = `prov${p.enabled ? ' on' : ''}`;
    card.innerHTML = `
      <div class="prov-top">
        <div class="prov-order">
          <button data-act="up" title="Nach oben" ${i === 0 ? 'disabled' : ''}>${icon.up}</button>
          <button data-act="down" title="Nach unten" ${i === state.providers.length - 1 ? 'disabled' : ''}>${icon.down}</button>
        </div>
        <div class="prov-name"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.desc)}</small></div>
        <span class="speed" title="So schnell kam bisher das erste Wort">${fmtMs(p.ms)}</span>
        <span class="badge ${p.enabled ? 'ok' : ''}">${p.enabled ? 'Aktiv' : 'Pausiert'}</span>
      </div>
      <div class="prov-body">
        <div class="row">
          <select title="Modell">${p.models.map((m) => `<option ${m === p.model ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}</select>
          <label class="switch" title="Aktiv"><input type="checkbox" ${p.enabled ? 'checked' : ''}><span></span></label>
        </div>
        <div class="row end"><button class="danger" data-act="disconnect">Trennen</button></div>
      </div>`;
    const body = card.querySelector('.prov-body');
    body.querySelector('select').onchange = async (e) => { state = await jarvis.updateProvider(p.id, { model: e.target.value }); updateReadouts(); toast(`${p.name}: ${e.target.value}`); };
    body.querySelector('input[type=checkbox]').onchange = async (e) => { state = await jarvis.updateProvider(p.id, { enabled: e.target.checked }); renderAll(); };
    card.addEventListener('click', async (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      const order = state.providers.map((x) => x.id);
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        [order[i], order[j]] = [order[j], order[i]];
        state = await jarvis.setOrder(order);
        renderAll();
      } else if (act === 'disconnect' && confirm(`${p.name} wirklich trennen?`)) { state = await jarvis.disconnect(p.id); renderAll(); }
    });
    els.providerList.appendChild(card);
  });
  renderCatalog();
  renderTempo();
}

function renderCatalog() {
  const box = $('catalog');
  box.innerHTML = (state.catalog || []).map((t) => `<button data-type="${t.type}" class="${addType === t.type ? 'on' : ''}" title="${escapeHtml(t.desc)}">+ ${escapeHtml(t.name)}</button>`).join('');
  const form = $('addForm');
  const t = (state.catalog || []).find((x) => x.type === addType);
  form.classList.toggle('hidden', !t);
  if ((t?.type || '') === (form.dataset.type || '')) return; // Formular nicht neu bauen, solange du tippst
  form.dataset.type = t?.type || '';
  if (!t) { form.innerHTML = ''; return; }
  form.innerHTML = `<b>${escapeHtml(t.name)} hinzufügen</b><p class="muted flush">${escapeHtml(t.desc)}</p>
    ${t.custom ? '<div class="row"><input type="text" id="afLabel" placeholder="Name (z. B. Mein Server)" maxlength="40"></div><div class="row"><input type="text" id="afBase" placeholder="Adresse, z. B. https://api.beispiel.de/v1" spellcheck="false"></div>' : ''}
    ${t.local ? `<p class="muted flush">Starte ${escapeHtml(t.name.replace(' (lokal)', ''))} auf deinem PC und lade mindestens ein Modell.</p>`
      : `<div class="row"><input type="password" id="afKey" placeholder="API-Schlüssel einfügen${t.keyOptional ? ' (optional)' : ''}" autocomplete="off" spellcheck="false"></div>`}
    <div class="row end"><button class="link" data-act="key">${t.local ? 'Herunterladen' : 'Schlüssel holen →'}</button><button class="ghost" data-act="cancel">Abbrechen</button><button class="primary" data-act="connect">Verbinden</button></div>`;
  form.querySelector('#afKey')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') form.querySelector('[data-act=connect]').click(); });
  setTimeout(() => form.querySelector('input')?.focus(), 0);
}
$('catalog').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { addType = addType === b.dataset.type ? null : b.dataset.type; renderCatalog(); } });
$('addForm').addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  const act = btn?.dataset.act;
  const t = (state.catalog || []).find((x) => x.type === addType);
  if (!act || !t) return;
  if (act === 'cancel') { addType = null; renderCatalog(); }
  if (act === 'key') jarvis.openExternal(t.keyUrl);
  if (act === 'connect') {
    btn.disabled = true; btn.textContent = 'Prüfe …';
    try {
      state = await jarvis.addAccount({ type: t.type, key: $('afKey')?.value || '', label: $('afLabel')?.value || '', base: $('afBase')?.value || '' });
      addType = null;
      toast(`${t.name} verbunden ✓`);
      renderAll();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Verbinden';
      toast(`${t.name}: ${err.message}`, 6000);
    }
  }
});

function renderTempo() {
  const st = state.settings;
  $('raceToggle').checked = st.race !== false;
  $('hedgeSel').value = String(st.hedgeSec ?? 5);
  $('speedToggle').checked = st.speedOrder !== false;
}
$('raceToggle').onchange = async (e) => { state = await jarvis.setSettings({ race: e.target.checked }); };
$('hedgeSel').onchange = async (e) => { state = await jarvis.setSettings({ hedgeSec: Number(e.target.value) }); };
$('speedToggle').onchange = async (e) => { state = await jarvis.setSettings({ speedOrder: e.target.checked }); };

function renderPacks() {
  els.packList.innerHTML = '';
  for (const p of state.packs || []) {
    const card = document.createElement('div');
    card.className = `prov pack${p.enabled && !p.error ? ' on' : ''}`;
    card.innerHTML = p.error
      ? `<div class="prov-top"><div class="prov-name"><b>${escapeHtml(p.name)}</b><small class="err">Fehler: ${escapeHtml(p.error)}</small></div>
         <button class="danger" data-act="del">Entfernen</button></div>`
      : `<div class="prov-top"><span class="pack-sym">${escapeHtml(p.symbol || '◇')}</span>
          <div class="prov-name"><b>${escapeHtml(p.name)}</b> <code>${escapeHtml(p.befehl)}</code><small>${escapeHtml(p.beschreibung)}</small></div>
          <label class="switch" title="An/aus"><input type="checkbox" ${p.enabled ? 'checked' : ''}><span></span></label></div>
         <div class="row end">${p.builtin ? '<span class="badge">Eingebaut</span><button class="link" data-act="copy">Als Vorlage kopieren</button>'
          : '<button class="link" data-act="edit">Bearbeiten</button><button class="danger" data-act="del">Löschen</button>'}
          <button class="ghost small" data-act="use">Benutzen</button></div>`;
    card.querySelector('input[type=checkbox]')?.addEventListener('change', async (e) => { state = await jarvis.togglePack(p.id, e.target.checked); renderAll(); });
    card.addEventListener('click', async (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'use') { closeSettings(); els.input.value = `${p.befehl} `; els.input.focus(); }
      if (act === 'edit') openEditor(p, false);
      if (act === 'copy') openEditor(p, true);
      if (act === 'del' && confirm(`Paket „${p.name}“ wirklich löschen?`)) { state = await jarvis.deletePack(p.id); renderAll(); }
    });
    els.packList.appendChild(card);
  }
}
let editing = null;
function openEditor(p = null, asCopy = false) {
  editing = p && !asCopy ? p.id : null;
  $('peName').value = p ? (asCopy ? `${p.name} (eigen)` : p.name) : '';
  $('peCmd').value = p ? (asCopy ? `${p.befehl}2` : p.befehl) : '';
  $('peDesc').value = p?.beschreibung || '';
  $('peExamples').value = (p?.beispiele || []).join('\n');
  $('peInstr').value = p?.instructions || '';
  $('packEditor').classList.remove('hidden');
  $('peName').focus();
}
$('newPack').onclick = () => openEditor();
$('peCancel').onclick = () => $('packEditor').classList.add('hidden');
$('peName').addEventListener('input', () => {
  if (!editing && !$('peCmd').dataset.touched) $('peCmd').value = `/${$('peName').value.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
});
$('peCmd').addEventListener('input', () => { $('peCmd').dataset.touched = '1'; });
$('peSave').onclick = async () => {
  try {
    state = await jarvis.savePack({ originalId: editing, name: $('peName').value.trim(), befehl: $('peCmd').value.trim(), beschreibung: $('peDesc').value.trim(),
      beispiele: $('peExamples').value.split('\n').map((x) => x.trim()).filter(Boolean), instructions: $('peInstr').value });
    $('packEditor').classList.add('hidden'); delete $('peCmd').dataset.touched;
    renderAll(); toast('Paket gespeichert ✓');
  } catch (err) { toast(err.message, 5000); }
};
$('importPack').onclick = async () => {
  try { const r = await jarvis.importPack(); state = r.state; renderAll(); if (r.added.length) toast(`Hinzugefügt: ${r.added.join(', ')}`); }
  catch (err) { toast(err.message, 6000); }
};
$('packFolder').onclick = () => jarvis.openPackFolder();

const MAIL_PRESETS = { webde: ['imap.web.de', 993], gmx: ['imap.gmx.net', 993], gmail: ['imap.gmail.com', 993], outlook: ['outlook.office365.com', 993], icloud: ['imap.mail.me.com', 993] };
function renderMail() {
  const m = state.mail || {};
  if (document.activeElement?.closest?.('[data-pane="mail"]') && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'checkbox') return; // nicht beim Tippen überschreiben
  $('mailToggle').checked = !!m.enabled;
  $('mailPreset').value = m.preset || 'webde';
  $('mailHost').value = m.host || ''; $('mailPort').value = m.port || 993; $('mailUser').value = m.user || '';
  $('mailDays').value = String(m.days || 3);
  $('mailPassNote').textContent = m.hasPass ? 'Gespeichert (verschlüsselt). Leer lassen, um es zu behalten.' : 'Noch nichts gespeichert.';
}
$('mailPreset').onchange = (e) => { const p = MAIL_PRESETS[e.target.value]; if (p) { $('mailHost').value = p[0]; $('mailPort').value = p[1]; } };
$('mailToggle').onchange = async (e) => { state = await jarvis.setMail({ enabled: e.target.checked }); renderAll(); };
$('mailSave').onclick = async () => {
  const st = $('mailStatus'); st.className = 'wake-status'; st.textContent = 'Teste Verbindung …';
  try {
    state = await jarvis.setMail({ preset: $('mailPreset').value, host: $('mailHost').value, port: parseInt($('mailPort').value, 10) || 993, user: $('mailUser').value, pass: $('mailPass').value, days: parseInt($('mailDays').value, 10) });
    $('mailPass').value = '';
    const r = await jarvis.testMail();
    st.classList.add('ok'); st.textContent = `Verbindung klappt. In den letzten ${state.mail.days} Tagen: ${r.total} Mails, ${r.unseen} ungelesen. Schalte oben „E-Mail lesen erlauben“ ein.`;
  } catch (err) { st.classList.add('err'); st.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  renderAll();
};
$('mailForget').onclick = async () => { if (confirm('E-Mail-Zugang von diesem PC löschen?')) { state = await jarvis.setMail({ clearPass: true }); $('mailStatus').textContent = ''; renderAll(); } };

function renderRemote() {
  const r = state.remote || {};
  $('remoteToggle').checked = !!r.enabled;
  const box = $('remoteStatus');
  box.className = 'wake-status';
  if (!r.enabled) box.textContent = 'Aus.';
  else if (r.running) { box.classList.add('ok'); box.textContent = `Läuft. Adresse für dein Handy: ${r.url}`; }
  else if (!r.tailscale) { box.classList.add('err'); box.textContent = 'Tailscale wurde auf diesem PC nicht gefunden. Installiere und starte Tailscale, dann auf „Neu prüfen“ klicken.'; }
  else { box.classList.add('err'); box.textContent = 'Der Server konnte nicht starten (Port belegt?).'; }
  $('deviceList').innerHTML = (r.devices || []).length ? '' : '<li class="muted">Noch kein Handy gekoppelt.</li>';
  for (const d of r.devices || []) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(d.name)}</span><small>gekoppelt ${new Date(d.created).toLocaleDateString('de-DE')}${d.last ? ` · zuletzt ${new Date(d.last).toLocaleString('de-DE')}` : ''}</small><button class="icon-btn" title="Sperren"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    li.querySelector('button').onclick = async () => { if (confirm(`„${d.name}“ sperren?`)) { state = await jarvis.revokeDevice(d.id); renderAll(); } };
    $('deviceList').appendChild(li);
  }
}
$('remoteToggle').onchange = async (e) => { try { state = await jarvis.setRemote({ enabled: e.target.checked }); } catch (err) { toast(err.message, 5000); } renderAll(); };
$('remoteRecheck').onclick = async () => { state = await jarvis.recheckRemote(); renderAll(); };
let codeTimer = 0;
$('remoteCode').onclick = async () => {
  try {
    const { code, expires } = await jarvis.remoteCode();
    const el = $('pairCode');
    el.textContent = code; el.classList.remove('hidden');
    clearTimeout(codeTimer); codeTimer = setTimeout(() => el.classList.add('hidden'), Math.max(1000, expires - Date.now()));
    state = await jarvis.getState(); renderAll();
  } catch (err) { toast(err.message, 6000); }
};
setInterval(async () => {
  if (!$('settings').classList.contains('open')) return;
  try { const st = await jarvis.getState(); state.remote = st.remote; renderRemote(); } catch { /* egal */ }
}, 3000);
jarvis.onRemoteChat((c) => {
  jarvis.getState().then((st) => { state.remote = st.remote; renderRemote(); }).catch(() => {});
  const known = chats.find((x) => x.id === c.id);
  if (!known) chats.push({ ...c, unread: true });
  else if (known.id !== activeId && !runs.has(known.id)) { known.messages = c.messages; known.title = c.title; known.updated = c.updated; known.unread = true; }
  renderChatList();
});

function renderMemory() {
  const items = [...(state.memory || [])].reverse();
  els.memList.innerHTML = items.length ? '' : '<li class="muted">Noch nichts gemerkt.</li>';
  for (const m of items) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(m.text)}</span><small>${new Date(m.created).toLocaleDateString('de-DE')}${m.by === 'du' ? ' · von dir' : ''}</small><button class="icon-btn" title="Vergessen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
    li.querySelector('button').onclick = async () => { state = await jarvis.removeMemory(m.id); renderAll(); };
    els.memList.appendChild(li);
  }
}
$('memAdd').onclick = async () => { const v = $('memInput').value.trim(); if (!v) return; state = await jarvis.addMemory(v); $('memInput').value = ''; renderAll(); toast('Gemerkt ✓'); };
$('memInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('memAdd').click(); });
$('memClear').onclick = async () => { if (confirm('Wirklich alles vergessen? Das kann nicht rückgängig gemacht werden.')) { state = await jarvis.clearMemory(); renderAll(); } };
document.getElementById('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
$('roMemoryBox').onclick = () => openSettings('gedaechtnis');

// ---------- Befehls-Vorschläge beim Tippen von "/" ----------
let sugIndex = 0;
function updateSuggest() {
  const v = els.input.value;
  const m = v.match(/^\/([\wäöüß-]*)$/i);
  const list = m ? activePacks().filter((p) => p.befehl.startsWith(`/${m[1].toLowerCase()}`)) : [];
  els.suggest.classList.toggle('hidden', !list.length);
  if (!list.length) return;
  sugIndex = Math.min(sugIndex, list.length - 1);
  els.suggest.innerHTML = list.map((p, i) => `<button class="${i === sugIndex ? 'on' : ''}" data-cmd="${escapeHtml(p.befehl)}"><b>${escapeHtml(p.befehl)}</b><span>${escapeHtml(p.beschreibung)}</span></button>`).join('');
}
function pickSuggest(cmd) { els.input.value = `${cmd} `; els.suggest.classList.add('hidden'); els.input.focus(); }
els.suggest.addEventListener('mousedown', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); pickSuggest(b.dataset.cmd); } });
els.input.addEventListener('input', () => { sugIndex = 0; updateSuggest(); });
els.input.addEventListener('keydown', (e) => {
  if (els.suggest.classList.contains('hidden')) return;
  const btns = [...els.suggest.querySelectorAll('button')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugIndex = (sugIndex + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; updateSuggest(); }
  if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); pickSuggest(btns[sugIndex].dataset.cmd); }
  if (e.key === 'Escape') els.suggest.classList.add('hidden');
}, true);

// ---------- Stimme & Weckwort ----------
function fillVoices() {
  const voices = speechSynthesis.getVoices().filter((v) => /^de/i.test(v.lang));
  const cur = state?.settings?.voice || '';
  $('voiceSelect').innerHTML = `<option value="">Automatisch (beste deutsche)</option>${voices.map((v) => `<option ${v.name === cur ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}`;
}
speechSynthesis.onvoiceschanged = fillVoices;
function renderVoice() {
  const st = state.settings;
  $('speakSwitch').checked = !!st.speak;
  $('wakeToggle').checked = !!st.wakeWord;
  $('wakeSens').value = st.wakeSens || 'mid';
  $('rateRange').value = st.rate || 1.1;
  $('rateLabel').textContent = `${Number(st.rate || 1.1).toLocaleString('de-DE')}×`;
  if (!$('voiceSelect').options.length) fillVoices();
}
$('speakSwitch').onchange = async (e) => { state = await jarvis.setSettings({ speak: e.target.checked }); if (!state.settings.speak) stopSpeaking(); renderAll(); };
$('wakeToggle').onchange = async (e) => { state = await jarvis.setSettings({ wakeWord: e.target.checked }); renderAll(); };
$('wakeSens').onchange = async (e) => { state = await jarvis.setSettings({ wakeSens: e.target.value }); };
$('voiceSelect').onchange = async (e) => { state = await jarvis.setSettings({ voice: e.target.value }); };
$('rateRange').oninput = (e) => { $('rateLabel').textContent = `${Number(e.target.value).toLocaleString('de-DE')}×`; };
$('rateRange').onchange = async (e) => { state = await jarvis.setSettings({ rate: Number(e.target.value) }); };
$('voiceTest').onclick = () => speaker.sayAll('Hallo, ich bin Jarvis. So klinge ich mit diesen Einstellungen.');

function beep() {
  try {
    const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, ctx.currentTime); o.frequency.setValueAtTime(1320, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25); o.onended = () => ctx.close();
  } catch { /* egal */ }
}
const WAKE_TEXT = { off: ['aus', 'Weckwort aus.', ''], starting: ['startet …', 'Weckwort startet …', ''], ready: ['bereit', '', 'ok'], error: ['Fehler', '', 'err'], unsupported: ['–', '', 'err'] };
function showWake(w) {
  const [ro, txt, cls] = WAKE_TEXT[w.state] || WAKE_TEXT.off;
  els.roWake.textContent = w.state === 'ready' ? 'hört zu' : ro;
  els.wakeStatus.className = `wake-status ${cls}`;
  els.wakeStatus.textContent = w.state === 'ready' ? `Bereit – sag „Hey Jarvis“, warte auf den Piep, dann sprich. (Erkennung: ${w.detail})`
    : w.state === 'error' || w.state === 'unsupported' ? w.detail : txt;
}
jarvis.onWake((w) => {
  if (w.type === 'status') { showWake(w); return; }
  if (w.type === 'hit') {
    if (runs.has(activeId) || recording || els.settings.classList.contains('open')) return;
    stopSpeaking();
    beep();
    setTimeout(() => startRecording({ auto: true }), 180);
  }
});

function renderAll() {
  renderVoice();
  renderProviders();
  renderPacks();
  renderSidePacks();
  renderMemory();
  renderRemote();
  renderMail();
  els.speakToggle.classList.toggle('off', !state.settings.speak);
  els.speakToggle.title = state.settings.speak ? 'Vorlesen: an' : 'Vorlesen: aus';
  updateReadouts();
  updateWelcome();
}

// ---------- Updates ----------
function showUpdate(r) {
  if (r?.available) {
    els.updateVersion.textContent = r.version;
    els.updateBanner.classList.remove('hidden');
    els.updateInfo.textContent = `Installiert: ${state.version} · Neu: ${r.version}`;
  }
}
jarvis.onUpdate(showUpdate);
els.updateInstall.onclick = async () => {
  els.updateInstall.disabled = true; els.updateInstall.textContent = 'Lade …';
  try { await jarvis.installUpdate(); toast('Update installiert – Jarvis startet neu …', 5000); }
  catch (err) { els.updateInstall.disabled = false; els.updateInstall.textContent = 'Installieren'; toast(err.message, 6000); }
};
els.checkUpdate.onclick = async () => {
  els.checkUpdate.disabled = true;
  try {
    const r = await jarvis.checkUpdate();
    if (r.available) { showUpdate(r); toast(`Update ${r.version} verfügbar`); } else toast(r.reason || 'Jarvis ist aktuell.');
  } catch (err) { toast(err.message, 5000); }
  els.checkUpdate.disabled = false;
};
els.autoUpdate.onchange = async () => { state = await jarvis.setSettings({ autoUpdate: els.autoUpdate.checked }); };

// ---------- Ereignisse ----------
els.send.onclick = () => (activeRun() ? jarvis.stop(activeRun().reqId) : sendMessage());
els.input.addEventListener('input', autoGrow);
els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
els.sidePacks.addEventListener('click', (e) => { const c = e.target.closest('.side-pack'); if (c) { els.input.value = `${c.dataset.cmd} `; els.input.focus(); updateSuggest(); } });
$('packsTitle').onclick = () => { const off = document.body.classList.toggle('packs-off'); $('packsCaret').textContent = off ? '▸' : '▾'; };
$('chatSearch').addEventListener('input', (e) => { chatQuery = e.target.value; $('chatSearchClear').classList.toggle('hidden', !chatQuery); renderChatList(); });
$('chatSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); $('chatSearchClear').click(); } });
$('chatSearchClear').onclick = () => { $('chatSearch').value = ''; chatQuery = ''; $('chatSearchClear').classList.add('hidden'); renderChatList(); };
window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.body.classList.remove('side-off'); $('chatSearch').focus(); $('chatSearch').select(); } });
$('sideToggle').onclick = () => document.body.classList.toggle('side-off');
$('sideMemory').onclick = () => openSettings('gedaechtnis');
$('sideSettings').onclick = () => openSettings();
$('openSettings').onclick = openSettings;
els.welcomeConnect.onclick = openSettings;
$('closeSettings').onclick = closeSettings;
els.scrim.onclick = closeSettings;
els.newChat.onclick = () => { openNewChat(); };
els.speakToggle.onclick = async () => {
  state = await jarvis.setSettings({ speak: !state.settings.speak });
  if (!state.settings.speak) stopSpeaking();
  renderAll();
  toast(state.settings.speak ? 'Vorlesen an' : 'Vorlesen aus');
};
$('savePrompt').onclick = async () => { state = await jarvis.setSettings({ systemPrompt: els.systemPrompt.value }); toast('Gespeichert'); };
$('resetPrompt').onclick = async () => { state = await jarvis.setSettings({ resetPrompt: true }); els.systemPrompt.value = state.settings.systemPrompt; toast('Zurückgesetzt'); };
jarvis.onLog((line) => { els.log.textContent = `${new Date().toLocaleTimeString('de-DE')} ${line}\n` + els.log.textContent.slice(0, 8000); });
jarvis.onState((s) => { state = s; renderAll(); });
speechSynthesis.onvoiceschanged = () => {};

// ---------- Start ----------
(async () => {
  state = await jarvis.getState();
  try { chats = (await jarvis.getChats()).map((c) => ({ ...c, unread: false })); } catch { chats = []; }
  const fresh = { id: newId(), title: 'Neuer Chat', created: Date.now(), updated: Date.now(), messages: [] };
  chats.unshift(fresh);
  activeId = fresh.id;
  if (window.innerWidth < 860) document.body.classList.add('side-off');
  renderAll();
  renderChatList();
  showWake(await jarvis.getWake());
  els.input.focus();
  const before = connectedCount();
  state = await jarvis.detectLocal();
  renderAll();
  if (connectedCount() > before) toast('Lokale KI auf deinem PC gefunden und verbunden ✓');
  if (connectedCount() === 0) setTimeout(openSettings, 600);
})();
