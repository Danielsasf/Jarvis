// Gestochen scharfer HUD-Kern (eigenes Design): feine Linien statt Weichzeichner.
// Gradskala, gegenläufige Messringe, Segment-Pegel, Fadenkreuz, scharfer Kern.
(() => {
  const PALETTE = {
    idle: [72, 220, 255], thinking: [150, 236, 255], listening: [255, 176, 64], speaking: [96, 228, 255], error: [255, 92, 92],
  };
  const SPEED = { idle: 1, thinking: 3.4, listening: 1.5, speaking: 1.8, error: 0.5 };
  const TAU = Math.PI * 2;

  // ---- Erde: echte Küstenlinien (Natural Earth 1:50m) als Textur, pro Bild auf eine Kugel projiziert ----
  const TW = 2048; const TH = 1024;
  let tex = null; // Farbe pro Texel (RGB), wird einmal aus der Landkarte berechnet
  let clouds = null; const CW = 512; const CH = 256;
  function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
  // Wertrauschen, horizontal nahtlos (Periode px)
  function vnoise(x, y, px) {
    const xi = Math.floor(x); const yi = Math.floor(y); const fx = x - xi; const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx); const v = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % px) + px) % px; const x1 = (x0 + 1) % px;
    const a = hash(x0, yi); const b = hash(x1, yi); const c = hash(x0, yi + 1); const d = hash(x1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, px, oct) { let s = 0; let amp = 0.5; let f = 1; for (let o = 0; o < oct; o++) { s += vnoise(x * f, y * f, px * f) * amp; f *= 2; amp *= 0.5; } return s; }
  function blurMap(src, w, h, r) {
    // Kastenunschärfe (horizontal nahtlos), zweimal = fast Gauß
    let a = Float32Array.from(src); const b = new Float32Array(w * h);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) { let acc = 0; for (let k = -r; k <= r; k++) acc += a[y * w + ((k + w) % w)]; for (let x = 0; x < w; x++) { b[y * w + x] = acc / (2 * r + 1); acc += a[y * w + ((x + r + 1) % w)] - a[y * w + ((x - r + w) % w)]; } }
      for (let x = 0; x < w; x++) { let acc = 0; for (let k = -r; k <= r; k++) acc += b[Math.min(h - 1, Math.max(0, k)) * w + x]; for (let y = 0; y < h; y++) { a[y * w + x] = acc / (2 * r + 1); acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; } }
    }
    return a;
  }
  function buildTexture(img) {
    const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH; const g = cv.getContext('2d');
    g.drawImage(img, 0, 0, TW, TH); const d = g.getImageData(0, 0, TW, TH).data;
    // grobe Karte für "wie weit im Landesinneren" und "Flachwasser an der Küste"
    const SW = 512; const SH = 256; const small = new Float32Array(SW * SH);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) small[y * SW + x] = d[((y * 4 + 2) * TW + x * 4 + 2) * 4] / 255;
    const inland = blurMap(small, SW, SH, 6); const shore = blurMap(small, SW, SH, 2);
    tex = new Uint8Array(TW * TH * 3);
    const mix = (c1, c2, k) => [c1[0] + (c2[0] - c1[0]) * k, c1[1] + (c2[1] - c1[1]) * k, c1[2] + (c2[2] - c1[2]) * k];
    const DEEP = [6, 34, 92]; const MID = [10, 62, 138]; const SHALLOW = [16, 86, 150];
    const JUNGLE = [34, 92, 38]; const FOREST = [52, 104, 50]; const BOREAL = [40, 74, 52]; const GRASS = [104, 128, 66];
    const STEPPE = [150, 140, 92]; const DESERT = [204, 170, 112]; const TUNDRA = [122, 118, 98]; const ICE = [236, 244, 250];
    for (let y = 0; y < TH; y++) {
      const lat = 90 - (y + 0.5) / TH * 180; const al = Math.abs(lat); const sy = Math.min(SH - 1, y >> 2);
      for (let x = 0; x < TW; x++) {
        const o = (y * TW + x) * 4; const landK = d[o] / 255; const iceK = d[o + 1] / 255; const sx = x >> 2;
        const inl = inland[sy * SW + sx]; const sh = shore[sy * SW + sx];
        const n = fbm(x / 64, y / 64, TW / 64, 4); // Rauschen für natürliche Übergänge
        // Meer: tief -> flach an der Küste
        let sea = mix(DEEP, MID, Math.min(1, n * 0.6 + 0.2)); sea = mix(sea, SHALLOW, Math.min(1, Math.max(0, sh - 0.06) * 2.2) * 0.7);
        // Land: Klimazonen nach Breite + Landesinnerem (weit weg vom Meer = trockener)
        // Klimazonen weich ineinander übergehen lassen (Breite leicht verrauscht, damit keine geraden Kanten entstehen)
        const ale = Math.max(0, al + (n - 0.5) * 16);
        const ZONES = [[0, JUNGLE], [14, FOREST], [28, GRASS], [42, FOREST], [55, BOREAL], [66, TUNDRA], [76, TUNDRA], [84, ICE]];
        let c = ZONES[ZONES.length - 1][1];
        for (let z = 0; z < ZONES.length - 1; z++) { if (ale < ZONES[z + 1][0]) { c = mix(ZONES[z][1], ZONES[z + 1][1], (ale - ZONES[z][0]) / (ZONES[z + 1][0] - ZONES[z][0])); break; } }
        const ss = (e0, e1, v) => { const q = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return q * q * (3 - 2 * q); };
        const dry = Math.max(0, 1 - Math.abs(ale - 24) / 14) * ss(0.35, 0.75, inl + (n - 0.5) * 0.35);
        c = mix(c, DESERT, Math.min(1, dry * 1.5));
        const stp = Math.max(0, 1 - Math.abs(ale - 44) / 9) * ss(0.55, 0.85, inl + (n - 0.5) * 0.3);
        c = mix(c, STEPPE, stp * 0.8);
        c = mix(c, ICE, iceK);
        // feine Struktur (Berge/Täler angedeutet)
        const k = 0.86 + fbm(x / 9, y / 9, TW / 9, 3) * 0.28; c = [c[0] * k, c[1] * k, c[2] * k];
        const f = mix(sea, c, landK); const t = (y * TW + x) * 3;
        tex[t] = Math.min(255, f[0]); tex[t + 1] = Math.min(255, f[1]); tex[t + 2] = Math.min(255, f[2]);
      }
    }
    // Wolken: nahtloses Rauschen, Bänder in Tropen und mittleren Breiten
    clouds = new Uint8Array(CW * CH);
    for (let y = 0; y < CH; y++) {
      const lat = 90 - (y + 0.5) / CH * 180; const band = 0.55 + 0.25 * Math.cos(lat / 90 * Math.PI * 3);
      for (let x = 0; x < CW; x++) { const v = fbm(x / 40, y / 40, CW / 40, 5); clouds[y * CW + x] = Math.max(0, Math.min(255, (v - (1 - band * 0.62)) * 900)); }
    }
  }
  (function loadMap() {
    if (!window.EARTH_MAP) return;
    const img = new Image(); img.onload = () => { try { buildTexture(img); } catch (e) { console.warn('Erde', e); } }; img.src = window.EARTH_MAP;
  })();

  // Pro Größe ein eigener Zwischenspeicher (Geometrie + Bild), damit mehrere Erden gleichzeitig nicht ständig neu rechnen
  const earthCache = new Map();
  function buildGeo(S, tilt) {
    const n = S * S; const g = { S, tilt, inside: new Uint8Array(n), lon: new Float32Array(n), ty: new Uint16Array(n), cy: new Uint16Array(n), lit: new Float32Array(n), spec: new Float32Array(n), rim: new Float32Array(n) };
    const ct = Math.cos(tilt); const st = Math.sin(tilt); const L = [-0.55, -0.4, 0.73]; const ln = Math.hypot(...L); const Lx = L[0] / ln; const Ly = L[1] / ln; const Lz = L[2] / ln;
    const Hx = Lx; const Hy = Ly; const Hz = Lz + 1; const hn = Math.hypot(Hx, Hy, Hz);
    for (let j = 0; j < S; j++) {
      const py = (j + 0.5) / S * 2 - 1;
      for (let i = 0; i < S; i++) {
        const px = (i + 0.5) / S * 2 - 1; const r2 = px * px + py * py; const k = j * S + i;
        if (r2 > 1) continue;
        g.inside[k] = r2 > 0.985 ? 2 : 1; // 2 = Randpixel (Kantenglättung)
        const pz = Math.sqrt(1 - r2); const y = -(py * ct) + pz * st; const z = py * st + pz * ct;
        g.lon[k] = Math.atan2(px, z);
        const lat = Math.asin(Math.max(-1, Math.min(1, y)));
        g.ty[k] = Math.min(TH - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * TH)));
        g.cy[k] = Math.min(CH - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * CH)));
        const lam = px * Lx + py * Ly + pz * Lz;
        g.lit[k] = Math.max(0.07, Math.min(1.15, 0.12 + 1.0 * Math.max(0, lam) + 0.1 * pz));
        const nh = Math.max(0, (px * Hx + py * Hy + pz * Hz) / hn); g.spec[k] = Math.pow(nh, 40) * 0.45;
        g.rim[k] = Math.pow(1 - pz, 3);
      }
    }
    return g;
  }
  // spin = Drehwinkel, tilt = Achsneigung, tint = HUD-Farbe (leichte Tönung), t = Zeit für die Wolken
  function earthImage(S, spin, tilt, tint, t) {
    S = Math.max(32, Math.round(S));
    const key = `${S}|${tilt}`; let e = earthCache.get(key);
    if (!e) {
      if (earthCache.size >= 6) earthCache.delete(earthCache.keys().next().value);
      const cv = document.createElement('canvas'); cv.width = S; cv.height = S; const cx = cv.getContext('2d');
      e = { cv, cx, img: cx.createImageData(S, S), geo: buildGeo(S, tilt) }; earthCache.set(key, e);
    }
    const D = e.img.data; const g = e.geo; const n = S * S; const TWO = Math.PI * 2;
    const cloudShift = t * 0.012; // Wolken ziehen etwas schneller als die Erde
    for (let k = 0; k < n; k++) {
      const o = k * 4; const ins = g.inside[k];
      if (!ins) { D[o + 3] = 0; continue; }
      let u = (g.lon[k] - spin) / TWO + 0.5; u -= Math.floor(u);
      let R_; let G_; let B_; let water = 1;
      if (tex) { const t3 = (g.ty[k] * TW + Math.min(TW - 1, Math.floor(u * TW))) * 3; R_ = tex[t3]; G_ = tex[t3 + 1]; B_ = tex[t3 + 2]; water = B_ > R_ + 60 && B_ > G_ + 30 ? 1 : 0; }
      else { R_ = 10; G_ = 62; B_ = 138; }
      let cu = u + cloudShift; cu -= Math.floor(cu);
      const cl = clouds ? clouds[g.cy[k] * CW + Math.min(CW - 1, Math.floor(cu * CW))] / 255 * 0.85 : 0;
      R_ += (245 - R_) * cl; G_ += (248 - G_) * cl; B_ += (252 - B_) * cl;
      const lit = g.lit[k]; const sp = water * (1 - cl) * g.spec[k] * 255; const rim = g.rim[k];
      const r = R_ * lit + sp + (tint[0] * 0.55 + 60) * rim; const gg = G_ * lit + sp + (tint[1] * 0.55 + 90) * rim; const b = B_ * lit + sp + (tint[2] * 0.6 + 120) * rim;
      D[o] = r > 255 ? 255 : r; D[o + 1] = gg > 255 ? 255 : gg; D[o + 2] = b > 255 ? 255 : b; D[o + 3] = ins === 2 ? 170 : 255;
    }
    e.cx.putImageData(e.img, 0, 0);
    return e.cv;
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
      const S = Math.max(64, Math.min(420, Math.round(cr * 2 * Math.min(2, window.devicePixelRatio || 1))));
      ctx.save(); ctx.shadowColor = c(0.95); ctx.shadowBlur = R * 0.08;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(earthImage(S, t * 0.35, 0.41, col, t), x - cr, y - cr, cr * 2, cr * 2);
      ctx.restore();
      const meridians = 0; const parallels = 0; // kein Gitter mehr: die Erde soll klar zu sehen sein
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
      rim.addColorStop(0, c(0)); rim.addColorStop(0.9, c(0.35)); rim.addColorStop(1, c(0));
      ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(x, y, cr * 1.04, 0, TAU); ctx.fill();
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
  window.HUD = { create, earth: earthImage };
})();
