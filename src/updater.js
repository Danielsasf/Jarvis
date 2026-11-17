// Selbst-Update über GitHub-Releases.
// Ein Release enthält die Datei "jarvis-app.json" = der komplette App-Code als Text.
// Der neue Code landet in %APPDATA%\Jarvis\app\<version>\ und wird beim Neustart geladen.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

const GH_HEADERS = { 'user-agent': 'Jarvis-Updater', accept: 'application/vnd.github+json' };

// Quelle 1: Datei release/version.json im Repo (einfach per Hochladen aktualisierbar)
async function fromRepoFile(repo, fetchImpl) {
  const base = `https://raw.githubusercontent.com/${repo}/main/release`;
  const res = await fetchImpl(`${base}/version.json?t=${Date.now()}`, { headers: { 'user-agent': 'Jarvis-Updater' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const j = await res.json();
  return j?.version ? { version: String(j.version).replace(/^v/, ''), notes: String(j.notes || ''), url: `${base}/jarvis-app.json?v=${j.version}` } : null;
}
// Quelle 2: GitHub-Release mit Asset jarvis-app.json
async function fromRelease(repo, fetchImpl) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, { headers: GH_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const rel = await res.json();
  const asset = (rel.assets || []).find((a) => a.name === 'jarvis-app.json');
  const version = String(rel.tag_name || '').replace(/^v/, '');
  return version && asset ? { version, notes: String(rel.body || ''), url: asset.browser_download_url } : null;
}

async function checkForUpdate({ repo, currentVersion, shellVersion, fetchImpl = fetch }) {
  const found = (await Promise.allSettled([fromRepoFile(repo, fetchImpl), fromRelease(repo, fetchImpl)]))
    .map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean);
  if (!found.length) return { available: false, reason: 'Noch keine Updates veröffentlicht.' };
  const best = found.sort((a, b) => cmpVersion(b.version, a.version))[0];
  if (cmpVersion(best.version, currentVersion) <= 0) return { available: false, version: best.version, reason: 'Jarvis ist aktuell.' };
  return { available: true, version: best.version, notes: best.notes.slice(0, 2000), url: best.url, shellVersion };
}

function safeJoin(root, rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel) || /^[a-z]:/i.test(rel)) throw new Error(`Ungültiger Pfad: ${rel}`);
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error(`Ungültiger Pfad: ${rel}`);
  return full;
}

/** Lädt und entpackt das Update. Gibt den Ordner zurück. */
async function downloadUpdate({ url, expectedVersion, appDir, shellVersion, fetchImpl = fetch }) {
  const res = await fetchImpl(url, { headers: { 'user-agent': 'Jarvis-Updater' }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const raw = await res.text();
  const pkg = JSON.parse(raw);
  if (pkg.format !== 1 || !pkg.files || typeof pkg.files !== 'object') throw new Error('Update-Datei hat ein unbekanntes Format.');
  if (pkg.version !== expectedVersion) throw new Error('Versionsnummer passt nicht.');
  if (pkg.minShell && cmpVersion(shellVersion, pkg.minShell) < 0) {
    throw new Error(`Dieses Update braucht eine neue Grundinstallation (mind. ${pkg.minShell}). Bitte einmal neu herunterladen.`);
  }
  // Prüfsumme gegen Übertragungsfehler
  const hash = crypto.createHash('sha256').update(JSON.stringify(pkg.files)).digest('hex');
  if (pkg.sha256 && pkg.sha256 !== hash) throw new Error('Update-Datei ist beschädigt.');
  if (!pkg.files['main.js']) throw new Error('Update unvollständig.');

  const target = path.join(appDir, pkg.version);
  const tmp = `${target}.tmp-${Date.now()}`;
  for (const [rel, content] of Object.entries(pkg.files)) {
    const file = safeJoin(tmp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : Buffer.from(content.base64, 'base64'));
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
  fs.writeFileSync(path.join(appDir, 'current.json'), JSON.stringify({ version: pkg.version, dir: target, tries: 0 }));
  return target;
}

module.exports = { cmpVersion, checkForUpdate, downloadUpdate, safeJoin };
