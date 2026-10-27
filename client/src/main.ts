/**
 * Bootstrap: fetch /api/config → build DOM → QR-reload decode → auto-resolve →
 * event wiring. Personal data never leaves the browser except the city +
 * street strings sent to /api/streetcode.
 */

import { setConfig } from './configTypes.js';
import type { AppConfig } from './configTypes.js';
import { buildPage } from './form/page.js';
import { resizeLogoText } from './form/dom.js';
import { wireForm } from './form/resolve.js';
import type { Wiring } from './form/resolve.js';
import { decodeLocation } from './qr.js';
import { readForm } from './values.js';

export interface InitResult {
  wiring: Wiring;
}

/** Build the page + wiring from a fetched config (testable without network). */
export function initPage(config: AppConfig, doc: Document, opts: { fetchFn?: typeof fetch } = {}): InitResult {
  setConfig(config);
  doc.title = `Fahrradcodierung ‒ ADFC ${config.kreisVerband}`;
  const mount = doc.getElementById('app') ?? doc.body;
  const page = buildPage(doc, config, mount);
  const wiring = wireForm(doc, page, { fetchFn: opts.fetchFn });

  // pre-fill the Ort field from ortInitial
  if (config.ortInitial) {
    const ort = doc.getElementById('ort') as HTMLInputElement;
    if (ort.value === '') ort.value = config.ortInitial;
  }

  // logo auto-fit + re-run on resize
  resizeLogoText(doc);
  doc.defaultView?.addEventListener('resize', () => resizeLogoText(doc));

  wiring.refreshDisplay();
  return { wiring };
}

async function boot(): Promise<void> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('/api/config unavailable');
  const config = (await res.json()) as AppConfig;
  const { wiring } = initPage(config, document);

  // QR-reload: decode the location, prefill, auto-resolve
  const pre = decodeLocation(window.location);
  if (pre) {
    wiring.applyPrefill(pre);
    if ((pre.ort ?? '').trim()) {
      await wiring.runResolveNow();
    }
    // a reloaded form is pre-validated: show messages for prefilled required fields
    const values = readForm(document);
    for (const id of ['vorname', 'nachname', 'ort', 'strasse', 'hausnr'] as const) {
      if (values[id]) wiring.setTouched(id);
    }
  }
}

if (!import.meta.env.VITEST) {
  void boot();
}
