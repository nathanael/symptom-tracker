import { describe, it, expect } from 'vitest';
import { restoreDay, isApplicable, getStripDateKeys, getSeverityStrip, clearDay, stepIndex, reorder, makeId } from '../listHelpers';

const periods = [{ id: 'morning' }, { id: 'evening' }];

describe('isApplicable', () => {
  it('treats missing applicablePeriods as all periods', () => {
    expect(isApplicable({}, 'morning')).toBe(true);
    expect(isApplicable({ applicablePeriods: ['evening'] }, 'morning')).toBe(false);
    expect(isApplicable({ applicablePeriods: ['evening'] }, 'evening')).toBe(true);
  });
});

describe('getStripDateKeys', () => {
  it('returns N keys ending at the given date, oldest first, across month boundaries', () => {
    const keys = getStripDateKeys(new Date(2026, 8, 2), 4);
    expect(keys).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });
});

describe('getSeverityStrip', () => {
  it('averages across periods, ignores N/A, and returns null for gaps', () => {
    const entries = {
      '2026-09-01-a-morning': { severity: 1 },
      '2026-09-01-a-evening': { severity: 3 },
      '2026-09-02-a-morning': { severity: -1 },
      '2026-09-03-a-evening': { severity: 0 },
      '2026-09-01-b-morning': { severity: 5 },
    };
    expect(getSeverityStrip(entries, 'a', ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'], periods))
      .toEqual([2, null, 0, null]);
  });

  it('reads every tracking mode by default, so AM/PM history shows in Simple mode and vice versa', () => {
    const entries = {
      '2026-09-01-a-morning': { severity: 2 },
      '2026-09-01-a-evening': { severity: 4 },
      '2026-09-02-a-daily': { severity: 1 },
    };
    expect(getSeverityStrip(entries, 'a', ['2026-09-01', '2026-09-02'])).toEqual([3, 1]);
  });
});

describe('clearDay', () => {
  it('removes only entries for that date and reports them', () => {
    const map = {
      'k1': { date: '2026-09-01', severity: 1 },
      'k2': { date: '2026-09-02', severity: 2 },
      'k3': { date: '2026-09-01', severity: 3 },
    };
    const { next, removed } = clearDay(map, '2026-09-01');
    expect(Object.keys(next)).toEqual(['k2']);
    expect(Object.keys(removed).sort()).toEqual(['k1', 'k3']);
    expect({ ...next, ...removed }).toEqual(map);
  });

  it('does not match a symptom id that merely starts like a date', () => {
    const map = { '2026-09-01-x-morning': { date: '2026-09-10', severity: 1 } };
    expect(Object.keys(clearDay(map, '2026-09-01').removed)).toEqual([]);
  });
});

describe('restoreDay', () => {
  it('replaces only that day with the snapshot', () => {
    const map = { a: { date: '2026-09-01', v: 9 }, b: { date: '2026-09-02', v: 2 }, c: { date: '2026-09-01', v: 7 } };
    const out = restoreDay(map, '2026-09-01', { a: { date: '2026-09-01', v: 1 } });
    expect(out).toEqual({ a: { date: '2026-09-01', v: 1 }, b: { date: '2026-09-02', v: 2 } });
  });
});

describe('stepIndex', () => {
  const list = [{ ok: true }, { ok: false }, { ok: true }];
  it('skips rows that are not accepted and wraps', () => {
    expect(stepIndex(list, 0, 1, (r) => r.ok)).toBe(2);
    expect(stepIndex(list, 2, 1, (r) => r.ok)).toBe(0);
    expect(stepIndex(list, 0, -1, (r) => r.ok)).toBe(2);
  });
  it('stays put when nothing else is accepted', () => {
    expect(stepIndex(list, 0, 1, () => false)).toBe(0);
    expect(stepIndex([], 0, 1)).toBe(-1);
  });
});

describe('reorder', () => {
  it('moves an id to the target position', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(reorder(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(reorder(['a', 'b'], 'a', 'zzz')).toEqual(['a', 'b']);
  });
});

describe('makeId', () => {
  it('never contains a dot (sync field-path separator)', () => {
    for (let i = 0; i < 50; i++) expect(makeId('Heartburn / bile reflux 2.0')).not.toContain('.');
    expect(makeId('Brain fog')).toMatch(/^brain-fog-\d+$/);
  });
});
