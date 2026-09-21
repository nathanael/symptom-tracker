import { describe, it, expect } from 'vitest';
import { isTombstone, makeTombstone, splitTombstones, applyTombstones } from '../tombstones';
import { assembleDomainsFromDocs } from '../hydrate';

describe('tombstones', () => {
  it('recognises only explicit markers', () => {
    expect(isTombstone(makeTombstone(5))).toBe(true);
    expect(isTombstone({ severity: 0, _t: 5 })).toBe(false);
    expect(isTombstone({ _deleted: 'yes' })).toBe(false);
    expect(isTombstone(null)).toBe(false);
  });

  it('splits a cloud map into live records and { key: _t } tombstones', () => {
    const { live, tombstones } = splitTombstones({ a: { severity: 1, _t: 3 }, b: { _deleted: true, _t: 9 } });
    expect(live).toEqual({ a: { severity: 1, _t: 3 } });
    expect(tombstones).toEqual({ b: 9 });
    expect(splitTombstones(undefined)).toEqual({ live: {}, tombstones: {} });
  });

  it('removes records that are not newer than their tombstone, and nothing else', () => {
    const map = { older: { _t: 5 }, same: { _t: 9 }, newer: { _t: 12 }, unstamped: { severity: 2 }, other: { _t: 1 } };
    expect(applyTombstones(map, { older: 9, same: 9, newer: 9, unstamped: 9, missing: 9 })).toEqual({ newer: { _t: 12 }, other: { _t: 1 } });
  });

  it('returns the same reference when nothing is removed', () => {
    const map = { a: { _t: 12 } };
    expect(applyTombstones(map, { a: 9, b: 9 })).toBe(map);
    expect(applyTombstones(map, null)).toBe(map);
  });
});

describe('assembleDomainsFromDocs with tombstones', () => {
  it('hides them from the app, keeps them in the shadow, and reports them per domain', () => {
    const months = [{ id: '2026-03', data: { entries: { a: { severity: 1, _t: 3 }, b: { _deleted: true, _t: 9 } }, notes: { n: { _deleted: true, _t: 4 } } } }];
    const { domains, shadow, tombstones } = assembleDomainsFromDocs(null, months);
    expect(domains.entries).toEqual({ a: { severity: 1, _t: 3 } });
    expect(domains.dailyNotes).toEqual({});
    expect(shadow.entries.b).toEqual({ _deleted: true, _t: 9 });
    expect(tombstones).toEqual({ entries: { b: 9 }, dailyNotes: { n: 4 } });
  });

  it('reports no tombstones for ordinary data', () => {
    expect(assembleDomainsFromDocs(null, [{ id: '2026-03', data: { entries: { a: { _t: 1 } } } }]).tombstones).toEqual({});
  });
});
