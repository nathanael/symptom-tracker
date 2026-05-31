import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression tests for the rapid-entry data-loss bug (v6.0.0):
// a STALE snapshot (fromCache, or an authoritative server view momentarily
// behind a REST-fallback write) must NOT delete records we just wrote.

// fieldWriter is mocked so flushes "succeed" without touching a real ref.
vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn(() => Promise.resolve({ ok: true, via: 'sdk' })),
}));
// No migration in these tests.
vi.mock('../migrationV2', () => ({
  needsMigration: () => false,
  readLocalDomains: () => ({}),
  runMigration: vi.fn(),
}));

let mockMonthDocs;
let mockDefGet;
let mockMonthsGet;
let mockDbValue;
let listeners;

function buildMockDb() {
  const definitionsDocRef = {
    get: (...a) => mockDefGet(...a),
    onSnapshot: vi.fn((cb, errCb) => {
      const unsub = vi.fn();
      listeners.defs = { cb, errCb, unsub };
      return unsub;
    }),
  };
  const monthsCollectionRef = {
    get: (...a) => mockMonthsGet(...a),
    doc: vi.fn((id) => ({ path: `users/test-user/months/${id}` })),
    onSnapshot: vi.fn((cb, errCb) => {
      const unsub = vi.fn();
      listeners.months = { cb, errCb, unsub };
      return unsub;
    }),
  };
  const metaCollectionRef = { doc: vi.fn(() => definitionsDocRef) };
  const userDocRef = {
    // legacy-blob fallback reads this; return "no blob" so fallback is a no-op.
    get: vi.fn(() => Promise.resolve({ exists: false, data: () => null })),
    collection: vi.fn((name) => {
      if (name === 'meta') return metaCollectionRef;
      if (name === 'months') return monthsCollectionRef;
      throw new Error(`unexpected collection: ${name}`);
    }),
  };
  return { collection: vi.fn(() => ({ doc: vi.fn(() => userDocRef) })) };
}

vi.mock('../../utils/firebase', () => ({ getFirebaseDb: () => mockDbValue }));

import SyncEngineV2 from '../SyncEngineV2';

// snapshot with metadata (fromCache / hasPendingWrites)
function monthsSnap(docs, metadata = { fromCache: false, hasPendingWrites: false }) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })), metadata };
}

describe('SyncEngineV2 — stale-snapshot protection (rapid-entry data loss)', () => {
  let engine;
  let cloudUpdates;

  beforeEach(() => {
    vi.clearAllMocks();
    cloudUpdates = [];
    listeners = {};
    mockMonthDocs = [];
    mockDefGet = vi.fn(() => Promise.resolve({ exists: false, data: () => null }));
    mockMonthsGet = vi.fn(() => Promise.resolve({ docs: mockMonthDocs }));
    mockDbValue = buildMockDb();
  });

  afterEach(() => { if (engine) { engine.destroy(); engine = null; } });

  function createEngine() {
    engine = new SyncEngineV2('test-user', (domains, isInitial, opts) => {
      cloudUpdates.push({ domains, isInitial, opts });
    });
    return engine;
  }

  // All deletes emitted across every onCloudUpdate call, flattened per domain.
  function allDeletedKeys(domain) {
    return cloudUpdates.flatMap((u) => (u.opts && u.opts.deletes && u.opts.deletes[domain]) || []);
  }

  async function writeEntry(key, value) {
    // Simulate a local edit + flush so the key lands in shadow AND _recentWrites.
    const current = { ...(engine._shadow.entries || {}) };
    current[key] = value;
    engine.notifyLocalChange('entries', current);
    await engine.flushNow();
  }

  it('IGNORES a fromCache snapshot that is missing a just-written key (no delete)', async () => {
    createEngine();
    await engine.initialize();
    await writeEntry('2026-05-01-a', { severity: 1 });
    expect(engine._shadow.entries['2026-05-01-a']).toBeTruthy();

    const before = cloudUpdates.length;
    // A stale CACHE snapshot arrives empty (does not yet reflect our write).
    listeners.months.cb(monthsSnap([], { fromCache: true, hasPendingWrites: false }));

    // Cache snapshot is skipped entirely: no emit, no delete, shadow intact.
    expect(cloudUpdates.length).toBe(before);
    expect(allDeletedKeys('entries')).not.toContain('2026-05-01-a');
    expect(engine._shadow.entries['2026-05-01-a']).toBeTruthy();
  });

  it('IGNORES a hasPendingWrites snapshot', async () => {
    createEngine();
    await engine.initialize();
    await writeEntry('2026-05-01-a', { severity: 1 });
    const before = cloudUpdates.length;
    listeners.months.cb(monthsSnap([], { fromCache: false, hasPendingWrites: true }));
    expect(cloudUpdates.length).toBe(before);
    expect(allDeletedKeys('entries')).not.toContain('2026-05-01-a');
  });

  it('does NOT delete a recently-written key from an AUTHORITATIVE but lagging snapshot', async () => {
    createEngine();
    await engine.initialize();
    await writeEntry('2026-05-01-a', { severity: 1 });

    // Authoritative server snapshot (not cache) that LAGS our REST-fallback
    // write — it is missing the key. The recency guard must protect it.
    listeners.months.cb(monthsSnap([], { fromCache: false, hasPendingWrites: false }));

    expect(allDeletedKeys('entries')).not.toContain('2026-05-01-a');
    // Carried forward in the shadow so it isn't lost.
    expect(engine._shadow.entries['2026-05-01-a']).toBeTruthy();
  });

  it('rapid entry: a lagging snapshot missing the 2nd entry does not delete it', async () => {
    createEngine();
    await engine.initialize();
    await writeEntry('2026-05-01-a', { severity: 1 });
    await writeEntry('2026-05-01-b', { severity: 2 });

    // Snapshot reflects only the first write (second hasn't propagated yet).
    listeners.months.cb(monthsSnap([
      { id: '2026-05', data: { entries: { '2026-05-01-a': { severity: 1, _t: 1 } } } },
    ], { fromCache: false, hasPendingWrites: false }));

    expect(allDeletedKeys('entries')).not.toContain('2026-05-01-b');
    expect(engine._shadow.entries['2026-05-01-b']).toBeTruthy();
  });

  it('STILL honors a genuine remote delete for a key we did NOT recently write', async () => {
    createEngine();
    await engine.initialize();

    // Key arrives from the cloud (via the listener), so it is in the shadow but
    // NOT in _recentWrites (we never wrote it locally).
    listeners.months.cb(monthsSnap([
      { id: '2026-05', data: { entries: { '2026-05-09-x': { severity: 3, _t: 5 } } } },
    ]));
    expect(engine._shadow.entries['2026-05-09-x']).toBeTruthy();

    // Now an authoritative snapshot drops it → genuine remote delete, honored.
    listeners.months.cb(monthsSnap([{ id: '2026-05', data: { entries: {} } }]));
    expect(allDeletedKeys('entries')).toContain('2026-05-09-x');
    expect(engine._shadow.entries['2026-05-09-x']).toBeFalsy();
  });

  it('honors the delete of a recently-written key AFTER the protection window', async () => {
    createEngine();
    await engine.initialize();

    let clock = 1_000_000;
    engine._now = () => clock; // fixed, controllable clock
    await writeEntry('2026-05-01-a', { severity: 1 }); // recorded at clock

    // Advance past the protection window.
    clock += 60_000 + 1;

    listeners.months.cb(monthsSnap([], { fromCache: false, hasPendingWrites: false }));
    expect(allDeletedKeys('entries')).toContain('2026-05-01-a');
  });
});
