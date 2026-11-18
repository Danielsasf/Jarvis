const test = require('node:test');
const assert = require('node:assert');
const { coreLoads, create, pct } = require('../src/sysdetail');

test('coreLoads: Last pro Kern aus zwei Messungen', () => {
  const prev = [{ user: 0, idle: 0 }, { user: 0, idle: 0 }];
  const now = [{ user: 50, idle: 50 }, { user: 100, idle: 0 }];
  assert.deepEqual(coreLoads(prev, now), [50, 100]);
});
test('coreLoads: ohne Vergleichswert oder ohne Zeitunterschied null, nie erfunden', () => {
  assert.deepEqual(coreLoads([{ user: 5, idle: 5 }], [{ user: 5, idle: 5 }]), [null]);
  assert.deepEqual(coreLoads([], [{ user: 1, idle: 1 }]), [null]);
  assert.deepEqual(coreLoads(null, null), []);
});
test('pct begrenzt auf 0..100 und lehnt Unsinn ab', () => {
  assert.equal(pct(140), 100); assert.equal(pct(-3), 0); assert.equal(pct(NaN), null); assert.equal(pct('5'), null);
});
test('sample: Werte aus Fake-System, Laufwerk-Fehler gibt null', async () => {
  let t = 0;
  const os = {
    cpus: () => { t += 100; return [{ model: '  Fake   CPU ', times: { user: t / 2, idle: t / 2 } }, { model: 'x', times: { user: t, idle: 0 } }]; },
    totalmem: () => 16 * 2 ** 30, freemem: () => 4 * 2 ** 30, uptime: () => 3600,
  };
  const fs = { promises: { statfs: async () => ({ blocks: 1000, bsize: 1, bavail: 250 }) } };
  const s = await create(os, fs, 'C:\\')();
  assert.deepEqual(s.cpu.cores, [50, 100]);
  assert.equal(s.cpu.total, 75);
  assert.equal(s.mem.used, 12 * 2 ** 30);
  assert.equal(s.disk.use, 75);
  assert.equal(s.uptime, 3600);
  assert.equal(s.cpuName, 'Fake CPU');
  const bad = await create(os, { promises: { statfs: async () => { throw new Error('x'); } } }, '/')();
  assert.equal(bad.disk, null);
});
