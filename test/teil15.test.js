const test = require('node:test');
const assert = require('node:assert');
const news = require('../src/news');

const XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title><![CDATA[Erste &amp; wichtige Meldung]]></title><link>https://www.tagesschau.de/a</link></item>
<item><title>Zweite &quot;Meldung&quot; &amp; mehr</title><link>https://www.tagesschau.de/b</link></item>
<item><title>Unsicherer Link</title><link>javascript:alert(1)</link></item>
<item><title>Dritte</title><link>http://nicht-https.de/c</link></item>
<item><title>Vierte</title><link>https://www.tagesschau.de/d</link></item></channel></rss>`;

test('RSS: Titel dekodiert, nur https-Links', () => {
  const items = news.parseRss(XML, 5);
  assert.deepStrictEqual(items.map((i) => i.title), ['Erste & wichtige Meldung', 'Zweite "Meldung" & mehr', 'Vierte']);
  assert.ok(items.every((i) => i.link.startsWith('https://')));
});

test('RSS: Höchstzahl wird eingehalten', () => {
  assert.strictEqual(news.parseRss(XML, 1).length, 1);
});

test('Schlagzeilen: Fehler und leerer Feed werden gemeldet', async () => {
  await assert.rejects(news.fetchNews(async () => ({ ok: false, status: 503 })), /503/);
  await assert.rejects(news.fetchNews(async () => ({ ok: true, text: async () => '<rss></rss>' })), /Keine Schlagzeilen/);
  const ok = await news.fetchNews(async () => ({ ok: true, text: async () => XML }), 2);
  assert.strictEqual(ok.items.length, 2);
});
