const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { ProviderError, parseRetryAfter, callWithRetry, runWithFallback } = require('../src/router');
const { chatStream, listModels, getProvider, pickDefaultModel } = require('../src/providers');
const updater = require('../src/updater');

const noSleep = { sleep: async () => {}, random: () => 0.5 };
const fail = (status, extra = {}) => new ProviderError(`HTTP ${status}`, { status, ...extra });

// ---------- Router ----------
test('retry-after: Sekunden und HTTP-Datum', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
  assert.equal(parseRetryAfter(null), null);
});

test('429 wird wiederholt und respektiert retry-after', async () => {
  const waits = [];
  let n = 0;
  const r = await callWithRetry(async () => { if (n++ < 2) throw fail(429, { retryAfterMs: 1234 }); return 'ok'; },
    { ...noSleep, sleep: async (ms) => waits.push(ms) });
  assert.equal(r, 'ok');
  assert.deepEqual(waits, [1234, 1234]);
});

test('401 wird NICHT wiederholt', async () => {
  let n = 0;
  await assert.rejects(callWithRetry(async () => { n++; throw fail(401); }, noSleep));
  assert.equal(n, 1);
});

test('Timeout bricht ab und zählt als wiederholbar', async () => {
  let n = 0;
  await assert.rejects(
    callWithRetry((signal) => { n++; return new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))); },
      { ...noSleep, timeoutMs: 20, maxRetries: 1 }),
    /Zeitüberschreitung/);
  assert.equal(n, 2);
});

test('beat() hält lange Live-Antworten am Leben', async () => {
  const r = await callWithRetry(async (signal, beat) => {
    for (let i = 0; i < 5; i++) { await new Promise((ok) => setTimeout(ok, 15)); beat(); if (signal.aborted) throw new Error('abgebrochen'); }
    return 'fertig';
  }, { ...noSleep, timeoutMs: 30, maxRetries: 0 });
  assert.equal(r, 'fertig');
});

test('Fallback: erste KI kaputt -> zweite antwortet, Reihenfolge stimmt', async () => {
  const calls = [];
  const switched = [];
  const res = await runWithFallback([
    { id: 'a', label: 'A', run: async () => { calls.push('a'); throw fail(500); } },
    { id: 'b', label: 'B', run: async () => { calls.push('b'); return 'Hallo'; } },
  ], { ...noSleep, maxRetries: 1, onSwitch: (s) => switched.push(s.id) });
  assert.equal(res.text, 'Hallo');
  assert.deepEqual(calls, ['a', 'a', 'b']);
  assert.deepEqual(switched, ['b']);
});

test('Kein Fallback mehr, sobald Text angezeigt wurde', async () => {
  const calls = [];
  await assert.rejects(runWithFallback([
    { id: 'a', label: 'A', run: async () => { calls.push('a'); throw fail(500, { streamed: true }); } },
    { id: 'b', label: 'B', run: async () => { calls.push('b'); return 'nie'; } },
  ], noSleep), (e) => e.streamed);
  assert.deepEqual(calls, ['a']);
});

test('Veraltetes Modell wird repariert und gleiche KI nochmal gefragt', async () => {
  let model = 'gemini-2.5-flash';
  const calls = [];
  const res = await runWithFallback([
    { id: 'g', get label() { return `G · ${model}`; },
      run: async () => { calls.push(model); if (model === 'gemini-2.5-flash') throw fail(404, { modelGone: true }); return 'neu'; },
      repair: async () => { model = 'gemini-3-flash'; return true; } },
  ], noSleep);
  assert.equal(res.text, 'neu');
  assert.deepEqual(calls, ['gemini-2.5-flash', 'gemini-3-flash']);
});

test('Alle fallen aus -> verständliche Fehlermeldung', async () => {
  await assert.rejects(runWithFallback([
    { id: 'a', label: 'A', run: async () => { throw fail(401); } },
  ], noSleep), /Keine KI konnte antworten/);
});

// ---------- Live-Antworten ----------
function sseFetch(events, { status = 200, failAfter = null } = {}) {
  return async (url, init) => {
    sseFetch.last = { url, init };
    async function* body() {
      let i = 0;
      for (const e of events) {
        if (failAfter != null && i++ === failAfter) throw new Error('Verbindung weg');
        yield new TextEncoder().encode(`data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`);
      }
    }
    return { ok: status < 400, status, body: body(), json: async () => ({ error: { message: 'x' } }), headers: { get: () => null } };
  };
}

test('Claude streamt Stück für Stück', async () => {
  const got = [];
  const f = sseFetch([{ type: 'message_start' }, { type: 'content_block_delta', delta: { text: 'Hal' } }, { type: 'content_block_delta', delta: { text: 'lo' } }, { type: 'message_stop' }]);
  const out = await chatStream(getProvider('anthropic'), 'k', 'm', [{ role: 'user', content: 'x' }], 's', { onDelta: (t) => got.push(t), fetchImpl: f });
  assert.equal(out, 'Hallo');
  assert.deepEqual(got, ['Hal', 'lo']);
  assert.equal(JSON.parse(sseFetch.last.init.body).stream, true);
});

test('OpenAI-kompatibel streamt und endet bei [DONE]', async () => {
  const f = sseFetch([{ choices: [{ delta: { content: 'Ja' } }] }, { choices: [{ delta: { content: '!' } }] }, '[DONE]']);
  assert.equal(await chatStream(getProvider('groq'), 'k', 'm', [], 's', { fetchImpl: f }), 'Ja!');
});

