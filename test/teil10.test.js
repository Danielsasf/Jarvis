const test = require('node:test');
const assert = require('node:assert');
const { chatToText, suggestFileName } = require('../src/chatExport');

const chat = {
  title: 'Mathe lernen',
  created: new Date(2026, 10, 17, 14, 1).getTime(),
  updated: new Date(2026, 10, 17, 14, 5).getTime(),
  messages: [
    { role: 'user', content: 'Erkläre Ableitungen.' },
    { role: 'assistant', content: 'Eine Ableitung ist die Steigung.\n\nBeispiel: f(x)=x².', by: 'Gemini' },
  ],
};

test('Chat-Export: Kopf mit Titel, Anzahl und Zeitpunkt', () => {
  const text = chatToText(chat);
  const lines = text.split('\r\n');
  assert.equal(lines[0], 'Mathe lernen');
  assert.match(text, /2 Nachrichten · zuletzt 17\.11\.2026 1[45]:05/);
});

test('Chat-Export: Rollen, Modellname und Inhalt', () => {
  const text = chatToText(chat);
  assert.match(text, /Du:\r\nErkläre Ableitungen\./);
  assert.match(text, /Jarvis \(Gemini\):\r\nEine Ableitung ist die Steigung\./);
  assert.ok(text.includes('Beispiel: f(x)=x².'));
  assert.ok(!/undefined|null/.test(text));
});

test('Chat-Export: Zeilenenden für Windows-Editor, leere Zeilen begrenzt', () => {
  const text = chatToText({ title: 'X', messages: [{ role: 'user', content: 'a\n\n\n\nb' }] });
  assert.ok(!/[^\r]\n/.test(text), 'nur CRLF');
  assert.ok(!/\r\n\r\n\r\n/.test(text), 'höchstens eine Leerzeile');
  assert.ok(text.endsWith('\r\n'));
});

test('Chat-Export: leerer Chat und fehlende Felder', () => {
  const text = chatToText({});
  assert.match(text, /^Chat\r\n=/);
  assert.match(text, /0 Nachrichten/);
  assert.match(text, /noch keine Nachrichten/);
  assert.equal(chatToText().split('\r\n')[0], 'Chat');
  assert.equal(chatToText({ title: 'T', messages: [{ role: 'assistant', content: '   ' }] }).includes('(leer)'), true);
});

test('Chat-Export: Dateiname bereinigt', () => {
  assert.equal(suggestFileName('a/b:c*d?e"f<g>h|i'), 'a b c d e f g h i.txt');
  assert.equal(suggestFileName('  Mathe   lernen  '), 'Mathe lernen.txt');
  assert.equal(suggestFileName(''), 'Chat.txt');
  assert.ok(suggestFileName('x'.repeat(200)).length <= 64);
});
