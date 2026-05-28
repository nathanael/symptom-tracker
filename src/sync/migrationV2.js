// migrationV2 — one-time, non-destructive migration from the OLD Firestore
// model (one blob doc per user) to the NEW per-month / definitions model.
//
// It reads from LOCALSTORAGE — the freshest, most complete source on the
// migrating device — NOT the cloud blob, and writes the new shape via granular
// field updates. It is:
//   - NON-DESTRUCTIVE: never deletes/touches the old blob doc `users/{uid}`,
//     and snapshots localStorage before doing anything.
//   - IDEMPOTENT: a `_migration` flag (v2DoneAt) gates re-running.
//
// All routing/shape logic is reused from the existing sync modules; this file
// only orchestrates localStorage → field-update specs → writes + the flag.

import { DOMAINS, MAP_DOMAINS } from './domains.js';
import { groupKeysByMonth } from './keyRouting.js';
import { arrayToIdMap } from './definitionShape.js';
import { writeFieldUpdates } from './fieldWriter.js';
import { saveSnapshot } from '../utils/snapshots.js';

// The month-doc field name for daily notes is `notes`; every other map domain
// shares its field name with its domain. Mirrors SyncEngineV2.js / hydrate.js.
const FIELD_FOR_MAP_DOMAIN = {
  dailyNotes: 'notes',
};

function fieldForMapDomain(domain) {
  return FIELD_FOR_MAP_DOMAIN[domain] || domain;
}

const DEFINITION_ID_DOMAINS = ['symptoms', 'stackItems', 'inputItems'];

/**
 * @param {Object|null|undefined} migrationDoc - data of users/{uid}/meta/_migration.
 * @returns {boolean} true when migration has not yet completed.
 */
export function needsMigration(migrationDoc) {
  if (migrationDoc == null) return true;
  return typeof migrationDoc.v2DoneAt !== 'number';
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Read all symptomTracker_* keys from localStorage into the flat app shape,
 * keyed by DOMAIN name. Corrupt JSON in one key is skipped (that domain falls
 * back to its empty default) without throwing.
 *
 * @returns {{ entries, dailyNotes, stackEntries, inputEntries, symptoms,
 *             stackItems, inputItems, pinnedSymptoms, trackingMode }}
 */
export function readLocalDomains() {
  const out = {};
  for (const [domain, cfg] of Object.entries(DOMAINS)) {
    const raw = localStorage.getItem(cfg.storageKey);
    // Omit domains with no stored data so a pristine device reads as fully
    // empty (no defaulted [] / {} that would masquerade as real data).
    if (raw == null) continue;
    const parsed = safeParse(raw);

    if (cfg.kind === 'map') {
      out[domain] = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } else if (cfg.kind === 'idArray') {
      out[domain] = Array.isArray(parsed) ? parsed : [];
    } else if (typeof parsed === 'string') { // scalar (trackingMode)
      out[domain] = parsed;
    }
  }
  return out;
}

// Ensure an object record carries a numeric `_t`: keep an existing numeric _t,
// otherwise stamp `now`.
function stampObj(obj, now) {
  return { ...obj, _t: typeof obj._t === 'number' ? obj._t : now };
}

// Stamp a map-domain value. For dailyNotes a bare string becomes {text,_t};
// objects (and the other map domains) just get a guaranteed `_t`.
function stampMapValue(domain, value, now) {
  if (domain === 'dailyNotes' && typeof value !== 'object') {
    // Old dailyNotes values are BARE STRINGS (e.g. "I had several alcohol
    // units"); the new model stores notes as { text, _t }.
    return { text: value, _t: now };
  }
  if (value && typeof value === 'object') {
    return stampObj(value, now);
  }
  // Fallback: a primitive in a non-note map domain — wrap defensively.
  return { value, _t: now };
}

/**
 * Translate the flat local domains into an array of write specs.
 *
 * @param {Object} localDomains - output of readLocalDomains().
 * @param {number} now - wall-clock ms used to stamp records lacking a _t.
 * @returns {Array<{ target:'month'|'definitions', month?:string,
 *                   updates:Object, deletes:Array }>}
 */
export function buildMigrationWrites(localDomains, now) {
  const monthSpecs = {}; // month -> spec
  const defUpdates = {};

  // --- Map domains → per-month specs. ---
  for (const domain of MAP_DOMAINS) {
    const map = localDomains[domain];
    if (!map || typeof map !== 'object') continue;
    const keys = Object.keys(map);
    if (keys.length === 0) continue;

    const field = fieldForMapDomain(domain);
    const byMonth = groupKeysByMonth(keys);
    for (const [month, monthKeys] of Object.entries(byMonth)) {
      const spec = (monthSpecs[month] ||= { target: 'month', month, updates: {}, deletes: [] });
      for (const recordKey of monthKeys) {
        spec.updates[`${field}.${recordKey}`] = stampMapValue(domain, map[recordKey], now);
      }
    }
  }

  // --- Definition id-array domains → one definitions spec. ---
  for (const domain of DEFINITION_ID_DOMAINS) {
    const arr = localDomains[domain];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const idMap = arrayToIdMap(arr);
    for (const [id, obj] of Object.entries(idMap)) {
      defUpdates[`${domain}.${id}`] = stampObj(obj, now);
    }
  }

  // pinnedSymptoms: whole field (plain array).
  if (Array.isArray(localDomains.pinnedSymptoms)) {
    defUpdates['pinnedSymptoms'] = localDomains.pinnedSymptoms;
  }

  // trackingMode: scalar → { value, _t }.
  if (typeof localDomains.trackingMode === 'string') {
    defUpdates['trackingMode'] = { value: localDomains.trackingMode, _t: now };
  }

  const specs = Object.values(monthSpecs);
  if (Object.keys(defUpdates).length > 0) {
    specs.push({ target: 'definitions', updates: defUpdates, deletes: [] });
  }
  return specs;
}

function resolveDocRef(db, uid, spec) {
  const userDoc = db.collection('users').doc(uid);
  if (spec.target === 'month') {
    return userDoc.collection('months').doc(spec.month);
  }
  return userDoc.collection('meta').doc('definitions');
}

// A best-effort device identifier for diagnostics on the flag doc. Not relied
// upon for correctness — only v2DoneAt gates re-running.
function deviceId() {
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    return navigator.userAgent.slice(0, 64);
  }
  return 'unknown';
}

