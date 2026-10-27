/**
 * PDF layout (exact mm coordinates). jsPDF 4.x, A4 portrait, mm units;
 * barcodes rendered by bwip-js in this lazy chunk; client-side download
 * via doc.save.
 */

import { jsPDF } from 'jspdf';
import type { AppConfig } from '../configTypes.js';
import type { FormValues, StreetcodeState } from '../values.js';
import {
  barCodeTextAndLabel,
  einParts,
  einText,
} from '../ein.js';
import { computePrice, formatPrice, formatVatPercent, isTrailer, vatAmounts } from '../values.js';
import { encodeUrl } from '../qr.js';
import { render1DBarcode, renderQrCode } from './barcodes.js';
import type { BarcodeDeps } from './barcodes.js';

const LEFT_X = 9;
const RIGHT_X = 201;
const PAGEWIDTH = RIGHT_X - LEFT_X; // 192
const DATABOX_HEIGHT = 10;
const CHECKBOX_EDGE = 4.5; // Ja/Nein box edge (mm)
/** Data-box row top below a section header (mm). */
const HEADER_ROW_GAP = 6.6;
/** Value-baseline lift inside data boxes (mm). */
const VALUE_LIFT = 1;

const PT_TO_MM = 25.4 / 72;
const CELL_HEIGHT_RATIO = 1.25; // line-box height per font size
const CAP_RATIO = 0.7176; // Helvetica cap height (em)
const DESC_RATIO = 0.207; // Helvetica descender (em)

/** One text line: height, per-font metrics. */
function lineMetrics(fontSizePt: number): { lh: number; cap: number; desc: number } {
  return {
    lh: fontSizePt * CELL_HEIGHT_RATIO * PT_TO_MM,
    cap: fontSizePt * CAP_RATIO * PT_TO_MM,
    desc: fontSizePt * DESC_RATIO * PT_TO_MM,
  };
}

/** 1D barcode: bars band height (mm) inside the 65×19 cell. */
const BARCODE_BAR_H = 15.5;
/** 1D barcode label size (pt) — jsPDF helvetica, drawn by this module. */
const BARCODE_LABEL_SIZE = 8;

export interface PdfInputs {
  values: FormValues;
  state: StreetcodeState;
}

/** Test injection points (production uses real URL/time/version). */
export interface PdfOverrides {
  /** QR code content (defaults to the generated reload URL with fragment) */
  qrUrl?: string;
  /** footer form base URL (defaults to location origin + path) */
  footerUrl?: string;
  /** PDF footer version cell (defaults to __APP_VERSION__) */
  version?: string;
  /** footer timestamp (defaults to now in the configured timezone, d.m.Y H:i:s) */
  timestamp?: string;
  /** logo image data URL (defaults to loading img/ADFC-logo-white.png) */
  logoDataUrl?: string;
  /** fixed "now" for the EIN year + default footer timestamp (tests) */
  now?: Date;
  barcodeDeps?: BarcodeDeps;
}

