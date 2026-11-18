// Lokale Befehlserkennung: Eine Ollama-KI auf deinem PC wandelt einen Satz in genau EINE erlaubte Aktion um.
// Sie führt nichts aus und ändert keine Einstellungen. Die Aktion geht danach durch computer.plan() und
// wird erst nach deinem Klick auf "Ausführen" gestartet. Kostet nichts, weil es lokal läuft.
const computerLib = require('./computer');

function systemPrompt(c) {
  const allowed = computerLib.allowedSummary(c).map((x) => `- ${x.hint}`).join('\n');
  return `Du wandelst den Befehl des Nutzers in GENAU EINE Aktion um. Antworte nur mit einem einzigen JSON-Objekt, ohne Text davor oder danach.
Erlaubte Aktionen:
${allowed}
Passt der Befehl zu keiner Aktion, antworte: {"typ":"keine"}
Du darfst nichts anderes vorschlagen, keine Einstellungen ändern und nichts löschen oder verschieben.`;
}

/** Erstes JSON-Objekt aus dem Text ziehen. */
function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try { const j = JSON.parse(m[0]); return j && typeof j === 'object' ? j : null; } catch { return null; }
}

/** Kurzer, verständlicher Satz für den Knopf, z. B. „Programm „Rechner“ öffnen“. */
function describe(a) {
  switch (a?.typ) {
    case 'programm_oeffnen': return `Programm „${String(a.name || '').slice(0, 40)}“ öffnen`;
    case 'ordner_zeigen': return `Ordner „${String(a.ort || '').slice(0, 30)}“ im Explorer zeigen`;
    case 'dateien_suchen': return `Dateien mit „${String(a.suche || '').slice(0, 40)}“ im Namen suchen`;
    case 'webseite_oeffnen': return `Webseite ${String(a.url || '').slice(0, 120)} öffnen`;
    case 'medien_steuern': return `Medienbefehl „${String(a.befehl || '').slice(0, 20)}“ ausführen`;
    default: return 'Aktion ausführen';
  }
}

/**
 * Fragt die lokale KI. Gibt { action, text } oder null zurück (null = nichts Erlaubtes erkannt).
 * deps: { provider, key, model, chatStream, signal }
 */
async function parse(cfg, text, deps) {
  let out = '';
  await deps.chatStream(deps.provider, deps.key, deps.model, [{ role: 'user', content: String(text).slice(0, 500) }], systemPrompt(cfg), {
    signal: deps.signal, onDelta: (t) => { out += t; },
  });
  const a = extractJson(out);
  if (!a || a.typ === 'keine') return null;
  const p = computerLib.plan(cfg, a);
  if (!p.ok) return null; // nicht erlaubt oder unbekannt: lieber an die normale KI geben
  return { action: a, text: describe(a) };
}

module.exports = { systemPrompt, extractJson, describe, parse };
