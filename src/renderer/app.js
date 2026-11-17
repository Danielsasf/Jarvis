/* global jarvis, HUD, JarvisSpeech, JarvisRender */
const $ = (id) => document.getElementById(id);
const els = {
  statusEl: $('status'), statusText: $('statusText'), welcome: $('welcome'), welcomeHint: $('welcomeHint'), welcomeConnect: $('welcomeConnect'),
  chips: $('chips'), messages: $('messages'), chat: $('chat'), input: $('input'), send: $('send'), mic: $('mic'),
  speakToggle: $('speakToggle'), newChat: $('newChat'), settings: $('settings'), scrim: $('scrim'), providerList: $('providerList'),
  systemPrompt: $('systemPrompt'), log: $('log'), toast: $('toast'), roLink: $('roLink'), roSpeed: $('roSpeed'), roCount: $('roCount'),
  roClock: $('roClock'), roMemory: $('roMemory'), suggest: $('suggest'), packList: $('packList'), memList: $('memList'), version: $('version'), updateBanner: $('updateBanner'), updateVersion: $('updateVersion'), updateInstall: $('updateInstall'),
  updateInfo: $('updateInfo'), checkUpdate: $('checkUpdate'), autoUpdate: $('autoUpdate'), sessionInfo: $('sessionInfo'),
};

const hud = HUD.create($('core'));
let state = null;
let history = [];
let current = null; // laufende Anfrage
let session = 1;
const openForms = new Set();

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
  hud.setMode(mode);
  els.statusEl.className = `status ${mode}`;
  els.statusText.textContent = label || MODE_LABEL[mode];
}
function settle() {
  if (current) setMode('thinking');
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
  els.version.textContent = `SYSTEM v${state.version}`;
  els.updateInfo.textContent = `Installiert: Version ${state.version}`;
  els.autoUpdate.checked = state.settings.autoUpdate !== false;
}
function updateWelcome() {
  const none = connectedCount() === 0;
  els.welcomeConnect.classList.toggle('hidden', !none);
  els.chips.classList.toggle('hidden', none);
  els.welcomeHint.textContent = none
    ? 'Verbinde zuerst mindestens eine KI in den Systemeinstellungen.'
    : 'Schreib eine Nachricht, klick aufs Mikrofon oder halte die Leertaste.';
  els.welcome.classList.toggle('hidden', history.length > 0);
  els.chips.innerHTML = activePacks().map((p) => `<button class="chip" data-cmd="${escapeHtml(p.befehl)}" title="${escapeHtml(p.beschreibung)}"><span class="sym">${escapeHtml(p.symbol || '◇')}</span>${escapeHtml(p.name)}</button>`).join('');
}
const activePacks = () => (state.packs || []).filter((p) => p.enabled && !p.error);
setInterval(() => { els.roClock.textContent = new Date().toLocaleTimeString('de-DE'); }, 1000);

