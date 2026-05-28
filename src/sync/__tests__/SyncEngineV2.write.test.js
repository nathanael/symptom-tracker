import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock localStorage (the durable outbox persists failed flushes here). ---
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

// --- Mock the field writer so we control its result and assert its args. ---
vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn(() => Promise.resolve({ ok: true, via: 'sdk' })),
}));

// --- Mock Firestore. We need stable, identity-comparable doc refs per path so
// the engine groups writes per doc and the test can assert which ref was used.
// Each month doc ref carries a `.path`; the definitions doc ref carries its own.
let mockDbValue;
let monthDocRefs; // monthId -> ref
let defDocRef;

function buildMockDb() {
  monthDocRefs = {};
  defDocRef = { path: 'users/test-user/meta/definitions', __kind: 'defs' };

  const monthsCollectionRef = {
    get: vi.fn(() => Promise.resolve({ docs: [] })),
    onSnapshot: vi.fn(() => vi.fn()),
    doc: vi.fn((monthId) => {
      if (!monthDocRefs[monthId]) {
        monthDocRefs[monthId] = {
          path: `users/test-user/months/${monthId}`,
          __kind: 'month',
          __month: monthId,
        };
      }
      return monthDocRefs[monthId];
    }),
  };
  const metaCollectionRef = { doc: vi.fn(() => defDocRef) };
  const userDocRef = {
    collection: vi.fn((name) => {
      if (name === 'meta') return metaCollectionRef;
      if (name === 'months') return monthsCollectionRef;
      throw new Error(`unexpected collection: ${name}`);
    }),
  };
  return {
    collection: vi.fn(() => ({ doc: vi.fn(() => userDocRef) })),
    // Outbox replay rebuilds refs from a full path; map them back to the same
    // identity-stable refs the write path uses so .path-based assertions match.
    doc: vi.fn((fullPath) => {
      if (fullPath === defDocRef.path) return defDocRef;
      const monthId = fullPath.split('/').pop();
      if (!monthDocRefs[monthId]) {
        monthDocRefs[monthId] = {
          path: `users/test-user/months/${monthId}`,
          __kind: 'month',
          __month: monthId,
        };
      }
      return monthDocRefs[monthId];
    }),
  };
}

vi.mock('../../utils/firebase', () => ({
  getFirebaseDb: () => mockDbValue,
}));

import SyncEngineV2 from '../SyncEngineV2';
import { writeFieldUpdates } from '../fieldWriter';
import { listOps } from '../outbox';

