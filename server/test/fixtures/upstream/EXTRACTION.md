# Upstream contract & street-code extraction design

Verified against the live ADFC code server. Basis: the 14 captured fixtures (see `README.md`). This is the spec for `server/src/services/upstream.ts`.

## 1. Transport

| Aspect | Contract |
|---|---|
| Primary endpoint | `POST https://fa-technik-adfc.de/fein` |
| Content type | `multipart/form-data` (as the upstream form declares) |
| Fields | `name` (city), `str` (street), `hsnr` (fixed `1`), `n1` (fixed `x`), `n2` (fixed `x`), `suchen` (fixed `suchen`) |
| Follow-up (selection) requests | `GET /fein?ags=<ags>;str=<street>;hsnr=1;n1=x;n2=x` — semicolon-separated params, values percent-encoded from **ISO-8859-1 bytes** |
| Secondary endpoint | `https://codierung.adfc-hessen.de/code/ein` — today only a 301 to the primary; keep as configurable fallback |
| No cookies, no CSRF tokens, no session state | every request is stateless |

## 2. Encoding (mandatory, verified by fixture)

- Request values: UTF-8 → **ISO-8859-1** before sending (Node: `Buffer.from(s, 'latin1')`; percent-encoding of GET params over those bytes). Sending UTF-8 bytes produces mojibake and garbage matches (`resp-fa-fein-duisburg-utf8test.html`).
- Response: decode body bytes as **ISO-8859-1 → UTF-8** (Node: `buf.toString('latin1')`). Response `content-type` confirms `charset=iso-8859-1`.

## 3. Response states

The response is itself an HTML form. Exactly one of four states:

**A — single street found** (`…/…altstadt.html`)
Form contains hidden inputs `ort`, `kz`, `ags`. Within the search table (the **first** `table[border="0"]` inside the form — later `border="0"` tables embed the EIN preview), one row whose first cell text is `Straße`; its 4th cell holds non-empty texts `[strCode, strName]` (e.g. `01944`, `Königstraße / Altstadt / Dellviertel`).
Parse → `{ state: 'single', city: { name: ort, plateCode, subCode, ags }, street: { name, code } }`
- `kz` value splits on space → `plateCode` + `subCode` (`"DU 00"` → `DU`, `00`).
- Rule: for `plateCode` `B` or `HH`, `subCode` becomes `'-'`.

**B — ambiguous street** (`…/…koenigstrasse.html`)
Hidden inputs present (city resolved). Candidate rows: first cell text equals the `kz` value, second cell contains an `<a>` whose `href` contains `ags=<digits>;str=<name>;`; the candidate's **district-qualified full street name is the second cell's text content**.
Parse → `{ state: 'street_candidates', city: {...}, candidates: [{ name, ags }] }`
Candidate `name` **from the second cell's text** (avoids URL-decoding the raw ISO-8859-1 bytes in the href); `ags` via `/ags=(\d+)/` on the href (digits only — safe). ⚠ In the live HTML the anchor is written self-closed — `<a href="…"/>Name</td>` — so in the raw bytes the name is a text node *after* the anchor, not inside it. An HTML5 parser (parse5/cheerio) folds that text into the (then-unclosed) anchor, so `a.text()` happens to work — but the cell's text is the parser-independent extraction; never rely on the anchor's text, and never regex names out of hrefs.
Also covers the "too many matches / try a prefix" variant (`…/…str-notfound.html`), which adds hint text but the same candidate rows.

**C — ambiguous city** (`…/…friedberg-ortselection.html`)
**No** hidden `ort`/`kz`. Candidate rows: first cell contains an `<a>` with kz link text (`FB 08`, `AIC 130`), second cell text is the city display name incl. PLZ (`Friedberg (Hessen) (PLZ: 61169)`).
Parse → `{ state: 'city_candidates', candidates: [{ name, plateCode, subCode, ags }] }`

**D — no match** (`…/…ort-notfound.html`)
No hidden inputs **and** no candidate rows; body contains the h2 `Es wurde keine passende Straße gefunden…`.
Parse → `{ state: 'not_found' }`

Detection order: hidden inputs present → A or B; else candidate rows → C; else D (D is its own state, distinct from an empty candidate list).

## 4. Extraction robustness rules

