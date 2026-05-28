import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock localStorage (same pattern as SyncEngine.test.js) ---
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: () => { store = {}; },
    _store: () => store,
    _set: (key, val) => { store[key] = val; },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

import {
  enqueueOp,
  listOps,
  removeOp,
  clearOutbox,
  OUTBOX_KEY,
  MAX_OPS,
} from '../outbox';

describe('outbox', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('enqueue + list round-trip preserves fields', () => {
    const stored = enqueueOp({
      docPath: 'users/u/months/2026-05',
      updates: { 'entries.k': { v: 1, _t: 5 } },
      deletes: ['entries.gone'],
      deleteBaseT: { 'entries.gone': 3 },
      ts: 1000,
    });
    expect(stored.id).toBeTruthy();
    const ops = listOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].docPath).toBe('users/u/months/2026-05');
    expect(ops[0].updates).toEqual({ 'entries.k': { v: 1, _t: 5 } });
    expect(ops[0].deletes).toEqual(['entries.gone']);
    expect(ops[0].deleteBaseT).toEqual({ 'entries.gone': 3 });
    expect(ops[0].ts).toBe(1000);
  });

  it('removeOp removes by id', () => {
    const a = enqueueOp({ docPath: 'p/a', updates: {}, deletes: [], deleteBaseT: {}, ts: 1 });
    const b = enqueueOp({ docPath: 'p/b', updates: {}, deletes: [], deleteBaseT: {}, ts: 2 });
    removeOp(a.id);
    const ops = listOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].id).toBe(b.id);
  });

  it('listOps returns oldest-first', () => {
    enqueueOp({ docPath: 'p/a', updates: {}, deletes: [], deleteBaseT: {}, ts: 1 });
    enqueueOp({ docPath: 'p/b', updates: {}, deletes: [], deleteBaseT: {}, ts: 2 });
    enqueueOp({ docPath: 'p/c', updates: {}, deletes: [], deleteBaseT: {}, ts: 3 });
    const ops = listOps();
    expect(ops.map((o) => o.docPath)).toEqual(['p/a', 'p/b', 'p/c']);
  });

  it('corrupt JSON in storage → listOps returns [] (no throw)', () => {
    localStorageMock._set(OUTBOX_KEY, '{not valid json');
    expect(() => listOps()).not.toThrow();
    expect(listOps()).toEqual([]);
  });

  it('non-array JSON in storage → listOps returns []', () => {
    localStorageMock._set(OUTBOX_KEY, '{"a":1}');
    expect(listOps()).toEqual([]);
  });

  it('listOps drops corrupt individual entries', () => {
    localStorageMock._set(
      OUTBOX_KEY,
      JSON.stringify([
        { id: '1', docPath: 'p/a', updates: {}, deletes: [], deleteBaseT: {}, ts: 1 },
        null,
        { foo: 'bar' }, // missing id/docPath
        { id: '2', docPath: 'p/b', updates: {}, deletes: [], deleteBaseT: {}, ts: 2 },
      ]),
    );
    const ops = listOps();
    expect(ops.map((o) => o.id)).toEqual(['1', '2']);
  });

  it('MAX_OPS bound drops oldest and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < MAX_OPS + 3; i++) {
      enqueueOp({ docPath: `p/${i}`, updates: {}, deletes: [], deleteBaseT: {}, ts: i });
    }
    const ops = listOps();
    expect(ops).toHaveLength(MAX_OPS);
    // Oldest (lowest ts) were dropped; newest retained.
    expect(ops[ops.length - 1].docPath).toBe(`p/${MAX_OPS + 2}`);
    expect(ops[0].docPath).toBe('p/3');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('clearOutbox empties the queue', () => {
    enqueueOp({ docPath: 'p/a', updates: {}, deletes: [], deleteBaseT: {}, ts: 1 });
    clearOutbox();
    expect(listOps()).toEqual([]);
  });

  it('enqueueOp does not throw when localStorage.setItem throws', () => {
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('quota'); });
    expect(() =>
      enqueueOp({ docPath: 'p/a', updates: {}, deletes: [], deleteBaseT: {}, ts: 1 }),
    ).not.toThrow();
  });
});
