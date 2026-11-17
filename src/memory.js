// Gedächtnis: Fakten, die Jarvis sich über Chats hinweg merkt.
// Die KI schreibt <merken>…</merken> bzw. <vergessen>m3</vergessen> in ihre Antwort; Jarvis führt das aus
// und blendet die Markierungen in der Anzeige aus.
const fs = require('fs');

const MAX_ITEMS = 200;
const TAG = /<(merken|vergessen)>([\s\S]*?)<\/\1>/gi;

class Memory {
  constructor(file) { this.file = file; this.items = []; this.next = 1; this.load(); }
  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.items = Array.isArray(j.items) ? j.items : [];
      this.next = j.next || this.items.reduce((n, i) => Math.max(n, Number(String(i.id).slice(1)) + 1), 1);
    } catch { this.items = []; }
  }
  save() { fs.writeFileSync(this.file, JSON.stringify({ next: this.next, items: this.items }, null, 2)); }
  list() { return [...this.items]; }
  add(text, by = 'jarvis') {
    text = String(text).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) return null;
    const dup = this.items.find((i) => i.text.toLowerCase() === text.toLowerCase());
    if (dup) return dup;
    const item = { id: `m${this.next++}`, text, by, created: new Date().toISOString() };
    this.items.push(item);
    if (this.items.length > MAX_ITEMS) this.items.shift();
    this.save();
    return item;
  }
  remove(idOrText) {
    const key = String(idOrText).trim();
    const lower = key.toLowerCase();
    const before = this.items.length;
    const removed = this.items.filter((i) => i.id === key || i.text.toLowerCase() === lower || (lower.length >= 6 && i.text.toLowerCase().includes(lower)));
    this.items = this.items.filter((i) => !removed.includes(i));
    if (this.items.length !== before) this.save();
    return removed;
  }
  clear() { this.items = []; this.save(); }

  /** Block für die Systemanweisung (neueste zuerst, gekürzt) */
  promptBlock(maxChars = 3500) {
    const lines = [];
    let used = 0;
    for (const i of [...this.items].reverse()) {
      const l = `[${i.id}] ${i.text}`;
      if (used + l.length > maxChars) break;
      lines.unshift(l); used += l.length + 1;
    }
    return lines.join('\n');
  }

  /** Markierungen aus der fertigen Antwort ausführen */
  apply(text) {
    const saved = []; const forgotten = [];
    for (const [, kind, body] of String(text).matchAll(TAG)) {
      if (kind.toLowerCase() === 'merken') { const it = this.add(body); if (it) saved.push(it); }
      else forgotten.push(...this.remove(body));
    }
    return { saved, forgotten };
  }
}

const stripTags = (text) => String(text).replace(TAG, '').replace(/<(merken|vergessen)>[\s\S]*$/i, '');

module.exports = { Memory, stripTags };
