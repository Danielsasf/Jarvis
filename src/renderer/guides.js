// Anleitungen in den Einstellungen: aufklappbar, mit Schritten und Links.
// Diese Datei läuft im Fenster (window.GUIDES) und im Hauptprozess (require), darum beides.
(function () {
  const GUIDES = {
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
          heading: 'Pakete als Datei',
          steps: [
            '„Datei hinzufügen“: Du wählst eine fertige Paket-Datei (.paket.md) aus und Jarvis übernimmt sie.',
            '„Ordner öffnen“ zeigt, wo deine Pakete gespeichert sind.',
            '„Als PDF“ speichert eine übersichtliche Fassung des Pakets zum Lesen oder Weitergeben.',
          ],
        },
      ],
      note: 'Eingebaute Pakete kannst du nicht ändern, aber mit „Als Vorlage kopieren“ als eigene Version anlegen.',
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
