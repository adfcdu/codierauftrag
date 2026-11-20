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
  // Kaufdatum: kanonisch nach Y-m-d (PDF-Anzeige und QR-URL erwarten das) —
  // unauswertbare Eingaben bleiben stehen (Meldung + PDF-Sperre übernehmen).
  const parsedKaufDatum = parseKaufDatum(values.kaufDatum);
  if (parsedKaufDatum !== false) values.kaufDatum = parsedKaufDatum;
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

// ── Kaufdatum (eigenes Textfeld, kein <input type="date">) ──
// Safaris segmentierte Date-Inputs zerlegen getippte Jahre (bekannter
// WebKit-Fehler: „2016“ wird zu „0006“) und sind aus JS nicht korrigierbar.
// Daher: eigenes Textfeld mit toleranter Auswertung. `todayYmd` ersetzt das
// frühere max-Attribut — Daten in der Zukunft gelten als ungültig.

/** Today's date as Y-m-d in the given timezone (Kaufdatum upper bound). */
export function todayYmd(zeitzone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zeitzone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // en-CA yields Y-m-d
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1]!;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Flexible entry → canonical Y-m-d, or false if not a valid purchase date.
 * Accepted: TT.MM.JJJJ, TT.MM.JJ, TT.MM.Y (ein- bis zweistellig), reine
 * Ziffernfolgen zu 6 (TTMMJJ) bzw. 8 (TTMMJJJJ) Stellen und ISO JJJJ-MM-TT.
 * Untere Schranke wie das frühere min-Attribut (1950). Keine Obergrenze und
 * keine Zukunfts-Ablehnung: das Feld poliziert nichts (kein PDF-Gate) —
 * ein neu gekauftes Rad darf sich auch einmal in der Zukunft datieren.
 */
export function parseKaufDatum(raw: string): string | false {
  const value = raw.trim();
  if (!value) return false;

  let d: number | undefined;
  let m: number | undefined;
  let y: number;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmy = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/);
  const compact = value.replace(/\D/g, '');
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
    if (dmy[3].length === 2) y += y >= 70 ? 1900 : 2000; // 16 → 2016, 99 → 1999
  } else if (compact.length === 8) {
    d = Number(compact.slice(0, 2));
    m = Number(compact.slice(2, 4));
    y = Number(compact.slice(4, 8));
  } else if (compact.length === 6) {
    d = Number(compact.slice(0, 2));
    m = Number(compact.slice(2, 4));
    y = Number(compact.slice(4, 6));
    y += y >= 70 ? 1900 : 2000;
  } else {
    return false;
  }

  if (d === undefined || m === undefined) return false;
  if (y < 1950) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;

  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Canonical Y-m-d → German display TT.MM.JJJJ (PDF prints this). */
export function kaufDatumDisplayYmd(ymd: string): string {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** German user-facing message for the Kaufdatum field (optional field). */
export function kaufDatumMessage(values: FormValues): string | false {
  if (!values.kaufDatum) return false;
  if (parseKaufDatum(values.kaufDatum) !== false) return false;
  return 'Bitte ein gültiges Kaufdatum eingeben (Tag.Monat.Jahr, z. B. 15.06.2016)';
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

/**
 * Base price of a Sicherheitsetiketten coding. The ADFC lists it at the same
 * amount as the Akku surcharge, so the config keeps one pair of keys for both.
 */
function etikettPreis(member: boolean): number {
  return member ? CONFIG.aufpreisAkkuMitglied : CONFIG.aufpreisAkkuNichtMitglied;
}

/** „2 Sicherheitsetiketten“ — ETIKETTEN_ANZAHL, the count the base price covers. */
export function etikettenText(): string {
  return `${CONFIG.etikettenAnzahl} Sicherheitsetiketten`;
}

/** „Jedes weitere Sicherheitsetikett: 2,50 €“ — each extra label costs half
 *  of the sticker base price, for the member status of the form. */
export function extraEtikettPriceText(member: boolean): string {
  return `Jedes weitere Sicherheitsetikett: ${formatPrice(etikettPreis(member) / 2)} €`;
}

/** The extra-label note, or '' when no Sicherheitsetikett is used at all
 *  (plain aluminium/steel frame without Akku). */
export function extraEtikettNoteText(values: FormValues): string {
  return computePrice(values).usesEtiketten ? extraEtikettPriceText(values.mitglied) : '';
}

export interface PriceInfo {
  /** PDF fee line: „Fahrrad (Carbon) + Akku“ */
  descr: string;
  /** Price-bar description naming the coding method per item */
  methodDescr: string;
  price: number;
  member: boolean;
  /** true iff a Sicherheitsetikett coding is part of this price */
  usesEtiketten: boolean;
}

export function computePrice(values: FormValues): PriceInfo {
  const member = values.mitglied;
  const trailer = isTrailer(values.typ);
  const descr = trailer ? 'Anhänger' : 'Fahrrad';
  // Carbon frame coding = a label instead of the engraved frame: the label
  // costs the sticker base price as the bike base charge — not a surcharge
  // on top of the regular bike fee. The Akku surcharge still applies.
  // Suppressed entirely when the Carbon-Rahmen toggle is disabled (ZEIGE_CARBONRAHMEN=false) —
  // also covers QR-prefilled values, which bypass the hidden form field.
  const carbon = CONFIG.zeigeCarbonRahmen && values.carbonRahmen && !trailer;
  const base = trailer
    ? member
      ? CONFIG.preisAnhaengerMitglied
      : CONFIG.preisAnhaengerNichtMitglied
    : carbon
      ? etikettPreis(member)
      : member
        ? CONFIG.preisMitglied
        : CONFIG.preisNichtMitglied;
  const aufpreis = etikettPreis(member);
  const price = base + (values.akku ? aufpreis : 0);
  let full = carbon ? `${descr} (Carbon)` : descr;
  if (values.akku) full += ' + Akku';
  // The price bar names the method: Aluminium/steel frames are needle-marked,
  // carbon frames and Akkus only ever get Sicherheitsetiketten.
  let methodDescr = `${descr} (${carbon ? etikettenText() : 'Nadelmarkierung'})`;
  if (values.akku) methodDescr += ` + Akku (${etikettenText()})`;
  return { descr: full, methodDescr, price, member, usesEtiketten: carbon || values.akku };
}

export function priceLineText(values: FormValues): string {
  const { methodDescr, price, member } = computePrice(values);
  return `Codiergebühr: ${methodDescr}: ${formatPrice(price)} € (${member ? 'Mitglied' : 'Nichtmitglied'})`;
}

/** VAT math (used by the PDF fee box). */
export function vatAmounts(gross: number, percent: number): { steuer: number; netto: number } {
  const netto = gross / (1 + percent / 100);
  return { steuer: gross - netto, netto };
}
