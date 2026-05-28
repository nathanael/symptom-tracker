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
});
