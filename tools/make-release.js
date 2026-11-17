// Baut dist/jarvis-app.json: den kompletten App-Code (src/) für das Selbst-Update.
// Hochladen als Asset eines GitHub-Releases mit Tag v<version>.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const { CODE_VERSION } = require(path.join(src, 'version.js'));

const files = {};
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else files[path.relative(src, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
  }
})(src);
delete files['boot.js']; // Startprogramm bleibt immer das mitgelieferte

const pkg = {
  format: 1,
  version: CODE_VERSION,
  minShell: '2.0.0',
  created: new Date().toISOString(),
  sha256: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  files,
};
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'jarvis-app.json'), JSON.stringify(pkg));
fs.mkdirSync(path.join(root, 'release'), { recursive: true });
fs.copyFileSync(path.join(root, 'dist', 'jarvis-app.json'), path.join(root, 'release', 'jarvis-app.json'));
fs.writeFileSync(path.join(root, 'release', 'version.json'), JSON.stringify({ version: CODE_VERSION, notes: process.env.NOTES || '' }, null, 2));
console.log(`jarvis-app.json v${CODE_VERSION}: ${Object.keys(files).length} Dateien`);
