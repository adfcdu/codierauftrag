/**
 * DOM wiring helpers: datalist building, busy states, price line, EIN box,
 * genPdf gate, message display, logo auto-fit.
 */

import { einParts, isEinValid } from '../ein.js';
import { anyValidationErrors, priceLineText } from '../values.js';
import type { FormValues, StreetcodeState } from '../values.js';
import type { BuiltPage } from './page.js';

export function buildDatalist(
  dl: HTMLDataListElement,
  entries: Array<{ value: string; label?: string }>,
): void {
  dl.replaceChildren();
  for (const entry of entries) {
    const opt = dl.ownerDocument.createElement('option');
    opt.value = entry.value;
    if (entry.label !== undefined) opt.label = entry.label;
    dl.append(opt);
  }
  // Klick-Pfeil (combobox.ts) nur anzeigen, solange Vorschläge existieren
  const linkedInput = dl.ownerDocument.querySelector<HTMLInputElement>(`input[list="${dl.id}"]`);
  const arrow = linkedInput?.closest('.input-text')?.querySelector('button.combo-arrow');
  arrow?.toggleAttribute('hidden', entries.length === 0);
}

function fieldContainer(doc: Document, id: string): HTMLElement {
  return doc.getElementById(id)?.closest('.input-text, .input-date, .input-check') as HTMLElement;
}

/** Show/remove the red validation message below the field (or hide it while busy). */
export function showMessage(doc: Document, fieldId: string, msg: string | false): void {
  const container = fieldContainer(doc, fieldId);
  if (!container) return;
  const existing = container.querySelector(':scope > .validation-msg');
  if (msg === false) {
    existing?.remove();
    return;
  }
  const p = (existing ?? doc.createElement('p')) as HTMLParagraphElement;
  p.className = 'validation-msg';
  p.textContent = msg;
  if (!existing) container.append(p);
}

/** Busy indicator on Ort/Straße while a resolution is in flight. */
export function setBusy(doc: Document, fieldId: 'ort' | 'strasse', busy: boolean): void {
  const container = fieldContainer(doc, fieldId);
  container?.classList.toggle('busy', busy);
}

/** Live price line — no-op when zeigePreise=false (element absent). */
export function updatePriceLine(page: BuiltPage, values: FormValues): void {
  if (!page.price) return;
  page.price.textContent = priceLineText(values);
}

/** EIN box: visible iff isEinValid; values raw (umlauts untranslated). */
export function updateEinBox(page: BuiltPage, values: FormValues, state: StreetcodeState): void {
  const valid = isEinValid(values, state);
  page.einBox.style.display = valid ? '' : 'none';
  if (!valid) return;
  const parts = einParts(values, state);
  page.einCells['kz'].textContent = parts.kz;
  page.einCells['ags'].textContent = parts.subCode;
  page.einCells['str'].textContent = parts.str;
  page.einCells['hs'].textContent = parts.hs;
  page.einCells['ini'].textContent = parts.ini;
  if (parts.jahr !== undefined) page.einCells['jahr'].textContent = parts.jahr;
}

/** genPdf gating — computed live on every input event. */
export function genPdfEnabled(values: FormValues, state: StreetcodeState): boolean {
  return Boolean(
    isEinValid(values, state) &&
      state.city?.plateCode &&
      state.city?.subCode &&
      state.street?.code &&
      !state.inFlight &&
      !anyValidationErrors(values, state),
  );
}

export function updateGenPdfGate(page: BuiltPage, values: FormValues, state: StreetcodeState): void {
  page.genPdf.disabled = !genPdfEnabled(values, state);
}

/** Logo auto-fit: canvas-measure binary search, 8–60 px, 0.85 × logoText width.
 *  Long names wrap at spaces and after hyphens into up to LOGO_MAX_LINES
 *  balanced lines instead of shrinking below LOGO_WRAP_MIN_PX (breaks
 *  rendered via white-space: pre-line). */
export const LOGO_FIT_FACTOR = 0.85;
export const LOGO_WRAP_MIN_PX = 30;
export const LOGO_MAX_LINES = 3;

export function getTextSizeForWidth(text: string, targetWidth: number): number {
  const minFontPx = 8;
  const maxFontPx = 60;
  const getTextWidth = (size: number): number => measureTextWidth(text, size);

  if (getTextWidth(maxFontPx) <= targetWidth) return maxFontPx;
  if (getTextWidth(minFontPx) >= targetWidth) return minFontPx;
  let lo = minFontPx;
  let hi = maxFontPx;
  let pivot = maxFontPx;
  let width = 0;
  do {
    pivot = (lo + hi) / 2;
    width = getTextWidth(pivot);
    if (width > targetWidth) hi = pivot;
    else lo = pivot;
  } while (Math.abs(width - targetWidth) >= 1 && hi - lo > 0.25);
  return pivot;
}

let getTextWidthCanvas: HTMLCanvasElement | null = null;

