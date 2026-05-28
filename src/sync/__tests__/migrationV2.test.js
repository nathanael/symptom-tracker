import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock localStorage. -----------------------------------------------------
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => (key in store ? store[key] : null)),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: () => { store = {}; },
    __setRaw: (k, v) => { store[k] = v; },
    __dump: () => ({ ...store }),
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

// --- Mock the field writer so we control its result and assert its args. ----
vi.mock('../fieldWriter', () => ({
  writeFieldUpdates: vi.fn(() => Promise.resolve({ ok: true, via: 'sdk' })),
}));

// --- Mock the snapshot util so runMigration's safety-net call is observable. -
vi.mock('../../utils/snapshots', () => ({
  saveSnapshot: vi.fn(() => 'snap-id'),
}));

import { writeFieldUpdates } from '../fieldWriter';
import { saveSnapshot } from '../../utils/snapshots';
import { assembleDomainsFromDocs } from '../hydrate';
import {
  needsMigration,
  readLocalDomains,
  buildMigrationWrites,
  runMigration,
} from '../migrationV2';

const NOW = 1716900000000;

// --- Inline representative fixtures resembling the real data. ---------------
// Two entries across TWO months; one stack/input entry; dailyNotes as BARE
// STRINGS; one entry with a pre-existing _t to prove preservation; a stackItems
// array with an item carrying a `history` array; trackingMode 'ampm'; pinned [].
function seedLocalStorage() {
  localStorageMock.clear();
  localStorageMock.__setRaw('symptomTracker_entries', JSON.stringify({
    '2026-02-15-pee-dribble-evening': { severity: 1, time: 'evening', symptomId: 'pee-dribble', date: '2026-02-15' },
    '2026-01-05-nerve-pain-morning': { severity: 3, time: 'morning', symptomId: 'nerve-pain', date: '2026-01-05', _t: 111 },
  }));
  localStorageMock.__setRaw('symptomTracker_stackEntries', JSON.stringify({
    '2026-02-10-magnesium': { taken: true, dose: '200mg', date: '2026-02-10', itemId: 'magnesium' },
  }));
  localStorageMock.__setRaw('symptomTracker_inputEntries', JSON.stringify({
    '2026-01-20-wheat': { logged: true, count: 2, date: '2026-01-20', inputId: 'wheat' },
  }));
  localStorageMock.__setRaw('symptomTracker_notes', JSON.stringify({
    '2026-01-16': 'I had several alcohol units',
    '2026-02-15': 'felt better',
  }));
  localStorageMock.__setRaw('symptomTracker_symptoms', JSON.stringify([
    { id: 'pee-dribble', name: 'Pee dribble', order: 0 },
    { id: 'nerve-pain', name: 'Nerve pain', order: 1 },
  ]));
  localStorageMock.__setRaw('symptomTracker_stackItems', JSON.stringify([
    { id: 'magnesium', name: 'Magnesium', history: [{ date: '2026-02-01', dose: '200mg' }] },
  ]));
  localStorageMock.__setRaw('symptomTracker_inputItems', JSON.stringify([
    { id: 'wheat', name: 'Wheat' },
  ]));
  localStorageMock.__setRaw('symptomTracker_pinned', JSON.stringify([]));
  localStorageMock.__setRaw('symptomTracker_mode', JSON.stringify('ampm'));
}

// --- A mock Firestore db whose refs are identity-stable per path. -----------
function buildMockDb() {
  const monthDocRefs = {};
  const defDocRef = { path: 'users/u1/meta/definitions', __kind: 'defs' };
  const migDocRef = { path: 'users/u1/meta/_migration', __kind: 'migration', set: vi.fn(() => Promise.resolve()) };

  const monthsCollectionRef = {
    doc: vi.fn((monthId) => {
      if (!monthDocRefs[monthId]) {
        monthDocRefs[monthId] = { path: `users/u1/months/${monthId}`, __kind: 'month', __month: monthId };
      }
      return monthDocRefs[monthId];
    }),
  };
  const metaCollectionRef = {
    doc: vi.fn((name) => (name === 'definitions' ? defDocRef : migDocRef)),
  };
  const userDocRef = {
    collection: vi.fn((name) => {
      if (name === 'meta') return metaCollectionRef;
      if (name === 'months') return monthsCollectionRef;
      throw new Error(`unexpected collection: ${name}`);
    }),
  };
  const db = {
    collection: vi.fn(() => ({ doc: vi.fn(() => userDocRef) })),
  };
  return { db, monthDocRefs, defDocRef, migDocRef };
}

// Apply a build spec's dotted field paths into a nested plain object (mirrors
// how Firestore field updates land). Used for the round-trip reconstruction.
function applyUpdatesToDoc(doc, updates) {
  for (const [dotted, value] of Object.entries(updates)) {
    const segs = dotted.split('.');
    let cursor = doc;
    for (let i = 0; i < segs.length; i++) {
      if (i === segs.length - 1) cursor[segs[i]] = value;
      else cursor = (cursor[segs[i]] ||= {});
    }
  }
  return doc;
}

