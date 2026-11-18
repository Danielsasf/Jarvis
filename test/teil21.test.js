const test = require('node:test');
const assert = require('node:assert/strict');
const ad = require('../src/addressing');

const accounts = {
  anthropic: { type: 'anthropic' },
  gemini: { type: 'gemini', alias: 'Gem, Googlie' },
  ollama: { type: 'ollama', label: 'Mein Olli' },
};
const order = ['anthropic', 'gemini', 'ollama'];

test('Name am Anfang mit Komma: nur diese KI', () => {
  assert.deepEqual(ad.parseAddress('Claude, erkläre das', accounts, order), { id: 'anthropic', rest: 'erkläre das' });
  assert.deepEqual(ad.parseAddress('Gemini: mach eine Liste', accounts, order), { id: 'gemini', rest: 'mach eine Liste' });
  assert.deepEqual(ad.parseAddress('gem, hallo', accounts, order), { id: 'gemini', rest: 'hallo' });
  assert.deepEqual(ad.parseAddress('Mein Olli, Wetter?', accounts, order), { id: 'ollama', rest: 'Wetter?' });
});

test('Name mitten im Satz oder ohne Komma: keine Ansprache', () => {
  assert.equal(ad.parseAddress('Ich habe mit Gemini gesprochen', accounts, order), null);
  assert.equal(ad.parseAddress('Claude erkläre das', accounts, order), null);
  assert.equal(ad.parseAddress('Gemini, ', accounts, order), null);
});

test('Jarvis oder unbekannte Namen laufen wie bisher', () => {
  assert.equal(ad.parseAddress('Jarvis, erkläre das', accounts, order), null);
  assert.equal(ad.parseAddress('Erkläre das, bitte', accounts, order), null);
  assert.equal(ad.parseAddress('Groq, hallo', accounts, order), null); // nicht verbunden
});

test('Nur aktive KIs zählen (order), eigener Name geht zuerst', () => {
  assert.equal(ad.parseAddress('Claude, hi', accounts, ['gemini']), null);
  assert.deepEqual(ad.aliasesFor({ type: 'openai' }), ['chatgpt', 'gpt']);
});
