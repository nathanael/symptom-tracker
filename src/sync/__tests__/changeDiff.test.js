import { describe, it, expect } from 'vitest';
import { diffMapDomain, diffIdMapDomain, equalIgnoringT } from '../changeDiff';

const T = 1000; // fixed clock

describe('diffMapDomain', () => {
  it('detects a new key as changed and stamps _t', () => {
    const { changed, deleted } = diffMapDomain(
      { 'k1': { severity: 1, _t: 1 } },
      { 'k1': { severity: 1, _t: 1 }, 'k2': { severity: 2 } },
      T);
    expect(deleted).toEqual([]);
    expect(changed).toEqual({ 'k2': { severity: 2, _t: T } });
  });

  it('detects a value change and restamps only that key', () => {
    const { changed, deleted } = diffMapDomain(
      { 'k1': { severity: 1, _t: 5 } },
      { 'k1': { severity: 3, _t: 5 } },
      T);
    expect(changed).toEqual({ 'k1': { severity: 3, _t: T } });
    expect(deleted).toEqual([]);
  });

  it('ignores _t-only differences (no real change -> no write)', () => {
    const { changed, deleted } = diffMapDomain(
      { 'k1': { severity: 1, _t: 5 } },
      { 'k1': { severity: 1, _t: 9 } },
      T);
    expect(changed).toEqual({});
    expect(deleted).toEqual([]);
  });

  it('detects a deleted key', () => {
    const { changed, deleted } = diffMapDomain(
      { 'k1': { severity: 1, _t: 5 }, 'k2': { severity: 2, _t: 5 } },
      { 'k1': { severity: 1, _t: 5 } },
      T);
    expect(changed).toEqual({});
    expect(deleted).toEqual(['k2']);
  });

  it('treats missing/undefined prev as empty -> all next keys changed', () => {
    const { changed, deleted } = diffMapDomain(
      undefined,
      { 'k1': { severity: 1 }, 'k2': { severity: 2, _t: 3 } },
      T);
    expect(changed).toEqual({
      'k1': { severity: 1, _t: T },
      'k2': { severity: 2, _t: T },
    });
    expect(deleted).toEqual([]);
  });

  it('returns nothing when prev and next are identical', () => {
    const same = { 'k1': { severity: 1, _t: 5 }, 'k2': { severity: 2, _t: 7 } };
    const { changed, deleted } = diffMapDomain(same, same, T);
    expect(changed).toEqual({});
    expect(deleted).toEqual([]);
  });
});

describe('equalIgnoringT', () => {
  it('treats _t-only differences as equal', () => {
    expect(equalIgnoringT({ a: 1, _t: 5 }, { a: 1, _t: 9 })).toBe(true);
  });

  it('detects differing values', () => {
    expect(equalIgnoringT({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('detects added keys', () => {
    expect(equalIgnoringT({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('handles nested objects ignoring _t', () => {
    expect(equalIgnoringT({ x: { y: 1 }, _t: 1 }, { x: { y: 1 }, _t: 2 })).toBe(true);
    expect(equalIgnoringT({ x: { y: 1 } }, { x: { y: 2 } })).toBe(false);
  });
});

describe('equalIgnoringT — order insensitivity & edge cases', () => {
  it('treats nested objects with different key order as equal', () => {
    expect(equalIgnoringT(
      { changes: { from: 1, to: 2 }, _t: 1 },
      { changes: { to: 2, from: 1 }, _t: 9 },
    )).toBe(true);
  });

  it('treats deeply nested reordered keys as equal', () => {
    expect(equalIgnoringT(
      { history: [{ type: 'updated', changes: { name: { from: 'a', to: 'b' } } }] },
      { history: [{ changes: { name: { to: 'b', from: 'a' } }, type: 'updated' }] },
    )).toBe(true);
  });

  it('still detects a real nested value difference', () => {
    expect(equalIgnoringT(
      { changes: { from: 1, to: 2 } },
      { changes: { from: 1, to: 3 } },
    )).toBe(false);
  });

  it('treats array order as significant (arrays are ordered)', () => {
    expect(equalIgnoringT({ h: [1, 2] }, { h: [2, 1] })).toBe(false);
  });

  it('distinguishes null from missing key', () => {
    expect(equalIgnoringT({ verdict: null }, {})).toBe(false);
  });
});

describe('diffIdMapDomain', () => {
  it('detects new id entries as changed and stamps _t', () => {
    const { changed, deleted } = diffIdMapDomain(
      { a: { id: 'a', n: 1 } },
      { a: { id: 'a', n: 1 }, b: { id: 'b', n: 2 } },
      T);
    expect(changed).toEqual({ b: { id: 'b', n: 2, _t: T } });
    expect(deleted).toEqual([]);
  });

  it('detects a deleted id entry', () => {
    const { changed, deleted } = diffIdMapDomain(
      { a: { id: 'a', n: 1 }, b: { id: 'b', n: 2 } },
      { a: { id: 'a', n: 1 } },
      T);
    expect(changed).toEqual({});
    expect(deleted).toEqual(['b']);
  });

  it('diffIdMapDomain ignores nested key-order churn on history objects', () => {
    const prev = { 'b1': { id: 'b1', name: 'B1', history: [{ type: 'updated', changes: { active: { from: true, to: false } } }], _t: 5 } };
    const next = { 'b1': { id: 'b1', name: 'B1', history: [{ changes: { active: { to: false, from: true } }, type: 'updated' }], _t: 5 } };
    const { changed, deleted } = diffIdMapDomain(prev, next, 1000);
    expect(changed).toEqual({});
    expect(deleted).toEqual([]);
  });
});

import { noteText } from '../../utils/helpers';

// Daily notes are stored as { text, _t } records (uniform with entries). This
// documents the round-trip contract: a { text } note (no _t, as written by the
// app) diffs to a { text, _t } changed record, and noteText reads it back.
describe('dailyNotes { text } record contract', () => {
  it('diffs a new { text } note into a { text, _t } changed record', () => {
    const { changed, deleted } = diffMapDomain(
      {},
      { '2026-01-16': { text: 'I had alcohol last night' } },
      T);
    expect(deleted).toEqual([]);
    expect(changed).toEqual({ '2026-01-16': { text: 'I had alcohol last night', _t: T } });
    expect(noteText(changed['2026-01-16'])).toBe('I had alcohol last night');
  });

  it('detects an edited note as changed (ignoring _t) and re-stamps', () => {
    const { changed } = diffMapDomain(
      { '2026-01-16': { text: 'old', _t: 1 } },
      { '2026-01-16': { text: 'new' } },
      T);
    expect(changed).toEqual({ '2026-01-16': { text: 'new', _t: T } });
  });

  it('treats a deleted (cleared) note key as a deletion', () => {
    const { changed, deleted } = diffMapDomain(
      { '2026-01-16': { text: 'old', _t: 1 } },
      {},
      T);
    expect(changed).toEqual({});
    expect(deleted).toEqual(['2026-01-16']);
  });
});
