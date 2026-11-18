const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/renderer/graph.js');

const data = {
  version: '2.19.0',
  packs: [{ id: 'lernen', name: 'Lernen', befehl: '/lernen', beschreibung: 'Hilft beim Lernen und Vokabeln üben', beispiele: [], enabled: true },
    { id: 'kaputt', name: 'Kaputt', error: 'x' }],
  memory: [{ id: 'm1', text: 'Ich übe Vokabeln für Englisch', created: '2026-11-17', by: 'du' }, { id: 'm2', text: 'Mein Hund heißt Bello' }],
  providers: [{ id: 'g', name: 'Gemini (Google)', connected: true, model: 'flash', ms: 800 }, { id: 'x', name: 'Weg', connected: false }],
  chats: [{ id: 'c1', title: 'Neuer Chat', messages: [] }, { id: 'c2', title: 'Mathe', messages: [{ content: 'Hilf mir bitte' }] }],
};

test('Graph: Punkte für Kern, Pakete, KIs, Gedächtnis, Chats (ohne Fehler/leer/getrennt)', () => {
  const g = G.buildGraph(data);
  const ids = g.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ['c:c2', 'hub', 'k:g', 'm:m1', 'm:m2', 'p:lernen']);
  assert.ok(g.edges.some(([a, b]) => [a, b].includes('hub') && [a, b].includes('p:lernen')));
});

test('Graph: Stichwörter verbinden Gedächtnis mit passendem Paket, Rest hängt am Kern', () => {
  const g = G.buildGraph(data);
  const has = (a, b) => g.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  assert.ok(has('m:m1', 'p:lernen'), 'Vokabeln verbindet');
  assert.ok(has('hub', 'm:m2'), 'ohne Treffer am Kern');
  assert.ok(g.nodes.every((n) => Number.isFinite(n.deg)));
});

test('Graph: neuer Punkt erscheint nahe am Kern, alte behalten Lage; Layout bleibt endlich', () => {
  const g1 = G.buildGraph(data); G.place(g1.nodes, []);
  for (let i = 0; i < 150; i++) G.step(g1.nodes, g1.edges, 1);
  const lage = g1.nodes.find((n) => n.id === 'p:lernen');
  const g2 = G.buildGraph({ ...data, packs: [...data.packs, { id: 'neu', name: 'Neu', befehl: '/neu', enabled: true }] });
  const fresh = G.place(g2.nodes, g1.nodes);
  assert.equal(fresh, 1);
  const same = g2.nodes.find((n) => n.id === 'p:lernen');
  assert.equal(same.x, lage.x);
  const neu = g2.nodes.find((n) => n.id === 'p:neu');
  assert.ok(Math.hypot(neu.x, neu.y) <= 85);
  for (let i = 0; i < 100; i++) G.step(g2.nodes, g2.edges, 0.5);
  assert.ok(g2.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  assert.notEqual(G.signature(g1), G.signature(g2));
});
