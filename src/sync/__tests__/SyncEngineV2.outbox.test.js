import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock localStorage ---
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: () => { store = {}; },
    _store: () => store,
    _set: (key, val) => { store[key] = val; },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

// --- Mock the field writer so we control its result and assert its args. ---
vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn(() => Promise.resolve({ ok: true, via: 'sdk' })),
}));

// --- Mock Firestore. Doc refs are derived two ways:
//   - via collection().doc() chain (the engine's write path), and
//   - via db.doc(fullPath) (the outbox replay path).
// Both must return identity-stable refs keyed on the same path.
let mockDbValue;
let refsByPath;

function refForPath(path) {
  if (!refsByPath[path]) refsByPath[path] = { path };
  return refsByPath[path];
}

function buildMockDb() {
  refsByPath = {};

  const monthsCollectionRef = {
    get: vi.fn(() => Promise.resolve({ docs: [] })),
    onSnapshot: vi.fn(() => vi.fn()),
    doc: vi.fn((monthId) => refForPath(`users/test-user/months/${monthId}`)),
  };
  const metaCollectionRef = {
    doc: vi.fn(() => refForPath('users/test-user/meta/definitions')),
  };
  const userDocRef = {
    collection: vi.fn((name) => {
      if (name === 'meta') return metaCollectionRef;
      if (name === 'months') return monthsCollectionRef;
      throw new Error(`unexpected collection: ${name}`);
    }),
  };
  return {
    collection: vi.fn(() => ({ doc: vi.fn(() => userDocRef) })),
    // Used by outbox replay to rebuild a ref from a full path.
    doc: vi.fn((fullPath) => refForPath(fullPath)),
  };
}

vi.mock('../../utils/firebase', () => ({
  getFirebaseDb: () => mockDbValue,
}));

import SyncEngineV2 from '../SyncEngineV2';
import { writeFieldUpdates } from '../fieldWriter';
import { listOps, OUTBOX_KEY } from '../outbox';

describe('SyncEngineV2 — durable offline outbox', () => {
  let engine;
  let cloudUpdates;
  const FIXED_NOW = 1700000000000;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: true, via: 'sdk' }));
    cloudUpdates = [];
    mockDbValue = buildMockDb();
  });

  afterEach(() => {
    if (engine) {
      engine.destroy();
      engine = null;
    }
  });

  function makeEngine(shadow = {}) {
    engine = new SyncEngineV2('test-user', (domains, isInitial, opts) => {
      cloudUpdates.push({ domains, isInitial, opts });
    });
    engine._now = () => FIXED_NOW;
    engine._ready = true;
    engine._shadow = shadow;
    return engine;
  }

  it('Test 1: flush failure persists the op to the durable outbox', async () => {
    makeEngine({ entries: {} });
    writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: false, error: 'boom' }));

    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    await engine.flush();

    const ops = listOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].docPath).toBe('users/test-user/months/2026-03');
    expect(ops[0].updates).toEqual({ 'entries.2026-03-15-a': { v: 1, _t: FIXED_NOW } });
    // Not double-tracked in memory.
    expect(Object.keys(engine._pending).length).toBe(0);
  });

  it('Test 2: replayOutbox replays a queued op and removes it on success', async () => {
    makeEngine({ entries: {} });
    writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: false, error: 'boom' }));
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    await engine.flush();
    expect(listOps()).toHaveLength(1);

    // Now writes succeed; replay drains the outbox.
    writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: true, via: 'sdk' }));
    await engine.replayOutbox();

    const replayCall = writeFieldUpdates.mock.calls.find(
      (c) => c[0] && c[0].path === 'users/test-user/months/2026-03',
    );
    expect(replayCall).toBeTruthy();
    expect(replayCall[1].updates).toEqual({ 'entries.2026-03-15-a': { v: 1, _t: FIXED_NOW } });
    expect(listOps()).toHaveLength(0);
  });

  it('Test 3: _t-guard on replay drops a fieldPath the shadow already has same-or-newer', async () => {
    makeEngine({ entries: {} });
    // Seed an op directly in the outbox: update for key K with _t=5.
    localStorageMock._set(
      OUTBOX_KEY,
      JSON.stringify([
        {
          id: 'op1',
          docPath: 'users/test-user/months/2026-03',
          updates: { 'entries.2026-03-15-k': { v: 1, _t: 5 } },
          deletes: [],
          deleteBaseT: {},
          ts: 1,
        },
      ]),
    );
    // Engine shadow already has K at _t=9 (newer).
    engine._shadow = { entries: { '2026-03-15-k': { v: 2, _t: 9 } } };

    await engine.replayOutbox();

    // No write for that fieldPath; op removed as a no-op.
    const replayCall = writeFieldUpdates.mock.calls.find(
      (c) => c[0] && c[0].path === 'users/test-user/months/2026-03',
    );
    expect(replayCall).toBeFalsy();
    expect(listOps()).toHaveLength(0);
  });

  it('Test 4: replay delete guard skips a delete the shadow now has newer', async () => {
    makeEngine({ entries: {} });
    localStorageMock._set(
      OUTBOX_KEY,
      JSON.stringify([
        {
          id: 'opDel',
          docPath: 'users/test-user/months/2026-03',
          updates: {},
          deletes: ['entries.2026-03-15-a'],
          deleteBaseT: { 'entries.2026-03-15-a': 1 },
          ts: 1,
        },
      ]),
    );
    // Shadow A now at _t=5 (> deleteBaseT 1) → delete is stale, skip.
    engine._shadow = { entries: { '2026-03-15-a': { v: 9, _t: 5 } } };

    await engine.replayOutbox();

    const replayCall = writeFieldUpdates.mock.calls.find(
      (c) => c[0] && c[0].path === 'users/test-user/months/2026-03',
    );
    expect(replayCall).toBeFalsy();
    expect(listOps()).toHaveLength(0);
  });

  it('Test 5: corrupt outbox storage → replayOutbox does not throw, no-op', async () => {
    makeEngine({ entries: {} });
    localStorageMock._set(OUTBOX_KEY, '{corrupt');
    await expect(engine.replayOutbox()).resolves.not.toThrow;
    expect(writeFieldUpdates).not.toHaveBeenCalled();
  });

  it('Test 6: replay failure leaves the op in the outbox for next time', async () => {
    makeEngine({ entries: {} });
    localStorageMock._set(
      OUTBOX_KEY,
      JSON.stringify([
        {
          id: 'op1',
          docPath: 'users/test-user/months/2026-03',
          updates: { 'entries.2026-03-15-a': { v: 1, _t: 5 } },
          deletes: [],
          deleteBaseT: {},
          ts: 1,
        },
      ]),
    );
    writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: false, error: 'still offline' }));

    await engine.replayOutbox();

    expect(writeFieldUpdates).toHaveBeenCalled();
    expect(listOps()).toHaveLength(1);
    expect(listOps()[0].id).toBe('op1');
  });
});
