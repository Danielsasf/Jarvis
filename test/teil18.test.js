const test = require('node:test');
const assert = require('node:assert/strict');
const ws = require('../src/websearch');

test('needsWeb: aktuelle Fragen ja, Allgemeines nein', () => {
  assert.equal(ws.needsWeb('Wie ist das Wetter heute in Hamburg?'), true);
  assert.equal(ws.needsWeb('Was sind die aktuellen Nachrichten?'), true);
  assert.equal(ws.needsWeb('Erkläre mir Photosynthese'), false);
  assert.equal(ws.needsWeb(''), false);
});

test('realLink: DuckDuckGo-Umleitung auf echte https-Adresse', () => {
  assert.equal(ws.realLink('//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.tagesschau.de%2Fa&amp;rut=x'), 'https://www.tagesschau.de/a');
  assert.equal(ws.realLink('http://example.com/x'), null);
  assert.equal(ws.realLink('javascript:alert(1)'), null);
});

test('parseResults liest Titel, Link und Ausschnitt aus', () => {
  const html = `
  <div class="result results_links web-result ">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.tagesschau.de%2Fnews&amp;rut=1">Neues &amp; Wichtiges</a></h2>
    <a class="result__snippet" href="x">Der <b>Bundestag</b> hat heute beschlossen.</a>
  </div>
  <div class="result results_links web-result ">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=http%3A%2F%2Fschlecht.de">Unsicher</a>
  </div>
  <div class="result results_links web-result ">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.de%2F">Zweiter</a>
    <a class="result__snippet" href="x">Text B</a>
  </div>`;
  const r = ws.parseResults(html, 5);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { title: 'Neues & Wichtiges', link: 'https://www.tagesschau.de/news', snippet: 'Der Bundestag hat heute beschlossen.' });
  assert.equal(r[1].link, 'https://b.de/');
});

test('search nutzt den Fetch und liefert Treffer; Fehler bei Status != 200', async () => {
  const html = '<div class="result"><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fx.de">X</a></div>';
  const ok = await ws.search('  Wetter   Hamburg ', async (url) => { assert.match(url, /q=Wetter%20Hamburg/); return { ok: true, text: async () => html }; });
  assert.equal(ok.query, 'Wetter Hamburg');
  assert.equal(ok.items[0].link, 'https://x.de/');
  await assert.rejects(ws.search('x', async () => ({ ok: false, status: 503 })), /503/);
});

test('promptBlock: leer ohne Treffer, sonst mit Quellen', () => {
  assert.equal(ws.promptBlock({ items: [] }), '');
  const b = ws.promptBlock({ query: 'q', items: [{ title: 'T', snippet: 'S', link: 'https://a.de' }] });
  assert.match(b, /Quelle: https:\/\/a\.de/);
});
