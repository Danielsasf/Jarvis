const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const GUIDES = require('../src/renderer/guides.js');
const { PROVIDERS } = require('../src/providers');

test('Anleitungen: jede Seite hat Titel, Schritte und nur https-Links', () => {
  for (const [pane, g] of Object.entries(GUIDES)) {
    assert.ok(g.title, pane);
    assert.ok(g.sections.length > 0, pane);
    for (const sx of g.sections) assert.ok(sx.steps.length >= 2, `${pane}: ${sx.heading}`);
    for (const l of g.links) assert.match(l.url, /^https:\/\//, `${pane}: ${l.url}`);
  }
});

test('Anleitungen: Bereiche existieren in den Einstellungen', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  for (const pane of Object.keys(GUIDES)) assert.ok(html.includes(`data-pane="${pane}"`), pane);
});

test('Anleitungen: Schlüssel-Seiten der KI-Anbieter sind freigegeben', () => {
  const kisGuide = GUIDES.kis.links.map((l) => l.url);
  for (const url of kisGuide) assert.ok(url.startsWith('https://'));
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.ok(main.includes('GUIDE_URLS.has(url)'));
  assert.ok(PROVIDERS.some((p) => p.keyUrl));
});
