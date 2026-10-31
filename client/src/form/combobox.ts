/**
 * Eigene Combobox für Felder mit Vorschlägen: eine einzige gestylte Liste
 * (ul.combo-listbox) wird von beiden Interaktionen geteilt — Tippen filtert
 * die Einträge, der Pfeil-Button IM Eingabefeld zeigt die komplette Liste.
 *
 * Das <datalist> bleibt reine Datenquelle (resolve.ts befüllt es über
 * buildDatalist in dom.ts); das Input trägt bewusst KEIN list-Attribut mehr:
 * dieses Attribut veranlasst Chromium/Safari, ihren eigenen nativen Pfeil
 * (::-webkit-calendar-picker-indicator) und das nicht stylebare native
 * Popup zu rendern. Ohne list-Attribut zeigen alle Browser dieselbe eigene
 * UI — plattformübergreifend konsistent (ersetzt zugleich den früheren
 * Firefox-only-Pfeil-Fallback, da Firefox die nativen Datalist-Vorschläge
 * erst beim Tippen öffnet).
 *
 * Tastatur: der Fokus bleibt immer im Eingabefeld (role="combobox",
 * aria-activedescendant zeigt auf den aktiven Eintrag); Pfeiltasten
 * navigieren, Enter übernimmt die Markierung, Escape/Tab schließen die
 * Liste. Eine Auswahl feuert input+change wie ein nativer Datalist-Pick
 * (treibt die reaktive Wiring in resolve.ts).
 *
 * Automatisches Öffnen (Ort/Straße mit Upstream-Vorschlägen): Fokus ins Feld
 * öffnet die Liste gefiltert nach Feldinhalt; befüllt die Upstream-Auflösung
 * das Datalist, während das Feld fokussiert ist, öffnet sich die Liste von
 * selbst. Escape unterdrückt das automatische Wiederöffnen bis zum nächsten
 * Tippen oder Fokus. Der Pfeil-Button ist nur sichtbar, solange Vorschläge
 * existieren (syncComboArrows).
 */

interface OptionEntry {
  value: string;
  label: string;
}

/** Registry aller angehängten Comboboxen — syncComboArrows schließt die
 *  offene Liste, wenn ihr Datalist leer wird, und öffnet sie wieder von
 *  selbst, wenn ein fokussiertes Feld frisch befüllt wurde. */
const controllers = new WeakMap<HTMLInputElement, { close: () => void; autoOpen: () => void }>();

function datalistEntries(doc: Document, listId: string): OptionEntry[] {
  const dl = doc.getElementById(listId);
  if (!dl) return [];
  const out: OptionEntry[] = [];
  for (const opt of dl.querySelectorAll('option')) {
    const value = opt.getAttribute('value') ?? '';
    out.push({ value, label: opt.getAttribute('label') ?? value });
  }
  return out;
}

/** Umlaut-insensitiver Fold fürs Matching: ä→a, ö→o, ü→u, ß→s + lowercase —
 *  „Dusseldorf“ findet „Düsseldorf“. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ß/g, 's');
}

/** Substring-Match (gefoldet) auf value und label; leere Query = alle. */
function matches(entry: OptionEntry, query: string): boolean {
  if (query === '') return true;
  const q = fold(query);
  return fold(entry.value).includes(q) || fold(entry.label).includes(q);
}

/** Pfeil-Sichtbarkeit aller Combobox-Felder nach dem aktuellen Datalist-Bestand
 *  synchronisieren (nach Aufbau/Neubefüllung der Datalists, s. buildPage /
 *  buildDatalist). Leere Liste → Pfeil weg und offene Liste zu; frisch
 *  befüllte Liste eines fokussierten Feldes → automatisch öffnen. */
export function syncComboArrows(doc: Document): void {
  for (const input of doc.querySelectorAll<HTMLInputElement>('.combo input[data-list]')) {
    const arrow = input.parentElement?.querySelector('button.combo-arrow');
    if (!arrow) continue;
    const listId = input.getAttribute('data-list');
    if (!listId) continue;
    const ctrl = controllers.get(input);
    if (datalistEntries(doc, listId).length === 0) {
      arrow.toggleAttribute('hidden', true);
      ctrl?.close();
    } else {
      arrow.toggleAttribute('hidden', false);
      ctrl?.autoOpen();
    }
  }
}

/** Combobox an ein Input hängen. Das Input sitzt im .combo-Wrapper aus
 *  page.ts; die Vorschläge kommen aus dem Datalist, auf das data-list zeigt. */