1. **Scope** all row scanning to the first `table[border="0"]` inside the form — the single-hit response also embeds a large EIN preview table (`KZ/AGS/STR/HS/INI/Jahr`) whose rows must not leak into candidate parsing. (Its first cells are `KZ`/`DU`, which never match the `kz` string `DU 00`, but scoping removes the risk class entirely.)
2. **Single-hit code check:** td4 first text must match `^\d{3,5}$`; second text is the name. On mismatch → treat as B/D instead of throwing.
3. **Whitespace:** trim all texts; collapse/strip the `\r` (yes, carriage return, not `\n`) that the upstream emits before the closing paren of PLZ parentheticals (`Friedberg (Hessen) (PLZ: 61169\r)`).
4. **Don't regex street names out of hrefs** — use the cell text (see state B). The hrefs mix raw non-ASCII latin1 bytes, spaces, and percent-encoded forms inconsistently.
5. **City display names** (state C) are kept verbatim incl. `(PLZ: …)` — they disambiguate for the user; `ags` is the machine key.
6. Upstream performs its own umlaut/prefix normalization (`Koenigstrasse` → `Königstraße` matches). The **informational normalized flag** is computed client-side by comparing the user's input (casefolded, umlaut-folded) with the canonical name returned.

## 5. Follow-up flows (drives the API design)

- A **plain POST** `name` + `str` (no `ags` anywhere in the request) returns the single state **with the hidden `ags` present** — verified live 2026-10-25 (`resp-fa-fein-duisburg-koenigstrasse-altstadt-post.html`: `ags=05112000`). The AGS therefore exists in every resolved-city response, not only when the request carried it.
- User picks a **street candidate** → server re-queries `GET /fein?ags=<city ags>;str=<candidate name>;hsnr=1;n1=x;n2=x` → state A. `ort` is **not** required — verified live 2026-10-25 (`resp-fa-fein-get-followup-probe.html`).
- User picks a **city candidate** → server re-queries `GET /fein?ags=<candidate ags>;str=<user street>;hsnr=1;n1=x;n2=x` → state A or B.
- Both are deterministic via `ags`; re-querying by name would be ambiguous.
- API: `GET /api/streetcode?city=&street=` plus optional `ags=<8-digit AGS>` for follow-ups. Response carries the full state object above (plus `stale` flag).

## 6. Performance & reliability (measured 2026-10-24)

- **Latency: 4–14 s per request** (even the bare form GET took 7–9 s). Consequences:
  - Request timeout **30 s** (not the 10 s in plan v0.5); keep-alive/reuse the connection.
  - **Single-flight**: coalesce concurrent identical (city, street) lookups on one upstream request (in-memory promise map).
  - Client must **debounce heavily** or resolve on blur/submit — no per-keystroke lookups.
  - Aggressive caching is not optional; it is the difference between a usable form and a 10-second form.
- **Street codes change** (Friedberg Hauptstraße is `00426` today, `00212` in the ADFC documentation) → per-key revalidation is genuinely required.
- Response size cap ~1 MB; circuit breaker after repeated failures → fail fast with `502` while the stale cache still answers from disk.

## 7. Test mapping (fixture → expected parse)

| Fixture | Expected |
|---|---|
| `resp-fa-fein-duisburg-koenigstrasse-altstadt.html` | single: DU/00, 05112000, street `01944` |
| `resp-fa-fein-duisburg-koenigstrasse-altstadt-post.html` | single (plain POST, no `ags` in request): DU/00, **hidden ags 05112000**, street `01944` |
| `resp-fa-fein-get-followup-probe.html` | single (GET without `ort`): DU/00, ags 05112000, street `01944` — `ort` not required in follow-ups |
| `resp-fa-fein-friedberg-hauptstrasse-ags.html` | single: FB/08, 06440008, street `00426` |
| `resp-fa-fein-duisburg-koenigstrasse.html` | street_candidates: 4 entries, all ags 05112000; candidate name = second cell text |
| `resp-fa-fein-duisburg-str-notfound.html` | street_candidates (with hint text), ≥ 5 entries |
| `resp-fa-fein-friedberg-ortselection.html` | city_candidates: `FB 08`/06440008, `AIC 130`/09771130 |
| `resp-fa-fein-ort-notfound.html` | not_found |
| `resp-fa-fein-duisburg-utf8test.html` | must never occur (request encoder test: asserts ISO-8859-1) |
| `fa-fein-form.html` | form contract: action, enctype, field names |
| `fa-form.html` | same form contract on the public page (`action=/ein`) |
| `hessen-form.html`, `resp-hessen-codeein-redirect.html` | 301 redirect pages — the secondary endpoint is not an independent instance |
