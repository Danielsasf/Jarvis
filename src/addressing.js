// Direkte Ansprache: "Claude, erkläre das" fragt nur Claude. "Jarvis, …" oder ohne Name läuft wie bisher.
// Der Name muss ganz am Anfang stehen und mit Komma oder Doppelpunkt enden. Kein Modell, kostenlos.

const SHORT = {
  anthropic: ['claude'], openai: ['chatgpt', 'gpt'], gemini: ['gemini'], groq: ['groq'], mistral: ['mistral'],
  openrouter: ['openrouter'], xai: ['grok'], deepseek: ['deepseek'], together: ['together'], cerebras: ['cerebras'],
  sambanova: ['sambanova'], fireworks: ['fireworks'], ollama: ['ollama'], lmstudio: ['lm studio', 'lmstudio'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Alle Namen, unter denen eine KI angesprochen werden kann. */
function aliasesFor(acc) {
  if (!acc) return [];
  const base = SHORT[acc.type] || [];
  const extra = String(acc.alias || '').split(',').map(norm).filter(Boolean).slice(0, 5);
  const label = acc.label ? [norm(acc.label)] : [];
  return [...new Set([...base, ...extra, ...label])];
}

/** "Claude, erkläre das" -> { id, rest }. Sonst null. order = Reihenfolge der aktiven KIs. */
function parseAddress(text, accounts, order) {
  const m = String(text || '').match(/^\s*([\p{L}][\p{L} .-]{0,30}?)\s*[,:]\s*([\s\S]*\S[\s\S]*)$/u);
  if (!m) return null;
  const name = norm(m[1]);
  for (const id of order) {
    if (aliasesFor(accounts[id]).includes(name)) return { id, rest: m[2].trim() };
  }
  return null;
}

module.exports = { SHORT, aliasesFor, parseAddress };
