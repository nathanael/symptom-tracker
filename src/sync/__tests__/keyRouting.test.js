import { describe, it, expect } from 'vitest';
import { monthIdForKey, monthIdForDate, groupKeysByMonth, MONTH_RE } from '../keyRouting';

describe('keyRouting', () => {
  it('derives month id from a date-prefixed record key', () => {
    expect(monthIdForKey('2026-05-28-flushing-morning')).toBe('2026-05');
    expect(monthIdForKey('2025-12-29-ketotifen')).toBe('2025-12');
  });

  it('derives month id from a YYYY-MM-DD date string', () => {
    expect(monthIdForDate('2026-05-28')).toBe('2026-05');
  });

  it('returns null for a key without a valid date prefix', () => {
    expect(monthIdForKey('weird-key')).toBeNull();
    expect(monthIdForKey('')).toBeNull();
    expect(monthIdForKey(null)).toBeNull();
  });

  it('groups a flat map of record keys into { monthId: [keys] }', () => {
    const grouped = groupKeysByMonth(['2026-05-28-a', '2026-05-01-b', '2026-04-30-c']);
    expect(grouped).toEqual({
      '2026-05': ['2026-05-28-a', '2026-05-01-b'],
      '2026-04': ['2026-04-30-c'],
    });
  });

  it('exposes a YYYY-MM month matcher', () => {
    expect(MONTH_RE.test('2026-05')).toBe(true);
    expect(MONTH_RE.test('2026-5')).toBe(false);
  });
});
