// Misst, wie schnell jede KI das erste Wort liefert, und sortiert danach.
const DEFAULT_MS = 2500;

function record(old, ms, ok = true) {
  const sample = ok ? ms : Math.max(ms, 12000);
  if (!Number.isFinite(old)) return Math.round(sample);
  return Math.round(old * 0.6 + sample * 0.4);
}

/** Stabil: ähnlich schnelle KIs (gleiche 1,5-Sekunden-Stufe) behalten deine Reihenfolge. */
function sortBySpeed(ids, msOf) {
  return ids
    .map((id, i) => ({ id, i, bucket: Math.round((msOf(id) ?? DEFAULT_MS) / 1500) }))
    .sort((a, b) => a.bucket - b.bucket || a.i - b.i)
    .map((x) => x.id);
}

module.exports = { record, sortBySpeed, DEFAULT_MS };
