import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock Firestore (same shape as the hydrate test) ---
let mockDefSnap = { exists: false, data: () => null };
let mockMonthDocs = [];
let mockDefGet = vi.fn(() => Promise.resolve(mockDefSnap));
let mockMonthsGet = vi.fn(() => Promise.resolve({ docs: mockMonthDocs }));
let mockDbValue;

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
    collection: vi.fn(() => ({ doc: vi.fn(() => userDocRef) })),
  };
}

vi.mock('../../utils/firebase', () => ({
  getFirebaseDb: () => mockDbValue,
}));

// Mock snapshots so forcePull/forcePush don't touch localStorage and we can
// assert the label passed to saveSnapshot.
const mockSaveSnapshot = vi.fn((label) => `snap_${label}`);
vi.mock('../../utils/snapshots', () => ({
  saveSnapshot: (label) => mockSaveSnapshot(label),
}));

import SyncEngineV2 from '../SyncEngineV2';

describe('SyncEngineV2 — forcePull', () => {
  let engine;
  let cloudUpdates;

  beforeEach(() => {
    vi.clearAllMocks();
    cloudUpdates = [];
    mockSaveSnapshot.mockImplementation((label) => `snap_${label}`);
    // Cloud holds two symptoms + one entry.
    mockDefSnap = {
      exists: true,
      data: () => ({
        symptoms: {
          s1: { id: 's1', name: 'Headache', order: 0 },
          s2: { id: 's2', name: 'Fatigue', order: 1 },
        },
        pinnedSymptoms: ['s1'],
        trackingMode: 'ampm',
      }),
    };
    mockMonthDocs = [
      { id: '2026-03', data: () => ({ entries: { '2026-03-22': { headache: 3, _t: 5 } } }) },
    ];
    mockDefGet = vi.fn(() => Promise.resolve(mockDefSnap));
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: mockMonthDocs }));
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

  it('merge pull: returns summary + snapshotId, destructive:false, emits deletes (not replace)', async () => {
    createEngine();
    const result = await engine.forcePull({ destructive: false });

    expect(mockSaveSnapshot).toHaveBeenCalledWith('preForcePullMerge');
    expect(result.snapshotId).toBe('snap_preForcePullMerge');
    expect(result.destructive).toBe(false);

    // Per-domain counts.
    expect(result.summary.symptoms).toBe(2);
    expect(result.summary.entries).toBe(1);
    expect(result.summary.pinnedSymptoms).toBe(1);
    expect(result.summary.trackingMode).toBe(1);

    // Emitted once, as a NON-initial merge with deletes (not replace).
    expect(cloudUpdates.length).toBe(1);
    const { isInitial, opts } = cloudUpdates[0];
    expect(isInitial).toBe(false);
    expect(opts).toEqual({ deletes: {} });
    expect(opts.replace).toBeUndefined();

    // Shadow advanced to the freshly-read cloud (id-map shape for symptoms).
    expect(engine._shadow.symptoms.s1).toEqual({ id: 's1', name: 'Headache', order: 0 });
  });

  it('destructive pull: returns destructive:true, emits opts.replace=true', async () => {
    createEngine();
    const result = await engine.forcePull({ destructive: true });

    expect(mockSaveSnapshot).toHaveBeenCalledWith('preForcePullReplace');
    expect(result.snapshotId).toBe('snap_preForcePullReplace');
    expect(result.destructive).toBe(true);
    expect(result.summary.symptoms).toBe(2);

    expect(cloudUpdates.length).toBe(1);
    const { isInitial, opts } = cloudUpdates[0];
    expect(isInitial).toBe(false);
    expect(opts.replace).toBe(true);
  });

  it('default opts (no arg) is a merge pull', async () => {
    createEngine();
    const result = await engine.forcePull();
    expect(result.destructive).toBe(false);
    expect(cloudUpdates[0].opts).toEqual({ deletes: {} });
  });
});
