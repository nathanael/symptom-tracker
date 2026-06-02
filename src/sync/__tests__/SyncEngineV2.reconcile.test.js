import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// reconcile() heals drift between a device and the cloud by reading the REAL
// cloud (never trusting the optimistic shadow) and:
//   - pulling cloud-only records into local (union merge, existing path), and
//   - pushing up any local record the cloud is genuinely MISSING.
// It is ADDITIVE ONLY: it must never delete a record from the cloud, because a
// device whose local data is a subset of the cloud would otherwise erase the
// cloud's extra records. These tests pin both halves.

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

// --- Mock the field writer so we can assert exactly what gets written. ---
vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn(() => Promise.resolve({ ok: true, via: 'sdk' })),
}));

// --- Mock snapshots so reconcile doesn't touch localStorage for recovery. ---
const mockSaveSnapshot = vi.fn((label) => `snap_${label}`);
vi.mock('../../utils/snapshots', () => ({
  saveSnapshot: (label) => mockSaveSnapshot(label),
}));

// --- Mock Firestore: identity-stable refs that expose BOTH `.get()` (read
// path) and `.path` (write path), so _readCloud() and the flush both work. ---
let mockDefData; // definitions doc data object (or null)
let mockMonthDocs; // array of { id, data() }
let defDocRef;
let monthDocRefs;
let mockDbValue;

function buildMockDb() {
  monthDocRefs = {};
  defDocRef = {
    path: 'users/test-user/meta/definitions',
    __kind: 'defs',
    get: vi.fn(() => Promise.resolve(
      mockDefData
        ? { exists: true, data: () => mockDefData }
        : { exists: false, data: () => null },
    )),
  };
  const monthsCollectionRef = {
    get: vi.fn(() => Promise.resolve({ docs: mockMonthDocs })),
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

describe('SyncEngineV2 — reconcile (drift heal)', () => {
  let engine;
  let cloudUpdates;
  const FIXED_NOW = 1700000000000;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: true, via: 'sdk' }));
    mockSaveSnapshot.mockImplementation((label) => `snap_${label}`);
    cloudUpdates = [];
    mockDefData = null;
    mockMonthDocs = [];
    mockDbValue = buildMockDb();
  });

  afterEach(() => {
    if (engine) { engine.destroy(); engine = null; }
  });

  function createEngine() {
    engine = new SyncEngineV2('test-user', (domains, isInitial, opts) => {
      cloudUpdates.push({ domains, isInitial, opts });
    });
    engine._now = () => FIXED_NOW;
    engine._ready = true;
    return engine;
  }

  function callForDefs() {
    return writeFieldUpdates.mock.calls.find((c) => c[0] && c[0].__kind === 'defs');
  }

  it('pushes up a local symptom the cloud is missing (and does not delete the shared one)', async () => {
    // Cloud has only s1. Local has s1 + s2 (s2 never reached the cloud).
    mockDefData = { symptoms: { s1: { id: 's1', name: 'Headache', _t: 1 } } };
    createEngine();

    await engine.reconcile({
      symptoms: [
        { id: 's1', name: 'Headache', _t: 1 },
        { id: 's2', name: 'Itching', _t: 2 },
      ],
    });

    const call = callForDefs();
    expect(call).toBeTruthy();
    // s2 (cloud-missing) is written up, stamped with the write time...
    expect(call[1].updates['symptoms.s2']).toEqual({ id: 's2', name: 'Itching', _t: FIXED_NOW });
    // ...and the shared s1 is NOT re-written or deleted.
    expect('symptoms.s1' in call[1].updates).toBe(false);
    expect(call[1].deletes || []).not.toContain('symptoms.s1');
  });

  it('NEVER deletes from the cloud when local is a subset (the data-loss guard)', async () => {
    // Cloud has s1 + s2. This device's local only has s1 (it is behind).
    mockDefData = {
      symptoms: {
        s1: { id: 's1', name: 'Headache', _t: 1 },
        s2: { id: 's2', name: 'Itching', _t: 1 },
      },
    };
    createEngine();

    await engine.reconcile({ symptoms: [{ id: 's1', name: 'Headache', _t: 1 }] });

    // No write may delete s2 from the cloud.
    for (const c of writeFieldUpdates.mock.calls) {
      expect(c[1].deletes || []).not.toContain('symptoms.s2');
    }
    // And the missing s2 is pulled DOWN into local via the union emit.
    expect(cloudUpdates.length).toBeGreaterThan(0);
    const emitted = cloudUpdates[cloudUpdates.length - 1];
    const ids = (emitted.domains.symptoms || []).map((s) => s.id);
    expect(ids).toContain('s2');
  });
});