beforeEach(() => {
  vi.clearAllMocks();
  writeFieldUpdates.mockImplementation(() => Promise.resolve({ ok: true, via: 'sdk' }));
  saveSnapshot.mockImplementation(() => 'snap-id');
});

afterEach(() => {
  localStorageMock.clear();
});

describe('needsMigration', () => {
  it('returns true when migrationDoc is null', () => {
    expect(needsMigration(null)).toBe(true);
  });
  it('returns true when migrationDoc is undefined', () => {
    expect(needsMigration(undefined)).toBe(true);
  });
  it('returns true for an empty object (no v2DoneAt)', () => {
    expect(needsMigration({})).toBe(true);
  });
  it('returns false once v2DoneAt is present', () => {
    expect(needsMigration({ v2DoneAt: 123 })).toBe(false);
  });
});

describe('readLocalDomains', () => {
  it('parses localStorage into the flat app shape keyed by domain', () => {
    seedLocalStorage();
    const local = readLocalDomains();

    expect(local.entries['2026-02-15-pee-dribble-evening']).toMatchObject({ severity: 1 });
    expect(local.entries['2026-01-05-nerve-pain-morning']).toMatchObject({ severity: 3, _t: 111 });
    expect(local.stackEntries['2026-02-10-magnesium']).toMatchObject({ taken: true });
    expect(local.inputEntries['2026-01-20-wheat']).toMatchObject({ count: 2 });
    expect(local.dailyNotes['2026-01-16']).toBe('I had several alcohol units');
    expect(Array.isArray(local.symptoms)).toBe(true);
    expect(local.symptoms).toHaveLength(2);
    expect(local.stackItems[0]).toMatchObject({ id: 'magnesium' });
    expect(local.stackItems[0].history).toHaveLength(1);
    expect(Array.isArray(local.inputItems)).toBe(true);
    expect(local.pinnedSymptoms).toEqual([]);
    expect(local.trackingMode).toBe('ampm');
  });

  it('skips a domain with corrupt JSON without throwing; others fine', () => {
    seedLocalStorage();
    localStorageMock.__setRaw('symptomTracker_entries', '{ this is not json');
    let local;
    expect(() => { local = readLocalDomains(); }).not.toThrow();
    // Corrupt entries domain → empty map.
    expect(local.entries).toEqual({});
    // Other domains unaffected.
    expect(local.symptoms).toHaveLength(2);
    expect(local.trackingMode).toBe('ampm');
  });
});

describe('buildMigrationWrites', () => {
  it('splits map-domain records into the correct per-month specs', () => {
    seedLocalStorage();
    const local = readLocalDomains();
    const specs = buildMigrationWrites(local, NOW);

    const monthSpecs = specs.filter((s) => s.target === 'month');
    const byMonth = Object.fromEntries(monthSpecs.map((s) => [s.month, s]));

    expect(byMonth['2026-02'].updates['entries.2026-02-15-pee-dribble-evening']).toBeDefined();
    expect(byMonth['2026-01'].updates['entries.2026-01-05-nerve-pain-morning']).toBeDefined();
    // stack/input entries route by their own months.
    expect(byMonth['2026-02'].updates['stackEntries.2026-02-10-magnesium']).toBeDefined();
    expect(byMonth['2026-01'].updates['inputEntries.2026-01-20-wheat']).toBeDefined();
  });

  it('converts bare-string dailyNotes into notes.<date> = {text,_t}', () => {
    seedLocalStorage();
    const local = readLocalDomains();
    const specs = buildMigrationWrites(local, NOW);
    const jan = specs.find((s) => s.target === 'month' && s.month === '2026-01');
    const noteVal = jan.updates['notes.2026-01-16'];
    expect(noteVal).toEqual({ text: 'I had several alcohol units', _t: NOW });
  });

  it('stamps _t on entries that lack it, preserves an existing _t', () => {
    seedLocalStorage();
    const local = readLocalDomains();
    const specs = buildMigrationWrites(local, NOW);
    const feb = specs.find((s) => s.target === 'month' && s.month === '2026-02');
    const jan = specs.find((s) => s.target === 'month' && s.month === '2026-01');
    // No _t originally → stamped with now.
    expect(feb.updates['entries.2026-02-15-pee-dribble-evening']._t).toBe(NOW);
    // Pre-existing _t preserved.
    expect(jan.updates['entries.2026-01-05-nerve-pain-morning']._t).toBe(111);
  });

  it('builds a single definitions spec preserving nested history + adding _t', () => {
    seedLocalStorage();
    const local = readLocalDomains();
    const specs = buildMigrationWrites(local, NOW);
    const defSpecs = specs.filter((s) => s.target === 'definitions');
    expect(defSpecs).toHaveLength(1);
    const def = defSpecs[0];

    expect(def.updates['stackItems.magnesium']).toMatchObject({ id: 'magnesium', _t: NOW });
    expect(def.updates['stackItems.magnesium'].history).toHaveLength(1);
    expect(def.updates['symptoms.pee-dribble']).toMatchObject({ id: 'pee-dribble', _t: NOW });
    expect(def.updates['pinnedSymptoms']).toEqual([]);
    expect(def.updates['trackingMode']).toEqual({ value: 'ampm', _t: NOW });
  });

  it('produces no specs for empty local domains', () => {
    localStorageMock.clear();
    const local = readLocalDomains();
    const specs = buildMigrationWrites(local, NOW);
    expect(specs).toEqual([]);
  });
});

