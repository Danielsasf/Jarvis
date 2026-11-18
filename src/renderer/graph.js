// Gedächtnis-Graph: baut aus Paketen, Gedächtnis, KIs und Chats Punkte + Verbindungen und rechnet das Layout.
// Läuft im Fenster (window.JGraph) und in Node (für Tests).
(function (root) {
  const STOP = new Set(['dieser', 'diese', 'dieses', 'einen', 'einem', 'einer', 'wurde', 'werden', 'haben', 'nicht', 'jarvis', 'sollen', 'können', 'kannst', 'mehr', 'auch', 'oder', 'aber', 'wenn', 'dann', 'sehr', 'immer', 'noch', 'schon', 'bitte']);
  const tokens = (s) => [...new Set((String(s || '').toLowerCase().match(/[a-zäöüß]{5,}/g) || []).filter((w) => !STOP.has(w)))];
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

  function buildGraph({ packs = [], memory = [], providers = [], chats = [], version = '' } = {}) {
    const nodes = [{ id: 'hub', type: 'hub', label: 'Jarvis', text: `Version ${version || '–'}`, r: 18 }];
    const edges = []; const seen = new Set();
    const link = (a, b) => { const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (a !== b && !seen.has(k)) { seen.add(k); edges.push([a, b]); } };
    for (const p of packs) {
      if (p.error) continue;
      nodes.push({ id: `p:${p.id}`, type: 'pack', label: p.name, text: p.beschreibung || '', cmd: p.befehl, pid: p.id, locked: !!p.locked, on: p.enabled !== false, r: 8.5, kw: tokens(`${p.name} ${p.beschreibung} ${(p.beispiele || []).join(' ')}`) });
      link('hub', `p:${p.id}`);
    }
    for (const k of providers) {
      if (!k.connected) continue;
      nodes.push({ id: `k:${k.id}`, type: 'ki', label: String(k.name || k.id).split(' (')[0], text: `${k.model || 'Modell offen'}${k.ms != null ? ` · ${(k.ms / 1000).toFixed(2)} s` : ''}${k.enabled === false ? ' · aus' : ''}`, r: 6.5 });
      link('hub', `k:${k.id}`);
    }
    for (const m of memory) {
      nodes.push({ id: `m:${m.id}`, type: 'memory', label: clip(m.text, 26), text: m.text, date: m.created, by: m.by, r: 5, kw: tokens(m.text) });
    }
    for (const c of chats.slice(0, 12)) {
      if (!c.messages?.length) continue;
      nodes.push({ id: `c:${c.id}`, type: 'chat', label: clip(c.title || 'Chat', 24), text: `${c.messages.length} Nachrichten`, r: 4.5, kw: tokens(`${c.title} ${c.messages.slice(0, 4).map((x) => x.content).join(' ')}`) });
    }
    // Verbindungen über gemeinsame Stichwörter (höchstens 3 je Punkt), Rest hängt am Kern
    const deg = new Map(); const bump = (id) => deg.set(id, (deg.get(id) || 0) + 1);
    const withKw = nodes.filter((n) => n.kw && n.kw.length);
    for (let i = 0; i < withKw.length; i++) {
      for (let j = i + 1; j < withKw.length; j++) {
        const a = withKw[i]; const b = withKw[j];
        if (a.type === 'pack' && b.type === 'pack') continue;
        if ((deg.get(a.id) || 0) >= 3 || (deg.get(b.id) || 0) >= 3) continue;
        if (a.kw.some((w) => b.kw.includes(w))) { link(a.id, b.id); bump(a.id); bump(b.id); }
      }
    }
    for (const n of nodes) if ((n.type === 'memory' || n.type === 'chat') && !(deg.get(n.id))) link('hub', n.id);
    for (const [a, b] of edges) { bump(a); bump(b); }
    for (const n of nodes) n.deg = deg.get(n.id) || 0;
    return { nodes, edges };
  }
  const signature = (g) => g.nodes.map((n) => `${n.id}${n.on === false ? '-' : ''}`).join(',');

  // Eine Rechenrunde: Abstoßung, Federn, sanfter Zug zur Mitte. Der Kern bleibt in der Mitte.
  function step(nodes, edges, alpha = 1) {
    const idx = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) { n.vx = n.vx || 0; n.vy = n.vy || 0; }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]; const b = nodes[j];
        let dx = a.x - b.x; let dy = a.y - b.y; let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
        if (d2 > 90000) continue;
        const f = (2400 * alpha) / d2; const d = Math.sqrt(d2);
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    for (const [ia, ib] of edges) {
      const a = idx.get(ia); const b = idx.get(ib); if (!a || !b) continue;
      const dx = b.x - a.x; const dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = ia === 'hub' || ib === 'hub' ? 150 : 80; const f = (d - rest) * 0.012 * alpha;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha;
      n.vx *= 0.82; n.vy *= 0.82;
      if (n.id === 'hub') { n.x = 0; n.y = 0; n.vx = 0; n.vy = 0; continue; }
      if (!n.fixed) { n.x += Math.max(-12, Math.min(12, n.vx)); n.y += Math.max(-12, Math.min(12, n.vy)); }
    }
  }
  // Neue Punkte starten nahe am Kern, alte behalten ihre Lage
  function place(newNodes, oldNodes) {
    const old = new Map((oldNodes || []).map((n) => [n.id, n]));
    let fresh = 0;
    for (const n of newNodes) {
      const o = old.get(n.id);
      if (o) { n.x = o.x; n.y = o.y; n.vx = 0; n.vy = 0; }
      else { const a = Math.random() * Math.PI * 2; const r = n.id === 'hub' ? 0 : 40 + Math.random() * 40; n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; n.fresh = performance_now(); fresh++; }
    }
    return fresh;
  }
  const performance_now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function neighbors(g, id) {
    const out = new Set();
    for (const [a, b] of g.edges) { if (a === id) out.add(b); else if (b === id) out.add(a); }
    return out;
  }
  const api = { buildGraph, signature, step, place, neighbors, tokens, clip };
  root.JGraph = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
