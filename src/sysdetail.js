// Echte Systemwerte für die Leitstand-Ansicht. Nur Zahlen (Prozent, Bytes, Sekunden), keine Namen, keine Dateien.
// Nur Node-Bordmittel (os, fs.statfs): keine Zusatzpakete, keine Programme starten.
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v) => { const n = num(v); return n === null ? null : Math.max(0, Math.min(100, Math.round(n))); };

// Last pro Kern zwischen zwei Messungen von os.cpus()[i].times
function coreLoads(prev, now) {
  if (!Array.isArray(prev) || !Array.isArray(now)) return [];
  return now.slice(0, 64).map((t, i) => {
    const p = prev[i];
    if (!p || !t) return null;
    let total = 0; let idle = 0;
    for (const k of Object.keys(t)) { const d = (t[k] || 0) - (p[k] || 0); total += d; if (k === 'idle') idle += d; }
    return total > 0 ? pct((1 - idle / total) * 100) : null;
  });
}

const snap = (os) => os.cpus().map((c) => ({ ...c.times }));

function create(os, fs, diskRoot) {
  let prev = snap(os);
  return async function sample() {
    const now = snap(os);
    const cores = coreLoads(prev, now);
    prev = now;
    const valid = cores.filter((c) => c !== null);
    const total = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    let disk = null;
    try {
      const s = await fs.promises.statfs(diskRoot);
      const size = Number(s.blocks) * Number(s.bsize); const free = Number(s.bavail) * Number(s.bsize);
      if (size > 0) disk = { use: pct((1 - free / size) * 100), total: size, free };
    } catch { /* bleibt null, Anzeige "--" */ }
    const totalMem = num(os.totalmem()); const freeMem = num(os.freemem());
    return {
      cpu: { total, cores },
      mem: totalMem ? { total: totalMem, used: totalMem - (freeMem || 0) } : null,
      disk,
      uptime: num(os.uptime()),
      cpuName: String((os.cpus()[0] && os.cpus()[0].model) || '').replace(/\s+/g, ' ').trim().slice(0, 48) || null,
    };
  };
}

module.exports = { coreLoads, create, pct };
