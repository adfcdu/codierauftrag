# codierauftrag — upstream fixtures

**Captured** live against the ADFC code servers (2026-10-24/25; includes two AGS-gate probes: plain-POST single state, GET follow-up without `ort`). The set is the frozen ground truth; **do not re-capture**.
**Encoding warning:** all `resp-*.html` and `fa-*.html` files are **ISO-8859-1** (as served: `content-type: text/html; charset=iso-8859-1`). Umlauts appear as mojibake in UTF-8 viewers. **Do not "fix" the files** — the parser under test must decode them as ISO-8859-1 (latin1 → UTF-8).

## Endpoints (verified 2026-10-24)

| URL | Status |
|---|---|
| `https://fa-technik-adfc.de/fein` | live — the primary endpoint |
| `https://fa-technik-adfc.de/ein` | live — public generator page (same form, `action=/ein`) |
| `https://codierung.adfc-hessen.de/code/ein` | **301 redirect → `https://fa-technik-adfc.de//ein`** — no longer an independent instance |

Consequence: the two-server fallback is effectively a single-server setup today. Keep the URL list configurable; the fallback mechanism costs nothing but currently adds no redundancy.

## Inventory

| File | Request | Demonstrates / expected parse state |
|---|---|---|
| `fa-fein-form.html` | `GET /fein` | initial form: `method=post`, `action=/fein`, `enctype=multipart/form-data`, fields `name, str, hsnr, n1, n2, suchen` |
| `fa-form.html` | `GET /ein` | same form on the public page (`action=/ein`) |
| `hessen-form.html` | `GET codierung.adfc-hessen.de/ein` | 301 redirect page |
| `resp-hessen-codeein-redirect.html` | `GET codierung.adfc-hessen.de/code/ein` | 301 redirect page (the fallback URL) |
| `resp-fa-fein-duisburg-koenigstrasse.html` | POST `name=Duisburg`, `str=Königstraße` (ISO-8859-1) | **street_candidates**: 4 district-qualified candidates, hidden `ort=Duisburg`, `kz=DU 00`, `ags=05112000` |
| `resp-fa-fein-duisburg-ascii-koenigstrasse.html` | POST `str=Koenigstrasse` (pure ASCII) | same candidates → upstream does its own umlaut normalization (`oe→ö`, `ss→ß`); canonical names returned differ from input → informational "normalized" flag |
| `resp-fa-fein-duisburg-utf8test.html` | POST `str=Königstraße` (UTF-8 bytes) | mojibake → fuzzy garbage suggestions → **proves ISO-8859-1 is mandatory for the request** |
| `resp-fa-fein-duisburg-koenigstrasse-altstadt.html` | GET `?ags=05112000;str=Königstraße / Altstadt / Dellviertel;…` | **single**: hidden city fields + result row `Straße` with td4 = `01944`, `Königstraße / Altstadt / Dellviertel`; plus EIN preview table (KZ DU, AGS 00, STR 01944, HS 001, INI XX, Jahr 26) |
| `resp-fa-fein-duisburg-koenigstrasse-altstadt-post.html` | POST `name=Duisburg`, `str=Königstraße / Altstadt / Dellviertel` (ISO-8859-1, **no `ags` in the request**) — added 2026-10-25 | **single**: hidden `ort=Duisburg`, `kz=DU 00`, **`ags=05112000`** + street `01944` — direct evidence that a name-based POST response carries the AGS (closes the circularity of the two GET-based single captures) |
| `resp-fa-fein-get-followup-probe.html` | GET `?ags=05112000;str=Königstraße / Altstadt / Dellviertel;hsnr=1;n1=x;n2=x` (**no `ort` param**) — added 2026-10-25 | **single**: `ort` is **not** required in the AGS follow-up; same state as the altstadt capture |
| `resp-fa-fein-duisburg-str-notfound.html` | POST `str=Gibtsnichtstrasse` | "too many matches" hint + fuzzy prefix suggestions (state `street_candidates`; includes hint text) |
| `resp-fa-fein-friedberg-ortselection.html` | POST `name=Friedberg`, `str=x` | **city_candidates**: rows with kz link text (`FB 08`, `AIC 130`), name + PLZ, `ags` in href |
| `resp-fa-fein-friedberg-hauptstrasse-ags.html` | GET `?ags=06440008;str=Hauptstraße;…` | after city selection: **single** — `FB 08`, street code **00426** (⚠ the ADFC documentation example says 00212 → street codes change → per-key revalidation is genuinely needed) |
| `resp-fa-fein-ort-notfound.html` | POST `name=Xyzhausen`, `str=x` | **not_found**: no hidden inputs, no candidate rows, h2 "Es wurde keine passende Straße gefunden…" |
| `headers-*.txt` | — | response headers (`charset=iso-8859-1`, Apache) |

## Re-capture (from a shell)

```bash
BASE=https://fa-technik-adfc.de/fein
# POST helper: multipart, ISO-8859-1 values
post() { curl -s -D "headers-$1.txt" --form-string "name=$2" --form-string "str=$3" \
  --form-string "hsnr=1" --form-string "n1=x" --form-string "n2=x" --form-string "suchen=suchen" \
  "$BASE" -o "resp-$1.html"; }
STR=$(echo -n 'Königstraße' | iconv -f UTF-8 -t ISO-8859-1)
post fa-fein-duisburg-koenigstrasse Duisburg "$STR"
```

Measured latencies (from the capture environment): **4–14 s per request**, incl. 7–9 s for the plain `GET /fein` form. See `EXTRACTION.md` for consequences (timeout, single-flight, debounce).
