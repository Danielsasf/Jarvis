// Leitstand 2.0: Anzeige echter Systemwerte (CPU je Kern, RAM, Laufwerk, Laufzeit) und Wetter.
// Nur Darstellung. Werte kommen als Zahlen aus dem Hauptprozess; Text wird nur per textContent gesetzt.
(() => {
  const $ = (id) => document.getElementById(id);
  const visible = () => document.body.classList.contains('view-mc');
  const dash = '--';
  const p2 = (n) => String(n).padStart(2, '0');
  const de = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const bars = []; const vals = [];

  function setCores(n) {
    if (bars.length === n) return;
    $('mcCores').textContent = ''; bars.length = 0; vals.length = 0;
    for (let i = 0; i < n; i++) {
      const row = el('div', 'mc-core'); const tr = el('div', 'mc-bar'); const b = el('i'); tr.appendChild(b);
      const v = el('span', null, dash); row.append(el('span', null, `C${i + 1}`), tr, v);
      $('mcCores').appendChild(row); bars.push(b); vals.push(v);
    }
    $('mcCores').classList.toggle('many', n > 10);
  }

  function render(s) {
    if (!s) return;
    const cores = s.cpu && Array.isArray(s.cpu.cores) ? s.cpu.cores.slice(0, 64).map(fin) : [];
    $('mcCpuName').textContent = `CPU · ${s.cpuName ? String(s.cpuName) : (cores.length ? `${cores.length} Kerne` : dash)}`;
    setCores(cores.length);
    cores.forEach((v, i) => { bars[i].style.width = `${v === null ? 0 : v}%`; vals[i].textContent = v === null ? dash : `${v}%`; });
    const tot = fin(s.cpu && s.cpu.total);
    $('mcCpu').textContent = tot === null ? dash : String(tot);

    const m = s.mem; const ring = $('mcRamRing');
    if (m && fin(m.total) && fin(m.used) !== null) {
      const r = Math.max(0, Math.min(100, (m.used / m.total) * 100));
      $('mcRamPct').textContent = `${Math.round(r)}%`; ring.style.strokeDasharray = `${(r * 3.14).toFixed(1)} 400`;
      $('mcRamText').textContent = `${de(m.used / 1073741824)} / ${de(m.total / 1073741824, 0)} GB`;
    } else { $('mcRamPct').textContent = dash; ring.style.strokeDasharray = '0 400'; $('mcRamText').textContent = `${dash} / ${dash} GB`; }

    const d = s.disk;
    if (d && fin(d.use) !== null) { $('mcDiskBar').style.width = `${d.use}%`; $('mcDiskText').textContent = `${d.use}% belegt · ${de(d.free / 1073741824, 0)} GB frei`; }
    else { $('mcDiskBar').style.width = '0%'; $('mcDiskText').textContent = dash; }

    const up = fin(s.uptime);
    if (up === null) $('mcUp').textContent = dash;
    else { const dd = Math.floor(up / 86400); const h = Math.floor((up % 86400) / 3600); const mi = Math.floor((up % 3600) / 60); $('mcUp').textContent = `${dd ? `${dd} T ` : ''}${p2(h)}:${p2(mi)}`; }
  }

  async function poll() {
    if (!visible()) return;
    try { render(await window.jarvis.getSysDetail()); } catch { /* bleibt auf "--" */ }
  }

  let wxAt = 0;
  async function weather() {
    if (!visible() || Date.now() - wxAt < 10 * 60 * 1000) return;
    wxAt = Date.now();
    const box = $('mcWx'); box.textContent = '';
    let w; try { w = await window.jarvis.getWeather(); } catch { w = { error: 'Nicht erreichbar' }; }
    if (!w || w.set === false) { box.appendChild(el('p', 'mc-dim', 'Ort in den Einstellungen setzen (System & Updates > Wetter).')); wxAt = 0; return; }
    if (w.error && !Number.isFinite(w.temp)) { box.appendChild(el('p', 'mc-dim', `Wetter: ${String(w.error).slice(0, 80)}`)); wxAt = 0; return; }
    const top = el('div', 'mc-wxtop'); top.append(el('div', 'mc-big', `${Number.isFinite(w.temp) ? w.temp : dash}°`), el('div', 'mc-dim', `${String(w.text || '').slice(0, 30)} · ${String(w.place || '').slice(0, 40)}`));
    box.appendChild(top);
    const row = el('div', 'mc-fc');
    (Array.isArray(w.days) ? w.days : []).slice(0, 4).forEach((x) => {
      const c = el('div'); const day = new Date(`${String(x.date).slice(0, 10)}T12:00:00`);
      c.append(el('em', null, ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'][day.getDay()] || dash), el('b', null, `${fin(x.max) === null ? dash : x.max}°`), el('small', null, `${fin(x.min) === null ? dash : x.min}°`));
      row.appendChild(c);
    });
    box.appendChild(row);
  }

  function tick() { const d = new Date(); $('mcClock').textContent = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; poll(); weather(); }
  setInterval(tick, 1500); tick();
})();
