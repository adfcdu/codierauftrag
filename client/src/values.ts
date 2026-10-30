/**
 * Field reading/normalization, validation with the exact German user-facing
 * messages, price calculation, and the streetcode state shape.
 */

import { CONFIG } from './configTypes.js';
import { translit } from './ein.js';

export interface FormValues {
  vorname: string;
  nachname: string;
  ort: string;
  strasse: string;
  hausnr: string;
  marke: string;
  modell: string;
  farbe: string;
  typ: string;
  art: string;
  schaltung: string;
  anzGaenge: string;
  rahmenNr: string;
  nrPos: string;
  verkaeufer: string;
  kaufOrt: string;
  kaufDatum: string;
  mitglied: boolean;
  ebike: boolean;
  carbonRahmen: boolean;
  akku: boolean;
  beleg: boolean;
}

export const TEXT_FIELD_IDS = [
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

export const CHECKBOX_IDS = ['mitglied', 'ebike', 'carbonRahmen', 'akku', 'beleg'] as const;

/** Streetcode resolution state — drives validation, EIN, gating. */
export interface StreetcodeState {
  city?: { name: string; plateCode: string; subCode: string; ags: string };
  street?: { name: string; code: string };
  cityCandidates?: { name: string; plz: string; kz: string; ags: string }[];
  streetCandidates?: string[];
  /** settled error for the Ort resolution: 'not_found' | 'http' (502) */
  cityError?: 'not_found' | 'http';
  /** settled error for the Straße resolution (502 → quirk: street shows the no-codes text) */
  streetError?: 'not_found' | 'http';
  inFlight: boolean;
  /** raw user inputs at settle time — the ort/strasse fields are set to the
   *  canonical names afterwards, so the „geändert von“ info compares these */
  originalOrt?: string;
  originalStrasse?: string;
}

export function emptyState(): StreetcodeState {
  return { inFlight: false };
}

export function readForm(doc: Document): FormValues {
  const values = {} as FormValues;
  for (const id of TEXT_FIELD_IDS) {
    values[id] = (doc.getElementById(id) as HTMLInputElement | null)?.value ?? '';
  }
  for (const id of CHECKBOX_IDS) {
    values[id] = (doc.getElementById(id) as HTMLInputElement | null)?.checked ?? false;
  }
  return values;
}

export function hasAnyInput(values: FormValues): boolean {
  return Boolean(
    values.vorname || values.nachname || values.ort || values.strasse || values.hausnr,
  );
}

/** Letter check: transliterate the first char, then "letter iff upper ≠ lower && < 256". */
export function isLetterChar(c: string): boolean {
  const t = translit(c, CONFIG.umlauteImBarcode);
  const upper = t.toUpperCase();
  const lower = t.toLowerCase();
  return upper !== lower && (t.codePointAt(0) ?? 0) < 256;
}

/**
 * Validation per field — the exact German user-facing messages.
 * Returns false for "no message". `geändert von …` rows are informational.
 */
export function validateField(
  id: 'vorname' | 'nachname' | 'ort' | 'strasse' | 'hausnr',
  values: FormValues,
  state: StreetcodeState,
): string | false {
  if (
    !values.vorname &&
    !values.nachname &&
    !values.ort &&
    !values.strasse &&
    !values.hausnr
  ) {
    return false; // blank-form rule: nothing entered at all → no messages
  }

  switch (id) {
    case 'vorname':
      if (!values.vorname) return 'Vorname muss angegeben werden';
      if (!isLetterChar(values.vorname[0])) return 'Vorname muss mit einem Buchstaben beginnen';
      return false;
    case 'nachname':
      if (!values.nachname) return 'Nachname muss angegeben werden';
      if (!isLetterChar(values.nachname[0])) return 'Nachname muss mit einem Buchstaben beginnen';
      return false;
    case 'ort':
      if (!values.ort) return 'Ort muss angegeben werden';
      if (state.cityCandidates) {
        return 'Eingabe war nicht eindeutig, bitte den Ort aus der Liste auswählen oder neuen Wert eingeben';
      }
      if (state.cityError === 'http') {
        return 'Der ADFC-Server ist derzeit nicht erreichbar, bitte später erneut versuchen.';
      }
      if (state.cityError === 'not_found') return 'Zu diesem Ort sind leider keine Codes bekannt.';
      if (state.city && state.city.name !== (state.originalOrt ?? values.ort)) {
        return `geändert von „${state.originalOrt ?? values.ort}“`; // no error, just info!
      }
      return false;
    case 'strasse':
      if (!values.strasse) return 'Straße muss angegeben werden';
      if (state.streetError === 'http') {
        // Quirk: on 502 the street field shows the no-codes text while ort
        // shows the unreachable text.
        return 'Zu dieser Straße sind leider keine Codes bekannt.';
      }
      if (!state.city) return '(nicht validiert, da Ort unklar)';
      if (state.streetCandidates) {
        return 'Eingabe war nicht eindeutig, bitte die Straße aus der Liste auswählen oder neuen Wert eingeben';
      }
      if (state.streetError === 'not_found') return 'Zu dieser Straße sind leider keine Codes bekannt.';
      if (!state.street) return 'Zu dieser Straße sind leider keine Codes bekannt.';
      if (state.street.name !== (state.originalStrasse ?? values.strasse)) {
        return `geändert von „${state.originalStrasse ?? values.strasse}“`; // no error, just info!
      }
      return false;
    case 'hausnr':
      if (!values.hausnr) {
        return values.hausnr === '0' ? 'Hausnummer darf nicht 0 sein' : 'Hausnummer muss angegeben werden';
      }
      if (values.hausnr === '0') return 'Hausnummer darf nicht 0 sein';
      if (!/^\d/.test(values.hausnr)) return 'Hausnummer muss mit einer Ziffer beginnen';
      return false;
  }
}

export function isInfoMessage(msg: string | false): boolean {
  return typeof msg === 'string' && msg.startsWith('geändert von ');
}

/** True if any of the five key fields carries a non-informational message. */
export function anyValidationErrors(values: FormValues, state: StreetcodeState): boolean {
  const ids: Array<'vorname' | 'nachname' | 'ort' | 'strasse' | 'hausnr'> = [
    'vorname',
    'nachname',
    'ort',
    'strasse',
    'hausnr',
  ];
  for (const id of ids) {
    const msg = validateField(id, values, state);
    if (msg !== false && !isInfoMessage(msg)) return true;
  }
  return false;
}

// ── Price (computed live on every relevant change) ──

export function isTrailer(typ: string): boolean {
  return typ.trim().toLowerCase() === 'anhänger';
}

const priceFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const vatPercentFormatter = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Fees always render with exactly 2 fraction digits (5 → "5,00"). */
export function formatPrice(value: number): string {
  return priceFormatter.format(value);
}

/** VAT percent with 1 fraction digit min+max (7 → "7,0"). */
export function formatVatPercent(value: number): string {
  return vatPercentFormatter.format(value);
}

export function computePrice(values: FormValues): { descr: string; price: number; member: boolean } {
  const member = values.mitglied;
  const trailer = isTrailer(values.typ);
  const descr = trailer ? 'Anhänger' : 'Fahrrad';
  // Carbon frame coding = a label instead of the engraved frame: the label
  // costs the AUFPREIS_AKKU_ amount as the bike base charge — not a surcharge
  // on top of the regular bike fee. The Akku surcharge still applies.
  // Suppressed entirely when the Carbon-Rahmen toggle is disabled (ZEIGE_CARBONRAHMEN=false) —
  // also covers QR-prefilled values, which bypass the hidden form field.
  const carbon = CONFIG.zeigeCarbonRahmen && values.carbonRahmen && !trailer;
  const base = trailer
    ? member
      ? CONFIG.preisAnhaengerMitglied
      : CONFIG.preisAnhaengerNichtMitglied
    : carbon
      ? member
        ? CONFIG.aufpreisAkkuMitglied
        : CONFIG.aufpreisAkkuNichtMitglied
      : member
        ? CONFIG.preisMitglied
        : CONFIG.preisNichtMitglied;
  const aufpreis = member ? CONFIG.aufpreisAkkuMitglied : CONFIG.aufpreisAkkuNichtMitglied;
  const price = base + (values.akku ? aufpreis : 0);
  let full = carbon ? `${descr} (Carbon)` : descr;
  if (values.akku) full += ' + Akku';
  return { descr: full, price, member };
}

export function priceLineText(values: FormValues): string {
  const { descr, price, member } = computePrice(values);
  return `Codiergebühr: ${descr}: ${formatPrice(price)} € (${member ? 'Mitglied' : 'Nichtmitglied'})`;
}

/** VAT math (used by the PDF fee box). */
export function vatAmounts(gross: number, percent: number): { steuer: number; netto: number } {
  const netto = gross / (1 + percent / 100);
  return { steuer: gross - netto, netto };
}
