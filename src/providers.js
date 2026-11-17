// Alle KI-Anbieter, die Jarvis in den Einstellungen vorschlägt.
const { ProviderError, parseRetryAfter } = require('./router');

const PROVIDERS = [
  { id: 'anthropic', name: 'Claude (Anthropic)', kind: 'anthropic', base: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys', desc: 'Stark beim Denken, Schreiben und Programmieren.',
    prefer: [/sonnet/i, /opus/i, /haiku/i] },
  { id: 'openai', name: 'ChatGPT (OpenAI)', kind: 'openai', base: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys', desc: 'Allrounder. Kann auch deine Sprache in Text umwandeln.',
    prefer: [/^gpt-[\d.]+$/i, /^gpt-[\d.]+-mini$/i, /^gpt/i], stt: 'openai' },
  { id: 'gemini', name: 'Gemini (Google)', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/app/apikey', desc: 'Kostenloser Einstieg möglich. Versteht auch Sprache.',
    prefer: [/^gemini-[\d.]+-flash(-preview)?(-\d+)?$/i, /flash(?!-lite)/i, /pro/i, /flash/i], stt: 'gemini' },
  { id: 'groq', name: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys', desc: 'Extrem schnell, kostenloser Einstieg. Gute Spracherkennung.',
    prefer: [/llama.*70b/i, /llama/i, /./], stt: 'groq' },
  { id: 'mistral', name: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys', desc: 'Europäische KI aus Frankreich.',
    prefer: [/mistral-large-latest/i, /mistral-medium-latest/i, /latest/i] },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys', desc: 'Ein Schlüssel für hunderte Modelle verschiedener Anbieter.',
    prefer: [/claude.*sonnet/i, /gpt/i] },
  { id: 'ollama', name: 'Ollama (lokal)', kind: 'openai', base: 'http://localhost:11434/v1', local: true,
    keyUrl: 'https://ollama.com/download', desc: 'Läuft komplett auf deinem PC – ohne Internet, ohne Kosten.',
    prefer: [/llama/i, /qwen/i, /mistral/i, /gemma/i] },
  { id: 'lmstudio', name: 'LM Studio (lokal)', kind: 'openai', base: 'http://localhost:1234/v1', local: true,
    keyUrl: 'https://lmstudio.ai', desc: 'Lokale Modelle aus LM Studio nutzen.', prefer: [/./] },
];

const NON_CHAT = /embed|whisper|tts|audio|dall-e|image|moderation|transcribe|realtime|search|davinci|babbage|guard|rerank|ocr|vision-only|live|native-audio|computer-use|robotics|veo|imagen|lyria/i;

function getProvider(id) {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`Unbekannter Anbieter: ${id}`);
  return p;
}

function headersFor(p, key) {
  if (p.kind === 'anthropic') return { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (p.kind === 'gemini') return { 'x-goog-api-key': key, 'content-type': 'application/json' };
  const h = { 'content-type': 'application/json' };
  if (key) h.authorization = `Bearer ${key}`;
  if (p.id === 'openrouter') { h['HTTP-Referer'] = 'https://jarvis.local'; h['X-Title'] = 'Jarvis'; }
  return h;
}

const MODEL_GONE = /not (found|available|supported)|no longer|deprecated|does not exist|decommission|retired|unknown model|invalid model/i;

async function raiseFor(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.message || JSON.stringify(body).slice(0, 200);
  } catch { /* kein JSON */ }
  const friendly = {
    400: 'Ungültige Anfrage', 401: 'Schlüssel ungültig', 403: 'Kein Zugriff', 404: 'Modell nicht gefunden',
    429: 'Zu viele Anfragen / Guthaben aufgebraucht', 529: 'Überlastet',
  }[res.status] || `Fehler ${res.status}`;
  throw new ProviderError(`${friendly}${detail ? ` – ${detail}` : ''}`, {
    status: res.status,
    retryAfterMs: parseRetryAfter(res.headers?.get?.('retry-after')),
    modelGone: res.status === 404 || ((res.status === 400 || res.status === 403) && MODEL_GONE.test(detail)),
  });
}

async function send(fetchImpl, url, init) {
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ProviderError(`Nicht erreichbar (${err?.cause?.code || err?.message || 'Netzwerk'})`, { network: true });
  }
  if (!res.ok) await raiseFor(res);
  return res;
}
const request = async (f, url, init) => (await send(f, url, init)).json();

