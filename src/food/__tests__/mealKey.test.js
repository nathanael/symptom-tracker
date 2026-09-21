import { describe, it, expect } from 'vitest';
import { mealKey, mealDateKey, compareMealKeys } from '../mealKey.js';
import { monthIdForKey } from '../../sync/keyRouting.js';

describe('mealKey', () => {
  it('formats local wall-clock time, not UTC', () => {
    // 21 Sep 2026, 12:41:07 in whatever zone the test machine runs in
    const key = mealKey(new Date(2026, 8, 21, 12, 41, 7), () => 'ab12');
    expect(key).toBe('2026-09-21T12:41:07-ab12');
  });

  it('reads local-time getters, never UTC (passes regardless of the runner timezone)', () => {
    // Local getters say 21 Sep 12:41:07; every UTC accessor says a different day entirely.
    // An implementation built on toISOString()/getUTC* would produce the 22nd and fail here.
    const localOnly = {
      getFullYear: () => 2026, getMonth: () => 8, getDate: () => 21,
      getHours: () => 12, getMinutes: () => 41, getSeconds: () => 7,
      getUTCFullYear: () => 2026, getUTCMonth: () => 8, getUTCDate: () => 22,
      getUTCHours: () => 2, getUTCMinutes: () => 0, getUTCSeconds: () => 0,
      toISOString: () => '2026-09-22T02:00:00.000Z',
    };
    expect(mealKey(localOnly, () => 'ab12')).toBe('2026-09-21T12:41:07-ab12');
  });

  it('zero-pads every field', () => {
    const key = mealKey(new Date(2026, 0, 5, 7, 3, 9), () => 'cd34');
    expect(key).toBe('2026-01-05T07:03:09-cd34');
  });

  it('routes to the month of the local date', () => {
    expect(monthIdForKey(mealKey(new Date(2026, 8, 21, 23, 59, 0), () => 'ab12'))).toBe('2026-09');
  });

  it('produces different keys for the same second', () => {
    const at = new Date(2026, 8, 21, 12, 41, 7);
    expect(mealKey(at)).not.toBe(mealKey(at));
  });

  it('uses a 4-character lowercase alphanumeric suffix by default', () => {
    expect(mealKey(new Date(2026, 8, 21, 12, 41, 7))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-[a-z0-9]{4}$/);
  });
});

describe('mealDateKey', () => {
  it('extracts the date prefix', () => {
    expect(mealDateKey('2026-09-21T12:41:07-ab12')).toBe('2026-09-21');
  });

  it('returns an empty string for anything malformed', () => {
    expect(mealDateKey('nonsense')).toBe('');
    expect(mealDateKey(null)).toBe('');
    expect(mealDateKey(undefined)).toBe('');
  });
});

describe('compareMealKeys', () => {
  it('sorts chronologically', () => {
    const keys = [
      '2026-09-21T18:00:00-zz99',
      '2026-09-21T08:15:00-aa11',
      '2026-09-20T23:00:00-bb22',
    ];
    expect([...keys].sort(compareMealKeys)).toEqual([
      '2026-09-20T23:00:00-bb22',
      '2026-09-21T08:15:00-aa11',
      '2026-09-21T18:00:00-zz99',
    ]);
  });
});
