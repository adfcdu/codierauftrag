/**
 * DOM wiring helpers: datalist building, busy states, price line, EIN box,
 * genPdf gate, message display.
 */

import { einParts, isEinValid } from '../ein.js';
import { anyValidationErrors, priceLineText } from '../values.js';
import type { FormValues, StreetcodeState } from '../values.js';
import { syncComboArrows } from './combobox.js';
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
  // Pfeil nur anzeigen, solange Vorschläge existieren; ggf. offene Liste zu
  // (combobox.ts) — data-list verknüpft Input und Datalist
  syncComboArrows(dl.ownerDocument);
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
  // while a PDF generation runs, the button stays disabled + spinner
  page.genPdf.disabled = !genPdfEnabled(values, state) || page.genPdf.classList.contains('busy');
}

/** Busy state on "PDF erzeugen": spinner + disabled while the lazy chunk
 *  (jsPDF + bwip-js) loads and the PDF is generated. */
export function setGenPdfBusy(page: BuiltPage, busy: boolean): void {
  page.genPdf.classList.toggle('busy', busy);
  page.genPdf.disabled = busy;
}
