// Macht den Gesprächsverlauf gültig, bevor er an eine KI geht.
// Manche Anbieter (z. B. Anthropic, Gemini) lehnen Verläufe ab, die nicht mit einer Nutzer-Nachricht beginnen
// oder zwei Nachrichten derselben Rolle hintereinander haben. Dann kommt gar keine Antwort.

function cleanHistory(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = typeof m.content === 'string' ? m.content.trim() : '';
    if (!content) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n\n${content}`; // gleiche Rolle: zusammenführen
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift(); // muss mit Nutzer beginnen
  return out;
}

module.exports = { cleanHistory };
