/**
 * Kompakte Datumsauswahl fürs Kaufdatum: das Feld-Symbol öffnet eine
 * Popup-Karte mit drei eigenen Eingabefeldern — Tag, Monat, Jahr —, jeweils
 * mit Dropdown aus der bestehenden Combobox-Mechanik (filterndes Tippen,
 * Eintrag-Klick). Bewusst KEIN Kalender-Raster und frei von den Safari-
 * Fehlern nativer Date-Inputs (s. values.ts/page.ts).
 *
 * Sobald alle drei Teile ein gültiges Kaufdatum ergeben (untere Schranke
 * 1950 des Parsers, keine Obergrenze), übernimmt der Hauptfeld-Wert im
 * gewohnten TT.MM.JJJJ und feuert input+change wie ein nativer Pick
 * (treibt die reaktive Wiring in resolve.ts). Unvollständige oder
 * unmögliche Kombinationen (31.02.) werden ignoriert, bis sie gültig sind.
 */

import { CONFIG } from '../configTypes.js';
import { attachCombobox, openComboAll } from './combobox.js';
import { kaufDatumDisplayYmd, parseKaufDatum, todayYmd } from '../values.js';

const MIN_YEAR = 1980; // Auswahl-Untergrenze des Jahres-Dropdowns (Tippen bleibt toleranter)

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/**
 * Drei Teilfeld-Eingaben → Anzeige TT.MM.JJJJ, oder false, solange etwas
 * fehlt oder die Kombination kein gültiges Kaufdatum ist (untere Schranke
 * 1950 des Parsers; keine Oberschranke). Der Parser akzeptiert auch
 * zweistellige Jahre („16“ → 2016) und einstellige Tag/Monat-Angaben — die
 * Teilfelder sind also tolerant wie das Hauptfeld.
 */
export function compositeKaufDatum(day: string, month: string, year: string): string | false {
  if (!day.trim() || !month.trim() || !year.trim()) return false;
  const parsed = parseKaufDatum(`${day.trim()}.${month.trim()}.${year.trim()}`);
  return parsed === false ? false : kaufDatumDisplayYmd(parsed);
}

/** SVG-Icon (Strichstil wie der Combo-Pfeil). */
function svgIcon(doc: Document, viewBox: string, paths: string[]): SVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#0f4b7c');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

/** Teilfeld + Combobox-Zubehör: Wrapper, Input, eigene Datalist als Datenquelle. */
function partField(
  doc: Document,
  inputRef: HTMLInputElement,
  suffix: string,
  placeholder: string,
  maxlength: number,
  entries: Array<{ value: string; label: string }>,
): { wrap: HTMLDivElement; input: HTMLInputElement; list: HTMLDataListElement } {
  const wrap = doc.createElement('div') as HTMLDivElement;
  wrap.className = 'combo datepick-part';

  const input = doc.createElement('input') as HTMLInputElement;
  input.type = 'text';
  input.inputMode = 'numeric';
  input.maxLength = maxlength;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.dataset.list = `${inputRef.id}-${suffix}`;
  input.setAttribute('aria-label', placeholder === 'TT' ? 'Tag' : placeholder === 'MM' ? 'Monat' : 'Jahr');
  wrap.append(input);

  const list = doc.createElement('datalist');
  list.id = `${inputRef.id}-${suffix}`;
  for (const entry of entries) {
    const opt = doc.createElement('option') as HTMLOptionElement;
    opt.value = entry.value;
    opt.label = entry.label;
    list.append(opt);
  }

  return { wrap, input, list };
}

/** Kalenderauswahl an ein Kaufdatum-Input hängen. Der Aufrufer (page.ts)
 *  sorgt für den .combo-Wrapper — Symbol und Karte werden hier angehängt. */
