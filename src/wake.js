// "Hey Jarvis": lokale Weckwort-Erkennung mit der eingebauten Windows-Spracherkennung (System.Speech).
// Läuft komplett offline auf dem PC. Erst nach dem Weckwort nimmt Jarvis deine Frage auf.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const THRESHOLD = { low: 0.88, mid: 0.8, high: 0.7 };

// PowerShell-Skript: erkennt nur die Weckwort-Sätze; eine Diktat-Grammatik fängt alles andere ab (weniger Fehlalarme).
const SCRIPT = String.raw`
param([double]$Min = 0.8)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Speech
  $recs = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if ($recs.Count -eq 0) { [Console]::Out.WriteLine('ERROR:Keine Windows-Spracherkennung installiert. Windows-Einstellungen > Zeit und Sprache > Sprache > Deutsch > Optionen > Spracherkennung hinzufügen.'); exit 2 }
  $info = $recs | Where-Object { $_.Culture.Name -eq 'de-DE' } | Select-Object -First 1
  if (-not $info) { $info = $recs | Where-Object { $_.Culture.Name -like 'de-*' } | Select-Object -First 1 }
  if (-not $info) { $info = $recs | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1 }
  if (-not $info) { $info = $recs[0] }
  $eng = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  $choices = New-Object System.Speech.Recognition.Choices
  $choices.Add([string[]]@('Hey Jarvis', 'Hei Jarvis', 'Hallo Jarvis', 'Okay Jarvis', 'Jarvis'))
  $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
  $gb.Culture = $info.Culture
  $wake = New-Object System.Speech.Recognition.Grammar($gb)
  $wake.Name = 'wake'
  $eng.LoadGrammar($wake)
  try { $dict = New-Object System.Speech.Recognition.DictationGrammar; $dict.Name = 'other'; $dict.Weight = 0.3; $eng.LoadGrammar($dict) } catch { }
  $eng.SetInputToDefaultAudioDevice()
  [Console]::Out.WriteLine('READY:' + $info.Culture.Name)
  while ($true) {
    $r = $eng.Recognize([TimeSpan]::FromSeconds(30))
    if ($r -ne $null -and $r.Grammar.Name -eq 'wake' -and $r.Confidence -ge $Min) {
      [Console]::Out.WriteLine('WAKE:' + [Math]::Round($r.Confidence, 2) + ':' + $r.Text)
    }
  }
} catch {
  [Console]::Out.WriteLine('ERROR:' + $_.Exception.Message)
  exit 1
}
`;

class WakeWord {
  constructor({ dir, onStatus, onHit, log = () => {}, platform = process.platform, spawnImpl = spawn }) {
    Object.assign(this, { dir, onStatus, onHit, log, platform, spawnImpl });
    this.proc = null; this.wanted = false; this.sens = 'mid'; this.restarts = 0; this.state = { state: 'off' };
  }
  status(s) { this.state = s; this.onStatus?.(s); }

  set(enabled, sens = this.sens) {
    const changed = sens !== this.sens;
    this.sens = THRESHOLD[sens] ? sens : 'mid';
    this.wanted = !!enabled;
    if (!this.wanted) return this.stop();
    if (this.platform !== 'win32') return this.status({ state: 'unsupported', detail: '„Hey Jarvis“ gibt es nur unter Windows.' });
    if (this.proc && changed) { this.stop(); }
    if (!this.proc) { this.restarts = 0; this.start(); }
  }

  start() {
    const file = path.join(this.dir, 'jarvis-weckwort.ps1');
    fs.writeFileSync(file, '﻿' + SCRIPT); // BOM, damit Umlaute in PowerShell 5 stimmen
    this.status({ state: 'starting' });
    const proc = this.spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, '-Min', String(THRESHOLD[this.sens])], { windowsHide: true });
    this.proc = proc;
    let buf = '';
    let fatal = false;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line.startsWith('READY:')) { this.restarts = 0; this.status({ state: 'ready', detail: line.slice(6) }); this.log(`Weckwort bereit (${line.slice(6)})`); }
        else if (line.startsWith('WAKE:')) {
          const [, conf, ...text] = line.split(':');
          this.log(`Weckwort erkannt (${conf})`);
          this.onHit?.({ confidence: Number(conf), text: text.join(':') });
        } else if (line.startsWith('ERROR:')) { fatal = true; this.status({ state: 'error', detail: line.slice(6) }); this.log(`Weckwort-Fehler: ${line.slice(6)}`); }
      }
    });
    proc.stderr?.on('data', (d) => this.log(`Weckwort: ${String(d).trim().slice(0, 200)}`));
    proc.on('error', (err) => { fatal = true; this.status({ state: 'error', detail: `PowerShell nicht startbar: ${err.message}` }); });
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (!this.wanted) return;
      if (fatal || this.restarts >= 3) { if (!fatal) this.status({ state: 'error', detail: 'Weckwort-Erkennung ist mehrfach abgestürzt.' }); return; }
      this.restarts++;
      setTimeout(() => { if (this.wanted && !this.proc) this.start(); }, 1500 * this.restarts);
    });
  }

  stop() {
    this.wanted = false;
    const p = this.proc; this.proc = null;
    try { p?.kill(); } catch { /* egal */ }
    this.status({ state: 'off' });
  }
}

module.exports = { WakeWord, THRESHOLD, SCRIPT };
