/**
 * QR URLs: all form data lives in the URL fragment (`#v=…`), which browsers
 * never transmit to the server. Older query-param URLs stay decodable.
 */

import type { FormValues } from './values.js';

declare const __APP_VERSION__: string;

const TEXT_FIELDS = [
  'vorname',
  'nachname',
  'ort',
  'strasse',
  'hausnr',
  'marke',
  'modell',
  'farbe',
  'typ',
  'art',
  'schaltung',
  'anzGaenge',
  'rahmenNr',
  'nrPos',
  'verkaeufer',
  'kaufOrt',
  'kaufDatum',
] as const;

const CHECKBOXES = ['mitglied', 'ebike', 'carbonRahmen', 'akku', 'beleg'] as const;

/** Build the URL fragment `#v={version}&{field}={value}&…` for the given values. */
export function encodeFragment(values: Partial<FormValues>): string {
  const params = new URLSearchParams();
  params.set('v', __APP_VERSION__);
  for (const id of TEXT_FIELDS) {
    const value = values[id];
    params.set(id, typeof value === 'string' ? value : '');
  }
  for (const id of CHECKBOXES) {
    if (values[id]) params.set(id, '1'); // absent when unchecked
  }
  return '#' + params.toString();
}

/** Full reload URL: base URL (location origin + path) with the fragment. */
export function encodeUrl(baseUrl: string, values: Partial<FormValues>): string {
  return baseUrl + encodeFragment(values);
}

function normalizeKaufDatum(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return value;
}

function fromParams(params: URLSearchParams): Partial<FormValues> | null {
  const out: Partial<FormValues> & Record<string, unknown> = {};
  let any = false;
  for (const id of TEXT_FIELDS) {
    const value = params.get(id);
    if (value !== null) {
      out[id] = id === 'kaufDatum' ? normalizeKaufDatum(value) : value;
      any = true;
    }
  }
  for (const id of CHECKBOXES) {
    // presence alone means checked — whatever the value (`on`, empty, or `1`)
    if (params.has(id)) {
      out[id] = true;
      any = true;
    }
  }
  return any ? (out as Partial<FormValues>) : null;
}

/**
 * Decode the current location: fragment format if the hash carries a `v=` marker,
 * else the older query-param format (`+` → space, checkboxes by presence,
 * `kaufDatum` as Y-m-d or d.m.Y; raw non-percent-encoded umlauts tolerated).
 * Returns null when the location carries no form data.
 */
export function decodeLocation(loc: Pick<Location, 'hash' | 'search'>): Partial<FormValues> | null {
  const hash = loc.hash ?? '';
  if (hash.startsWith('#') && /(^|&)v=/.test(hash.slice(1))) {
    return fromParams(new URLSearchParams(hash.slice(1)));
  }
  const search = loc.search ?? '';
  if (search !== '' && search !== '?') {
    return fromParams(new URLSearchParams(search));
  }
  return null;
}
