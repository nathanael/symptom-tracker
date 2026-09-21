import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Two devices, one cloud. Each device is a real SyncEngineV2 whose cloud updates are applied to a
// local map the way useSyncEngine applies them (mergeMapByTime + applyTombstones). Writes land in
// a shared in-memory "Firestore"; `deliver()` hands every device the current server snapshot.

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

let cloud; // { [monthId]: { entries: { key: record } } }
let monthListeners;

const clone = (value) => JSON.parse(JSON.stringify(value));

vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn((ref, { updates, deletes }) => {
    const monthId = ref.path.split('/').pop();
    const doc = cloud[monthId] || (cloud[monthId] = {});
    for (const [fieldPath, value] of Object.entries(updates)) {
      const dot = fieldPath.indexOf('.');
      const field = fieldPath.slice(0, dot);
      (doc[field] || (doc[field] = {}))[fieldPath.slice(dot + 1)] = clone(value);
    }
    for (const fieldPath of deletes) {
      const dot = fieldPath.indexOf('.');
      if (doc[fieldPath.slice(0, dot)]) delete doc[fieldPath.slice(0, dot)][fieldPath.slice(dot + 1)];
    }
    return Promise.resolve({ ok: true, via: 'sdk' });
  }),
}));

const monthDocs = () => Object.keys(cloud).map((id) => ({ id, data: () => clone(cloud[id]) }));

vi.mock('../../utils/firebase', () => ({
  getFirebaseDb: () => {
    const monthsRef = {
      get: () => Promise.resolve({ docs: monthDocs() }),
      onSnapshot: (cb) => {
        monthListeners.push(cb);
        return () => {};
      },
      doc: (monthId) => ({ path: `users/u/months/${monthId}` }),
    };
    const defsRef = {
      path: 'users/u/meta/definitions',
      get: () => Promise.resolve({ exists: false, data: () => null }),
      onSnapshot: () => () => {},
    };
    const userDoc = { collection: (name) => (name === 'months' ? monthsRef : { doc: () => defsRef }) };
    return { collection: () => ({ doc: () => userDoc }), doc: (path) => ({ path }) };
  },
}));

import SyncEngineV2 from '../SyncEngineV2';
import { mergeMapByTime } from '../merge';
import { applyTombstones, TOMBSTONE_TTL_MS } from '../tombstones';

let clock;
let devices;

async function makeDevice(initialEntries = {}) {
  const device = { entries: { ...initialEntries } };
  device.engine = new SyncEngineV2('u', (domains, isInitial, opts) => {
    if (domains?.entries) device.entries = mergeMapByTime(device.entries, domains.entries);
    if (opts?.tombstones?.entries) device.entries = applyTombstones(device.entries, opts.tombstones.entries);
  });
  device.engine._now = () => clock;
  // The user changes local data: React state updates, then the engine is told and flushes.
  device.set = async (next) => {
    clock += 1000;
    device.entries = next;
    device.engine.notifyLocalChange('entries', next);
    await device.engine.flushNow();
  };
  await device.engine.initialize();
  devices.push(device);
  return device;
}

// A confirmed server snapshot reaches every listening device
const deliver = () => monthListeners.forEach((cb) => cb({ docs: monthDocs(), metadata: { fromCache: false, hasPendingWrites: false } }));

const K1 = '2026-03-15-headache-morning';
const K2 = '2026-03-15-nausea-morning';
const rating = (severity) => ({ severity, date: '2026-03-15' });

