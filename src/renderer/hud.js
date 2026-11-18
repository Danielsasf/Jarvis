// NEXUS-Kern: dunkler Reaktor mit Hex-Ringen, Datenband, Partikeln und Lichtkern.
// Alles gezeichnet (kein Bild, kein Filter) – Farben Cyan/Violett, Modus ändert den Ton.
(() => {
  const PALETTE = {
    idle: [64, 240, 226], thinking: [186, 128, 255], listening: [255, 190, 96], speaking: [120, 250, 255], error: [255, 84, 118],
  };
  const SPEED = { idle: 1, thinking: 3.2, listening: 1.4, speaking: 1.7, error: 0.5 };
  const TAU = Math.PI * 2;
  const VIOLET = 'rgba(139, 92, 255,';

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
    const arc = (x, y, r, a0, a1, w, a) => {
      ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.lineWidth = w; ctx.strokeStyle = c(a); ctx.lineCap = 'round'; ctx.stroke();
    };
    const hex = (x, y, r, rot, w, a) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = rot + i * Math.PI / 3 - Math.PI / 2;
        const px = x + Math.cos(ang) * r; const py = y + Math.sin(ang) * r;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.lineWidth = w; ctx.strokeStyle = c(a); ctx.stroke();
    };

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const target = PALETTE[mode];
      for (let i = 0; i < 3; i++) col[i] += (target[i] - col[i]) * Math.min(1, dt * 5);
      speed += (SPEED[mode] - speed) * Math.min(1, dt * 3);
      level += (targetLevel - level) * Math.min(1, dt * 12);
      if (mode !== 'listening') targetLevel *= 0.9;
      t += dt * speed;

      const [w, h] = size();
      const x = w / 2; const y = h / 2; const R = Math.min(w, h) / 2 - 3;
      ctx.clearRect(0, 0, w, h);
      const small = R < 78;

      // Aura
      const halo = ctx.createRadialGradient(x, y, R * 0.12, x, y, R * 1.05);
      halo.addColorStop(0, c(0.16 + level * 0.22));
      halo.addColorStop(0.38, VIOLET + ' .2)');
      halo.addColorStop(0.72, VIOLET + ' .06)');
      halo.addColorStop(1, 'rgba(5,4,10,0)');
      ctx.beginPath(); ctx.arc(x, y, R * 1.05, 0, TAU); ctx.fillStyle = halo; ctx.fill();

      // 1) Drei Hex-Ringe, gegenläufig
      hex(x, y, R * 0.94, t * 0.06, 1, 0.30);
      hex(x, y, R * 0.88, -t * 0.05 + 0.5, 1.4, 0.5);
      if (!small) {
        hex(x, y, R * 0.56, t * 0.03 + 1.2, 1, 0.22);
        // Ecken-Punkte des mittleren Hexagons
        for (let i = 0; i < 6; i++) {
          const ang = -t * 0.05 + 0.5 + i * Math.PI / 3 - Math.PI / 2;
          ctx.beginPath(); ctx.arc(x + Math.cos(ang) * R * 0.88, y + Math.sin(ang) * R * 0.88, 2.2, 0, TAU);
          ctx.fillStyle = i % 2 ? VIOLET + ' .9)' : c(0.9); ctx.fill();
        }
      }

      // 2) Datenband: 64 Blöcke, Welle läuft um
      const blocks = small ? 32 : 64;
      const rb = R * 0.80;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.05);
      for (let i = 0; i < blocks; i++) {
        const a0 = (i / blocks) * TAU; const a1 = a0 + (TAU / blocks) * 0.5;
        const wave = 0.5 + 0.5 * Math.sin(i * 0.55 - t * 2.4);
        const hot = wave > 0.82;
        ctx.beginPath(); ctx.arc(0, 0, rb, a0, a1);
        ctx.lineWidth = hot ? 7 : 4; ctx.strokeStyle = hot ? c(0.95) : VIOLET + (0.18 + wave * 0.35) + ')';
        ctx.lineCap = 'butt'; ctx.stroke();
      }
      ctx.restore();

      // 3) Zwei Messbögen
      ctx.save(); ctx.translate(x, y); ctx.rotate(-t * 0.22);
      for (const [a0, a1] of [[0.05, 1.35], [1.55, 2.35], [2.6, 4.1], [4.3, 6.1]]) arc(0, 0, R * 0.70, a0, a1, small ? 2 : 2.6, 0.85);
      ctx.restore();
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.15);
      arc(0, 0, R * 0.645, 0.4, 2.4, 1.2, 0.45);
      arc(0, 0, R * 0.645, 3.6, 5.6, 1.2, 0.45);
      ctx.restore();

      // 4) Partikel auf Umlaufbahnen
      const n = small ? 16 : 30;
      for (let i = 0; i < n; i++) {
        const rr = R * (0.40 + ((i * 53) % 100) / 100 * 0.46);
        const sp = (i % 2 ? 1 : -1) * (0.10 + (i % 6) * 0.03);
        const a = t * sp + i * 1.3;
        const px = x + Math.cos(a) * rr; const py = y + Math.sin(a) * rr;
        const rad = i % 6 === 0 ? 2.4 : 1.3;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU);
        ctx.fillStyle = i % 3 ? c(0.75) : VIOLET + ' .85)'; ctx.fill();
      }

      // 5) Fadenkreuz-Klammern
      if (!small) {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU;
          const r0 = R * 0.30; const r1 = R * 0.42;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
          ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
          ctx.lineWidth = 1; ctx.strokeStyle = VIOLET + ' .55)'; ctx.stroke();
        }
      }

      // 6) Sweep beim Nachdenken
      if (speed > 2) {
        const a = t * 2.1;
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * R * 0.78, y + Math.sin(a) * R * 0.78);
        ctx.lineWidth = 1.6; ctx.strokeStyle = c(0.9); ctx.stroke();
        arc(x, y, R * 0.78, a - 0.5, a, 2, 0.5);
      }

      // 7) Kern
      const pulse = 1 + level * 0.3 + Math.sin(now / 900) * 0.02;
      const cr = R * (small ? 0.16 : 0.13) * pulse;
      const g = ctx.createRadialGradient(x, y, 0, x, y, cr * 2.6);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.22, c(1));
      g.addColorStop(0.55, c(0.35));
      g.addColorStop(1, 'rgba(5,4,10,0)');
      ctx.beginPath(); ctx.arc(x, y, cr * 2.6, 0, TAU); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, cr, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
      for (let i = 0; i < 3; i++) {
        const rr = cr + 6 + i * 7;
        hex(x, y, rr, t * (0.4 + i * 0.2) + i, 1, 0.55 - i * 0.14);
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
