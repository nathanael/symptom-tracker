import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Cross-device delete propagation via TOMBSTONES.
//
// Several engines ("devices") share one fake Firestore. Each device applies
// cloud updates to its own state with the SAME merge the React hook uses
// (mergeCloudMap) and — like the hook — never echoes a cloud-apply back to the
// engine. Server snapshots are delivered explicitly (cloud.broadcast()) so
// every interleaving is deterministic.
//
// THE GUARANTEES:
//   - a delete (Clear day / single clear) reaches every device;
//   - a device still holding the deleted records never resurrects them;
//   - a NEWER local write (Undo, re-rating) beats the tombstone everywhere;
//   - a key merely ABSENT from a snapshot still deletes nothing.

const clone = (v) => JSON.parse(JSON.stringify(v));

// --- fake Firestore shared by every device ---------------------------------
let cloud;

function createCloud() {
  return {
    docs: {},          // 'months/2020-01' | 'meta/definitions' → data
    listeners: {},     // uid → { months, defs }
    offline: new Set(),
    outbox: [],
    replayUid: null,
    local: {},         // what readLocalDomains() returns (the booting device's localStorage)
    restorePending: false,
    monthDocs() {
      return Object.keys(this.docs)
        .filter((p) => p.startsWith('months/'))
        .map((p) => ({ id: p.slice('months/'.length), data: clone(this.docs[p]) }));
    },
    write(path, { updates = {}, deletes = [] }) {
      const rel = path.split('/').slice(2).join('/');
      const doc = this.docs[rel] || (this.docs[rel] = {});
      const split = (fp) => { const i = fp.indexOf('.'); return i === -1 ? [fp, null] : [fp.slice(0, i), fp.slice(i + 1)]; };
      for (const [fp, value] of Object.entries(updates)) {
        const [field, key] = split(fp);
        if (key == null) doc[field] = clone(value);
        else (doc[field] || (doc[field] = {}))[key] = clone(value);
      }
      for (const fp of deletes) {
        const [field, key] = split(fp);
        if (key == null) delete doc[field];
        else if (doc[field]) delete doc[field][key];
      }
    },
    // Deliver an authoritative server snapshot of the months collection.
    broadcast(monthDocs = this.monthDocs()) {
      for (const uid of Object.keys(this.listeners)) {
        if (this.offline.has(uid)) continue;
        const l = this.listeners[uid];
        if (l.months) {
          l.months({
            docs: clone(monthDocs).map((d) => ({ id: d.id, data: () => d.data })),
            metadata: { fromCache: false, hasPendingWrites: false },
          });
        }
      }
    },
    record(monthId, field, key) {
      const doc = this.docs[`months/${monthId}`];
      return doc && doc[field] ? doc[field][key] : undefined;
    },
  };
}

function buildDb() {
  const userDoc = (uid) => ({
    get: () => Promise.resolve({ exists: false, data: () => null }),
    collection: (name) => {
      if (name === 'months') {
        return {
          get: () => (cloud.offline.has(uid)
            ? Promise.reject(new Error('offline'))
            : Promise.resolve({ docs: cloud.monthDocs().map((d) => ({ id: d.id, data: () => d.data })) })),
          doc: (id) => ({ path: `users/${uid}/months/${id}` }),
          onSnapshot: (cb) => {
            (cloud.listeners[uid] || (cloud.listeners[uid] = {})).months = cb;
            return () => { if (cloud.listeners[uid]) delete cloud.listeners[uid].months; };
          },
        };
      }
      return {
        doc: (docId) => ({
          path: `users/${uid}/meta/${docId}`,
          get: () => (cloud.offline.has(uid)
            ? Promise.reject(new Error('offline'))
            : Promise.resolve({
              exists: !!cloud.docs[`meta/${docId}`],
              data: () => clone(cloud.docs[`meta/${docId}`] || null),
            })),
          onSnapshot: () => () => {},
        }),
      };
    },
  });
  return {
    collection: () => ({ doc: (uid) => userDoc(uid) }),
    doc: (path) => ({ path }),
  };
}

