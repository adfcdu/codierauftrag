/**
 * Klick-Pfeil für Datalist-Felder (ARIA-Combobox-Fallback): Firefox/LibreWolf
 * öffnet native Datalist-Vorschläge erst beim Tippen (bzw. Doppelklick). Der
 * Pfeil-Button öffnet die komplette Vorschlagsliste per Klick. Die Vorschläge
 * stammen live aus dem <datalist> des Feldes; das Typ-Filter-Verhalten des
 * nativen Datalists bleibt daneben erhalten.
 */

interface OptionEntry {
  value: string;
  label: string;
}

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

/** Pfeil-Sichtbarkeit aller Datalist-Felder nach dem aktuellen Datalist-Bestand
 *  synchronisieren (nach dem Aufbau der Datalists, s. buildPage). */
export function syncComboArrows(doc: Document): void {
  for (const input of doc.querySelectorAll<HTMLInputElement>('.combo input[list]')) {
    const arrow = input.parentElement?.querySelector('button.combo-arrow');
    if (!arrow) continue;
    const listId = input.getAttribute('list');
    if (!listId) continue;
    arrow.toggleAttribute('hidden', datalistEntries(doc, listId).length === 0);
  }
}

/** Attach arrow button + popup listbox to an input with a `list` attribute.
 *  The input must sit in the .combo wrapper created by page.ts. */
export function attachDropdownArrow(doc: Document, input: HTMLInputElement): void {
  const listId = input.getAttribute('list');
  const combo = input.parentElement;
  if (!listId || !combo) return;

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'combo-arrow';
  button.setAttribute('aria-label', 'Vorschläge anzeigen');
  button.setAttribute('aria-haspopup', 'listbox');
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
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', 'Vorschläge');
  listbox.tabIndex = -1;
  listbox.hidden = true;

  let entries: OptionEntry[] = [];
  let activeIndex = -1;

  const setActive = (index: number): void => {
    activeIndex = index;
    listbox.querySelectorAll('li').forEach((li, i) => {
      const active = i === index;
      li.classList.toggle('active', active);
      if (active) {
        li.setAttribute('aria-selected', 'true');
        listbox.setAttribute('aria-activedescendant', li.id);
        li.scrollIntoView?.({ block: 'nearest' });
      } else {
        li.removeAttribute('aria-selected');
      }
    });
  };

  const close = (): void => {
    listbox.hidden = true;
    listbox.replaceChildren();
    button.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
    doc.removeEventListener('pointerdown', onOutside);
    combo.removeEventListener('focusout', onFocusOut);
  };

  const select = (index: number): void => {
    const entry = entries[index];
    if (!entry) return;
    input.value = entry.value;
    close();
    input.focus();
    // same events a native datalist pick fires — drives the reactive wiring
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const open = (): void => {
    entries = datalistEntries(doc, listId);
    if (entries.length === 0) return;
    listbox.replaceChildren();
    entries.forEach((entry, i) => {
      const li = doc.createElement('li');
      li.id = `${input.id}-option-${i}`;
      li.setAttribute('role', 'option');
      li.textContent = entry.label;
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // focus stays in the field — no premature blur-resolve
        select(i);
      });
      listbox.append(li);
    });
    listbox.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    let initial = entries.findIndex((e) => e.value === input.value.trim());
    if (initial < 0) initial = 0;
    setActive(initial);
    listbox.focus();
    doc.addEventListener('pointerdown', onOutside, true);
    combo.addEventListener('focusout', onFocusOut);
  };

  const onOutside = (e: Event): void => {
    if (!listbox.hidden && !combo.contains(e.target as Node)) close();
  };

  const onFocusOut = (e: FocusEvent): void => {
    if (listbox.hidden) return;
    const to = e.relatedTarget as Node | null;
    if (!to || !combo.contains(to)) close();
  };

  button.addEventListener('click', () => {
    if (listbox.hidden) open();
    else close();
  });

  listbox.addEventListener('keydown', (e) => {
    if (listbox.hidden) return;
    const key = (e as KeyboardEvent).key;
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
    } else if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      select(activeIndex);
    } else if (key === 'Escape') {
      e.preventDefault();
      close();
      button.focus();
    }
  });

  combo.append(button, listbox);
}
