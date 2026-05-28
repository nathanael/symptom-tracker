import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock Firestore with realtime listeners ---
// Each ref (months collection, definitions doc) supports BOTH:
//   .get({source})            → resolves the current snapshot (for initialize())
//   .onSnapshot(cb, errCb)    → stores cb/errCb so the test can fire snapshots
//                               manually, and returns an unsubscribe spy.
// The stored callbacks live in `listeners` so tests can drive them.

let mockDefSnap;   // { exists, data() }
let mockMonthDocs; // array of { id, data() }
let mockDefGet;
let mockMonthsGet;
let mockDbValue;

let listeners; // { months: {cb, errCb, unsub}, defs: {cb, errCb, unsub} }

function buildMockDb() {
  const definitionsDocRef = {
    get: (...args) => mockDefGet(...args),
    onSnapshot: vi.fn((cb, errCb) => {
      const unsub = vi.fn();
      listeners.defs = { cb, errCb, unsub };
      return unsub;
    }),
  };
  const monthsCollectionRef = {
    get: (...args) => mockMonthsGet(...args),
    onSnapshot: vi.fn((cb, errCb) => {
      const unsub = vi.fn();
      listeners.months = { cb, errCb, unsub };
      return unsub;
    }),
  };
  const metaCollectionRef = { doc: vi.fn(() => definitionsDocRef) };
  const userDocRef = {
    collection: vi.fn((name) => {
      if (name === 'meta') return metaCollectionRef;
      if (name === 'months') return monthsCollectionRef;
      throw new Error(`unexpected collection: ${name}`);
    }),
  };
  return {
    collection: vi.fn(() => ({
      doc: vi.fn(() => userDocRef),
    })),
  };
}

vi.mock('../../utils/firebase', () => ({
  getFirebaseDb: () => mockDbValue,
}));

import SyncEngineV2 from '../SyncEngineV2';

// Helpers to build snapshot-shaped objects for the manual callbacks.
function monthsSnap(docs) {
  // docs: array of { id, data } (plain data) → snapshot with docs[].data()
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}
function defsSnap(data) {
  return data == null
    ? { exists: false, data: () => null }
    : { exists: true, data: () => data };
}

