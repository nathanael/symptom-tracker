import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression tests for the rapid-entry data-loss bug (v6.0.0/6.0.1).
// THE GUARANTEE: a snapshot/read that is missing a key NEVER deletes it. The
// listener path is UNION-ONLY — absence is not a delete — so a stale/cache
// snapshot, or an authoritative server view lagging a REST-fallback write, can
// never erase data the user just entered. (Cross-device delete propagation via
// snapshot absence is intentionally gone; a tombstone mechanism is the future
// fix.) Also: fromCache / hasPendingWrites snapshots are ignored entirely.

vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn(() => Promise.resolve({ ok: true, via: 'sdk' })),
}));
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

  // Every key ever emitted in an opts.deletes for a domain.
  function allDeletedKeys(domain) {
    return cloudUpdates.flatMap((u) => (u.opts && u.opts.deletes && u.opts.deletes[domain]) || []);
  }

  async function writeEntry(key, value) {
    const current = { ...(engine._shadow.entries || {}) };
    current[key] = value;
    engine.notifyLocalChange('entries', current);
    await engine.flushNow();
  }

  it('IGNORES a fromCache snapshot (no emit at all)', async () => {
    createEngine();
    await engine.initialize();
    await writeEntry('2026-05-01-a', { severity: 1 });
    const before = cloudUpdates.length;
    listeners.months.cb(monthsSnap([], { fromCache: true, hasPendingWrites: false }));
    expect(cloudUpdates.length).toBe(before);
    expect(allDeletedKeys('entries')).toEqual([]);
  });

  it('IGNORES a hasPendingWrites snapshot (no emit at all)', async () => {
    createEngine();
    await engine.initialize();
    await writeEntry('2026-05-01-a', { severity: 1 });
    const before = cloudUpdates.length;
    listeners.months.cb(monthsSnap([], { fromCache: false, hasPendingWrites: true }));
    expect(cloudUpdates.length).toBe(before);
    expect(allDeletedKeys('entries')).toEqual([]);
  });

  it('an authoritative but LAGGING snapshot never emits a delete (union-only)', async () => {
    createEngine();
    await engine.initialize();
    await writeEntry('2026-05-01-a', { severity: 1 });
    // Authoritative server snapshot that LAGS our write (missing the key).
    listeners.months.cb(monthsSnap([], { fromCache: false, hasPendingWrites: false }));
    // No delete is ever emitted from absence → the hook's union merge keeps it.
    expect(allDeletedKeys('entries')).toEqual([]);
  });

  it('rapid entry: a lagging snapshot missing the 2nd entry emits no delete', async () => {
    createEngine();
    await engine.initialize();
    await writeEntry('2026-05-01-a', { severity: 1 });
    await writeEntry('2026-05-01-b', { severity: 2 });
    // Snapshot reflects only the first write.
    listeners.months.cb(monthsSnap([
      { id: '2026-05', data: { entries: { '2026-05-01-a': { severity: 1, _t: 1 } } } },
    ], { fromCache: false, hasPendingWrites: false }));
    expect(allDeletedKeys('entries')).toEqual([]);
  });

  it('snapshot absence NEVER deletes — even for a key we did not write locally (cross-device deletes deferred to tombstones)', async () => {
    createEngine();
    await engine.initialize();
    // Key arrives from the cloud via the listener (in shadow, not locally written).
    listeners.months.cb(monthsSnap([
      { id: '2026-05', data: { entries: { '2026-05-09-x': { severity: 3, _t: 5 } } } },
    ]));
    expect(engine._shadow.entries['2026-05-09-x']).toBeTruthy();
    // A later authoritative snapshot drops it. Under union-only we do NOT emit a
    // delete (absence != delete). This is the deliberate tradeoff that makes
    // stale-view data loss impossible.
    listeners.months.cb(monthsSnap([{ id: '2026-05', data: { entries: {} } }]));
    expect(allDeletedKeys('entries')).toEqual([]);
  });

  it('still EMITS cloud additions (other-device changes) via union merge', async () => {
    createEngine();
    await engine.initialize();
    const before = cloudUpdates.length;
    listeners.months.cb(monthsSnap([
      { id: '2026-05', data: { entries: { '2026-05-20-new': { severity: 2, _t: 9 } } } },
    ]));
    expect(cloudUpdates.length).toBe(before + 1);
    const last = cloudUpdates[cloudUpdates.length - 1];
    expect(last.domains.entries['2026-05-20-new']).toBeTruthy();
    expect(last.opts.deletes).toEqual({});
  });
});
