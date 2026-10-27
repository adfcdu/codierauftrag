/**
 * Page builders — header, instructions, checklist, form, EIN box, price line,
 * footer. All user-facing texts verbatim. Safe DOM APIs only — no innerHTML
 * with data.
 */

import type { AppConfig } from '../configTypes.js';
import { attachDropdownArrow, syncComboArrows } from './combobox.js';

export const TYP_LIST = [
  'Citybike',
  'Dreirad',
  'Faltrad',
  'Hollandrad',
  'Lastenrad',
  'Liegerad',
  'MTB',
  'Rennrad',
  'Sportrad',
  'Trekkingrad',
  'Anhänger',
];

export const ART_LIST = ['Damenrad', 'Herrenrad', 'Jugendrad', 'Kinderrad', 'Mixed'];

export const SCHALTUNG_LIST = [
  'Kette',
  'Nabe',
  'Fixie',
  'Tretlagergetriebe',
  'Kombischaltung',
  'stufenlos',
  'ohne',
];

/** Positions of the frame number (drop-down list). */
export const NR_POS_LIST = [
  'Pletscherplatte',
  'Sattelrohr',
  'Steuerrohr',
  'Tretlager (unten)',
  'Vorderrohr',
];

/** Field maxlengths. */
export const MAX_LENGTHS: Record<string, number> = {
  vorname: 30,
  nachname: 30,
  ort: 30,
  strasse: 60,
  hausnr: 10,
  marke: 30,
  modell: 40,
  farbe: 30,
  rahmenNr: 20,
  verkaeufer: 40,
  kaufOrt: 40,
  typ: 30,
  art: 30,
  schaltung: 30,
  nrPos: 30,
};

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function textField(
  doc: Document,
  opts: {
    id: string;
    label: string;
    required?: boolean;
    maxlength?: number;
    list?: string;
    narrow?: boolean;
    date?: boolean;
  },
): HTMLDivElement {
  const wrap = el(doc, 'div', 'input-text' + (opts.narrow ? ' narrow' : ''));
  const label = el(doc, 'label', opts.required ? 'required' : undefined, opts.label) as HTMLLabelElement;
  wrap.append(label);
  const input = el(doc, 'input') as HTMLInputElement;
  input.id = opts.id;
  input.name = opts.id;
  if (opts.required) input.required = true;
  if (opts.maxlength !== undefined) input.maxLength = opts.maxlength;
  if (opts.list) input.setAttribute('list', opts.list);
  if (opts.date) {
    input.type = 'date';
    input.min = '1950-01-01';
  } else {
    input.type = 'text';
  }
  if (opts.list) {
    // Klick-Pfeil für die Vorschlagsliste (combobox.ts) — Firefox/LibreWolf
    // öffnet native Datalist-Vorschläge erst beim Tippen
    const combo = el(doc, 'div', 'combo');
    combo.append(input);
    wrap.append(combo);
    attachDropdownArrow(doc, input);
  } else {
    wrap.append(input);
  }
  return wrap;
}

/** Toggle switch: the input stays the semantic state source (values.ts reads
 *  .checked); the whole label row is the touch target. */
function checkboxField(doc: Document, id: string, label: string): HTMLDivElement {
  const wrap = el(doc, 'div', 'input-check');
  const lab = el(doc, 'label', 'toggle') as HTMLLabelElement;
  lab.htmlFor = id;
  const input = el(doc, 'input') as HTMLInputElement;
  input.type = 'checkbox';
  input.id = id;
  input.name = id;
  lab.append(el(doc, 'span', 'toggle-text', label), input);
  wrap.append(lab);
  return wrap;
}

export interface BuiltPage {
  form: HTMLFormElement;
  genPdf: HTMLButtonElement;
  price: HTMLSpanElement | null;
  einBox: HTMLDivElement;
  einCells: Record<'kz' | 'ags' | 'str' | 'hs' | 'ini' | 'jahr', HTMLTableCellElement>;
  datalistOrt: HTMLDataListElement;
  datalistStrasse: HTMLDataListElement;
}

/** Today's date as Y-m-d in the configured timezone (kaufDatum max). */
export function todayYmd(zeitzone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zeitzone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA yields Y-m-d
}

