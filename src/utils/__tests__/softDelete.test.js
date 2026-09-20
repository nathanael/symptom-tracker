import { describe, it, expect } from 'vitest';
import { isDeleted, liveItems, markDeleted, restoreDeleted, daysUntilPurge, isExpired, countEntriesFor, removeEntriesFor, RETENTION_DAYS } from '../softDelete';

const now = new Date('2026-09-20T12:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();

describe('soft delete lifecycle', () => {
  it('marks, hides and restores', () => {
    const item = { id: 'a', name: 'A', active: false };
    const deleted = markDeleted(item, now);
    expect(deleted.deletedAt).toBe(now.toISOString());
    expect(isDeleted(deleted)).toBe(true);
    expect(liveItems([item, deleted])).toEqual([item]);
    const restored = restoreDeleted(deleted);
    expect(isDeleted(restored)).toBe(false);
    expect(restored.active).toBe(true);
    expect('deletedAt' in restored).toBe(true); // nulled, not removed
  });

  it('counts down and expires at exactly the retention window', () => {
    expect(daysUntilPurge({ deletedAt: daysAgo(0) }, now)).toBe(RETENTION_DAYS);
    expect(daysUntilPurge({ deletedAt: daysAgo(84) }, now)).toBe(6);
    expect(daysUntilPurge({ deletedAt: daysAgo(200) }, now)).toBe(0);
    expect(daysUntilPurge({}, now)).toBe(null);
    expect(isExpired({ deletedAt: daysAgo(89.9) }, now)).toBe(false);
    expect(isExpired({ deletedAt: daysAgo(90) }, now)).toBe(true);
    expect(isExpired({ deletedAt: null }, now)).toBe(false);
  });
});

describe('entry ownership', () => {
  const entries = {
    '2026-09-01-zinc': { itemId: 'zinc' },
    '2026-09-01-zinc-plus': { itemId: 'zinc-plus' },
    '2026-09-02-zinc': { itemId: 'zinc' },
    '2026-09-02-legacy': {},
  };
  it('matches on the owner field, not on key suffix collisions', () => {
    expect(countEntriesFor(entries, 'zinc', 'itemId')).toBe(2);
    expect(countEntriesFor(entries, 'plus', 'itemId')).toBe(0);
  });
  it('falls back to the key for legacy entries with no owner field', () => {
    expect(countEntriesFor(entries, 'legacy', 'itemId')).toBe(1);
    expect(countEntriesFor({ '2026-09-01-ache-morning': { severity: 1 } }, 'ache', 'symptomId')).toBe(1);
  });
  it('removes only the owned entries and keeps identity when nothing matched', () => {
    const next = removeEntriesFor(entries, ['zinc'], 'itemId');
    expect(Object.keys(next)).toEqual(['2026-09-01-zinc-plus', '2026-09-02-legacy']);
    expect(removeEntriesFor(entries, ['nope'], 'itemId')).toBe(entries);
    expect(removeEntriesFor(entries, [], 'itemId')).toBe(entries);
  });
});
