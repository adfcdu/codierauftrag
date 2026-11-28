/**
 * EIN assembly + barcode text (client/src/ein.ts, client/src/translit.map.ts).
 * CONFIG kommt über den echten Konfigurationsweg (parseConfig →
 * buildPublicConfig), damit die Tests auch den UMLAUTE_IM_BARCODE-/BARCODE_TYP-Hop
 * zum Client abdecken.
 */

import { describe, expect, it } from 'vitest';

import { setConfig } from '../../client/src/configTypes.js';
import type { AppConfig } from '../../client/src/configTypes.js';
import { barCodeTextAndLabel, einParts, einText, initialsPassLetterCheck, translit } from '../../client/src/ein.js';
import { TRANSLIT } from '../../client/src/translit.map.js';
import type { FormValues, StreetcodeState } from '../../client/src/values.js';
import { parseConfig } from '../src/config/parseConfig.js';
import { buildPublicConfig } from '../src/routes/config.js';
import { envFixture } from './helpers/fixtures.js';

function useConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  const parsed = parseConfig({ ...envFixture('minimal-valid.env'), TZ: 'Europe/Berlin', ...overrides });
  if ('errors' in parsed) throw new Error('fixture invalid: ' + JSON.stringify(parsed.errors));
  const config = buildPublicConfig(parsed.config, '1.0.0-test');
  setConfig(config);
  return config;
}

const state: StreetcodeState = {
  inFlight: false,
  city: { name: 'Düsselburg', plateCode: 'DU', subCode: '00', ags: '05111000' },
  street: { name: 'Bergische Straße', code: '02135' },
};

function values(overrides: Partial<FormValues> = {}): FormValues {
  return {
    vorname: '', nachname: '', ort: '', strasse: '', hausnr: '91',
    marke: '', modell: '', farbe: '', typ: '', art: '', schaltung: '',
    anzGaenge: '', rahmenNr: '', nrPos: '', verkaeufer: '', kaufOrt: '',
    kaufDatum: '', mitglied: false, ebike: false, carbonRahmen: false,
    akku: false, beleg: false, ...overrides,
  } as FormValues;
}

// 2026-01-15 in Europe/Berlin → Jahr '26'
const NOW = new Date('2026-01-15T12:00:00+01:00');

describe('translit — length-preserving accent map', () => {
  it('maps every entry to at most one char (barcode never grows)', () => {
    for (const [ch, mapped] of Object.entries(TRANSLIT)) {
      expect([...mapped].length, `TRANSLIT['${ch}']`).toBeLessThanOrEqual(1);
    }
  });

  it('folds ß→s, Ä→A, Ü→U and keeps Latin-1 when keepCharsBelow256', () => {
    expect(translit('ßÄö', false)).toBe('sAo');
    expect(translit('ßÄö', true)).toBe('ßÄö');
  });
});

describe('einParts — fixed 16-char EIN, initials always 2 chars', () => {
  it('DU 00 02135 091 + initials + year = 16 chars', () => {
    useConfig();
    const p = einParts(values({ vorname: 'Jörg', nachname: 'Gross' }), state, NOW);
    expect(p.ini).toBe('JG');
    expect(einText(values({ vorname: 'Jörg', nachname: 'Gross' }), state, NOW)).toBe('DU0002135091JG26');
  });

  it('ß initial stays a single ß (no SS expansion) — „ßas Ökar“ → ßÖ, still 16 chars', () => {
    useConfig();
    const v = values({ vorname: 'ßas', nachname: 'Ökar' });
    expect(einParts(v, state, NOW).ini).toBe('ßÖ');
    const ein = einText(v, state, NOW);
    expect(ein).toBe('DU0002135091ßÖ26');
    expect([...ein].length).toBe(16);
    expect(initialsPassLetterCheck(v)).toBe(true);
  });

  it('uppercases initials per char but never expands them', () => {
    useConfig();
    expect(einParts(values({ vorname: 'ægir', nachname: 'þor' }), state, NOW).ini).toBe('ÆÞ');
  });
});

describe('barCodeTextAndLabel — umlauts per effective switch', () => {
  const v = () => values({ vorname: 'ßas', nachname: 'Ökar' });

  it('code128 + UMLAUTE_IM_BARCODE=true (default): ßÖ kept, FNC4 — 16 chars, no warning diff', () => {
    useConfig(); // minimal-valid: BARCODE_TYP=CODE128 default, UMLAUTE_IM_BARCODE=true default
    const [content, label] = barCodeTextAndLabel(v(), state, NOW);
    expect(content).toBe('DU0002135091ßÖ26');
    expect(label).toBe(content);
    expect([...content].length).toBe(16);
    expect(einText(v(), state, NOW)).toBe(content); // displayed == barcode → no warning line
  });

  it('UMLAUTE_IM_BARCODE=false: ßÖ → SO, still 16 chars', () => {
    useConfig({ UMLAUTE_IM_BARCODE: 'false' });
    const [content] = barCodeTextAndLabel(v(), state, NOW);
    expect(content).toBe('DU0002135091SO26');
    expect([...content].length).toBe(16);
    expect(einText(v(), state, NOW)).not.toBe(content); // → PDF warning line
  });

  it('code39/code39ext ignore UMLAUTE_IM_BARCODE=true: always transliterated (ASCII only)', () => {
    for (const typ of ['CODE39', 'CODE39EXT']) {
      useConfig({ BARCODE_TYP: typ, UMLAUTE_IM_BARCODE: 'true' });
      const [content] = barCodeTextAndLabel(v(), state, NOW);
      expect(content).toBe('DU0002135091SO26');
      expect([...content].length).toBe(16);
    }
  });

  it('plain ASCII names are identical in every configuration', () => {
    for (const overrides of [
      {},
      { UMLAUTE_IM_BARCODE: 'false' },
      { BARCODE_TYP: 'CODE39' },
      { BARCODE_TYP: 'CODE39EXT', UMLAUTE_IM_BARCODE: 'true' },
    ]) {
      useConfig(overrides);
      const v2 = values({ vorname: 'Jörg', nachname: 'Gross' });
      expect(barCodeTextAndLabel(v2, state, NOW)[0]).toBe('DU0002135091JG26');
    }
  });
});