function measureTextWidth(text: string, size: number): number {
  const canvas = getTextWidthCanvas ?? (getTextWidthCanvas = document.createElement('canvas'));
  const context = canvas.getContext('2d');
  if (!context) return 0;
  context.font = `${size}px Arial, sans-serif`;
  return context.measureText(text).width;
}

/** Break opportunity: a stretch of text that may start a new line. Hyphens are
 *  legitimate break points (kept at the end of the line); tokens from the same
 *  word re-join without a space when they share a line. */
interface LogoToken {
  text: string;
  spaceBefore: boolean;
}

function logoTokens(text: string): LogoToken[] {
  const tokens: LogoToken[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const parts = word.split(/(?<=-)(?=.)/); // break after hyphens: "Rheinisch-Bergischer" → "Rheinisch-" | "Bergischer"
    parts.forEach((part, i) => tokens.push({ text: part, spaceBefore: i === 0 }));
  }
  return tokens;
}

function renderTokens(tokens: LogoToken[], start: number, end: number): string {
  let out = '';
  for (let i = start; i <= end; i++) {
    out += (i > start && tokens[i].spaceBefore ? ' ' : '') + tokens[i].text;
  }
  return out;
}

/** Split tokens into lineCount contiguous lines minimizing the widest line
 *  (DP over split points; widths measured at a fixed reference size, which
 *  preserves order because text width scales ~linearly with the font size). */
function balancedWrap(tokens: LogoToken[], lineCount: number): string[] {
  const n = tokens.length;
  if (lineCount >= n) return tokens.map((token) => token.text);
  const REF_SIZE = 100;
  const INF = Number.POSITIVE_INFINITY;
  const lineWidth = (start: number, end: number): number => measureTextWidth(renderTokens(tokens, start, end), REF_SIZE);
  // cost[k][i]: minimal achievable widest line wrapping tokens[0..i] into k lines
  const cost: number[][] = Array.from({ length: lineCount + 1 }, () => new Array(n).fill(INF));
  const cut: number[][] = Array.from({ length: lineCount + 1 }, () => new Array(n).fill(-1));
  for (let i = 0; i < n; i++) cost[1][i] = lineWidth(0, i);
  for (let k = 2; k <= lineCount; k++) {
    for (let i = k - 1; i < n; i++) {
      for (let j = k - 2; j < i; j++) {
        const candidate = Math.max(cost[k - 1][j], lineWidth(j + 1, i));
        if (candidate < cost[k][i]) {
          cost[k][i] = candidate;
          cut[k][i] = j;
        }
      }
    }
  }
  const bounds: number[] = [n - 1];
  for (let k = lineCount, i = n - 1; k > 1; k--) {
    i = cut[k][i];
    bounds.unshift(i);
  }
  bounds.unshift(-1);
  const lines: string[] = [];
  for (let k = 0; k < lineCount; k++) lines.push(renderTokens(tokens, bounds[k] + 1, bounds[k + 1]));
  return lines;
}

export interface LogoFit {
  lines: string[];
  fontSize: number;
}

/** Fit the KV name: single line while it stays ≥ LOGO_WRAP_MIN_PX, otherwise
 *  wrap at spaces and after hyphens line by line; if even the wrapped longest
 *  line exceeds the box, shrink below the 8 px floor so nothing overflows. */
export function fitLogoText(text: string, targetWidth: number): LogoFit {
  const tokens = logoTokens(text);
  let lines = [text];
  let fontSize = getTextSizeForWidth(text, targetWidth);
  for (let n = 2; n <= LOGO_MAX_LINES && fontSize < LOGO_WRAP_MIN_PX && tokens.length >= n; n++) {
    const wrapped = balancedWrap(tokens, n);
    let longest = wrapped[0];
    for (const line of wrapped.slice(1)) {
      if (measureTextWidth(line, 100) > measureTextWidth(longest, 100)) longest = line;
    }
    const size = getTextSizeForWidth(longest, targetWidth);
    if (size <= fontSize) break; // wrapping further no longer helps
    lines = wrapped;
    fontSize = size;
  }
  // A wrapped name renders at the full fitted size — the proportional clamp
  // below already guarantees the longest line never overflows the box.
  let longest = lines[0];
  for (const line of lines.slice(1)) {
    if (measureTextWidth(line, 100) > measureTextWidth(longest, 100)) longest = line;
  }
  const width = measureTextWidth(longest, fontSize);
  if (width > targetWidth) {
    fontSize = Math.max(1, (fontSize * targetWidth) / width);
  }
  return { lines, fontSize };
}

export function resizeLogoText(doc: Document): void {
  const logoText = doc.getElementById('logo-text');
  if (!logoText) return;
  // remember the unwrapped name — the element's textContent becomes the wrapped lines
  if (logoText.dataset.logoText === undefined) logoText.dataset.logoText = logoText.textContent ?? '';
  const { lines, fontSize } = fitLogoText(logoText.dataset.logoText, LOGO_FIT_FACTOR * logoText.clientWidth);
  logoText.textContent = lines.join('\n');
  logoText.style.fontSize = fontSize.toPrecision(3) + 'px';
}