export function footerTimestamp(zeitzone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: zeitzone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Filename-safe generation stamp `YYYY-MM-DD_HH-MM-SS` in the configured
 * timezone like the footer timestamp.
 */
export function pdfStamp(zeitzone: string, now: Date = new Date()): string {
  const stamp = footerTimestamp(zeitzone, now);
  const [date, time] = stamp.split(' ');
  return `${date.split('.').reverse().join('-')}_${time.replaceAll(':', '-')}`;
}

/**
 * Download file name with the current date and time:
 * `ADFC_Codierauftrag_YYYY-MM-DD_HH-MM-SS.pdf`.
 */
export function pdfFileName(zeitzone: string, now: Date = new Date()): string {
  return `ADFC_Codierauftrag_${pdfStamp(zeitzone, now)}.pdf`;
}

/**
 * PDF metadata title — the same generation stamp as the file name, but with
 * spaces instead of underscores: `ADFC Codierauftrag YYYY-MM-DD HH-MM-SS`.
 */
export function pdfTitle(zeitzone: string, now: Date = new Date()): string {
  return `ADFC Codierauftrag ${pdfStamp(zeitzone, now).replaceAll('_', ' ')}`;
}

export function kaufDatumDisplay(kaufDatum: string): string {
  const m = kaufDatum.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return kaufDatum;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Line height for a font size in points → mm. */
function lineHeightMm(fontSizePt: number): number {
  return fontSizePt * CELL_HEIGHT_RATIO * PT_TO_MM;
}

/** Load the ADFC logo as a data URL (cached). */
let logoCache: string | null = null;
async function loadLogo(override?: string): Promise<string> {
  if (override) return override;
  if (logoCache) return logoCache;
  const res = await fetch('img/ADFC-logo-white.png');
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  logoCache = dataUrl;
  return dataUrl;
}

export interface PdfBuildResult {
  doc: jsPDF;
  /** true when the QR capacity guard fell through to the QR-less page */
  qrOmitted: boolean;
}

/** Build the document (testable — does not download). */
export async function buildPdf(
  config: AppConfig,
  inputs: PdfInputs,
  overrides: PdfOverrides = {},
): Promise<PdfBuildResult> {
  const { values, state } = inputs;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const now = overrides.now ?? new Date();
  doc.setProperties({ title: pdfTitle(config.zeitzone, now), author: config.kreisVerband });

  const parts = einParts(values, state, now);
  const displayedEin = einText(values, state, now);
  const [barcodeContent, barcodeLabel] = barCodeTextAndLabel(values, state, now);
  const bikeOrTrailer = isTrailer(values.typ) ? 'Fahrradanhänger' : 'Fahrrad';
  const bikeOrTrailerGenitive = isTrailer(values.typ) ? 'Fahrradanhängers' : 'Fahrrades';
  const batteryOrEmpty = config.zeigeAkku ? ' (optional auch den Akku)' : '';

  const baseUrl =
    overrides.footerUrl ??
    (typeof location === 'undefined' ? '' : location.origin + location.pathname);
  const qrUrl = overrides.qrUrl ?? encodeUrl(baseUrl, values);
  const version = overrides.version ?? __APP_VERSION__;
  const timestamp = overrides.timestamp ?? footerTimestamp(config.zeitzone, now);
  const logoDataUrl = await loadLogo(overrides.logoDataUrl);

  const qr = renderQrCode(qrUrl, overrides.barcodeDeps);
  let qrOmitted = false;
  if (qr === null) qrOmitted = true; // capacity guard: page without QR image and QR note

  // ── cell/text helpers (valign M = centered; 1 mm left cell padding) ──

  function setFont(size: number, style: 'normal' | 'bold' = 'normal'): void {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
  }

  const PAD = 1; // horizontal cell padding

  /**
   * Cell(w,h,txt,…,align,…,valign) — the text baseline sits at
   *   valign M: y + (effH + cap)/2   (each line centered in a 1.25·fs line box)
   *   valign T: y + cap              (caps at the cell top)
   *   valign B: y + cellH − desc     (descender at the cell bottom)
   * with effH = max(h, 1.25·fs) in mm.
   */
  function cell(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    opts: {
      align?: 'L' | 'C' | 'R';
      border?: boolean;
      fill?: [number, number, number];
      fontSize: number;
      bold?: boolean;
      valign?: 'M' | 'T' | 'B';
      /** mm the valign-'B' baseline is raised inside the cell */
      lift?: number;
    },
  ): void {
    const { lh, cap, desc } = lineMetrics(opts.fontSize);
    const effH = Math.max(h, lh);
    if (opts.border || opts.fill) {
      if (opts.fill) {
        doc.setFillColor(opts.fill[0], opts.fill[1], opts.fill[2]);
      }
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.2);
      doc.rect(x, y, w, h, opts.border ? (opts.fill ? 'FD' : 'S') : 'F');
    }
    if (!text) return;
    setFont(opts.fontSize, opts.bold ? 'bold' : 'normal');
    const tx = opts.align === 'C' ? x + w / 2 : opts.align === 'R' ? x + w - PAD : x + PAD;
    const valign = opts.valign ?? 'M';
    const baseline =
      valign === 'T'
        ? y + cap
        : valign === 'B'
          ? y + Math.max(h, effH) - desc - (opts.lift ?? 0)
          : y + (effH + cap) / 2;
    doc.text(text, tx, baseline, {
      align: opts.align === 'C' ? 'center' : opts.align === 'R' ? 'right' : 'left',
      baseline: 'alphabetic',
    });
  }

  /** Multi-line cell line baseline: each line centered in its 1.25·fs line box. */
  function lineBaseline(lineTopY: number, fontSizePt: number): number {
    const { lh, cap } = lineMetrics(fontSizePt);
    return lineTopY + (lh + cap) / 2;
  }

  /** Justified text: word wrap at width, every line justified except the last. */
  function justifiedText(
    x: number,
    y: number,
    text: string,
    fontSize: number,
    width: number,
    style: 'normal' | 'bold' = 'normal',
  ): number {
    setFont(fontSize, style);
    const lh = lineHeightMm(fontSize);
    const lines = wrapLines(doc, text, width - 2); // horizontal cell padding on both sides
    let cy = y;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== '') {
        const isLast = i === lines.length - 1;
        drawJustifiedLine(doc, x + PAD, lineBaseline(cy, fontSize), line, width - 2, isLast);
      }
      cy += lh;
    }
    return cy - y;
  }

  /** Plain paragraph (left-aligned) at a fixed font size. */
  function plainText(x: number, y: number, text: string, fontSize: number, style: 'normal' | 'bold' = 'normal'): void {
    setFont(fontSize, style);
    doc.text(text, x + PAD, lineBaseline(y, fontSize), { baseline: 'alphabetic' });
  }

  function drawJustifiedLine(
    doc: jsPDF,
    x: number,
    baseline: number,
    line: string,
    maxWidth: number,
    isLast: boolean,
  ): void {
    const words = line.split(' ');
    if (isLast || words.length === 1) {
      doc.text(line, x, baseline, { baseline: 'alphabetic' });
      return;
    }
    // distribute the leftover width over the N−1 inter-word gaps
    const textWidth = doc.getTextWidth(words.join(' '));
    const gaps = words.length - 1;
    const extra = Math.max(0, maxWidth - textWidth) / gaps;
    let cx = x;
    for (const word of words) {
      doc.text(word, cx, baseline, { baseline: 'alphabetic' });
      cx += doc.getTextWidth(word) + doc.getTextWidth(' ') + extra;
    }
  }

  function wrapLines(doc: jsPDF, text: string, maxWidth: number): string[] {
    const paragraphs = text.split('\n');
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
      if (paragraph === '') {
        lines.push('');
        continue;
      }
      let current = '';
      for (const word of paragraph.split(' ')) {
        const candidate = current === '' ? word : current + ' ' + word;
        if (current !== '' && doc.getTextWidth(candidate) > maxWidth) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  function pdfDataBoxHeader(
    y: number,
    header: string,
    boolLabel: string,
    boolValue: boolean,
    second?: { label: string; value: boolean },
  ): void {
    setFont(10, 'bold');
    doc.text(header, LEFT_X + PAD, lineBaseline(y, 10), { baseline: 'alphabetic' });
    if (second) {
      // second Ja/Nein pair left of the right-hand one, with the same
      // box/label rhythm (label cell + 3 → Ja box, + 6 → 'Ja', + 20 → Nein
      // box, + 6 → 'Nein'); the cell at x=56 leaves ~10 mm air between the
      // 'Nein' label and the right-hand pair's label
      const secondX = 56; // 30 mm label cell
      doc.text(second.label, secondX + 30 - PAD, lineBaseline(y, 10), { align: 'right', baseline: 'alphabetic' });
      cell(secondX + 33, y, CHECKBOX_EDGE, CHECKBOX_EDGE, second.value ? 'X' : '', { align: 'C', border: true, fontSize: 10 });
      setFont(10, 'normal');
      doc.text('Ja', secondX + 39, lineBaseline(y, 10), { baseline: 'alphabetic' });
      cell(secondX + 53, y, CHECKBOX_EDGE, CHECKBOX_EDGE, second.value ? '' : 'X', { align: 'C', border: true, fontSize: 10 });
      doc.text('Nein', secondX + 59, lineBaseline(y, 10), { baseline: 'alphabetic' });
      setFont(10, 'bold');
    }
    // right-aligned within a 30 mm MultiCell at x=130 (padding 1 mm)
    doc.text(boolLabel, 130 + 30 - PAD, lineBaseline(y, 10), { align: 'right', baseline: 'alphabetic' });
    // Ja/Nein boxes (y..y+4.5, centered on the label line); the extra
    // header-row gap keeps them clear of the data boxes.
    cell(163, y, CHECKBOX_EDGE, CHECKBOX_EDGE, boolValue ? 'X' : '', { align: 'C', border: true, fontSize: 10 });
    setFont(10, 'normal');
    doc.text('Ja', 168 + PAD, lineBaseline(y, 10), { baseline: 'alphabetic' });
    cell(183, y, CHECKBOX_EDGE, CHECKBOX_EDGE, boolValue ? '' : 'X', { align: 'C', border: true, fontSize: 10 });
    doc.text('Nein', 188 + PAD, lineBaseline(y, 10), { baseline: 'alphabetic' });
    // extra gap below the header row before the data boxes
    cursor = { x: LEFT_X, y: y + HEADER_ROW_GAP };
  }

  function pdfDataBox(width: number, label: string, value: string): void {
    let x = cursor.x;
    let y = cursor.y;
    if (x + width > RIGHT_X + 0.5) {
      x = LEFT_X;
      y += DATABOX_HEIGHT;
    }
    // label: 8 pt, valign 'T' at (x, y+0.7) — +0.51 mm line-box offset: the
    // line box sits below the cell top, the caps at +0.7+cap+0.51
    const labelMetrics = lineMetrics(8);
    setFont(8, 'normal');
    doc.text(label, x + PAD, y + 0.7 + labelMetrics.cap + 0.51, { baseline: 'alphabetic' });
    // char-based truncation to fit the box
    let text = value;
    setFont(11, 'normal');
    while (text && doc.getTextWidth(text) > width - 1) text = text.slice(0, -1);
    // value baseline lifted 1 mm off the box bottom
    cell(x, y, width, DATABOX_HEIGHT, text, {
      align: 'L',
      border: true,
      fontSize: 11,
      valign: 'B',
      lift: VALUE_LIFT,
    });
    cursor = { x: x + width, y };
  }

  let firstPageDrawn = false;
  function page(copyText: string, optimalLogoFontSize: number): void {
    // jsPDF starts with an empty page 1. The first page() call draws on the
    // existing page, later calls add new ones.
    if (firstPageDrawn) {
      doc.addPage(undefined, 'portrait');
    }
    firstPageDrawn = true;

    // CODIERAUFTRAG box (first cell lands at the 10 mm margins)
    cell(10, 10, 72, 13, 'CODIERAUFTRAG', { align: 'C', border: true, fontSize: 18, bold: true });
    if (copyText) {
      cell(10, 23, 72, 8, copyText, {
        align: 'C',
        border: true,
        fill: [238, 127, 0],
        fontSize: 11,
        bold: true,
      });
    }

    if (displayedEin !== barcodeLabel) {
      setFont(10, 'normal');
      doc.setTextColor(255, 0, 0);
      doc.text('Umlaute und/oder Akzente im Code!', 10 + PAD, lineBaseline(34, 10), { baseline: 'alphabetic' });
      doc.setTextColor(0, 0, 0);
    }

    // EIN value row at y=40 (values above, labels below — do not swap)
    cell(10, 40, 13, 7, parts.kz, { align: 'C', border: true, fontSize: 12 });
    cell(23, 40, 12, 7, parts.subCode, { align: 'C', border: true, fontSize: 12 });
    cell(35, 40, 16, 7, parts.str, { align: 'C', border: true, fontSize: 12 });
    cell(51, 40, 12, 7, parts.hs, { align: 'C', border: true, fontSize: 12 });
    cell(63, 40, 10, 7, parts.ini, { align: 'C', border: true, fontSize: 12 });
    if (config.inklusiveJahr) {
      cell(73, 40, 9, 7, parts.jahr ?? '', { align: 'C', border: true, fontSize: 12 });
    }
    // label row below at y=47 (gray fill, 5 mm cells)
    const labels: Array<[string, number]> = [
      ['Kennz', 13],
      ['AGS', 12],
      ['Straße', 16],
      ['HNr', 12],
      ['Ini', 10],
    ];
    if (config.inklusiveJahr) labels.push(['Jahr', 9]);
    let lx = 10;
    for (const [label, w] of labels) {
      cell(lx, 47, w, 5, label, { align: 'C', border: true, fill: [192, 192, 192], fontSize: 7 });
      lx += w;
    }

    // QR note (verbatim) + QR code — both omitted when the capacity guard falls through
    if (!qrOmitted) {
      justifiedText(
        LEFT_X,
        55,
        'Zum erneuten Aufruf der Website, ohne die Daten neu eingeben zu müssen: QR-Code® scannen. Dieser enthält alle Daten, ohne dass sie auf der Website gespeichert werden.',
        6,
        72,
      );
      // the padded canvas (symbol + 4-module quiet zone) fills the 51×51 cell;
      // the quiet zone becomes 4·51/(n+8) ≈ 2.4 mm
      doc.addImage(qr!.dataUrl, 'PNG', 85, 10, 51, 51);
      // black frame around the QR cell (stroked rect, lw 0.2)
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.2);
      doc.rect(85, 10, 51, 51);
    }

    // logo image at (140,12) height 22; logo text at (163,25), fitted to 35 mm
    doc.addImage(logoDataUrl, 'PNG', 140, 12, 58.588, 22);
    setFont(optimalLogoFontSize, 'normal');
    doc.setTextColor(15, 75, 124);
    // Cell(35, 8, logoText) at (163,25) — valign M, single line
    const logoMetrics = lineMetrics(optimalLogoFontSize);
    doc.text(config.logoText, 163 + PAD, 25 + (Math.max(8, logoMetrics.lh) + logoMetrics.cap) / 2, {
      baseline: 'alphabetic',
    });
    doc.setTextColor(0, 0, 0);

    // 1D barcode at (140.5,42), cell 65×19: the oversampled PNG scales into the
    // cell; the bars band ends flush with the QR frame bottom (y=61) and the
    // cell is horizontally centered between the QR frame right edge (x=136)
    // and the page edge (x=210) → 4.5 mm margin on each side.
    // bwip-js renders the bars only; the label is drawn by jsPDF in the PDF's
    // own font (helvetica 8) — bwip-js cannot use it: its text engine knows the
    // built-in OCR fonts or a TTF registered via loadFont, while jsPDF's
    // helvetica is a base-14 PDF font with no font file.
    const barcodeDataUrl = render1DBarcode(config, barcodeContent, overrides.barcodeDeps);
    doc.addImage(barcodeDataUrl, 'PNG', 140.5, 42, 65, BARCODE_BAR_H);
    // label: helvetica 8, justified across the 65 mm cell:
    // gaps = (width − textWidth) / (chars − 1)
    setFont(BARCODE_LABEL_SIZE);
    const labelChars = [...barcodeContent];
    const charWidths = labelChars.map((ch) => doc.getTextWidth(ch));
    const labelTextWidth = charWidths.reduce((sum, w) => sum + w, 0);
    const labelGap =
      labelChars.length > 1 ? (65 - labelTextWidth) / (labelChars.length - 1) : 0;
    let labelX =
      labelChars.length > 1 ? 140.5 : 140.5 + (65 - labelTextWidth) / 2;
    const labelBaseline = lineBaseline(42 + BARCODE_BAR_H, BARCODE_LABEL_SIZE);
    for (let i = 0; i < labelChars.length; i++) {
      if (labelChars[i] !== ' ') {
        doc.text(labelChars[i], labelX, labelBaseline, { baseline: 'alphabetic' });
      }
      labelX += charWidths[i] + labelGap;
    }

    // order text + contract sentence
    plainText(LEFT_X, 67, `Auftrag zur ${bikeOrTrailer}codierung`, 14, 'bold');
    justifiedText(
      LEFT_X,
      74,
      'Hiermit beauftrage ich den Allgemeinen Deutschen Fahrrad-Club (ADFC), ' +
        config.kreisVerband +
        ', den Rahmen meines ' +
        bikeOrTrailerGenitive +
        batteryOrEmpty +
        ' mit einer persönlichen Codenummer zu versehen.',
      10,
      PAGEWIDTH,
    );

    // owner / bicycle / purchase sections
    pdfDataBoxHeader(88, 'Eigentümer*in:', 'ADFC-Mitglied:', values.mitglied);
    pdfDataBox(PAGEWIDTH, 'Nachname, Vorname:', `${values.nachname}, ${values.vorname}`);
    pdfDataBox(PAGEWIDTH, 'Anschrift:', `${values.strasse} ${values.hausnr}, ${values.ort}`);
    pdfDataBoxHeader(118, `${bikeOrTrailer}:`, 'Pedelec/E-Bike:', values.ebike, {
      label: 'Carbon-Rahmen:',
      value: values.carbonRahmen,
    });
    pdfDataBox(PAGEWIDTH * 0.28, 'Marke:', values.marke);
    pdfDataBox(PAGEWIDTH * 0.28, 'Modell:', values.modell);
    pdfDataBox(PAGEWIDTH * 0.22, 'Farbe:', values.farbe);
    pdfDataBox(PAGEWIDTH * 0.22, 'Typ:', values.typ);
    pdfDataBox(PAGEWIDTH * 0.28, 'Bauart:', values.art);
    pdfDataBox(
      PAGEWIDTH * 0.47,
      'Rahmennummer (Anbringung):',
      values.rahmenNr + (values.nrPos ? ` (${values.nrPos})` : ''),
    );
    pdfDataBox(
      PAGEWIDTH * 0.25,
      'Schaltung:',
      (values.anzGaenge ? `${values.anzGaenge} Gang ` : '') + values.schaltung,
    );
    pdfDataBoxHeader(148, 'Erwerb:', 'Kaufbeleg:', values.beleg);
    pdfDataBox(PAGEWIDTH * 0.4, 'Verkäufer:', values.verkaeufer);
    pdfDataBox(PAGEWIDTH * 0.45, 'Ort:', values.kaufOrt);
    pdfDataBox(PAGEWIDTH * 0.15, 'Datum:', kaufDatumDisplay(values.kaufDatum));

    // legal texts (verbatim — including the double space after "dass")
    justifiedText(
      LEFT_X,
      179,
      `Ich versichere, dass  das von mir zur Codierung gebrachte ${bikeOrTrailer} mein Eigentum ist. Ich bin damit einverstanden, dass mein ${bikeOrTrailer} durch den ADFC codiert wird. Obige Daten sind korrekt erfasst.`,
      10,
      100,
    );
    if (copyText) {
      justifiedText(
        LEFT_X,
        201,
        'Ich stimme zu, dass meine Daten in diesem Formular zur Erfüllung gesetzlicher Fristen ( § 257 HGB, § 147 AO etc.) 10 Jahre aufbewahrt und nach Ablauf dieser Frist ordnungsgemäß vernichtet werden. Die Daten werden nicht für andere Zwecke verwendet.',
        10,
        100,
      );
    }

    // signature lines (top-bordered cells at y=264)
    setFont(8, 'normal');
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.line(9, 264, 45, 264);
    doc.line(45, 264, 113, 264);
    doc.line(120, 264, RIGHT_X, 264);
    doc.text('Ort, Datum', 9 + PAD, lineBaseline(264, 8), { baseline: 'alphabetic' });
    doc.text('Unterschrift Kundin/Kunde', 45 + PAD, lineBaseline(264, 8), { baseline: 'alphabetic' });
    doc.text('Unterschrift/Stempel ADFC', 120 + PAD, lineBaseline(264, 8), { baseline: 'alphabetic' });

    // fee block at (122,181), frame drawn separately at (122,180)
    const { price, descr } = computePrice(values);
    const feeLines: string[] = config.zeigePreise
      ? [`Gebühr: ${formatPrice(price)} €`, `für Codierung von ${descr}`, ...vatLines(config, price)]
      : [`Codierung von ${descr}`];
    setFont(12, 'normal');
    // long descr lines (e.g. Fahrrad (Carbon) + Akku) wrap at the frame width
    // — the frame height below grows with the wrapped line count
    const feeWidth = RIGHT_X - 122 - 2 * PAD;
    const drawnLines = feeLines.flatMap((line) => doc.splitTextToSize(line, feeWidth));
    const feeHeight = drawnLines.length * lineHeightMm(12);
    const frameHeight = Math.max(12, feeHeight + 1);
    // unwrapped blocks keep the text start at y=181; a wrapped block is
    // vertically centered in the frame so the margin above 'Gebühr:' matches
    // the margin below the last line
    let fy = drawnLines.length > feeLines.length ? 180 + (frameHeight - feeHeight) / 2 : 181;
    for (const line of drawnLines) {
      doc.text(line, 122 + PAD, lineBaseline(fy, 12), { baseline: 'alphabetic' });
      fy += lineHeightMm(12);
    }
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.rect(122, 180, RIGHT_X - 122, frameHeight);

    // payment box (prices AND (bar OR card))
    let idCheckPos: number;
    if (config.zeigePreise && (config.zeigeBarzahlung || config.zeigeKartenzahlung)) {
      const both = config.zeigeBarzahlung && config.zeigeKartenzahlung;
      doc.rect(122, 205, RIGHT_X - 122, both ? 18 : 12);
      setFont(12, 'normal');
      doc.text('Betrag erhalten durch', 122 + PAD, lineBaseline(205.5, 12), { baseline: 'alphabetic' });
      let zahlartY = 213.8;
      if (config.zeigeBarzahlung) {
        doc.circle(126, zahlartY, 2);
        doc.text('Barzahlung', 129 + PAD, lineBaseline(zahlartY - 2.8, 12), { baseline: 'alphabetic' });
        zahlartY = 218.8;
      }
      if (config.zeigeKartenzahlung) {
        doc.circle(126, zahlartY, 2);
        doc.text('Kartenzahlung', 129 + PAD, lineBaseline(zahlartY - 2.8, 12), { baseline: 'alphabetic' });
      }
      idCheckPos = both ? 226 : 220;
    } else {
      idCheckPos = 205;
    }
    // ID check + proof-of-ownership check share one 16 mm frame — the rows sit
    // where the two separate 8 mm boxes were, without the dividing line
    doc.rect(122, idCheckPos, RIGHT_X - 122, 16);
    doc.text('Ausweis überprüft', 129 + PAD, lineBaseline(idCheckPos + 1, 12), { baseline: 'alphabetic' });
    doc.circle(126, idCheckPos + 3.8, 2);
    doc.text('Eigentumsnachweis überprüft', 129 + PAD, lineBaseline(idCheckPos + 9, 12), {
      baseline: 'alphabetic',
    });
    doc.circle(126, idCheckPos + 11.8, 2);

    // footer (bordered 5 mm cells, centered)
    setFont(6, 'normal');
    const footerCells: Array<[string, number]> = [
      [`codierauftrag V${version}`, PAGEWIDTH * 0.12],
      [config.kreisVerband, PAGEWIDTH * 0.15],
      [config.kvWebUrl, PAGEWIDTH * 0.23],
      [baseUrl, PAGEWIDTH * 0.38],
      [timestamp, PAGEWIDTH * 0.12],
    ];
    let fx = LEFT_X;
    for (const [text, w] of footerCells) {
      cell(fx, 270, w, 5, text, { align: 'C', border: true, fontSize: 6 });
      fx += w;
    }
  }

  let cursor = { x: LEFT_X, y: 0 };

  const optimalLogoFontSize = optimizeFontsize(doc, config.logoText, 35, 0.5, 6, 20);

  if (config.pdfNurEineSeite) {
    page('', optimalLogoFontSize);
  } else {
    page('Ausfertigung ADFC', optimalLogoFontSize);
    page('Ausfertigung Kundin/Kunde', optimalLogoFontSize);
  }

  return { doc, qrOmitted };
}

