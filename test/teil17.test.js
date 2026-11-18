const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanHistory } = require('../src/history');

test('Verlauf beginnt mit Nutzer und wechselt die Rollen ab', () => {
  const r = cleanHistory([
    { role: 'assistant', content: 'Hallo' },
    { role: 'user', content: 'Frage 1' },
    { role: 'user', content: 'Frage 1b' },
    { role: 'assistant', content: '  ' },
    { role: 'assistant', content: 'Antwort' },
    { role: 'user', content: 'Frage 2' },
  ]);
  assert.deepEqual(r, [
    { role: 'user', content: 'Frage 1\n\nFrage 1b' },
    { role: 'assistant', content: 'Antwort' },
    { role: 'user', content: 'Frage 2' },
  ]);
});

test('leerer oder ungültiger Verlauf', () => {
  assert.deepEqual(cleanHistory(null), []);
  assert.deepEqual(cleanHistory([{ role: 'system', content: 'x' }, { role: 'assistant', content: 'y' }]), []);
});
