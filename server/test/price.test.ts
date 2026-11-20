/**
 * Preiszeile — das Codierverfahren in der Preisleiste (client/src/values.ts).
 * CONFIG kommt über den echten Konfigurationsweg (parseConfig →
 * buildPublicConfig), damit der Test auch den ETIKETTEN_ANZAHL-Hop zum Client
 * abdeckt.
 */

import { describe, expect, it } from 'vitest';

import { setConfig } from '../../client/src/configTypes.js';
import type { AppConfig } from '../../client/src/configTypes.js';
import {
  extraEtikettNoteText,
  extraEtikettPriceText,
  pdfFeeLines,
  priceLineText,
} from '../../client/src/values.js';
import type { FormValues } from '../../client/src/values.js';
import { parseConfig } from '../src/config/parseConfig.js';
import { buildPublicConfig } from '../src/routes/config.js';
import { envFixture } from './helpers/fixtures.js';

const fixture = envFixture('kv-beispielstadt.env');

function useConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  const parsed = parseConfig({ ...fixture, ...overrides });
  if ('errors' in parsed) throw new Error('fixture invalid: ' + JSON.stringify(parsed.errors));
  const config = buildPublicConfig(parsed.config, '1.0.0-test');
  setConfig(config);
  return config;
}

function values(overrides: Partial<FormValues> = {}): FormValues {
  return {
    vorname: '',
    nachname: '',
    ort: '',
    strasse: '',
    hausnr: '',
    marke: '',
    modell: '',
    farbe: '',
    typ: '',
    art: '',
    schaltung: '',
    anzGaenge: '',
    rahmenNr: '',
    nrPos: '',
    verkaeufer: '',
    kaufOrt: '',
    kaufDatum: '',
    mitglied: false,
    ebike: false,
    carbonRahmen: false,
    akku: false,
    beleg: false,
    ...overrides,
  };
}

describe('priceLineText — the coding method named in the price bar', () => {
  it('names the Nadelmarkierung for an aluminium/steel frame (default)', () => {
    useConfig();
    expect(priceLineText(values())).toBe(
      'Codiergebühr: Fahrrad (Nadelmarkierung): 20,00 € (Nichtmitglied)',
    );
    expect(priceLineText(values({ mitglied: true }))).toBe(
      'Codiergebühr: Fahrrad (Nadelmarkierung): 5,00 € (Mitglied)',
    );
  });

  it('names the Sicherheitsetiketten for a carbon frame — never the Nadelmarkierung', () => {
    useConfig();
    expect(priceLineText(values({ carbonRahmen: true }))).toBe(
      'Codiergebühr: Fahrrad (2 Sicherheitsetiketten): 5,00 € (Nichtmitglied)',
    );
    expect(priceLineText(values({ carbonRahmen: true, mitglied: true }))).toBe(
      'Codiergebühr: Fahrrad (2 Sicherheitsetiketten): 2,50 € (Mitglied)',
    );
  });

  it('names the Sicherheitsetiketten for the Akku, the frame keeps its method', () => {
    useConfig();
    expect(priceLineText(values({ mitglied: true, akku: true }))).toBe(
      'Codiergebühr: Fahrrad (Nadelmarkierung) + Akku (2 Sicherheitsetiketten): 7,50 € (Mitglied)',
    );
    expect(priceLineText(values({ carbonRahmen: true, akku: true }))).toBe(
      'Codiergebühr: Fahrrad (2 Sicherheitsetiketten) + Akku (2 Sicherheitsetiketten): 10,00 € (Nichtmitglied)',
    );
  });

  it('names the Nadelmarkierung for a trailer', () => {
    useConfig();
    expect(priceLineText(values({ typ: 'Anhänger' }))).toBe(
      'Codiergebühr: Anhänger (Nadelmarkierung): 20,00 € (Nichtmitglied)',
    );
  });

  it('ignores a set Akku toggle for a trailer (the toggle is disabled there)', () => {
    useConfig();
    expect(priceLineText(values({ typ: 'Anhänger', akku: true }))).toBe(
      'Codiergebühr: Anhänger (Nadelmarkierung): 20,00 € (Nichtmitglied)',
    );
    expect(extraEtikettNoteText(values({ typ: 'Anhänger', akku: true }))).toBe('');
  });

  it('falls back to the Nadelmarkierung when ZEIGE_CARBONRAHMEN=false', () => {
    useConfig({ ZEIGE_CARBONRAHMEN: 'false' });
    expect(priceLineText(values({ carbonRahmen: true }))).toBe(
      'Codiergebühr: Fahrrad (Nadelmarkierung): 20,00 € (Nichtmitglied)',
    );
  });

  it('uses ETIKETTEN_ANZAHL for the label count in the price line', () => {
    useConfig({ ETIKETTEN_ANZAHL: '3' });
    expect(priceLineText(values({ carbonRahmen: true, mitglied: true }))).toBe(
      'Codiergebühr: Fahrrad (3 Sicherheitsetiketten): 2,50 € (Mitglied)',
    );
  });
});

