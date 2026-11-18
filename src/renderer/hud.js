// Gestochen scharfer HUD-Kern (eigenes Design): feine Linien statt Weichzeichner.
// Gradskala, gegenläufige Messringe, Segment-Pegel, Fadenkreuz, scharfer Kern.
(() => {
  const PALETTE = {
    idle: [72, 220, 255], thinking: [150, 236, 255], listening: [255, 176, 64], speaking: [96, 228, 255], error: [255, 92, 92],
  };
  const SPEED = { idle: 1, thinking: 3.4, listening: 1.5, speaking: 1.8, error: 0.5 };
  const TAU = Math.PI * 2;

  // ---- Erde: grobe Kontinente (Länge, Breite) -> Landmaske, pro Bild als Kugel gerendert ----
  const LAND = [
    [[-168,65],[-156,71],[-141,70],[-128,70],[-115,68],[-95,72],[-85,70],[-80,63],[-92,57],[-82,52],[-78,58],[-68,60],[-62,55],[-56,52],[-66,45],[-70,42],[-76,38],[-81,31],[-80,25],[-84,30],[-90,29],[-97,27],[-97,21],[-90,21],[-87,21],[-88,16],[-83,10],[-78,8],[-85,11],[-92,15],[-105,20],[-110,24],[-114,31],[-117,32],[-120,34],[-124,40],[-124,48],[-130,55],[-140,60],[-152,59],[-165,60]],
    [[-73,78],[-60,82],[-30,83],[-20,78],[-22,70],[-40,62],[-48,61],[-55,68],[-70,70]],
    [[-80,8],[-72,12],[-62,10],[-52,5],[-50,0],[-35,-6],[-39,-15],[-48,-26],[-58,-35],[-65,-42],[-68,-52],[-72,-53],[-74,-44],[-72,-30],[-70,-18],[-76,-14],[-81,-5],[-80,2]],
    [[-10,36],[-9,43],[-2,44],[-5,48],[2,51],[8,54],[10,58],[5,62],[14,67],[25,71],[40,68],[60,70],[80,73],[105,77],[130,72],[160,70],[180,68],[180,65],[170,60],[160,55],[156,51],[142,52],[135,43],[128,38],[126,34],[121,31],[120,24],[110,20],[108,14],[105,9],[100,13],[98,8],[103,1],[98,16],[92,21],[86,20],[80,15],[77,8],[72,20],[67,25],[60,25],[57,25],[56,27],[50,30],[48,29],[51,25],[56,24],[59,22],[52,16],[44,12],[39,20],[35,28],[34,31],[36,36],[30,36],[27,37],[26,40],[28,41],[22,40],[19,42],[13,45],[18,40],[15,38],[12,42],[9,44],[3,43],[0,39],[-6,36]],
    [[-17,21],[-10,30],[-6,36],[10,37],[11,33],[20,31],[32,31],[34,28],[38,20],[43,12],[51,12],[48,5],[40,-3],[40,-15],[35,-24],[32,-29],[27,-34],[19,-34],[14,-24],[12,-12],[9,-1],[9,4],[5,5],[-5,5],[-13,8],[-17,14]],
    [[114,-22],[122,-18],[130,-12],[137,-12],[142,-11],[146,-19],[153,-26],[150,-37],[141,-38],[135,-34],[130,-32],[115,-34],[113,-26]],
    [[-5,50],[1,51],[0,54],[-3,58],[-6,56]], [[130,31],[135,34],[140,36],[142,42],[140,41],[135,35]],
    [[44,-25],[49,-15],[50,-13],[47,-25]], [[109,1],[117,7],[119,1],[115,-4],[110,-3]], [[95,5],[106,-6],[104,-5],[98,2]],
    [[166,-46],[174,-41],[178,-38],[172,-41],[168,-47]], [[-180,-72],[180,-72],[180,-90],[-180,-90]],
  ];
  const MW = 360; const MH = 180; let mask = null;
  function buildMask() {
    const cv = document.createElement('canvas'); cv.width = MW; cv.height = MH; const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    for (const poly of LAND) { g.beginPath(); poly.forEach(([lo, la], i) => { const px = lo + 180; const py = 90 - la; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); g.fill(); }
    const d = g.getImageData(0, 0, MW, MH).data; mask = new Uint8Array(MW * MH);
    for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 100 ? 1 : 0;
  }
  const earthCv = document.createElement('canvas'); let earthCtx = null;
  // Rendert die Erde als Bild mit Beleuchtung; spin = Drehwinkel, tilt = Achsneigung
  function earthImage(S, spin, tilt, tint, t) {
    if (!mask) buildMask();
    if (earthCv.width !== S) { earthCv.width = S; earthCv.height = S; earthCtx = earthCv.getContext('2d'); }
    const img = earthCtx.createImageData(S, S); const D = img.data;
    const ct = Math.cos(tilt); const st = Math.sin(tilt); const L = [-0.5, -0.42, 0.76]; const ln = Math.hypot(...L);
    for (let j = 0; j < S; j++) {
      const py = (j + 0.5) / S * 2 - 1;
      for (let i = 0; i < S; i++) {
        const px = (i + 0.5) / S * 2 - 1; const r2 = px * px + py * py; const o = (j * S + i) * 4;
        if (r2 > 1) { D[o + 3] = 0; continue; }
        const pz = Math.sqrt(1 - r2);
        const y = py * ct + pz * st; const z = -py * st + pz * ct;
        let lon = Math.atan2(px, z) - spin; lon = ((lon + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const lat = Math.asin(Math.max(-1, Math.min(1, y)));
        const mx = Math.min(MW - 1, Math.max(0, Math.floor((lon / Math.PI * 0.5 + 0.5) * MW)));
        const my = Math.min(MH - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * MH)));
        const land = mask[my * MW + mx];
        let R_; let G_; let B_;
        if (land) { if (Math.abs(lat) > 1.27) { R_ = 225; G_ = 240; B_ = 250; } else { const dry = Math.abs(lat) < 0.5 ? 1 : 0; R_ = 70 + dry * 70; G_ = 165 + dry * 10; B_ = 95; } }
        else { R_ = 12; G_ = 78; B_ = 160; }
        // Wolken: einfache Wellenmuster, die langsam wandern
        const cl = Math.sin(lon * 4 + t * 0.15 + Math.sin(lat * 5) * 2) * Math.sin(lat * 7 - lon * 2 + t * 0.1);
        if (cl > 0.55) { const k = Math.min(1, (cl - 0.55) * 3) * 0.55; R_ += (255 - R_) * k; G_ += (255 - G_) * k; B_ += (255 - B_) * k; }
        const lam = (px * L[0] + py * L[1] + pz * L[2]) / ln; const lit = Math.max(0.16, Math.min(1.1, 0.3 + 0.85 * lam));
        D[o] = Math.min(255, R_ * lit * 0.85 + tint[0] * 0.15 * lit); D[o + 1] = Math.min(255, G_ * lit * 0.85 + tint[1] * 0.15 * lit); D[o + 2] = Math.min(255, B_ * lit * 0.85 + tint[2] * 0.15 * lit); D[o + 3] = 255;
      }
    }
    earthCtx.putImageData(img, 0, 0);
    return earthCv;
  }

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
      const cr = R * (small ? 0.5 : 0.4) * pulse;
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
      // Kugel: die Erde, dreht sich; darüber ein feines Gitter
      const S = Math.max(48, Math.min(190, Math.round(cr * 2)));
      ctx.save(); ctx.shadowColor = c(0.95); ctx.shadowBlur = R * 0.12;
      ctx.imageSmoothingEnabled = true; ctx.drawImage(earthImage(S, t * 0.35, 0.41, col, t), x - cr, y - cr, cr * 2, cr * 2);
      ctx.restore();
      const meridians = small ? 0 : 12; const parallels = small ? 0 : 8;
      for (let m = 0; m < meridians; m++) {
        const lon = (m / meridians) * Math.PI; let prev = null;
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * TAU; const v = rot(Math.cos(a) * Math.cos(lon), Math.sin(a), Math.cos(a) * Math.sin(lon), spinY, tiltX);
          const pt = P(v, cr); if (prev) seg3(prev, pt, 0.8, 0.3, '170,235,255'); prev = pt;
        }
      }
      for (let l = 1; l <= parallels; l++) {
        const lat = (l / (parallels + 1)) * Math.PI - Math.PI / 2; const rr = Math.cos(lat); let prev = null;
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * TAU; const v = rot(Math.cos(a) * rr, Math.sin(lat), Math.sin(a) * rr, spinY, tiltX);
          const pt = P(v, cr); if (prev) seg3(prev, pt, 0.8, 0.3, '170,235,255'); prev = pt;
        }
      }
      // Randlicht (Atmosphäre) und Glanzpunkt für mehr Tiefe
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const rim = ctx.createRadialGradient(x, y, cr * 0.72, x, y, cr * 1.04);
      rim.addColorStop(0, c(0)); rim.addColorStop(0.85, c(0.55)); rim.addColorStop(1, c(0));
      ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(x, y, cr * 1.04, 0, TAU); ctx.fill();
      const sp = ctx.createRadialGradient(x - cr * 0.38, y - cr * 0.42, 0, x - cr * 0.38, y - cr * 0.42, cr * 0.34);
      sp.addColorStop(0, 'rgba(190,245,255,.3)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sp; ctx.beginPath(); ctx.arc(x - cr * 0.38, y - cr * 0.42, cr * 0.34, 0, TAU); ctx.fill();
      ctx.restore();
      drawOrbits(true);
      if (!small) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(-t * 0.5);
        for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; tick(0, 0, a, cr * 2.0, cr * 2.0 + (i % 2 ? 4 : 9), 1.3, 0.9); }
        ctx.restore();
      }
      if (!small) {
        // Zielklammern um die Kugel
        const bk = cr * 1.32; const bl = cr * 0.28;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath(); ctx.moveTo(x + sx * bk, y + sy * (bk - bl)); ctx.lineTo(x + sx * bk, y + sy * bk); ctx.lineTo(x + sx * (bk - bl), y + sy * bk);
          ctx.lineWidth = 1.5; ctx.strokeStyle = c(0.95); ctx.stroke();
        }
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
