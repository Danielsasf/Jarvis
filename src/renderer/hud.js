// Gestochen scharfer HUD-Kern (eigenes Design): Trommel, Messring, Pegel-Segmente, Fadenkreuz.
// Mehrschichtig wie ein Instrumenten-Display, alles ohne Weichzeichner gezeichnet.
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
    const label = (x, y, a, r, text, px, al) => {
      ctx.save(); ctx.translate(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = c(al); ctx.font = `${px}px "Cascadia Mono", Consolas, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 0); ctx.restore();
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
      const x = w / 2; const y = h / 2; const R = Math.min(w, h) / 2 - 2;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'butt';
      const small = R < 76;

      // 0) Grundscheibe: dunkler Teller mit feinem Rand
      if (!small) {
        const g0 = ctx.createRadialGradient(x, y, R * 0.1, x, y, R);
        g0.addColorStop(0, 'rgba(8,16,22,.85)'); g0.addColorStop(0.72, 'rgba(6,12,17,.55)'); g0.addColorStop(1, 'rgba(4,9,13,0)');
        ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fillStyle = g0; ctx.fill();
      }

      // 1) Äußerer Gradkranz mit Beschriftung
      if (!small) {
        for (let i = 0; i < 240; i++) {
          const a = (i / 240) * TAU - Math.PI / 2;
          const major = i % 20 === 0; const mid = i % 5 === 0;
          tick(x, y, a, R * (major ? 0.9 : mid ? 0.925 : 0.945), R * 0.985, major ? 1.5 : 1, major ? 0.95 : mid ? 0.55 : 0.28);
        }
        for (let d = 0; d < 360; d += 30) {
          label(x, y, (d / 360) * TAU - Math.PI / 2, R * 0.845, String(d).padStart(3, '0'), Math.max(7, R * 0.032), 0.6);
        }
      }

      // 2) Trommel: 60 Blöcke, langsam drehend, jeder sechste hell
      if (!small) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.045);
        const blocks = 60; const rb = R * 0.875;
        for (let i = 0; i < blocks; i++) {
          const a0 = (i / blocks) * TAU; const span = (TAU / blocks) * 0.66;
          const bright = i % 6 === 0;
          arc(0, 0, rb, a0, a0 + span, bright ? 7 : 4, bright ? 0.55 : 0.2);
        }
        ctx.restore();
      }

      // 3) Gegenläufiger Strichring
      ctx.save(); ctx.translate(x, y); ctx.rotate(-t * 0.28);
      ring(0, 0, R * (small ? 0.8 : 0.825), 1, 0.45, [2, 6]);
      ctx.restore();

      // 4) Messring mit Lücken und 12 Marken
      const r2 = R * (small ? 0.9 : 0.775);
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.16);
      for (const [a0, a1] of [[0.04, 1.28], [1.42, 2.02], [2.18, 3.86], [4.02, 4.42], [4.58, 6.08]]) arc(0, 0, r2, a0, a1, small ? 2 : 2.4, 0.9);
      for (let i = 0; i < 12; i++) tick(0, 0, (i / 12) * TAU, r2 - 7, r2 + 7, i % 3 === 0 ? 2 : 1, 0.85);
      ctx.restore();

      // 5) Pegel-Segmente (Anzahl = Aktivität)
      const segs = small ? 24 : 56;
      const r4 = R * (small ? 0.62 : 0.655);
      const lit = mode === 'thinking' ? null : Math.round(Math.min(1, 0.18 + level) * segs);
      ctx.save(); ctx.translate(x, y); ctx.rotate(-t * 0.09);
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU; const a1 = a0 + (TAU / segs) * 0.58;
        let on;
        if (lit === null) {
          const head = ((t * 1.6) % 1) * segs;
          const d = (i - head + segs) % segs;
          on = d < segs * 0.3 ? 1 - (d / (segs * 0.3)) * 0.8 : 0.1;
        } else on = i < lit ? 0.95 : 0.12;
        arc(0, 0, r4, a0, a1, small ? 3 : 6, on);
      }
      ctx.restore();

      // 6) Innenringe, Klammern, Fadenkreuz
      if (!small) {
        ring(x, y, R * 0.55, 1, 0.45);
        ring(x, y, R * 0.48, 1, 0.22, [1, 4]);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + Math.PI / 4;
          const cx = Math.cos(a) * R * 0.52; const cy = Math.sin(a) * R * 0.52;
          ctx.save(); ctx.translate(x + cx, y + cy); ctx.rotate(a);
          ctx.strokeStyle = c(0.5); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, -5); ctx.lineTo(5, 5); ctx.stroke();
          ctx.restore();
        }
        for (let i = 0; i < 4; i++) tick(x, y, (i / 4) * TAU, R * 0.3, R * 0.44, 1, 0.45);
      }

      // 7) Radar-Sweep, beim Nachdenken stärker
      if (speed > 2) {
        const a = t * 2.2;
        tick(x, y, a, R * 0.3, R * 0.74, 1.6, 0.95);
        arc(x, y, R * 0.74, a - 0.55, a, 1.6, 0.55);
      }

      // 8) Kern: heller Mittelpunkt, drei Ringe
      const pulse = 1 + level * 0.26 + Math.sin(now / 1000) * 0.015;
      const cr = R * (small ? 0.4 : 0.2) * pulse;
      const g = ctx.createRadialGradient(x, y, 0, x, y, cr * 1.05);
      g.addColorStop(0, 'rgba(244,254,255,1)'); g.addColorStop(0.42, c(0.95)); g.addColorStop(0.9, c(0.5)); g.addColorStop(1, c(0.45));
      ctx.beginPath(); ctx.arc(x, y, cr, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ring(x, y, cr + 3, 1, 0.9);
      ring(x, y, cr + 8, 1, 0.32, [2, 4]);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      setMode(m, text) { if (PALETTE[m]) mode = m; },
      setLevel(v) { targetLevel = Math.max(0, Math.min(1, v)); },
      bump(v = 0.6) { targetLevel = Math.max(targetLevel, v); },
    };
  }
  window.HUD = { create };
})();
