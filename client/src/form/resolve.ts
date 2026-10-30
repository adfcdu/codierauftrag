/**
 * Reactive form wiring: touched/eager message timing, debounced + dirty-tracked
 * background streetcode resolution, busy indicators, live genPdf gating.
 */

import {
  readForm,
  validateField,
} from '../values.js';
import type { FormValues, StreetcodeState } from '../values.js';
import { CONFIG } from '../configTypes.js';
import {
  buildDatalist,
  genPdfEnabled,
  setBusy,
  showMessage,
  setGenPdfBusy,
  updateEinBox,
  updateGenPdfGate,
  updatePriceLine,
} from './dom.js';
import type { BuiltPage } from './page.js';

const VALIDATION_IDS = ['vorname', 'nachname', 'ort', 'strasse', 'hausnr'] as const;

export interface WiringOptions {
  fetchFn?: typeof fetch;
  resolveDelayMs?: number; // default 800
}

export interface Wiring {
  state: StreetcodeState;
  page: BuiltPage;
  /** fire a resolution now (blur / datalist pick / QR reload) */
  runResolveNow(): Promise<void>;
  /** (re-)schedule the debounced resolution (default 800 ms without edits) */
  scheduleResolve(delayMs?: number): void;
  /** re-evaluate messages, EIN box, price, gate */
  refreshDisplay(): void;
  setTouched(id: string): void;
  /** fill fields from decoded QR values (does not fire input events) */
  applyPrefill(values: Partial<FormValues>): void;
  dispose(): void;
}


interface StreetcodeResponse {
  state: string;
  city?: string;
  plateCode?: string;
  subCode?: string;
  ags?: string;
  street?: string;
  streetCode?: string;
  candidates?: unknown;
  scope?: string;
  stale?: boolean;
}

interface PendingRequest {
  raw: { ort: string; strasse: string };
  coversOrt: boolean;
  coversStrasse: boolean;
}

