import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock migrationV2 so we can drive needsMigration/readLocalDomains/runMigration. ---
vi.mock('../migrationV2', () => ({
  needsMigration: vi.fn(() => false),
  readLocalDomains: vi.fn(() => ({})),
  runMigration: vi.fn(() => Promise.resolve({ migrated: false, reason: 'empty' })),
}));

// --- Mock the snapshot util (irrelevant to boot but imported transitively). ---
vi.mock('../../utils/snapshots', () => ({
  saveSnapshot: vi.fn(() => 'snap-id'),
}));

// --- Mock Firestore ---------------------------------------------------------
// Per-uid user doc exposes:
//   .get()                         → legacy blob snapshot (users/{uid})
//   .collection('meta').doc('definitions').get()  → defSnap
//   .collection('meta').doc('_migration').get()   → migrationSnap
//   .collection('months').get()    → { docs: [...] }
//   .collection('months').onSnapshot / meta.definitions onSnapshot → no-op
let mockDefSnap;
let mockMonthDocs;
let mockMigrationSnap;
let mockBlobSnap;
let mockDefGet;
let mockMonthsGet;
let mockMigrationGet;
let mockBlobGet;
let mockDbValue;
// Captures the months-collection onSnapshot callback so a test can simulate
// Firestore firing it on subscribe (real Firestore fires immediately).
let capturedMonthsOnSnapshot;

function buildMockDb() {
  const definitionsDocRef = {
    get: (...a) => mockDefGet(...a),
    onSnapshot: vi.fn(() => () => {}),
  };
  const migrationDocRef = { get: (...a) => mockMigrationGet(...a) };
  const monthsCollectionRef = {
    get: (...a) => mockMonthsGet(...a),
    onSnapshot: vi.fn((cb) => {
      capturedMonthsOnSnapshot = cb;
      return () => {};
    }),
  };
  const metaCollectionRef = {
    doc: vi.fn((name) => {
      if (name === 'definitions') return definitionsDocRef;
      if (name === '_migration') return migrationDocRef;
      throw new Error(`unexpected meta doc: ${name}`);
    }),
  };
  const userDocRef = {
    get: (...a) => mockBlobGet(...a),
    collection: vi.fn((name) => {
      if (name === 'meta') return metaCollectionRef;
      if (name === 'months') return monthsCollectionRef;
      throw new Error(`unexpected collection: ${name}`);
    }),
  };
  return {
    collection: vi.fn(() => ({ doc: vi.fn(() => userDocRef) })),
    doc: vi.fn(() => ({})),
  };
}

vi.mock('../../utils/firebase', () => ({
  getFirebaseDb: () => mockDbValue,
}));

import SyncEngineV2 from '../SyncEngineV2';
import { needsMigration, readLocalDomains, runMigration } from '../migrationV2';

