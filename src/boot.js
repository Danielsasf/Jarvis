// Startpunkt: lädt die neueste installierte App-Version (aus Updates) oder die mitgelieferte.
// Startet eine Update-Version 2x nicht sauber, wird automatisch die mitgelieferte genommen.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { CODE_VERSION } = require('./version');
const { cmpVersion } = require('./updater');

app.setName('Jarvis');
const appDir = path.join(app.getPath('userData'), 'app');
const currentFile = path.join(appDir, 'current.json');

global.JARVIS = { shellVersion: CODE_VERSION, appDir, bundledDir: __dirname, markHealthy: () => {} };

let entry = path.join(__dirname, 'main.js');
try {
  const cur = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
  const usable = cur.dir && cmpVersion(cur.version, CODE_VERSION) > 0 && (cur.tries || 0) < 2 && fs.existsSync(path.join(cur.dir, 'main.js'));
  if (usable) {
    cur.tries = (cur.tries || 0) + 1;
    fs.writeFileSync(currentFile, JSON.stringify(cur));
    entry = path.join(cur.dir, 'main.js');
    // main.js meldet nach erfolgreichem Start "gesund" -> Zähler zurück
    global.JARVIS.markHealthy = () => { try { cur.tries = 0; fs.writeFileSync(currentFile, JSON.stringify(cur)); } catch { /* egal */ } };
  }
} catch { /* noch kein Update installiert */ }

try {
  require(entry);
} catch (err) {
  if (entry !== path.join(__dirname, 'main.js')) {
    console.error('Update-Version defekt, nutze mitgelieferte Version:', err);
    require('./main.js');
  } else {
    throw err;
  }
}