export function wireForm(
  doc: Document,
  page: BuiltPage,
  opts: WiringOptions = {},
): Wiring {
  const doFetch = opts.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const delay = opts.resolveDelayMs ?? 800;

  const state: StreetcodeState = { inFlight: false };
  const touched = new Set<string>();
  const errored = new Set<string>();
  let picked: { name: string; ags: string } | undefined;
  let settled = { ort: '', strasse: '' }; // trimmed inputs the current state reflects
  let pending: PendingRequest[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  // ── display ──

  function refreshDisplay(): void {
    const values = readForm(doc);
    for (const id of VALIDATION_IDS) {
      const msg = validateField(id, values, state);
      const busy = (id === 'ort' || id === 'strasse') && isFieldBusy(id);
      if (msg === false || busy) {
        showMessage(doc, id, false);
      } else if (touched.has(id) || errored.has(id)) {
        showMessage(doc, id, msg);
        if (!msg.startsWith('geändert von ')) errored.add(id);
      }
    }
    updatePriceLine(page, values);
    updateEinBox(page, values, state);
    updateGenPdfGate(page, values, state);
  }

  function isFieldBusy(id: 'ort' | 'strasse'): boolean {
    return pending.some((p) => (id === 'ort' ? p.coversOrt : p.coversStrasse));
  }

  function updateBusy(): void {
    state.inFlight = pending.length > 0;
    setBusy(doc, 'ort', isFieldBusy('ort'));
    setBusy(doc, 'strasse', isFieldBusy('strasse'));
  }

  // ── eager invalidation: stale state can never be displayed ──

  function clearCitySide(): void {
    state.city = undefined;
    state.cityCandidates = undefined;
    state.cityError = undefined;
    state.originalOrt = undefined;
    state.street = undefined; // street codes belong to the resolved city
    state.streetCandidates = undefined;
    state.streetError = undefined;
    state.originalStrasse = undefined;
    settled = { ort: '', strasse: '' };
  }

  function clearStreetSide(): void {
    state.street = undefined;
    state.streetCandidates = undefined;
    state.streetError = undefined;
    state.originalStrasse = undefined;
    settled = { ort: settled.ort, strasse: '' };
  }

  // ── events ──

  function onOrtInput(input: HTMLInputElement): void {
    const value = input.value;
    // datalist pick (or manually typed candidate name): record the AGS
    const cand = state.cityCandidates?.find((c) => c.name === value);
    if (cand) {
      picked = { name: cand.name, ags: cand.ags };
      touched.add('ort');
    } else if (picked && picked.name !== value) {
      picked = undefined;
    }
    if (value.trim() !== settled.ort) clearCitySide();
    scheduleResolve();
    refreshDisplay();
  }

  function onStrasseInput(input: HTMLInputElement): void {
    const value = input.value;
    const cand = state.streetCandidates?.find((s) => s === value);
    if (cand) touched.add('strasse');
    if (value.trim() !== settled.strasse) clearStreetSide();
    scheduleResolve();
    refreshDisplay();
  }

  function wireField(id: string): void {
    const input = doc.getElementById(id) as HTMLInputElement;
    input.addEventListener('input', () => {
      if (id === 'ort') onOrtInput(input);
      else if (id === 'strasse') onStrasseInput(input);
      else refreshDisplay();
    });
    input.addEventListener('change', () => {
      if (id === 'ort') onOrtInput(input);
      else if (id === 'strasse') onStrasseInput(input);
    });
    input.addEventListener('blur', () => {
      touched.add(id);
      if (id === 'ort' || id === 'strasse') runResolveNow();
      refreshDisplay();
    });
  }

  for (const id of [
    'vorname',
    'nachname',
    'ort',
    'strasse',
    'hausnr',
    'marke',
    'modell',
    'farbe',
    'typ',
    'art',
    'schaltung',
    'anzGaenge',
    'rahmenNr',
    'nrPos',
    'verkaeufer',
    'kaufOrt',
    'kaufDatum',
  ]) {
    wireField(id);
  }
  for (const id of ['mitglied', 'ebike', 'carbonRahmen', 'akku', 'beleg']) {
    const input = doc.getElementById(id) as HTMLInputElement | null;
    input?.addEventListener('change', () => refreshDisplay());
  }

  // PDF erzeugen: lazy chunk (jsPDF + bwip-js stay out of the initial bundle).
  // While the chunk loads and the PDF is generated the button shows a busy
  // spinner — on mobile that can take a while.
  let pdfBusy = false;
  page.genPdf.addEventListener('click', () => {
    const values = readForm(doc);
    if (!genPdfEnabled(values, state) || pdfBusy) return; // the gate is live — never generate an invalid PDF
    pdfBusy = true;
    setGenPdfBusy(page, true);
    void (async () => {
      try {
        const { generatePdf } = await import('../pdf/pdf.js');
        await generatePdf(CONFIG, { values, state });
      } finally {
        pdfBusy = false;
        setGenPdfBusy(page, false);
        refreshDisplay(); // recompute the gate from the live form values
      }
    })();
  });

  // ── resolution ──

  function scheduleResolve(delayMs?: number): void {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void runResolve();
    }, delayMs ?? delay);
  }

  async function runResolveNow(): Promise<void> {
    clearTimeout(timer);
    await runResolve();
  }

  async function runResolve(): Promise<void> {
    const values = readForm(doc);
    const ortKey = values.ort.trim();
    const strasseKey = values.strasse.trim();
    if (!ortKey) return; // nothing to resolve without an Ort

    const ortNeedsResolve = ortKey !== settled.ort;
    const strasseNeedsResolve = strasseKey !== settled.strasse;
    if (!ortNeedsResolve && !strasseNeedsResolve) return; // dirty tracking: unchanged input → no call

    const pickActive = picked !== undefined && values.ort === picked.name;
    const citySettled = settled.ort === ortKey && (state.city !== undefined);

    let params: Record<string, string> | undefined;
    let coversOrt = false;
    let coversStrasse = false;

    if (pickActive && strasseKey) {
      // city candidate picked: street (re-)resolve via the ags follow-up
      params = { city: values.ort, street: values.strasse, ags: picked!.ags };
      coversOrt = true;
      coversStrasse = true;
    } else if (!citySettled) {
      if (!strasseKey && pickActive) {
        // picked city, no street yet — the city normalizes with the first street resolve
        return;
      }
      // cold lookup: ONE POST carrying city + street together
      params = { city: values.ort, street: values.strasse };
      coversOrt = true;
      coversStrasse = strasseKey !== '';
    } else if (strasseKey) {
      // fresh city, street changed → GET follow-up (never re-POST a resolved city)
      params = { city: values.ort, street: values.strasse, ags: state.city!.ags };
      coversStrasse = true;
    } else {
      return;
    }

    settled = { ort: ortKey, strasse: strasseKey };
    await sendResolve(params, { raw: { ort: values.ort, strasse: values.strasse }, coversOrt, coversStrasse });
  }

  async function sendResolve(
    params: Record<string, string>,
    req: PendingRequest,
  ): Promise<void> {
    pending.push(req);
    updateBusy();
    refreshDisplay();
    const qs = new URLSearchParams(params);
    try {
      const res = await doFetch(`/api/streetcode?${qs.toString()}`);
      // stale response? inputs moved on → drop
      if (isStale(req)) return;
      if (res.status === 502) {
        applyError(req, 'http');
      } else if (res.status === 404) {
        const body = (await res.json()) as StreetcodeResponse;
        applyError(req, 'not_found', body.scope === 'street' ? 'street' : 'city');
      } else if (res.ok) {
        const body = (await res.json()) as StreetcodeResponse;
        if (!isStale(req)) applyResponse(req, body);
      }
    } catch {
      if (!isStale(req)) applyError(req, 'http'); // network failure ≈ upstream unavailable
    } finally {
      pending = pending.filter((p) => p !== req);
      updateBusy();
      refreshDisplay();
    }
  }

  function isStale(req: PendingRequest): boolean {
    const values = readForm(doc);
    return (
      values.ort.trim() !== req.raw.ort.trim() || values.strasse.trim() !== req.raw.strasse.trim()
    );
  }

  function applyError(req: PendingRequest, kind: 'http' | 'not_found', scope?: 'city' | 'street'): void {
    if (kind === 'http') {
      if (req.coversOrt && !state.city) state.cityError = 'http';
      if ((req.coversStrasse || req.raw.strasse.trim() !== '') && !state.street) {
        // quirk: on 502 the street field shows the no-codes text
        state.streetError = 'http';
      }
    } else if (scope === 'street') {
      state.streetError = 'not_found';
    } else {
      state.cityError = 'not_found';
    }
  }

  function applyResponse(req: PendingRequest, body: StreetcodeResponse): void {
    const rawOrt = req.raw.ort;
    const rawStrasse = req.raw.strasse;
    if (body.state === 'single') {
      state.city = {
        name: body.city!,
        plateCode: body.plateCode!,
        subCode: body.subCode!,
        ags: body.ags!,
      };
      state.cityCandidates = undefined;
      state.cityError = undefined;
      state.originalOrt = rawOrt;
      if (body.street !== undefined) {
        state.street = { name: body.street, code: body.streetCode! };
        state.streetCandidates = undefined;
        state.streetError = undefined;
        state.originalStrasse = rawStrasse;
        setInputValue(doc, 'strasse', body.street);
      } else {
        state.street = undefined;
        state.streetCandidates = undefined;
        if (rawStrasse.trim() !== '') state.streetError = 'not_found';
      }
      // the Ort field shows the canonical name
      setInputValue(doc, 'ort', body.city!);
      buildDatalist(page.datalistOrt, []);
      if (body.street !== undefined) buildDatalist(page.datalistStrasse, []);
      settled = { ort: body.city!.trim(), strasse: readForm(doc).strasse.trim() };
    } else if (body.state === 'street_candidates') {
      state.city = {
        name: body.city!,
        plateCode: body.plateCode!,
        subCode: body.subCode!,
        ags: body.ags!,
      };
      state.cityCandidates = undefined;
      state.cityError = undefined;
      state.originalOrt = rawOrt;
      state.street = undefined;
      state.streetError = undefined;
      state.originalStrasse = undefined;
      state.streetCandidates = (body.candidates as Array<{ street: string }>).map((c) => c.street);
      setInputValue(doc, 'ort', body.city!);
      buildDatalist(page.datalistStrasse, state.streetCandidates.map((s) => ({ value: s })));
      settled = { ort: body.city!.trim(), strasse: rawStrasse.trim() };
    } else if (body.state === 'city_candidates') {
      state.cityCandidates = (body.candidates as Array<{
        name: string;
        plz: string;
        kz: string;
        ags: string;
      }>).map((c) => ({ name: c.name, plz: c.plz, kz: c.kz, ags: c.ags }));
      state.city = undefined;
      state.cityError = undefined;
      state.street = undefined;
      state.streetCandidates = undefined;
      state.streetError = undefined;
      state.originalOrt = undefined;
      state.originalStrasse = undefined;
      buildDatalist(
        page.datalistOrt,
        state.cityCandidates.map((c) => ({
          value: c.name,
          label: c.plz ? `${c.name} (PLZ: ${c.plz})` : c.name,
        })),
      );
      settled = { ort: rawOrt.trim(), strasse: rawStrasse.trim() };
    } else if (body.state === 'not_found') {
      if (body.scope === 'street') state.streetError = 'not_found';
      else state.cityError = 'not_found';
      settled = { ort: rawOrt.trim(), strasse: rawStrasse.trim() };
    }
    // `stale: true` is silently accepted
  }

  function setInputValue(target: Document, id: string, value: string): void {
    const input = target.getElementById(id) as HTMLInputElement;
    if (input.value !== value) input.value = value; // programmatic — fires no input event
  }

  return {
    state,
    page,
    runResolveNow,
    scheduleResolve,
    refreshDisplay,
    setTouched(id: string) {
      touched.add(id);
      refreshDisplay();
    },
    applyPrefill(values: Partial<FormValues>) {
      for (const [id, value] of Object.entries(values)) {
        const input = doc.getElementById(id) as HTMLInputElement | null;
        if (!input) continue;
        if (typeof value === 'boolean') input.checked = value;
        else input.value = value;
      }
      if (values.ort?.trim()) clearCitySide();
      if (values.strasse?.trim() !== undefined) clearStreetSide();
      refreshDisplay();
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}
