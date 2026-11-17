/**
 * compositeKaufDatum — combines the three picker sub-fields (Tag, Monat,
 * Jahr) of the Kaufdatum popup into a display value (client/src/form/datepicker.ts).
 * Pure function: today's Y-m-d is passed in, no CONFIG / DOM / clock needed.
 */

import { describe, expect, it } from 'vitest';

import { compositeKaufDatum } from '../../client/src/form/datepicker.js';

const TODAY = '2025-06-20';

describe('compositeKaufDatum', () => {
  it('commits a complete valid combination as TT.MM.JJJJ', () => {
    expect(compositeKaufDatum('15', '6', '2016', TODAY)).toBe('15.06.2016');
    expect(compositeKaufDatum('5', '06', '1999', TODAY)).toBe('05.06.1999');
  });

  it('accepts two-digit years and unpadded one-digit parts (tolerant like the main field)', () => {
    expect(compositeKaufDatum('15', '6', '16', TODAY)).toBe('15.06.2016');
    expect(compositeKaufDatum('1', '1', '1950', TODAY)).toBe('01.01.1950');
  });

  it('returns false while any part is missing', () => {
    expect(compositeKaufDatum('', '6', '2016', TODAY)).toBe(false);
    expect(compositeKaufDatum('15', '', '2016', TODAY)).toBe(false);
    expect(compositeKaufDatum('15', '6', '', TODAY)).toBe(false);
    expect(compositeKaufDatum('  ', '6', '2016', TODAY)).toBe(false);
  });

  it('returns false for impossible dates', () => {
    expect(compositeKaufDatum('31', '2', '2016', TODAY)).toBe(false);
    expect(compositeKaufDatum('15', '13', '2016', TODAY)).toBe(false);
    expect(compositeKaufDatum('15', '0', '2016', TODAY)).toBe(false);
    expect(compositeKaufDatum('0', '6', '2016', TODAY)).toBe(false);
    expect(compositeKaufDatum('15', '6', 'abc', TODAY)).toBe(false);
  });

  it('returns false outside the parser bounds (min 1950, max today)', () => {
    expect(compositeKaufDatum('1', '1', '1949', TODAY)).toBe(false);
    expect(compositeKaufDatum('21', '6', '2025', TODAY)).toBe(false); // tomorrow
    expect(compositeKaufDatum('20', '6', '2025', TODAY)).toBe('20.06.2025'); // today ok
  });
});
