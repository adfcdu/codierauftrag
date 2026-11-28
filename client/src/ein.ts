/**
 * EIN assembly, transliteration, barcode text. The EIN is the coding number
 * printed on the PDF; '0' is a rejected Hausnummer (never valid).
 */

import { CONFIG, barcodeKeepsUmlauts } from './configTypes.js';
import { TRANSLIT } from './translit.map.js';
import type { FormValues, StreetcodeState } from './values.js';

/** Transliterate accents/umlauts; with keepCharsBelow256 Latin-1 chars stay. */
export function translit(text: string, keepCharsBelow256: boolean): string {
  let out = '';
  for (const ch of text) {
    const mapped = TRANSLIT[ch];
    if (mapped !== undefined && !(keepCharsBelow256 && ch.codePointAt(0)! < 256)) {
      out += mapped;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * One char per initial, always: 'ß'/'ẞ' stay 'ß' — toUpperCase() would expand
 * 'ß' to 'SS' and push the EIN past its fixed length. Everything else is
 * uppercased per char.
 */
function iniChar(c: string | undefined): string {
  if (c === 'ß' || c === 'ẞ') return 'ß';
  return (c ?? '').toUpperCase();
}

export interface EinParts {
  kz: string;
  subCode: string;
  str: string;
  hs: string;
  ini: string;
  jahr?: string;
}

export function einParts(values: FormValues, state: StreetcodeState, now: Date = new Date()): EinParts {
  const kz = state.city?.plateCode ?? '';
  const subCode = state.city?.subCode ?? '';
  const str = state.street?.code ?? '';
  const n = parseInt(values.hausnr, 10);
  const hs = n > 0 ? String(n % 1000).padStart(3, '0') : '?';
  const ini = iniChar(values.vorname[0]) + iniChar(values.nachname[0]);
  const parts: EinParts = { kz, subCode, str, hs, ini };
  if (CONFIG.inklusiveJahr) {
    // The EIN year is computed in the CONFIGURED timezone — never the visitor's
    // browser-local zone.
    parts.jahr = new Intl.DateTimeFormat('de-DE', { timeZone: CONFIG.zeitzone, year: '2-digit' })
      .format(now);
  }
  return parts;
}

export function einText(values: FormValues, state: StreetcodeState, now: Date = new Date()): string {
  const p = einParts(values, state, now);
  return p.kz + p.subCode + p.str + p.hs + p.ini + (CONFIG.inklusiveJahr ? (p.jahr ?? '') : '');
}

/** Letter check for both initials. */
export function initialsPassLetterCheck(values: FormValues): boolean {
  const ini = (values.vorname[0] ?? '') + (values.nachname[0] ?? '');
  for (const c of ini) {
    const t = translit(c, barcodeKeepsUmlauts());
    const upper = t.toUpperCase();
    const lower = t.toLowerCase();
    if (upper === lower || (t.codePointAt(0) ?? 0) >= 256) return false;
  }
  return true;
}

/** EIN validity — '0' as Hausnummer is explicitly rejected. */
export function isEinValid(values: FormValues, state: StreetcodeState): boolean {
  return Boolean(
    state.city?.plateCode &&
      state.city?.subCode &&
      state.street?.code &&
      /^\d/.test(values.hausnr) &&
      values.hausnr !== '0' &&
      values.vorname &&
      values.nachname &&
      initialsPassLetterCheck(values),
  );
}

/**
 * Barcode content + label. With barcodeKeepsUmlauts() (Code 128 + flag true)
 * Latin-1 chars stay and bwip-js encodes them via FNC4; otherwise the EIN goes
 * through the full accent map (length-preserving: ß→s, Ä→A …). In both cases
 * the result has exactly the length of the EIN — never longer.
 * [content, label]
 */
export function barCodeTextAndLabel(
  values: FormValues,
  state: StreetcodeState,
  now: Date = new Date(),
): [string, string] {
  const keep = barcodeKeepsUmlauts();
  const ein = einText(values, state, now);
  // fold path: uppercase like the rest of the EIN (ß→s→S); keep path: Latin-1 as-is (ßÖ)
  const text = keep ? translit(ein, true) : translit(ein, false).toUpperCase();
  return [text, text];
}
