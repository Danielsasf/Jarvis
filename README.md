# Jarvis

Persönlicher KI-Assistent für Windows, der mehrere KIs verbindet (Claude, ChatGPT, Gemini, Groq, Mistral, OpenRouter, Ollama, LM Studio).

- Live-Antworten, Sprache rein und raus
- Automatisches Ausweichen auf die nächste KI
- Pakete (`src/packs/*.paket.md`) für neue Fähigkeiten
- Gedächtnis, Tafeln und Widgets
- Selbst-Update über die Releases dieses Repos (`jarvis-app.json`)

Starten (Entwicklung): `npm install` und `npm start`. Tests: `npm test`.
Release bauen: Version in `src/version.js` erhöhen, `node tools/make-release.js`, `dist/jarvis-app.json` an ein Release mit Tag `v<version>` hängen.
