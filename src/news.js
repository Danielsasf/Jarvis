// Schlagzeilen aus einem öffentlichen RSS-Feed (Tagesschau, kostenlos, ohne Schlüssel).
// Gesendet wird nur die normale Feed-Anfrage; es werden keine Daten von dir übertragen.
const FEED = 'https://www.tagesschau.de/index~rss2.xml';

const decode = (s) => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&')
  .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/** RSS-Text -> [{ title, link }] (nur https-Links, höchstens max Einträge) */
function parseRss(xml, max = 5) {
  const out = [];
  for (const m of String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = m[0];
    const title = decode((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const link = decode((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
    if (title && /^https:\/\//.test(link)) out.push({ title: title.slice(0, 160), link });
    if (out.length >= max) break;
  }
  return out;
}

async function fetchNews(fetchFn = fetch, max = 5) {
  const r = await fetchFn(FEED, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!r.ok) throw new Error(`Nachrichtendienst antwortet mit ${r.status}`);
  const items = parseRss(await r.text(), max);
  if (!items.length) throw new Error('Keine Schlagzeilen gefunden.');
  return { source: 'tagesschau.de', items };
}

module.exports = { parseRss, fetchNews, FEED };