describe('SyncEngineV2 — deletes across devices (tombstones)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    cloud = {};
    monthListeners = [];
    devices = [];
    clock = 1_700_000_000_000;
  });

  afterEach(() => devices.forEach((d) => d.engine.destroy()));

  it('Clear day on one device removes the entries on the other', async () => {
    const a = await makeDevice();
    const b = await makeDevice();
    await a.set({ [K1]: rating(2), [K2]: rating(3) });
    deliver();
    expect(Object.keys(b.entries).sort()).toEqual([K1, K2].sort());

    await a.set({});
    deliver();
    expect(b.entries).toEqual({});
    expect(a.entries).toEqual({});
  });

  it('clearing a single rating propagates and leaves the rest alone', async () => {
    const a = await makeDevice();
    const b = await makeDevice();
    await a.set({ [K1]: rating(2), [K2]: rating(3) });
    deliver();
    await a.set({ [K2]: a.entries[K2] });
    deliver();
    expect(Object.keys(b.entries)).toEqual([K2]);
  });

  it('a device holding stale copies does not bring cleared entries back', async () => {
    const a = await makeDevice();
    const b = await makeDevice();
    await a.set({ [K1]: rating(2), [K2]: rating(3) });
    deliver();
    await a.set({});
    deliver();

    // B's next unrelated edit must not re-upload what A cleared
    const K3 = '2026-03-15-fatigue-morning';
    await b.set({ ...b.entries, [K3]: rating(1) });
    deliver();
    expect(Object.keys(a.entries)).toEqual([K3]);
    expect(Object.keys(b.entries)).toEqual([K3]);
    expect(cloud['2026-03'].entries[K1]._deleted).toBe(true);
  });

  it('reconcile on load drops stale local copies instead of resurrecting them', async () => {
    const a = await makeDevice();
    await a.set({ [K1]: rating(2) });
    await a.set({});

    // B was closed the whole time; its localStorage still has the entry (with the old _t)
    const stale = { [K1]: { ...rating(2), _t: clock - 5000 } };
    const b = await makeDevice(stale);
    await b.engine.reconcile({ entries: stale });
    expect(b.entries).toEqual({});
    expect(cloud['2026-03'].entries[K1]._deleted).toBe(true);
  });

  it('Undo after Clear day restores the entries everywhere', async () => {
    const a = await makeDevice();
    const b = await makeDevice();
    await a.set({ [K1]: rating(2) });
    deliver();
    const before = a.entries;
    await a.set({});
    deliver();
    await a.set(before); // undo puts the old records back
    deliver();
    expect(b.entries[K1].severity).toBe(2);
    expect(a.entries[K1].severity).toBe(2);
    expect(cloud['2026-03'].entries[K1]._deleted).toBeUndefined();
  });

  it('re-rating after a clear wins over the older tombstone', async () => {
    const a = await makeDevice();
    const b = await makeDevice();
    await a.set({ [K1]: rating(2) });
    deliver();
    await a.set({});
    deliver();
    await b.set({ [K1]: rating(4) });
    deliver();
    expect(a.entries[K1].severity).toBe(4);
    expect(b.entries[K1].severity).toBe(4);
  });

  it('a lagging view that still shows the tombstone cannot delete a newer re-rating', async () => {
    const a = await makeDevice();
    await a.set({ [K1]: rating(2) });
    await a.set({});
    const lagging = { docs: monthDocs(), metadata: { fromCache: false, hasPendingWrites: false } };
    await a.set({ [K1]: rating(5) });

    // Make the engine see a changed-but-stale view: the old tombstone plus an unrelated key
    lagging.docs = lagging.docs.map((d) => ({ id: d.id, data: () => ({ entries: { ...d.data().entries, [K2]: { ...rating(1), _t: 5 } } }) }));
    monthListeners.forEach((cb) => cb(lagging));
    expect(a.entries[K1].severity).toBe(5);
  });

  it('a view that merely lacks keys (no tombstone) still deletes nothing', async () => {
    const a = await makeDevice();
    const b = await makeDevice();
    await a.set({ [K1]: rating(2), [K2]: rating(3) });
    deliver();
    // A snapshot missing K2 entirely, as a stalled channel can produce
    const partial = { docs: [{ id: '2026-03', data: () => ({ entries: { [K1]: clone(cloud['2026-03'].entries[K1]) } }) }], metadata: { fromCache: false, hasPendingWrites: false } };
    monthListeners.forEach((cb) => cb(partial));
    expect(Object.keys(b.entries).sort()).toEqual([K1, K2].sort());
  });

  it('tombstones never reach the app as data', async () => {
    const a = await makeDevice();
    await a.set({ [K1]: rating(2) });
    await a.set({});
    const fresh = await makeDevice();
    expect(fresh.entries).toEqual({});
    expect(Object.values(fresh.entries).some((r) => r._deleted)).toBe(false);
  });

  it('prunes tombstones older than the TTL on reconcile', async () => {
    const a = await makeDevice();
    await a.set({ [K1]: rating(2) });
    await a.set({});
    expect(cloud['2026-03'].entries[K1]._deleted).toBe(true);

    clock += TOMBSTONE_TTL_MS + 1000;
    await a.engine.reconcile({ entries: {} });
    expect(K1 in cloud['2026-03'].entries).toBe(false);
  });
});
