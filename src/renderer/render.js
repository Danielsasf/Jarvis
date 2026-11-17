// Antworten anzeigen: sicheres Mini-Markdown, Tafeln (Tabellen) und Widgets.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inline = (s) => esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>');

  // Gedächtnis-Markierungen nie anzeigen (auch nicht halb geschrieben)
  const stripMemory = (t) => String(t).replace(/<(merken|vergessen)>[\s\S]*?<\/\1>/gi, '').replace(/<(merken|vergessen)>[\s\S]*$/i, '').replace(/<(m(e(r(k(en?)?)?)?)?|v(e(r(g(e(s(s(en?)?)?)?)?)?)?)?)?$/i, '');

  const num = (v) => { const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const fmt = (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });

  function widget(json) {
    let w;
    try { w = JSON.parse(json); } catch { return `<pre><code>${esc(json)}</code></pre>`; }
    const title = w.titel ? `<div class="w-title">${esc(w.titel)}</div>` : '';
    switch (String(w.typ || w.type || '').toLowerCase()) {
      case 'kennzahlen': {
        const items = (w.werte || w.items || []).slice(0, 8);
        return `<div class="widget w-stats">${title}<div class="w-grid">${items.map((i) => `<div class="w-stat"><span>${esc(i.label)}</span><b>${esc(i.wert ?? i.value)}</b></div>`).join('')}</div></div>`;
      }
      case 'checkliste': {
        const items = (w.punkte || w.items || []).slice(0, 40);
        return `<div class="widget w-check">${title}<ul>${items.map((i) => `<li><label><input type="checkbox"><span>${inline(typeof i === 'string' ? i : i.text)}</span></label></li>`).join('')}</ul></div>`;
      }
      case 'balken': {
        const data = (w.daten || w.items || []).slice(0, 15);
        const max = Math.max(1, ...data.map((d) => Math.abs(num(d.wert ?? d.value))));
        const unit = w.einheit ? ` ${esc(w.einheit)}` : '';
        return `<div class="widget w-bars">${title}${data.map((d) => {
          const v = num(d.wert ?? d.value);
          return `<div class="w-bar"><span class="w-bl">${esc(d.label)}</span><span class="w-track"><i data-w="${Math.round((Math.abs(v) / max) * 100)}"></i></span><span class="w-bv">${fmt(v)}${unit}</span></div>`;
        }).join('')}</div>`;
      }
      case 'zeitplan': {
        const items = (w.eintraege || w.items || []).slice(0, 30);
        return `<div class="widget w-time">${title}<ol>${items.map((i) => `<li><time>${esc(i.zeit ?? i.time)}</time><span>${inline(i.text)}</span></li>`).join('')}</ol></div>`;
      }
      default:
        return `<pre><code>${esc(json)}</code></pre>`;
    }
  }

  function table(lines) {
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(lines[0]);
    const align = cells(lines[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
    const rows = lines.slice(2).map(cells);
    const td = (c, i, tag) => `<${tag}${align[i] ? ` class="a-${align[i]}"` : ''}>${inline(c)}</${tag}>`;
    return `<div class="tafel"><table><thead><tr>${head.map((c, i) => td(c, i, 'th')).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, i) => td(r[i] ?? '', i, 'td')).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function prose(part) {
    let html = '';
    for (const block of part.split(/\n{2,}/)) {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (!lines.length) continue;
      // Tabellen können mitten im Block stehen
      let i = 0; let buf = [];
      const flush = () => {
        if (!buf.length) return;
        if (buf.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(buf[0]);
          html += `<${ordered ? 'ol' : 'ul'}>${buf.map((l) => `<li>${inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
        } else {
          html += `<p>${buf.map((l) => (/^#{1,4}\s/.test(l) ? `<b>${inline(l.replace(/^#{1,4}\s/, ''))}</b>` : inline(l))).join('<br>')}</p>`;
        }
        buf = [];
      };
      while (i < lines.length) {
        if (/^\s*\|/.test(lines[i]) && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
          flush();
          const t = [lines[i], lines[i + 1]]; i += 2;
          while (i < lines.length && /^\s*\|/.test(lines[i])) t.push(lines[i++]);
          html += table(t);
        } else buf.push(lines[i++]);
      }
      flush();
    }
    return html;
  }

  function render(text, streaming = false) {
    const fences = stripMemory(text).split('```');
    const open = fences.length % 2 === 0; // Codeblock noch nicht geschlossen
    let html = '';
    fences.forEach((part, i) => {
      if (i % 2 === 0) { html += prose(part); return; }
      const lang = (part.match(/^([\w-]*)\n?/) || ['', ''])[1].toLowerCase();
      const body = part.replace(/^[\w-]*\n?/, '').replace(/\n$/, '');
      const last = i === fences.length - 1;
      if (lang === 'widget') html += last && open && streaming ? '<div class="widget w-loading">Widget wird erstellt …</div>' : widget(body);
      else html += `<pre><code>${esc(body)}</code></pre>`;
    });
    return html;
  }

  window.JarvisRender = { render, esc, inline, stripMemory };
})();
