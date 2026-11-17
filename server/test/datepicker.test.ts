/**
 * compositeKaufDatum — combines the three picker sub-fields (Tag, Monat,
 * Jahr) of the Kaufdatum popup into a display value (client/src/form/datepicker.ts).
 * Pure function, no CONFIG / DOM / clock needed.
 */

import { describe, expect, it } from 'vitest';

import { compositeKaufDatum } from '../../client/src/form/datepicker.js';

describe('compositeKaufDatum', () => {
  it('commits a complete valid combination as TT.MM.JJJJ', () => {
    expect(compositeKaufDatum('15', '6', '2016')).toBe('15.06.2016');
    expect(compositeKaufDatum('5', '06', '1999')).toBe('05.06.1999');
  });

  it('accepts two-digit years and unpadded one-digit parts (tolerant like the main field)', () => {
    expect(compositeKaufDatum('15', '6', '16')).toBe('15.06.2016');
    expect(compositeKaufDatum('1', '1', '1950')).toBe('01.01.1950');
  });

  it('has no upper bound — future dates in the current or any later year commit', () => {
    expect(compositeKaufDatum('3', '12', '2026')).toBe('03.12.2026');
    expect(compositeKaufDatum('1', '1', '2040')).toBe('01.01.2040');
  });

  it('returns false while any part is missing', () => {
    expect(compositeKaufDatum('', '6', '2016')).toBe(false);
    expect(compositeKaufDatum('15', '', '2016')).toBe(false);
    expect(compositeKaufDatum('15', '6', '')).toBe(false);
    expect(compositeKaufDatum('  ', '6', '2016')).toBe(false);
  });

  it('returns false for impossible dates', () => {
    expect(compositeKaufDatum('31', '2', '2016')).toBe(false);
    expect(compositeKaufDatum('15', '13', '2016')).toBe(false);
    expect(compositeKaufDatum('15', '0', '2016')).toBe(false);
    expect(compositeKaufDatum('0', '6', '2016')).toBe(false);
    expect(compositeKaufDatum('15', '6', 'abc')).toBe(false);
  });

  it('enforces the 1950 lower bound', () => {
    expect(compositeKaufDatum('1', '1', '1949')).toBe(false);
  });
});
