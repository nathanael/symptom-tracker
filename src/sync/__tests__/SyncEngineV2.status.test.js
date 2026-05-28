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

// --- Mock the field writer so flush() succeeds deterministically. ---
vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn(() => Promise.resolve({ ok: true, via: 'sdk' })),
}));

// Mock snapshots so forcePull doesn't touch real localStorage.
vi.mock('../../utils/snapshots', () => ({
  saveSnapshot: vi.fn((label) => `snap_${label}`),
}));

// --- Mock Firestore with both .get() (initialize/forcePull) and .onSnapshot()
// (listener) support so we can drive listener error callbacks manually. ---
let mockDbValue;
let monthDocRefs;
let defDocRef;
let listeners; // { months: {cb, errCb}, defs: {cb, errCb} }

let mockDefSnap;
let mockMonthDocs;

function buildMockDb() {
  monthDocRefs = {};
  defDocRef = { path: 'users/test-user/meta/definitions', __kind: 'defs' };
  listeners = {};

  const definitionsDocRef = {
    path: 'users/test-user/meta/definitions',
    __kind: 'defs',
    get: vi.fn(() => Promise.resolve(mockDefSnap)),
    onSnapshot: vi.fn((cb, errCb) => {
      const unsub = vi.fn();
      listeners.defs = { cb, errCb, unsub };
      return unsub;
    }),
  };
  defDocRef = definitionsDocRef;

  const monthsCollectionRef = {
    get: vi.fn(() => Promise.resolve({ docs: mockMonthDocs })),
    onSnapshot: vi.fn((cb, errCb) => {
      const unsub = vi.fn();
      listeners.months = { cb, errCb, unsub };
      return unsub;
    }),
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
  const metaCollectionRef = { doc: vi.fn(() => definitionsDocRef) };
  const userDocRef = {
    collection: vi.fn((name) => {
      if (name === 'meta') return metaCollectionRef;
      if (name === 'months') return monthsCollectionRef;
      throw new Error(`unexpected collection: ${name}`);
    }),
  };
  return {
    collection: vi.fn(() => ({ doc: vi.fn(() => userDocRef) })),
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

describe('SyncEngineV2 — status emission (onStatusChange)', () => {
  let engine;
  const FIXED_NOW = 1700000000000;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: true, via: 'sdk' }));
    mockDefSnap = { exists: false, data: () => null };
    mockMonthDocs = [];
    mockDbValue = buildMockDb();
  });

  afterEach(() => {
    if (engine) { engine.destroy(); engine = null; }
  });

  // Build a ready engine with a fixed clock + seeded shadow, no async init.
  function makeEngine(shadow = {}) {
    engine = new SyncEngineV2('test-user', () => {});
    engine._now = () => FIXED_NOW;
    engine._ready = true;
    engine._shadow = shadow;
    return engine;
  }

  it('flush emits syncing:true then syncing:false and stamps lastSynced', async () => {
    makeEngine({ entries: {} });
    const onStatus = vi.fn();
    engine.onStatusChange = onStatus;

    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    await engine.flushNow();

    const states = onStatus.mock.calls.map((c) => c[0]);
    // Saw syncing:true at some point.
    expect(states.some((s) => s.syncing === true)).toBe(true);
    // Last emitted state is syncing:false.
    expect(states[states.length - 1].syncing).toBe(false);
    // lastSynced is a Date after a successful flush.
    expect(engine.lastSynced).toBeInstanceOf(Date);
    expect(states[states.length - 1].lastSynced).toBeInstanceOf(Date);
  });

  it('forcePull merge toggles syncing true then false', async () => {
    makeEngine({});
    const onStatus = vi.fn();
    engine.onStatusChange = onStatus;

    await engine.forcePull({ destructive: false });

    const states = onStatus.mock.calls.map((c) => c[0]);
    expect(states.some((s) => s.syncing === true)).toBe(true);
    expect(states[states.length - 1].syncing).toBe(false);
    expect(engine.lastSynced).toBeInstanceOf(Date);
  });

  it('forcePush toggles syncing true then false', async () => {
    makeEngine({ entries: {} });
    const onStatus = vi.fn();
    engine.onStatusChange = onStatus;

    await engine.forcePush({ entries: { '2026-03-15-a': { v: 1 } } });

    const states = onStatus.mock.calls.map((c) => c[0]);
    expect(states.some((s) => s.syncing === true)).toBe(true);
    expect(states[states.length - 1].syncing).toBe(false);
  });

  it('listener error sets a syncError string and does not throw', async () => {
    engine = new SyncEngineV2('test-user', () => {});
    await engine.initialize(); // sets up listeners
    const onStatus = vi.fn();
    engine.onStatusChange = onStatus;

    expect(() => {
      listeners.months.errCb(new Error('permission-denied'));
    }).not.toThrow();

    expect(typeof engine.syncError).toBe('string');
    expect(engine.syncError).toContain('permission-denied');
    const states = onStatus.mock.calls.map((c) => c[0]);
    expect(states.some((s) => typeof s.syncError === 'string' && s.syncError)).toBe(true);
  });
});
