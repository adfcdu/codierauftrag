/**
 * Fehlerbericht per E-Mail: the mailto: draft behind the footer link
 * „Fehler per E-Mail melden“. The draft carries the form input (text fields
 * and toggles) except Vorname, Nachname and Hausnummer, plus the app version
 * and the page URL. Nothing is sent automatically — the user still has to
 * press send in their mail client.
 */

import { CONFIG } from './configTypes.js';
import { kaufDatumDisplayYmd } from './values.js';
import type { FormValues } from './values.js';

export interface ErrorMailContext {
  /** recipient address, without the mailto: prefix */
  to: string;
  /** app version — same source as the footer line and the PDF footer */
  version: string;
  /** page URL the codierauftrag was filled in (origin + path, no fragment) */
  url: string;
}

/** Text fields in the draft, in form order. Vorname, Nachname and Hausnummer
 *  are deliberately absent: the report must not carry the person's identity. */
const TEXT_ROWS: ReadonlyArray<readonly [keyof FormValues, string]> = [
  ['ort', 'Ort'],
  ['strasse', 'Straße'],
  ['marke', 'Marke'],
  ['modell', 'Modell'],
  ['farbe', 'Farbe'],
  ['typ', 'Radtyp (bzw. Anhänger)'],
  ['art', 'Radart'],
  ['schaltung', 'Schaltung'],
  ['anzGaenge', 'Anzahl Gänge'],
  ['rahmenNr', 'Rahmennummer'],
  ['nrPos', 'Position Rahmennummer'],
  ['kaufDatum', 'Kaufdatum'],
  ['verkaeufer', 'Verkäufer'],
  ['kaufOrt', 'Kaufort'],
];

/** Toggles in the draft, in form order. */
const TOGGLE_ROWS: ReadonlyArray<readonly [keyof FormValues, string]> = [
  ['mitglied', 'ADFC-Mitglied'],
  ['ebike', 'Pedelec/E-Bike'],
  ['carbonRahmen', 'Carbon-Rahmen'],
  ['akku', 'Akku codieren'],
  ['beleg', 'Kaufbeleg vorhanden'],
];

/** Plain-text draft body (CRLF — mail clients expect it). */
export function buildErrorMailBody(values: FormValues, ctx: ErrorMailContext): string {
  const lines: string[] = [
    'Fehlerbericht zum Codierauftrag',
    '',
    'Bitte beschreiben Sie hier den Fehler:',
    '',
    '',
    '--- Eingaben im Formular (ohne Vor-/Nachname und Hausnummer) ---',
  ];
  for (const [key, label] of TEXT_ROWS) {
    const raw = values[key];
    const text = typeof raw === 'string' ? raw.trim() : '';
    // Kaufdatum liegt kanonisch als Y-m-d vor — im Bericht wie im PDF als
    // TT.MM.JJJJ, damit die Angabe lesbar bleibt
    const shown = key === 'kaufDatum' && text !== '' ? kaufDatumDisplayYmd(text) : text;
    lines.push(`${label}: ${shown === '' ? '(leer)' : shown}`);
  }
  for (const [key, label] of TOGGLE_ROWS) {
    lines.push(`${label}: ${values[key] === true ? 'ja' : 'nein'}`);
  }
  lines.push('', '--- Technische Angaben ---', `Version: ${ctx.version}`, `URL: ${ctx.url}`);
  return lines.join('\r\n');
}

/** mailto: URI with subject and pre-filled body. */
export function buildErrorMailto(values: FormValues, ctx: ErrorMailContext): string {
  const subject = `Fehlerbericht Codierauftrag V${ctx.version}`;
  const query =
    `subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(buildErrorMailBody(values, ctx))}`;
  return `mailto:${ctx.to}?${query}`;
}

/** mailto: href for the current form state. The page URL is reduced to
 *  origin + path: the fragment carries the QR prefill (name, house number),
 *  which the report must not contain. */
export function errorMailHref(doc: Document, values: FormValues): string {
  const loc = doc.location;
  return buildErrorMailto(values, {
    to: CONFIG.emailAdresse,
    version: __APP_VERSION__,
    url: loc ? `${loc.origin}${loc.pathname}` : '',
  });
}

/** Keep the footer link in sync with the live form values. */
export function updateErrorMailLink(doc: Document, values: FormValues): void {
  const link = doc.getElementById('fehlerMail') as HTMLAnchorElement | null;
  if (link) link.href = errorMailHref(doc, values);
}
