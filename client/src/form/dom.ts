/**
 * DOM wiring helpers: datalist building, busy states, price line, EIN box,
 * genPdf gate, message display.
 */

import { einParts, isEinValid } from '../ein.js';
import { anyValidationErrors, extraEtikettNoteText, fieldAvailability, priceLineText } from '../values.js';
import type { FormValues, StreetcodeState } from '../values.js';
import { setComboEnabled, syncComboArrows } from './combobox.js';
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

/** Felder des Abschnitts „Fahrrad/Anhänger“ hängen vom Radtyp und voneinander
 *  ab (values.ts → fieldAvailability): bei „Anhänger“ sind Carbon-Rahmen,
 *  Pedelec/E-Bike und Akku codieren deaktiviert (ausgegraut, nicht
 *  fokussierbar) und Radart, Schaltung sowie Anzahl Gänge zusätzlich geleert —
 *  ein Anhänger hat weder Schaltung noch Gänge. „Akku codieren“ setzt
 *  außerdem ein Pedelec/E-Bike voraus. Gesetzte Häkchen werden entfernt, sonst
 *  bliebe der Akku-Aufpreis oder eine Etiketten-Codierung in Preis und PDF
 *  stehen, ohne dass der Nutzer sie noch abwählen könnte. No-op für Felder,
 *  die per Konfiguration fehlen (ZEIGE_AKKU/ZEIGE_CARBONRAHMEN = false). */
export function syncBikeFields(doc: Document): void {
  const typ = (doc.getElementById('typ') as HTMLInputElement | null)?.value ?? '';
  const ebike = doc.getElementById('ebike') as HTMLInputElement | null;
  const allowed = fieldAvailability(typ, ebike?.checked ?? false);
  setToggleEnabled(doc, 'carbonRahmen', allowed.carbonRahmen);
  setToggleEnabled(doc, 'ebike', allowed.ebike);
  setToggleEnabled(doc, 'akku', allowed.akku);
  setTextEnabled(doc, 'art', allowed.art);
  setTextEnabled(doc, 'schaltung', allowed.schaltung);
  setTextEnabled(doc, 'anzGaenge', allowed.anzGaenge);
}

function setToggleEnabled(doc: Document, id: string, enabled: boolean): void {
  const input = doc.getElementById(id) as HTMLInputElement | null;
  if (!input) return;
  input.disabled = !enabled;
  if (!enabled) input.checked = false;
  input.closest('.input-check')?.classList.toggle('disabled', !enabled);
}

function setTextEnabled(doc: Document, id: string, enabled: boolean): void {
  const input = doc.getElementById(id) as HTMLInputElement | null;
  if (!input) return;
  setComboEnabled(input, enabled); // sperrt Input + Combo-Pfeil, schließt die Liste
  if (!enabled) input.value = '';
  input.closest('.input-text')?.classList.toggle('disabled', !enabled);
}

/** Live price line — no-op when zeigePreise=false (element absent). */
export function updatePriceLine(page: BuiltPage, values: FormValues): void {
  if (!page.price) return;
  page.price.textContent = priceLineText(values);
  // Zusatzinfo nur, wenn tatsächlich Sicherheitsetiketten verwendet werden
  // (Carbon-Rahmen oder Akku) — sonst bleibt sie leer (CSS blendet sie aus).
  if (page.priceNote) page.priceNote.textContent = extraEtikettNoteText(values);
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

/** Busy state on "Codierauftrag herunterladen": spinner + disabled while the lazy chunk
 *  (jsPDF + bwip-js) loads and the PDF is generated. */
export function setGenPdfBusy(page: BuiltPage, busy: boolean): void {
  page.genPdf.classList.toggle('busy', busy);
  page.genPdf.disabled = busy;
}