export function attachCombobox(doc: Document, input: HTMLInputElement): void {
  const listId = input.getAttribute('data-list') ?? input.getAttribute('list');
  const combo = input.parentElement;
  if (!listId || !combo) return;
  input.removeAttribute('list'); // keine native Datalist-UI (Chromium/Safari)

  const listboxId = `${input.id}-listbox`;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listboxId);
  input.setAttribute('aria-expanded', 'false');

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'combo-arrow';
  button.setAttribute('aria-label', 'Vorschläge anzeigen');
  button.setAttribute('title', 'Vorschläge anzeigen');
  button.setAttribute('aria-expanded', 'false');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  // y-Symmetrie zum viewBox-Zentrum (16/2=8): Strich 4–12, Mitte exakt 8
  path.setAttribute('d', 'M3 5 L8 11 L13 5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#0f4b7c');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  button.append(svg);

  const listbox = doc.createElement('ul');
  listbox.className = 'combo-listbox';
  listbox.id = listboxId;
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', 'Vorschläge');
  listbox.hidden = true;

  let entries: OptionEntry[] = []; // aktuell gerenderte (gefilterte) Einträge
  let activeIndex = -1;
  let suppressInput = false; // synthetisches input-Event nach einer Auswahl
  let suppressFocusOpen = false; // programmatischer focus() nach Auswahl/Pfeil-Klick
  let dismissed = false; // Escape: kein automatisches Wiederöffnen bis Tippen/Fokus

  const setActive = (index: number): void => {
    activeIndex = index;
    listbox.querySelectorAll('li').forEach((li, i) => {
      const active = i === index;
      li.classList.toggle('active', active);
      if (active) {
        li.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', li.id);
        li.scrollIntoView?.({ block: 'nearest' });
      } else {
        li.removeAttribute('aria-selected');
      }
    });
    if (index < 0) input.removeAttribute('aria-activedescendant');
  };

  /** Liste rendern: query '' zeigt alle Einträge (Pfeil-Klick), sonst Filter. */
  const render = (query: string): void => {
    entries = datalistEntries(doc, listId).filter((e) => matches(e, query.trim()));
    listbox.replaceChildren();
    entries.forEach((entry, i) => {
      const li = doc.createElement('li');
      li.id = `${input.id}-option-${i}`;
      li.dataset.index = String(i);
      li.setAttribute('role', 'option');
      li.textContent = entry.label;
      listbox.append(li);
    });
  };

  function close(): void {
    listbox.hidden = true;
    listbox.replaceChildren();
    entries = [];
    activeIndex = -1;
    input.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  /** showAll=true (Pfeil-Klick) zeigt die komplette Liste und markiert den
   *  exakten Treffer bzw. den ersten Eintrag; showAll=false (Tippen) filtert
   *  nach dem Feldinhalt und markiert nur einen exakten Treffer. */
  function open(showAll: boolean): void {
    render(showAll ? '' : input.value);
    if (entries.length === 0) {
      close();
      return;
    }
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-expanded', 'true');
    const exact = entries.findIndex((e) => e.value === input.value.trim());
    setActive(showAll ? (exact < 0 ? 0 : exact) : exact);
  }

  /** Datalist wurde frisch befüllt (Upstream-Antwort) — Liste von selbst
   *  öffnen, wenn das Feld fokussiert ist und nicht per Escape weggeklickt. */
  function autoOpen(): void {
    if (dismissed) return;
    if (doc.activeElement !== input) return;
    open(false);
  }

  function select(index: number): void {
    const entry = entries[index];
    if (!entry) return;
    input.value = entry.value;
    close();
    // same events a native datalist pick fires — drives the reactive wiring
    suppressInput = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    suppressInput = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    suppressFocusOpen = true;
    input.focus();
    suppressFocusOpen = false;
  }

  const onOutside = (e: Event): void => {
    if (!listbox.hidden && !combo.contains(e.target as Node)) close();
  };

  const onFocusOut = (e: FocusEvent): void => {
    if (listbox.hidden) return;
    const to = e.relatedTarget as Node | null;
    if (!to || !combo.contains(to)) close();
  };

  button.addEventListener('click', () => {
    if (listbox.hidden) {
      open(true);
      input.focus();
    } else {
      close();
    }
  });

  // Tippen filtert live — dieselbe Liste wie beim Pfeil-Klick
  input.addEventListener('input', () => {
    if (suppressInput) return;
    dismissed = false;
    open(false);
  });

  // Klick/Fokus ins Feld: vorhandene Vorschläge direkt zeigen
  input.addEventListener('focus', () => {
    dismissed = false;
    if (suppressFocusOpen || !listbox.hidden) return;
    open(false);
  });

  input.addEventListener('keydown', (e) => {
    const key = e.key;
    if (listbox.hidden) {
      if (key === 'ArrowDown') {
        e.preventDefault();
        open(false);
      }
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const delta = key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + delta + entries.length) % entries.length);
    } else if (key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (key === 'End') {
      e.preventDefault();
      setActive(entries.length - 1);
    } else if (key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault();
        select(activeIndex);
      } else {
        close();
      }
    } else if (key === 'Escape') {
      e.preventDefault();
      dismissed = true; // kein auto-open mehr, bis wieder getippt/fokussiert wird
      close();
    } else if (key === 'Tab') {
      close();
    }
  });

  listbox.addEventListener('pointerdown', (e) => {
    const li = (e.target as Element).closest('li') as HTMLLIElement | null;
    if (!li) return;
    e.preventDefault(); // focus stays in the field — no premature blur-resolve
    select(Number(li.dataset.index));
  });
  listbox.addEventListener('pointerover', (e) => {
    const li = (e.target as Element).closest('li') as HTMLLIElement | null;
    if (li) setActive(Number(li.dataset.index));
  });

  doc.addEventListener('pointerdown', onOutside, true);
  combo.addEventListener('focusout', onFocusOut);

  controllers.set(input, { close, autoOpen });
  combo.append(button, listbox);
}
