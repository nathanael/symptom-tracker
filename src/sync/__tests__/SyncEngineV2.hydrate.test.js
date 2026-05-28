import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock Firestore ---
// We model a per-uid document that exposes two sub-collections:
//   meta/definitions  → defSnap { exists, data() }
//   months            → collection snapshot { docs: [{ id, data() }, ...] }
// getFirebaseDb() returns this mock db (or is overridden to null per-test).

let mockDefSnap = { exists: false, data: () => null };
let mockMonthDocs = []; // array of { id, data() }
let mockDefGet = vi.fn(() => Promise.resolve(mockDefSnap));
let mockMonthsGet = vi.fn(() => Promise.resolve({ docs: mockMonthDocs }));
let mockDbValue; // set in beforeEach

function buildMockDb() {
  const definitionsDocRef = { get: (...args) => mockDefGet(...args) };
  const monthsCollectionRef = { get: (...args) => mockMonthsGet(...args) };
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

import SyncEngineV2, { hasAnyData } from '../SyncEngineV2';

describe('SyncEngineV2 — initialize + hydrate', () => {
  let engine;
  let cloudUpdates;

  beforeEach(() => {
    vi.clearAllMocks();
    cloudUpdates = [];
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
    engine = new SyncEngineV2(uid, (domains, isInitial) => {
      cloudUpdates.push({ domains, isInitial });
    });
    return engine;
  }

  it('Test 1: hydrates definitions + months and emits initial cloud update', async () => {
    mockDefSnap = {
      exists: true,
      data: () => ({
        symptoms: {
          s1: { id: 's1', name: 'Headache', order: 0 },
          s2: { id: 's2', name: 'Fatigue', order: 1 },
        },
        trackingMode: 'ampm',
      }),
    };
    mockMonthDocs = [
      { id: '2026-03', data: () => ({ entries: { '2026-03-22': { headache: 3 } } }) },
      { id: '2026-04', data: () => ({ entries: { '2026-04-01': { headache: 5 } } }) },
    ];
    mockDefGet = vi.fn(() => Promise.resolve(mockDefSnap));
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: mockMonthDocs }));
    mockDbValue = buildMockDb();

    createEngine();
    const result = await engine.initialize();

    // Emitted exactly once, as the initial hydrate.
    expect(cloudUpdates.length).toBe(1);
    expect(cloudUpdates[0].isInitial).toBe(true);

    const domains = cloudUpdates[0].domains;
    // Entries flattened across both month docs.
    expect(domains.entries['2026-03-22']).toEqual({ headache: 3 });
    expect(domains.entries['2026-04-01']).toEqual({ headache: 5 });
    // symptoms as array.
    expect(Array.isArray(domains.symptoms)).toBe(true);
    expect(domains.symptoms.map(s => s.id)).toEqual(['s1', 's2']);
    // trackingMode as string.
    expect(domains.trackingMode).toBe('ampm');

    // Shadow populated with definitions as id-map.
    expect(engine._shadow.symptoms).toEqual({
      s1: { id: 's1', name: 'Headache', order: 0 },
      s2: { id: 's2', name: 'Fatigue', order: 1 },
    });

    expect(engine.isReady()).toBe(true);
    expect(result).toBeTruthy();
    expect(result.domains).toBe(domains);
  });

  it('Test 2: empty cloud (no definitions, no months) does NOT emit', async () => {
    mockDefSnap = { exists: false, data: () => null };
    mockMonthDocs = [];
    mockDefGet = vi.fn(() => Promise.resolve(mockDefSnap));
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: mockMonthDocs }));
    mockDbValue = buildMockDb();

    createEngine();
    await engine.initialize();

    expect(cloudUpdates.length).toBe(0);
    expect(engine.isReady()).toBe(true);
  });

  it('Test 3: no db → initialize returns null, ready, no emit', async () => {
    mockDbValue = null;
    createEngine();
    const result = await engine.initialize();

    expect(result).toBeNull();
    expect(engine.isReady()).toBe(true);
    expect(cloudUpdates.length).toBe(0);
  });

  it('Test 4: error during get() → returns null, sets syncError, ready, no throw', async () => {
    mockDefGet = vi.fn(() => Promise.reject(new Error('boom')));
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: [] }));
    mockDbValue = buildMockDb();

    createEngine();
    const result = await engine.initialize();

    expect(result).toBeNull();
    expect(engine.syncError).toBe('boom');
    expect(engine.isReady()).toBe(true);
    expect(cloudUpdates.length).toBe(0);
  });

  it('Test 5: destroy before hydrate completes guards the emit', async () => {
    mockDefSnap = {
      exists: true,
      data: () => ({ trackingMode: 'ampm' }),
    };
    // Defer the months read so we can destroy mid-flight.
    let releaseMonths;
    mockMonthsGet = vi.fn(() => new Promise((resolve) => {
      releaseMonths = () => resolve({ docs: [] });
    }));
    mockDefGet = vi.fn(() => Promise.resolve(mockDefSnap));
    mockDbValue = buildMockDb();

    createEngine();
    const initPromise = engine.initialize();

    // Destroy while the months get() is still pending.
    engine.destroy();
    expect(engine._destroyed).toBe(true);

    releaseMonths();
    await initPromise;

    // The destroyed guard must have skipped the emit.
    expect(cloudUpdates.length).toBe(0);
  });

  describe('hasAnyData', () => {
    it('returns false for the all-empty assembled shape', () => {
      expect(hasAnyData({
        entries: {}, stackEntries: {}, inputEntries: {}, dailyNotes: {},
        symptoms: [], stackItems: [], inputItems: [], pinnedSymptoms: [],
      })).toBe(false);
    });
    it('returns true when a map domain has keys', () => {
      expect(hasAnyData({ entries: { '2026-03-22': { x: 1 } }, symptoms: [] })).toBe(true);
    });
    it('returns true when an array domain is non-empty', () => {
      expect(hasAnyData({ entries: {}, symptoms: [{ id: 's1' }] })).toBe(true);
    });
    it('returns true when trackingMode is present', () => {
      expect(hasAnyData({ entries: {}, symptoms: [], trackingMode: 'ampm' })).toBe(true);
    });
  });
});
