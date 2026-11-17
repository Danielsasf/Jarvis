// Gespeicherte Chats (eine Datei, bleibt auf dem PC).
const fs = require('fs');
const path = require('path');

const MAX_CHATS = 150;
const MAX_MESSAGES = 300;

function clean(chat) {
  if (!chat || typeof chat !== 'object' || !/^[\w-]{1,40}$/.test(String(chat.id))) throw new Error('Ungültiger Chat.');
  const messages = (Array.isArray(chat.messages) ? chat.messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 60000), ...(typeof m.by === 'string' ? { by: m.by.slice(0, 80) } : {}) }));
  return {
    id: String(chat.id),
    title: String(chat.title || 'Neuer Chat').slice(0, 80),
    created: Number(chat.created) || Date.now(),
    updated: Number(chat.updated) || Date.now(),
    messages,
  };
}

class ChatStore {
  constructor(file) {
    this.file = file;
    this.chats = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.chats = (Array.isArray(raw) ? raw : []).map((c) => { try { return clean(c); } catch { return null; } }).filter(Boolean);
    } catch { /* noch keine Datei */ }
  }
  all() { return [...this.chats].sort((a, b) => b.updated - a.updated); }
  upsert(chat) {
    const c = clean(chat);
    if (!c.messages.length) return this.remove(c.id); // leere Chats nicht speichern
    const i = this.chats.findIndex((x) => x.id === c.id);
    if (i === -1) this.chats.push(c); else this.chats[i] = c;
    if (this.chats.length > MAX_CHATS) this.chats = this.all().slice(0, MAX_CHATS);
    this.write();
  }
  remove(id) {
    const n = this.chats.length;
    this.chats = this.chats.filter((c) => c.id !== id);
    if (this.chats.length !== n) this.write();
  }
  write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.chats));
      fs.renameSync(tmp, this.file);
    } catch { /* Platte voll o. ä.: Chat bleibt im Fenster erhalten */ }
  }
}

module.exports = { ChatStore, clean };
