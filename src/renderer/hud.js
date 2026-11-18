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
    const c = (a) => `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${Math.min(1, a * 1.2)})`;
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
      if (w < 24 || h < 24) { requestAnimationFrame(frame); return; }
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
        for (let i = 0; i < 360; i++) {
          const a = (i / 360) * TAU - Math.PI / 2;
          const major = i % 30 === 0; const ten = i % 10 === 0; const five = i % 5 === 0;
          tick(x, y, a, R * (major ? 0.9 : ten ? 0.925 : five ? 0.94 : 0.953), R * 0.97, major ? 1.6 : 0.9, major ? 1 : ten ? 0.75 : five ? 0.5 : 0.28);
        }
        // Zeiger: aktuelle Drehung als heller Strich auf der Skala
        { const pa = (t * 22 % 360) / 360 * TAU - Math.PI / 2; tick(x, y, pa, R * 0.885, R * 0.985, 2, 1); }
        ctx.font = `${Math.max(8, R * 0.04)}px "Cascadia Mono", Consolas, monospace`;
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
      const segs = small ? 24 : 96;
      const r4 = R * (small ? 0.62 : 0.66);
      const lit = mode === 'thinking' ? null : Math.round(Math.min(1, 0.18 + level) * segs);
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.08);
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU; const a1 = a0 + (TAU / segs) * 0.7;
        let on;
        if (lit === null) { const head = (t * 1.6) % 1 * segs; on = ((i - head + segs) % segs) < segs * 0.3 ? 0.95 - (((i - head + segs) % segs) / (segs * 0.3)) * 0.75 : 0.12; }
        else on = i < lit ? 0.9 : 0.14;
        arc(0, 0, r4, a0, a1, small ? 3 : 3, on);
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
      // 6) 3D-Kern: leuchtende Kugel mit Gitter (dreht), Kristall innen (dreht gegenläufig), Bahnen drumherum (kippen und drehen)
      const pulse = 1 + level * 0.28 + Math.sin(now / 1000) * 0.015;
      const cr = R * (small ? 0.46 : 0.34) * pulse;
      const rot = (px, py, pz, ay, ax) => { // erst um Y, dann um X drehen
        const cy = Math.cos(ay); const sy = Math.sin(ay); let X = px * cy + pz * sy; let Z = -px * sy + pz * cy;
        const cx = Math.cos(ax); const sx = Math.sin(ax); const Y = py * cx - Z * sx; Z = py * sx + Z * cx; return [X, Y, Z];
      };
      const P = (v, rad) => { const k = 1 / (1 - v[2] * 0.22); return [x + v[0] * rad * k, y + v[1] * rad * k, v[2]]; };
      const seg3 = (p0, p1, w, baseA, rgb) => {
        const z = (p0[2] + p1[2]) / 2; const al = Math.max(0.06, Math.min(1, baseA * (0.4 + 0.6 * (z + 1) / 2) * (z > 0 ? 1.15 : 0.55)));
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineWidth = w; ctx.strokeStyle = rgb ? `rgba(${rgb},${al})` : c(al); ctx.stroke();
      };
      const tiltX = 0.42; const spinY = t * 0.55;
      // Bahnen hinter der Kugel zuerst
      const orbits = small ? [[0.62, 1.1, 1.3], [0.72, -0.4, -0.9]] : [[0.6, 1.25, 1.1], [0.72, -0.35, -0.8], [0.84, 0.75, 0.5]];
      const drawOrbits = (front) => {
        orbits.forEach(([rf, tilt, sp], oi) => {
          const N = 72; const ay = t * sp * 0.6; let prev = null;
          for (let i = 0; i <= N; i++) {
            const a = (i / N) * TAU; const v = rot(Math.cos(a), 0, Math.sin(a), ay, tilt);
            const pt = P(v, cr * (1 + rf * 1.15)); if (prev && ((prev[2] + pt[2]) / 2 > 0) === front) seg3(prev, pt, front ? 1.4 : 0.9, 0.9); prev = pt;
          }
          const sa = t * (1.6 + oi * 0.5) * (oi % 2 ? -1 : 1); const sv = rot(Math.cos(sa), 0, Math.sin(sa), ay, tilt); const sp3 = P(sv, cr * (1 + rf * 1.15));
          if ((sp3[2] > 0) === front) {
            ctx.save(); ctx.shadowColor = c(1); ctx.shadowBlur = 12; ctx.fillStyle = 'rgba(245,254,255,1)'; ctx.beginPath(); ctx.arc(sp3[0], sp3[1], (front ? 3.6 : 2.4) * (0.8 + 0.25 * (sp3[2] + 1)), 0, TAU); ctx.fill(); ctx.restore();
          }
        });
      };
      drawOrbits(false);
      // Kugel: Leuchtkörper + Gitter
      ctx.save(); ctx.shadowColor = c(0.95); ctx.shadowBlur = R * 0.14;
      const g = ctx.createRadialGradient(x - cr * 0.3, y - cr * 0.35, cr * 0.05, x, y, cr);
      g.addColorStop(0, 'rgba(235,252,255,.95)'); g.addColorStop(0.35, c(0.75)); g.addColorStop(0.8, c(0.3)); g.addColorStop(1, c(0.12));
      ctx.beginPath(); ctx.arc(x, y, cr, 0, TAU); ctx.fillStyle = g; ctx.fill(); ctx.restore();
      const meridians = small ? 6 : 14; const parallels = small ? 4 : 9;
      for (let m = 0; m < meridians; m++) {
        const lon = (m / meridians) * Math.PI; let prev = null;
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * TAU; const v = rot(Math.cos(a) * Math.cos(lon), Math.sin(a), Math.cos(a) * Math.sin(lon), spinY, tiltX);
          const pt = P(v, cr); if (prev) seg3(prev, pt, 0.9, 0.85, '4,28,44'); prev = pt;
        }
      }
      for (let l = 1; l <= parallels; l++) {
        const lat = (l / (parallels + 1)) * Math.PI - Math.PI / 2; const rr = Math.cos(lat); let prev = null;
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * TAU; const v = rot(Math.cos(a) * rr, Math.sin(lat), Math.sin(a) * rr, spinY, tiltX);
          const pt = P(v, cr); if (prev) seg3(prev, pt, 0.9, 0.85, '4,28,44'); prev = pt;
        }
      }
      // Kristall im Inneren (Ikosaeder), dreht gegenläufig auf zwei Achsen
      const ph = (1 + Math.sqrt(5)) / 2; const nl = Math.hypot(1, ph);
      const V = [[-1, ph, 0], [1, ph, 0], [-1, -ph, 0], [1, -ph, 0], [0, -1, ph], [0, 1, ph], [0, -1, -ph], [0, 1, -ph], [ph, 0, -1], [ph, 0, 1], [-ph, 0, -1], [-ph, 0, 1]].map((v) => [v[0] / nl, v[1] / nl, v[2] / nl]);
      const E = []; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (Math.abs(Math.hypot(V[i][0] - V[j][0], V[i][1] - V[j][1], V[i][2] - V[j][2]) - 2 / nl) < 0.01) E.push([i, j]);
      const pv = V.map((v) => P(rot(v[0], v[1], v[2], -t * 1.1, t * 0.7), cr * 0.62));
      ctx.save(); ctx.shadowColor = 'rgba(255,255,255,.9)'; ctx.shadowBlur = 6;
      for (const [i, j] of E) seg3(pv[i], pv[j], 1.5, 1, '245,254,255');
      ctx.restore();
      ctx.save(); ctx.shadowColor = 'rgba(255,255,255,1)'; ctx.shadowBlur = 16; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, cr * (0.13 + level * 0.1), 0, TAU); ctx.fill(); ctx.restore();
      drawOrbits(true);
      if (!small) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(-t * 0.5);
        for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; tick(0, 0, a, cr * 2.55, cr * 2.55 + (i % 2 ? 5 : 10), 1.4, 0.9); }
        ctx.restore();
      }
      if (!small) {
        // Datenring: wechselnde Hex-Zeichen laufen um den Kern
        if (now - (frame.dataT || 0) > 260) { frame.dataT = now; frame.data = Array.from({ length: 40 }, () => '0123456789ABCDEF'[(Math.random() * 16) | 0]); }
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * 0.18); ctx.font = `${Math.max(7, R * 0.032)}px "Cascadia Mono", Consolas, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        (frame.data || []).forEach((ch, i) => { const a = (i / 40) * TAU; ctx.save(); ctx.rotate(a); ctx.translate(0, -R * 0.615); ctx.fillStyle = c(0.35 + 0.45 * ((i + Math.floor(t * 3)) % 5 === 0)); ctx.fillText(ch, 0, 0); ctx.restore(); });
        ctx.restore();
        // Zielklammern um die Kugel
        const bk = cr * 1.32; const bl = cr * 0.28;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath(); ctx.moveTo(x + sx * bk, y + sy * (bk - bl)); ctx.lineTo(x + sx * bk, y + sy * bk); ctx.lineTo(x + sx * (bk - bl), y + sy * bk);
          ctx.lineWidth = 1.5; ctx.strokeStyle = c(0.95); ctx.stroke();
        }
        // Messwerte in den Ecken
        ctx.font = `${Math.max(8, R * 0.036)}px "Cascadia Mono", Consolas, monospace`; ctx.fillStyle = c(0.85); ctx.textBaseline = 'top';
        ctx.textAlign = 'left'; ctx.fillText(`ROT ${(t * 22 % 360).toFixed(1).padStart(5, '0')}°`, x - R * 0.97, y - R * 0.97);
        ctx.textAlign = 'right'; ctx.fillText(`LVL ${level.toFixed(2)}`, x + R * 0.97, y - R * 0.97);
        ctx.textBaseline = 'bottom'; ctx.textAlign = 'left'; ctx.fillText(mode.toUpperCase(), x - R * 0.97, y + R * 0.97);
        ctx.textAlign = 'right'; ctx.fillText(`T+${(t % 1000).toFixed(1)}`, x + R * 0.97, y + R * 0.97);
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
