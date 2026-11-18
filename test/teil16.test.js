const test = require('node:test');
const assert = require('node:assert/strict');
const { ProviderError, isRetryable, callWithRetry, runWithFallback } = require('../src/router');
const health = require('../src/health');

const noSleep = { sleep: async () => {} };

test('Limit-Fehler und lange Wartezeiten werden nicht wiederholt', () => {
  assert.equal(isRetryable(new ProviderError('x', { status: 429, limit: true })), false);
  assert.equal(isRetryable(new ProviderError('x', { status: 429, retryAfterMs: 30000 })), false);
  assert.equal(isRetryable(new ProviderError('x', { status: 429, retryAfterMs: 2000 })), true);
  assert.equal(isRetryable(new ProviderError('x', { status: 503 })), true);
});

test('Wartezeit bei Retry-After wird auf 10 s begrenzt', async () => {
  let n = 0; const waits = [];
  await callWithRetry(async () => { if (n++ === 0) throw new ProviderError('x', { status: 429, retryAfterMs: 9000 }); return 'ok'; },
    { sleep: async (ms) => { waits.push(ms); }, maxRetries: 2, timeoutMs: 1000 });
  assert.deepEqual(waits, [9000]);
});

test('classify: Limit, Guthaben, Schlüssel, überlastet, kurzer Ausfall', () => {
  assert.equal(health.classify(new ProviderError('x', { status: 429, limit: true })).kind, 'limit');
  assert.equal(health.classify(new ProviderError('x', { status: 429, limit: true })).pauseMs, 3600000);
  assert.equal(health.classify(new ProviderError('x', { status: 429, retryAfterMs: 5000 })).pauseMs, 60000);
  assert.equal(health.classify(new ProviderError('x', { status: 402, limit: true })).kind, 'billing');
  assert.equal(health.classify(new ProviderError('x', { status: 401 })).kind, 'auth');
  assert.equal(health.classify(new ProviderError('x', { status: 529 })).kind, 'overloaded');
  assert.equal(health.classify(new ProviderError('x', { network: true }), { local: true }).pauseMs, 15000);
  assert.equal(health.classify(new ProviderError('x', { status: 404, modelGone: true })), null);
  assert.equal(health.classify(new ProviderError('x', { lost: true })), null);
});

test('arrange: freie KIs zuerst, pausierte zuletzt (früheste Freigabe zuerst)', () => {
  const now = 1000000;
  const acc = { a: { pausedUntil: now + 5000 }, b: {}, c: { pausedUntil: now + 1000 }, d: { pausedUntil: now - 1 } };
  const r = health.arrange(['a', 'b', 'c', 'd'], acc, now);
  assert.deepEqual(r.chain, ['b', 'd', 'c', 'a']);
  assert.deepEqual(r.free, ['b', 'd']);
});

test('pause/clear', () => {
  const a = {};
  assert.equal(health.pause(a, { kind: 'limit', pauseMs: 1000 }, 500), true);
  assert.equal(health.isPaused(a, 900), true);
  assert.equal(health.isPaused(a, 1600), false);
  assert.equal(health.clear(a), true);
  assert.equal(a.pausedUntil, undefined);
});

test('Nacheinander: leere KI A wird übersprungen, B antwortet, Fehler liefert err', async () => {
  const calls = [];
  const chain = [
    { id: 'a', label: 'A', run: async () => { calls.push('a'); throw new ProviderError('leer', { status: 429, limit: true }); } },
    { id: 'b', label: 'B', run: async () => { calls.push('b'); return 'hallo'; } },
  ];
  const r = await runWithFallback(chain, { ...noSleep, parallel: 1, hedgeMs: 0, maxRetries: 1, timeoutMs: 1000 });
  assert.equal(r.text, 'hallo');
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(r.failures[0].err.limit, true);
});

test('step.timeoutMs überschreibt das Standard-Timeout', async () => {
  const chain = [{ id: 'l', label: 'L', timeoutMs: 500, run: async () => { await new Promise((ok) => setTimeout(ok, 80)); return 'spät'; } }];
  const r = await runWithFallback(chain, { ...noSleep, timeoutMs: 20, maxRetries: 0 });
  assert.equal(r.text, 'spät');
});
