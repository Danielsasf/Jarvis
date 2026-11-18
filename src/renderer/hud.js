// Gestochen scharfer HUD-Kern (eigenes Design): feine Linien statt Weichzeichner.
// Gradskala, gegenläufige Messringe, Segment-Pegel, Fadenkreuz, scharfer Kern.
(() => {
  const PALETTE = {
    idle: [72, 220, 255], thinking: [150, 236, 255], listening: [255, 176, 64], speaking: [96, 228, 255], error: [255, 92, 92],
  };
  const SPEED = { idle: 1, thinking: 3.4, listening: 1.5, speaking: 1.8, error: 0.5 };
  const TAU = Math.PI * 2;

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let mode = 'idle';
    let level = 0; let targetLevel = 0;
    const col = [...PALETTE.idle];
    let speed = 1; let t = 0; let last = performance.now();
    let label = 'BEREIT';
    const waves = []; let waveT = 0;
    const motes = Array.from({ length: 26 }, () => ({ a: Math.random() * TAU, r: 0.3 + Math.random() * 0.45, v: (0.2 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1), s: 0.8 + Math.random() * 1.4, ph: Math.random() * 6 }));

    function size() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = canvas.clientWidth; const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return [w, h];
    }
    const c = (a) => `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a})`;
    const ring = (x, y, r, w, a, dash) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.lineWidth = w; ctx.strokeStyle = c(a);
      ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]);
    };
    const arc = (x, y, r, a0, a1, w, a) => { ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.lineWidth = w; ctx.strokeStyle = c(a); ctx.stroke(); };
    const tick = (x, y, a, r0, r1, w, al) => {
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.lineWidth = w; ctx.strokeStyle = c(al); ctx.stroke();
    };

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const target = PALETTE[mode];
      for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * Math.min(1, dt * 6);
      speed += (SPEED[mode] - speed) * Math.min(1, dt * 3);
      level += (targetLevel - level) * Math.min(1, dt * 14);
      if (mode !== 'listening') targetLevel *= 0.9;
      t += dt * speed;

      const [w, h] = size();
      const x = w / 2; const y = h / 2; const R = Math.min(w, h) / 2 - 4;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'butt';
      const small = R < 70;

      // 0) Weicher Lichthof + Druckwellen, die vom Kern nach außen laufen
      if (!small) {
        const hg = ctx.createRadialGradient(x, y, R * 0.1, x, y, R * 0.95);
        hg.addColorStop(0, c(0.16 + level * 0.2)); hg.addColorStop(0.6, c(0.05)); hg.addColorStop(1, c(0));
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, y, R * 0.95, 0, TAU); ctx.fill();
        waveT += dt * (mode === 'thinking' ? 1.6 : mode === 'idle' ? 0.22 : 0.7) + level * dt * 1.2;
        if (waveT > 1) { waveT = 0; waves.push(0); }
        for (let i = waves.length - 1; i >= 0; i--) {
          waves[i] += dt * 0.55;
          if (waves[i] > 1) { waves.splice(i, 1); continue; }
          ring(x, y, R * (0.25 + waves[i] * 0.7), 1.4, 0.5 * (1 - waves[i]) * (1 - waves[i]));
        }
      }
      // 1) Gradskala (fest): 180 Striche, alle 30° beschriftet
      if (!small) {
        for (let i = 0; i < 180; i++) {
          const a = (i / 180) * TAU - Math.PI / 2;
          const major = i % 15 === 0; const mid = i % 5 === 0;
          tick(x, y, a, R * (major ? 0.905 : mid ? 0.93 : 0.945), R * 0.97, major ? 1.4 : 1, major ? 0.95 : mid ? 0.6 : 0.3);
        }
        ctx.font = `${Math.max(8, R * 0.045)}px "Cascadia Mono", Consolas, monospace`;
        ctx.fillStyle = c(0.7); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let d = 0; d < 360; d += 30) {
          const a = (d / 360) * TAU - Math.PI / 2;
          ctx.fillText(String(d).padStart(3, '0'), x + Math.cos(a) * R * 0.86, y + Math.sin(a) * R * 0.86);
        }
        ring(x, y, R * 0.985, 1, 0.35);
      }
      // 2) Rotierender Messring mit Lücken und Markierungen
      const r2 = R * (small ? 0.9 : 0.8);
      ctx.save(); ctx.shadowColor = c(0.85); ctx.shadowBlur = small ? 4 : 9;
      ctx.translate(x, y); ctx.rotate(t * 0.22);
      for (const [a0, a1] of [[0.05, 1.3], [1.45, 2.05], [2.2, 3.9], [4.05, 4.45], [4.6, 6.1]]) arc(0, 0, r2, a0, a1, small ? 2 : 1.6, 0.9);
      for (let i = 0; i < 6; i++) tick(0, 0, (i / 6) * TAU, r2 - 6, r2 + 6, 1.2, 0.9);
      ctx.restore();
      // 2b) Umlaufende Lichtpunkte mit Schweif
      if (!small) {
        ctx.save(); ctx.shadowColor = c(0.9); ctx.shadowBlur = 8;
        for (const [rr, sp, ph] of [[0.8, 0.9, 0], [0.8, 0.9, Math.PI], [0.57, -1.3, 1]]) {
          const a = t * sp + ph; const dir = sp > 0 ? -1 : 1;
          for (let k = 0; k < 10; k++) arc(x, y, R * rr, a + dir * k * 0.045, a + dir * (k + 1) * 0.045, 2.2, 0.8 * (1 - k / 10));
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * R * rr, y + Math.sin(a) * R * rr, 2.6, 0, TAU); ctx.fillStyle = 'rgba(240,253,255,.95)'; ctx.fill();
        }
        ctx.restore();
        // Warnfarbener Bogen innen, schneller beim Nachdenken
        const hot = mode === 'thinking' ? 1 : mode === 'listening' ? 0.8 : 0.45;
        ctx.save(); ctx.shadowColor = 'rgba(255,92,92,.9)'; ctx.shadowBlur = 8 * hot;
        const ra = -t * (mode === 'thinking' ? 1.4 : 0.5);
        ctx.beginPath(); ctx.arc(x, y, R * 0.52, ra, ra + 0.9); ctx.lineWidth = 2.4; ctx.strokeStyle = `rgba(255,96,96,${0.35 + 0.6 * hot})`; ctx.stroke(); ctx.restore();
      }
      // 2c) Vier Eck-Klammern außen, drehen langsam; schwebende Energiepunkte
      if (!small) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.12); ctx.shadowColor = c(0.9); ctx.shadowBlur = 6;
        for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; arc(0, 0, R * 1.0, a - 0.11, a + 0.11, 3, 0.95); }
        ctx.restore();
        ctx.save(); ctx.shadowColor = c(0.9); ctx.shadowBlur = 6;
        for (const m of motes) {
          m.a += m.v * dt * (0.25 + speed * 0.5);
          const rr = R * (m.r + Math.sin(t * 0.8 + m.ph) * 0.03);
          ctx.beginPath(); ctx.arc(x + Math.cos(m.a) * rr, y + Math.sin(m.a) * rr, m.s, 0, TAU);
          ctx.fillStyle = c(0.35 + 0.5 * Math.abs(Math.sin(t + m.ph))); ctx.fill();
        }
        ctx.restore();
      }
      // 3) Gestrichelter Ring gegenläufig
      ctx.save(); ctx.translate(x, y); ctx.rotate(-t * 0.35);
      ring(0, 0, R * (small ? 0.74 : 0.73), 1, 0.55, [2, 5]);
      ctx.restore();
      // 4) Segment-Ring: Anzahl leuchtender Segmente = Pegel/Aktivität
      const segs = small ? 24 : 48;
      const r4 = R * (small ? 0.62 : 0.66);
      const lit = mode === 'thinking' ? null : Math.round(Math.min(1, 0.18 + level) * segs);
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.08);
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU; const a1 = a0 + (TAU / segs) * 0.62;
        let on;
        if (lit === null) { const head = (t * 1.6) % 1 * segs; on = ((i - head + segs) % segs) < segs * 0.3 ? 0.95 - (((i - head + segs) % segs) / (segs * 0.3)) * 0.75 : 0.12; }
        else on = i < lit ? 0.9 : 0.14;
        arc(0, 0, r4, a0, a1, small ? 3 : 5, on);
      }
      ctx.restore();
      // 5) Innenringe + Fadenkreuz
      if (!small) {
        ring(x, y, R * 0.57, 1, 0.5);
        ring(x, y, R * 0.47, 1, 0.3, [1, 3]);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU;
          tick(x, y, a, R * 0.3, R * 0.44, 1, 0.55);
        }
        // Sweep beim Nachdenken: scharfe Linie
        if (speed > 2) {
          const a = t * 2.4;
          tick(x, y, a, R * 0.32, R * 0.78, 1.5, 0.95);
          arc(x, y, R * 0.78, a - 0.5, a, 1.5, 0.6);
        }
      }
      // 6) Kern: scharfer Rand, heller Mittelpunkt
      const pulse = 1 + level * 0.28 + Math.sin(now / 1000) * 0.015;
      const cr = R * (small ? 0.42 : 0.24) * pulse;
      ctx.save(); ctx.shadowColor = c(0.95); ctx.shadowBlur = R * 0.16;
      const g = ctx.createRadialGradient(x, y, 0, x, y, cr);
      g.addColorStop(0, 'rgba(240,253,255,1)'); g.addColorStop(0.45, c(0.95)); g.addColorStop(0.92, c(0.55)); g.addColorStop(1, c(0.55));
      ctx.beginPath(); ctx.arc(x, y, cr, 0, TAU); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      // Reaktor im Kern: gegenläufige Sechsecke + Speichen
      if (!small) {
        const hex = (rad, rot, w, al, col2) => {
          ctx.beginPath();
          for (let i = 0; i <= 6; i++) { const a = rot + (i / 6) * TAU; const px = x + Math.cos(a) * rad; const py = y + Math.sin(a) * rad; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
          ctx.lineWidth = w; ctx.strokeStyle = col2 || c(al); ctx.stroke();
        };
        ctx.save(); ctx.shadowColor = c(0.8); ctx.shadowBlur = 5;
        hex(cr * 0.82, t * 0.9, 1.4, 0, 'rgba(4,24,36,.75)');
        hex(cr * 0.5, -t * 1.3, 1.2, 0, 'rgba(4,24,36,.6)');
        for (let i = 0; i < 6; i++) { const a = t * 0.9 + (i / 6) * TAU; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * cr * 0.18, y + Math.sin(a) * cr * 0.18); ctx.lineTo(x + Math.cos(a) * cr * 0.82, y + Math.sin(a) * cr * 0.82); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(4,24,36,.5)'; ctx.stroke(); }
        ctx.restore();
        // Lichtreflex wandert über den Kern
        const fa = t * 0.6; const fg = ctx.createRadialGradient(x + Math.cos(fa) * cr * 0.45, y + Math.sin(fa) * cr * 0.45, 0, x + Math.cos(fa) * cr * 0.45, y + Math.sin(fa) * cr * 0.45, cr * 0.5);
        fg.addColorStop(0, 'rgba(255,255,255,.55)'); fg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(x, y, cr, 0, TAU); ctx.fill();
        // Zwei Zacken-Ringe um den Kern
        ctx.save(); ctx.translate(x, y); ctx.rotate(-t * 0.5);
        for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; tick(0, 0, a, cr + 10, cr + (i % 2 ? 14 : 18), 1.2, 0.75); }
        ctx.restore();
      }
      ring(x, y, cr + 3, 1, 0.9);
      ring(x, y, cr + 7, 1, 0.35);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      setMode(m, text) { if (PALETTE[m]) mode = m; if (text) label = text; },
      setLevel(v) { targetLevel = Math.max(0, Math.min(1, v)); },
      bump(v = 0.6) { targetLevel = Math.max(targetLevel, v); },
    };
  }
  window.HUD = { create };
})();
