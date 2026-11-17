/**
 * calendarCells — the 7-column day-grid builder for the Kaufdatum picker
 * (client/src/form/datepicker.ts). Pure function on plain arguments; the
 * monday alignment uses local Date construction (tz-independent weekday).
 */

import { describe, expect, it } from 'vitest';

import { calendarCells } from '../../client/src/form/datepicker.js';

const MIN = '1950-01-01';
const MAX = '2025-06-20';

describe('calendarCells', () => {
  it('aligns to Monday: June 2016 starts on a Wednesday (2 placeholders)', () => {
    const cells = calendarCells(2016, 5, MIN, MAX);
    expect(cells.slice(0, 2)).toEqual([null, null]);
    expect(cells[2]).toEqual({ ymd: '2016-06-01', day: 1, disabled: false });
    expect(cells).toHaveLength(2 + 30);
    expect(cells[cells.length - 1]).toEqual({ ymd: '2016-06-30', day: 30, disabled: false });
  });

  it('January 1950 starts on a Sunday (6 placeholders), the first selectable day', () => {
    const cells = calendarCells(1950, 0, MIN, MAX);
    expect(cells.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(cells[6]).toEqual({ ymd: '1950-01-01', day: 1, disabled: false });
    expect(cells).toHaveLength(6 + 31);
  });

  it('disables days after the maxYmd bound (parser: max = today)', () => {
    const cells = calendarCells(2025, 5, MIN, MAX);
    const june21 = cells.filter((c) => c !== null && c.day === 21).at(0);
    const june20 = cells.filter((c) => c !== null && c.day === 20).at(0);
    expect(june20).toEqual({ ymd: '2025-06-20', day: 20, disabled: false });
    expect(june21).toEqual({ ymd: '2025-06-21', day: 21, disabled: true });
  });

  it('handles leap-year February (29 days) and bounds day-level', () => {
    const cells = calendarCells(2024, 1, MIN, '2024-02-29');
    expect(cells.filter((c) => c !== null)).toHaveLength(29);
    expect(cells.at(-1)).toEqual({ ymd: '2024-02-29', day: 29, disabled: false });
  });
});