export function buildPage(doc: Document, config: AppConfig, mount: HTMLElement): BuiltPage {
  // ── header ──
  const header = el(doc, 'div', 'header');
  const logo = el(doc, 'div');
  logo.id = 'logo';
  const logoPicture = el(doc, 'img') as HTMLImageElement;
  logoPicture.id = 'logo-picture';
  logoPicture.src = 'img/ADFC-logo-white.png';
  logoPicture.alt = 'ADFC-Logo';
  const logoText = el(doc, 'div');
  logoText.id = 'logo-text';
  logoText.textContent = config.logoText;
  logo.append(logoPicture, logoText);
  const headerText = el(doc, 'div', 'header-text');
  headerText.append(el(doc, 'h2', undefined, 'Fahrrad-/Anhänger-Codierauftrag'));
  const intro = el(doc, 'p');
  intro.append(
    doc.createTextNode(
      'Auf dieser Website können Sie Ihre Daten für die Codierung Ihres Fahrrades oder Fahrradanhängers erfassen und ausdrucken. Das spart Zeit beim Codierungstermin.',
    ),
  );
  headerText.append(intro);
  // Plain paragraph without any class — uBlock/EasyList cosmetic filters hid
  // classed variants (.privacy-note) with display:none in LibreWolf. Styled
  // smaller via the structural selector `.header-text > p:nth-of-type(2)`
  // in coding.css — keep this the 2nd paragraph of .header-text.
  const privacyNote = el(doc, 'p');
  privacyNote.append(
    doc.createTextNode(
      'Ihre Daten bleiben in Ihrem Browser. Nur Ort und Straße gehen für die Code-Suche an den ADFC. Details: ',
    ),
  );
  const datenschutzLink = el(doc, 'a') as HTMLAnchorElement;
  // Text in einem span: Hover unterstreicht nur den span (CSS), nicht den
  // Pfeil aus a::after.
  datenschutzLink.append(el(doc, 'span', undefined, 'Impressum und Datenschutz'));
  datenschutzLink.href = config.datenschutzUrl;
  datenschutzLink.target = '_blank';
  datenschutzLink.rel = 'noopener';
  privacyNote.append(datenschutzLink);
  headerText.append(privacyNote);
  if (config.zeigeCodierungInfo) {
    const p = el(doc, 'p');
    const a = el(doc, 'a') as HTMLAnchorElement;
    // Text in einem span: Hover unterstreicht nur den span (CSS), nicht den
    // Pfeil aus a::after.
    a.append(el(doc, 'span', undefined, 'Informationen zur Codierung'));
    a.href = config.codierungInfoUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.classList.add('codierung-info-link');
    p.append(a);
    headerText.append(p);
  }
  header.append(logo, headerText);
  mount.append(header, el(doc, 'hr', 'header-divider'));

  // ── instructions ──
  const instructions = el(doc, 'div', 'instructions');
  const steps = el(doc, 'div');
  steps.append(el(doc, 'h3', undefined, 'Bitte gehen Sie wie folgt vor:'));
  const stepIcon = (symbol: string, title: string): SVGSVGElement => {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('role', 'img');
    const t = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = title;
    svg.append(t);
    const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${symbol}`);
    svg.append(use);
    return svg as unknown as SVGSVGElement;
  };
  const step = (icon: SVGSVGElement, p: HTMLParagraphElement): HTMLDivElement => {
    const div = el(doc, 'div', 'step');
    div.append(icon, p);
    return div;
  };
  if (config.zeigeCodierungBuchen) {
    const p = el(doc, 'p');
    p.append(doc.createTextNode('Einen Termin buchen: '));
    const a = el(doc, 'a', 'btn') as HTMLAnchorElement;
    a.href = config.codierungBuchenUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.append(
      (() => {
        const s = el(doc, 'span', 'btn-text', 'Zur Buchung');
        return s;
      })(),
      el(doc, 'span', 'btn-arrow', '>'),
    );
    p.append(a);
    steps.append(step(stepIcon('icon-calendar-booking', 'Termin buchen'), p));
  }
  steps.append(
    step(
      stepIcon('icon-keyboard', 'Tastatur'),
      el(doc, 'p', undefined, 'Dieses Formular ausfüllen'),
    ),
  );
  const pdfStepP = el(doc, 'p', 'withButton');
  pdfStepP.append(doc.createTextNode('Auf '));
  pdfStepP.append(el(doc, 'span', 'btn', 'PDF erzeugen'));
  pdfStepP.append(doc.createTextNode(' unten auf dem Formular klicken'));
  steps.append(step(stepIcon('icon-mouse-leftclick', 'Mausklick'), pdfStepP));
  steps.append(
    step(stepIcon('icon-download', 'Download'), el(doc, 'p', undefined, 'PDF-Datei herunterladen')),
  );
  const printP = el(doc, 'p', undefined, 'PDF-Datei wenn möglich ausdrucken');
  if (!config.pdfNurEineSeite) {
    printP.append(doc.createTextNode(' '));
    printP.append(el(doc, 'em', undefined, '(auf zwei getrennte Blätter)'));
  }
  steps.append(step(stepIcon('icon-print', 'Ausdrucken'), printP));

  const checklistWrap = el(doc, 'div');
  checklistWrap.append(el(doc, 'h3', undefined, 'Zum Codierungstermin bringen Sie folgendes mit:'));
  const ul = el(doc, 'ul', 'checklist');
  for (const item of [
    'Das zu codierende Fahrrad oder Anhänger',
    'Nachweis des rechtmäßigen Erwerbs (z. B. Kaufbeleg oder Rechnung)',
    'Identitätsnachweis (Personalausweis, Führerschein oder Reisepass mit Meldebescheinigung)',
    'Ggf. Bestätigung des Eigentümers, wenn das Rad durch eine andere Person vorgeführt wird',
    'Als ADFC-Mitglied Ihren Mitgliedsausweis',
  ]) {
    ul.append(el(doc, 'li', undefined, item));
  }
  const lastLi = el(doc, 'li');
  lastLi.append(doc.createTextNode('Den ausgefüllten Codierauftrag'));
  if (!config.pdfNurEineSeite) {
    lastLi.append(doc.createTextNode(' '));
    lastLi.append(el(doc, 'em', undefined, '(beide Blätter)'));
  }
  lastLi.append(doc.createTextNode(', ausgedruckt oder digital'));
  ul.append(lastLi);
  checklistWrap.append(ul);
  instructions.append(steps, checklistWrap);
  mount.append(instructions, el(doc, 'hr', 'header-divider'));

  // ── form ──
  const form = el(doc, 'form') as HTMLFormElement;
  form.id = 'form'; // purely structural — no action, no method: the form never submits
  form.append(el(doc, 'div', 'break'));
  form.append(el(doc, 'h2', undefined, 'Eigentümer*in'));
  form.append(
    textField(doc, { id: 'vorname', label: 'Vorname(n)', required: true, maxlength: MAX_LENGTHS['vorname']! }),
    textField(doc, { id: 'nachname', label: 'Nachname', required: true, maxlength: MAX_LENGTHS['nachname']! }),
    checkboxField(doc, 'mitglied', 'ADFC-Mitglied'),
    el(doc, 'div', 'break'),
    textField(doc, { id: 'ort', label: 'Ort', required: true, maxlength: MAX_LENGTHS['ort']!, list: 'dl-ort' }),
    textField(doc, { id: 'strasse', label: 'Straße', required: true, maxlength: MAX_LENGTHS['strasse']!, list: 'dl-strasse' }),
    textField(doc, { id: 'hausnr', label: 'Hausnr.', required: true, maxlength: MAX_LENGTHS['hausnr']!, narrow: true }),
    el(doc, 'div', 'break divider'),
    el(doc, 'h2', undefined, 'Fahrrad/Anhänger'),
    textField(doc, { id: 'marke', label: 'Marke', maxlength: MAX_LENGTHS['marke']! }),
    textField(doc, { id: 'modell', label: 'Modell', maxlength: MAX_LENGTHS['modell']! }),
    textField(doc, { id: 'farbe', label: 'Farbe', maxlength: MAX_LENGTHS['farbe']! }),
    textField(doc, { id: 'typ', label: 'Radtyp (bzw. Anhänger)', maxlength: MAX_LENGTHS['typ']!, list: 'dl-typ' }),
    textField(doc, { id: 'art', label: 'Radart', maxlength: MAX_LENGTHS['art']!, list: 'dl-art' }),
    // Carbon-Rahmen in der Radtyp/Radart-Zeile — Rahmeneigenschaft gehört zu
    // Radtyp/Radart; bleibt links von Pedelec/E-Bike
    checkboxField(doc, 'carbonRahmen', 'Carbon-Rahmen'),
    el(doc, 'div', 'break'),
    // Pedelec/E-Bike + Akku öffnen die Schaltungs-Zeile — Toggles vor den
    // Textfeldern, wie Carbon in der Zeile darüber
    checkboxField(doc, 'ebike', 'Pedelec/E-Bike'),
    ...(config.zeigeAkku ? [checkboxField(doc, 'akku', 'Akku codieren')] : []),
    textField(doc, { id: 'schaltung', label: 'Schaltung', maxlength: MAX_LENGTHS['schaltung']!, list: 'dl-schaltung' }),
  );
  const anzGaenge = textField(doc, { id: 'anzGaenge', label: 'Anz. Gänge', narrow: true });
  const anzGaengeInput = anzGaenge.querySelector('input') as HTMLInputElement;
  anzGaengeInput.type = 'number';
  anzGaengeInput.min = '0';
  anzGaengeInput.max = '36';
  form.append(anzGaenge);
  form.append(el(doc, 'div', 'break'));
  form.append(
    textField(doc, { id: 'rahmenNr', label: 'Rahmennummer', maxlength: MAX_LENGTHS['rahmenNr']! }),
    textField(doc, { id: 'nrPos', label: 'Position Rahmennummer', maxlength: MAX_LENGTHS['nrPos']!, list: 'dl-nrpos' }),
    el(doc, 'div', 'break'),
    textField(doc, { id: 'verkaeufer', label: 'Verkäufer', maxlength: MAX_LENGTHS['verkaeufer']! }),
    textField(doc, { id: 'kaufOrt', label: 'Kaufort', maxlength: MAX_LENGTHS['kaufOrt']! }),
    (() => {
      const field = textField(doc, { id: 'kaufDatum', label: 'Kaufdatum', date: true });
      field.classList.remove('input-text');
      field.classList.add('input-date');
      (field.querySelector('input') as HTMLInputElement).max = todayYmd(config.zeitzone);
      return field;
    })(),
    checkboxField(doc, 'beleg', 'Kaufbeleg vorh.'),
    el(doc, 'div', 'break'),
  );

  const genPdf = el(doc, 'button') as HTMLButtonElement;
  genPdf.id = 'genPdf';
  genPdf.type = 'button';
  genPdf.disabled = true;
  genPdf.textContent = 'PDF erzeugen';
  form.append(genPdf);
  mount.append(form);

  // datalists
  const datalistOrt = doc.createElement('datalist');
  datalistOrt.id = 'dl-ort';
  const datalistStrasse = doc.createElement('datalist');
  datalistStrasse.id = 'dl-strasse';
  const staticList = (id: string, entries: string[]): HTMLDataListElement => {
    const dl = doc.createElement('datalist');
    dl.id = id;
    for (const entry of entries) {
      const opt = doc.createElement('option');
      opt.value = entry;
      dl.append(opt);
    }
    return dl;
  };
  form.append(
    datalistOrt,
    datalistStrasse,
    staticList('dl-typ', TYP_LIST),
    staticList('dl-art', ART_LIST),
    staticList('dl-schaltung', SCHALTUNG_LIST),
    staticList('dl-nrpos', NR_POS_LIST),
  );
  syncComboArrows(doc);

  // ── EIN box + price ──
  const bottom = el(doc, 'div', 'bottom');
  const einBox = el(doc, 'div', 'ein-box');
  einBox.append(el(doc, 'h4', 'ein-title', 'Ihr EIN-Code:'));
  const table = el(doc, 'table', 'ein-data');
  const headRow = el(doc, 'tr');
  const dataRow = el(doc, 'tr');
  const einCells = {} as BuiltPage['einCells'];
  const columns: Array<['kz' | 'ags' | 'str' | 'hs' | 'ini' | 'jahr', string]> = [
    ['kz', 'Kennz'],
    ['ags', 'AGS'],
    ['str', 'Straße'],
    ['hs', 'HS'],
    ['ini', 'INI'],
  ];
  if (config.inklusiveJahr) columns.push(['jahr', 'Jahr']);
  for (const [key, title] of columns) {
    headRow.append(el(doc, 'th', undefined, title));
    const td = el(doc, 'td');
    einCells[key] = td as HTMLTableCellElement;
    dataRow.append(td);
  }
  table.append(headRow, dataRow);
  einBox.append(table);
  einBox.style.display = 'none';
  bottom.append(einBox);

  let price: HTMLSpanElement | null = null;
  if (config.zeigePreise) {
    price = el(doc, 'span') as HTMLSpanElement;
    price.id = 'price';
    bottom.append(price);
  }
  bottom.append(el(doc, 'div', 'clear'));
  mount.append(bottom, el(doc, 'hr', 'header-divider'));

  // ── footer ──
  const footer = el(doc, 'div', 'page-footer');
  if (config.zeigeEmail) footer.append(el(doc, 'span', undefined, `E-Mail: ${config.emailAdresse}`));
  if (config.zeigeTelefon) footer.append(el(doc, 'span', undefined, `Telefon: ${config.telefonNummer}`));
  if (config.zeigeCodierungInfo) {
    const a = el(doc, 'a', undefined, 'Informationen zur Codierung') as HTMLAnchorElement;
    a.href = config.codierungInfoUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    footer.append(a);
  }
  const datenschutz = el(doc, 'a', undefined, 'Impressum und Datenschutz') as HTMLAnchorElement;
  datenschutz.href = config.datenschutzUrl;
  datenschutz.target = '_blank';
  datenschutz.rel = 'noopener';
  footer.append(datenschutz);
  mount.append(footer);

  // kleine Versionszeile unterhalb der weißen Karte (body > div#app) —
  // dieselbe Quelle wie die PDF-Fußzeile: __APP_VERSION__
  // (dev = package.json, Release = Git-Tag)
  const versionLine = el(doc, 'div', 'page-version', `codierauftrag V${__APP_VERSION__}`);
  doc.body.append(versionLine);

  return { form, genPdf, price, einBox, einCells, datalistOrt, datalistStrasse };
}