describe('SyncEngineV2 — boot: migration + legacy blob fallback', () => {
  let engine;
  let cloudUpdates;

  beforeEach(() => {
    vi.clearAllMocks();
    cloudUpdates = [];
    capturedMonthsOnSnapshot = null;

    needsMigration.mockReturnValue(false);
    readLocalDomains.mockReturnValue({});
    runMigration.mockResolvedValue({ migrated: false, reason: 'empty' });

    mockDefSnap = { exists: false, data: () => null };
    mockMonthDocs = [];
    mockMigrationSnap = { exists: false, data: () => null };
    mockBlobSnap = { exists: false, data: () => null };

    mockDefGet = vi.fn(() => Promise.resolve(mockDefSnap));
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: mockMonthDocs }));
    mockMigrationGet = vi.fn(() => Promise.resolve(mockMigrationSnap));
    mockBlobGet = vi.fn(() => Promise.resolve(mockBlobSnap));

    mockDbValue = buildMockDb();
  });

  afterEach(() => {
    if (engine) { engine.destroy(); engine = null; }
  });

  function createEngine(uid = 'test-user') {
    engine = new SyncEngineV2(uid, (domains, isInitial, opts) => {
      cloudUpdates.push({ domains, isInitial, opts });
    });
    return engine;
  }

  it('Test 1: fresh device, only legacy blob → emits domains assembled from blob, note wrapped, no write-back', async () => {
    // months + definitions empty.
    // migration: needsMigration true but localStorage empty → runMigration no-op.
    needsMigration.mockReturnValue(true);
    readLocalDomains.mockReturnValue({}); // no local data

    mockBlobSnap = {
      exists: true,
      data: () => ({
        entries: JSON.stringify({ '2026-03-22': { headache: 3 } }),
        symptoms: JSON.stringify([{ id: 's1', name: 'Headache', order: 0 }]),
        dailyNotes: JSON.stringify({ '2026-03-22': 'felt rough' }),
        trackingMode: 'ampm',
      }),
    };

    createEngine();
    await engine.initialize();

    expect(cloudUpdates.length).toBe(1);
    expect(cloudUpdates[0].isInitial).toBe(true);
    const domains = cloudUpdates[0].domains;
    expect(domains.entries['2026-03-22']).toEqual({ headache: 3 });
    expect(domains.symptoms.map((s) => s.id)).toEqual(['s1']);
    // Bare note string wrapped to { text }.
    expect(domains.dailyNotes['2026-03-22']).toEqual({ text: 'felt rough' });
    expect(domains.trackingMode).toBe('ampm');

    // runMigration NOT called (no local data).
    expect(runMigration).not.toHaveBeenCalled();

    // READ-ONLY: blob get() called, but no set/update on the user doc.
    expect(mockBlobGet).toHaveBeenCalled();

    // Shadow is NOT seeded from the blob: it must stay consistent with the
    // ACTUAL (empty) new cloud, so the first listener tick (an empty months
    // snapshot) is echo-suppressed instead of emitting spurious deletes of the
    // blob data. The blob is still emitted to React for display (above).
    expect(engine._shadow.symptoms || {}).toEqual({});
    expect(engine._shadow.dailyNotes || {}).toEqual({});
    expect(engine._shadow.entries || {}).toEqual({});
    expect(engine.isReady()).toBe(true);
  });

  it('Test 2: migrated device (months populated) → emits from months/defs, ignores blob (blob get NOT called)', async () => {
    mockDefSnap = { exists: true, data: () => ({ trackingMode: 'ampm' }) };
    mockMonthDocs = [
      { id: '2026-03', data: () => ({ entries: { '2026-03-22': { headache: 3 } } }) },
    ];
    mockMigrationSnap = { exists: true, data: () => ({ v2DoneAt: 123 }) };
    // A blob exists, but it must be ignored.
    mockBlobSnap = { exists: true, data: () => ({ entries: JSON.stringify({ x: 1 }) }) };

    createEngine();
    await engine.initialize();

    expect(cloudUpdates.length).toBe(1);
    expect(cloudUpdates[0].domains.entries['2026-03-22']).toEqual({ headache: 3 });
    // Blob never read since cloud had data.
    expect(mockBlobGet).not.toHaveBeenCalled();
  });

  it('Test 3: needsMigration + localStorage data → runMigration called once; re-init (flag set) → not called again', async () => {
    needsMigration.mockReturnValue(true);
    readLocalDomains.mockReturnValue({ entries: { '2026-03-22': { headache: 3 } } });
    runMigration.mockResolvedValue({ migrated: true });

    // After migration writes months, the re-read returns populated months.
    mockMonthDocs = [
      { id: '2026-03', data: () => ({ entries: { '2026-03-22': { headache: 3 } } }) },
    ];

    createEngine();
    await engine.initialize();

    expect(runMigration).toHaveBeenCalledTimes(1);
    expect(cloudUpdates.length).toBe(1);

    // Re-init: flag now set → needsMigration false → runMigration NOT called again.
    needsMigration.mockReturnValue(false);
    mockMigrationSnap = { exists: true, data: () => ({ v2DoneAt: 123 }) };
    runMigration.mockClear();

    engine.destroy();
    createEngine();
    await engine.initialize();

    expect(runMigration).not.toHaveBeenCalled();
  });

  it('Test 4: migration failure → boot still completes, ready, no throw, error logged', async () => {
    needsMigration.mockReturnValue(true);
    readLocalDomains.mockReturnValue({ entries: { '2026-03-22': { headache: 3 } } });
    runMigration.mockRejectedValue(new Error('migration kaboom'));

    createEngine();
    await expect(engine.initialize()).resolves.not.toThrow();

    expect(engine.isReady()).toBe(true);
    // syncError should reflect the migration failure (logged, non-fatal).
    expect(engine.syncError).toBeTruthy();
  });

  it('Test 5: empty everything → no emit, ready, no throw', async () => {
    needsMigration.mockReturnValue(true);
    readLocalDomains.mockReturnValue({});
    // no blob, no months, no defs.

    createEngine();
    await engine.initialize();

    expect(cloudUpdates.length).toBe(0);
    expect(runMigration).not.toHaveBeenCalled();
    expect(engine.isReady()).toBe(true);
  });

  it('Test 6: legacy-fallback boot does not delete blob data on the first listener tick', async () => {
    // New cloud EMPTY (no months, no defs), localStorage EMPTY (no migration),
    // but a legacy blob with data exists.
    needsMigration.mockReturnValue(true);
    readLocalDomains.mockReturnValue({}); // empty → runMigration no-op.

    mockBlobSnap = {
      exists: true,
      data: () => ({
        entries: JSON.stringify({ '2026-05-01-x': { severity: 1 } }),
        symptoms: JSON.stringify([{ id: 's1', name: 'A' }]),
      }),
    };

    createEngine();
    await engine.initialize();

    // The initial emit (isInitial=true) shows the blob data — display works.
    const initial = cloudUpdates.find((u) => u.isInitial === true);
    expect(initial).toBeTruthy();
    expect(initial.domains.entries['2026-05-01-x']).toEqual({ severity: 1 });
    expect(initial.domains.symptoms.map((s) => s.id)).toEqual(['s1']);

    // Real Firestore fires the months onSnapshot IMMEDIATELY on subscribe with
    // the current (empty) snapshot. Simulate that subscribe-time fire.
    expect(typeof capturedMonthsOnSnapshot).toBe('function');
    capturedMonthsOnSnapshot({ docs: [] });

    // Across ALL onCloudUpdate calls, the blob keys must NEVER appear in an
    // opts.deletes — otherwise the hook would wipe the displayed blob data.
    for (const u of cloudUpdates) {
      const deletes = (u.opts && u.opts.deletes) || {};
      expect(deletes.entries || []).not.toContain('2026-05-01-x');
      expect(deletes.symptoms || []).not.toContain('s1');
    }
  });
});
