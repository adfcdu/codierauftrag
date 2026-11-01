/**
 * Page builders — header, instructions, checklist, form, EIN box, price line,
 * footer. All user-facing texts verbatim. Safe DOM APIs only — no innerHTML
 * with data.
 */

import type { AppConfig } from '../configTypes.js';
import { attachCombobox, syncComboArrows } from './combobox.js';

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
    date?: boolean;
  },
): HTMLDivElement {
  const wrap = el(doc, 'div', 'input-text');
  const label = el(doc, 'label', opts.required ? 'required' : undefined, opts.label) as HTMLLabelElement;
  wrap.append(label);
  const input = el(doc, 'input') as HTMLInputElement;
  input.id = opts.id;
  input.name = opts.id;
  if (opts.required) input.required = true;
  if (opts.maxlength !== undefined) input.maxLength = opts.maxlength;
  // data-list statt list: das Datalist bleibt reine Datenquelle für die
  // eigene Combobox (combobox.ts) — ohne list-Attribut rendert kein Browser
  // seine native Datalist-UI (Chromium-Pfeil/Popup, Safari)
  if (opts.list) input.dataset.list = opts.list;
  if (opts.date) {
    input.type = 'date';
    input.min = '1950-01-01';
  } else {
    input.type = 'text';
  }
  if (opts.list) {
    // Eigene Combobox (combobox.ts): Pfeil IM Feld, eine gemeinsame Liste
    // für Tippen (Filter) und Pfeil-Klick (alle Werte)
    const combo = el(doc, 'div', 'combo');
    combo.append(input);
    wrap.append(combo);
    attachCombobox(doc, input);
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

/** Zeilenanfang im Formular-Raster: zwingt das Feld in Spalte 1 einer neuen
 *  Grid-Zeile (ersetzt die früheren div.break-Elemente — der row-gap im CSS
 *  liefert den einheitlichen Zeilenabstand). */
function rowStart<T extends HTMLElement>(node: T): T {
  node.classList.add('row-start');
  return node;
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
  // Banner im Stil der Hauptwebsite: blaues Band mit Titel + Intro.
  // Intro bleibt klassenlos (EasyList-Absicherung), Note via
  // `.header-text > p:first-of-type` strukturell — intakte Reihenfolge:
  // Banner (h2+intro) zuerst, danach der Datenschutz-Hinweis.
  // Banner im Stil der Hauptwebsite: blaues Band enthält NUR die Überschrift.
  // Intro, CTA und Datenschutz-Hinweis liegen darunter in einem hellgrauen
  // Kasten (div.header-info) — wie der Kontaktkasten auf der Hauptwebsite.
  const banner = el(doc, 'div', 'header-banner');
  banner.append(el(doc, 'h2', undefined, 'Fahrrad-/Anhänger-Codierauftrag'));
  headerText.append(banner);
  const infoBox = el(doc, 'div', 'header-info');
  const intro = el(doc, 'p');
  intro.append(
    doc.createTextNode(
      'Auf dieser Website können Sie Ihre Daten für die Codierung Ihres Fahrrades oder Fahrradanhängers erfassen und ausdrucken. Das spart Zeit beim Codierungstermin.',
    ),
  );
  infoBox.append(intro);
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
  // Datenschutz-Hinweis über dem CTA — der Button schließt den Kasten ab
  infoBox.append(privacyNote);
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
    infoBox.append(p);
  }
  headerText.append(infoBox);
  header.append(logo, headerText);
  mount.append(header);

  // ── Hinweis-Banner (BANNER_1_TEXT / BANNER_2_TEXT, optional BANNER_1_URL / BANNER_2_URL) ──
  // Zwischen Header und erstem Trennstrich; leerer Text = ausgeblendet.
  // Text als textContent — kein innerHTML mit Konfigurationsdaten.
  const nonEmptyBanners = [
    { text: config.banner1Text, url: config.banner1Url },
    { text: config.banner2Text, url: config.banner2Url },
  ].filter((b) => b.text !== '');
  if (nonEmptyBanners.length > 0) {
    const banners = el(doc, 'div', 'page-banners');
    for (const banner of nonEmptyBanners) {
      const box = el(doc, 'div', 'page-banner');
      if (banner.url !== '') {
        const a = el(doc, 'a', 'page-banner-link', banner.text);
        a.href = banner.url;
        a.target = '_blank';
        a.rel = 'noopener';
        box.append(a);
      } else {
        box.append(doc.createTextNode(banner.text));
      }
      banners.append(box);
    }
    mount.append(banners);
  }

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
    p.append(doc.createTextNode('Einen Termin (im Infoladen) buchen: '));
    const a = el(doc, 'a', 'btn') as HTMLAnchorElement;
    a.href = config.codierungBuchenUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.append(
      (() => {
        const s = el(doc, 'span', 'btn-text', 'Zur Buchung');
        return s;
      })(),
      // gleicher Pfeil wie der Codierung-Info-Link (CSS \2192)
      el(doc, 'span', 'btn-arrow', '\u2192'),
    );
    p.append(a);
    steps.append(step(stepIcon('icon-calendar-booking', 'Termin buchen'), p));
  }
  steps.append(
    step(
      stepIcon('icon-keyboard', 'Tastatur'),
      el(doc, 'p', undefined, 'Dieses Formular möglichst vollständig ausfüllen'),
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
    printP.append(el(doc, 'em', undefined, '(auf zwei Blätter)'));
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
  mount.append(instructions);

  // ── form ──
  // Dreispaltiges Raster (coding.css: form als Grid mit repeat(3, 1fr)):
  // Jedes Feld und jeder Toggle belegt genau eine Spalte in voller
  // Zellenbreite — alle Zellen gleich breit und spaltenweise ausgerichtet.
  // Zeilen, die einer unvollständigen Zeile folgen, beginnen mit
  // rowStart(...) in Spalte 1; die h2-Überschriften spannen alle drei
  // Spalten. Der row-gap im CSS hält den Zeilenabstand gleichmäßig.
  const form = el(doc, 'form') as HTMLFormElement;
  form.id = 'form'; // purely structural — no action, no method: the form never submits
  const anzGaenge = textField(doc, { id: 'anzGaenge', label: 'Anz. Gänge' });
  const anzGaengeInput = anzGaenge.querySelector('input') as HTMLInputElement;
  anzGaengeInput.type = 'number';
  anzGaengeInput.min = '0';
  anzGaengeInput.max = '36';
  // Kopfzeile: Überschrift links, Pflichtfeld-Legende rechts — als eigene
  // volle Rasterzeile, damit Legende und Überschrift garantiert gemeinsam
  // in einer Zeile liegen (siehe .form-head im CSS)
  const formHead = el(doc, 'div', 'form-head');
  formHead.append(el(doc, 'h2', undefined, 'Eigentümer*in'), el(doc, 'span', 'required-note', '* = Pflichtfeld'));
  form.append(formHead);
  form.append(
    textField(doc, { id: 'vorname', label: 'Vorname(n)', required: true, maxlength: MAX_LENGTHS['vorname']! }),
    textField(doc, { id: 'nachname', label: 'Nachname', required: true, maxlength: MAX_LENGTHS['nachname']! }),
    checkboxField(doc, 'mitglied', 'ADFC-Mitglied'),
    textField(doc, { id: 'ort', label: 'Ort', required: true, maxlength: MAX_LENGTHS['ort']!, list: 'dl-ort' }),
    textField(doc, { id: 'strasse', label: 'Straße', required: true, maxlength: MAX_LENGTHS['strasse']!, list: 'dl-strasse' }),
    textField(doc, { id: 'hausnr', label: 'Hausnr.', required: true, maxlength: MAX_LENGTHS['hausnr']! }),
    el(doc, 'h2', 'section-divider', 'Fahrrad/Anhänger'),
    // Toggle-Zeile direkt unter der Überschrift: Carbon-Rahmen | Pedelec/E-Bike | Akku codieren
    ...(config.zeigeCarbonRahmen ? [checkboxField(doc, 'carbonRahmen', 'Carbon-Rahmen')] : []),
    checkboxField(doc, 'ebike', 'Pedelec/E-Bike'),
    ...(config.zeigeAkku ? [checkboxField(doc, 'akku', 'Akku codieren')] : []),
    // Zeile: Marke | Modell | Farbe (row-start: Toggle-Zeile kann unvollständig sein)
    rowStart(textField(doc, { id: 'marke', label: 'Marke', maxlength: MAX_LENGTHS['marke']! })),
    textField(doc, { id: 'modell', label: 'Modell', maxlength: MAX_LENGTHS['modell']! }),
    textField(doc, { id: 'farbe', label: 'Farbe', maxlength: MAX_LENGTHS['farbe']! }),
    // Zeile: Radtyp | Radart (füllt die Zeile nach einer vollen Zeile von selbst)
    textField(doc, { id: 'typ', label: 'Radtyp (bzw. Anhänger)', maxlength: MAX_LENGTHS['typ']!, list: 'dl-typ' }),
    textField(doc, { id: 'art', label: 'Radart', maxlength: MAX_LENGTHS['art']!, list: 'dl-art' }),
    // Eigene Zeile: Schaltung | Anz. Gänge (row-start: Radtyp-Zeile hat nur 2 Felder)
    rowStart(textField(doc, { id: 'schaltung', label: 'Schaltung', maxlength: MAX_LENGTHS['schaltung']!, list: 'dl-schaltung' })),
    anzGaenge,
    // Zeile: Rahmennummer | Position Rahmennummer | Kaufdatum
    // (row-start: Schaltung-Zeile hat nur 2 Felder)
    rowStart(textField(doc, { id: 'rahmenNr', label: 'Rahmennummer', maxlength: MAX_LENGTHS['rahmenNr']! })),
    textField(doc, { id: 'nrPos', label: 'Position Rahmennummer', maxlength: MAX_LENGTHS['nrPos']!, list: 'dl-nrpos' }),
    (() => {
      const field = textField(doc, { id: 'kaufDatum', label: 'Kaufdatum', date: true });
      field.classList.remove('input-text');
      field.classList.add('input-date');
      (field.querySelector('input') as HTMLInputElement).max = todayYmd(config.zeitzone);
      return field;
    })(),
    // Zeile: Verkäufer | Kaufort | Kaufbeleg vorh. (folgt auf eine volle Zeile)
    textField(doc, { id: 'verkaeufer', label: 'Verkäufer', maxlength: MAX_LENGTHS['verkaeufer']! }),
    textField(doc, { id: 'kaufOrt', label: 'Kaufort', maxlength: MAX_LENGTHS['kaufOrt']! }),
    checkboxField(doc, 'beleg', 'Kaufbeleg vorh.'),
  );

  const genPdf = el(doc, 'button') as HTMLButtonElement;
  genPdf.id = 'genPdf';
  genPdf.type = 'button';
  genPdf.disabled = true;
  genPdf.textContent = 'PDF erzeugen';
  form.append(genPdf);
  // Karte um das Formular — gleiche Optik wie die Header-Text-Karte:
  // blaues Banner (Klasse .header-banner, gemeinsames Styling) über dem
  // hellgrauen Formularkörper (.form-card + form im CSS).
  const formCard = el(doc, 'div', 'form-card');
  const formBanner = el(doc, 'div', 'header-banner');
  formBanner.append(el(doc, 'h2', undefined, 'Codierauftrag ausfüllen'));
  formCard.append(formBanner, form);
  mount.append(formCard);

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
  // Optik nach dem echten Codier-Aufkleber: orangefarbene Karte mit weißem
  // 'adfc' (Platzhalter bis das weiße Logo-Bild kommt) und dem Claim
  // 'RAD IST CODIERT', darunter die EIN als schwarze Zeichen auf
  // silbergrauem Streifen (Punkt-Schrift folgt später — Default-Font).
  const einBox = el(doc, 'div', 'ein-box');
  // weißes ADFC-Logo (295×115) statt Text-Platzhalter
  const einLogo = el(doc, 'img', 'ein-logo') as HTMLImageElement;
  einLogo.src = 'img/adfc.png';
  einLogo.alt = 'ADFC';
  // Claim + Gravurstreifen in einem gemeinsamen Wrapper: rechte Kanten
  // bündig, der sitzt direkt über dem Streifen (wie auf dem Aufkleber)
  const einBody = el(doc, 'div', 'ein-body');
  einBody.append(el(doc, 'span', 'ein-claim', 'RAD IST CODIERT'));
  const einStrip = el(doc, 'div', 'ein-strip');
  // URL-Zeile wie auf dem echten Aufkleber, unten rechts
  const einUrl = el(doc, 'span', 'ein-url', 'www.adfc.de/code');
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
  einStrip.append(table);
  einBody.append(einStrip);
  einBox.append(einLogo, einBody, einUrl);
  einBox.style.display = 'none';
  // EIN-Box in die Formular-Karte, unter dem Eigentümer*-in-Abschnitt
  // (vor dem Fahrrad/Anhänger-Trenner): die EIN setzt sich aus genau den
  // dort eingetragenen Daten zusammen — Resultat direkt am Ursprung.
  const divider = form.querySelector('h2.section-divider') as HTMLHeadingElement;
  form.insertBefore(einBox, divider);

  let price: HTMLSpanElement | null = null;
  if (config.zeigePreise) {
    // Preis in eigener blauer Leiste (Farbband wie das Header-Banner) —
    // hebt die Zeile auch im Initialzustand (ohne EIN-Tabelle) klar vom
    // Footer ab
    const priceBar = el(doc, 'div', 'price-bar');
    price = el(doc, 'span') as HTMLSpanElement;
    price.id = 'price';
    priceBar.append(price);
    mount.append(priceBar);
  }

  // ── footer ──
  const footer = el(doc, 'div', 'page-footer');
  if (config.zeigeEmail && config.emailAdresse !== '') {
    const mail = el(doc, 'span') as HTMLSpanElement;
    mail.append('E-Mail: ');
    const a = el(doc, 'a', undefined, config.emailAdresse) as HTMLAnchorElement;
    a.href = `mailto:${config.emailAdresse}`;
    mail.append(a);
    footer.append(mail);
  }
  if (config.zeigeTelefon && config.telefonNummer !== '') {
    const tel = el(doc, 'span') as HTMLSpanElement;
    tel.append('Telefon: ');
    const a = el(doc, 'a', undefined, config.telefonNummer) as HTMLAnchorElement;
    // tel:-URI ohne Leerzeichen; Anzeige bleibt mit, wie konfiguriert
    a.href = `tel:${config.telefonNummer.replace(/\s+/g, '')}`;
    tel.append(a);
    footer.append(tel);
  }
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

  // kleine Versionszeile im grauen Footer-Band (wie die Hauptwebsite) —
  // dieselbe Quelle wie die PDF-Fußzeile: __APP_VERSION__
  // (dev = package.json, Release = Git-Tag)
  const versionLine = el(doc, 'div', 'page-version', `codierauftrag V${__APP_VERSION__}`);
  footer.append(versionLine);

  return { form, genPdf, price, einBox, einCells, datalistOrt, datalistStrasse };
}