// ---------- Vorlesen ----------
const speaker = new JarvisSpeech.Speaker({
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
  const by = document.createElement('span');
  by.textContent = res.by;
  m.appendChild(by);
  if (res.totalMs) {
    const t = document.createElement('span');
    t.textContent = `${(res.firstMs / 1000).toFixed(1)} s bis zum ersten Wort`;
    m.appendChild(t);
  }
  if (res.fallbacks?.length) {
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

async function sendMessage(text) {
  text = (text ?? els.input.value).trim();
  if (!text) return;
  if (current) return;
  if (connectedCount() === 0) { openSettings(); toast('Verbinde zuerst eine KI.'); return; }
  stopSpeaking();
  els.input.value = '';
  autoGrow();
  history.push({ role: 'user', content: text });
  updateWelcome();
  makeBubble('user', text);

  const reqId = `r${Date.now()}`;
  const bubble = makeBubble('assistant');
  const body = bubble.querySelector('.body');
  body.innerHTML = '<span class="cursor"></span>';
  current = { reqId, bubble, body, text: '', raf: 0, stopped: false };
  els.send.classList.add('stop');
  els.send.title = 'Stoppen';
  setMode('thinking');

  try {
    const res = await jarvis.send(reqId, history);
    if (res.stopped) throw Object.assign(new Error('gestoppt'), { stopped: true });
    current.text = res.text;
    paint(true);
    history.push({ role: 'assistant', content: res.text });
    addMeta(bubble, res.text, res);
    for (const m of res.memorySaved || []) addStep(bubble, `Gemerkt: ${m.text}`);
    for (const m of res.memoryForgotten || []) addStep(bubble, `Vergessen: ${m.text}`);
    if (res.memorySaved?.length || res.memoryForgotten?.length) state = await jarvis.getState(), updateReadouts();
    if (res.firstMs != null) els.roSpeed.textContent = `${(res.firstMs / 1000).toFixed(2)} s`;
    if (state.settings.speak) speaker.finish();
  } catch (err) {
    const partial = current?.text;
    if (partial) {
      // abgebrochen, aber schon Text da: behalten
      paint(true);
      history.push({ role: 'assistant', content: partial });
      addStep(bubble, err.stopped ? 'Gestoppt.' : `Abgebrochen: ${err.message}`, true);
      if (state.settings.speak && !err.stopped) speaker.finish();
    } else {
      bubble.remove();
      history.pop();
      if (!err.stopped) { makeBubble('error', err.message); setMode('error'); setTimeout(settle, 1500); }
    }
  } finally {
    cancelAnimationFrame(current?.raf);
    current = null;
    els.send.classList.remove('stop');
    els.send.title = 'Senden';
    settle();
    els.input.focus();
  }
}

function paint(final = false) {
  if (!current) return;
  current.raf = 0;
  current.body.innerHTML = renderMarkdown(current.text, !final) + (final ? '' : '<span class="cursor"></span>');
  applyBars(current.body);
  scrollDown();
}
jarvis.onDelta(({ reqId, text }) => {
  if (!current || current.reqId !== reqId) return;
  current.text += text;
  if (state.settings.speak) speaker.feed(text);
  if (!current.raf) current.raf = requestAnimationFrame(() => paint(false));
});
jarvis.onStatus((s) => {
  if (!current || current.reqId !== s.reqId) return;
  if (s.phase === 'asking') addStep(current.bubble, `Frage ${s.provider.split(' (')[0]} (${s.model}) …`);
  if (s.phase === 'switch') addStep(current.bubble, `${s.failed.split(' (')[0]} ausgefallen – wechsle zu ${s.provider.split(' (')[0]}`, true);
  if (s.phase === 'pack') addStep(current.bubble, `Paket „${s.pack}“ aktiv`);
  if (s.phase === 'streaming') {
    current.bubble.querySelectorAll('.steps > div:not(.keep)').forEach((d) => { if (!/^› Paket/.test(d.textContent)) d.remove(); });
    els.roSpeed.textContent = `${(s.firstMs / 1000).toFixed(2)} s`;
  }
});

function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 180) + 'px';
}

// ---------- Spracheingabe ----------
let recorder = null; let recording = false; let chunks = []; let micStream = null; let audioCtx = null; let meterRaf = 0;

async function startRecording() {
  if (recording || current) return;
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
    const tick = () => {
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      hud.setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
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
    else if (current) jarvis.stop(current.reqId);
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

function renderProviders() {
  els.providerList.innerHTML = '';
  state.providers.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = `prov${p.connected && p.enabled ? ' on' : ''}`;
    const badge = p.connected ? (p.enabled ? '<span class="badge ok">Aktiv</span>' : '<span class="badge">Pausiert</span>') : '<span class="badge">Nicht verbunden</span>';
    card.innerHTML = `
      <div class="prov-top">
        <div class="prov-order">
          <button data-act="up" title="Nach oben" ${i === 0 ? 'disabled' : ''}>${icon.up}</button>
          <button data-act="down" title="Nach unten" ${i === state.providers.length - 1 ? 'disabled' : ''}>${icon.down}</button>
        </div>
        <div class="prov-name"><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.desc)}</small></div>
        ${badge}
      </div>
      <div class="prov-body"></div>`;
    const body = card.querySelector('.prov-body');

    if (p.connected) {
      body.innerHTML = `
        <div class="row">
          <select title="Modell">${p.models.map((m) => `<option ${m === p.model ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}</select>
          <label class="switch" title="Aktiv"><input type="checkbox" ${p.enabled ? 'checked' : ''}><span></span></label>
        </div>
        <div class="row end"><button class="danger" data-act="disconnect">Trennen</button></div>`;
      body.querySelector('select').onchange = async (e) => { state = await jarvis.updateProvider(p.id, { model: e.target.value }); updateReadouts(); toast(`${p.name}: ${e.target.value}`); };
      body.querySelector('input[type=checkbox]').onchange = async (e) => { state = await jarvis.updateProvider(p.id, { enabled: e.target.checked }); renderAll(); };
    } else if (openForms.has(p.id)) {
      body.innerHTML = p.local
        ? `<p class="muted flush">Starte ${escapeHtml(p.name.replace(' (lokal)', ''))} auf deinem PC und lade mindestens ein Modell. Dann auf „Verbinden“ klicken.</p>
           <div class="row end"><button class="link" data-act="key">Herunterladen</button><button class="primary" data-act="connect">Verbinden</button></div>`
        : `<div class="row"><input type="password" placeholder="API-Schlüssel einfügen" autocomplete="off" spellcheck="false"><button class="primary" data-act="connect">Verbinden</button></div>
           <div class="row"><button class="link" data-act="key">Schlüssel holen →</button></div>`;
      const inp = body.querySelector('input');
      inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.querySelector('[data-act=connect]').click(); });
      setTimeout(() => inp?.focus(), 0);
    } else {
      body.innerHTML = '<div class="row end"><button class="ghost" data-act="open">Verbinden</button></div>';
    }

    card.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      const act = btn?.dataset.act;
      if (!act) return;
      const order = state.providers.map((x) => x.id);
      if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        [order[i], order[j]] = [order[j], order[i]];
        state = await jarvis.setOrder(order);
        renderAll();
      } else if (act === 'open') { openForms.add(p.id); renderProviders(); }
      else if (act === 'key') { jarvis.openExternal(p.keyUrl); }
      else if (act === 'disconnect') { state = await jarvis.disconnect(p.id); renderAll(); }
      else if (act === 'connect') {
        const key = body.querySelector('input')?.value || '';
        btn.disabled = true; btn.textContent = 'Prüfe …';
        try {
          state = await jarvis.connect(p.id, key);
          openForms.delete(p.id);
          toast(`${p.name} verbunden ✓`);
          renderAll();
        } catch (err) {
          btn.disabled = false; btn.textContent = 'Verbinden';
          toast(`${p.name}: ${err.message}`, 6000);
        }
      }
    });
    els.providerList.appendChild(card);
  });
}

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
$('openPacks').onclick = () => openSettings('pakete');
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

function renderAll() {
  renderProviders();
  renderPacks();
  renderMemory();
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
els.send.onclick = () => (current ? jarvis.stop(current.reqId) : sendMessage());
els.input.addEventListener('input', autoGrow);
els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
els.chips.addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { els.input.value = `${c.dataset.cmd} `; els.input.focus(); updateSuggest(); } });
$('openSettings').onclick = openSettings;
els.welcomeConnect.onclick = openSettings;
$('closeSettings').onclick = closeSettings;
els.scrim.onclick = closeSettings;
els.newChat.onclick = () => {
  if (current) jarvis.stop(current.reqId);
  history = []; els.messages.innerHTML = ''; stopSpeaking(); updateWelcome(); els.input.focus();
  session++; els.sessionInfo.textContent = `SITZUNG ${String(session).padStart(2, '0')}`;
};
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
  renderAll();
  els.input.focus();
  const before = connectedCount();
  state = await jarvis.detectLocal();
  renderAll();
  if (connectedCount() > before) toast('Lokale KI auf deinem PC gefunden und verbunden ✓');
  if (connectedCount() === 0) setTimeout(openSettings, 600);
})();