describe('SyncEngineV2 — realtime listener', () => {
  let engine;
  let cloudUpdates;

  beforeEach(() => {
    vi.clearAllMocks();
    cloudUpdates = [];
    listeners = {};
    mockDefSnap = { exists: false, data: () => null };
    mockMonthDocs = [];
    mockDefGet = vi.fn(() => Promise.resolve(mockDefSnap));
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: mockMonthDocs }));
    mockDbValue = buildMockDb();
  });

  afterEach(() => {
    if (engine) {
      engine.destroy();
      engine = null;
    }
  });

  function createEngine(uid = 'test-user') {
    engine = new SyncEngineV2(uid, (domains, isInitial, opts) => {
      cloudUpdates.push({ domains, isInitial, opts });
    });
    return engine;
  }

  // Initialize with the cloud containing the given entries map (key→value+_t)
  // and optional defs data. Leaves `cloudUpdates` holding the initial emit.
  async function initWith({ entries = {}, defs = null } = {}) {
    mockMonthDocs = Object.keys(entries).length
      ? [{ id: '2026-03', data: () => ({ entries }) }]
      : [];
    mockDefSnap = defs == null
      ? { exists: false, data: () => null }
      : { exists: true, data: () => defs };
    mockDefGet = vi.fn(() => Promise.resolve(mockDefSnap));
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: mockMonthDocs }));
    mockDbValue = buildMockDb();
    createEngine();
    await engine.initialize();
  }

  it('Test 1: echo suppression — identical months snapshot does NOT re-emit', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });
    expect(cloudUpdates.length).toBe(1); // initial
    expect(cloudUpdates[0].isInitial).toBe(true);

    // Fire a months snapshot delivering the SAME data.
    listeners.months.cb(monthsSnap([{ id: '2026-03', data: { entries: { A: { v: 1, _t: 100 } } } }]));

    // No new emit — our own echo / no-op is suppressed.
    expect(cloudUpdates.length).toBe(1);
  });

  it('Test 2: cloud add — new key K appears, emitted with no deletes', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });
    expect(cloudUpdates.length).toBe(1);

    listeners.months.cb(monthsSnap([{ id: '2026-03', data: {
      entries: { A: { v: 1, _t: 100 }, K: { v: 9, _t: 200 } },
    } }]));

    expect(cloudUpdates.length).toBe(2);
    const u = cloudUpdates[1];
    expect(u.isInitial).toBe(false);
    expect(u.domains.entries.A).toEqual({ v: 1, _t: 100 });
    expect(u.domains.entries.K).toEqual({ v: 9, _t: 200 });
    // No deletes for an add.
    expect(u.opts.deletes.entries || []).toEqual([]);
  });

  it('Test 3: remote delete — key B removed from cloud reported in deletes', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 }, B: { v: 2, _t: 100 } } });
    expect(cloudUpdates.length).toBe(1);

    listeners.months.cb(monthsSnap([{ id: '2026-03', data: {
      entries: { A: { v: 1, _t: 100 } },
    } }]));

    expect(cloudUpdates.length).toBe(2);
    const u = cloudUpdates[1];
    expect(u.isInitial).toBe(false);
    expect(u.opts.deletes.entries).toEqual(['B']);
    expect(u.domains.entries.A).toEqual({ v: 1, _t: 100 });
    expect('B' in u.domains.entries).toBe(false);
  });

  it('Test 4: cloud value change — newer _t + different value emitted, no deletes', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });
    expect(cloudUpdates.length).toBe(1);

    listeners.months.cb(monthsSnap([{ id: '2026-03', data: {
      entries: { A: { v: 2, _t: 200 } },
    } }]));

    expect(cloudUpdates.length).toBe(2);
    const u = cloudUpdates[1];
    expect(u.domains.entries.A).toEqual({ v: 2, _t: 200 });
    expect(u.opts.deletes.entries || []).toEqual([]);
  });

  it('Test 5: CLOBBER GUARD — engine never emits a delete for a key not in its shadow', async () => {
    // The engine's shadow knows only {A}. React/local may hold a pending key X
    // the engine has NEVER seen. When the cloud snapshot delivers {A, K}, the
    // engine must compute deletes ONLY from (old cloud shadow) MINUS (new cloud),
    // i.e. {A} minus {A,K} = nothing deleted. It must NOT instruct the hook to
    // drop X — X is invisible to the engine and never appears in deletes.
    // This is the clobber-prevention guarantee at the ENGINE layer; the
    // end-to-end React preservation of local pending edits is verified in the
    // hook task (Task 12).
    await initWith({ entries: { A: { v: 1, _t: 100 } } });
    expect(cloudUpdates.length).toBe(1);

    listeners.months.cb(monthsSnap([{ id: '2026-03', data: {
      entries: { A: { v: 1, _t: 100 }, K: { v: 9, _t: 200 } },
    } }]));

    expect(cloudUpdates.length).toBe(2);
    const u = cloudUpdates[1];
    // No deletes whatsoever (no key was in old-cloud but absent in new-cloud).
    const allDeletes = Object.values(u.opts.deletes).flat();
    expect(allDeletes).toEqual([]);
    expect(u.domains.entries.A).toBeTruthy();
    expect(u.domains.entries.K).toBeTruthy();
  });

  it('Test 6: definitions change — trackingMode updated and emitted', async () => {
    await initWith({ entries: {}, defs: { trackingMode: 'ampm' } });
    // Initial emit happened (trackingMode present → hasAnyData true).
    expect(cloudUpdates.length).toBe(1);
    expect(cloudUpdates[0].domains.trackingMode).toBe('ampm');

    listeners.defs.cb(defsSnap({ trackingMode: { value: 'daily', _t: 300 } }));

    expect(cloudUpdates.length).toBe(2);
    const u = cloudUpdates[1];
    expect(u.isInitial).toBe(false);
    expect(u.domains.trackingMode).toBe('daily');
  });

  it('Test 7: definitions delete — removed symptom id reported in deletes', async () => {
    await initWith({
      entries: {},
      defs: { symptoms: { s1: { id: 's1', name: 'A' }, s2: { id: 's2', name: 'B' } } },
    });
    expect(cloudUpdates.length).toBe(1);

    listeners.defs.cb(defsSnap({ symptoms: { s1: { id: 's1', name: 'A' } } }));

    expect(cloudUpdates.length).toBe(2);
    const u = cloudUpdates[1];
    expect(u.opts.deletes.symptoms).toEqual(['s2']);
    expect(u.domains.symptoms.map((s) => s.id)).toEqual(['s1']);
  });

  it('Test 8: destroy() unsubscribes both listeners', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });
    expect(listeners.months.unsub).not.toHaveBeenCalled();
    expect(listeners.defs.unsub).not.toHaveBeenCalled();

    engine.destroy();

    expect(listeners.months.unsub).toHaveBeenCalled();
    expect(listeners.defs.unsub).toHaveBeenCalled();
  });

  it('Test 9: listener error callback sets syncError and does not throw', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });

    expect(() => listeners.months.errCb(new Error('listen boom'))).not.toThrow();
    expect(engine.syncError).toBe('listen boom');
    // An error must not have produced a spurious cloud update.
    expect(cloudUpdates.length).toBe(1);
  });
});
