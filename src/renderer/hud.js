// Animierter Hologramm-Kern (eigenes Design): Teilstrich-Ring, gegenläufige Bogenringe,
// Sweep-Balken beim Nachdenken, Pegel-Puls beim Zuhören/Sprechen.
(() => {
  const PALETTE = {
    idle: [58, 214, 255], thinking: [120, 230, 255], listening: [255, 170, 60], speaking: [80, 225, 255], error: [255, 90, 90],
  };
  const SPEED = { idle: 1, thinking: 3.2, listening: 1.6, speaking: 1.8, error: 0.6 };

  function create(canvas) {
    let compact = false;
    const ctx = canvas.getContext('2d');
    let mode = 'idle';
    let level = 0; let targetLevel = 0;
    let col = [...PALETTE.idle];
    let speed = 1;
    let t = 0; let last = performance.now();
    const particles = Array.from({ length: 26 }, () => ({ a: Math.random() * Math.PI * 2, r: 0.55 + Math.random() * 0.4, s: (Math.random() - 0.5) * 0.6, z: Math.random() }));

    function size() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth; const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return [w, h];
    }
    const rgba = (a) => `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a})`;

    function arc(cx, cy, r, a0, a1, width, alpha) {
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.lineWidth = width; ctx.strokeStyle = rgba(alpha); ctx.stroke();
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const target = PALETTE[mode];
      for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * Math.min(1, dt * 5);
      speed += (SPEED[mode] - speed) * Math.min(1, dt * 3);
      level += (targetLevel - level) * Math.min(1, dt * 12);
      if (mode !== 'listening') targetLevel *= 0.9;
      t += dt * speed;

      const [w, h] = size();
      const cx = w / 2; const cy = h / 2; const R = Math.min(w, h) / 2 - 2;
      compact = R < 60;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'butt';
      ctx.shadowBlur = compact ? 4 : 12; ctx.shadowColor = rgba(0.8);

      // Teilstrich-Ring
      if (!compact) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.08);
        for (let i = 0; i < 120; i++) {
          const a = (i / 120) * Math.PI * 2;
          const long = i % 10 === 0;
          const r1 = R * 0.97; const r0 = R * (long ? 0.90 : 0.935);
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.lineWidth = long ? 1.6 : 0.8; ctx.strokeStyle = rgba(long ? 0.75 : 0.35); ctx.stroke();
        }
        ctx.restore();
      }
      // Bogenringe (gegenläufig)
      const rings = compact
        ? [[0.86, 0.6, 3, [[0, 1.2], [1.6, 2.6], [3.4, 4.9]]], [0.66, -0.9, 2, [[0.4, 2.2], [3.2, 5.6]]]]
        : [[0.82, 0.35, 3, [[0, 0.9], [1.2, 2.5], [2.9, 3.2], [3.6, 5.3]]], [0.72, -0.55, 1.5, [[0.2, 1.7], [2.3, 4.1], [4.6, 6.0]]],
          [0.62, 0.8, 6, [[0, 0.5], [0.9, 1.1], [2.1, 3.4], [4.2, 4.5], [5.0, 5.8]]], [0.52, -1.3, 1, [[0, 6.28]]]];
      for (const [rr, sp, wd, segs] of rings) {
        const rot = t * sp;
        for (const [a0, a1] of segs) arc(cx, cy, R * rr, a0 + rot, a1 + rot, wd, wd > 4 ? 0.55 : 0.8);
      }
      // Sweep beim Nachdenken
      if (speed > 1.9) {
        const a = t * 2.2;
        const g = ctx.createConicGradient ? ctx.createConicGradient(a, cx, cy) : null;
        if (g) {
          g.addColorStop(0, rgba(0.35)); g.addColorStop(0.12, rgba(0)); g.addColorStop(1, rgba(0));
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        }
      }
      // Kern
      const pulse = 1 + level * 0.35 + Math.sin(now / 900) * 0.025;
      const cr = R * (compact ? 0.42 : 0.34) * pulse;
      ctx.shadowBlur = compact ? 10 : 40;
      const grad = ctx.createRadialGradient(cx - cr * 0.25, cy - cr * 0.3, cr * 0.05, cx, cy, cr);
      grad.addColorStop(0, 'rgba(235,252,255,0.95)'); grad.addColorStop(0.35, rgba(0.9)); grad.addColorStop(0.8, rgba(0.25)); grad.addColorStop(1, rgba(0));
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
      ctx.shadowBlur = 0;
      if (!compact) {
        // Pegel-Ring
        arc(cx, cy, R * 0.43, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, level), 2.5, 0.9);
        // Partikel
        for (const p of particles) {
          p.a += p.s * dt * speed;
          const r = R * p.r;
          ctx.beginPath(); ctx.arc(cx + Math.cos(p.a) * r, cy + Math.sin(p.a) * r, 0.6 + p.z * 1.4, 0, Math.PI * 2);
          ctx.fillStyle = rgba(0.25 + p.z * 0.5); ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      setMode(m) { if (PALETTE[m]) mode = m; },
      setLevel(v) { targetLevel = Math.max(0, Math.min(1, v)); },
      bump(v = 0.6) { targetLevel = Math.max(targetLevel, v); },
    };
  }
  window.HUD = { create };
})();
