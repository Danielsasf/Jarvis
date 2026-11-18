// Netz-Ansicht: Sternenfeld + Graph in der Mitte, links Inspektor/Befehle/Top-Knoten, rechts Statusring/Log/Gespräch.
(() => {
  const $ = (id) => document.getElementById(id);
  const G = window.JGraph;
  const COLORS = { hub: [235, 250, 255], pack: [255, 206, 96], ki: [96, 240, 200], memory: [96, 190, 255], chat: [255, 150, 200] };
  const TYPE = { hub: 'Kern', pack: 'Paket', ki: 'KI', memory: 'Gedächtnis', chat: 'Chat' };
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  let cb = { onCommand() {} };
  let graph = { nodes: [], edges: [] }; let sig = ''; let selected = null; let hover = null;
  let view = { s: 1, tx: 0, ty: 0 }; let labels = true; let alpha = 1; let stars = []; let ring = null;
  let W = 0; let H = 0; let ctx = null; let cv = null; let running = false; const log = []; let lastData = null;

  function visible() { return document.body.classList.contains('view-netz'); }
  function size() {
    const dpr = Math.max(1, window.devicePixelRatio || 1); const w = cv.clientWidth; const h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (w !== W || h !== H) { W = w; H = h; makeStars(); }
  }
  function makeStars() {
    const n = Math.round(Math.min(520, W * H / 1500));
    stars = Array.from({ length: n }, () => {
      const big = Math.random() < 0.12;
      return { x: Math.random() * W, y: Math.random() * H, r: big ? 1.8 + Math.random() * 1.4 : 0.8 + Math.random() * 0.9, a: 0.7 + Math.random() * 0.3, ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.8, warm: Math.random() < 0.25, drift: 1 + Math.random() * 3 };
    });
  }
  const toScreen = (n) => [W / 2 + view.tx + n.x * view.s, H / 2 + view.ty + n.y * view.s];
  function fit() {
    let m = 60; for (const n of graph.nodes) m = Math.max(m, Math.abs(n.x), Math.abs(n.y));
    view = { s: Math.min(2.2, Math.min(W, H) / 2 / (m + 40)), tx: 0, ty: 0 };
  }
  function pick(px, py) {
    let best = null; let bd = 1e9;
    for (const n of graph.nodes) { const [x, y] = toScreen(n); const d = Math.hypot(x - px, y - py); if (d < n.r * view.s + 8 && d < bd) { best = n; bd = d; } }
    return best;
  }

  // 3D-Kern für den Hauptpunkt: Kugelgitter, Kristall innen, gekippte Bahnen mit Lichtpunkten
  function hub3d(x, y, r, t, c, dim) {
    const rot = (px, py, pz, ay, ax) => { const cy = Math.cos(ay); const sy = Math.sin(ay); const X = px * cy + pz * sy; let Z = -px * sy + pz * cy; const cx = Math.cos(ax); const sx = Math.sin(ax); const Y = py * cx - Z * sx; Z = py * sx + Z * cx; return [X, Y, Z]; };
    const P = (v, rad) => { const k = 1 / (1 - v[2] * 0.2); return [x + v[0] * rad * k, y + v[1] * rad * k, v[2]]; };
    const seg = (a, b, w, al, col) => { const z = (a[2] + b[2]) / 2; const o = Math.max(0.06, Math.min(1, al * (0.4 + 0.6 * (z + 1) / 2) * (z > 0 ? 1.15 : 0.55))) * dim; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineWidth = w; ctx.strokeStyle = `rgba(${col},${o})`; ctx.stroke(); };
    const orbits = [[1.7, 1.2, 1.1], [2.1, -0.4, -0.8]]; const ay0 = t * 0.5;
    const orbit = (front) => orbits.forEach(([rf, tilt, sp], oi) => {
      let prev = null; const ay = t * sp * 0.6;
      for (let i = 0; i <= 56; i++) { const a = (i / 56) * 6.2832; const pt = P(rot(Math.cos(a), 0, Math.sin(a), ay, tilt), r * rf); if (prev && ((prev[2] + pt[2]) / 2 > 0) === front) seg(prev, pt, front ? 1.6 : 1, 0.9, '150,235,255'); prev = pt; }
      const sa = t * (1.7 + oi * 0.5) * (oi ? -1 : 1); const q = P(rot(Math.cos(sa), 0, Math.sin(sa), ay, tilt), r * rf);
      if ((q[2] > 0) === front) { ctx.save(); ctx.shadowColor = 'rgba(150,235,255,1)'; ctx.shadowBlur = 10; ctx.fillStyle = `rgba(245,254,255,${dim})`; ctx.beginPath(); ctx.arc(q[0], q[1], front ? 3.2 : 2.2, 0, 6.2832); ctx.fill(); ctx.restore(); }
    });
    orbit(false);
    ctx.save(); ctx.shadowColor = rgba(c, 0.9 * dim); ctx.shadowBlur = 24;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
    g.addColorStop(0, `rgba(240,253,255,${0.95 * dim})`); g.addColorStop(0.5, `rgba(96,200,255,${0.6 * dim})`); g.addColorStop(1, `rgba(40,120,200,${0.2 * dim})`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.restore();
    for (let m = 0; m < 6; m++) { const lon = (m / 6) * Math.PI; let prev = null; for (let i = 0; i <= 36; i++) { const a = (i / 36) * 6.2832; const pt = P(rot(Math.cos(a) * Math.cos(lon), Math.sin(a), Math.cos(a) * Math.sin(lon), ay0, 0.4), r); if (prev) seg(prev, pt, 1, 0.8, '4,28,44'); prev = pt; } }
    for (let l = 1; l <= 4; l++) { const lat = (l / 5) * Math.PI - Math.PI / 2; const rr = Math.cos(lat); let prev = null; for (let i = 0; i <= 36; i++) { const a = (i / 36) * 6.2832; const pt = P(rot(Math.cos(a) * rr, Math.sin(lat), Math.sin(a) * rr, ay0, 0.4), r); if (prev) seg(prev, pt, 1, 0.8, '4,28,44'); prev = pt; } }
    const V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((v) => P(rot(v[0], v[1], v[2], -t * 1.2, t * 0.8), r * 0.6));
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (!((i ^ j) === 1 && i % 2 === 0)) seg(V[i], V[j], 1.3, 1, '250,255,255');
    ctx.save(); ctx.shadowColor = '#fff'; ctx.shadowBlur = 12; ctx.fillStyle = `rgba(255,255,255,${dim})`; ctx.beginPath(); ctx.arc(x, y, r * 0.16, 0, 6.2832); ctx.fill(); ctx.restore();
    orbit(true);
  }

  function draw(now) {
    if (!running) return;
    requestAnimationFrame(draw);
    if (!visible() || !cv) return;
    size();
    if (alpha > 0.02) { G.step(graph.nodes, graph.edges, alpha); alpha *= 0.985; }
    ctx.clearRect(0, 0, W, H);
    const t = now / 1000;
    // Sternenfeld (klar sichtbar, funkelt, driftet langsam)
    for (const s of stars) {
      const a = s.a * (0.62 + 0.38 * Math.sin(t * s.sp + s.ph));
      const x = (s.x + t * s.drift * 0.4) % W; const y = s.y;
      ctx.fillStyle = s.warm ? `rgba(255,236,190,${a})` : `rgba(200,236,255,${a})`;
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.2832); ctx.fill();
      if (s.r > 1.7) { ctx.strokeStyle = `rgba(200,236,255,${a * 0.4})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - s.r * 3, y); ctx.lineTo(x + s.r * 3, y); ctx.moveTo(x, y - s.r * 3); ctx.lineTo(x, y + s.r * 3); ctx.stroke(); }
    }
    const idx = new Map(graph.nodes.map((n) => [n.id, n]));
    const focus = selected || hover; const near = focus ? G.neighbors(graph, focus.id) : null;
    const lit = (n) => !focus || n.id === focus.id || near.has(n.id);
    // Linien
    for (const [a, b] of graph.edges) {
      const A = idx.get(a); const B = idx.get(b); if (!A || !B) continue;
      const [x1, y1] = toScreen(A); const [x2, y2] = toScreen(B);
      const on = focus && (a === focus.id || b === focus.id);
      ctx.strokeStyle = on ? 'rgba(150,235,255,.85)' : focus ? 'rgba(120,200,255,.05)' : 'rgba(120,200,255,.2)';
      ctx.lineWidth = on ? 1.6 : 1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // Punkte
    for (const n of graph.nodes) {
      const [x, y] = toScreen(n); const c = COLORS[n.type]; const dim = !lit(n) ? 0.2 : n.on === false ? 0.45 : 1;
      const grow = n.fresh ? Math.max(0, 1 - (now - n.fresh) / 1600) : 0;
      const r = n.r * view.s * (n.id === (selected && selected.id) ? 1.25 : 1) * (1 + grow * 0.8);
      const pulse = n.type === 'hub' ? 1 + Math.sin(t * 2) * 0.06 : 1;
      if (n.type === 'hub') { hub3d(x, y, r * 1.5 * pulse, t, c, dim); continue; }
      ctx.save(); ctx.shadowColor = rgba(c, 0.9 * dim); ctx.shadowBlur = 10 * (1 + grow * 2);
      ctx.fillStyle = rgba(c, dim); ctx.beginPath(); ctx.arc(x, y, r * pulse, 0, 6.2832); ctx.fill(); ctx.restore();
      if (grow > 0) { ctx.strokeStyle = rgba(c, grow * 0.8); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + (1 - grow) * 34, 0, 6.2832); ctx.stroke(); }
      if (n.type === 'hub') { ctx.strokeStyle = rgba(c, 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 8 + Math.sin(t * 1.4) * 2, 0, 6.2832); ctx.stroke(); }
    }
    // Beschriftung
    ctx.font = '11px "Cascadia Mono", Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const n of graph.nodes) {
      const show = (labels && (n.type !== 'memory' && n.type !== 'chat' ? true : n.deg > 2)) || (focus && (n.id === focus.id || near.has(n.id)));
      if (!show || !lit(n)) continue;
      const [x, y] = toScreen(n);
      ctx.fillStyle = n === focus ? '#ffffff' : 'rgba(210,240,255,.85)';
      ctx.fillText(n.label, x, y + n.r * view.s * (n.type === 'hub' ? 2.1 : 1) + 6);
    }
  }

  // ---------- Bedienung ----------
  function bindMouse() {
    let drag = null; let moved = false;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; moved = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      if (drag) { const dx = e.clientX - drag.x; const dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) moved = true; if (moved) { view.tx = drag.tx + dx; view.ty = drag.ty + dy; } }
      else { hover = pick(e.clientX - r.left, e.clientY - r.top); cv.style.cursor = hover ? 'pointer' : 'grab'; }
    });
    cv.addEventListener('pointerup', (e) => {
      const r = cv.getBoundingClientRect();
      if (!moved) select(pick(e.clientX - r.left, e.clientY - r.top));
      drag = null;
    });
    cv.addEventListener('pointerleave', () => { hover = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left - W / 2 - view.tx; const my = e.clientY - r.top - H / 2 - view.ty;
      const k = Math.exp(-e.deltaY * 0.0012); const s = Math.max(0.3, Math.min(4, view.s * k)); const f = s / view.s;
      view.tx -= mx * (f - 1); view.ty -= my * (f - 1); view.s = s;
    }, { passive: false });
  }

  function select(n) { selected = n; inspect(); }
  function inspect() {
    const el = $('nzInspect'); if (!el) return;
    if (!selected) { el.innerHTML = '<p class="nz-hint">Klick auf einen Punkt: nur er und seine Verbindungen leuchten, hier steht sein Inhalt.</p>'; return; }
    const n = selected; const near = [...G.neighbors(graph, n.id)].map((id) => graph.nodes.find((x) => x.id === id)).filter(Boolean);
    let extra = '';
    if (n.type === 'pack') extra = `<code>${esc(n.cmd)}</code>${n.on === false ? ' · aus' : ''}`;
    if (n.type === 'memory') extra = `${n.date ? new Date(n.date).toLocaleDateString('de-DE') : ''}${n.by === 'du' ? ' · von dir' : ''}`;
    el.innerHTML = `<h5>${esc(n.type === 'memory' ? 'Erinnerung' : n.label)}</h5><small>${TYPE[n.type]} · ${n.deg} Verbindungen ${extra ? '· ' + extra : ''}</small><p>${esc(n.text)}</p>`
      + (near.length ? `<div class="nz-chips">${near.slice(0, 8).map((m) => `<button data-id="${esc(m.id)}">${esc(G.clip(m.label, 22))}</button>`).join('')}</div>` : '');
    el.querySelectorAll('[data-id]').forEach((b) => { b.onclick = () => select(graph.nodes.find((x) => x.id === b.dataset.id)); });
    if (n.type === 'pack') { const b = document.createElement('button'); b.className = 'nz-use'; b.textContent = `${n.cmd} benutzen`; b.onclick = () => cb.onCommand(n.cmd); el.appendChild(b); }
  }

  function panels() {
    const packs = graph.nodes.filter((n) => n.type === 'pack');
    $('nzCmds').innerHTML = packs.length ? packs.map((p) => `<button data-cmd="${esc(p.cmd)}"${p.on === false ? ' class="off"' : ''}><b>${esc(p.cmd)}</b><small>${esc(G.clip(p.label, 16))}</small></button>`).join('') : '<p class="nz-hint">Noch keine Pakete.</p>';
    $('nzCmds').querySelectorAll('[data-cmd]').forEach((b) => { b.onclick = () => cb.onCommand(b.dataset.cmd); });
    const top = [...graph.nodes].filter((n) => n.type !== 'hub').sort((a, b) => b.deg - a.deg).slice(0, 8);
    $('nzTop').innerHTML = top.map((n) => `<li data-id="${esc(n.id)}"><i class="t-${n.type}"></i>${esc(G.clip(n.label, 24))}<b>${n.deg}</b></li>`).join('');
    $('nzTop').querySelectorAll('li').forEach((li) => { li.onclick = () => select(graph.nodes.find((x) => x.id === li.dataset.id)); });
    const c = { pack: 0, memory: 0, ki: 0, chat: 0 }; graph.nodes.forEach((n) => { if (c[n.type] != null) c[n.type]++; });
    $('nzCount').textContent = `${c.pack} Pakete · ${c.memory} Erinnerungen · ${c.ki} KIs · ${c.chat} Chats`;
  }

  function renderLog() {
    const el = $('nzLog'); if (!el) return;
    el.innerHTML = log.slice(0, 24).map((l) => `<li><time>${esc(l.t)}</time>${esc(l.text)}</li>`).join('') || '<li class="nz-hint">Noch nichts passiert.</li>';
  }

  window.Netz = {
    init(opts) {
      cb = { ...cb, ...opts }; cv = $('nzCv'); if (!cv) return; ctx = cv.getContext('2d');
      const rc = $('nzRing'); if (rc && window.HUD) ring = window.HUD.create(rc);
      bindMouse();
      $('nzFit').onclick = () => { fit(); selected = null; inspect(); };
      $('nzLabels').onclick = (e) => { labels = !labels; e.currentTarget.setAttribute('aria-pressed', String(labels)); };
      inspect(); renderLog(); running = true; requestAnimationFrame(draw);
    },
    setData(d) {
      lastData = d; if (!cv) return;
      const g = G.buildGraph(d); const s = G.signature(g);
      if (s === sig) { graph.nodes.forEach((n) => { const m = g.nodes.find((x) => x.id === n.id); if (m) { n.text = m.text; n.label = m.label; } }); return; }
      const first = !sig; const fresh = G.place(g.nodes, graph.nodes);
      graph = g; sig = s; alpha = first ? 1.6 : 0.8;
      if (first) { for (let i = 0; i < 220; i++) G.step(graph.nodes, graph.edges, 1); alpha = 0.3; fit(); }
      if (selected) selected = graph.nodes.find((n) => n.id === selected.id) || null;
      panels(); inspect();
      if (fresh && !first) Netz.log('Neuer Punkt im Netz');
    },
    setMode(mode, label) { ring?.setMode(mode, label); const m = $('nzMode'); if (m) m.textContent = label || mode; },
    bump(v) { ring?.bump(v); },
    setSpeed(t) { const e = $('nzSpeed'); if (e) e.textContent = t; },
    log(text) { log.unshift({ t: new Date().toLocaleTimeString('de-DE'), text: String(text).slice(0, 140) }); log.length = Math.min(log.length, 60); renderLog(); },
    setConversation(msgs) {
      const el = $('nzConv'); if (!el) return;
      el.innerHTML = msgs.slice(-6).map((m) => `<div class="nz-msg ${m.role === 'user' ? 'me' : 'ai'}"><small>${m.role === 'user' ? 'Du' : 'Jarvis'}</small>${esc(G.clip(m.content, 260))}</div>`).join('') || '<p class="nz-hint">Noch kein Gespräch.</p>';
      el.scrollTop = el.scrollHeight;
    },
    show() { if (cv) { size(); if (!view.s || (view.tx === 0 && view.ty === 0 && graph.nodes.length)) fit(); } },
  };
})();