describe('round-trip (lossless)', () => {
  it('reconstructs docs from specs and assembles back to original content', () => {
    seedLocalStorage();
    const local = readLocalDomains();
    const specs = buildMigrationWrites(local, NOW);

    const monthDocs = {};
    let defDoc = {};
    for (const spec of specs) {
      if (spec.target === 'month') {
        const data = (monthDocs[spec.month] ||= {});
        applyUpdatesToDoc(data, spec.updates);
      } else {
        applyUpdatesToDoc(defDoc, spec.updates);
      }
    }

    const { domains } = assembleDomainsFromDocs(defDoc, monthDocs);

    // Map domains: keys + meaningful content preserved (ignoring added _t).
    expect(Object.keys(domains.entries).sort()).toEqual(
      Object.keys(local.entries).sort()
    );
    expect(domains.entries['2026-02-15-pee-dribble-evening']).toMatchObject({ severity: 1 });
    expect(domains.stackEntries['2026-02-10-magnesium']).toMatchObject({ taken: true });
    expect(domains.inputEntries['2026-01-20-wheat']).toMatchObject({ count: 2 });

    // dailyNotes round-trips as {text,_t}; meaningful content is the text.
    expect(domains.dailyNotes['2026-01-16'].text).toBe('I had several alcohol units');
    expect(domains.dailyNotes['2026-02-15'].text).toBe('felt better');

    // Definition arrays come back with same ids + nested content.
    expect(domains.symptoms.map((s) => s.id).sort()).toEqual(['nerve-pain', 'pee-dribble']);
    const mag = domains.stackItems.find((s) => s.id === 'magnesium');
    expect(mag.history).toHaveLength(1);
    expect(domains.inputItems.map((s) => s.id)).toEqual(['wheat']);
    expect(domains.pinnedSymptoms).toEqual([]);
    expect(domains.trackingMode).toBe('ampm');
  });
});

describe('runMigration', () => {
  it('on full success: snapshots, writes all specs, sets flag, never touches old blob', async () => {
    seedLocalStorage();
    const { db, migDocRef } = buildMockDb();

    const result = await runMigration({ db, uid: 'u1', now: NOW });

    expect(saveSnapshot).toHaveBeenCalledWith('preMigrationV2');
    expect(result.migrated).toBe(true);
    expect(result.failures).toEqual([]);

    // Flag written with v2DoneAt.
    expect(migDocRef.set).toHaveBeenCalledTimes(1);
    const [flagPayload, opts] = migDocRef.set.mock.calls[0];
    expect(flagPayload.v2DoneAt).toBe(NOW);
    expect(opts).toEqual({ merge: true });

    // Old blob doc users/u1 is never referenced as a write target. The only
    // user-doc subcollections touched are months + meta.
    // (writeFieldUpdates only ever gets month + definitions refs.)
    for (const call of writeFieldUpdates.mock.calls) {
      const ref = call[0];
      expect(['month', 'defs']).toContain(ref.__kind);
    }
  });

  it('on a failing spec write: does NOT set the flag and returns failures', async () => {
    seedLocalStorage();
    const { db, migDocRef } = buildMockDb();

    // Make month writes fail, definitions succeed.
    writeFieldUpdates.mockImplementation((ref) => {
      if (ref.__kind === 'month') return Promise.resolve({ ok: false, error: 'boom' });
      return Promise.resolve({ ok: true, via: 'sdk' });
    });

    const result = await runMigration({ db, uid: 'u1', now: NOW });

    expect(result.migrated).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    // Flag NOT written → needsMigration stays true → retries next boot.
    expect(migDocRef.set).not.toHaveBeenCalled();
  });

  it('on empty localStorage: writes the flag and returns migrated:false reason empty', async () => {
    localStorageMock.clear();
    const { db, migDocRef } = buildMockDb();

    const result = await runMigration({ db, uid: 'u1', now: NOW });

    expect(result.migrated).toBe(false);
    expect(result.reason).toBe('empty');
    // No data writes.
    expect(writeFieldUpdates).not.toHaveBeenCalled();
    // Flag still written so we don't re-attempt forever.
    expect(migDocRef.set).toHaveBeenCalledTimes(1);
    expect(migDocRef.set.mock.calls[0][0].v2DoneAt).toBe(NOW);
  });

  it('idempotency: the written flag makes needsMigration return false', async () => {
    seedLocalStorage();
    const { db, migDocRef } = buildMockDb();
    await runMigration({ db, uid: 'u1', now: NOW });
    const writtenFlag = migDocRef.set.mock.calls[0][0];
    expect(needsMigration(writtenFlag)).toBe(false);
  });
});