export function attachDatePicker(doc: Document, input: HTMLInputElement): void {
  const combo = input.parentElement as HTMLElement;

  const toggle = doc.createElement('button') as HTMLButtonElement;
  toggle.type = 'button';
  toggle.className = 'combo-arrow datepick-toggle';
  toggle.setAttribute('aria-label', 'Datum auswählen');
  toggle.setAttribute('title', 'Datum auswählen');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(
    svgIcon(doc, '0 0 16 16', ['M2 3.5 h12 v10.5 h-12 Z', 'M2 6.5 h12', 'M5.5 2 v3', 'M10.5 2 v3']),
  );

  const pop = doc.createElement('div') as HTMLDivElement;
  pop.className = 'datepick-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Kaufdatum auswählen');
  pop.hidden = true;

  const today = todayYmd(CONFIG.zeitzone);

  // Dropdown-Datenquellen: Tage 1–31, Monate benannt, Jahre absteigend ab
  // 1980 (Auswahl-Untergrenze; Tippen toleriert weiterhin alles ab 1950).
  // Oberes Ende: das aktuelle Jahr aus der Zeitzone.
  const dayEntries = Array.from({ length: 31 }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));
  const monthEntries = MONTH_NAMES.map((name, i) => ({
    value: String(i + 1),
    label: `${name} (${i + 1})`,
  }));
  const maxYear = Number(today.slice(0, 4));
  const yearEntries = Array.from({ length: maxYear - MIN_YEAR + 1 }, (_, i) => ({
    value: String(maxYear - i),
    label: String(maxYear - i),
  }));

  const dayPart = partField(doc, input, 'tag', 'TT', 2, dayEntries);
  const monthPart = partField(doc, input, 'monat', 'MM', 2, monthEntries);
  const yearPart = partField(doc, input, 'jahr', 'JJJJ', 4, yearEntries);

  const dot1 = doc.createElement('span') as HTMLSpanElement;
  dot1.className = 'datepick-dot';
  dot1.textContent = '.';
  const dot2 = dot1.cloneNode(true);

  const row = doc.createElement('div') as HTMLDivElement;
  row.className = 'datepick-row';
  row.append(dayPart.wrap, dot1, monthPart.wrap, dot2, yearPart.wrap);

  pop.append(row);
  // Datalists in der Karte: reine Datenquelle, wird vom Browser nicht gerendert
  pop.append(dayPart.list, monthPart.list, yearPart.list);

  function close(): void {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function open(): void {
    // Teile aus dem aktuellen Feldstand vorbefüllen (vollständig oder leer)
    const parsed = parseKaufDatum(input.value);
    if (parsed !== false) {
      dayPart.input.value = String(Number(parsed.slice(8, 10)));
      monthPart.input.value = String(Number(parsed.slice(5, 7)));
      yearPart.input.value = parsed.slice(0, 4);
    }
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-expanded', 'true');
    // Tag-Feld fokussieren — und die KOMPLETTE Tagesliste zeigen, nicht nur
    // den (gefilterten) Vorschlag, der dem bereits stehenden Datum entspricht
    openComboAll(dayPart.input);
  }

  function sync(): void {
    const display = compositeKaufDatum(
      dayPart.input.value,
      monthPart.input.value,
      yearPart.input.value,
    );
    if (display === false || input.value === display) return;
    input.value = display;
    // dieselben Events wie ein nativer Date-Pick — treibt die reaktive
    // Wiring in resolve.ts (refreshDisplay, Meldungs-Aufbau)
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close(); // vollständig übernommen — die Karte hat ihren Zweck erfüllt
  }

  for (const part of [dayPart, monthPart, yearPart]) {
    part.input.addEventListener('input', sync);
    part.input.addEventListener('change', sync);
  }

  toggle.addEventListener('click', () => {
    if (pop.hidden) open();
    else close();
  });

  combo.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      e.preventDefault();
      close();
      input.focus();
    }
  });

  // Klick außerhalb (die Karte selbst zählt noch zum Widget)
  const onOutside = (e: Event): void => {
    if (!pop.hidden && !combo.contains(e.target as Node)) close();
  };
  // Fokus verlässt Feld+Symbol+Karte — schließen (Tab aus dem Widget)
  const onFocusOut = (e: FocusEvent): void => {
    if (pop.hidden) return;
    const to = e.relatedTarget as Node | null;
    if (!to || !combo.contains(to)) close();
  };
  doc.addEventListener('pointerdown', onOutside, true);
  combo.addEventListener('focusout', onFocusOut);

  combo.append(toggle, pop);

  // Comboboxen erst anhängen, wenn die Datalists im Dokument sind
  attachCombobox(doc, dayPart.input);
  attachCombobox(doc, monthPart.input);
  attachCombobox(doc, yearPart.input);
}
