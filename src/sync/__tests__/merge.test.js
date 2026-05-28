import { describe, it, expect } from 'vitest';
import { mergeMapByTime, mergeIdArrayByTime } from '../merge';

describe('mergeMapByTime', () => {
  it('preserves a cloud-only key', () => {
    const prev = { a: { v: 1, _t: 5 } };
    const cloud = { a: { v: 1, _t: 5 }, b: { v: 2, _t: 3 } };
    const result = mergeMapByTime(prev, cloud);
    expect(result).toEqual({ a: { v: 1, _t: 5 }, b: { v: 2, _t: 3 } });
  });

  it('preserves a local-only key', () => {
    const prev = { a: { v: 1, _t: 5 }, b: { v: 2, _t: 3 } };
    const cloud = { a: { v: 1, _t: 5 } };
    const result = mergeMapByTime(prev, cloud);
    expect(result).toEqual({ a: { v: 1, _t: 5 }, b: { v: 2, _t: 3 } });
  });

  it('on conflict, the higher _t wins (local higher)', () => {
    const prev = { a: { v: 'local', _t: 10 } };
    const cloud = { a: { v: 'cloud', _t: 5 } };
    const result = mergeMapByTime(prev, cloud);
    expect(result.a).toEqual({ v: 'local', _t: 10 });
  });

  it('on conflict, the higher _t wins (cloud higher)', () => {
    const prev = { a: { v: 'local', _t: 5 } };
    const cloud = { a: { v: 'cloud', _t: 10 } };
    const result = mergeMapByTime(prev, cloud);
    expect(result.a).toEqual({ v: 'cloud', _t: 10 });
  });

  it('on a tie, cloud wins (matching original tOf(p) > tOf(c) ? p : c)', () => {
    const prev = { a: { v: 'local', _t: 7 } };
    const cloud = { a: { v: 'cloud', _t: 7 } };
    const result = mergeMapByTime(prev, cloud);
    expect(result.a).toEqual({ v: 'cloud', _t: 7 });
  });

  it('treats missing _t as 0 (any stamped write supersedes legacy)', () => {
    const prev = { a: { v: 'legacy' } };
    const cloud = { a: { v: 'cloud', _t: 1 } };
    const result = mergeMapByTime(prev, cloud);
    expect(result.a).toEqual({ v: 'cloud', _t: 1 });
  });

  it('returns the SAME prev reference when content is deep-equal', () => {
    const prev = { a: { v: 1, _t: 5 } };
    const cloud = { a: { v: 1, _t: 5 } };
    const result = mergeMapByTime(prev, cloud);
    expect(result).toBe(prev);
  });

  it('returns the SAME prev reference when merged result equals prev', () => {
    // cloud has strictly older data; merged ends up identical to prev
    const prev = { a: { v: 'local', _t: 10 } };
    const cloud = { a: { v: 'cloud', _t: 5 } };
    const result = mergeMapByTime(prev, cloud);
    expect(result).toBe(prev);
  });

  it('returns cloud when prev is not an object', () => {
    const cloud = { a: { v: 1, _t: 5 } };
    expect(mergeMapByTime(null, cloud)).toBe(cloud);
    expect(mergeMapByTime(undefined, cloud)).toBe(cloud);
  });

  it('returns prev when cloud is not an object', () => {
    const prev = { a: { v: 1, _t: 5 } };
    expect(mergeMapByTime(prev, null)).toBe(prev);
    expect(mergeMapByTime(prev, undefined)).toBe(prev);
  });
});

describe('mergeIdArrayByTime', () => {
  it('preserves a cloud-only id', () => {
    const prev = [{ id: 'a', v: 1, _t: 5 }];
    const cloud = [{ id: 'a', v: 1, _t: 5 }, { id: 'b', v: 2, _t: 3 }];
    const result = mergeIdArrayByTime(prev, cloud);
    expect(result).toEqual(expect.arrayContaining([
      { id: 'a', v: 1, _t: 5 },
      { id: 'b', v: 2, _t: 3 },
    ]));
    expect(result).toHaveLength(2);
  });

  it('preserves a local-only id', () => {
    const prev = [{ id: 'a', v: 1, _t: 5 }, { id: 'b', v: 2, _t: 3 }];
    const cloud = [{ id: 'a', v: 1, _t: 5 }];
    const result = mergeIdArrayByTime(prev, cloud);
    expect(result).toEqual(expect.arrayContaining([
      { id: 'a', v: 1, _t: 5 },
      { id: 'b', v: 2, _t: 3 },
    ]));
    expect(result).toHaveLength(2);
  });

  it('on conflict, the higher _t wins (local higher)', () => {
    const prev = [{ id: 'a', v: 'local', _t: 10 }];
    const cloud = [{ id: 'a', v: 'cloud', _t: 5 }];
    const result = mergeIdArrayByTime(prev, cloud);
    expect(result).toEqual([{ id: 'a', v: 'local', _t: 10 }]);
  });

  it('on conflict, the higher _t wins (cloud higher)', () => {
    const prev = [{ id: 'a', v: 'local', _t: 5 }];
    const cloud = [{ id: 'a', v: 'cloud', _t: 10 }];
    const result = mergeIdArrayByTime(prev, cloud);
    expect(result).toEqual([{ id: 'a', v: 'cloud', _t: 10 }]);
  });

  it('keeps local only when strictly greater; on a tie cloud/existing is kept', () => {
    const prev = [{ id: 'a', v: 'local', _t: 7 }];
    const cloud = [{ id: 'a', v: 'cloud', _t: 7 }];
    const result = mergeIdArrayByTime(prev, cloud);
    expect(result).toEqual([{ id: 'a', v: 'cloud', _t: 7 }]);
  });

  it('returns cloud when prev is not an array', () => {
    const cloud = [{ id: 'a', v: 1, _t: 5 }];
    expect(mergeIdArrayByTime(null, cloud)).toBe(cloud);
    expect(mergeIdArrayByTime(undefined, cloud)).toBe(cloud);
  });

  it('returns prev when cloud is not an array', () => {
    const prev = [{ id: 'a', v: 1, _t: 5 }];
    expect(mergeIdArrayByTime(prev, null)).toBe(prev);
    expect(mergeIdArrayByTime(prev, undefined)).toBe(prev);
  });

  it('returns the SAME prev reference when content is deep-equal', () => {
    const prev = [{ id: 'a', v: 1, _t: 5 }];
    const cloud = [{ id: 'a', v: 1, _t: 5 }];
    const result = mergeIdArrayByTime(prev, cloud);
    expect(result).toBe(prev);
  });

  it('returns the SAME prev reference when merged result equals prev', () => {
    // cloud is strictly older; merged stays identical to prev
    const prev = [{ id: 'a', v: 'local', _t: 10 }];
    const cloud = [{ id: 'a', v: 'cloud', _t: 5 }];
    const result = mergeIdArrayByTime(prev, cloud);
    expect(result).toBe(prev);
  });
});
