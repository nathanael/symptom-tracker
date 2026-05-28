import { describe, it, expect } from 'vitest';
import { arrayToIdMap, idMapToArray } from '../definitionShape';

describe('arrayToIdMap', () => {
  it('keys items by id', () => {
    expect(arrayToIdMap([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]))
      .toEqual({ a: { id: 'a', n: 1 }, b: { id: 'b', n: 2 } });
  });
  it('skips items without an id', () => {
    expect(arrayToIdMap([{ id: 'a' }, { n: 9 }])).toEqual({ a: { id: 'a' } });
  });
  it('returns {} for non-array input', () => {
    expect(arrayToIdMap(null)).toEqual({});
    expect(arrayToIdMap(undefined)).toEqual({});
  });
});

describe('idMapToArray', () => {
  it('returns item values', () => {
    const arr = idMapToArray({ a: { id: 'a', order: 0 }, b: { id: 'b', order: 1 } });
    expect(arr).toEqual([{ id: 'a', order: 0 }, { id: 'b', order: 1 }]);
  });
  it('sorts by order ascending', () => {
    const arr = idMapToArray({ b: { id: 'b', order: 2 }, a: { id: 'a', order: 1 } });
    expect(arr.map(x => x.id)).toEqual(['a', 'b']);
  });
  it('places items without order after ordered ones, preserving insertion order', () => {
    const arr = idMapToArray({ x: { id: 'x' }, b: { id: 'b', order: 1 }, y: { id: 'y' } });
    expect(arr.map(i => i.id)).toEqual(['b', 'x', 'y']);
  });
  it('returns [] for non-object input', () => {
    expect(idMapToArray(null)).toEqual([]);
  });
});

describe('round-trip', () => {
  it('array -> idMap -> array preserves deep values including history', () => {
    const items = [
      { id: 'b1-benfotiamine', name: 'B1 Benfotiamine', order: 2, active: false,
        history: [{ type: 'updated', timestamp: '2026-02-09T08:26:44.580Z', changes: { active: { from: true, to: false } } }] },
      { id: 'magnesium', name: 'Magnesium', order: 5, active: true, history: [] },
    ];
    expect(idMapToArray(arrayToIdMap(items))).toEqual(items);
  });
});
