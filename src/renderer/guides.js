// Anleitungen in den Einstellungen: aufklappbar, mit Schritten und Links.
// Diese Datei läuft im Fenster (window.GUIDES) und im Hauptprozess (require), darum beides.
(function () {
  const GUIDES = {
    computer: {
      title: 'So steuerst du deinen Computer mit Jarvis (Anleitung)',
      intro: 'Jarvis kann Programme öffnen, Ordner zeigen, Dateien nach Namen suchen, Webseiten öffnen und Medien steuern. Du entscheidest, was erlaubt ist. Alles ist am Anfang aus.',
      sections: [{
        heading: 'Einschalten',
        steps: [
          'Oben „Computer-Steuerung einschalten“ anklicken. Das ist der Hauptschalter.',
          'Darunter jede Fähigkeit einzeln anklicken, die du erlauben willst. Bei „Programme öffnen“ und „Ordner zeigen“ wählst du zusätzlich jedes Programm und jeden Ordner einzeln.',
          'Oder „Alles erlauben“ drücken. „Alles sperren“ schaltet sofort alles wieder aus.',
          'Eigene Programme: „+ Eigenes Programm hinzufügen“, die Datei (.exe) auswählen und danach den Schalter dahinter einschalten.',
        ],
      }, {
        heading: 'Benutzen',
        steps: [
          'Sag oder schreib z. B. „Öffne den Rechner“, „Zeig mir den Downloads-Ordner“, „Such die Datei Rechnung“ oder „Mach die Musik leiser“.',
          'Im Chat siehst du bei „Computer:“ jedes Mal, was Jarvis getan hat oder warum nicht.',
        ],
      }],
      note: 'Sicherheit: Jarvis löscht, verschiebt oder ändert nie Dateien und tippt oder klickt nicht für dich. Er führt nichts aus, wenn in der Antwort Inhalte aus dem Internet, E-Mails oder dem Kalender stecken. Über das Handy funktioniert es nicht.',
      links: [],
    },
    kis: {
      title: 'So fügst du eine KI hinzu (Anleitung)',
      intro: 'Eine KI brauchst du, damit Jarvis antworten kann. Viele Anbieter haben einen kostenlosen Einstieg. Du brauchst dafür einen Schlüssel (API-Key), das ist eine lange Zeichenfolge, die dich beim Anbieter ausweist.',
      sections: [{
        heading: 'In 5 Schritten',
        steps: [
          'Unten im Bereich „KI hinzufügen“ einen Anbieter wählen. Gut zum Starten: Gemini oder Groq.',
          'Auf „Schlüssel holen“ klicken. Die Seite des Anbieters öffnet sich im Browser.',
          'Dort anmelden (ggf. kostenlos registrieren) und einen neuen Schlüssel erstellen. Die Knöpfe heißen meist „Create new secret key“, „Create key“ oder „Neuer Schlüssel“.',
          'Den Schlüssel sofort kopieren. Viele Anbieter zeigen ihn nur einmal.',
          'Zurück in Jarvis einfügen und „Hinzufügen“ klicken. Jarvis prüft den Schlüssel und lädt die Modelle.',
        ],
      }],
      note: 'Der Schlüssel ist wie ein Passwort: Gib ihn nicht weiter. Achte bei jedem Anbieter auf das Gratis-Kontingent. Komplett kostenlos und ohne Internet geht es mit Ollama: Das Modell läuft dann auf deinem PC.',
      links: [
        { label: 'Gemini (Google), kostenloser Einstieg', url: 'https://aistudio.google.com/app/apikey' },
        { label: 'Groq, sehr schnell', url: 'https://console.groq.com/keys' },
        { label: 'OpenRouter, ein Schlüssel für viele Modelle', url: 'https://openrouter.ai/keys' },
        { label: 'Ollama, läuft lokal auf deinem PC', url: 'https://ollama.com/download' },
      ],
    },
    pakete: {
      title: 'So erstellst du ein Paket (Anleitung)',
      intro: 'Ein Paket gibt Jarvis eine neue Fähigkeit, zum Beispiel „Anschreiben schreiben“ oder „Fitnessplan“. Du rufst es mit seinem Befehl auf, z. B. /fitness.',
      sections: [
        {
          heading: 'Eigenes Paket erstellen',
          steps: [
            'Auf „+ Eigenes Paket“ klicken.',
            'Einen Namen eingeben, z. B. „Fitness“. Den Befehl (z. B. /fitness) schlägt Jarvis selbst vor. Du kannst ihn ändern.',
            'Eine kurze Beschreibung schreiben. Beispiele sind optional, eins pro Zeile.',
            'Bei „Anweisungen“ schreiben, was Jarvis tun soll und wie er antworten soll. Schreib es so, als würdest du es einem neuen Mitarbeiter erklären.',
            '„Speichern“ klicken. Mit „Benutzen“ schreibt Jarvis den Befehl ins Eingabefeld.',
          ],
        },
        {
          heading: 'Pakete schützen und weitergeben',
          steps: [
            'Bei einem eigenen Paket auf „Geschützt exportieren“ klicken und einen Speicherort wählen. Es entsteht eine verschlüsselte Datei mit der Endung .jpaket.',
            'Wer die Datei bekommt, fügt sie mit „Datei hinzufügen“ ein. Das Paket funktioniert dann ganz normal über seinen Befehl.',
            'Beim Empfänger steht „Geschützt“ am Paket. Er kann die Anweisungen nicht ansehen, nicht ändern, nicht als PDF speichern und nicht erneut exportieren.',
          ],
        },
        {
          heading: 'Pakete als Datei',
          steps: [
            '„Datei hinzufügen“: Du wählst eine fertige Paket-Datei (.paket.md) aus und Jarvis übernimmt sie.',
            '„Ordner öffnen“ zeigt, wo deine Pakete gespeichert sind.',
            '„Als PDF“ speichert eine übersichtliche Fassung des Pakets zum Lesen oder Weitergeben.',
          ],
        },
      ],
      note: 'Eingebaute Pakete kannst du nicht ändern, aber mit „Als Vorlage kopieren“ als eigene Version anlegen. Ehrlich gesagt: Der Schutz hält Neugierige ab, ist aber kein Tresor. Die Anweisungen gehen beim Benutzen an die KI, und wer den Programmcode gezielt auseinandernimmt, kommt an sie heran. Die Schnellstart-Leiste (Knöpfe über dem Eingabefeld) schaltest du hier oben ein und aus.',
      links: [],
    },
    kalender: {
      title: 'So verbindest du deinen Kalender (Anleitung)',
      intro: 'Es gibt zwei Stufen: Lesen (Jarvis sagt dir, was ansteht) ist schnell eingerichtet. Termine anlegen oder verschieben braucht zusätzlich eine einmalige Google-Anmeldung.',
      sections: [
        {
          heading: 'Stufe 1: Termine lesen (ca. 2 Minuten)',
          steps: [
            'Google Kalender im Browser am PC öffnen: calendar.google.com.',
            'Zahnrad oben rechts → „Einstellungen“. Links beim gewünschten Kalender auf „Einstellungen für meinen Kalender“ klicken.',
            'Weiter unten bei „Geheime Adresse im iCal-Format“ die Adresse kopieren.',
            'Hier unter „Geheime iCal-Adresse“ einfügen, „Kalender lesen erlauben“ einschalten und „Speichern & testen“ klicken.',
          ],
        },
        {
          heading: 'Stufe 2: Termine anlegen und verschieben (ca. 10 Minuten, optional)',
          steps: [
            'Auf console.cloud.google.com mit deinem Google-Konto anmelden und oben ein neues Projekt anlegen, z. B. „Jarvis“.',
            'Unter „APIs & Dienste“ → „Bibliothek“ die Google Calendar API suchen und „Aktivieren“ klicken.',
            'Unter „OAuth-Zustimmungsbildschirm“ (teils „Google Auth Platform“) Typ „Extern“, App-Name „Jarvis“ und deine E-Mail eintragen.',
            'Unter „Anmeldedaten“ → „Anmeldedaten erstellen“ → „OAuth-Client-ID“ wählen, Anwendungstyp „Desktop-App“. Client-ID und Client-Geheimnis kopieren.',
            'Beides hier einfügen, „Nur speichern“ klicken und dann „Mit Google verbinden“. Warnung „App nicht überprüft“ ist normal: Es ist deine eigene App. Auf „Erweitert“ → „Weiter zu Jarvis“ klicken.',
          ],
        },
      ],
      note: 'Die Bezeichnungen bei Google ändern sich manchmal. Die Schritte bleiben gleich. Jarvis legt nie selbst Termine an: Neue oder verschobene Termine landen als Vorschlag im Chat, den du bestätigst.',
      links: [
        { label: 'Google Kalender öffnen', url: 'https://calendar.google.com' },
        { label: 'Google Cloud Console', url: 'https://console.cloud.google.com' },
      ],
    },
    mail: {
      title: 'So verbindest du dein E-Mail-Postfach (Anleitung)',
      intro: 'Jarvis liest deine Mails nur, er sendet, löscht oder verschiebt nichts. Du brauchst die Zugangsdaten deines Postfachs.',
      sections: [{
        heading: 'In 4 Schritten',
        steps: [
          'Anbieter wählen (web.de, GMX, Gmail, Outlook, iCloud). Server und Port füllt Jarvis dann selbst aus.',
          'Deine E-Mail-Adresse eintragen.',
          'Passwort eintragen. Bei den meisten Anbietern brauchst du ein eigenes App-Passwort (siehe unten).',
          '„Speichern & testen“ klicken. Jarvis zeigt, ob die Anmeldung geklappt hat.',
        ],
      }, {
        heading: 'App-Passwort holen',
        steps: [
          'web.de und GMX: Im Postfach unter den Einstellungen „POP3 & IMAP“ den IMAP-Zugriff erlauben. Bei aktiver Zwei-Faktor-Anmeldung ein „Anwendungspasswort“ anlegen.',
          'Gmail: Auf myaccount.google.com/apppasswords ein App-Passwort erzeugen. Dafür muss die Zwei-Faktor-Anmeldung eingeschaltet sein.',
          'Outlook / Hotmail: Unter account.microsoft.com/security ein App-Passwort erstellen.',
          'iCloud: Auf account.apple.com unter „Anmeldung & Sicherheit“ ein app-spezifisches Passwort erzeugen.',
        ],
      }],
      note: 'Schlägt die Anmeldung fehl, zeigt Jarvis die Meldung des Mail-Servers. Meist fehlt dann nur das App-Passwort.',
      links: [
        { label: 'web.de', url: 'https://web.de' },
        { label: 'GMX', url: 'https://www.gmx.net' },
        { label: 'Gmail App-Passwörter', url: 'https://myaccount.google.com/apppasswords' },
        { label: 'Microsoft Sicherheit', url: 'https://account.microsoft.com/security' },
        { label: 'Apple Konto', url: 'https://account.apple.com' },
      ],
    },
    handy: {
      title: 'So chattest du mit dem Handy (Anleitung)',
      intro: 'Über dein privates Tailscale-Netz erreichst du Jarvis von unterwegs. Niemand sonst kommt dran, auch nicht über das offene Internet.',
      sections: [{
        heading: 'In 5 Schritten',
        steps: [
          'Tailscale (kostenlos) auf dem PC und auf dem Handy installieren: tailscale.com/download. Auf beiden mit demselben Konto anmelden.',
          'Hier den Handy-Zugang einschalten. Darunter erscheint die Adresse für dein Handy.',
          'Die Adresse im Handy-Browser öffnen. Hier auf dem PC „Kopplungscode erzeugen“ klicken und den Code am Handy eintippen.',
          'Optional: Im Handy-Browser „Zum Startbildschirm hinzufügen“. Dann startet Jarvis wie eine App.',
          'Das Mikrofon am Handy braucht eine https-Adresse. Die Anleitung dafür steht im Abschnitt „Einrichten“ unten auf dieser Seite, Punkt „Sprechen am Handy“.',
        ],
      }],
      note: 'Jarvis muss auf dem PC laufen, damit das Handy antworten kann. Gekoppelte Handys kannst du unten jederzeit entfernen.',
      links: [
        { label: 'Tailscale herunterladen', url: 'https://tailscale.com/download' },
      ],
    },
    stimme: {
      title: 'So richtest du „Hey Jarvis“ und die Stimme ein (Anleitung)',
      intro: 'Das Weckwort nutzt die eingebaute Windows-Spracherkennung. Es läuft nur auf deinem PC. Erst nach dem Weckwort geht deine Frage an die KI.',
      sections: [
        {
          heading: 'Weckwort einschalten',
          steps: [
            'Den Schalter bei „Hey Jarvis“ einschalten. Beim ersten Mal fragt Windows nach dem Mikrofon: Zugriff erlauben.',
            'Warten, bis hier „Bereit“ steht. Dann „Hey Jarvis“ sagen, auf den Piep warten und deine Frage sprechen.',
            'Reagiert Jarvis zu oft von selbst, die Empfindlichkeit niedriger stellen. Hört er dich nicht, höher.',
          ],
        },
        {
          heading: 'Wenn es nicht klappt',
          steps: [
            'Steht dort „Keine Windows-Spracherkennung“: Windows-Einstellungen → Zeit und Sprache → Sprache → Deutsch → Optionen → Spracherkennung hinzufügen.',
            'Steht dort „Neuer Versuch“: Das Mikrofon ist gerade nicht erreichbar (z. B. Headset abgesteckt). Jarvis probiert es automatisch weiter. Nach dem Aufwachen des PCs startet er das Weckwort selbst neu.',
            'Windows-Einstellungen → Datenschutz → Mikrofon prüfen: „Desktop-Apps den Zugriff erlauben“ muss an sein.',
          ],
        },
        {
          heading: 'Stimme und Vorlesen',
          steps: [
            '„Antworten vorlesen“ einschalten, dann spricht Jarvis schon während er schreibt.',
            'Unter „Stimme“ eine Windows-Stimme wählen und mit „Probe hören“ ausprobieren. Weitere deutsche Stimmen: Windows → Zeit und Sprache → Sprache.',
          ],
        },
      ],
      note: 'Das Weckwort gibt es nur unter Windows.',
      links: [],
    },
    gedaechtnis: {
      title: 'So nutzt du das Gedächtnis (Anleitung)',
      intro: 'Was Jarvis hier gespeichert hat, weiß er in allen Chats. Es bleibt auf deinem PC.',
      sections: [{
        heading: 'Etwas merken oder vergessen',
        steps: [
          'Im Chat sagen oder schreiben: „Merk dir, dass …“. Jarvis speichert den Satz und zeigt ihn hier in der Liste.',
          'Oder oben im Feld etwas eintippen und „Merken“ klicken.',
          '„Vergiss …“ im Chat entfernt eine Erinnerung. In der Liste kannst du jede einzelne löschen. „Alles vergessen“ leert das ganze Gedächtnis.',
        ],
      }],
      note: 'Die Erinnerungen gehen als Hintergrundwissen an die KI, die gerade antwortet. Schreib deshalb keine Passwörter hinein.',
      links: [],
    },
    persoenlichkeit: {
      title: 'So änderst du Jarvis’ Verhalten (Anleitung)',
      intro: 'Dieser Text sagt Jarvis, wie er sich verhalten soll: Ton, Länge der Antworten, Sprache.',
      sections: [{
        heading: 'In 3 Schritten',
        steps: [
          'Den Text unten anpassen, z. B. „Antworte immer kurz und auf Deutsch“ oder „Sprich mich mit Du an“.',
          '„Speichern“ klicken. Gilt ab der nächsten Nachricht, auch in schon offenen Chats.',
          'Gefällt dir das Ergebnis nicht: „Zurücksetzen“ stellt den ursprünglichen Text wieder her.',
        ],
      }],
      note: 'Kurze, klare Sätze funktionieren am besten. Für eine feste Aufgabe (z. B. Bewerbungen) ist ein Paket besser geeignet.',
      links: [],
    },
    system: {
      title: 'Updates, Wetter, Schlagzeilen und Ansichten (Anleitung)',
      intro: 'Hier steht alles, was Jarvis selbst betrifft.',
      sections: [
        {
          heading: 'Updates installieren',
          steps: [
            'Jarvis prüft beim Start und danach alle 15 Minuten selbst. „Jetzt prüfen“ erzwingt eine Prüfung sofort.',
            'Gibt es ein Update, erscheint oben ein Hinweis mit „Installieren“. Klicken, Jarvis startet neu. Schlüssel und Einstellungen bleiben erhalten.',
            'Oben links neben „JARVIS“ steht deine Versionsnummer.',
          ],
        },
        {
          heading: 'Wetter einstellen',
          steps: [
            'Unter „Wetter“ den Ort eintippen, z. B. „Hamburg“, und „Speichern“ klicken.',
            'Das Wetter-Widget erscheint links auf dem Hauptbildschirm. Nur der Ortsname geht an den kostenlosen Dienst open-meteo.com.',
          ],
        },
        {
          heading: 'Schlagzeilen ein- und ausschalten',
          steps: [
            'Der Schalter „Schlagzeilen anzeigen“ blendet rechts auf dem Hauptbildschirm die aktuellen Meldungen von tagesschau.de ein.',
            'Ein Klick auf eine Schlagzeile öffnet sie im Browser. Ausgeschaltet ruft Jarvis nichts ab.',
          ],
        },
        {
          heading: 'Ansichten bedienen',
          steps: [
            'Oben rechts das Netz-Symbol: Netz-Ansicht mit allen Paketen, KIs und Erinnerungen als Sternenkarte. Klick auf einen Punkt zeigt links seine Details. Bei Paketen kannst du dort benutzen, bearbeiten und ein- oder ausschalten.',
            'Die anderen Symbole blenden Chat-Verlauf, Eingabefeld und Seitenleiste ein und aus.',
          ],
        },
      ],
      note: 'Die Kurven links unten zeigen die letzten Antwortzeiten der KI sowie CPU und Arbeitsspeicher.',
      links: [
        { label: 'Was ist neu? Alle Versionen auf GitHub', url: 'https://github.com/Danielsasf/jarvis/releases' },
      ],
    },
    melden: {
      title: 'So bekommst du Meldungen aufs Handy (Anleitung)',
      intro: 'Jarvis schickt Meldungen über den kostenlosen Dienst ntfy. Du brauchst nur die ntfy-App auf dem Handy.',
      sections: [{
        heading: 'In 4 Schritten',
        steps: [
          'Die kostenlose App „ntfy“ aus dem Google Play Store oder dem App Store installieren.',
          'In der App auf „+“ tippen. Den Server ntfy.sh lassen und das Thema eintragen, das hier unter „Handy einrichten“ angezeigt wird. Am besten kopieren.',
          'Hier „Benachrichtigungen“ einschalten und „Speichern“ klicken.',
          '„Test senden“ klicken. Kommt die Meldung am Handy an, ist alles bereit.',
        ],
      }],
      note: 'Das Thema ist wie ein Passwort. Wer es kennt, kann dir Meldungen schicken oder mitlesen. Mit „Neues Thema“ tauschst du es aus; dann musst du es in der App neu eintragen.',
      links: [
        { label: 'ntfy.sh (Infos zum Dienst)', url: 'https://ntfy.sh' },
      ],
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = GUIDES;
  else window.GUIDES = GUIDES;
})();
