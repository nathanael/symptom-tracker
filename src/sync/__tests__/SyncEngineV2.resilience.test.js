import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock Firestore with realtime listeners (same shape as listener.test) ---
// Each ref supports .get({source}) for initialize()/_readCloud and .onSnapshot
// for the realtime listener. Stored callbacks live in `listeners` so tests can
// drive snapshots manually.

let mockDefGet;
let mockMonthsGet;
let mockDbValue;
let listeners;

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
    collection: vi.fn(() => ({ doc: vi.fn(() => userDocRef) })),
  };
}

vi.mock('../../utils/firebase', () => ({
  getFirebaseDb: () => mockDbValue,
}));

import SyncEngineV2 from '../SyncEngineV2';

function monthsSnap(docs) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}

describe('SyncEngineV2 — resilience (heartbeat + poll + refresh)', () => {
  let engine;
  let cloudUpdates;
  let nowMs;

  beforeEach(() => {
    vi.clearAllMocks();
    cloudUpdates = [];
    listeners = {};
    nowMs = 1_000_000;
    mockDefGet = vi.fn(() => Promise.resolve({ exists: false, data: () => null }));
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: [] }));
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
    engine._now = () => nowMs;
    return engine;
  }

  // Configure the cloud GET responses for a given entries map.
  function setCloud({ entries = {} } = {}) {
    const monthDocs = Object.keys(entries).length
      ? [{ id: '2026-03', data: () => ({ entries }) }]
      : [];
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: monthDocs }));
    mockDefGet = vi.fn(() => Promise.resolve({ exists: false, data: () => null }));
  }

  async function initWith({ entries = {} } = {}) {
    setCloud({ entries });
    mockDbValue = buildMockDb();
    createEngine();
    await engine.initialize();
  }

  it('Test 1: heartbeat triggers refresh when stalled past HEARTBEAT_DEAD_MS', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });
    expect(cloudUpdates.length).toBe(1);

    // Cloud gains a new key, but no snapshot is delivered (listener died).
    setCloud({ entries: { A: { v: 1, _t: 100 }, K: { v: 9, _t: 200 } } });

    // Advance the clock past the dead threshold without any activity.
    nowMs += 120_000;
    await engine._checkHeartbeat();
    // Allow the fire-and-forget refresh promise to settle.
    await Promise.resolve();
    await Promise.resolve();

    // refreshFromCloud re-read the cloud and emitted the new key.
    expect(cloudUpdates.length).toBe(2);
    expect(cloudUpdates[1].domains.entries.K).toEqual({ v: 9, _t: 200 });
  });

  it('Test 2: heartbeat does NOT refresh when listener is active (recent activity)', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });
    expect(cloudUpdates.length).toBe(1);

    // A recent snapshot updates activity.
    nowMs += 1_000;
    listeners.months.cb(monthsSnap([{ id: '2026-03', data: {
      entries: { A: { v: 1, _t: 100 }, K: { v: 9, _t: 200 } },
    } }]));
    expect(cloudUpdates.length).toBe(2);

    const readSpy = vi.spyOn(engine, '_readCloud');
    // Within the dead window — no refresh.
    nowMs += 30_000;
    await engine._checkHeartbeat();
    await Promise.resolve();

    expect(readSpy).not.toHaveBeenCalled();
    expect(cloudUpdates.length).toBe(2);
  });

  it('Test 3: refreshFromCloud emits changed data and is echo-suppressed when unchanged', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });
    expect(cloudUpdates.length).toBe(1);

    // Unchanged cloud → echo suppressed → no emit.
    await engine.refreshFromCloud();
    expect(cloudUpdates.length).toBe(1);

    // Changed cloud → emit.
    setCloud({ entries: { A: { v: 1, _t: 100 }, K: { v: 5, _t: 300 } } });
    await engine.refreshFromCloud();
    expect(cloudUpdates.length).toBe(2);
    expect(cloudUpdates[1].domains.entries.K).toEqual({ v: 5, _t: 300 });
  });

  it('Test 4: polling fallback refreshes until listener delivers, then no-ops', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });

    const refreshSpy = vi.spyOn(engine, 'refreshFromCloud');

    // Listener never delivered → poll callback refreshes.
    expect(engine._listenerDelivered).toBe(false);
    engine._pollTick();
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    // A snapshot arrives → listenerDelivered becomes true.
    listeners.months.cb(monthsSnap([{ id: '2026-03', data: {
      entries: { A: { v: 2, _t: 400 } },
    } }]));
    expect(engine._listenerDelivered).toBe(true);

    // Now the poll no-ops.
    refreshSpy.mockClear();
    engine._pollTick();
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('Test 5: destroy clears heartbeat + poll timers and is double-destroy safe', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });

    expect(engine._heartbeatTimer).not.toBeNull();
    expect(engine._pollTimer).not.toBeNull();

    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    engine.destroy();
    expect(engine._heartbeatTimer).toBeNull();
    expect(engine._pollTimer).toBeNull();
    expect(clearSpy).toHaveBeenCalled();

    // Double-destroy must not throw.
    expect(() => engine.destroy()).not.toThrow();
    clearSpy.mockRestore();
  });

  it('Test 6: refreshFromCloud never throws on read error; sets syncError', async () => {
    await initWith({ entries: { A: { v: 1, _t: 100 } } });

    vi.spyOn(engine, '_readCloud').mockRejectedValue(new Error('read boom'));
    await expect(engine.refreshFromCloud()).resolves.toBeUndefined();
    expect(engine.syncError).toBe('read boom');
  });
});
