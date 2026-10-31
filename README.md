# ADFC Codierauftrag

Web-Formular für die ADFC-Fahrradcodierung: Besucher*innen geben Eigentümer- und
Fahrraddaten ein, die Anwendung löst Ort und Straße gegen das ADFC-Straßen-Code-
Verzeichnis auf, setzt die persönliche Codier-Nummer (EIN) zusammen und erzeugt den Codierauftrag als PDF — **vollständig im Browser der Besucher*in**.

Das gesamte System ist um ein
Leitprinzip gebaut: **Privacy by Design — personenbezogene Daten verlassen den
Browser nie.** Der Server sieht genau zwei Zeichenketten: den getippten Ort und die
getippte Straße.

Die Oberfläche ist rein deutsch (dies ist ein deutschsprachiges Produkt); die
Codebasis ist englischsprachig.

**Herkunft:** Diese Anwendung wurde von einer KI auf Grundlage einer SPEC erstellt.
Die Ideen und das Produktkonzept — Formular, EIN, PDF-Auftrag, die Semantik der
Ort-/Straßen-Auflösung — stammen aus einem bestehenden PHP-Projekt; alle Funktionen
wurden jedoch komplett neu implementiert, ohne übernommenen Code.

---

## Inhaltsverzeichnis

- [Was die Anwendung tut](#was-die-anwendung-tut)
- [Architektur](#architektur)
- [Datenschutz von Anfang an](#datenschutz-von-anfang-an)
- [Sicherheitspraktiken](#sicherheitspraktiken)
- [Modernes Client-Design](#modernes-client-design)
- [Der PDF-Auftrag](#der-pdf-auftrag)
- [Server-API](#server-api)
- [Konfiguration](#konfiguration)
- [Designprinzipien](#designprinzipien)
- [Tests](#tests)
- [Deployment](#deployment)
- [Lokale Entwicklung](#lokale-entwicklung)
- [Repository-Struktur](#repository-struktur)
- [Nicht-Ziele](#nicht-ziele)

---

## Was die Anwendung tut

Vor dem Codierungstermin beim örtlichen ADFC-Kreisverband füllt die Kundin/der
Kunde dieses Formular aus:

1. **Eigentümer*in und Adresse** — Vor- und Nachname, Mitgliedschaft, Ort, Straße,
   Hausnummer.
2. **Fahrrad oder Anhänger** — Marke, Modell, Farbe, Typ, Rahmennummer (und deren
   Position), Gänge, E-Bike/Akku, Carbon-Rahmen.
3. **Kaufblock** — Verkäufer, Ort, Datum, Kaufbeleg vorhanden.

Während der Eingabe löst das Formular **Ort** und **Straße** im Hintergrund gegen
das ADFC-Straßen-Code-Verzeichnis (den ADFC-„Code-Server“) auf und setzt die **EIN**
(Codier-Nummer) zusammen — die Nummer, die beim Codierungstermin am Rad angebracht
wird:

```
DU00 01356 006 FÖ 26
│││  │     │   ││  └─ Jahr der Codierung (2-stellig, falls INKLUSIVE_JAHR)
│││  │     │   │└─ Initialen der Eigentümer*in (Umlaute roh; im Barcode transliteriert)
│││  │     │└─ Hausnummer mod 1000, mit Nullen aufgefüllt ('?' falls nicht auswertbar)
│││  └─ Straßen-Code aus der ADFC-Straßendatenbank
││└─ Unterkennzahl der Stadt im Kreis ('-' für Berlin/Hamburg)
│└─ Kfz-Kennzeichen des (Land-)Kreises (DU = Duisburg)
```

Die EIN ist bewusst so aufgebaut, dass sie jede Person am Rad ablesen kann — es
gibt **keine zentrale Registrierung**, die Codes Eigentümer*innen zuordnet. Weder
diese Anwendung noch die ADFC-Code-Server speichern EINs.

Ein Klick auf **„PDF erzeugen“** erzeugt den Auftrag: ein A4-Dokument in zwei
Ausfertigungen („Ausfertigung ADFC“ / „Ausfertigung Kundin/Kunde“, konfigurierbar
als einzelnes Blatt) mit dem vollständigen Datensatz, der EIN mit 1-D-Barcode
(Code128/Code39/Code39ext), einem QR-Code, der das Formular mit allen Werten erneut
lädt, der Eigentumserklärung, der gedruckten Einwilligung zur Aufbewahrung, dem
Gebührenblock (inkl. optionaler Umsatzsteuer), den Zahlungs- und Ausweis-Kästchen
sowie den Unterschriftenlinien. Das PDF wird im Browser erzeugt und heruntergeladen
— es wird nirgendwo hochgeladen.

## Architektur

```
┌──────────────── Browser des Besuchers ────────────────┐
│ Vanilla-TS-Formular (Vite-Build, kein Framework)      │
│ • Validierung, EIN, Preis, QR-Encode/Decode           │
│ • jsPDF + bwip-js im LAZY-Chunk → PDF-Download        │
│ • 22 Formularwerte verlassen den Browser nie          │
└──────┬────────────────────────────────────────────────┘
       │ fetch — nur drei Aufrufarten:
       │   GET /api/config      Vereinskonfiguration, keine Personendaten
       │   GET /api/streetcode  der getippte Ort + die Straße, sonst nichts
       │   GET statische Dateien  gehasht, immutable
┌──────▼────────────────────────────────────────────────┐
│ Fastify-Server (ein Node-Prozess)                     │
│ • TypeBox-validierte API, Security-Header,            │
│ • Rate-Limit, Single-Flight, Circuit Breaker          │
│ • SQLite-Cache (node:sqlite — keine nativen Deps)     │
│ • cheerio parst die ISO-8859-1-Seiten des Upstreams   │
│ • stellt den Client + HTML-Fehlerseite aus            │
└──────┬────────────────────────────────────────────────┘
       │ nur bei Cache-Miss — ISO-8859-1-Protokoll:
       │   POST name=<Ort>&str=<Straße>
       │   GET  ?ags=<AGS>;str=<Straße>
┌──────▼────────────────────────────────────────────────┐
│ ADFC-Code-Server (fa-technik-adfc.de, …)              │
│ Straßen-Code-Verzeichnis — der einzige Dritte         │
└───────────────────────────────────────────────────────┘
```

**Stack:** Durchgehend TypeScript (eine Sprache für Server und Client). Fastify +
`@sinclair/typebox` + `@fastify/static` auf dem Server; Vite + Vanilla-TS (kein
React, kein Vue) im Client; `node:sqlite` als Cache (in Node integriert — keine
nativen npm-Module); cheerio für die Upstream-HTML; jsPDF + `@bwip-js/browser`
für das PDF, lazy geladen per dynamischem `import()` beim ersten Klick auf
„PDF erzeugen“. Die exakten Versionen stehen in `package.json` und werden über
die Lockfile/Dependabot gepflegt.

### Auflösungspfad (GET /api/streetcode)

Die gemessene Upstream-Latenz beträgt **4–14 Sekunden pro Anfrage** — der gesamte
Server ist darauf gebaut, Upstream-Aufrufe selten zu machen:

| Situation | Verhalten |
|---|---|
| Frischer Cache-Treffer (im Frische-Fenster, `CACHE_MAX_AGE_DAYS`) | Antwort direkt aus SQLite in &lt; 20 ms (Budget), null Upstream-Aufrufe |
| Gleiche Suche erneut, andere Schreibweise | eine Cache-Zeile — Schlüssel werden getrimmt, Whitespace zusammengezogen, casefoldet und `ß`→`ss` gefaltet (`fold()`) |
| N gleichzeitige identische Suchen | **ein** Upstream-Aufruf — Single-Flight `Map<key, Promise>` dedupliziert |
| Ort bereits aufgelöst (AGS bekannt) | GET-Follow-up nur für die Straße — eine Kalt-Suche (Ort+Straße) kostet genau **einen** Round-Trip |
| Upstream ausgefallen | veralteter Cache-Treffer wird mit `stale: true` ausgeliefert (kein Cache-Schreiben) — **unbegrenzt oft**, bei jedem Fehlschlag; nach `BREAKER_FAILURE_THRESHOLD` aufeinanderfolgenden Fehlern überspringt ein Circuit Breaker den Upstream für die in `BREAKER_COOLDOWN_MS` konfigurierte Cool-off-Phase |
| Alles schlägt fehl | 502 `upstream_unavailable` |

Die **Stale-Fallback-Garantie** ist eine bewusst eingebaute Invariante: Selbst wenn
der ADFC-Server nicht erreichbar ist, lösen sich bereits gesehene Orte/Straßen
weiter auf (die Purge-Alter liegen per Guard-Validierung strikt über dem
Frische-Fenster — Konfigurationen, die das verletzen, starten nicht).

## Datenschutz von Anfang an

Das ist der Kern des Projekts. Diese Fakten sind die Grundlage der mitgelieferten
Datenschutzerklärung
([`client/public/impressum_datenschutz.html`](client/public/impressum_datenschutz.html)):

**Was niemals einen Server erreicht** — alle 22 Formularwerte (Name, Anschrift mit
Hausnummer, Fahrraddaten inkl. Rahmennummer, Kaufdaten), die EIN und das PDF werden
ausschließlich im Browser der Besucher*in verarbeitet:

- Das Formular-Element hat **kein `action`, kein `method`** — es kann gar nichts
  übertragen werden.
- Die einzigen Netzwerkaufrufe des Clients sind `GET /api/config`,
  `GET /api/streetcode?…` und statische Dateien — allesamt an denselben Ursprung:
  Der Browser kontaktiert selbst niemanden außer diesem Server. Keine Cookies, kein
  `localStorage`/`sessionStorage`/`indexedDB`, kein Tracking. (Eine
  Drittbeteiligung gibt es dennoch — serverseitig: Bei einem Cache-Miss fragt dieser
  Server im Namen der Besucher*in den Code-Server des ADFC-Bundesverbands ab, mit
  nichts als Ort und Straße; Details im Block „Was an den Dritten geht“ unten.)
- Das PDF entsteht im Browser und landet direkt im Download-Ordner.
- Der QR-Code auf dem PDF (für das erneute Aufrufen des Formulars ohne Neuetippen)
  kodiert alle 22 Werte im **URL-Fragment** (`#v=…`) — Browser übertragen Fragmente
  nie, auch das Scannen des QR-Codes sendet keine Daten über das Netz. (Für die
  Kompatibilität mit älteren Ausdrucken versteht der Decoder zusätzlich
  Query-Parameter-URLs.)

**Was diesen Server erreicht** — genau die getippten Ort- und Straße-Zeichenketten
(je max. 100 Zeichen; bei Follow-ups zusätzlich der öffentliche AGS-Schlüssel) und
— nur im RAM — die Besucher-IP für das Minuten-Fenster des Rate-Limits.

**Was der Server speichert** — eine SQLite-Datei mit zwei Tabellen
(`city_lookup`, `street_lookup`): gefaltete Ort-/Straße-Schlüssel und die
aufgelösten Codes. Keine Namen, keine Hausnummern, keine IPs, keine EINs.
Aufbewahrung zeitlich begrenzt über die Purge-Regler der `.env`
(`CACHE_TYPO_DAYS` für Varianten-Zeilen, `CACHE_PURGE_MAX_AGE_DAYS` für kanonische
und Listen-Zeilen), erzwungen durch Purge beim Start + Intervall-Timer.

**Was der Server protokolliert** — nur JSON-Zeilen mit festen Feldern
(`{ts, lvl, msg, state, status, durMs, upstream}`); das Upstream-Feld ist ein URL-
*Index*, nie die URL mit Parametern. Nie protokolliert: Query-Parameter, die
gesuchten Zeichenketten, IPs, User-Agents, Formulardaten.

**Was an den Dritten geht** — der ADFC-Code-Server (`fa-technik-adfc.de`, betrieben
vom Fachausschuss Technik des ADFC-Bundesverbands) erhält nur die Ort- und
Straße-Zeichenketten (ISO-8859-1-kodiert, gemäß Upstream-Protokoll) und die IP des
VPS — nie Name, Hausnummer oder Fahrraddaten der Besucher*in. Die Aufruffrequenz
wird durch Cache, Single-Flight, Debounce und Circuit Breaker minimiert. Keine
Cookies, keine Session. Serverstandort Deutschland, verifiziert — keine
Drittlandübermittlung.

**Betriebliche Datenschutz-Eigenschaften** — überhaupt keine Cookies, damit auch
kein Consent-Banner. Die gedruckte Einwilligung zur Aufbewahrung (10 Jahre, § 257
HGB / § 147 AO) steht auf dem PDF selbst, zusammen mit der Eigentumserklärung — ein
Offline-Prozess des örtlichen Kreisverbands.

## Sicherheitspraktiken

- **Strenge CSP** auf jeder Antwort: `default-src 'self'; img-src 'self' data:;
  style-src 'self'; script-src 'self'` — plus `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`. Keine Inline-Scripts und
  kein Inline-Styling (alles Styling in `coding.css`; Größen-Klassen statt Inline-
  Styles — abgesichert durch Tests gegen den echten Server, da der Vite-Dev-Server
  keine CSP sendet).
- **Vollständig selbst gehostete Assets** — keine CDNs, keine externen Fonts, kein
  Tracking. Die gebaute Seite lädt genau ein Same-Origin-Modul-Script.
- **Eingabevalidierung auf jeder Ebene**: TypeBox-Schemata auf der API; ein
  Fail-Fast-Startup-Guard für `.env` (siehe unten); realistische `maxlength`-Grenzen
  auf jedem Feld; überall sichere DOM-APIs — **kein `innerHTML` mit Nutzerdaten** im
  Client.
- **Rate-Limiting** (In-Memory-Fixed-Window pro IP, `RATE_LIMIT_PER_MINUTE`; `0` =
  aus) und ein **Circuit Breaker** schützen den 4–14 s langsamen Upstream vor
  Missbrauch.
- **Kleine Angriffsfläche per Konstruktion**: keine Konten, keine Sessions, keine
  Cookies, kein serverseitiges Formular-Handling, kein Datei-Upload. Die
  PDF-Erzeugung läuft im Browser der Besucher*in — ein feindseliger Input kann
  schlimmstenfalls den eigenen Tab der angreifenden Person betreffen.
- **Supply Chain**: `npm audit` = 0 Befunde (jsPDF wurde für die Injection-/ReDoS-
  Fixes auf die aktuelle Hauptversion migriert; die genutzte API-Oberfläche
  berührt keine der angreifbaren Pfade — kein `doc.html`, keine AcroForms, nur
  selbst gerenderte Data-URLs als Bilder); Dependabot für npm, das
  Docker-Basisimage und GitHub Actions — jede Änderung läuft durch die
  komplette Suite in CI.
- **Container-Härtung**: mehrstufiger Build, Non-Root-Benutzer (feste uid/gid
  1000), `HEALTHCHECK` auf `/healthz`, Port nur auf `127.0.0.1` veröffentlicht —
  von außen ist die Anwendung ausschließlich über den vorhandenen 
  Reverse-Proxy erreichbar (TLS-Terminierung, Weiterleitung an den Container).

## Modernes Client-Design

Das Formular ist Vanilla TypeScript, gebaut mit Vite — bewusst kein UI-Framework
für ein einseitiges Formular. Es ist vollständig reaktiv:

- **Kein Submit, kein „Überprüfen“-Button.** Die Validierung läuft live beim
  Tippen; Meldungen folgen dem Touched/Eager-Muster (erscheinen nach dem ersten
  Blur oder einer Listenauswahl, danach sofort bei jedem Tastendruck neu — der
  Fehler verschwindet in dem Moment, in dem er behoben ist). Ein leeres Formular
  zeigt nichts.
- **Auflösung des Straßen-Codes im Hintergrund**: 800 ms Debounce nach der letzten
  Eingabe (sofort bei Blur/Datalist-Auswahl), mit Dirty-Tracking — ein
  unveränderter Wert löst nie eine neue Abfrage aus. Während einer 4–14 s
  laufenden Upstream-Suche zeigt das Feld einen Busy-Spinner und **keine voreilige
  Fehlermeldung** — die Person tippt unterdessen weiter.
- **„PDF erzeugen“-Gating live berechnet** bei jedem Input — die Schaltfläche wird
  erst frei, wenn die EIN vollständig, Ort+Straße aufgelöst und keine
  Validierungsfehler vorhanden sind. Ein ungültiges PDF ist unmöglich zu erzeugen.
- **QR-Neuladen mit Auto-Resolve**: Das Öffnen einer PDF-QR-URL füllt das gesamte
  Formular beim Laden vor, validiert es, füllt die EIN-Box und aktiviert die
  Schaltfläche — ganz ohne Klicks.
- **Live-Preiszeile** (``Codiergebühr: Fahrrad + Akku: 7,50 € (Mitglied)``),
  deutsche Formatierung über `Intl.NumberFormat('de-DE')`, bei jeder relevanten
  Änderung neu berechnet.
- **Datalists** (natives `<input list>`) für Ort, Straße, Typ, Radart, Schaltung
  und Position der Rahmennummer; die Auswahl eines Ort-Kandidaten übernimmt dessen
  AGS und löst die Straße neu auf; die Auswahl eines Straßen-Kandidaten fragt mit
  dem exakten kanonischen Namen erneut.
- **Modernes Feld-Styling**: eigene Toggle-Switches (44×24 px, die semantischen
  Checkboxen bleiben unangetastet), 40-Pixel-Eingabefelder mit 16-Pixel-Schrift
  (verhindert den iOS-Focus-Zoom), Fokus-Ringe, Hover-Zustände — CSP-kompatibles,
  reines CSS.
- **Selbstanpassendes Logo**: eine canvas-gemessene binäre Suche bricht lange
  Kreisverband-Namen in bis zu 3 ausbalancierte Zeilen um, statt sie
  wegzuschrumpfen.
- **Lazy-PDF-Chunk**: jsPDF + bwip-js werden erst beim ersten Klick auf
  „PDF erzeugen“ geladen — das initiale Bundle enthält null PDF-Bytes (in CI
  geprüft durch `scripts/check-bundle.mjs`).

## Der PDF-Auftrag

`client/src/pdf/pdf.ts` rendert das Auftragslayout in exakten Millimeter-Koordinaten
(A4 hochkant) — diese Implementierung ist die Referenz für das Dokument: Kopfband,
Ausfertigungs-Labels, die rote Umlaut-Warnung („Umlaute und/oder Akzente im Code!“),
wenn die angezeigte EIN vom transliterierten Barcode-Label abweicht, EIN-Wertezeile
mit 1-D-Barcode und jsPDF-gezeichnetem Label, QR-Code mit Ruhezone und Rahmen,
Datenboxen, Eigentumserklärung, Aufbewahrungs-Einwilligung, Gebührenblock (inkl.
optionaler MwSt-Zeilen), Zahlungs-/Ausweis-Kästchen, Unterschriftenlinien und ein
Version-/Footer-Band.

Barcode-Details:

- **1-D-Barcode**: `code128` / `code39` / `code39ext` via bwip-js (der
  `C39E+`-Konfigurations-Alias mappt auf `code39ext` + Prüfzeichen); der Inhalt ist
  die EIN durch die Akzent-Transliterationstabelle (`ß→ss`, `Ä→A`, `€→E`,
  Latin-Extended, vietnamesische Diakritika), wenn `UMLAUTE_IM_BARCODE=false` — die
  meisten Hardware-Scanner können mit FNC4 nichts anfangen.
- **QR-Code**: ECC-Level M mit 4-Modul-Ruhezone; ein dreistufiger
  Kapazitäts-Wächter hält die Erzeugung robust — überschreitet ein pathologischer
  Payload M, wird einmal mit ECC L erneut versucht (deckt alle realistischen Worst
  Cases bei den Feld-Maxlengths ab); schlägt auch das fehl, rendert die Seite
  **ohne** QR-Code und Hinweis, statt den Download scheitern zu lassen.

## Server-API

| Endpunkt | Zweck |
|---|---|
| `GET /api/streetcode?city&street[&ags]` | Ort/Straße → Codes. Zustände: `single`, `street_candidates`, `city_candidates`, `not_found`, `upstream_unavailable` (502), `rate_limited` (429), `invalid_request` (400). Das optionale `ags` (8-stellig) überspringt die Ortsauflösung. Kandidatenlisten werden serverseitig deterministisch sortiert — die Reihenfolge ist Teil des API-Vertrags. |
| `GET /api/config` | eingefrorene, validierte öffentliche Teilmenge der `.env` (Preise, Schalter, Kontaktdaten, Barcode-Einstellungen, `zeitzone`, `version`) — einmal beim Start gebaut; der Client sieht nie rohe Umgebungsvariablen. |
| `GET /healthz` | Liveness-Sonde (`200 ok`) — Grundlage des Docker-Healthchecks. |
| alles andere | der gebaute Client aus `client/dist` (gehashte Assets immutable, `index.html` no-cache); unbekannte Nicht-API-Pfade erhalten eine beim Start gerenderte deutsche HTML-Fehlerseite (404/500) mit Kontaktzeilen je Konfiguration. |

Alle Texte für Nutzer*innen sind deutsch und leben im Client; das JSON trägt nur
Zustände und Flags. Cache-Treffer, Stale-Antworten und Auflösungs-Flags
(`normalizedCity` / `normalizedStreet` für die ``geändert von „X“``-Meldungen) sind
Teil der Antwort-Semantik.

## Konfiguration

Eine einzige `.env`-Datei ist die komplette Konfigurationsoberfläche (Docker
`env_file`; Vorlage in [`.env.example`](.env.example) — jeder Schlüssel ist dort
kommentiert). Sie umfasst das Erscheinungsbild der
Instanz (Kreisverband, Logo-Text, URLs, Hinweis-Banner, Kontakt-Schalter), das Gebührensystem
(Mitglieder-/Nichtmitglieder-Preise, Anhänger- und Akku-Zuschläge, Umsatzsteuer),
PDF-Optionen (eine vs. zwei Ausfertigungen, Bar-/Kartenzahlung), Carbon-Rahmen
(`ZEIGE_CARBONRAHMEN` — Feld, Preisberechnung und PDF-Zeile gemeinsam), Barcode-Typ und
Jahr-in-der-EIN sowie die Infrastruktur: Port, `TZ` (IANA-Zeitzone — validiert; sie
bestimmt das EIN-Jahr und den PDF-Zeitstempel, *nie* die Browser-Zone der
Besucher*in), Upstream-URLs, Cache-Regler, Circuit-Breaker
(`BREAKER_FAILURE_THRESHOLD`, `BREAKER_COOLDOWN_MS`), Rate-Limit.

`server/src/config/parseConfig.ts` ist ein **Fail-Fast-Startup-Guard**: jeder
Schlüssel wird validiert, **alle** Fehler werden zusammen gemeldet (auf Deutsch,
nach Schlüssel sortiert) und der Prozess beendet sich mit Exit-Code 1 — ein
defekter Container ist sofort in `docker logs` sichtbar. Warnungen (z. B.
`ZEIGE_UMSATZSTEUER=true` ohne Preise) sind bewusst nicht fatal: Der Guard fährt
einen Container wegen einer Warnung nie herunter — er schafft stattdessen
Sichtbarkeit in `docker logs`. Quer-Regeln werden erzwungen (Kontaktdaten nur
erforderlich, wenn ihr Schalter an ist; alle sechs Preise nur gemeinsam;
Cache-Purge-Alter müssen strikt über dem Frische-Fenster liegen — sonst würde der
Stale-Fallback zerstört). Konfigurationsänderungen sind eine reine
`.env`-Bearbeitung + Container-Neustart — kein Rebuild.

## Deployment

Ein Container auf dem vorhandenen VPS des Kreisverbands, hinter dem vorhandenen
Reverse-Proxy (TLS-Terminierung); Updates sind immer ein neues Image:

- `Dockerfile`: mehrstufiger Build auf dem gepinnten `node:<minor>-slim`
  Basisimage, Non-Root-Benutzer,
  `HEALTHCHECK`; das SQLite-Volume (`./data:/data`) ist **zwingend** — ohne es
  würde jedes Release den Cache und mit ihm die Stale-Fallback-Garantie löschen.
  Einmalig: `mkdir -p data && chown -R 1000:1000 data`.
- `compose.yaml`: nur `127.0.0.1:8080:8080`; der Reverse-Proxy leitet per
  `reverse_proxy 127.0.0.1:8080` an den Container weiter.
- **CI** (`.github/workflows/ci.yml`): Push/PR → `npm ci` → Lint (eslint + tsc für
  Server *und* Client) → alle Tests → Build mit Bundle-Check → Docker-Image-Build.
  Ein Tag `vX.Y.Z` baut und pusht zusätzlich `linux/amd64` nach GHCR
  (`ghcr.io/adfcdu/codierauftrag`), und **der Tag ist die Version**: er wird als
  `__APP_VERSION__` eingebrannt und erscheint im PDF-Footer, in der Versionszeile
  der Seite und als `v=` in jeder generierten QR-URL.
- **Dependabot**: wöchentlich für npm, das Docker-Basisimage und Actions.
- **Kein externer Cron**: der Cache-Purge läuft beim Start + per Intervall-Timer
  innerhalb der Anwendung.

## Lokale Entwicklung

Benötigt wird genau die im `engines`-Feld (`package.json`) gepinnte Node-Version
— inklusive des Minors (Begründung siehe oben).

**Für IDE- und Agent-Shells (wichtig):** Erbt die Shell ein `LD_LIBRARY_PATH`,
das auf das gebündelte `libstdc++` einer IDE zeigt (z. B.
`~/.vscode-oss/extensions/*/bin/_internal`), startet **kein** Node mehr — jeder
Aufruf bricht still mit `version 'GLIBCXX_3.4.30' not found` ab, oft ohne
sichtbare Ausgabe. Das betrifft **jeden** Node-Aufruf: `npm ci`, `npm test`,
`npm run lint`, `npm run build` und den Serverstart. Abhilfe: die Variable für
den Aufruf entfernen.

```bash
env -u LD_LIBRARY_PATH -u LD_PRELOAD npm test
# oder kurz (leerer Wert genügt, mit System-libstdc++ funktioniert Node damit):
LD_LIBRARY_PATH= npm test
```

In einer normalen Terminal-Shell ohne dieses Erbe kann das Präfix entfallen.

```bash
# Setup und Checks (in IDE-/Agent-Shells mit dem Präfix von oben):
npm ci            # Installation (~3 s)
npm test          # komplette Test-Suite (rund 30 s)
npm run lint      # eslint + tsc --noEmit (Server + Client)
npm run build     # tsc + vite build + Bundle-Check (kein jsPDF/bwip-js in den initialen Chunks)

# den echten Server lokal starten:
mkdir -p data
[ -f .env ] || sed 's|CACHE_DB_PATH=/data/|CACHE_DB_PATH=./data/|' .env.example > .env
# → .env nur anlegen, wenn nicht vorhanden; eine bestehende .env nicht überschreiben,
#   sondern an die eigene Instanz anpassen (KREIS_VERBAND, Preise, Kontakt …).

npm run build
( setsid env -u LD_LIBRARY_PATH -u LD_PRELOAD node --env-file=.env dist/app.js \
  </dev/null > data/server.log 2>&1 & )
ss -ltnp | grep 8080 | grep -oP 'pid=\K[0-9]+' | head -1 > data/server.pid
# → http://localhost:8080  (kalte Suchen treffen den echten ADFC-Upstream: 4–14 s, dann Cache)

# Start verifizieren: `tail -1 data/server.log` muss frisch `listening` zeigen
# (nicht `listen-failed`), und `ss -ltnp | grep 8080` muss dieselbe PID nennen
# wie data/server.pid.

# den Server wieder stoppen — nur per exakter PID, nie per Muster:
kill "$(cat data/server.pid)"
```

Stolperfallen, die man kennen sollte:

- **Nach jedem Build den Server neu starten** — Vite leert `client/dist/` und der
  laufende Static-Server hält veraltete Referenzen (die Seite lädt ihre Chunks dann
  stillschweigend nicht). Per `data/server.pid` beenden, nie per Muster.
- **Jeden Restart verifizieren** — schlägt er still fehl (Port 8080 hält ein
  alter, nicht in der PID-Datei erfasster Prozess), antwortet `/healthz` weiter
  vom alten Server, und CSS-Änderungen rendern sogar durch; nur das Log sagt die
  Wahrheit: `tail -1 data/server.log` muss frisch `listening` zeigen (nicht
  `listen-failed`), und `ss -ltnp | grep 8080` muss dieselbe PID nennen wie
  `data/server.pid`. Sonst den Port-Halter per exakter PID beenden und neu starten.
- **Die Subshell-Doppelgabelung beim Start ist Absicht** — ein plaines
  `nohup node … &` blockiert aufrufende Werkzeuge (die warten auf die
  Prozessgruppe, bis in einen Timeout laufen); `setsid` detacht in eine eigene
  Session, `</dev/null` trennt stdin, und die umschließende Subshell beendet sich
  sofort statt die Detach-Session auszuhalten. Weil `setsid` forkt, wäre `$!`
  die PID des Wrappers — deshalb die Listener-PID per `ss` in
  `data/server.pid` schreiben und nicht per `$!`.
- **Gegen diesen Server testen, nicht nur gegen Vite dev** — nur der echte Server
  sendet die CSP; Inline-Style-Verstöße sind in dev unsichtbar.
- Das Formular wird zur Laufzeit per JS gebaut; der Seitenquelltext zeigt nur die
  Hülle.

## Repository-Struktur

```
codierauftrag/
├─ server/src/
│  ├─ config/parseConfig.ts     # .env-Startup-Guard (fail-fast, deutsche Fehler)
│  ├─ services/                 # Upstream (Parsen+Transport+Breaker), Cache (SQLite),
│  │                            # fold (Schlüssel-Normalisierung), rateLimit, logger
│  ├─ routes/                   # /api/streetcode, /api/config
│  ├─ errorPage.ts              # beim Start gerenderte deutsche HTML-Fehlerseite
│  └─ app.ts                    # Fastify-Bootstrap: Guard → Cache → Routen → listen
├─ server/test/                 # Unit-/Integrationstests + Fixtures (14 Upstream-Mitschnitte,
│                               # ~30 Env-Fixtures, 11 PDF-Fixtures)
├─ client/
│  ├─ src/                      # values, ein, qr, form/-Wiring, main-Bootstrap
│  ├─ src/pdf/                  # LAZY-Chunk: pdf.ts Auftragslayout + barcodes.ts
│  └─ public/                   # coding.css, Bilder, impressum_datenschutz.html
├─ Dockerfile / compose.yaml / .env.example
└─ .github/                     # ci.yml (Test → Build → Image → GHCR), dependabot.yml
```

Die mitgelieferte Datenschutzerklärung
([`client/public/impressum_datenschutz.html`](client/public/impressum_datenschutz.html))
wurde aus den im Abschnitt [Datenschutz von Anfang an](#datenschutz-von-anfang-an)
dokumentierten Fakten geschrieben.

## Nicht-Ziele

Keine Konten, keine Sessions, keine Cookies, keine serverseitige Speicherung von
Formulardaten, kein Tracking, keine externen CDNs/Fonts, kein Zweitdienst
(Redis/Postgres), kein i18n (nur Deutsch), kein Dark Mode. Alles, was
personenbezogene Daten auf einen Server bringen würde, ist bewusst außerhalb des
Projekts.