test('Gemini streamt über streamGenerateContent', async () => {
  const f = sseFetch([{ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] }]);
  assert.equal(await chatStream(getProvider('gemini'), 'k', 'gemini-3-flash', [{ role: 'assistant', content: 'a' }], 's', { fetchImpl: f }), 'Hi');
  assert.match(sseFetch.last.url, /streamGenerateContent\?alt=sse$/);
  assert.equal(JSON.parse(sseFetch.last.init.body).contents[0].role, 'model');
});

test('Abbruch mitten im Stream wird als "streamed" markiert', async () => {
  const f = sseFetch([{ choices: [{ delta: { content: 'Teil' } }] }, { choices: [{ delta: { content: 'nie' } }] }], { failAfter: 1 });
  await assert.rejects(chatStream(getProvider('openai'), 'k', 'm', [], 's', { fetchImpl: f }), (e) => e.streamed === true);
});

test('404 / "nicht mehr verfügbar" wird als veraltetes Modell erkannt', async () => {
  const f = async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'model is no longer available to new users' } }), headers: { get: () => null } });
  await assert.rejects(chatStream(getProvider('gemini'), 'k', 'gemini-2.5-flash', [], 's', { fetchImpl: f }), (e) => e.modelGone === true);
});

// ---------- Modellwahl ----------
test('Gemini: neuestes Flash-Modell wird gewählt, kaputtes ausgeschlossen', () => {
  const p = getProvider('gemini');
  const models = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-3-pro-preview'];
  assert.equal(pickDefaultModel(p, models), 'gemini-3-flash-preview');
  assert.equal(pickDefaultModel(p, ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3-flash-preview']), 'gemini-3-flash');
  assert.equal(pickDefaultModel(p, ['gemini-2.5-flash', 'gemini-2.0-flash'], ['gemini-2.5-flash']), 'gemini-2.0-flash');
});

test('Modell-Liste filtert Nicht-Chat-Modelle', async () => {
  const f = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'text-embedding-3' }, { id: 'whisper-1' }, { id: 'gpt-5-mini' }, { id: 'gpt-5' }] }) });
  const p = getProvider('openai');
  const models = await listModels(p, 'k', f);
  assert.deepEqual(models.sort(), ['gpt-5', 'gpt-5-mini']);
  assert.equal(pickDefaultModel(p, models), 'gpt-5');
});

// ---------- Updates ----------
test('Versionsvergleich', () => {
  assert.equal(updater.cmpVersion('2.1.0', '2.0.9'), 1);
  assert.equal(updater.cmpVersion('v2.0.0', '2.0.0'), 0);
  assert.equal(updater.cmpVersion('2.0.0', '10.0.0'), -1);
});

test('Update-Datei darf nicht aus dem Ordner ausbrechen', () => {
  assert.throws(() => updater.safeJoin('/x/app', '../evil.js'));
  assert.throws(() => updater.safeJoin('/x/app', 'C:\\Windows\\a.js'));
  assert.ok(updater.safeJoin('/x/app', 'renderer/app.js').endsWith(path.join('renderer', 'app.js')));
});

test('Update wird heruntergeladen, geprüft und als aktuell markiert', async () => {
  const crypto = require('crypto');
  const files = { 'main.js': '// neu', 'renderer/app.js': '// ui' };
  const pkg = { format: 1, version: '2.1.0', files, sha256: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex') };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-'));
  const f = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(pkg) });
  const target = await updater.downloadUpdate({ url: 'x', expectedVersion: '2.1.0', appDir: dir, shellVersion: '2.0.0', fetchImpl: f });
  assert.equal(fs.readFileSync(path.join(target, 'renderer/app.js'), 'utf8'), '// ui');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'current.json'))).version, '2.1.0');
  // beschädigt
  const bad = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ...pkg, sha256: 'falsch' }) });
  await assert.rejects(updater.downloadUpdate({ url: 'x', expectedVersion: '2.1.0', appDir: dir, shellVersion: '2.0.0', fetchImpl: bad }), /beschädigt/);
});

test('Update-Check erkennt neue Version im GitHub-Release', async () => {
  const f = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v2.1.0', assets: [{ name: 'jarvis-app.json', browser_download_url: 'https://dl' }] }) });
  const r = await updater.checkForUpdate({ repo: 'a/b', currentVersion: '2.0.0', fetchImpl: f });
  assert.equal(r.available, true);
  assert.equal(r.version, '2.1.0');
  const same = await updater.checkForUpdate({ repo: 'a/b', currentVersion: '2.1.0', fetchImpl: f });
  assert.equal(same.available, false);
});

// ---------- Vorlesen ----------
function loadSpeech() {
  const spoken = [];
  class Utt { constructor(t) { this.text = t; } }
  const sandbox = { window: {}, speechSynthesis: { speak: (u) => spoken.push(u.text), cancel() {}, getVoices: () => [], speaking: false, pending: false }, SpeechSynthesisUtterance: Utt };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/speech.js'), 'utf8'), sandbox);
  return { ...sandbox.window.JarvisSpeech, spoken };
}

test('Emojis und Smileys werden nicht vorgelesen', () => {
  const { clean } = loadSpeech();
  assert.equal(clean('Ich höre dir zu 😉 klar! 👍🏽'), 'Ich höre dir zu klar!');
  assert.equal(clean('Super ;) und **fett**'), 'Super und fett');
});

test('Live-Vorlesen: erster Satz sofort, Code wird übersprungen', () => {
  const { Speaker, spoken } = loadSpeech();
  const s = new Speaker();
  s.feed('Hallo Daniel! ');
  assert.deepEqual(spoken, ['Hallo Daniel!']);
  s.feed('Hier ist der Code:\n```js\nconsole.log(1)\n```\nDas war');
  s.feed(' es.');
  s.finish();
  assert.ok(!spoken.join(' ').includes('console'));
  assert.match(spoken.join(' '), /Das war es\./);
});