/** VAT info lines for the fee block (empty when VAT off). */
function vatLines(config: AppConfig, gross: number): string[] {
  if (!config.zeigeUmsatzsteuer) return [];
  const { steuer, netto } = vatAmounts(gross, config.umsatzsteuerProzent);
  return [
    `MwSt: ${formatVatPercent(config.umsatzsteuerProzent)}%, Steuerbetrag: ${formatPrice(steuer)} €`,
    `Nettobetrag: ${formatPrice(netto)} €`,
  ];
}

/** Fit a text into targetWidth via a helvetica-metrics binary search. */
export function optimizeFontsize(
  doc: jsPDF,
  text: string,
  targetWidth = 35,
  tol = 0.5,
  min = 6,
  max = 20,
): number {
  doc.setFont('helvetica', 'normal');
  if (textWidthAt(doc, text, min) >= targetWidth - tol) return min;
  if (textWidthAt(doc, text, max) <= targetWidth + tol) return max;
  let lo = min;
  let hi = max;
  let pivot = max;
  let w = 0;
  do {
    pivot = (lo + hi) / 2;
    w = textWidthAt(doc, text, pivot);
    if (w > targetWidth) hi = pivot;
    else lo = pivot;
  } while (Math.abs(w - targetWidth) > tol && hi - lo > 0.25);
  return pivot;
}

function textWidthAt(doc: jsPDF, text: string, fontSize: number): number {
  const previous = doc.getFontSize();
  doc.setFontSize(fontSize);
  const width = doc.getTextWidth(text);
  doc.setFontSize(previous);
  return width;
}

/** Production entry: build + client-side download. */
export async function generatePdf(config: AppConfig, inputs: PdfInputs): Promise<boolean> {
  const now = new Date(); // one stamp for the metadata title and the file name
  const { doc, qrOmitted } = await buildPdf(config, inputs, { now });
  doc.save(pdfFileName(config.zeitzone, now));
  return qrOmitted;
}
