// Vorlesen während die Antwort noch entsteht: Satz für Satz, ohne Emojis, ohne Code.
(() => {
  const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
  const EMOTICON = /(^|\s)(?:[:;=8xX]-?[()DPpOo3\]\[/\\|*]|<3|\^\^|xD|XD)(?=\s|$|[.,!?])/g;

  function clean(text) {
    return text
      .replace(/<(merken|vergessen)>[\s\S]*?<\/\1>/gi, '')
      .replace(/^\s*\|.*$/gm, '')
      .replace(EMOJI, '')
      .replace(EMOTICON, '$1')
      .replace(/https?:\/\/\S+/g, 'Link')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/^\s*#+\s*/gm, '')
      .replace(/[*_~>|#]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    return voices.find((v) => /^de/i.test(v.lang) && /natural|online|neural/i.test(v.name))
      || voices.find((v) => /de-DE/i.test(v.lang)) || voices.find((v) => /^de/i.test(v.lang)) || null;
  }

  class Speaker {
    constructor({ onStart, onEnd, onWord } = {}) {
      Object.assign(this, { onStart, onEnd, onWord });
      this.reset();
    }
    reset() { this.buf = ''; this.inCode = false; this.pending = ''; this.queued = 0; this.spokeAny = false; this.active = false; }
    stop() { this.reset(); speechSynthesis.cancel(); }
    get speaking() { return speechSynthesis.speaking || this.queued > 0; }

    // Live-Text hineinfüttern
    feed(delta) { this.buf += delta; this.drain(false); }
    // Antwort fertig: Rest vorlesen
    finish() { this.drain(true); this.flush(true); }
    // ganzen Text auf einmal vorlesen
    sayAll(text) { this.stop(); this.feed(text); this.finish(); }

    drain(final) {
      for (;;) {
        if (this.inCode) {
          const e = this.buf.indexOf('```');
          if (e === -1) { if (final) this.buf = ''; return; }
          this.buf = this.buf.slice(e + 3); this.inCode = false; continue;
        }
        this.buf = this.buf.replace(/<(merken|vergessen)>[\s\S]*?<\/\1>/gi, '');
        // offene Gedächtnis-Markierung: warten bis sie zu ist (wird nicht vorgelesen)
        const open = this.buf.search(/<(merken|vergessen)>(?![\s\S]*<\/(merken|vergessen)>)/i);
        const f = this.buf.indexOf('```');
        let seg = f === -1 ? this.buf : this.buf.slice(0, f);
        if (open !== -1 && (f === -1 || open < f)) { seg = this.buf.slice(0, open); if (final) this.buf = seg; }
        // Satzende: . ! ? … : mit folgendem Leerzeichen, oder Zeilenumbruch
        const m = seg.match(/^[\s\S]*?(?:[.!?…](?=\s)|:(?=\s*\n)|\n)/);
        if (m && m[0].trim()) { this.pending += m[0]; this.buf = this.buf.slice(m[0].length); this.flush(false); continue; }
        if (m) { this.buf = this.buf.slice(m[0].length); continue; }
        if (f !== -1 && (open === -1 || open > f)) {
          this.pending += seg; this.flush(true);
          this.buf = this.buf.slice(f + 3); this.inCode = true; continue;
        }
        if (final) { this.pending += seg; this.buf = ''; }
        return;
      }
    }

    // erster Satz sofort, danach in etwas größeren Stücken (klingt flüssiger)
    flush(force) {
      const text = clean(this.pending);
      if (!text) { this.pending = ''; return; }
      if (!force && this.spokeAny && text.length < 60) return;
      this.pending = '';
      this.spokeAny = true;
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.lang = 'de-DE';
      u.rate = 1.1;
      this.queued++;
      u.onstart = () => { if (!this.active) { this.active = true; this.onStart?.(); } };
      u.onboundary = () => this.onWord?.();
      u.onend = u.onerror = () => {
        this.queued = Math.max(0, this.queued - 1);
        if (this.queued === 0 && !speechSynthesis.pending) { this.active = false; this.onEnd?.(); }
      };
      speechSynthesis.speak(u);
    }
  }

  window.JarvisSpeech = { Speaker, clean };
})();