vi.mock('../../utils/firebase', () => ({ getFirebaseDb: () => buildDb() }));
vi.mock('../../utils/snapshots', () => ({ saveSnapshot: vi.fn(() => null) }));
vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn((ref, payload) => {
    const uid = ref.path.split('/')[1];
    if (cloud.offline.has(uid)) return Promise.resolve({ ok: false, error: 'offline' });
    cloud.write(ref.path, payload);
    return Promise.resolve({ ok: true, via: 'sdk' });
  }),
}));
vi.mock('../migrationV2', () => ({
  needsMigration: () => false,
  readLocalDomains: () => clone(cloud.local),
  runMigration: vi.fn(),
}));
vi.mock('../outbox', () => ({
  enqueueOp: vi.fn((op) => { const stored = { ...clone(op), id: `op${cloud.outbox.length}` }; cloud.outbox.push(stored); return stored; }),
  listOps: vi.fn(() => cloud.outbox.filter((op) => op.docPath.split('/')[1] === cloud.replayUid)),
  removeOp: vi.fn((id) => { cloud.outbox = cloud.outbox.filter((op) => op.id !== id); }),
}));
vi.mock('../restoreFlag', () => ({
  isRestorePending: () => cloud.restorePending,
  clearRestorePending: () => { cloud.restorePending = false; },
  markRestorePending: vi.fn(),
}));

import SyncEngineV2 from '../SyncEngineV2';
import { TOMBSTONE_TTL_MS, isTombstone } from '../tombstones';
import { mergeCloudMap } from '../merge';
import { writeFieldUpdates } from '../fieldWriter';

const MAPS = ['entries', 'stackEntries', 'inputEntries', 'dailyNotes'];
const DAY = '2020-01-05';
const K1 = `${DAY}-sym1-daily`;
const K2 = `${DAY}-sym2-daily`;
const OTHER = '2020-01-06-sym1-daily';
const rating = (key, severity, extra = {}) => {
  const [, date, symptomId, time] = key.match(/^(\d{4}-\d{2}-\d{2})-(.+)-([^-]+)$/);
  return { time, severity, date, symptomId, ...extra };
};
// listHelpers.clearDay, inlined (it is app code, not under test here).
const clearDay = (map, dateKey) => {
  const next = {}; const removed = {};
  for (const [k, e] of Object.entries(map)) (e && e.date === dateKey ? removed : next)[k] = e;
  return { next, removed };
};

let now;
let devices;

class Device {
  constructor(uid, local = {}) {
    this.uid = uid;
    this.state = { entries: {}, stackEntries: {}, inputEntries: {}, dailyNotes: {}, ...clone(local) };
    this.emits = [];
    cloud.local = clone(this.state); // the engine seeds its local view from localStorage
    this.engine = new SyncEngineV2(uid, (domains, isInitial, opts) => {
      this.emits.push({ domains, isInitial, opts });
      for (const d of MAPS) {
        if (!(d in domains)) continue;
        this.state[d] = (opts && opts.replace)
          ? domains[d]
          : mergeCloudMap(this.state[d], domains[d], opts && opts.tombstones && opts.tombstones[d]);
      }
    });
    this.engine._now = () => now;
    devices.push(this);
  }

  // Boot exactly like the hook: initialize, then reconcile against localStorage.
  // `staleLocal` models the hook's race: localStorage has not yet caught up
  // with the state the initial cloud-apply just produced.
  async boot({ staleLocal } = {}) {
    cloud.local = clone(this.state);
    cloud.replayUid = this.uid;
    await this.engine.initialize();
    cloud.local = staleLocal ? clone(staleLocal) : clone(this.state);
    await this.engine.reconcile(clone(cloud.local));
    return this;
  }

  // A user edit: update state, tell the engine (as useLocalStorage does).
  set(domain, updater) {
    this.state[domain] = updater(this.state[domain]);
    this.engine.notifyLocalChange(domain, this.state[domain]);
  }

