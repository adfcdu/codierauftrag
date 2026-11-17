/**
 * parseKaufDatum — the flexible purchase-date parser (client/src/values.ts).
 * Pure function, no CONFIG / DOM / clock needed.
 */

import { describe, expect, it } from 'vitest';

import { kaufDatumDisplayYmd, parseKaufDatum } from '../../client/src/values.js';

describe('parseKaufDatum — accepted formats', () => {
  it('accepts TT.MM.JJJJ', () => {
    expect(parseKaufDatum('15.06.2016')).toBe('2016-06-15');
  });

  it('accepts one- or two-digit day and month', () => {
    expect(parseKaufDatum('1.6.2016')).toBe('2016-06-01');
    expect(parseKaufDatum('05.3.2010')).toBe('2010-03-05');
  });

  it('accepts two-digit years by pivot (>=70 → 19xx, else 20xx)', () => {
    expect(parseKaufDatum('15.6.16')).toBe('2016-06-15');
    expect(parseKaufDatum('15.06.99')).toBe('1999-06-15');
    expect(parseKaufDatum('15.06.24')).toBe('2024-06-15');
  });

  it('accepts compact 6-digit (TTMMJJ) and 8-digit (TTMMJJJJ) entry', () => {
    expect(parseKaufDatum('15062016')).toBe('2016-06-15');
    expect(parseKaufDatum('150616')).toBe('2016-06-15'); // TTMMJJ
    expect(parseKaufDatum('180516')).toBe('2016-05-18'); // TTMMJJ, other date
  });

  it('accepts whitespace padding', () => {
    expect(parseKaufDatum('  15.06.2016  ')).toBe('2016-06-15');
  });

  it('accepts ISO JJJJ-MM-TT (canonical form, QR prefill)', () => {
    expect(parseKaufDatum('2016-06-15')).toBe('2016-06-15');
  });

  it('accepts dates in the future (no upper bound — the field polices nothing)', () => {
    expect(parseKaufDatum('03.12.2026')).toBe('2026-12-03');
    expect(parseKaufDatum('03.12.2030')).toBe('2030-12-03');
  });
});

describe('parseKaufDatum — rejected input', () => {
  it('rejects junk and partial entries', () => {
    expect(parseKaufDatum('')).toBe(false);
    expect(parseKaufDatum('   ')).toBe(false);
    expect(parseKaufDatum('abc')).toBe(false);
    expect(parseKaufDatum('2016')).toBe(false); // year alone is not a date
    expect(parseKaufDatum('15.06.')).toBe(false);
    expect(parseKaufDatum('15.6')).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    expect(parseKaufDatum('31.02.2016')).toBe(false); // no Feb 31
    expect(parseKaufDatum('30.02.2016')).toBe(false);
    expect(parseKaufDatum('29.02.2023')).toBe(false); // no leap year
    expect(parseKaufDatum('29.02.2024')).toBe('2024-02-29'); // leap year ok
    expect(parseKaufDatum('0.6.2016')).toBe(false);
    expect(parseKaufDatum('00.06.2016')).toBe(false);
    expect(parseKaufDatum('15.13.2016')).toBe(false);
    expect(parseKaufDatum('15.00.2016')).toBe(false);
  });

  it('enforces the former min attribute: 1950', () => {
    expect(parseKaufDatum('01.01.1949')).toBe(false);
    expect(parseKaufDatum('01.01.1950')).toBe('1950-01-01');
  });
});

describe('kaufDatumDisplayYmd', () => {
  it('renders canonical Y-m-d as TT.MM.JJJJ (padded, as before)', () => {
    expect(kaufDatumDisplayYmd('2016-06-05')).toBe('05.06.2016');
    expect(kaufDatumDisplayYmd('1999-12-01')).toBe('01.12.1999');
  });

  it('passes through anything that is not Y-m-d', () => {
    expect(kaufDatumDisplayYmd('nonsense')).toBe('nonsense');
  });
});