// ---------- Modelle ----------
// Versionsnummer aus dem Namen, z. B. gemini-3.1-flash -> 3.1 ; gpt-5-mini -> 5
function versionOf(name) {
  const m = name.match(/(?:^|[-_/ ])(\d+(?:\.\d+)?)(?=[-_ ]|$)/);
  return m ? parseFloat(m[1]) : 0;
}
function rankModels(p, models) {
  const score = (m) => {
    const idx = (p.prefer || []).findIndex((re) => re.test(m));
    return { idx: idx === -1 ? 999 : idx, ver: versionOf(m), unstable: /preview|exp|beta|alpha/i.test(m) ? 1 : 0, dated: /\d{4}-?\d{2}-?\d{2}|-\d{3,}$/.test(m) ? 1 : 0 };
  };
  return [...models].sort((a, b) => {
    const A = score(a), B = score(b);
    return A.idx - B.idx || B.ver - A.ver || A.unstable - B.unstable || A.dated - B.dated || a.length - b.length;
  });
}
function pickDefaultModel(p, models, exclude = []) {
  return rankModels(p, models.filter((m) => !exclude.includes(m)))[0] || '';
}

async function listModels(p, key, fetchImpl = fetch, signal) {
  let ids = [];
  if (p.kind === 'anthropic') {
    const j = await request(fetchImpl, `${p.base}/models?limit=100`, { headers: headersFor(p, key), signal });
    ids = (j.data || []).map((m) => m.id);
  } else if (p.kind === 'gemini') {
    const j = await request(fetchImpl, `${p.base}/models?pageSize=200`, { headers: headersFor(p, key), signal });
    ids = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /gemini/i.test(n) && !NON_CHAT.test(n));
  } else {
    const j = await request(fetchImpl, `${p.base}/models`, { headers: headersFor(p, key), signal });
    ids = (j.data || j.models || []).map((m) => m.id || m.name).filter((n) => n && !NON_CHAT.test(n));
  }
  if (!ids.length) throw new ProviderError('Verbunden, aber keine passenden Modelle gefunden.');
  return rankModels(p, ids);
}

// ---------- Live-Antworten (Server-Sent Events) ----------
async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const data = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  }
  const tail = buf.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
  if (tail) yield tail;
}

function buildRequest(p, key, model, messages, system) {
  if (p.kind === 'anthropic') {
    return { url: `${p.base}/messages`, body: { model, max_tokens: 4096, system, messages, stream: true },
      pick: (j) => {
        if (j.type === 'error') throw new ProviderError(j.error?.message || 'Fehler', { status: j.error?.type === 'overloaded_error' ? 529 : 500 });
        return j.type === 'content_block_delta' ? j.delta?.text || '' : '';
      } };
  }
  if (p.kind === 'gemini') {
    return { url: `${p.base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      },
      pick: (j) => (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('') };
  }
  return { url: `${p.base}/chat/completions`,
    body: { model, messages: [{ role: 'system', content: system }, ...messages], stream: true },
    pick: (j) => {
      if (j.error) throw new ProviderError(j.error.message || 'Fehler', { status: 500 });
      return j.choices?.[0]?.delta?.content || '';
    } };
}

/** Streamt die Antwort; onDelta(text) für jedes Stück. beat() hält die Zeitüberwachung wach. */
async function chatStream(p, key, model, messages, system, { signal, onDelta = () => {}, beat = () => {}, fetchImpl = fetch } = {}) {
  const { url, body, pick } = buildRequest(p, key, model, messages, system);
  const res = await send(fetchImpl, url, { method: 'POST', headers: headersFor(p, key), body: JSON.stringify(body), signal });
  let text = '';
  try {
    for await (const data of sseEvents(res.body)) {
      beat();
      if (data === '[DONE]') break;
      let j;
      try { j = JSON.parse(data); } catch { continue; }
      const piece = pick(j);
      if (piece) { text += piece; onDelta(piece); }
    }
  } catch (err) {
    if (text && err && typeof err === 'object') err.streamed = true;
    throw err;
  }
  if (!text.trim()) throw new ProviderError('Leere Antwort');
  return text;
}

// ---------- Sprache -> Text ----------
async function transcribe(p, key, chatModel, audio, mime, signal, fetchImpl = fetch) {
  if (p.stt === 'gemini') {
    const j = await request(fetchImpl, `${p.base}/models/${encodeURIComponent(chatModel)}:generateContent`, {
      method: 'POST', headers: headersFor(p, key), signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: 'Transkribiere diese Sprachaufnahme wortgetreu. Gib nur den gesprochenen Text zurück, ohne Anführungszeichen.' },
          { inline_data: { mime_type: mime, data: Buffer.from(audio).toString('base64') } },
        ] }],
      }),
    });
    return (j.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
  }
  const model = p.stt === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), 'sprache.webm');
  form.append('model', model);
  form.append('language', 'de');
  const h = headersFor(p, key);
  delete h['content-type'];
  const j = await request(fetchImpl, `${p.base}/audio/transcriptions`, { method: 'POST', headers: h, body: form, signal });
  return String(j.text || '').trim();
}

module.exports = { PROVIDERS, getProvider, listModels, chatStream, transcribe, pickDefaultModel, rankModels, sseEvents };
