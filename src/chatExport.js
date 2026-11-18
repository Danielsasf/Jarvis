// Chat als lesbare Textdatei („Als Textdatei speichern“ in der Seitenleiste).
// Reine Funktionen ohne Electron, damit testbar.
const ASSISTANT = 'Jarvis';

function stamp(ts) {
  const d = new Date(Number(ts) || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const clean = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function chatToText(chat = {}) {
  const title = String(chat.title || '').replace(/\s+/g, ' ').trim() || 'Chat';
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const when = stamp(chat.updated || chat.created);
  const count = `${messages.length} ${messages.length === 1 ? 'Nachricht' : 'Nachrichten'}`;
  const lines = [title, '='.repeat(Math.min(60, Math.max(8, title.length)))];
  lines.push(`${count}${when ? ` · zuletzt ${when}` : ''}`, '');
  if (!messages.length) lines.push('Dieser Chat enthält noch keine Nachrichten.');
  for (const m of messages) {
    const by = String(m?.by || '').replace(/\s+/g, ' ').trim();
    const who = m?.role === 'user' ? 'Du' : (by ? `${ASSISTANT} (${by})` : ASSISTANT);
    lines.push(`${who}:`, clean(m?.content) || '(leer)', '');
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return `${text.replace(/\n/g, '\r\n')}\r\n`;
}

// Dateiname aus dem Chat-Titel, ohne Zeichen, die Windows nicht erlaubt.
function suggestFileName(title) {
  const base = String(title || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
  return `${base || 'Chat'}.txt`;
}

module.exports = { chatToText, suggestFileName };
