import { describe, it, expect } from 'vitest';
import { isTombstone, makeTombstone, tOf, TOMBSTONE_TTL_MS } from '../tombstones';
import { diffMapDomain, diffIdMapDomain } from '../changeDiff';
import { assembleDomainsFromDocs } from '../hydrate';
import { mergeCloudMap } from '../merge';

const K = '2020-01-05-sym1-daily';
const live = (severity, _t, extra = {}) => ({ time: 'daily', severity, date: '2020-01-05', symptomId: 'sym1', ...extra, ...(_t == null ? {} : { _t }) });

describe('tombstone helpers', () => {
  it('recognises only explicit { _deleted: true } objects', () => {
    expect(isTombstone({ _deleted: true, _t: 5 })).toBe(true);
    expect(isTombstone({ severity: 2, _t: 5 })).toBe(false);
    expect(isTombstone({ _deleted: false })).toBe(false);
    expect(isTombstone(null)).toBe(false);
    expect(isTombstone('note')).toBe(false);
  });

  it('a tombstone carries _deleted + _t and never the record payload (no note)', () => {
    const t = makeTombstone(123, 'dailyNotes');
    expect(t).toEqual({ _deleted: true, _t: 123 });
    expect('note' in makeTombstone(1, 'entries')).toBe(false);
    expect('text' in t).toBe(false);
  });

  it('an entries tombstone reads as N/A (-1) so pre-tombstone app versions cannot crash or NaN on it', () => {
    expect(makeTombstone(9, 'entries')).toEqual({ _deleted: true, _t: 9, severity: -1 });
  });

  it('tOf treats a missing _t as 0', () => {
    expect(tOf({ severity: 1 })).toBe(0);
    expect(tOf('legacy note')).toBe(0);
    expect(tOf({ _t: 7 })).toBe(7);
  });

  it('keeps tombstones for ~30 days', () => {
    expect(TOMBSTONE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('diffMapDomain — tombstone aware', () => {
  it('a key whose shadow is already a tombstone and is absent locally is NOT re-deleted', () => {
    const { changed, deleted } = diffMapDomain({ [K]: makeTombstone(200, 'entries') }, {}, 300);
    expect(changed).toEqual({});
    expect(deleted).toEqual([]);
  });

  it('a stale local copy (older _t, or no _t) under a newer tombstone is NOT re-pushed', () => {
    const shadow = { [K]: makeTombstone(200, 'entries') };
    expect(diffMapDomain(shadow, { [K]: live(3, 100) }, 300).changed).toEqual({});
    expect(diffMapDomain(shadow, { [K]: live(3) }, 300).changed).toEqual({});
  });

  it('a local record NEWER than the tombstone is pushed', () => {
    const { changed } = diffMapDomain({ [K]: makeTombstone(200, 'entries') }, { [K]: live(3, 250) }, 300);
    expect(changed[K]).toEqual(live(3, 300));
  });

  it('a record the caller vouches for as a fresh local write beats the tombstone, even across clock skew', () => {
    // now (150) is BEHIND the tombstone (200): the stamp must still supersede it.
    const { changed } = diffMapDomain({ [K]: makeTombstone(200, 'entries') }, { [K]: live(3) }, 150, () => true);
    expect(changed[K]._t).toBe(201);
    expect(changed[K].severity).toBe(3);
  });

  it('never uploads a tombstone that leaked into the local view, and never treats it as a delete', () => {
    const shadow = { [K]: live(3, 100) };
    const { changed, deleted } = diffMapDomain(shadow, { [K]: { _deleted: true, _t: 50 } }, 300);
    expect(changed).toEqual({});
    expect(deleted).toEqual([]);
  });

  it('definition (id-map) diffs are unchanged: absence is a delete, records are compared plainly', () => {
    const { changed, deleted } = diffIdMapDomain({ a: { id: 'a', _t: 1 } }, { b: { id: 'b' } }, 9);
    expect(deleted).toEqual(['a']);
    expect(changed).toEqual({ b: { id: 'b', _t: 9 } });
  });
});

describe('assembleDomainsFromDocs — tombstones are split out', () => {
  const months = [{ id: '2020-01', data: {
    entries: { [K]: { _deleted: true, _t: 200, severity: -1 }, '2020-01-06-sym1-daily': live(2, 150) },
    notes: { '2020-01-05': { _deleted: true, _t: 210 } },
  } }];

  it('app-shape domains contain live records only', () => {
    const { domains } = assembleDomainsFromDocs(null, months);
    expect(Object.keys(domains.entries)).toEqual(['2020-01-06-sym1-daily']);
    expect(domains.dailyNotes).toEqual({});
  });

  it('the shadow keeps tombstones, and they are reported per domain with their _t', () => {
    const { shadow, tombstones } = assembleDomainsFromDocs(null, months);
    expect(isTombstone(shadow.entries[K])).toBe(true);
    expect(tombstones.entries).toEqual({ [K]: 200 });
    expect(tombstones.dailyNotes).toEqual({ '2020-01-05': 210 });
    expect(tombstones.stackEntries).toBeUndefined();
  });
});

describe('mergeCloudMap — the hook-side merge', () => {
  it('a tombstone removes a local record that is older or the same age', () => {
    expect(mergeCloudMap({ [K]: live(3, 100) }, {}, { [K]: 200 })).toEqual({});
    expect(mergeCloudMap({ [K]: live(3, 200) }, {}, { [K]: 200 })).toEqual({});
  });

  it('a local record with no _t is older than any tombstone', () => {
    expect(mergeCloudMap({ [K]: live(3) }, {}, { [K]: 1 })).toEqual({});
  });

  it('a NEWER local record survives the tombstone', () => {
    const prev = { [K]: live(3, 300) };
    expect(mergeCloudMap(prev, {}, { [K]: 200 })).toBe(prev);
  });

  it('still union-merges by _t, and keeps keys the cloud view is missing', () => {
    const prev = { a: live(1, 100), b: live(2, 100) };
    expect(mergeCloudMap(prev, { a: live(5, 200) }, undefined)).toEqual({ a: live(5, 200), b: live(2, 100) });
  });

  it('strips tombstone objects that an older app version merged into local state', () => {
    expect(mergeCloudMap({ [K]: { _deleted: true, _t: 5 }, b: live(2, 1) }, {}, undefined)).toEqual({ b: live(2, 1) });
  });

  it('returns the same reference when nothing changes', () => {
    const prev = { a: live(1, 100) };
    expect(mergeCloudMap(prev, { a: live(1, 100) }, { zzz: 5 })).toBe(prev);
  });
});
