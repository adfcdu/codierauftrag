/**
 * Eigene Kalenderauswahl für das Kaufdatum: der native Date-Picker ist
 * ersetzt, weil Safaris segmentierte Date-Inputs getippte Jahre zerlegen
 * (aus JS nicht korrigierbar; s. values.ts/page.ts). Bauweise identisch
 * zur Combobox:
 * Kalender-Symbol IM Feld, Klick öffnet eine absolut positionierte Karte
 * unter dem Feld. Sperren entlang der Parser-Schranken (min 1950-01-01,
 * max heute), einheitliche Übernahme als TT.MM.JJJJ.
 *
 * Tastatur: Tag-Felder sind reguläre Buttons (Tab-Einzelschritte, Enter
 * übernimmt); Escape/Tab/Klick außerhalb schließen; der Monat wechselt über
 * die Pfeil-Buttons im Kopf der Karte (an den Schranken deaktiviert).
 */

import { CONFIG } from '../configTypes.js';
import { daysInMonth, kaufDatumDisplayYmd, parseKaufDatum, todayYmd } from '../values.js';

/** Untere Schranke — wie das frühere min-Attribut des Native-Date-Inputs. */
const MIN_YMD = '1950-01-01';

const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** Wochentagkopf: Woche beginnt montags (de-DE-Konvention). */
const DOW_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Kopfloser Schaltflächen-Offset in der 7-Spalten-Rasterwoche. */
function mondayOffset(year: number, month0: number): number {
  return (new Date(year, month0, 1).getDay() + 6) % 7;
}

/** Ein Tag der Rasterkarte: ymd-Identität, Zahl-Label, gesperrt-Flag. */
export interface CalendarCell {
  ymd: string;
  day: number;
  disabled: boolean;
}

/**
 * Tag-Zellen eines Monats, 7er-Raster-ausrichtet: vordere null-Platzhalter
 * bis zum Wochenstart, dann die Tage. Disabled: unter min oder über max
 * (String-Vergleich reicht — Y-m-d lexikalisch == chronologisch).
 */
export function calendarCells(
  year: number,
  month0: number,
  minYmd: string,
  maxYmd: string,
): (CalendarCell | null)[] {
  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < mondayOffset(year, month0); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(year, month0 + 1); d++) {
    const mm = String(month0 + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const ymd = `${year}-${mm}-${dd}`;
    cells.push({ ymd, day: d, disabled: ymd < minYmd || ymd > maxYmd });
  }
  return cells;
}

/** SVG-Element mit Set-Attribut-Helfern (Kalender-Symbol, Pfeile). */
function svgIcon(
  doc: Document,
  viewBox: string,
  paths: Array<{ d: string; fill?: string }>,
): SVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  for (const p of paths) {
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('fill', p.fill ?? 'none');
    path.setAttribute('stroke', '#0f4b7c');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

/** Kalenderauswahl an ein Kaufdatum-Input hängen. Der Aufrufer (page.ts)
 *  sorgt für den .combo-Wrapper — Symbol und Karte werden hier angehängt. */
export function attachDatePicker(doc: Document, input: HTMLInputElement): void {
  const combo = input.parentElement as HTMLElement;

  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'combo-arrow datepick-toggle';
  toggle.setAttribute('aria-label', 'Kalender öffnen');
  toggle.setAttribute('title', 'Kalender öffnen');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.append(
    svgIcon(doc, '0 0 16 16', [{ d: 'M2 3.5 h12 v10.5 h-12 Z' }, { d: 'M2 6.5 h12', fill: '#0f4b7c' }]),
  );

  const pop = doc.createElement('div');
  pop.className = 'datepick-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Kaufdatum auswählen');
  pop.hidden = true;

  const navPrev = doc.createElement('button');
  navPrev.type = 'button';
  navPrev.className = 'datepick-nav';
  navPrev.setAttribute('aria-label', 'Vorheriger Monat');
  navPrev.append(svgIcon(doc, '0 0 16 16', [{ d: 'M10 3 L5 8 L10 13' }]));

  const navNext = doc.createElement('button');
  navNext.type = 'button';
  navNext.className = 'datepick-nav';
  navNext.setAttribute('aria-label', 'Nächster Monat');
  navNext.append(svgIcon(doc, '0 0 16 16', [{ d: 'M6 3 L11 8 L6 13' }]));

  const monthLabel = doc.createElement('span');
  monthLabel.className = 'datepick-month';

  const head = doc.createElement('div');
  head.className = 'datepick-head';
  head.append(navPrev, monthLabel, navNext);

  const grid = doc.createElement('div');
  grid.className = 'datepick-grid';
  pop.append(head, grid);

  // Angezeigter Monat (month0 = 0-basiert); gesetzt in open()
  let view = { y: 2000, m: 0 };

  function render(): void {
    const today = todayYmd(CONFIG.zeitzone);
    monthLabel.textContent = `${MONTH_NAMES[view.m] ?? ''} ${view.y}`;

    // Schranken desmonatig: Zurück bis 1950-01, vor bis zum heute-Monat
    const monthIndex = view.y * 12 + view.m;
    navPrev.disabled = monthIndex <= 1950 * 12;
    navNext.disabled = monthIndex >= Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;

    // markierter Tag: das aktuell ausgewertbare Feld-Datum (falls im Monat)
    const selected = parseKaufDatum(input.value, today);

    grid.replaceChildren();
    for (const dow of DOW_LABELS) {
      const span = doc.createElement('span');
      span.className = 'datepick-dow';
      span.textContent = dow;
      grid.append(span);
    }
    for (const cell of calendarCells(view.y, view.m, MIN_YMD, today)) {
      if (cell === null) {
        grid.append(doc.createElement('span'));
        continue;
      }
      const day = doc.createElement('button');
      day.type = 'button';
      day.className = 'datepick-day';
      day.textContent = String(cell.day);
      day.dataset.ymd = cell.ymd;
      if (cell.disabled) day.disabled = true;
      if (selected !== false && selected === cell.ymd) day.classList.add('selected');
      grid.append(day);
    }
  }

  function close(): void {
    pop.hidden = true;
    grid.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function open(): void {
    const today = todayYmd(CONFIG.zeitzone);
    const parsed = parseKaufDatum(input.value, today);
    if (parsed !== false) {
      view = { y: Number(parsed.slice(0, 4)), m: Number(parsed.slice(5, 7)) - 1 };
    } else {
      view = { y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 };
    }
    render();
    pop.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-expanded', 'true');
  }

  function select(ymd: string): void {
    input.value = kaufDatumDisplayYmd(ymd);
    close();
    // dieselben Events wie ein nativer Date-Pick — treibt die reaktive
    // Wiring in resolve.ts (refreshDisplay per input, Meldungs-Aufbau)
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  }

  toggle.addEventListener('click', () => {
    if (pop.hidden) open();
    else close();
  });

  navPrev.addEventListener('click', () => {
    view.m--;
    if (view.m < 0) {
      view.m = 11;
      view.y--;
    }
    render();
  });
  navNext.addEventListener('click', () => {
    view.m++;
    if (view.m > 11) {
      view.m = 0;
      view.y++;
    }
    render();
  });

  grid.addEventListener('click', (e) => {
    const day = (e.target as Element).closest('button.datepick-day') as HTMLButtonElement | null;
    if (day?.dataset.ymd) select(day.dataset.ymd);
  });

  combo.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      e.preventDefault();
      close();
      input.focus();
    }
  });

  // Klick außerhalb (auf der Karte selbst ist Klick in der Karte erlaubt)
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
}
