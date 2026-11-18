// "Hey Jarvis": lokale Weckwort-Erkennung mit der eingebauten Windows-Spracherkennung (System.Speech).
// Läuft komplett offline auf dem PC. Erst nach dem Weckwort nimmt Jarvis deine Frage auf.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const THRESHOLD = { low: 0.88, mid: 0.8, high: 0.7 };
const START_TIMEOUT_MS = 25000; // so lange darf der Start dauern
const SILENCE_TIMEOUT_MS = 100000; // das Skript meldet sich alle 30 s; länger still = hängt
const MAX_RESTARTS = 8; const MAX_RETRIES = 20;
const PERMANENT = /Keine Windows-Spracherkennung/;

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
    [Console]::Out.WriteLine('ALIVE')
    if ($r -ne $null) {
      $c = [Math]::Round($r.Confidence, 2)
      [Console]::Out.WriteLine('HEARD:' + $c + ':' + $r.Text)
      $named = ($r.Grammar.Name -eq 'wake' -and $r.Confidence -ge $Min)
      $fuzzy = ($r.Text -match '(?i)ar[vw][iy]s' -and $r.Confidence -ge ($Min - 0.25))
      if ($named -or $fuzzy) { [Console]::Out.WriteLine('WAKE:' + $c + ':' + $r.Text) }
    }
  }
} catch {
  [Console]::Out.WriteLine('ERROR:' + $_.Exception.Message)
  exit 1
}
`;

class WakeWord {
  constructor({ dir, onStatus, onHit, onHeard, log = () => {}, platform = process.platform, spawnImpl = spawn }) {
    Object.assign(this, { dir, onStatus, onHit, onHeard, log, platform, spawnImpl });
    this.proc = null; this.wanted = false; this.sens = 'mid'; this.restarts = 0; this.retries = 0; this.state = { state: 'off' }; this.timer = null; this.retryTimer = null; this.lastHit = 0;
  }
  status(s) { this.state = s; this.onStatus?.(s); }

  set(enabled, sens = this.sens) {
    const changed = sens !== this.sens;
    this.sens = THRESHOLD[sens] ? sens : 'mid';
    this.wanted = !!enabled;
    if (!this.wanted) return this.stop();
    if (this.platform !== 'win32') return this.status({ state: 'unsupported', detail: '„Hey Jarvis“ gibt es nur unter Windows.' });
    if (this.proc && changed) { this.stop(); }
    if (!this.proc) { this.restarts = 0; this.retries = 0; clearTimeout(this.retryTimer); this.start(); }
  }

  /** Neu starten, z. B. nach dem Aufwachen des PCs oder wenn das Mikrofon gewechselt wurde. */
  restart() {
    if (!this.wanted || this.platform !== 'win32') return;
    this.log('Weckwort wird neu gestartet');
    clearTimeout(this.retryTimer); this.restarts = 0; this.retries = 0;
    const p = this.proc; this.proc = null; this.clearWatch();
    try { p?.kill(); } catch { /* egal */ }
    this.start();
  }

  clearWatch() { clearTimeout(this.timer); this.timer = null; }
  // Wächter: kommt der Start nicht voran oder verstummt das Skript, wird es beendet (der Exit-Handler startet dann neu)
  watch(ms, why) {
    this.clearWatch();
    const proc = this.proc;
    this.timer = setTimeout(() => { if (this.proc === proc && proc) { this.log(`Weckwort: ${why}, Neustart`); try { proc.kill(); } catch { /* egal */ } } }, ms);
    this.timer.unref?.();
  }

  start() {
    const file = path.join(this.dir, 'jarvis-weckwort.ps1');
    fs.writeFileSync(file, '﻿' + SCRIPT); // BOM, damit Umlaute in PowerShell 5 stimmen
    this.status({ state: 'starting' });
    const proc = this.spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, '-Min', String(THRESHOLD[this.sens])], { windowsHide: true });
    this.proc = proc;
    this.watch(START_TIMEOUT_MS, 'Start dauert zu lange');
    let buf = '';
    let fatal = false; let retryable = null;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      buf += d;
      if (this.state.state === 'ready') this.watch(SILENCE_TIMEOUT_MS, 'keine Lebenszeichen');
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line === 'ALIVE') continue;
        if (line.startsWith('READY:')) { this.restarts = 0; this.retries = 0; this.watch(SILENCE_TIMEOUT_MS, 'keine Lebenszeichen'); this.status({ state: 'ready', detail: line.slice(6) }); this.log(`Weckwort bereit (${line.slice(6)})`); }
        else if (line.startsWith('HEARD:')) { const [, conf, ...text] = line.split(':'); this.onHeard?.({ confidence: Number(conf), text: text.join(':').slice(0, 80) }); }
        else if (line.startsWith('WAKE:')) {
          if (Date.now() - this.lastHit < 1500) continue; // Doppeltreffer ignorieren
          this.lastHit = Date.now();
          const [, conf, ...text] = line.split(':');
          this.log(`Weckwort erkannt (${conf})`);
          this.onHit?.({ confidence: Number(conf), text: text.join(':') });
        } else if (line.startsWith('ERROR:')) {
          const msg = line.slice(6); this.log(`Weckwort-Fehler: ${msg}`);
          if (PERMANENT.test(msg)) { fatal = true; this.status({ state: 'error', detail: msg }); } else retryable = msg; // z. B. Mikrofon weg: später erneut versuchen
        }
      }
    });
    proc.stderr?.on('data', (d) => this.log(`Weckwort: ${String(d).trim().slice(0, 200)}`));
    proc.on('error', (err) => { fatal = true; this.status({ state: 'error', detail: `PowerShell nicht startbar: ${err.message}` }); });
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null; this.clearWatch();
      if (!this.wanted) return;
      if (fatal) return;
      if (retryable) {
        // Fehler, die vergehen können (Mikrofon abgesteckt, Gerät gesperrt): mit wachsenden Pausen erneut versuchen
        if (this.retries >= MAX_RETRIES) { this.status({ state: 'error', detail: `${retryable} (Aufgegeben nach ${MAX_RETRIES} Versuchen. Mikrofon prüfen und das Weckwort aus- und wieder einschalten.)` }); return; }
        const wait = Math.min(60, 5 * 2 ** Math.min(this.retries, 4)); this.retries++;
        this.status({ state: 'retry', detail: `${retryable}\nNeuer Versuch in ${wait} Sekunden (${this.retries}/${MAX_RETRIES}).` });
        this.retryTimer = setTimeout(() => { if (this.wanted && !this.proc) this.start(); }, wait * 1000); this.retryTimer.unref?.();
        return;
      }
      if (this.restarts >= MAX_RESTARTS) { this.status({ state: 'error', detail: 'Weckwort-Erkennung ist mehrfach abgestürzt. Weckwort aus- und wieder einschalten.' }); return; }
      this.restarts++;
      const t = setTimeout(() => { if (this.wanted && !this.proc) this.start(); }, Math.min(30000, 1500 * this.restarts)); t.unref?.();
    });
  }

  stop() {
    this.wanted = false; clearTimeout(this.retryTimer); this.clearWatch();
    const p = this.proc; this.proc = null;
    try { p?.kill(); } catch { /* egal */ }
    this.status({ state: 'off' });
  }
}

module.exports = { WakeWord, THRESHOLD, SCRIPT };
