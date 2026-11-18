// Zusatzanzeigen im Leitstand-Look: Ring-Anzeigen (CPU, Arbeitsspeicher, Uhrzeit, Datum), Tagesleiste, Hintergrund-Effekte.
// Alles nur Darstellung; die Systemwerte (Auslastung in Prozent) kommen aus dem Hauptprozess, keine Dateien, keine Namen.
(() => {
  const TAU = Math.PI * 2;
  const CYAN = [72, 220, 255];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function setup(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 100; const h = canvas.clientHeight || 100;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  // Ring-Anzeige: Wert 0..1 als leuchtender Bogen, Skala, Beschriftung
  function gauge(canvas, { value = 0, big = '', small = '', color = CYAN }) {
    const { ctx, w, h } = setup(canvas); const x = w / 2; const y = h / 2; const R = Math.min(w, h) / 2 - 5;
    ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.strokeStyle = rgba(color, 0.18); ctx.lineWidth = 7; ctx.stroke();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU - Math.PI / 2; const major = i % 10 === 0;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (R - 8), y + Math.sin(a) * (R - 8)); ctx.lineTo(x + Math.cos(a) * (R - (major ? 13 : 11)), y + Math.sin(a) * (R - (major ? 13 : 11)));
      ctx.strokeStyle = rgba(color, major ? 0.8 : 0.35); ctx.lineWidth = 1; ctx.stroke();
    }
    const v = Math.max(0, Math.min(1, value));
    if (v > 0.003) {
      ctx.save(); ctx.shadowColor = rgba(color, 0.9); ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + v * TAU); ctx.strokeStyle = rgba(color, 0.95); ctx.lineWidth = 7; ctx.stroke(); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(x, y, R - 18, 0, TAU); ctx.strokeStyle = rgba(color, 0.3); ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e6fbff';
    ctx.font = `600 ${Math.round(R * 0.5)}px "Bahnschrift", "Segoe UI", sans-serif`; ctx.fillText(big, x, y - (small ? 4 : 0));
    if (small) { ctx.fillStyle = rgba(color, 0.9); ctx.font = `${Math.round(R * 0.2)}px "Cascadia Mono", Consolas, monospace`; ctx.fillText(small, x, y + R * 0.38); }
  }

  const $ = (id) => document.getElementById(id);
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const stats = { cpu: 0, ram: 0 };

  function drawClock() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    const t = $('ringTime'); if (t) gauge(t, { value: (d.getSeconds() + d.getMilliseconds() / 1000) / 60, big: `${p(d.getHours())}:${p(d.getMinutes())}`, small: p(d.getSeconds()) });
    const dt = $('ringDate'); if (dt) { const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); gauge(dt, { value: d.getDate() / dim, big: String(d.getDate()), small: MONTHS[d.getMonth()].slice(0, 3).toUpperCase() }); }
  }
  function drawStats() {
    const c = $('ringCpu'); if (c) gauge(c, { value: stats.cpu / 100, big: `${Math.round(stats.cpu)}%`, small: 'CPU', color: stats.cpu > 85 ? [255, 120, 90] : CYAN });
    const r = $('ringRam'); if (r) gauge(r, { value: stats.ram / 100, big: `${Math.round(stats.ram)}%`, small: 'RAM', color: stats.ram > 90 ? [255, 120, 90] : CYAN });
  }
  async function pollStats() {
    try { const s = await window.jarvis.getStats(); if (s) { stats.cpu = s.cpu; stats.ram = s.ram; drawStats(); } } catch { /* egal */ }
  }
  const WX_ICON = {
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
    cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.4 4.6 4.6 0 0 0 7 18.5z"/>',
    rain: '<path d="M7 15h10a3.8 3.8 0 0 0 .5-7.55A5.2 5.2 0 0 0 7.2 6.6 4.2 4.2 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
    snow: '<path d="M7 14.5h10a3.8 3.8 0 0 0 .5-7.55A5.2 5.2 0 0 0 7.2 6.1 4.2 4.2 0 0 0 7 14.5z"/><path d="M8.5 18.5h.01M12.5 19.5h.01M16.5 18.5h.01M10.5 21h.01M14.5 21h.01"/>',
    fog: '<path d="M5 9h14M3.5 13h17M6 17h12"/>',
    storm: '<path d="M7 14h10a3.8 3.8 0 0 0 .5-7.55A5.2 5.2 0 0 0 7.2 5.6 4.2 4.2 0 0 0 7 14z"/><path d="M12.5 14l-2.5 4h3l-2 4"/>',
  };
  const wxSvg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WX_ICON[k] || WX_ICON.cloud}</svg>`;
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  async function drawWeather() {
    const el = $('wx'); if (!el) return;
    let w; try { w = await window.jarvis.getWeather(); } catch { w = { error: 'Nicht erreichbar' }; }
    if (!w || !w.set) { el.innerHTML = '<div class="wx-empty">Wetter<br><small>Ort einstellen</small></div>'; return; }
    if (w.error) { el.innerHTML = `<div class="wx-empty">Wetter<br><small>${esc(w.error)}</small></div>`; return; }
    const days = (w.days || []).slice(1, 4).map((d) => {
      const [y, m, dd] = String(d.date).split('-').map(Number);
      return `<div class="wx-day"><span>${WD[new Date(y, m - 1, dd).getDay()]}</span>${wxSvg(d.icon)}<b>${esc(d.max)}°</b><i>${esc(d.min)}°</i></div>`;
    }).join('');
    el.innerHTML = `<div class="wx-now">${wxSvg(w.icon)}<div><strong>${esc(w.temp)}°</strong><small>${esc(w.text)}</small></div></div>`
      + `<div class="wx-place">${esc(w.place)}${w.stale ? ' · alt' : ''}</div>`
      + `<div class="wx-meta">Wind ${esc(w.wind)} km/h · Feuchte ${esc(w.humidity)}%</div><div class="wx-days">${days}</div>`;
  }
  window.refreshWeather = drawWeather;
  function dayStrip() {
    const el = $('dayStrip'); if (!el) return;
    const d = new Date(); const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    el.innerHTML = Array.from({ length: dim }, (_, i) => `<span${i + 1 === d.getDate() ? ' class="today"' : ''}>${String(i + 1).padStart(2, '0')}</span>`).join('');
  }

  // Hintergrund: schwebende Lichtpunkte + feine Leiterbahnen (einmal gezeichnet)
  function fx() {
    const cv = $('fx'); if (!cv) return;
    const ctx = cv.getContext('2d'); let W = 0; let H = 0; let dots = []; let traces = null;
    function resize() {
      const dpr = Math.max(1, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(70, W * H / 22000));
      dots = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 6, vy: -2 - Math.random() * 7, r: 0.6 + Math.random() * 1.5, a: 0.12 + Math.random() * 0.4, ph: Math.random() * 6 }));
      traces = document.createElement('canvas'); traces.width = W; traces.height = H;
      const t = traces.getContext('2d'); t.lineWidth = 1; t.strokeStyle = 'rgba(72,220,255,.13)'; t.fillStyle = 'rgba(72,220,255,.4)';
      const rnd = (a, b) => a + Math.random() * (b - a);
      for (let i = 0; i < 16; i++) {
        const left = i % 2 === 0; let x = left ? rnd(0, W * 0.08) : rnd(W * 0.92, W); let y = rnd(H * 0.08, H * 0.95);
        t.beginPath(); t.moveTo(x, y);
        for (let s = 0; s < 4; s++) { const dx = (left ? 1 : -1) * rnd(30, W * 0.09); x += dx; t.lineTo(x, y); y += rnd(-90, 90); t.lineTo(x, y); }
        t.stroke(); t.beginPath(); t.arc(x, y, 2.5, 0, TAU); t.fill();
      }
    }
    resize(); addEventListener('resize', resize);
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, W, H); if (traces) ctx.drawImage(traces, 0, 0);
      for (const d of dots) {
        d.x += d.vx * dt; d.y += d.vy * dt; if (d.y < -4) { d.y = H + 4; d.x = Math.random() * W; } if (d.x < -4) d.x = W + 4; if (d.x > W + 4) d.x = -4;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fillStyle = `rgba(110,232,255,${d.a * (0.65 + 0.35 * Math.sin(now / 900 + d.ph))})`; ctx.fill();
      }
      if (!reduce) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function start() {
    dayStrip(); drawClock(); drawStats(); fx();
    setInterval(drawClock, 1000); setInterval(pollStats, 2500); setInterval(dayStrip, 3600000); pollStats();
    drawWeather(); setInterval(drawWeather, 20 * 60 * 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
