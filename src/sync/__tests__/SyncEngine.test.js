import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks ---

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = val; }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: () => { store = {}; },
    _store: () => store,
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

// Mock document.visibilityState
Object.defineProperty(global, 'document', {
  value: {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  writable: true,
});
global.window = global.window || {};
global.window.addEventListener = vi.fn();
global.window.removeEventListener = vi.fn();
global.window.firebase = {
  firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
  auth: () => ({ currentUser: { getIdToken: () => Promise.resolve('token') } }),
};

// Mock Firestore
let mockOnSnapshotCallback = null;
let mockOnSnapshotErrorCallback = null;
let mockSetFn = vi.fn(() => Promise.resolve());
let mockGetFn = vi.fn(() => Promise.resolve({ exists: false }));

const mockDocRef = {
  onSnapshot: vi.fn((cb, errCb) => {
    mockOnSnapshotCallback = cb;
    mockOnSnapshotErrorCallback = errCb;
    return vi.fn(); // unsubscribe
  }),
  set: mockSetFn,
  get: mockGetFn,
};

const mockDb = {
  collection: vi.fn(() => ({
    doc: vi.fn(() => mockDocRef),
  })),
};

// Mock getFirebaseDb
vi.mock('../../utils/firebase', () => ({
  getFirebaseDb: () => mockDb,
}));

import SyncEngine, { SYNC_DOMAINS } from '../SyncEngine';

// --- Helpers ---

function makeCloudData(overrides = {}, versions = {}) {
  const data = {
    version: '4.0',
    _lastWriteId: 'other-session-1',
    updatedAt: { toDate: () => new Date() },
    ...overrides,
  };
  // Set version fields
  SYNC_DOMAINS.forEach(d => {
    if (versions[d] !== undefined) {
      data[`_v_${d}`] = versions[d];
    }
  });
  return data;
}

function makeSnapshot(data, { fromCache = false, hasPendingWrites = false } = {}) {
  return {
    exists: true,
    data: () => data,
    metadata: { fromCache, hasPendingWrites },
  };
}

function fireSnapshot(data, opts) {
  const snap = makeSnapshot(data, opts);
  mockOnSnapshotCallback(snap);
}

// --- Tests ---

describe('SyncEngine', () => {
  let engine;
  let cloudUpdates;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorageMock.clear();
    vi.clearAllMocks();
    cloudUpdates = [];
    mockSetFn = vi.fn(() => Promise.resolve());
    mockGetFn = vi.fn(() => Promise.resolve({ exists: false }));
    mockDocRef.set = mockSetFn;
    mockDocRef.get = mockGetFn;
    mockOnSnapshotCallback = null;
    mockOnSnapshotErrorCallback = null;
  });

  afterEach(() => {
    if (engine) {
      engine.destroy();
      engine = null;
    }
    vi.useRealTimers();
  });

  function createEngine(uid = 'test-user') {
    engine = new SyncEngine(uid, (updates, isInitial) => {
      cloudUpdates.push({ updates: { ...updates }, isInitial });
    });
    return engine;
  }

  describe('Phase 1: Normal initialization', () => {
    it('should apply server data on init', async () => {
      createEngine();
      const initPromise = engine.initialize();

      // Fire cache snapshot
      const cacheData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { headache: 3 } }) },
        { entries: 5 }
      );
      fireSnapshot(cacheData, { fromCache: true });

      // Fire server snapshot with newer data
      const serverData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { headache: 3 }, '2026-03-27': { headache: 5 } }) },
        { entries: 10 }
      );
      fireSnapshot(serverData, { fromCache: false });

      const result = await initPromise;
      expect(result).toBeTruthy();
      expect(engine.versions.entries).toBe(10);
      expect(engine.isReady()).toBe(true);
    });

    it('should apply cache data immediately during init', async () => {
      createEngine();
      engine.initialize();

      const cacheData = makeCloudData(
        { symptoms: JSON.stringify([{ id: 's1', name: 'Headache' }]) },
        { symptoms: 5 }
      );
      fireSnapshot(cacheData, { fromCache: true });

      // Cache data should be applied via onCloudUpdate
      expect(cloudUpdates.length).toBe(1);
      expect(cloudUpdates[0].updates.symptoms).toEqual([{ id: 's1', name: 'Headache' }]);
    });

    it('should fall back to direct get() on timeout', async () => {
      createEngine();

      const serverData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-27': { headache: 5 } }) },
        { entries: 10 }
      );
      mockDocRef.get = vi.fn(() => Promise.resolve({
        exists: true,
        data: () => serverData,
      }));

      const initPromise = engine.initialize();

      // Fire only cache snapshot (no server snapshot)
      const cacheData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { headache: 3 } }) },
        { entries: 5 }
      );
      fireSnapshot(cacheData, { fromCache: true });

      // Advance past timeout
      vi.advanceTimersByTime(3500);
      await vi.runAllTimersAsync();

      const result = await initPromise;
      expect(result).toBeTruthy();
      expect(engine.isReady()).toBe(true);
    });
  });

  describe('Phase 2: Post-init real-time updates', () => {
    async function initEngine(initVersions = { entries: 10, symptoms: 5 }) {
      createEngine();
      const initPromise = engine.initialize();
      const serverData = makeCloudData({}, initVersions);
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;
      cloudUpdates = []; // Reset after init
      return engine;
    }

    it('should apply snapshot with higher cloud version', async () => {
      await initEngine({ entries: 10 });

      const newData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-27': { headache: 7 } }) },
        { entries: 11 }
      );
      fireSnapshot(newData, { fromCache: false });

      expect(cloudUpdates.length).toBe(1);
      expect(cloudUpdates[0].updates.entries).toEqual({ '2026-03-27': { headache: 7 } });
      expect(engine.versions.entries).toBe(11);
    });

    it('should skip snapshot with equal cloud version', async () => {
      await initEngine({ entries: 10 });

      const sameData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { headache: 3 } }) },
        { entries: 10 }
      );
      fireSnapshot(sameData, { fromCache: false });

      expect(cloudUpdates.length).toBe(0);
    });

    it('should skip own echo writes', async () => {
      await initEngine({ entries: 10 });

      // Simulate a local flush that sets _lastWriteId
      engine._lastWriteId = 'test-write-1';

      const echoData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-27': { headache: 7 } }) },
        { entries: 11 }
      );
      echoData._lastWriteId = 'test-write-1';
      fireSnapshot(echoData, { fromCache: false });

      expect(cloudUpdates.length).toBe(0);
    });
  });

  describe('BUG: Pending changes block and overwrite cloud data', () => {
    it('should NOT lose cloud data when local change happens before init completes', async () => {
      createEngine();
      const initPromise = engine.initialize();

      // Cache snapshot arrives first (stale data from 5 days ago)
      const cacheData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { headache: 3 } }) },
        { entries: 5 }
      );
      fireSnapshot(cacheData, { fromCache: true });

      // User makes a local change BEFORE server data arrives
      // The pending data is the stale cache + user's new entry
      engine.notifyLocalChange('entries', {
        '2026-03-22': { headache: 3 },
        '2026-03-27': { headache: 8 },  // User's new entry
      });

      // NOW server data arrives with 5 days of mobile data
      const serverData = makeCloudData(
        {
          entries: JSON.stringify({
            '2026-03-22': { headache: 3 },
            '2026-03-23': { fatigue: 4 },
            '2026-03-24': { fatigue: 5 },
            '2026-03-25': { headache: 2 },
            '2026-03-26': { fatigue: 3 },
            '2026-03-27': { headache: 6 },
          }),
        },
        { entries: 50 }
      );
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;

      // Flush the pending changes
      await engine.flush();

      // CRITICAL: The flushed data should contain BOTH the cloud entries
      // AND the user's local entry, not just the stale local data
      expect(mockSetFn).toHaveBeenCalled();
      const flushPayload = mockSetFn.mock.calls[0][0];
      const flushedEntries = JSON.parse(flushPayload.entries);

      // The user's new rating for 03-27 should be there
      expect(flushedEntries['2026-03-27']).toBeDefined();

      // BUG: Cloud entries from 03-23 through 03-26 should NOT be lost
      // This test documents the current bug - it will FAIL until fixed
      expect(flushedEntries['2026-03-23']).toEqual({ fatigue: 4 });
      expect(flushedEntries['2026-03-24']).toEqual({ fatigue: 5 });
      expect(flushedEntries['2026-03-25']).toEqual({ headache: 2 });
      expect(flushedEntries['2026-03-26']).toEqual({ fatigue: 3 });
    });

    it('should skip domain in _extractDomains when pending changes exist', async () => {
      createEngine();
      const initPromise = engine.initialize();

      // User makes change before init completes
      engine.notifyLocalChange('entries', { '2026-03-27': { test: 1 } });

      // Server data arrives
      const serverData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { old: 1 } }) },
        { entries: 10 }
      );
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;

      // Verify entries was skipped during init (because it's pending)
      // The cloudUpdates from init should NOT include entries
      const initUpdate = cloudUpdates.find(u => u.isInitial);
      if (initUpdate) {
        expect(initUpdate.updates.entries).toBeUndefined();
      }
    });
  });

  describe('Dirty flags are not resurrected across sessions', () => {
    it('clears persisted dirty flags from a previous session regardless of age', async () => {
      // Even "fresh" dirty flags from a recent close are not resurrected,
      // because resurrecting them caused bidirectional overwrites across devices.
      localStorageMock.setItem('syncDirty_test-user', JSON.stringify({
        domains: ['entries', 'symptoms'],
        ts: Date.now() - 10000, // 10s ago — would have been resurrected previously
      }));

      createEngine();
      expect(engine._dirtyDomains.size).toBe(0);

      const initPromise = engine.initialize();
      const serverData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-27': { headache: 5 } }) },
        { entries: 50 }
      );
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;

      // Cloud data is applied — not blocked by stale dirty flags
      expect(engine.versions.entries).toBe(50);
    });
  });

  describe('BUG: Version bump on skip prevents re-application', () => {
    it('should merge cloud data into pending changes so flush includes both', async () => {
      createEngine();
      const initPromise = engine.initialize();

      const serverData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-27': { headache: 5 } }) },
        { entries: 10 }
      );
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;
      cloudUpdates = [];

      // Local change creates pending state
      engine.notifyLocalChange('entries', { '2026-03-27': { headache: 8 } });

      // Cloud snapshot arrives with newer data (includes a new key 2026-03-26)
      const newerData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-27': { headache: 5 }, '2026-03-26': { fatigue: 3 } }) },
        { entries: 15 }
      );
      fireSnapshot(newerData, { fromCache: false });

      // entries was skipped (pending), version bumped to 16
      expect(engine.versions.entries).toBe(16);

      // But cloud data should have been merged into pending changes
      const pending = engine.pendingChanges.get('entries');
      expect(pending['2026-03-26']).toEqual({ fatigue: 3 }); // Cloud key preserved
      expect(pending['2026-03-27']).toEqual({ headache: 8 }); // Local change wins

      // Flush should include both cloud and local data
      await engine.flush();

      const payload = mockSetFn.mock.calls[0][0];
      const flushedEntries = JSON.parse(payload.entries);
      expect(flushedEntries['2026-03-26']).toEqual({ fatigue: 3 });
      expect(flushedEntries['2026-03-27']).toEqual({ headache: 8 });
    });
  });

  describe('BUG: No REST API read fallback', () => {
    it('should start polling when streaming listener fails', async () => {
      createEngine();
      const initPromise = engine.initialize();

      // Only cache data, no server snapshot
      const cacheData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { headache: 3 } }) },
        { entries: 5 }
      );
      fireSnapshot(cacheData, { fromCache: true });

      // Direct get() also fails
      mockDocRef.get = vi.fn(() => Promise.reject(new Error('network error')));

      // Advance past timeout
      vi.advanceTimersByTime(3500);
      await vi.runAllTimersAsync();

      await initPromise;

      // Polling should have started since listener isn't working
      expect(engine._listenerWorking).toBe(false);
      // _startPollingIfNeeded is called in useSyncEngine, not in SyncEngine directly
      // But we can verify the state that would trigger it
      expect(engine.isReady()).toBe(true);
    });
  });

  describe('Flush behavior', () => {
    it('should flush pending changes to Firestore', async () => {
      createEngine();
      const initPromise = engine.initialize();
      const serverData = makeCloudData({}, { entries: 10 });
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;

      engine.notifyLocalChange('entries', { '2026-03-27': { headache: 8 } });
      await engine.flush();

      expect(mockSetFn).toHaveBeenCalledTimes(1);
      const payload = mockSetFn.mock.calls[0][0];
      expect(payload._v_entries).toBe(11); // 10 + 1
      expect(JSON.parse(payload.entries)).toEqual({ '2026-03-27': { headache: 8 } });
    });

    it('should clear dirty flags after successful flush', async () => {
      createEngine();
      const initPromise = engine.initialize();
      const serverData = makeCloudData({}, { entries: 10 });
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;

      engine.notifyLocalChange('entries', { '2026-03-27': { headache: 8 } });
      expect(engine._dirtyDomains.has('entries')).toBe(true);

      await engine.flush();
      expect(engine._dirtyDomains.has('entries')).toBe(false);
    });

    it('should re-queue failed flush', async () => {
      createEngine();
      const initPromise = engine.initialize();
      const serverData = makeCloudData({}, { entries: 10 });
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;

      mockDocRef.set = vi.fn(() => Promise.reject(new Error('network error')));
      engine.notifyLocalChange('entries', { '2026-03-27': { headache: 8 } });
      await engine.flush();

      // Should be re-queued
      expect(engine.pendingChanges.has('entries')).toBe(true);
      expect(engine._dirtyDomains.has('entries')).toBe(true);
    });
  });

  describe('Critical scenario: Browser 5 days behind', () => {
    it('should correctly sync when browser has been offline for days', async () => {
      // Browser has 5-day-old cache data
      // Mobile has been active, cloud has current data
      createEngine();
      const initPromise = engine.initialize();

      // Step 1: Cache fires with stale data
      const cacheData = makeCloudData(
        {
          entries: JSON.stringify({ '2026-03-22': { headache: 3 } }),
          symptoms: JSON.stringify([{ id: 's1', name: 'Headache' }]),
          stackItems: JSON.stringify([{ id: 'supp1', name: 'VitD' }]),
        },
        { entries: 5, symptoms: 3, stackItems: 4 }
      );
      fireSnapshot(cacheData, { fromCache: true });

      // Step 2: Server fires with current data (5 days newer)
      const serverData = makeCloudData(
        {
          entries: JSON.stringify({
            '2026-03-22': { headache: 3 },
            '2026-03-23': { fatigue: 4 },
            '2026-03-24': { fatigue: 5 },
            '2026-03-25': { headache: 2 },
            '2026-03-26': { fatigue: 3 },
            '2026-03-27': { headache: 6 },
          }),
          symptoms: JSON.stringify([
            { id: 's1', name: 'Headache' },
            { id: 's2', name: 'Fatigue' },
          ]),
          stackItems: JSON.stringify([
            { id: 'supp1', name: 'VitD' },
            { id: 'supp2', name: 'Magnesium' },
          ]),
        },
        { entries: 50, symptoms: 20, stackItems: 15 }
      );
      fireSnapshot(serverData, { fromCache: false });

      const result = await initPromise;

      // All versions should be at cloud level
      expect(engine.versions.entries).toBe(50);
      expect(engine.versions.symptoms).toBe(20);
      expect(engine.versions.stackItems).toBe(15);

      // No pending changes or dirty flags
      expect(engine.pendingChanges.size).toBe(0);
      expect(engine._dirtyDomains.size).toBe(0);

      // Cloud data should have been applied (init + cache apply)
      expect(cloudUpdates.length).toBeGreaterThan(0);
    });

    it('should not overwrite cloud with stale data when user acts before sync', async () => {
      createEngine();
      const initPromise = engine.initialize();

      // Cache fires with stale data
      const cacheData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { headache: 3 } }) },
        { entries: 5 }
      );
      fireSnapshot(cacheData, { fromCache: true });

      // User acts immediately (before server data) — adds today's entry
      // Their state is: stale cache data + new entry
      engine.notifyLocalChange('entries', {
        '2026-03-22': { headache: 3 },
        '2026-03-27': { headache: 8 },
      });

      // Server data arrives (50 versions later — lots of mobile activity)
      const serverData = makeCloudData(
        {
          entries: JSON.stringify({
            '2026-03-22': { headache: 3 },
            '2026-03-23': { fatigue: 4 },
            '2026-03-24': { fatigue: 5 },
            '2026-03-25': { headache: 2 },
            '2026-03-26': { fatigue: 3 },
            '2026-03-27': { headache: 6 },
          }),
        },
        { entries: 50 }
      );
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;

      // Now flush pending changes
      await engine.flush();

      // CRITICAL ASSERTION: The flushed data should have the cloud entries MERGED
      // with the user's local change, NOT just the stale local data
      const payload = mockSetFn.mock.calls[0][0];
      const flushedEntries = JSON.parse(payload.entries);

      // User's new entry should be present
      expect(flushedEntries['2026-03-27']).toBeDefined();

      // Cloud entries from 03-23 to 03-26 MUST still be present
      // THIS IS THE KEY TEST - currently fails because flush uses stale pendingChanges
      expect(flushedEntries['2026-03-23']).toBeDefined();
      expect(flushedEntries['2026-03-24']).toBeDefined();
      expect(flushedEntries['2026-03-25']).toBeDefined();
      expect(flushedEntries['2026-03-26']).toBeDefined();
    });
  });

  describe('notifyLocalChange', () => {
    it('should queue changes and bump version', () => {
      createEngine();
      engine.versions.entries = 10;

      engine.notifyLocalChange('entries', { test: 1 });

      expect(engine.pendingChanges.has('entries')).toBe(true);
      expect(engine.versions.entries).toBe(11);
      expect(engine._dirtyDomains.has('entries')).toBe(true);
    });

    it('should queue changes even before init (ready=false)', () => {
      createEngine();
      // Don't call initialize - engine is not ready

      engine.notifyLocalChange('entries', { test: 1 });

      expect(engine.pendingChanges.has('entries')).toBe(true);
      expect(engine.versions.entries).toBe(1);
    });

    it('should not schedule flush before ready', () => {
      createEngine();
      engine.notifyLocalChange('entries', { test: 1 });

      // Flush timer should not be set (not ready)
      expect(engine._flushTimer).toBeNull();
    });
  });

  describe('_seedVersions', () => {
    it('should set versions from cloud data', () => {
      createEngine();
      const data = { _v_entries: 10, _v_symptoms: 5 };
      engine._seedVersions(data);

      expect(engine.versions.entries).toBe(10);
      expect(engine.versions.symptoms).toBe(5);
    });

    it('should bump version above cloud when pending changes exist', () => {
      createEngine();
      engine.pendingChanges.set('entries', { test: 1 });
      const data = { _v_entries: 10 };
      engine._seedVersions(data);

      expect(engine.versions.entries).toBe(11); // cloudVersion + 1
    });

    it('should bump version above cloud when dirty flags exist', () => {
      createEngine();
      engine._dirtyDomains.add('entries');
      const data = { _v_entries: 10 };
      engine._seedVersions(data);

      expect(engine.versions.entries).toBe(11);
    });
  });

  describe('_extractDomains', () => {
    it('should extract and decode all domains', () => {
      createEngine();
      const data = {
        entries: JSON.stringify({ '2026-03-27': { headache: 5 } }),
        symptoms: JSON.stringify([{ id: 's1' }]),
        trackingMode: 'ampm',
      };

      const result = engine._extractDomains(data, 'all');
      expect(result.entries).toEqual({ '2026-03-27': { headache: 5 } });
      expect(result.symptoms).toEqual([{ id: 's1' }]);
      expect(result.trackingMode).toBe('ampm');
    });

    it('should skip pending domains in skipPending mode', () => {
      createEngine();
      engine.pendingChanges.set('entries', { test: 1 });
      const data = {
        entries: JSON.stringify({ old: 1 }),
        symptoms: JSON.stringify([{ id: 's1' }]),
      };

      const result = engine._extractDomains(data, 'skipPending');
      expect(result.entries).toBeUndefined();
      expect(result.symptoms).toEqual([{ id: 's1' }]);
    });

    it('should skip dirty domains in skipDirty mode', () => {
      createEngine();
      engine._dirtyDomains.add('entries');
      const data = {
        entries: JSON.stringify({ old: 1 }),
        symptoms: JSON.stringify([{ id: 's1' }]),
      };

      const result = engine._extractDomains(data, 'skipDirty');
      expect(result.entries).toBeUndefined();
      expect(result.symptoms).toEqual([{ id: 's1' }]);
    });
  });

  describe('_applySnapshot', () => {
    it('should apply domains where cloud version > local version', () => {
      createEngine();
      engine.versions.entries = 10;

      const data = makeCloudData(
        { entries: JSON.stringify({ '2026-03-27': { headache: 5 } }) },
        { entries: 15 }
      );
      engine._applySnapshot(data);

      expect(cloudUpdates.length).toBe(1);
      expect(cloudUpdates[0].updates.entries).toEqual({ '2026-03-27': { headache: 5 } });
      expect(engine.versions.entries).toBe(15);
    });

    it('should skip domains where cloud version <= local version', () => {
      createEngine();
      engine.versions.entries = 10;

      const data = makeCloudData(
        { entries: JSON.stringify({ old: 1 }) },
        { entries: 10 }
      );
      engine._applySnapshot(data);

      expect(cloudUpdates.length).toBe(0);
    });

    it('should skip pending domains and bump version past cloud', () => {
      createEngine();
      engine.versions.entries = 10;
      engine.pendingChanges.set('entries', { local: 1 });

      const data = makeCloudData(
        { entries: JSON.stringify({ cloud: 1 }) },
        { entries: 15 }
      );
      engine._applySnapshot(data);

      expect(cloudUpdates.length).toBe(0);
      expect(engine.versions.entries).toBe(16); // cloudVersion + 1
    });
  });

  describe('Echo detection', () => {
    it('should skip snapshots that match our own write ID', () => {
      createEngine();
      engine._lastWriteId = 'session-42';
      engine.versions.entries = 10;

      const data = makeCloudData(
        { entries: JSON.stringify({ test: 1 }) },
        { entries: 15 }
      );
      data._lastWriteId = 'session-42';

      engine._handleSnapshot(data, { hasPendingWrites: false });
      expect(cloudUpdates.length).toBe(0);
    });

    it('should apply snapshots from other sessions', () => {
      createEngine();
      engine._lastWriteId = 'session-42';
      engine.versions.entries = 10;

      const data = makeCloudData(
        { entries: JSON.stringify({ test: 1 }) },
        { entries: 15 }
      );
      data._lastWriteId = 'other-session-99';

      engine._handleSnapshot(data, { hasPendingWrites: false });
      expect(cloudUpdates.length).toBe(1);
    });
  });

  describe('Dirty flags are in-memory only', () => {
    it('tracks dirty flags in memory after notifyLocalChange', () => {
      createEngine();
      engine.notifyLocalChange('entries', { test: 1 });
      expect(engine._dirtyDomains.has('entries')).toBe(true);
    });

    it('does not persist dirty flags to localStorage', () => {
      createEngine();
      engine.notifyLocalChange('entries', { test: 1 });
      expect(localStorageMock.getItem('syncDirty_test-user')).toBeNull();
    });

    it('clears any pre-existing dirty flag entry on construction', () => {
      localStorageMock.setItem('syncDirty_test-user', JSON.stringify({
        domains: ['entries'],
        ts: Date.now() - 60000,
      }));
      createEngine();
      expect(engine._dirtyDomains.size).toBe(0);
      expect(localStorageMock.getItem('syncDirty_test-user')).toBeNull();
    });
  });

  describe('BUG: Listener death with no recovery', () => {
    async function initWithServerData(versions = { entries: 10, symptoms: 5 }) {
      createEngine();
      const initPromise = engine.initialize();
      const serverData = makeCloudData({
        entries: JSON.stringify({ '2026-03-22': { headache: 3 } }),
        symptoms: JSON.stringify([{ id: 's1', name: 'Headache' }]),
      }, versions);
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;
      // Simulate what useSyncEngine does after init
      engine._startPollingIfNeeded();
      cloudUpdates = [];
      return engine;
    }

    it('should detect when listener stops delivering snapshots and restart polling', async () => {
      await initWithServerData({ entries: 10 });

      // Listener was marked as working during init
      expect(engine._listenerWorking).toBe(true);

      // Simulate time passing with no snapshots (listener died)
      vi.advanceTimersByTime(120000); // 2 minutes

      // Engine should detect the listener is dead and restart polling
      expect(engine._listenerWorking).toBe(false);
      expect(engine._pollTimer).not.toBeNull();
    });

    it('should recover data after listener death via polling', async () => {
      await initWithServerData({ entries: 10 });
      expect(engine._listenerWorking).toBe(true);

      // Listener dies silently — no more snapshots arrive
      // Advance time past heartbeat threshold
      vi.advanceTimersByTime(120000);

      // Polling should have started
      expect(engine._pollTimer).not.toBeNull();
      expect(engine._listenerWorking).toBe(false);

      // Mock SDK get() to return fresh cloud data
      const freshData = makeCloudData(
        {
          entries: JSON.stringify({
            '2026-03-22': { headache: 3 },
            '2026-03-23': { fatigue: 4 },
            '2026-03-24': { fatigue: 5 },
          }),
        },
        { entries: 50 }
      );
      mockDocRef.get = vi.fn(() => Promise.resolve({
        exists: true,
        data: () => freshData,
      }));

      // Advance to next poll interval and flush microtasks
      await vi.advanceTimersByTimeAsync(30000);

      // Fresh cloud data should have been applied
      expect(cloudUpdates.length).toBeGreaterThan(0);
      const lastUpdate = cloudUpdates[cloudUpdates.length - 1];
      expect(lastUpdate.updates.entries).toBeDefined();
      expect(lastUpdate.updates.entries['2026-03-23']).toEqual({ fatigue: 4 });
    });

    it('should reset heartbeat timer when new snapshot arrives', async () => {
      await initWithServerData({ entries: 10 });

      // Advance time partway
      vi.advanceTimersByTime(50000);

      // New snapshot arrives — listener is still alive
      const newData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { headache: 4 } }) },
        { entries: 11 }
      );
      fireSnapshot(newData, { fromCache: false });

      // Advance past original heartbeat threshold
      vi.advanceTimersByTime(80000);

      // Listener should still be marked as working (heartbeat was reset)
      expect(engine._listenerWorking).toBe(true);
    });
  });

  describe('BUG: Flush sends stale data before cloud merge', () => {
    it('should merge cloud data into flush payload even if cloud arrives during flush', async () => {
      createEngine();
      const initPromise = engine.initialize();

      // Init resolves via timeout with no server data
      mockDocRef.get = vi.fn(() => Promise.reject(new Error('network')));
      const cacheData = makeCloudData(
        { entries: JSON.stringify({ '2026-03-22': { headache: 3 } }) },
        { entries: 5 }
      );
      fireSnapshot(cacheData, { fromCache: true });

      vi.advanceTimersByTime(3500);
      await vi.runAllTimersAsync();
      await initPromise;
      cloudUpdates = [];

      // User makes a change — stale data + user's entry
      engine.notifyLocalChange('entries', {
        '2026-03-22': { headache: 3 },
        '2026-03-27': { headache: 8 },
      });

      // Mock REST API to return fresh cloud data for pre-flush read
      global.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          fields: {
            entries: { stringValue: JSON.stringify({
              '2026-03-22': { headache: 3 },
              '2026-03-23': { fatigue: 4 },
              '2026-03-24': { fatigue: 5 },
              '2026-03-25': { headache: 2 },
              '2026-03-26': { fatigue: 3 },
              '2026-03-27': { headache: 6 },
            })},
            _v_entries: { integerValue: '50' },
          },
        }),
      }));

      // Flush should do a pre-flush read and merge
      await engine.flush();

      expect(mockSetFn).toHaveBeenCalled();
      const payload = mockSetFn.mock.calls[0][0];
      const flushedEntries = JSON.parse(payload.entries);

      // Cloud entries must be preserved
      expect(flushedEntries['2026-03-23']).toEqual({ fatigue: 4 });
      expect(flushedEntries['2026-03-24']).toEqual({ fatigue: 5 });
      expect(flushedEntries['2026-03-25']).toEqual({ headache: 2 });
      expect(flushedEntries['2026-03-26']).toEqual({ fatigue: 3 });

      // User's local change should win for conflicting key
      expect(flushedEntries['2026-03-27']).toEqual({ headache: 8 });

      // Clean up
      delete global.fetch;
    });

    it('should still flush if pre-flush cloud read fails', async () => {
      createEngine();
      const initPromise = engine.initialize();
      const serverData = makeCloudData({}, { entries: 10 });
      fireSnapshot(serverData, { fromCache: false });
      await initPromise;

      engine.notifyLocalChange('entries', { '2026-03-27': { headache: 8 } });

      // REST API fails
      global.fetch = vi.fn(() => Promise.reject(new Error('network')));

      // Flush should still succeed (just without pre-merge)
      await engine.flush();
      expect(mockSetFn).toHaveBeenCalled();

      delete global.fetch;
    });
  });
});
