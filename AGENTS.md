# Agent instructions for codierauftrag

Practical guidance for coding agents working in this repository. The README
(in German) is the authoritative, detailed reference — especially
[Lokale Entwicklung](README.md#lokale-entwicklung) and
[Konfiguration](README.md#konfiguration).

## Shell environment (read this first)

Agent shells often inherit a `LD_LIBRARY_PATH` pointing at an IDE-bundled
`libstdc++` (e.g. `~/.vscode-oss/extensions/*/bin/_internal`). With it set,
**every** Node invocation dies silently with
`version 'GLIBCXX_…' not found` — including `npm ci`, `npm test`,
`npm run lint`, `npm run build`, and server starts. Prefix each command:

```bash
LD_LIBRARY_PATH= npm test
# equivalent, more explicit:
env -u LD_LIBRARY_PATH -u LD_PRELOAD npm test
```

In a normal terminal without that inheritance the prefix is unnecessary.
Don't mistake these errors for a broken repo.

- Node version is pinned via `engines` in `package.json` (currently
  `>=26.12`, minor included) — see the README for why.

## Commands

```bash
npm ci            # install
npm test          # vitest, all tests under server/test/
npm run lint      # eslint + tsc --noEmit (server AND client tsconfigs)
npm run build     # tsc + vite build + scripts/check-bundle.mjs
```

All checks above must pass before you consider work done. Note:

- Tests live **only** in `server/test/` (see `vitest.config.ts`); client
  code is exercised through those integration tests, not a client test dir.
- The build verifies that the initial bundle contains no PDF bytes
  (jsPDF/bwip-js must stay in the lazy chunk loaded only on
  "PDF erzeugen" click).
- `client/dist` is not tracked in git; the Docker build produces it.

## Editing and safety

- Use the structured edit tool for file changes, not shell commands like
  `sed -i` or output redirection — the edit tool enforces read-before-edit
  and exact-match semantics, and its diff is reviewable.
- Work in git: keep the working tree committable, and commit (or at least
  `git add`) new files early so every change is diffable and recoverable.
- If you must modify an untracked file that the user has not committed yet
  (e.g. a brand-new config or note file), make a one-time copy in the
  scratchpad before touching it — git cannot restore it.

## Architecture in one minute

- Vanilla TypeScript everywhere; **no UI framework** on the client
  (Vite + vanilla TS). Fastify + TypeBox on the server. `node:sqlite`
  for the cache (no native npm deps).
- Config flows one way: `.env` → `server/src/config/parseConfig.ts`
  (fail-fast guard, German error messages, all errors aggregated) →
  `server/src/routes/config.ts` (`GET /api/config`) →
  `client/src/configTypes.ts` (`AppConfig`) → consumers such as
  `client/src/pdf/pdf.ts`. A new toggle must be added at **every** hop,
  plus `.env.example` and the tests in
  `server/test/parseConfig.test.ts` / `server/test/api.test.ts`
  (the latter asserts the full `/api/config` body with `toEqual`).
- The PDF (`client/src/pdf/pdf.ts`) is laid out in exact millimeter
  coordinates and is the reference for the printed document; it renders
  client-side only.
- Client UI text is **German**; code and comments are English.
  Server-side config errors and user-facing messages are German.

## Repository structure

```
codierauftrag/
├─ server/src/                 # Fastify server (one Node process)
│  ├─ app.ts                   # bootstrap: config guard → cache → routes → listen
│  ├─ config/parseConfig.ts    # fail-fast .env validation, German error messages
│  ├─ routes/
│  │  ├─ streetcode.ts         # GET /api/streetcode — city/street → codes
│  │  └─ config.ts             # GET /api/config — frozen public config subset
│  ├─ services/
│  │  ├─ upstream.ts           # ADFC code-server client (ISO-8859-1 protocol)
│  │  ├─ cache.ts              # SQLite cache (node:sqlite), purge timers
│  │  ├─ fold.ts               # key normalization (trim, casefold, ß→ss)
│  │  ├─ rateLimit.ts          # in-memory fixed-window per IP
│  │  └─ logger.ts             # JSON-lines logging (no personal data)
│  ├─ indexPage.ts             # Open-Graph placeholder substitution for link previews
│  ├─ errorPage.ts             # pre-rendered German HTML error pages
│  └─ types/                   # type shims (e.g. node:sqlite DatabaseSync alias)
├─ server/test/                # ALL tests live here (vitest)
│  ├─ fixtures/env/            # .env fixture files for parseConfig tests
│  ├─ fixtures/upstream/       # captured ADFC responses — tests never hit the network
│  └─ helpers/                 # fixture/env loaders
├─ client/src/                 # vanilla TS form app (Vite build, no framework)
│  ├─ main.ts                  # bootstrap: fetch config, wire the form
│  ├─ values.ts                # field reading/validation, price calc, state shape
│  ├─ ein.ts                   # EIN (coding number) assembly + transliteration
│  ├─ translit.map.ts          # umlaut→ASCII transliteration table
│  ├─ qr.ts                    # QR URLs — form data in the URL fragment (#v=…)
│  ├─ configTypes.ts           # AppConfig — the typed /api/config client view
│  ├─ form/                    # DOM wiring: combobox, page, resolve (streetcode calls)
│  └─ pdf/                     # LAZY CHUNK (loaded on "PDF erzeugen" click only)
│     ├─ pdf.ts                # the A4 form layout in exact mm coordinates
│     └─ barcodes.ts           # 1D barcode + QR rendering via bwip-js
├─ client/public/              # static assets served as-is
│  ├─ css/                     # coding.css — ALL styling lives here (CSP: no inline)
│  ├─ img/, fonts/             # self-hosted assets, no CDNs
│  └─ impressum_datenschutz.html
├─ scripts/check-bundle.mjs    # build gate: no PDF bytes in the initial chunks
├─ .github/workflows/ci.yml    # test → build → Docker image → GHCR
├─ .env.example                # documented template for every config key
└─ Dockerfile, compose.yaml    # multi-stage build, non-root, ./data volume
```

Division of labor worth knowing before you place code: streetcode
resolution, caching and rate limiting are server-side (`services/`), while
field validation, EIN assembly, price calculation and the debounced
lookups from the form are all client-side (`values.ts`, `ein.ts`,
`form/`). The client knows the config only as the frozen JSON from
`/api/config` — it never sees raw environment variables.

## Hard project invariants (don't break these)

- **Privacy by design**: personal data never leaves the browser. The only
  server calls are `GET /api/config`, `GET /api/streetcode?city&street`
  (and `&ags`), and static files. No cookies, no storage APIs, no
  telemetry. Any feature that would transmit personal data is out of scope
  by design — see README "Nicht-Ziele".
- **CSP**: `script-src 'self'`, `style-src 'self'` — no inline scripts and
  no inline styles anywhere (styling lives in `client/public/coding.css`).
  Vite dev sends no CSP, so inline-style mistakes are only caught when
  testing against the real server.
- Cache purge ages must stay strictly above the freshness window
  (`CACHE_MAX_AGE_DAYS`) — the startup guard rejects violations.

## Running the real server locally

Only the real server sends CSP headers — verify UI changes against it, not
against `vite dev`. Full procedure in the README; short version:

```bash
mkdir -p data
[ -f .env ] || sed 's|CACHE_DB_PATH=/data/|CACHE_DB_PATH=./data/|' .env.example > .env
LD_LIBRARY_PATH= npm run build
( setsid env -u LD_LIBRARY_PATH -u LD_PRELOAD node --env-file=.env dist/app.js \
  </dev/null > data/server.log 2>&1 & )
ss -ltnp | grep 8080 | grep -oP 'pid=\K[0-9]+' | head -1 > data/server.pid
# stop:
kill "$(cat data/server.pid)"
```

Gotchas that have bitten agents before:

- **Before testing, stop any running server first** — kill the PID from
  `data/server.pid`, then start a fresh server and test against it. A
  left-running old process holds port 8080 and your new start fails
  silently while you test against stale code.
- **Never kill by pattern** (`pkill node` etc.) — only by the exact PID
  from `data/server.pid`.
- **Restart after every build** — Vite empties `client/dist/`, and a
  running server keeps serving stale asset references that fail silently.
- **Verify every restart**: `tail -1 data/server.log` must show a fresh
  `listening` (not `listen-failed`), and `ss -ltnp | grep 8080` must name
  the same PID as `data/server.pid`. A stale process can keep answering
  `/healthz` and even serve old CSS while the new server failed to start.
- The subshell + `setsid` + `</dev/null` + redirect form above is
  intentional: a plain `nohup … &` blocks the calling tool until timeout.
  `$!` is the wrapper's PID, hence the `ss`-based PID capture.
- Cold street-code lookups hit the real ADFC upstream and take 4–14 s;
  afterwards they are cached. Don't "fix" slow first responses.