describe('pdfFeeLines — the PDF fee block mirrors the price bar', () => {
  it('names the fee with the member status and the coding method', () => {
    const config = useConfig();
    expect(pdfFeeLines(config, values())).toEqual([
      'Gebühr: 20,00 € (Nichtmitglied)',
      'für Codierung von Fahrrad (Nadelmarkierung)',
    ]);
    expect(pdfFeeLines(config, values({ mitglied: true }))).toEqual([
      'Gebühr: 5,00 € (Mitglied)',
      'für Codierung von Fahrrad (Nadelmarkierung)',
    ]);
  });

  it('names the Sicherheitsetiketten for a carbon frame', () => {
    const config = useConfig();
    expect(pdfFeeLines(config, values({ carbonRahmen: true, akku: true }))).toEqual([
      'Gebühr: 10,00 € (Nichtmitglied)',
      'für Codierung von Fahrrad (2 Sicherheitsetiketten) + Akku (2 Sicherheitsetiketten)',
    ]);
  });

  it('keeps the frame method for the Akku and follows the member status', () => {
    const config = useConfig();
    expect(pdfFeeLines(config, values({ mitglied: true, akku: true }))).toEqual([
      'Gebühr: 7,50 € (Mitglied)',
      'für Codierung von Fahrrad (Nadelmarkierung) + Akku (2 Sicherheitsetiketten)',
    ]);
  });

  it('appends the VAT lines when ZEIGE_UMSATZSTEUER=true', () => {
    const config = useConfig({ ZEIGE_UMSATZSTEUER: 'true', UMSATZSTEUER_PROZENT: '7' });
    expect(pdfFeeLines(config, values({ mitglied: true }))).toEqual([
      'Gebühr: 5,00 € (Mitglied)',
      'für Codierung von Fahrrad (Nadelmarkierung)',
      'MwSt: 7,0%, Steuerbetrag: 0,33 €',
      'Nettobetrag: 4,67 €',
    ]);
  });

  it('drops the fee amount but keeps the coding method when PREISE_ANZEIGEN=false', () => {
    const config = useConfig({ PREISE_ANZEIGEN: 'false' });
    expect(pdfFeeLines(config, values({ carbonRahmen: true }))).toEqual([
      'Codierung von Fahrrad (2 Sicherheitsetiketten)',
    ]);
  });
});

describe('extraEtikettPriceText — each extra label costs half the base price', () => {
  it('shows the price for the current member status only', () => {
    useConfig();
    expect(extraEtikettPriceText(false)).toBe('Jedes weitere Sicherheitsetikett: 2,50 €');
    expect(extraEtikettPriceText(true)).toBe('Jedes weitere Sicherheitsetikett: 1,25 €');
  });

  it('follows the configured Akku/Etiketten base price', () => {
    useConfig({ AUFPREIS_AKKU_NICHT_MITGLIED: '8', AUFPREIS_AKKU_MITGLIED: '4' });
    expect(extraEtikettPriceText(false)).toBe('Jedes weitere Sicherheitsetikett: 4,00 €');
    expect(extraEtikettPriceText(true)).toBe('Jedes weitere Sicherheitsetikett: 2,00 €');
  });
});

describe('extraEtikettNoteText — only shown when a Sicherheitsetikett is used', () => {
  it('stays empty for a plain aluminium/steel frame', () => {
    useConfig();
    expect(extraEtikettNoteText(values())).toBe('');
    expect(extraEtikettNoteText(values({ mitglied: true }))).toBe('');
    expect(extraEtikettNoteText(values({ typ: 'Anhänger' }))).toBe('');
  });

  it('appears for a carbon frame and for an Akku', () => {
    useConfig();
    const note = 'Jedes weitere Sicherheitsetikett: 2,50 €';
    expect(extraEtikettNoteText(values({ carbonRahmen: true }))).toBe(note);
    expect(extraEtikettNoteText(values({ akku: true }))).toBe(note);
    expect(extraEtikettNoteText(values({ carbonRahmen: true, akku: true }))).toBe(note);
  });

  it('follows the ADFC-Mitglied toggle', () => {
    useConfig();
    expect(extraEtikettNoteText(values({ carbonRahmen: true, mitglied: true }))).toBe(
      'Jedes weitere Sicherheitsetikett: 1,25 €',
    );
    expect(extraEtikettNoteText(values({ akku: true, mitglied: true }))).toBe(
      'Jedes weitere Sicherheitsetikett: 1,25 €',
    );
  });

  it('stays empty when ZEIGE_CARBONRAHMEN=false hides the carbon coding', () => {
    useConfig({ ZEIGE_CARBONRAHMEN: 'false' });
    expect(extraEtikettNoteText(values({ carbonRahmen: true }))).toBe('');
  });
});