/**
 * Run the one-time migration. Snapshots localStorage, writes the new shape via
 * field updates, and only writes the `_migration` flag when ALL writes succeed
 * (so a partial failure retries on the next boot). Never touches the old blob.
 *
 * @returns {Promise<{ migrated:boolean, reason?:string, failures?:Array }>}
 */
export async function runMigration({ db, uid, now }) {
  // 1. Local safety net before anything else.
  saveSnapshot('preMigrationV2');

  // 2. Read the freshest source.
  const local = readLocalDomains();
  const specs = buildMigrationWrites(local, now);

  const migrationRef = db.collection('users').doc(uid).collection('meta').doc('_migration');

  // 3. No local data at all → still write the flag so we don't retry forever.
  if (specs.length === 0) {
    await migrationRef.set({ v2DoneAt: now, fromDevice: deviceId() }, { merge: true });
    return { migrated: false, reason: 'empty' };
  }

  // 4. Apply every spec, collecting failures. Never touch the old blob doc.
  const failures = [];
  for (const spec of specs) {
    const ref = resolveDocRef(db, uid, spec);
    const res = await writeFieldUpdates(ref, { updates: spec.updates, deletes: [] });
    if (!res || res.ok !== true) {
      failures.push({
        target: spec.target,
        month: spec.month,
        error: (res && res.error) || 'unknown',
      });
    }
  }

  // 5. Only write the flag if EVERY spec write succeeded; otherwise leave it
  //    unset so needsMigration stays true and the migration retries next boot.
  if (failures.length > 0) {
    return { migrated: false, failures };
  }

  await migrationRef.set({ v2DoneAt: now, fromDevice: deviceId() }, { merge: true });
  return { migrated: true, failures };
}