  async edit(domain, updater) {
    this.set(domain, updater);
    await this.engine.flushNow();
  }
}

async function twoDevicesWith(entries) {
  cloud.docs['months/2020-01'] = { entries: clone(entries) };
  const a = await new Device('A').boot();
  const b = await new Device('B').boot();
  return { a, b };
}

const seeded = () => ({
  [K1]: { ...rating(K1, 3), _t: 100 },
  [K2]: { ...rating(K2, 1), _t: 100 },
  [OTHER]: { ...rating(OTHER, 2), _t: 100 },
});

describe('SyncEngineV2 — tombstones (cross-device deletes)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cloud = createCloud();
    devices = [];
    now = 1000;
  });

  afterEach(() => { for (const d of devices) d.engine.destroy(); });

  it('Clear day on device A removes the entries on device B', async () => {
    const { a, b } = await twoDevicesWith(seeded());
    expect(Object.keys(b.state.entries).sort()).toEqual([K1, K2, OTHER].sort());

    now = 2000;
    await a.edit('entries', (prev) => clearDay(prev, DAY).next);
    cloud.broadcast();

    expect(Object.keys(a.state.entries)).toEqual([OTHER]);
    expect(Object.keys(b.state.entries)).toEqual([OTHER]);
  });

  it('writes a tombstone instead of deleting the field, and it carries no payload (no note)', async () => {
    cloud.docs['months/2020-01'] = { entries: { [K1]: { ...rating(K1, 3, { note: 'private' }), _t: 100 } } };
    const a = await new Device('A').boot();

    now = 2000;
    await a.edit('entries', () => ({}));

    const rec = cloud.record('2020-01', 'entries', K1);
    expect(rec).toEqual({ _deleted: true, _t: 2000, severity: -1 });
    expect(JSON.stringify(rec)).not.toContain('private');
    const lastCall = writeFieldUpdates.mock.calls.at(-1)[1];
    expect(lastCall.deletes).toEqual([]);
  });

  it('a single-entry clear propagates and leaves the rest of the day alone', async () => {
    const { a, b } = await twoDevicesWith(seeded());

    now = 2000;
    await a.edit('entries', (prev) => { const next = { ...prev }; delete next[K1]; return next; });
    cloud.broadcast();

    expect(K1 in b.state.entries).toBe(false);
    expect(b.state.entries[K2].severity).toBe(1);
  });

  it('daily notes and protocol entries are tombstoned the same way', async () => {
    cloud.docs['months/2020-01'] = {
      notes: { [DAY]: { text: 'hello', _t: 100 } },
      stackEntries: { [`${DAY}-mag`]: { date: DAY, itemId: 'mag', taken: true, _t: 100 } },
    };
    const a = await new Device('A').boot();
    const b = await new Device('B').boot();

    now = 2000;
    a.set('dailyNotes', () => ({}));
    await a.edit('stackEntries', () => ({}));
    cloud.broadcast();

    expect(b.state.dailyNotes).toEqual({});
    expect(b.state.stackEntries).toEqual({});
    expect(cloud.record('2020-01', 'notes', DAY)).toEqual({ _deleted: true, _t: 2000 });
  });

  it('tombstones never reach app state or the emitted domains', async () => {
    const { a, b } = await twoDevicesWith(seeded());
    now = 2000;
    await a.edit('entries', (prev) => clearDay(prev, DAY).next);
    cloud.broadcast();
    const c = await new Device('C').boot();

    for (const d of [a, b, c]) {
      expect(Object.values(d.state.entries).some(isTombstone)).toBe(false);
      for (const e of d.emits) {
        for (const domain of MAPS) {
          expect(Object.values(e.domains[domain] || {}).some(isTombstone)).toBe(false);
        }
      }
    }
    expect(Object.keys(c.state.entries)).toEqual([OTHER]);
  });

  describe('a device holding stale copies does not resurrect them', () => {
    it('booting with the cleared entries still in localStorage removes them and pushes nothing back', async () => {
      const { a } = await twoDevicesWith(seeded());
      now = 2000;
      await a.edit('entries', (prev) => clearDay(prev, DAY).next);

      // C was closed during the clear; its localStorage still holds the day —
      // some copies cloud-stamped, some never stamped (C authored them).
      const stale = { entries: { [K1]: { ...rating(K1, 3), _t: 100 }, [K2]: rating(K2, 1), [OTHER]: { ...rating(OTHER, 2), _t: 100 } } };
      now = 3000;
      const c = new Device('C', stale);
      // reconcile reads a localStorage that has NOT yet caught up with the removal.
      await c.boot({ staleLocal: stale });

      expect(Object.keys(c.state.entries)).toEqual([OTHER]);
      expect(isTombstone(cloud.record('2020-01', 'entries', K1))).toBe(true);
      expect(isTombstone(cloud.record('2020-01', 'entries', K2))).toBe(true);
    });

    it('stale copies are removed on boot even when the cloud holds nothing but tombstones', async () => {
      cloud.docs['months/2020-01'] = { entries: { [K1]: { _deleted: true, _t: 2000, severity: -1 } } };
      now = 3000;
      const stale = { entries: { [K1]: rating(K1, 3) } };
      const c = await new Device('C', stale).boot({ staleLocal: stale });

      expect(c.state.entries).toEqual({});
      expect(isTombstone(cloud.record('2020-01', 'entries', K1))).toBe(true);
    });

    it('an open instance that still holds the entries does not write them back on its next edit', async () => {
      const { a, b } = await twoDevicesWith(seeded());
      now = 2000;
      await a.edit('entries', (prev) => clearDay(prev, DAY).next);
      // B's listener is stalled: it has NOT heard about the clear and still
      // holds (and shows) the whole day when the user edits something else.
      now = 3000;
      await b.edit('entries', (prev) => ({ ...prev, [OTHER]: rating(OTHER, 4) }));
      expect(isTombstone(cloud.record('2020-01', 'entries', K1))).toBe(true);

      cloud.broadcast(); // B catches up
      expect(Object.keys(b.state.entries)).toEqual([OTHER]);

      now = 4000;
      await b.edit('entries', (prev) => ({ ...prev, [OTHER]: rating(OTHER, 5) }));
      cloud.broadcast();

      expect(isTombstone(cloud.record('2020-01', 'entries', K1))).toBe(true);
      expect(isTombstone(cloud.record('2020-01', 'entries', K2))).toBe(true);
      expect(cloud.record('2020-01', 'entries', OTHER).severity).toBe(5);
      expect(Object.keys(a.state.entries)).toEqual([OTHER]);
    });

    it('an edit made before the engine is ready does not upload stale copies over tombstones', async () => {
      const { a } = await twoDevicesWith(seeded());
      now = 2000;
      await a.edit('entries', (prev) => clearDay(prev, DAY).next);

      const stale = { entries: { [K1]: rating(K1, 3), [K2]: { ...rating(K2, 1), _t: 100 } } };
      now = 3000;
      const c = new Device('C', stale);
      cloud.local = clone(stale);
      // The user taps a rating before initialize() has finished.
      c.set('entries', (prev) => ({ ...prev, [OTHER]: rating(OTHER, 4) }));
      await c.boot({ staleLocal: c.state });
      await c.engine.flushNow();

      expect(isTombstone(cloud.record('2020-01', 'entries', K1))).toBe(true);
      expect(isTombstone(cloud.record('2020-01', 'entries', K2))).toBe(true);
      expect(cloud.record('2020-01', 'entries', OTHER).severity).toBe(4);
    });
  });

  describe('a newer local write beats the tombstone', () => {
    it('Undo after Clear day restores the entries on both devices', async () => {
      const { a, b } = await twoDevicesWith(seeded());
      now = 2000;
      const { next, removed } = clearDay(a.state.entries, DAY);
      await a.edit('entries', () => next);
      cloud.broadcast();
      expect(Object.keys(b.state.entries)).toEqual([OTHER]);

      // App.jsx onUndo: setEntries(prev => ({ ...removed, ...prev })) — the
      // restored records keep their OLD `_t` (100), older than the tombstone.
      now = 2500;
      await a.edit('entries', (prev) => ({ ...removed, ...prev }));
      cloud.broadcast();

      expect(a.state.entries[K1].severity).toBe(3);
      expect(b.state.entries[K1].severity).toBe(3);
      expect(b.state.entries[K2].severity).toBe(1);
      expect(cloud.record('2020-01', 'entries', K1)).toEqual({ ...rating(K1, 3), _t: 2500 });
    });

    it('re-rating a cleared symptom on the OTHER device — even with the same value — sticks everywhere', async () => {
      const { a, b } = await twoDevicesWith(seeded());
      // B has been editing, so the engine's last local view of B includes K1.
      now = 1500;
      await b.edit('entries', (prev) => ({ ...prev, [OTHER]: rating(OTHER, 4) }));
      cloud.broadcast();
      now = 2000;
      await a.edit('entries', (prev) => clearDay(prev, DAY).next);
      cloud.broadcast();
      expect(K1 in b.state.entries).toBe(false);

      now = 3000;
      await b.edit('entries', (prev) => ({ ...prev, [K1]: rating(K1, 3) }));
      cloud.broadcast();

      expect(cloud.record('2020-01', 'entries', K1)).toEqual({ ...rating(K1, 3), _t: 3000 });
      expect(a.state.entries[K1].severity).toBe(3);
      expect(b.state.entries[K1].severity).toBe(3);
    });

    it('re-rating right after boot (first edit of the session) beats an existing tombstone', async () => {
      const { a } = await twoDevicesWith(seeded());
      now = 2000;
      await a.edit('entries', (prev) => clearDay(prev, DAY).next);

      now = 3000;
      const c = await new Device('C').boot();
      await c.edit('entries', (prev) => ({ ...prev, [K1]: rating(K1, 2) }));

      expect(cloud.record('2020-01', 'entries', K1)).toEqual({ ...rating(K1, 2), _t: 3000 });
    });

    it('a re-rating still wins when the re-rating device\'s clock is BEHIND the tombstone', async () => {
      const { a, b } = await twoDevicesWith(seeded());
      now = 5000;
      await a.edit('entries', (prev) => clearDay(prev, DAY).next);
      cloud.broadcast();

      now = 4000; // B's clock is slow
      await b.edit('entries', (prev) => ({ ...prev, [K1]: rating(K1, 4) }));
      cloud.broadcast();

      expect(cloud.record('2020-01', 'entries', K1)._t).toBeGreaterThan(5000);
      expect(a.state.entries[K1].severity).toBe(4);
    });

    it('a fresh, not-yet-flushed local rating is not removed by an incoming OLDER tombstone', async () => {
      const { a, b } = await twoDevicesWith({ [OTHER]: { ...rating(OTHER, 2), _t: 100 } });
      // A once had K1 and cleared it (tombstone 2000); B never saw K1.
      cloud.docs['months/2020-01'].entries[K1] = { _deleted: true, _t: 2000, severity: -1 };

      now = 3000;
      b.set('entries', (prev) => ({ ...prev, [K1]: rating(K1, 3) })); // pending, unflushed
      cloud.broadcast(); // the tombstone is news to B while its write is in flight
      expect(b.state.entries[K1].severity).toBe(3);

      await b.engine.flushNow();
      cloud.broadcast();
      expect(cloud.record('2020-01', 'entries', K1)).toEqual({ ...rating(K1, 3), _t: 3000 });
      expect(a.state.entries[K1].severity).toBe(3);
    });
  });

  describe('offline edits resolve last-writer-wins against a tombstone', () => {
    async function offlineEditThenClear({ editAt, clearAt }) {
      const { a, b } = await twoDevicesWith(seeded());
      cloud.offline.add('B');
      now = editAt;
      await b.edit('entries', (prev) => ({ ...prev, [K1]: rating(K1, 5) })); // fails → outbox

      now = clearAt;
      await a.edit('entries', (prev) => clearDay(prev, DAY).next);

      // B comes back: fresh boot (shadow from the real cloud), then replay.
      cloud.offline.delete('B');
      now = Math.max(editAt, clearAt) + 1000;
      b.engine.destroy();
      const b2 = await new Device('B', b.state).boot();
      await b2.engine.replayOutbox();
      cloud.broadcast();
      return { a, b: b2 };
    }

    it('an OLDER offline edit loses to the newer tombstone', async () => {
      const { a, b } = await offlineEditThenClear({ editAt: 2000, clearAt: 3000 });
      expect(isTombstone(cloud.record('2020-01', 'entries', K1))).toBe(true);
      expect(K1 in a.state.entries).toBe(false);
      expect(K1 in b.state.entries).toBe(false);
      expect(cloud.outbox).toEqual([]);
    });

    it('a NEWER offline edit wins over the older tombstone', async () => {
      const { a, b } = await offlineEditThenClear({ editAt: 3000, clearAt: 2000 });
      expect(cloud.record('2020-01', 'entries', K1)).toEqual({ ...rating(K1, 5), _t: 3000 });
      expect(a.state.entries[K1].severity).toBe(5);
      expect(b.state.entries[K1].severity).toBe(5);
    });

    it('an offline Clear day replays as tombstones stamped when the user cleared', async () => {
      const { a, b } = await twoDevicesWith(seeded());
      cloud.offline.add('B');
      now = 2000;
      await b.edit('entries', (prev) => clearDay(prev, DAY).next);
      expect(cloud.record('2020-01', 'entries', K1).severity).toBe(3);

      cloud.offline.delete('B');
      now = 9000;
      cloud.replayUid = 'B';
      await b.engine.replayOutbox();
      cloud.broadcast();

      expect(cloud.record('2020-01', 'entries', K1)).toEqual({ _deleted: true, _t: 2000, severity: -1 });
      expect(Object.keys(a.state.entries)).toEqual([OTHER]);
    });

    it('a delete is still skipped when a newer remote write of that key arrived first (existing _t-guard)', async () => {
      const { a, b } = await twoDevicesWith(seeded());
      now = 2000;
      b.set('entries', (prev) => clearDay(prev, DAY).next); // staged, not flushed
      now = 2100;
      await a.edit('entries', (prev) => ({ ...prev, [K1]: rating(K1, 5) }));
      cloud.broadcast(); // B's shadow advances to A's newer K1 before B flushes
      await b.engine.flushNow();

      expect(cloud.record('2020-01', 'entries', K1).severity).toBe(5);
      expect(isTombstone(cloud.record('2020-01', 'entries', K2))).toBe(true);
    });
  });

  describe('absence is still never a delete', () => {
    it('a lagging snapshot that is missing keys (and has no tombstone) deletes nothing', async () => {
      const { a, b } = await twoDevicesWith(seeded());
      now = 2000;
      await a.edit('entries', (prev) => ({ ...prev, '2020-01-07-sym1-daily': rating('2020-01-07-sym1-daily', 4) }));

      // An authoritative-looking snapshot that predates everything.
      cloud.broadcast([{ id: '2020-01', data: { entries: {} } }]);
      cloud.broadcast([]);

      expect(Object.keys(a.state.entries).length).toBe(4);
      expect(Object.keys(b.state.entries).length).toBe(3);
      for (const d of [a, b]) {
        for (const e of d.emits) {
          expect((e.opts && e.opts.deletes) || {}).toEqual({});
          expect((e.opts && e.opts.tombstones) || {}).toEqual({});
        }
      }
      expect(cloud.record('2020-01', 'entries', K1).severity).toBe(3);
    });

    it('a lagging snapshot that still shows the pre-clear record does not resurrect it on the clearing device', async () => {
      const { a } = await twoDevicesWith(seeded());
      const beforeClear = cloud.monthDocs();
      now = 2000;
      await a.edit('entries', (prev) => clearDay(prev, DAY).next);

      cloud.broadcast(beforeClear); // stale server view: K1/K2 still live
      expect(Object.keys(a.state.entries)).toEqual([OTHER]);

      // …and A's next edit must not turn that stale view into a re-push.
      now = 3000;
      await a.edit('entries', (prev) => ({ ...prev, [OTHER]: rating(OTHER, 1) }));
      expect(isTombstone(cloud.record('2020-01', 'entries', K1))).toBe(true);
    });

    it('a lagging snapshot showing an OLD tombstone does not remove a record we re-wrote after it', async () => {
      const { a, b } = await twoDevicesWith(seeded());
      now = 2000;
      await a.edit('entries', (prev) => clearDay(prev, DAY).next);
      const withTombstones = cloud.monthDocs();
      cloud.broadcast();
      now = 3000;
      await b.edit('entries', (prev) => ({ ...prev, [K1]: rating(K1, 2) }));

      cloud.broadcast(withTombstones); // lags B's re-rating
      expect(b.state.entries[K1].severity).toBe(2);
      now = 4000;
      await b.edit('entries', (prev) => ({ ...prev, [OTHER]: rating(OTHER, 1) }));
      expect(cloud.record('2020-01', 'entries', K1).severity).toBe(2);
    });
  });

  describe('pruning', () => {
    it('reconcile truly deletes tombstones older than the TTL and keeps younger ones', async () => {
      const { a } = await twoDevicesWith(seeded());
      now = 2000;
      await a.edit('entries', (prev) => { const n = { ...prev }; delete n[K1]; return n; });
      now = 2000 + TOMBSTONE_TTL_MS - 5000;
      await a.edit('entries', (prev) => { const n = { ...prev }; delete n[K2]; return n; });

      now = 2000 + TOMBSTONE_TTL_MS + 1;
      await a.engine.reconcile(clone(a.state));

      expect(cloud.record('2020-01', 'entries', K1)).toBeUndefined();
      expect(isTombstone(cloud.record('2020-01', 'entries', K2))).toBe(true);
      expect(K1 in a.engine._shadow.entries).toBe(false);
      expect(cloud.record('2020-01', 'entries', OTHER).severity).toBe(2);
    });

    it('a failed prune write changes nothing and is retried on the next reconcile', async () => {
      const { a } = await twoDevicesWith(seeded());
      now = 2000;
      await a.edit('entries', (prev) => { const n = { ...prev }; delete n[K1]; return n; });
      now = 2000 + TOMBSTONE_TTL_MS + 1;

      writeFieldUpdates.mockImplementationOnce(() => Promise.resolve({ ok: false, error: 'boom' }));
      await a.engine._pruneTombstones();
      expect(isTombstone(a.engine._shadow.entries[K1])).toBe(true);

      await a.engine._pruneTombstones();
      expect(cloud.record('2020-01', 'entries', K1)).toBeUndefined();
    });
  });

  it('restoring a local snapshot brings back entries that were cleared since it was taken', async () => {
    const { a } = await twoDevicesWith(seeded());
    const snapshot = clone(a.state);
    now = 2000;
    await a.edit('entries', (prev) => clearDay(prev, DAY).next);
    a.engine.destroy();

    // Settings → restore snapshot → reload: localStorage is the old state.
    cloud.restorePending = true;
    now = 3000;
    const a2 = await new Device('A', snapshot).boot();
    cloud.broadcast();

    expect(a2.state.entries[K1].severity).toBe(3);
    expect(cloud.record('2020-01', 'entries', K1).severity).toBe(3);
    expect(cloud.record('2020-01', 'entries', K1)._t).toBe(3000);
    expect(cloud.restorePending).toBe(false);
  });
});
