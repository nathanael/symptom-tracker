import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock the field writer so we control its result and assert its args. ---
vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn(() => Promise.resolve({ ok: true, via: 'sdk' })),
}));

// --- Mock Firestore. We need stable, identity-comparable doc refs per path so
// the engine groups writes per doc and the test can assert which ref was used.
// Each month doc ref carries a `.path`; the definitions doc ref carries its own.
let mockDbValue;
let monthDocRefs; // monthId -> ref
let defDocRef;

function buildMockDb() {
  monthDocRefs = {};
  defDocRef = { path: 'users/test-user/meta/definitions', __kind: 'defs' };

  const monthsCollectionRef = {
    get: vi.fn(() => Promise.resolve({ docs: [] })),
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
  };
}

vi.mock('../../utils/firebase', () => ({
  getFirebaseDb: () => mockDbValue,
}));

import SyncEngineV2 from '../SyncEngineV2';
import { writeFieldUpdates } from '../fieldWriter';

describe('SyncEngineV2 — granular write path', () => {
  let engine;
  let cloudUpdates;
  const FIXED_NOW = 1700000000000;

  beforeEach(() => {
    vi.clearAllMocks();
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

  // Build an engine with a fixed clock + ready state + a seeded shadow, without
  // running the async initialize() (which would also start listeners).
  function makeEngine(shadow = {}) {
    engine = new SyncEngineV2('test-user', (domains, isInitial, opts) => {
      cloudUpdates.push({ domains, isInitial, opts });
    });
    engine._now = () => FIXED_NOW;
    engine._ready = true;
    engine._shadow = shadow;
    return engine;
  }

  // Find the single writeFieldUpdates call whose docRef matches a month id.
  function callForMonth(monthId) {
    return writeFieldUpdates.mock.calls.find(
      (c) => c[0] && c[0].__month === monthId,
    );
  }
  function callForDefs() {
    return writeFieldUpdates.mock.calls.find(
      (c) => c[0] && c[0].__kind === 'defs',
    );
  }

  it('Test 1: single entry tap → one write to correct month doc', async () => {
    makeEngine({ entries: {} });
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    await engine.flushNow();

    expect(writeFieldUpdates).toHaveBeenCalledTimes(1);
    const call = callForMonth('2026-03');
    expect(call).toBeTruthy();
    const payload = call[1];
    expect(payload.updates).toEqual({
      'entries.2026-03-15-a': { v: 1, _t: FIXED_NOW },
    });
    expect(payload.deletes || []).toEqual([]);
  });

  it('Test 2: dailyNotes uses the `notes` field, not dailyNotes', async () => {
    makeEngine({ dailyNotes: {} });
    engine.notifyLocalChange('dailyNotes', { '2026-03-15': { text: 'hi' } });
    await engine.flushNow();

    const call = callForMonth('2026-03');
    expect(call).toBeTruthy();
    expect(call[1].updates).toEqual({
      'notes.2026-03-15': { text: 'hi', _t: FIXED_NOW },
    });
  });

  it('Test 3: a removed key produces a delete field path', async () => {
    makeEngine({ entries: { '2026-03-15-a': { v: 1, _t: 1 }, '2026-03-16-b': { v: 2, _t: 1 } } });
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1, _t: 1 } });
    await engine.flushNow();

    const call = callForMonth('2026-03');
    expect(call).toBeTruthy();
    expect(call[1].deletes).toContain('entries.2026-03-16-b');
    expect(call[1].updates).toEqual({});
  });

  it('Test 4: edits spanning two months → one write per month doc', async () => {
    makeEngine({ entries: {} });
    engine.notifyLocalChange('entries', {
      '2026-03-15-a': { v: 1 },
      '2026-04-02-b': { v: 2 },
    });
    await engine.flushNow();

    expect(writeFieldUpdates).toHaveBeenCalledTimes(2);
    const mar = callForMonth('2026-03');
    const apr = callForMonth('2026-04');
    expect(mar[1].updates).toEqual({ 'entries.2026-03-15-a': { v: 1, _t: FIXED_NOW } });
    expect(apr[1].updates).toEqual({ 'entries.2026-04-02-b': { v: 2, _t: FIXED_NOW } });
  });

  it('Test 5: hiding a stackItem writes only that id; shadow updated → echo suppressed', async () => {
    const id = 'stk1';
    makeEngine({ stackItems: { [id]: { id, name: 'Vit', active: true, _t: 1 } } });
    engine.notifyLocalChange('stackItems', [{ id, name: 'Vit', active: false }]);
    await engine.flushNow();

    const call = callForDefs();
    expect(call).toBeTruthy();
    expect(call[1].updates).toEqual({
      [`stackItems.${id}`]: { id, name: 'Vit', active: false, _t: FIXED_NOW },
    });

    // Shadow now reflects active:false — the supplement-hide regression guard.
    expect(engine._shadow.stackItems[id].active).toBe(false);

    // Echo suppression: a cloud snapshot equal to the shadow does NOT re-emit.
    const before = cloudUpdates.length;
    engine._onCloudChanged('defs', {
      exists: true,
      data: () => ({ stackItems: { [id]: { id, name: 'Vit', active: false, _t: FIXED_NOW } } }),
    });
    expect(cloudUpdates.length).toBe(before);
  });

  it('Test 6: trackingMode change writes a {value,_t} field on defs', async () => {
    makeEngine({ trackingMode: { value: 'ampm', _t: 1 } });
    engine.notifyLocalChange('trackingMode', 'daily');
    await engine.flushNow();

    const call = callForDefs();
    expect(call[1].updates).toEqual({
      trackingMode: { value: 'daily', _t: FIXED_NOW },
    });
    expect(engine._shadow.trackingMode).toEqual({ value: 'daily', _t: FIXED_NOW });
  });

  it('Test 7: pinnedSymptoms change writes the whole field', async () => {
    makeEngine({ pinnedSymptoms: ['a'] });
    engine.notifyLocalChange('pinnedSymptoms', ['a', 'b']);
    await engine.flushNow();

    const call = callForDefs();
    expect(call[1].updates).toEqual({ pinnedSymptoms: ['a', 'b'] });
    expect(engine._shadow.pinnedSymptoms).toEqual(['a', 'b']);
  });

  it('Test 8: shadow update creates fresh objects, never mutates the hydrated map', async () => {
    const hydratedEntries = { '2026-03-15-a': { v: 1, _t: 1 } };
    makeEngine({ entries: hydratedEntries });
    const original = engine._shadow.entries; // capture reference emitted at hydrate

    engine.notifyLocalChange('entries', {
      '2026-03-15-a': { v: 1, _t: 1 },
      '2026-03-16-b': { v: 2 },
    });
    await engine.flushNow();

    // The new shadow has the new key...
    expect(engine._shadow.entries['2026-03-16-b']).toBeTruthy();
    // ...but the original object reference was NOT mutated.
    expect(original).toBe(hydratedEntries);
    expect('2026-03-16-b' in original).toBe(false);
    expect(Object.keys(original)).toEqual(['2026-03-15-a']);
  });

  it('Test 9: write-side clobber guarantee — only the edited key is touched', async () => {
    makeEngine({ entries: { '2026-03-15-a': { v: 1, _t: 1 }, '2026-03-20-c': { v: 3, _t: 1 } } });
    // Edit only the existing 'a' key; 'c' is unchanged.
    engine.notifyLocalChange('entries', {
      '2026-03-15-a': { v: 99, _t: 1 },
      '2026-03-20-c': { v: 3, _t: 1 },
    });
    await engine.flushNow();

    const call = callForMonth('2026-03');
    const updateKeys = Object.keys(call[1].updates);
    expect(updateKeys).toEqual(['entries.2026-03-15-a']);
    expect(call[1].deletes || []).toEqual([]);
  });

  it('Test 10: {ok:false} re-queues the pending write for retry', async () => {
    makeEngine({ entries: {} });
    writeFieldUpdates.mockImplementationOnce(() => Promise.resolve({ ok: false, error: 'boom' }));

    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1 } });
    await engine.flushNow();
    expect(writeFieldUpdates).toHaveBeenCalledTimes(1);

    // A subsequent flush retries the same write (now succeeds).
    await engine.flushNow();
    expect(writeFieldUpdates).toHaveBeenCalledTimes(2);
    const retry = writeFieldUpdates.mock.calls[1];
    expect(retry[1].updates).toEqual({ 'entries.2026-03-15-a': { v: 1, _t: FIXED_NOW } });
  });

  it('Test 11: no-op — data deep-equal to shadow does not write', async () => {
    makeEngine({ entries: { '2026-03-15-a': { v: 1, _t: 1 } } });
    engine.notifyLocalChange('entries', { '2026-03-15-a': { v: 1, _t: 999 } });
    await engine.flushNow();
    expect(writeFieldUpdates).not.toHaveBeenCalled();
  });
});