describe('SyncEngineV2 — granular write path', () => {
  let engine;
  let cloudUpdates;
  const FIXED_NOW = 1700000000000;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: true, via: 'sdk' }));
    cloudUpdates = [];
    mockDbValue = buildMockDb();
  });

  afterEach(() => {
    if (engine) {
      engine.destroy();
      engine = null;
    }
  });

  // Build an engine with a fixed clock + ready state + a seeded shadow, without
  // running the async initialize() (which would also start listeners).
  function makeEngine(shadow = {}) {
    engine = new SyncEngineV2('test-user', (domains, isInitial, opts) => {
      cloudUpdates.push({ domains, isInitial, opts });
    });
    engine._now = () => FIXED_NOW;
    engine._ready = true;
    engine._shadow = shadow;
    return engine;
  }

  // Find the single writeFieldUpdates call whose docRef matches a month id.
  function callForMonth(monthId) {
    return writeFieldUpdates.mock.calls.find(
      (c) => c[0] && c[0].__month === monthId,
    );
  }
  function callForDefs() {
    return writeFieldUpdates.mock.calls.find(
      (c) => c[0] && c[0].__kind === 'defs',
    );
  }

  it('Test 1: single entry tap → one write to correct month doc', async () => {
    makeEngine({ entries: {} });
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    await engine.flushNow();

    expect(writeFieldUpdates).toHaveBeenCalledTimes(1);
    const call = callForMonth('2026-03');
    expect(call).toBeTruthy();
    const payload = call[1];
    expect(payload.updates).toEqual({
      'entries.2026-03-15-a': { v: 1, _t: FIXED_NOW },
    });
    expect(payload.deletes || []).toEqual([]);
  });

  it('Test 2: dailyNotes uses the `notes` field, not dailyNotes', async () => {
    makeEngine({ dailyNotes: {} });
    engine.notifyLocalChange('dailyNotes', { '2026-03-15': { text: 'hi' } });
    await engine.flushNow();

    const call = callForMonth('2026-03');
    expect(call).toBeTruthy();
    expect(call[1].updates).toEqual({
      'notes.2026-03-15': { text: 'hi', _t: FIXED_NOW },
    });
  });

  it('Test 3: a removed key produces a delete field path', async () => {
    makeEngine({ entries: { '2026-03-15-a': { v: 1, _t: 1 }, '2026-03-16-b': { v: 2, _t: 1 } } });
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1, _t: 1 } });
    await engine.flushNow();

    const call = callForMonth('2026-03');
    expect(call).toBeTruthy();
    expect(call[1].deletes).toContain('entries.2026-03-16-b');
    expect(call[1].updates).toEqual({});
  });

  it('Test 4: edits spanning two months → one write per month doc', async () => {
    makeEngine({ entries: {} });
    engine.notifyLocalChange('entries', {
      '2026-03-15-a': { v: 1 },
      '2026-04-02-b': { v: 2 },
    });
    await engine.flushNow();

    expect(writeFieldUpdates).toHaveBeenCalledTimes(2);
    const mar = callForMonth('2026-03');
    const apr = callForMonth('2026-04');
    expect(mar[1].updates).toEqual({ 'entries.2026-03-15-a': { v: 1, _t: FIXED_NOW } });
    expect(apr[1].updates).toEqual({ 'entries.2026-04-02-b': { v: 2, _t: FIXED_NOW } });
  });

  it('Test 5: hiding a stackItem writes only that id; shadow updated → echo suppressed', async () => {
    const id = 'stk1';
    makeEngine({ stackItems: { [id]: { id, name: 'Vit', active: true, _t: 1 } } });
    engine.notifyLocalChange('stackItems', [{ id, name: 'Vit', active: false }]);
    await engine.flushNow();

    const call = callForDefs();
    expect(call).toBeTruthy();
    expect(call[1].updates).toEqual({
      [`stackItems.${id}`]: { id, name: 'Vit', active: false, _t: FIXED_NOW },
    });

    // Shadow now reflects active:false — the supplement-hide regression guard.
    expect(engine._shadow.stackItems[id].active).toBe(false);

    // Echo suppression: a cloud snapshot equal to the shadow does NOT re-emit.
    const before = cloudUpdates.length;
    engine._onCloudChanged('defs', {
      exists: true,
      data: () => ({ stackItems: { [id]: { id, name: 'Vit', active: false, _t: FIXED_NOW } } }),
    });
    expect(cloudUpdates.length).toBe(before);
  });

  it('Test 6: trackingMode change writes a {value,_t} field on defs', async () => {
    makeEngine({ trackingMode: { value: 'ampm', _t: 1 } });
    engine.notifyLocalChange('trackingMode', 'daily');
    await engine.flushNow();

    const call = callForDefs();
    expect(call[1].updates).toEqual({
      trackingMode: { value: 'daily', _t: FIXED_NOW },
    });
    expect(engine._shadow.trackingMode).toEqual({ value: 'daily', _t: FIXED_NOW });
  });

  it('Test 7: pinnedSymptoms change writes the whole field', async () => {
    makeEngine({ pinnedSymptoms: ['a'] });
    engine.notifyLocalChange('pinnedSymptoms', ['a', 'b']);
    await engine.flushNow();

    const call = callForDefs();
    expect(call[1].updates).toEqual({ pinnedSymptoms: ['a', 'b'] });
    expect(engine._shadow.pinnedSymptoms).toEqual(['a', 'b']);
  });

  it('Test 8: shadow update creates fresh objects, never mutates the hydrated map', async () => {
    const hydratedEntries = { '2026-03-15-a': { v: 1, _t: 1 } };
    makeEngine({ entries: hydratedEntries });
    const original = engine._shadow.entries; // capture reference emitted at hydrate

    engine.notifyLocalChange('entries', {
      '2026-03-15-a': { v: 1, _t: 1 },
      '2026-03-16-b': { v: 2 },
    });
    await engine.flushNow();

    // The new shadow has the new key...
    expect(engine._shadow.entries['2026-03-16-b']).toBeTruthy();
    // ...but the original object reference was NOT mutated.
    expect(original).toBe(hydratedEntries);
    expect('2026-03-16-b' in original).toBe(false);
    expect(Object.keys(original)).toEqual(['2026-03-15-a']);
  });

  it('Test 9: write-side clobber guarantee — only the edited key is touched', async () => {
    makeEngine({ entries: { '2026-03-15-a': { v: 1, _t: 1 }, '2026-03-20-c': { v: 3, _t: 1 } } });
    // Edit only the existing 'a' key; 'c' is unchanged.
    engine.notifyLocalChange('entries', {
      '2026-03-15-a': { v: 99, _t: 1 },
      '2026-03-20-c': { v: 3, _t: 1 },
    });
    await engine.flushNow();

    const call = callForMonth('2026-03');
    const updateKeys = Object.keys(call[1].updates);
    expect(updateKeys).toEqual(['entries.2026-03-15-a']);
    expect(call[1].deletes || []).toEqual([]);
  });

  it('Test 10: {ok:false} persists the write to the durable outbox; replay retries it', async () => {
    makeEngine({ entries: {} });
    writeFieldUpdates.mockImplementationOnce(() => Promise.resolve({ ok: false, error: 'boom' }));

    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    await engine.flush();
    expect(writeFieldUpdates).toHaveBeenCalledTimes(1);
    // Failed write is durably queued in the outbox, NOT kept in memory.
    expect(Object.keys(engine._pending).length).toBe(0);
    expect(listOps()).toHaveLength(1);

    // replayOutbox retries the same write (now succeeds) and clears the outbox.
    await engine.replayOutbox();
    expect(writeFieldUpdates).toHaveBeenCalledTimes(2);
    const retry = writeFieldUpdates.mock.calls[1];
    expect(retry[1].updates).toEqual({ 'entries.2026-03-15-a': { v: 1, _t: FIXED_NOW } });
    expect(listOps()).toHaveLength(0);
  });

  it('Test 11: no-op — data deep-equal to shadow does not write', async () => {
    makeEngine({ entries: { '2026-03-15-a': { v: 1, _t: 1 } } });
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1, _t: 999 } });
    await engine.flushNow();
    expect(writeFieldUpdates).not.toHaveBeenCalled();
  });

  // --- Fix 1: flushNow() durability while a flush is in flight ---------------
  it('Fix1: flushNow drains an in-flight flush + later pending edits (no edit dropped)', async () => {
    makeEngine({ entries: {} });

    // First writeFieldUpdates call hangs until we resolve it manually; the rest
    // succeed immediately.
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    writeFieldUpdates.mockImplementationOnce(
      () => firstGate.then(() => ({ ok: true, via: 'sdk' })),
    );

    // Enqueue an edit and start a (debounced) flush manually so it is mid-await.
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    const inflight = engine.flush(); // begins, awaits the gated writeFieldUpdates

    // While that flush is in flight, more edits arrive (different month) — they
    // sit in _pending behind a setTimeout that won't fire before unload.
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 }, '2026-04-02-b': { v: 2 } });

    // flushNow must NOT resolve until BOTH the in-flight flush and the newly
    // pending edits are written.
    const drained = engine.flushNow();
    releaseFirst();
    await Promise.all([inflight, drained]);

    // Every edited key was ultimately written.
    const mar = callForMonth('2026-03');
    const apr = callForMonth('2026-04');
    expect(mar).toBeTruthy();
    expect(apr).toBeTruthy();
    expect(apr[1].updates).toEqual({ 'entries.2026-04-02-b': { v: 2, _t: FIXED_NOW } });
    // Nothing left pending after flushNow resolves.
    expect(Object.keys(engine._pending).length).toBe(0);
  });

  it('Fix1: flushNow drain is bounded (a failed write moves to the durable outbox, not an in-memory spin)', async () => {
    makeEngine({ entries: {} });
    // Every write fails. With the durable outbox, a failed flush no longer
    // re-queues in memory — it persists to the outbox and clears _pending — so
    // flushNow terminates naturally instead of spinning, and the call count is
    // bounded.
    writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: false, error: 'boom' }));

    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    await engine.flushNow(); // must resolve (bounded), not hang.

    // Nothing left in memory; the failed write is durably persisted instead.
    expect(Object.keys(engine._pending).length).toBe(0);
    expect(listOps()).toHaveLength(1);
    expect(writeFieldUpdates.mock.calls.length).toBeLessThanOrEqual(6);
  });

  // --- Fix 2: _t-guarded deletes --------------------------------------------
  it('Fix2(a): delete with no concurrent remote change proceeds', async () => {
    makeEngine({ entries: { '2026-03-15-a': { v: 1, _t: 1 }, '2026-03-16-b': { v: 2, _t: 1 } } });
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1, _t: 1 } });
    await engine.flushNow();

    const call = callForMonth('2026-03');
    expect(call[1].deletes).toContain('entries.2026-03-16-b');
    // Deleted from shadow.
    expect('2026-03-16-b' in engine._shadow.entries).toBe(false);
  });

  it('Fix2(b): a newer remote write after the delete decision SKIPS the delete', async () => {
    makeEngine({ entries: { '2026-03-16-b': { v: 2, _t: 10 } } });
    // User deletes b (based on seeing _t:10).
    engine.notifyLocalChange('entries', {});

    // Before flush, a NEWER remote version of b arrives and advances the shadow.
    engine._shadow.entries = { '2026-03-16-b': { v: 999, _t: 50 } };

    await engine.flushNow();

    // The delete must be skipped: either no write, or a write without the delete.
    const call = callForMonth('2026-03');
    if (call) {
      expect(call[1].deletes || []).not.toContain('entries.2026-03-16-b');
    }
    // And b must NOT have been removed from the shadow.
    expect(engine._shadow.entries['2026-03-16-b']).toEqual({ v: 999, _t: 50 });
  });

  // --- Fix 3: write-path data-loss tripwires --------------------------------
  it('Fix3(i): same key edited twice in one window → one update with the SECOND value', async () => {
    makeEngine({ entries: {} });
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 2 } });
    await engine.flushNow();

    const call = callForMonth('2026-03');
    expect(call[1].updates).toEqual({ 'entries.2026-03-15-a': { v: 2, _t: FIXED_NOW } });
  });

  it('Fix3(ii): write-then-delete in one window → delete only, absent from shadow', async () => {
    makeEngine({ entries: {} });
    engine.notifyLocalChange('entries', { '2026-03-15-x': { v: 1 } });
    engine.notifyLocalChange('entries', {}); // delete x
    await engine.flushNow();

    const call = callForMonth('2026-03');
    if (call) {
      expect(call[1].deletes).toContain('entries.2026-03-15-x');
      expect('entries.2026-03-15-x' in call[1].updates).toBe(false);
    }
    expect(engine._shadow.entries && '2026-03-15-x' in engine._shadow.entries).toBeFalsy();
  });

  it('Fix3(iii): delete-then-re-add in one window → update only, present in shadow', async () => {
    makeEngine({ entries: { '2026-03-15-a': { v: 1, _t: 1 } } });
    engine.notifyLocalChange('entries', {}); // delete a
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 5 } }); // re-add a
    await engine.flushNow();

    const call = callForMonth('2026-03');
    expect(call[1].updates).toEqual({ 'entries.2026-03-15-a': { v: 5, _t: FIXED_NOW } });
    expect(call[1].deletes || []).not.toContain('entries.2026-03-15-a');
    expect(engine._shadow.entries['2026-03-15-a']).toEqual({ v: 5, _t: FIXED_NOW });
  });

  it('Fix3(iv): failed-flush re-queue then re-add → retry sends update, no delete', async () => {
    makeEngine({ entries: { '2026-03-15-a': { v: 1, _t: 1 } } });
    writeFieldUpdates.mockImplementationOnce(() => Promise.resolve({ ok: false, error: 'boom' }));

    engine.notifyLocalChange('entries', {}); // delete a → flush fails → re-queued
    await engine.flush(); // single attempt (draining flushNow would auto-retry)
    expect(writeFieldUpdates).toHaveBeenCalledTimes(1);

    // Before retry, the user re-adds a.
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 7 } });
    await engine.flushNow();

    const retry = writeFieldUpdates.mock.calls[writeFieldUpdates.mock.calls.length - 1];
    expect(retry[1].updates).toEqual({ 'entries.2026-03-15-a': { v: 7, _t: FIXED_NOW } });
    expect(retry[1].deletes || []).not.toContain('entries.2026-03-15-a');
  });

  it('Fix3(v): pre-flush cross-path guard — interleaved cloud snapshot cannot clobber a pending local add', async () => {
    const A = '2026-03-10-a';
    const K = '2026-03-12-k';
    const X = '2026-03-15-x';
    makeEngine({ entries: { [A]: { v: 1, _t: 1 } } });

    // Local add X, do NOT flush.
    engine.notifyLocalChange('entries', { [A]: { v: 1, _t: 1 }, [X]: { v: 2 } });

    // A cloud snapshot delivers {A, K} (K is new from cloud; X never in cloud).
    const before = cloudUpdates.length;
    engine._onCloudChanged('months', {
      docs: [
        {
          id: '2026-03',
          data: () => ({ entries: { [A]: { v: 1, _t: 1 }, [K]: { v: 3, _t: 5 } } }),
        },
      ],
    });

    // The emitted deletes opt must be EMPTY: X is local-only and was never in
    // the shadow, so it can never be deleted by a cloud diff.
    const emitted = cloudUpdates[cloudUpdates.length - 1];
    expect(cloudUpdates.length).toBe(before + 1);
    expect(emitted.opts && emitted.opts.deletes).toEqual({});

    // X is still pending.
    const monthEntry = engine._pending['users/test-user/months/2026-03'];
    expect(monthEntry).toBeTruthy();
    expect(`entries.${X}` in monthEntry.updates).toBe(true);

    // Flushing now writes only entries.X.
    await engine.flushNow();
    const call = callForMonth('2026-03');
    expect(Object.keys(call[1].updates)).toEqual([`entries.${X}`]);
    expect(call[1].updates[`entries.${X}`]).toEqual({ v: 2, _t: FIXED_NOW });
  });
});
