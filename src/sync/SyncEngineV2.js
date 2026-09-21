// SyncEngineV2 — granular per-record sync engine (in progress).
//
// This file currently implements ONLY construction + the initial hydrate:
// read the cloud (definitions doc + months collection), assemble it back into
// the flat app shape, and push it to React once via onCloudUpdate.
//
// The realtime listener (Task 10), the write path (Task 11), and the
// migration / boot-fallback (Task 15) are intentionally NOT implemented here.

import { getFirebaseDb } from '../utils/firebase';
import { assembleDomainsFromDocs } from './hydrate';
import { mergeMapByTime, mergeIdArrayByTime } from './merge';
import { diffMapDomain, diffIdMapDomain, equalIgnoringT } from './changeDiff';
import { arrayToIdMap } from './definitionShape';
import { groupKeysByMonth } from './keyRouting';
import { writeFieldUpdates } from './fieldWriter';
import { MAP_DOMAINS } from './domains';
import { enqueueOp, listOps, removeOp } from './outbox';
import { saveSnapshot } from '../utils/snapshots';
import { needsMigration, readLocalDomains, runMigration } from './migrationV2';
import { isTombstone, makeTombstone, tOf, TOMBSTONE_TTL_MS } from './tombstones';
import { isRestorePending, clearRestorePending } from './restoreFlag';

// --- Resilience constants (silent-listener-death recovery) ---
// On Safari PWA the Firestore streaming listener can die silently (no error
// callback). The heartbeat detects a stall (no snapshot for too long) and
// catches up via a one-shot re-read; the poll covers the case where the
// listener NEVER delivers (channel blocked) so we still get data.
export const HEARTBEAT_INTERVAL_MS = 60000;  // how often we check liveness
export const HEARTBEAT_DEAD_MS = 120000;     // stall threshold → force refresh
export const POLL_INTERVAL_MS = 30000;       // poll cadence until first deliver
// A key we wrote within this window is protected from remote-delete detection:
// a snapshot (or a server read) can momentarily lag our own just-written record
// — especially after a REST-fallback write, which bypasses the SDK listener's
// cache — and the lagging view must NOT be allowed to delete data we just wrote.
export const RECENT_WRITE_TTL_MS = 60000;

// Legacy blob (OLD model) domain fields stored as STRINGIFIED JSON on the doc
// `users/{uid}`. trackingMode was stored as a PLAIN string (not stringified).
// Mirrors the OLD SyncEngine.js STRINGIFIED_DOMAINS + SYNC_DOMAINS.
const LEGACY_STRINGIFIED_DOMAINS = [
  'entries', 'dailyNotes', 'stackEntries', 'stackItems',
  'symptoms', 'inputItems', 'inputEntries', 'pinnedSymptoms',
];

// Definition domains stored as id-keyed maps in the shadow (so remote deletes
// of individual records can be detected the same way map domains are).
const ID_MAP_DOMAINS = ['symptoms', 'stackItems', 'inputItems'];

// The month-doc field name for daily notes is `notes`; every other map domain
// shares its field name with its domain. Mirrors hydrate.js.
const FIELD_FOR_MAP_DOMAIN = {
  entries: 'entries',
  stackEntries: 'stackEntries',
  inputEntries: 'inputEntries',
  dailyNotes: 'notes',
};

function fieldForMapDomain(domain) {
  return FIELD_FOR_MAP_DOMAIN[domain] || domain;
}

// Order-insensitive equality for the pinnedSymptoms id array.
function arraysEqualAsSet(a, b) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length !== bb.length) return false;
  const setB = new Set(bb);
  for (const v of aa) if (!setB.has(v)) return false;
  return true;
}

// Compare two flat maps ({ key: value+_t }) for equality, ignoring `_t`.
// Map-domain values are ALWAYS objects carrying `_t` (e.g. dailyNotes is
// `{ text, _t }`), so object-based equalIgnoringT is safe to use here.
function mapsEqual(a, b) {
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!(k in b)) return false;
    if (!equalIgnoringT(a[k], b[k])) return false;
  }
  return true;
}

// Keys present in `oldMap` but absent in `newMap` — i.e. remote deletions.
function deletedKeys(oldMap, newMap) {
  const out = [];
  for (const k of Object.keys(oldMap || {})) {
    if (!newMap || !(k in newMap)) out.push(k);
  }
  return out;
}

/**
 * Whether the assembled domains carry ANY real data.
 *
 * assembleDomainsFromDocs always returns every domain key (entries:{},
 * symptoms:[], etc.), so Object.keys(domains).length is non-zero even for an
 * empty cloud. This gate distinguishes "we have something to show" from
 * "the cloud is empty" so we only emit an initial cloud update when there is
 * actual data.
 *
 * A domain counts as data when it is a non-empty object (map domain) or a
 * non-empty array (definition domain), or when trackingMode is present.
 */
export function hasAnyData(domains) {
  if (!domains || typeof domains !== 'object') return false;
  for (const key of Object.keys(domains)) {
    const value = domains[key];
    if (Array.isArray(value)) {
      if (value.length > 0) return true;
    } else if (value && typeof value === 'object') {
      if (Object.keys(value).length > 0) return true;
    } else if (value != null) {
      // Scalar present (e.g. trackingMode string).
      return true;
    }
  }
  return false;
}

export default class SyncEngineV2 {
  constructor(uid, onCloudUpdate) {
    this.uid = uid;
    this.onCloudUpdate = onCloudUpdate;

    // Per-domain last-synced view, used for diffing on the write path (later)
    // and for echo suppression / remote-delete detection on the listener.
    this._shadow = {};

    // Raw caches seeded during initialize and refreshed on each snapshot, so
    // any single snapshot can re-assemble the FULL cloud state.
    this._rawMonths = []; // array of { id, data }
    this._rawDefs = null; // definitions doc data object (or null)

    // Listener unsubscribe functions.
    this._unsubMonths = null;
    this._unsubDefs = null;

    this._ready = false;
    this._destroyed = false;

    // --- Resilience (silent-listener-death recovery) ---
    // Timestamp (ms via _now) of the last sign of cloud life: a processed
    // snapshot, the initial hydrate, or a successful refreshFromCloud(). The
    // heartbeat uses this to detect a stalled listener.
    this._lastActivity = 0;
    // Set true the first time a real snapshot reaches _onCloudChanged. Until
    // then the poll fallback re-fetches the cloud (the streaming channel may be
    // blocked); once true the poll no-ops.
    this._listenerDelivered = false;
    this._heartbeatTimer = null;
    this._pollTimer = null;
    // `${domain} ${key}` -> ms timestamp of our most recent local write to
    // that record. Used to protect freshly-written keys from spurious remote
    // deletes when a snapshot/read lags our own write. Pruned on access.
    this._recentWrites = new Map();

    // --- Tombstones (cross-device deletes; see tombstones.js) ---
    // Per map domain, the last LOCAL view this engine was told about (seeded
    // from localStorage at boot). The app never stamps `_t`, so when a key whose
    // shadow is a tombstone shows up in a local view, this is how a genuinely
    // new local write (re-rating, Undo — differs from the last view) is told
    // apart from a stale copy of the deleted record (unchanged since).
    this._localView = {};
    // Latest value per domain notified BEFORE the engine was ready. Diffing
    // those against the still-empty shadow would upload the whole local map
    // with fresh stamps — straight over any tombstone — so they are held and
    // diffed once the real shadow exists.
    this._early = {};
    // The pending map currently being written by _doFlush (so an in-flight
    // local write still shields its key from an older incoming tombstone).
    this._inflight = null;
    // True for the boot that follows a snapshot restore: local records are the
    // user's deliberate choice and beat tombstones written since the snapshot.
    this._restoreMode = false;
    this._seedLocalView();

    // --- Write path (Task 11) ---
    // Pending writes keyed by target doc PATH. Each entry:
    //   { ref, updates: {fieldPath: value}, deletes: Set<fieldPath>,
    //     shadowChanges: { domain: { key: stampedValue } },
    //     shadowDeletes:  { domain: [keys] },
    //     shadowWhole:    { domain: value } }
    // shadowChanges/Deletes apply to map + id-map domains; shadowWhole covers
    // whole-field domains (pinnedSymptoms, trackingMode).
    this._pending = {};
    this._flushTimer = null;
    this._flushing = false;
    // The in-flight flush promise, set for the duration of flush()'s async work
    // and cleared when it settles. flushNow() awaits this so it cannot resolve
    // prematurely while a debounced flush is mid-await (unload durability).
    this._flushPromise = null;
    // Injectable clock so tests can fix "now".
    this._now = Date.now;

    // Parity with the old engine; status notification is optional here.
    this.syncing = false;
    this.lastSynced = null;
    this.syncError = null;
    this.onStatusChange = null;
  }

  // Emit the current status to the React hook (if wired). Mirrors the old
  // SyncEngine's _notifyStatus() so syncing/lastSynced/syncError surface live.
  _notifyStatus() {
    this.onStatusChange?.({
      syncing: this.syncing,
      lastSynced: this.lastSynced,
      syncError: this.syncError,
    });
  }

  // --- Write path -----------------------------------------------------------

  /**
   * React notifies the engine that a domain's full value changed. We diff
   * against the shadow and enqueue ONLY the changed/deleted records as atomic
   * field-path updates, then schedule a debounced flush.
   *
   * @param {string} domain
   * @param {*} data new full domain value (array for definition domains, flat
   *   map for map domains, string for trackingMode).
   */
  notifyLocalChange(domain, data, { reconcile = false } = {}) {
    if (this._destroyed) return;
    if (!this._ready) {
      // Shadow not established yet — hold the view, diff it at the end of
      // initialize() (see _early).
      this._early[domain] = data;
      return;
    }
    const now = this._now();

    if (MAP_DOMAINS.includes(domain)) {
      this._enqueueMapDomain(domain, data, now, reconcile);
    } else if (ID_MAP_DOMAINS.includes(domain)) {
      this._enqueueIdMapDomain(domain, data, now);
    } else if (domain === 'pinnedSymptoms') {
      this._enqueuePinned(data);
    } else if (domain === 'trackingMode') {
      this._enqueueTrackingMode(data, now);
    } else {
      return; // unknown domain — ignore.
    }

    this._scheduleFlush();
  }

  // Resolve (and lazily create) the pending entry for a given doc ref/path.
  _pendingFor(ref) {
    const path = ref.path;
    let entry = this._pending[path];
    if (!entry) {
      entry = {
        ref,
        updates: {},
        deletes: new Set(),
        // Base `_t` captured for each pending delete fieldPath at enqueue time
        // (the `_t` of the shadow record being deleted, 0 if absent). Used at
        // flush to skip a delete that a newer remote write has superseded.
        deleteBaseT: {},
        // `_t` for the tombstone each pending MAP-domain delete is written as.
        deleteT: {},
        shadowChanges: {},
        shadowDeletes: {},
        shadowWhole: {},
      };
      this._pending[path] = entry;
    }
    return entry;
  }

  _monthDocRef(monthId) {
    const db = getFirebaseDb();
    return db
      .collection('users')
      .doc(this.uid)
      .collection('months')
      .doc(monthId);
  }

  _defsDocRef() {
    const db = getFirebaseDb();
    return db
      .collection('users')
      .doc(this.uid)
      .collection('meta')
      .doc('definitions');
  }

  _enqueueMapDomain(domain, data, now, reconcile = false) {
    const shadowDomain = this._shadow[domain] || {};
    const view = (data && typeof data === 'object') ? data : {};
    // Is a local record sitting on a tombstoned key a NEW local write? (Only
    // asked when its own `_t` does not already beat the tombstone.)
    //   - reconcile views come from localStorage, which can still hold records
    //     the hook has just removed — never fresh, unless the user restored a
    //     snapshot (then every local record is a deliberate write);
    //   - otherwise: fresh iff it differs from the last local view we saw.
    const last = this._localView[domain];
    const isFresh = (key, record) => {
      if (reconcile) return this._restoreMode;
      if (!last) return false;
      return !(key in last) || !equalIgnoringT(last[key], record);
    };
    const { changed, deleted } = diffMapDomain(shadowDomain, view, now, isFresh);
    const field = fieldForMapDomain(domain);
    if (!reconcile) this._localView[domain] = view;

    const changedByMonth = groupKeysByMonth(Object.keys(changed));
    for (const monthId of Object.keys(changedByMonth)) {
      const entry = this._pendingFor(this._monthDocRef(monthId));
      const sc = entry.shadowChanges[domain] || (entry.shadowChanges[domain] = {});
      for (const key of changedByMonth[monthId]) {
        const stamped = changed[key];
        entry.updates[`${field}.${key}`] = stamped;
        // A later edit wins; a write supersedes a prior delete of the same key.
        this._undelete(entry, domain, `${field}.${key}`, key);
        sc[key] = stamped;
        if (entry.shadowDeletes[domain]) {
          entry.shadowDeletes[domain] = entry.shadowDeletes[domain].filter((k) => k !== key);
        }
      }
    }

    const deletedByMonth = groupKeysByMonth(deleted);
    for (const monthId of Object.keys(deletedByMonth)) {
      const entry = this._pendingFor(this._monthDocRef(monthId));
      for (const key of deletedByMonth[monthId]) {
        this._enqueueDelete(entry, domain, `${field}.${key}`, key, shadowDomain[key], now);
      }
    }

    // Cancel any pending add/change for a key that the user removed within the
    // SAME debounce window. diffMapDomain is shadow-relative, so a key that was
    // added then removed before flush (and never existed in the shadow) is NOT
    // reported as `deleted`; without this reconciliation its stale pending
    // update would be written to the cloud, resurrecting a record the user
    // explicitly deleted. Walk pending update paths and drop any whose key is
    // absent from the new view.
    for (const path of Object.keys(this._pending)) {
      const entry = this._pending[path];
      const sc = entry.shadowChanges[domain];
      const prefix = `${field}.`;
      for (const fieldPath of Object.keys(entry.updates)) {
        if (!fieldPath.startsWith(prefix)) continue;
        const key = fieldPath.slice(prefix.length);
        if (key in view) continue; // still present — leave it.
        // Removed in-window. Drop the pending update and its shadow staging.
        delete entry.updates[fieldPath];
        if (sc) delete sc[key];
        // If the key also exists in the shadow, the removal is a genuine delete
        // (it would otherwise persist in the cloud). Stage it as one, guarded.
        if (key in shadowDomain && !isTombstone(shadowDomain[key])) {
          this._enqueueDelete(entry, domain, fieldPath, key, shadowDomain[key], now);
        }
      }
    }
  }

  // Stage a delete of `key` (fieldPath) on `entry`, recording the base `_t`
  // of the shadow record so flush can skip it if a newer remote write arrives.
  //
  // For MAP domains the delete is written as a TOMBSTONE (see _buildWrite), not
  // a field delete; `deleteT` is its `_t` — when the user deleted, pushed past
  // the record being deleted so the delete wins even if this clock is behind.
  _enqueueDelete(entry, domain, fieldPath, key, shadowRecord, now = this._now()) {
    // A delete supersedes a prior write of the same key in this window.
    if (fieldPath in entry.updates) {
      delete entry.updates[fieldPath];
      if (entry.shadowChanges[domain]) delete entry.shadowChanges[domain][key];
    }
    entry.deletes.add(fieldPath);
    entry.deleteT[fieldPath] = Math.max(now, tOf(shadowRecord) + 1);
    entry.deleteBaseT[fieldPath] =
      (shadowRecord && typeof shadowRecord === 'object' && typeof shadowRecord._t === 'number')
        ? shadowRecord._t
        : 0;
    const sd = entry.shadowDeletes[domain] || (entry.shadowDeletes[domain] = []);
    if (!sd.includes(key)) sd.push(key);
  }

  // Cancel a previously-staged delete of `key` (fieldPath) on `entry` because a
  // newer write of the same key arrived in the same window.
  _undelete(entry, domain, fieldPath, key) {
    entry.deletes.delete(fieldPath);
    delete entry.deleteBaseT[fieldPath];
    delete entry.deleteT[fieldPath];
    if (entry.shadowDeletes[domain]) {
      entry.shadowDeletes[domain] = entry.shadowDeletes[domain].filter((k) => k !== key);
    }
  }

  _enqueueIdMapDomain(domain, data, now) {
    const shadowDomain = this._shadow[domain] || {};
    const idMap = arrayToIdMap(data);
    const { changed, deleted } = diffIdMapDomain(shadowDomain, idMap, now);

    const entry = this._pendingFor(this._defsDocRef());
    const sc = entry.shadowChanges[domain] || (entry.shadowChanges[domain] = {});
    for (const id of Object.keys(changed)) {
      const stamped = changed[id];
      entry.updates[`${domain}.${id}`] = stamped;
      this._undelete(entry, domain, `${domain}.${id}`, id);
      sc[id] = stamped;
    }
    for (const id of deleted) {
      this._enqueueDelete(entry, domain, `${domain}.${id}`, id, shadowDomain[id]);
    }

    // Cancel pending adds/changes for ids removed within the same window (see
    // the matching reconciliation comment in _enqueueMapDomain).
    const prefix = `${domain}.`;
    for (const fieldPath of Object.keys(entry.updates)) {
      if (!fieldPath.startsWith(prefix)) continue;
      const id = fieldPath.slice(prefix.length);
      if (id in idMap) continue;
      delete entry.updates[fieldPath];
      delete sc[id];
      if (id in shadowDomain) {
        this._enqueueDelete(entry, domain, fieldPath, id, shadowDomain[id]);
      }
    }
  }

  _enqueuePinned(data) {
    const next = Array.isArray(data) ? data : [];
    if (arraysEqualAsSet(this._shadow.pinnedSymptoms || [], next)) return;
    const entry = this._pendingFor(this._defsDocRef());
    entry.updates.pinnedSymptoms = next;
    entry.shadowWhole.pinnedSymptoms = next;
  }

  _enqueueTrackingMode(data, now) {
    const shadow = this._shadow.trackingMode;
    const currentValue = (shadow && typeof shadow === 'object' && 'value' in shadow)
      ? shadow.value
      : shadow;
    if (currentValue === data) return;
    const stamped = { value: data, _t: now };
    const entry = this._pendingFor(this._defsDocRef());
    entry.updates.trackingMode = stamped;
    entry.shadowWhole.trackingMode = stamped;
  }

  _scheduleFlush() {
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, 500);
  }

  /**
   * Cancel the debounce and flush immediately, draining to completion.
   *
   * Durability on unload: a debounced flush() may be mid-await when this is
   * called (e.g. on visibilitychange→hidden / beforeunload). Because flush()
   * no-ops while one is already in flight, simply calling flush() here could
   * resolve instantly while pending edits remain behind a setTimeout that will
   * never fire before the page unloads — a lost edit. Instead we drain: await
   * any in-flight flush, then flush again, until nothing is pending.
   *
   * Bounded: a failed flush now persists the doc to the durable outbox and
   * clears _pending (rather than re-queuing in memory), so this loop terminates
   * naturally; we still cap drain iterations as belt-and-suspenders. The outbox
   * (replayed on reconnect / next boot) is the real safety net for persistent
   * failures.
   */
  async flushNow() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    const MAX_DRAIN = 5;
    let iterations = 0;
    while (this._flushPromise || Object.keys(this._pending).length > 0) {
      if (iterations++ >= MAX_DRAIN) break;
      if (this._flushPromise) {
        await this._flushPromise;
      } else {
        await this.flush();
      }
    }
    // A failed flush re-schedules a debounced retry timer; clear it so flushNow
    // leaves no dangling timer (the outbox owns durable retry).
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
  }

  /**
   * Issue one writeFieldUpdates per pending doc. On success, fold the staged
   * shadow changes into a FRESH shadow object (never mutating the existing
   * shadow maps, which may alias React's hydrated state). On failure, persist
   * the doc's updates/deletes to the durable outbox for a later replay (never
   * kept in memory, to avoid a double write).
   */
  async flush() {
    if (!this._ready) return;
    if (this._flushing) return; // a flush is already in flight.
    const paths = Object.keys(this._pending);
    if (paths.length === 0) return;

    // Track the in-flight flush so flushNow() can await it (unload durability).
    const promise = this._doFlush(paths);
    this._flushPromise = promise;
    try {
      await promise;
    } finally {
      if (this._flushPromise === promise) this._flushPromise = null;
    }
  }

  async _doFlush(paths) {
    this._flushing = true;
    this.syncing = true;
    this._notifyStatus();
    // Snapshot and clear pending so edits during the flush queue separately.
    const pending = this._pending;
    this._pending = {};
    this._inflight = pending;

    try {
      for (const path of paths) {
        const entry = pending[path];
        // _t-guard on deletes: a delete carries the base `_t` of the shadow
        // record at the time the user decided to delete it. If a NEWER remote
        // write of the same key has since advanced the shadow, the user's
        // delete decision is stale — sending deleteField would destroy that
        // newer remote write. Skip such deletes. This resolves the asymmetry
        // where local writes are last-writer-wins (stamped + diffed) but
        // deletes carried no `_t` and so unconditionally clobbered.
        for (const fieldPath of [...entry.deletes]) {
          const { domain, key } = this._domainKeyForDelete(entry, fieldPath);
          if (!domain) continue;
          const baseT = entry.deleteBaseT[fieldPath] || 0;
          if (this._deleteIsStale(domain, key, baseT)) {
            // Newer remote version arrived after the delete decision — skip.
            entry.deletes.delete(fieldPath);
            delete entry.deleteBaseT[fieldPath];
            delete entry.deleteT[fieldPath];
            if (entry.shadowDeletes[domain]) {
              entry.shadowDeletes[domain] = entry.shadowDeletes[domain].filter((k) => k !== key);
            }
          }
        }

        // _t-guard on updates vs TOMBSTONES: if another device's tombstone for
        // this key reached the shadow after the edit was staged and is the same
        // age or newer, the delete wins (last-writer-wins) — writing the edit
        // would resurrect the record. (A write made KNOWING about a tombstone is
        // stamped past it by diffMapDomain, so it never trips this.)
        for (const fieldPath of Object.keys(entry.updates)) {
          const { domain, key } = this._domainKeyForUpdate(fieldPath);
          if (!domain || !MAP_DOMAINS.includes(domain)) continue;
          const current = (this._shadow[domain] || {})[key];
          if (isTombstone(current) && tOf(current) >= tOf(entry.updates[fieldPath])) {
            delete entry.updates[fieldPath];
            if (entry.shadowChanges[domain]) delete entry.shadowChanges[domain][key];
          }
        }

        // Nothing left to write for this doc after the guards? Skip it.
        if (Object.keys(entry.updates).length === 0 && entry.deletes.size === 0) {
          continue;
        }

        const result = await writeFieldUpdates(entry.ref, this._buildWrite(entry));

        if (this._destroyed) return;

        if (result && result.ok) {
          this._applyShadow(entry);
          this.lastSynced = new Date();
        } else {
          // Failure: persist to the DURABLE outbox instead of re-queuing in
          // memory. The outbox survives reload; replayOutbox() retries it on
          // the next flush cycle / boot / reconnect with the same _t-guard.
          // We do NOT also keep it in _pending — that would double-write.
          // We deliberately do NOT set a syncError here: a queued offline write
          // is normal, not a genuine sync failure to surface in the UI.
          this._persistToOutbox(entry);
        }
      }
    } finally {
      this._inflight = null;
      this._flushing = false;
      this.syncing = false;
      this._notifyStatus();
    }

    // If new edits (or re-queues) arrived, schedule another flush.
    if (Object.keys(this._pending).length > 0) {
      this._scheduleFlush();
    }
  }

  // The wire payload for a pending/replayed entry. MAP-domain deletes become
  // TOMBSTONE updates (`{ _deleted: true, _t }`) — absence is never a delete, so
  // other devices need an explicit, timestamped record to act on. Definition
  // (id-map) deletes stay real field deletes: those items are soft-deleted by
  // the app long before they are purged.
  _buildWrite(entry) {
    const updates = { ...entry.updates };
    const deletes = [];
    for (const fieldPath of entry.deletes) {
      const { domain } = this._domainKeyForDelete(entry, fieldPath);
      if (domain && MAP_DOMAINS.includes(domain)) {
        updates[fieldPath] = makeTombstone(this._tombstoneT(entry, fieldPath), domain);
      } else {
        deletes.push(fieldPath);
      }
    }
    return { updates, deletes };
  }

  _tombstoneT(entry, fieldPath) {
    const t = entry.deleteT && entry.deleteT[fieldPath];
    return typeof t === 'number' ? t : this._now();
  }

  // Resolve the (domain, key) a pending delete fieldPath targets, for the
  // _t-guard. Map domains use a dotted `field.key`; the daily-notes domain maps
  // the `notes` field back to the `dailyNotes` shadow domain. Id-map definition
  // domains use `domain.id` directly. Returns { domain: null } if unresolvable.
  _domainKeyForDelete(entry, fieldPath) {
    const dot = fieldPath.indexOf('.');
    if (dot === -1) return { domain: null };
    const field = fieldPath.slice(0, dot);
    const key = fieldPath.slice(dot + 1);
    let domain = null;
    for (const d of MAP_DOMAINS) {
      if (fieldForMapDomain(d) === field) { domain = d; break; }
    }
    if (!domain && ID_MAP_DOMAINS.includes(field)) domain = field;
    return { domain, key };
  }

  /**
   * Shared _t-guard for DELETES, used by both the live flush and outbox replay.
   * A pending/queued delete carries the base `_t` of the shadow record at the
   * time the user decided to delete it. If a NEWER remote write has since
   * advanced the shadow, the delete decision is stale and would destroy that
   * newer data — so it must be skipped. Returns true when the delete is stale.
   */
  _deleteIsStale(domain, key, baseT) {
    const current = (this._shadow[domain] || {})[key];
    return !!(
      current && typeof current === 'object' &&
      typeof current._t === 'number' && current._t > (baseT || 0)
    );
  }

  /**
   * Shared _t-guard for UPDATES on replay. If the engine's current shadow
   * already holds a record for (domain,key) with `_t` >= the queued value's
   * `_t`, the cloud already has same-or-newer data and the queued update must
   * be dropped (it would otherwise resurrect/clobber with stale data). Returns
   * true when the update is stale. Values without a numeric `_t` are never
   * considered stale (we cannot reason about ordering, so we let them through).
   */
  _updateIsStale(domain, key, value) {
    if (!value || typeof value !== 'object' || typeof value._t !== 'number') return false;
    const current = (this._shadow[domain] || {})[key];
    return !!(
      current && typeof current === 'object' &&
      typeof current._t === 'number' && current._t >= value._t
    );
  }

  // Resolve the (domain, key) an update fieldPath targets — same mapping as
  // _domainKeyForDelete (a write and a delete on the same key share a fieldPath
  // shape). Returns { domain: null } when unresolvable.
  _domainKeyForUpdate(fieldPath) {
    return this._domainKeyForDelete(null, fieldPath);
  }

  // Persist a failed flush entry to the durable outbox. Field shape mirrors the
  // live pending entry so replay can re-derive (domain,key) the same way.
  _persistToOutbox(entry) {
    enqueueOp({
      docPath: entry.ref.path,
      updates: entry.updates,
      deletes: [...entry.deletes],
      deleteBaseT: entry.deleteBaseT,
      deleteT: entry.deleteT,
      ts: this._now(),
    });
  }

  // Rebuild a Firestore doc ref from a stored full path. The compat SDK's
  // db.doc(fullPath) accepts even-segment doc paths — month docs
  // (users/uid/months/YYYY-MM = 4 segments) and the definitions doc
  // (users/uid/meta/definitions = 4 segments) both qualify.
  _docRefForPath(path) {
    const db = getFirebaseDb();
    if (!db || typeof db.doc !== 'function') return null;
    return db.doc(path);
  }

  /**
   * Replay durably-queued failed writes (oldest-first). For each op we apply
   * the SAME _t-guards the live flush uses (via _updateIsStale/_deleteIsStale)
   * so a stale op can never clobber newer cloud data. A guarded op that ends up
   * empty is simply removed. A successful write applies the staged shadow
   * changes (reusing _applyShadow) and removes the op; a failed write leaves it
   * for the next attempt. Never throws.
   */
  async replayOutbox() {
    const db = getFirebaseDb();
    if (!db || this._destroyed) return;

    let ops;
    try {
      ops = listOps();
    } catch {
      return; // outbox guards corruption itself, but be doubly safe.
    }

    for (const op of ops) {
      if (this._destroyed) return;

      const ref = this._docRefForPath(op.docPath);
      if (!ref) continue;

      // Re-derive a flush-shaped entry so we can reuse _applyShadow on success.
      const entry = {
        ref,
        updates: {},
        deletes: new Set(),
        deleteBaseT: {},
        deleteT: {},
        shadowChanges: {},
        shadowDeletes: {},
        shadowWhole: {},
      };

      // Guard UPDATES: drop any fieldPath the shadow already has same-or-newer.
      for (const [fieldPath, value] of Object.entries(op.updates || {})) {
        const { domain, key } = this._domainKeyForUpdate(fieldPath);
        if (domain && this._updateIsStale(domain, key, value)) continue;
        entry.updates[fieldPath] = value;
        if (domain) {
          if (key == null) {
            // Whole-field domain (pinnedSymptoms / trackingMode-style); stage
            // as shadowWhole so _applyShadow records it.
            entry.shadowWhole[domain] = value;
          } else {
            const sc = entry.shadowChanges[domain] || (entry.shadowChanges[domain] = {});
            sc[key] = value;
          }
        } else {
          // Unresolved domain (e.g. whole-field paths with no dot). Stage as
          // shadowWhole keyed by the raw field so the cloud write still lands.
          entry.shadowWhole[fieldPath] = value;
        }
      }

      // Guard DELETES: skip any the shadow now has newer than the recorded base.
      for (const fieldPath of op.deletes || []) {
        const { domain, key } = this._domainKeyForDelete(null, fieldPath);
        const baseT = (op.deleteBaseT && op.deleteBaseT[fieldPath]) || 0;
        if (domain && this._deleteIsStale(domain, key, baseT)) continue;
        entry.deletes.add(fieldPath);
        // The tombstone is stamped when the user deleted, not when we replay
        // (ops queued by an older app version carry no deleteT → op.ts).
        const queuedT = op.deleteT && op.deleteT[fieldPath];
        entry.deleteT[fieldPath] = typeof queuedT === 'number'
          ? queuedT
          : (typeof op.ts === 'number' ? op.ts : this._now());
        if (domain) {
          const sd = entry.shadowDeletes[domain] || (entry.shadowDeletes[domain] = []);
          if (!sd.includes(key)) sd.push(key);
        }
      }

      // Nothing left after guarding — the cloud is already current; drop it.
      if (Object.keys(entry.updates).length === 0 && entry.deletes.size === 0) {
        removeOp(op.id);
        continue;
      }

      let result;
      try {
        result = await writeFieldUpdates(ref, this._buildWrite(entry));
      } catch {
        result = { ok: false };
      }

      if (this._destroyed) return;

      if (result && result.ok) {
        this._applyShadow(entry);
        this.lastSynced = new Date();
        removeOp(op.id);
      }
      // On failure: leave the op in the outbox for a later attempt; continue to
      // the next op (the queue is bounded, so this is safe).
    }
  }

  // Fold a successfully-written entry's staged changes into the shadow, using
  // fresh per-domain objects so the existing shadow maps are never mutated.
  _applyShadow(entry) {
    const now = this._now();
    for (const domain of Object.keys(entry.shadowChanges)) {
      const fresh = { ...(this._shadow[domain] || {}) };
      const changes = entry.shadowChanges[domain];
      for (const key of Object.keys(changes)) {
        fresh[key] = changes[key];
        // Mark this record as recently written so a lagging snapshot can't
        // delete it out from under us (see RECENT_WRITE_TTL_MS).
        this._recentWrites.set(`${domain} ${key}`, now);
      }
      this._shadow[domain] = fresh;
    }
    for (const domain of Object.keys(entry.shadowDeletes)) {
      const fresh = { ...(this._shadow[domain] || {}) };
      for (const key of entry.shadowDeletes[domain]) {
        if (MAP_DOMAINS.includes(domain)) {
          // Written as a tombstone — the shadow mirrors exactly that.
          const fieldPath = `${fieldForMapDomain(domain)}.${key}`;
          fresh[key] = makeTombstone(this._tombstoneT(entry, fieldPath), domain);
        } else {
          delete fresh[key];
        }
        // A deliberate local delete: clear any recent-write protection so the
        // delete is honored (and a re-add later re-marks it).
        this._recentWrites.delete(`${domain} ${key}`);
      }
      this._shadow[domain] = fresh;
    }
    for (const domain of Object.keys(entry.shadowWhole)) {
      this._shadow[domain] = entry.shadowWhole[domain];
    }
  }

  /**
   * Was (domain, key) written locally within RECENT_WRITE_TTL_MS? Such a key is
   * protected from remote-delete detection because a snapshot/read may lag our
   * own just-written record. Prunes the expired entry on access.
   */
  _recentlyWrote(domain, key, now) {
    const id = `${domain} ${key}`;
    const ts = this._recentWrites.get(id);
    if (ts == null) return false;
    if (now - ts >= RECENT_WRITE_TTL_MS) {
      this._recentWrites.delete(id);
      return false;
    }
    return true;
  }

  /**
   * Read the cloud once: the definitions doc + every month doc.
   *
   * Returns { definitionsData, monthDocs } on success. monthDocs is an array of
   * { id, data }. Forces source:'server' to avoid hydrating a partial local
   * cache. Shared by initialize() and forcePull(). Throws on read failure (the
   * caller decides how to surface it).
   */
  async _readCloud() {
    const db = getFirebaseDb();
    const userDoc = db.collection('users').doc(this.uid);
    const defRef = userDoc.collection('meta').doc('definitions');
    const monthsRef = userDoc.collection('months');

    const [defSnap, monthsSnap] = await Promise.all([
      defRef.get({ source: 'server' }),
      monthsRef.get({ source: 'server' }),
    ]);

    const monthDocs = monthsSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
    const definitionsData = defSnap.exists ? defSnap.data() : null;
    return { definitionsData, monthDocs };
  }

  /**
   * Whether readLocalDomains() returned ANY real data (so a migration would
   * actually carry something). Mirrors hasAnyData's "non-empty map / non-empty
   * array / present scalar" rule against the flat local-domains shape.
   */
  _localHasData() {
    let local;
    try {
      local = readLocalDomains();
    } catch {
      return false;
    }
    return hasAnyData(local);
  }

  /**
   * Run the one-time migration if it hasn't completed AND there is local data
   * to migrate. Idempotent across boots: once runMigration writes the
   * `_migration` flag, a later boot reads v2DoneAt and needsMigration() returns
   * false, so this no-ops (migration runs EXACTLY ONCE). Migration failure is
   * NON-FATAL: it is caught here, surfaced via syncError, and boot continues.
   */
  async _maybeRunMigration(db) {
    let migrationData = null;
    try {
      const snap = await db
        .collection('users').doc(this.uid)
        .collection('meta').doc('_migration')
        .get({ source: 'server' });
      migrationData = snap && snap.exists ? snap.data() : null;
    } catch (err) {
      // Could not read the flag — assume done rather than risk a re-migration.
      this.syncError = err && err.message ? err.message : String(err);
      return;
    }

    if (!needsMigration(migrationData)) return;
    if (!this._localHasData()) return; // nothing to migrate.

    try {
      await runMigration({ db, uid: this.uid, now: this._now() });
    } catch (err) {
      // Non-fatal: log via syncError and continue booting. The flag stays unset
      // so a future boot retries.
      this.syncError = err && err.message ? err.message : String(err);
    }
  }

  /**
   * READ-ONLY legacy fallback. Read the OLD blob doc `users/{uid}`, decode each
   * stringified domain field, and build BOTH app-shape `domains` and the
   * diff-shape `shadow` directly. Bare legacy note strings are WRAPPED to
   * `{ text }` so the engine's shadow/diff sees note objects consistently with
   * the v2 model (matching migrationV2.stampMapValue, minus the `_t`).
   *
   * NEVER writes or deletes the blob. Returns { domains, shadow } or null when
   * the blob does not exist / read fails.
   */
  async _readLegacyBlob(db) {
    let snap;
    try {
      snap = await db.collection('users').doc(this.uid).get({ source: 'server' });
    } catch {
      return null;
    }
    if (!snap || !snap.exists) return null;
    const data = snap.data() || {};

    // Decode each stringified field (JSON.parse with a guard); else use as-is.
    const decoded = {};
    for (const domain of LEGACY_STRINGIFIED_DOMAINS) {
      const raw = data[domain];
      if (typeof raw === 'string') {
        try { decoded[domain] = JSON.parse(raw); } catch { /* skip corrupt */ }
      } else if (raw != null) {
        decoded[domain] = raw;
      }
    }

    // dailyNotes: wrap bare string values to { text } for shadow/diff parity.
    const dailyNotes = {};
    const rawNotes = (decoded.dailyNotes && typeof decoded.dailyNotes === 'object')
      ? decoded.dailyNotes : {};
    for (const key of Object.keys(rawNotes)) {
      const v = rawNotes[key];
      dailyNotes[key] = (v && typeof v === 'object') ? v : { text: v };
    }

    const entries = (decoded.entries && typeof decoded.entries === 'object') ? decoded.entries : {};
    const stackEntries = (decoded.stackEntries && typeof decoded.stackEntries === 'object') ? decoded.stackEntries : {};
    const inputEntries = (decoded.inputEntries && typeof decoded.inputEntries === 'object') ? decoded.inputEntries : {};
    const symptoms = Array.isArray(decoded.symptoms) ? decoded.symptoms : [];
    const stackItems = Array.isArray(decoded.stackItems) ? decoded.stackItems : [];
    const inputItems = Array.isArray(decoded.inputItems) ? decoded.inputItems : [];
    const pinnedSymptoms = Array.isArray(decoded.pinnedSymptoms) ? decoded.pinnedSymptoms : [];

    // App shape (arrays for definition domains, flat maps for map domains).
    const domains = {
      entries, dailyNotes, stackEntries, inputEntries,
      symptoms, stackItems, inputItems, pinnedSymptoms,
    };
    // Diff shape (definitions → id-maps; map domains → the same flat maps).
    const shadow = {
      entries, dailyNotes, stackEntries, inputEntries,
      symptoms: arrayToIdMap(symptoms),
      stackItems: arrayToIdMap(stackItems),
      inputItems: arrayToIdMap(inputItems),
      pinnedSymptoms,
    };

    // trackingMode: PLAIN string on the blob. Present app-side; mirror in shadow.
    if (typeof data.trackingMode === 'string') {
      domains.trackingMode = data.trackingMode;
      shadow.trackingMode = data.trackingMode;
    }

    return { domains, shadow };
  }

  /**
   * Boot sequence:
   *   1. No db → ready, return null.
   *   2. One-time migration (localStorage → new model) if needed + local data.
   *   3. Read the cloud (definitions + months); assemble app-shape domains.
   *   4. Legacy fallback: if the assembled cloud is empty AND a legacy blob
   *      exists with data, use the blob's domains/shadow for the emit (READ-ONLY).
   *   5. Emit initial cloud update if there's data; seed shadow + raw caches.
   *   6. Start the realtime listener; replay the durable outbox.
   *
   * Returns { domains, shadow } on a successful read, or null when there is no
   * db or the cloud read fails. Never throws — read errors are captured in
   * this.syncError and the engine is still marked ready.
   */
  async initialize() {
    const db = getFirebaseDb();
    if (!db) {
      this._ready = true;
      this._drainEarly();
      return null;
    }

    // One-time migration BEFORE reading the cloud, so the subsequent _readCloud
    // sees freshly-migrated months/definitions. Non-fatal on failure.
    await this._maybeRunMigration(db);
    if (this._destroyed) return null;

    try {
      const { definitionsData, monthDocs } = await this._readCloud();

      // If destroy() was called mid-flight, do not mutate our own state or
      // emit — a destroyed engine must be fully inert.
      if (this._destroyed) return null;

      // Seed the raw caches so the first listener diff has a baseline. For the
      // legacy-fallback case these reflect the (empty) cloud, which is correct:
      // the listener will pick up real months once a device finishes migrating.
      this._rawMonths = monthDocs;
      this._rawDefs = definitionsData;

      const assembled = assembleDomainsFromDocs(definitionsData, monthDocs);
      let { domains } = assembled;
      const { shadow } = assembled;

      // Legacy fallback: the cloud (months + definitions) is empty. Try the OLD
      // blob doc as a READ-ONLY source so an un-migrated device still sees data.
      //
      // CRITICAL: we override only `domains` (what React displays), NOT `shadow`.
      // The shadow must stay consistent with the ACTUAL new cloud (empty), which
      // is what `_rawMonths`/`_rawDefs` reflect. Real Firestore fires the months
      // onSnapshot immediately on subscribe with the current (empty) snapshot;
      // _onCloudChanged then re-assembles an empty newShadow and compares it to
      // `_shadow`. If `_shadow` held the blob data, that diff would compute every
      // blob key as a REMOTE delete and instruct React to wipe the just-displayed
      // blob data (and localStorage). Keeping `_shadow` empty makes that first
      // tick an echo (empty == empty) → suppressed → no spurious deletes. The
      // blob is still emitted ONCE below for display.
      if (!hasAnyData(domains)) {
        const legacy = await this._readLegacyBlob(db);
        if (this._destroyed) return null;
        if (legacy && hasAnyData(legacy.domains)) {
          domains = legacy.domains;
          // shadow intentionally left as the empty assembled-cloud shadow.
        }
      }

      this._shadow = shadow;
      this._restoreMode = isRestorePending();

      // Initial hydrate counts as cloud activity (seeds the heartbeat clock).
      this._touchActivity();

      // Ready BEFORE the emit so edits made while we were booting are staged
      // first: a fresh local write must shield its key from an older tombstone
      // in the initial emit (see _mergeCloudView).
      this._ready = true;
      this._drainEarly();

      // Every tombstone is news to a freshly-booted device: they remove the
      // stale copies this device still holds in localStorage. (Emit for them
      // even when the cloud holds no live data at all.)
      const { tombstones } = this._mergeCloudView(assembled, {});
      const hasTombstones = Object.keys(tombstones).length > 0;
      if ((hasAnyData(domains) || hasTombstones) && !this._destroyed) {
        this.onCloudUpdate(domains, true, { tombstones });
      }

      // Begin watching for cloud changes (guarded inside).
      this._startListening();

      // Replay any durably-queued writes from a previous offline session. Run
      // AFTER hydrate so the _t-guard sees current cloud state; never throws.
      this.replayOutbox();

      return { domains, shadow };
    } catch (err) {
      this.syncError = err.message;
      this._ready = true;
      this._drainEarly();
      return null;
    }
  }

  // Diff the views notified before the engine was ready, now that the shadow is
  // real (see _early).
  _drainEarly() {
    const early = this._early;
    this._early = {};
    for (const domain of Object.keys(early)) {
      this.notifyLocalChange(domain, early[domain]);
    }
  }

  // Seed the last-known local view of each map domain from localStorage (which
  // is what React state starts from). Guarded: never throws.
  _seedLocalView() {
    let local = {};
    try {
      local = readLocalDomains() || {};
    } catch {
      local = {};
    }
    for (const domain of MAP_DOMAINS) {
      const map = local[domain];
      this._localView[domain] = (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    }
  }

  // The newest `_t` of any local write of (domain, key) that has not been
  // confirmed yet: staged, in flight, or parked in the durable outbox.
  _unconfirmedWriteT(domain, key, outboxOps) {
    const fieldPath = `${fieldForMapDomain(domain)}.${key}`;
    let newest = 0;
    for (const pending of [this._pending, this._inflight || {}]) {
      for (const path of Object.keys(pending)) {
        const value = pending[path].updates[fieldPath];
        if (value !== undefined) newest = Math.max(newest, tOf(value));
      }
    }
    for (const op of outboxOps) {
      const value = op.updates && op.updates[fieldPath];
      if (value !== undefined) newest = Math.max(newest, tOf(value));
    }
    return newest;
  }

  // The durable outbox, tolerating any storage failure.
  _outboxOps() {
    try {
      return listOps() || [];
    } catch {
      return [];
    }
  }

  /**
   * Reconcile a freshly assembled cloud view with what this engine already
   * knows, for keys where a TOMBSTONE is involved on either side, and work out
   * which tombstones are NEWS for the hook. Everything else passes through
   * untouched (live-vs-live stays the hook's union merge by `_t`).
   *
   * Per key, last-writer-wins by `_t` between the old shadow and the view (a
   * tombstone wins a tie), because the view can LAG our own writes:
   *   - we hold a tombstone and the view still shows the older live record (or
   *     nothing) → keep the tombstone, and keep that record out of the emit so
   *     it cannot reappear on the device that just cleared it;
   *   - we hold a live record NEWER than the view's tombstone (we re-rated after
   *     it) → keep our record; the tombstone is not emitted.
   *
   * A tombstone is emitted only when it is news (the shadow does not already
   * hold one at least as new) — re-emitting a known tombstone would remove a
   * re-rating the app has not stamped yet. It is also withheld while a NEWER
   * local write of that key is still unconfirmed, and — on the boot after a
   * snapshot restore — for every key the restored local data holds.
   *
   * @returns {{ domains, shadow, tombstones: Object<string, Object<string, number>> }}
   */
  _mergeCloudView(assembled, oldShadow = this._shadow) {
    const old = oldShadow || {};
    const domains = { ...assembled.domains };
    const shadow = { ...assembled.shadow };
    const tombstones = {};
    let outboxOps = null; // read at most once, and only if a tombstone is news

    for (const domain of MAP_DOMAINS) {
      const oldMap = old[domain] || {};
      const incoming = assembled.shadow[domain] || {};
      let merged = incoming;
      let live = assembled.domains[domain] || {};
      const keep = (key, record) => {
        if (merged === incoming) {
          merged = { ...incoming };
          live = { ...live };
        }
        merged[key] = record;
        delete live[key];
      };

      for (const key of Object.keys(oldMap)) {
        const was = oldMap[key];
        const inc = incoming[key];
        if (isTombstone(was)) {
          const viewIsNewer = inc !== undefined &&
            (isTombstone(inc) ? tOf(inc) >= tOf(was) : tOf(inc) > tOf(was));
          if (!viewIsNewer) keep(key, was);
        } else if (isTombstone(inc) && tOf(was) > tOf(inc)) {
          keep(key, was);
        }
      }

      const news = {};
      const localView = this._localView[domain] || {};
      for (const key of Object.keys(merged)) {
        const rec = merged[key];
        if (!isTombstone(rec)) continue;
        const was = oldMap[key];
        if (isTombstone(was) && tOf(was) >= tOf(rec)) continue; // not news
        if (this._restoreMode && key in localView) continue;
        if (!outboxOps) outboxOps = this._outboxOps();
        if (this._unconfirmedWriteT(domain, key, outboxOps) > tOf(rec)) continue;
        news[key] = tOf(rec);
      }
      if (Object.keys(news).length > 0) {
        tombstones[domain] = news;
        // The hook removes these locally; forget them so a later re-rating —
        // even to the same value — reads as a fresh write.
        const view = { ...localView };
        for (const key of Object.keys(news)) delete view[key];
        this._localView[domain] = view;
      }

      domains[domain] = live;
      shadow[domain] = merged;
    }

    return { domains, shadow, tombstones };
  }

  /**
   * "Sync Now" — push any genuinely-unsynced local records to the cloud.
   *
   * Snapshots local state first (recovery point), then runs the normal
   * shadow-diffing write path for every domain and drains it. Because
   * notifyLocalChange diffs against the shadow, only records that differ from
   * the last-synced view are written — no blob, no clobber. Returns void.
   *
   * @param {Object} allData full app-shape values keyed by domain.
   */
  async forcePush(allData) {
    saveSnapshot('preForcePush');
    if (!allData || typeof allData !== 'object') return;
    this.syncing = true;
    this._notifyStatus();
    try {
      for (const domain of Object.keys(allData)) {
        this.notifyLocalChange(domain, allData[domain]);
      }
      await this.flushNow();
    } finally {
      this.syncing = false;
      this._notifyStatus();
    }
  }

  /**
   * "Pull from cloud" — re-read the full cloud state and apply it to React.
   *
   * Snapshots local state first. Re-reads the cloud (same read as initialize),
   * assembles the app-shape domains, and emits them:
   *   - destructive: emit with { replace: true } — the hook REPLACES React
   *     state per domain (cloud is authoritative).
   *   - merge (default): emit with { deletes: {} } — the hook merges by `_t`.
   * Advances the shadow to the freshly-read cloud either way.
   *
   * @param {{destructive?: boolean}} opts
   * @returns {{summary: Object, snapshotId: string|null, destructive: boolean}}
   */
  async forcePull({ destructive = false } = {}) {
    const snapshotId = saveSnapshot(destructive ? 'preForcePullReplace' : 'preForcePullMerge');

    this.syncing = true;
    this._notifyStatus();
    try {
      const { definitionsData, monthDocs } = await this._readCloud();
      if (this._destroyed) return { summary: {}, snapshotId, destructive };

      // Refresh raw caches + shadow so the listener diffs against current cloud.
      this._rawMonths = monthDocs;
      this._rawDefs = definitionsData;
      const assembled = assembleDomainsFromDocs(definitionsData, monthDocs);
      // Replace: the cloud as read IS the truth. Merge: keep what we know about
      // tombstones (see _mergeCloudView).
      const { domains, shadow, tombstones } = destructive
        ? { ...assembled, tombstones: {} }
        : this._mergeCloudView(assembled);
      this._shadow = shadow;
      if (destructive) {
        for (const domain of MAP_DOMAINS) this._localView[domain] = domains[domain] || {};
      }

      // Per-domain counts for the Settings toast (array length / key count /
      // scalar present = 1).
      const summary = {};
      for (const domain of Object.keys(domains)) {
        const value = domains[domain];
        if (Array.isArray(value)) summary[domain] = value.length;
        else if (value && typeof value === 'object') summary[domain] = Object.keys(value).length;
        else summary[domain] = value != null ? 1 : 0;
      }

      if (destructive) {
        this.onCloudUpdate(domains, false, { replace: true });
      } else {
        this.onCloudUpdate(domains, false, this._emitOpts(tombstones));
      }
      this.lastSynced = new Date();

      return { summary, snapshotId, destructive };
    } finally {
      this.syncing = false;
      this._notifyStatus();
    }
  }

  /**
   * Reconcile local data against the REAL cloud (never the optimistic shadow)
   * and heal drift in BOTH directions, additively. Run on load / on return to
   * foreground so a device that has silently diverged converges on its own,
   * instead of waiting for the user to notice and hand-import a backup.
   *
   *   - PULL: emit the freshly-read cloud for a UNION merge into local, so any
   *     record this device is missing (e.g. its streaming listener died and
   *     never caught up) flows in.
   *   - PUSH: for every record domain, diff the UNION of (local ∪ cloud)
   *     against the just-read cloud and write up only what the cloud is
   *     genuinely MISSING — the exact records a silently-failed upload left
   *     local-only, which the shadow still believes are synced.
   *
   * ADDITIVE ONLY — it never deletes from the cloud. The value handed to the
   * write path is the union of local and cloud, i.e. a SUPERSET of the cloud,
   * so the diff can never see a cloud key absent from the data and therefore
   * can never enqueue a delete. A device whose local data is a subset of the
   * cloud writes nothing and simply pulls the cloud's extra records down. This
   * is what makes the data-loss guard hold for behind devices.
   *
   * DELETES made on another device are tombstones in the cloud, so they are not
   * resurrected here: a local record on a tombstoned key is pushed only if its
   * own `_t` beats the tombstone. (The one exception is a record whose tombstone
   * has already been pruned — TOMBSTONE_TTL_MS — which reads as "cloud is
   * missing it" and is re-added.) Afterwards, expired tombstones are pruned.
   * Guarded against no-db / destroyed; NEVER throws.
   *
   * @param {Object} allData full app-shape values keyed by domain.
   */
  async reconcile(allData) {
    const db = getFirebaseDb();
    if (!db || this._destroyed) return;
    if (!allData || typeof allData !== 'object') return;

    saveSnapshot('preReconcile');
    this.syncing = true;
    this._notifyStatus();
    try {
      const { definitionsData, monthDocs } = await this._readCloud();
      if (this._destroyed) return;

      // Refresh raw caches + advance the shadow to the REAL cloud, so the write
      // diff below measures local against cloud truth, not the optimistic
      // shadow (whose belief that a dropped write succeeded is the root bug).
      this._rawMonths = monthDocs;
      this._rawDefs = definitionsData;
      const { domains: cloudDomains, shadow, tombstones } = this._mergeCloudView(
        assembleDomainsFromDocs(definitionsData, monthDocs),
      );
      this._shadow = shadow;

      // PULL: union the cloud into local. Nothing is deleted by ABSENCE (see
      // _applyAssembledCloud); explicit tombstones that are news are applied.
      this.onCloudUpdate(cloudDomains, false, this._emitOpts(tombstones));

      // PUSH: enqueue only records the cloud is missing. Passing the UNION of
      // local+cloud guarantees the data is a superset of the shadow, so the
      // diff yields additions only — never a delete.
      // `reconcile: true`: allData comes from localStorage, which may still hold
      // records the hook has just removed for a tombstone — a local record on a
      // tombstoned key is pushed only if its own `_t` beats the tombstone.
      for (const domain of MAP_DOMAINS) {
        const union = mergeMapByTime(cloudDomains[domain] || {}, allData[domain] || {});
        this.notifyLocalChange(domain, union, { reconcile: true });
      }
      for (const domain of ID_MAP_DOMAINS) {
        const localArr = Array.isArray(allData[domain]) ? allData[domain] : [];
        const cloudArr = Array.isArray(cloudDomains[domain]) ? cloudDomains[domain] : [];
        const union = mergeIdArrayByTime(localArr, cloudArr);
        this.notifyLocalChange(domain, union);
      }

      await this.flushNow();
      if (this._restoreMode) {
        this._restoreMode = false;
        clearRestorePending();
      }
      await this._pruneTombstones();
      this.lastSynced = new Date();
    } catch (err) {
      this.syncError = err && err.message ? err.message : String(err);
      this._notifyStatus();
    } finally {
      this.syncing = false;
      this._notifyStatus();
    }
  }

  /**
   * Subscribe to the months collection and the definitions doc. On each
   * snapshot we re-assemble the full cloud state and diff it against our
   * shadow; only cloud-side changes are emitted to React. Idempotent-ish:
   * guarded against missing db / destroyed engine.
   */
  _startListening() {
    if (this._destroyed) return;
    // Idempotent: if we already hold listeners, do not double-subscribe — a
    // second pass (retry / future hook wiring) would leak the first ones.
    if (this._unsubMonths || this._unsubDefs) return;
    const db = getFirebaseDb();
    if (!db) return;

    const userDoc = db.collection('users').doc(this.uid);
    const monthsRef = userDoc.collection('months');
    const defRef = userDoc.collection('meta').doc('definitions');

    // Defensive: only subscribe when the ref actually exposes onSnapshot.
    if (typeof monthsRef.onSnapshot === 'function') {
      this._unsubMonths = monthsRef.onSnapshot(
        (snap) => this._onCloudChanged('months', snap),
        (err) => this._onListenError(err),
      );
    }
    if (typeof defRef.onSnapshot === 'function') {
      this._unsubDefs = defRef.onSnapshot(
        (snap) => this._onCloudChanged('defs', snap),
        (err) => this._onListenError(err),
      );
    }

    // Start liveness recovery (heartbeat detects a stalled listener; poll
    // covers a listener that never delivers). Seeds activity to "now".
    this._startResilienceTimers();
  }

  _onListenError(err) {
    // Capture and never throw — a listener error must not crash the app.
    this.syncError = err && err.message ? err.message : String(err);
    this._notifyStatus();
  }

  /**
   * Handle a snapshot from either source. Refresh the relevant raw cache,
   * re-assemble the FULL cloud state, suppress echoes (no-op when the new
   * cloud equals our shadow), then emit only the cloud-side changes plus a
   * per-domain list of REMOTE deletes (keys/ids that left the cloud).
   */
  _onCloudChanged(source, snap) {
    if (this._destroyed) return;

    // A snapshot arrived → the listener is attached. Touch liveness so the
    // heartbeat doesn't false-trigger, even for a cache snapshot.
    this._touchActivity();

    // ONLY authoritative server snapshots may update the cloud view and drive
    // remote-delete detection. Firestore also fires:
    //   • fromCache snapshots — the local cache, which can be STALE (offline /
    //     connectivity blip, or behind a REST-fallback write that bypassed the
    //     SDK cache);
    //   • hasPendingWrites snapshots — our own un-acked optimistic writes.
    // Treating either as authoritative would let a view that momentarily lags
    // our just-written records compute (shadow − staleCloud) deletes and erase
    // freshly entered data — the exact rapid-entry data-loss bug. Skip them;
    // the confirmed server snapshot (or refreshFromCloud) reconciles shortly.
    const md = snap && snap.metadata;
    if (md && (md.fromCache === true || md.hasPendingWrites === true)) return;

    // A real (server-confirmed) snapshot arrived: the streaming listener is
    // alive and delivering authoritative data.
    this._listenerDelivered = true;

    // 1. Update the relevant raw cache.
    if (source === 'months') {
      this._rawMonths = (snap.docs || []).map((d) => ({ id: d.id, data: d.data() }));
    } else {
      this._rawDefs = snap && snap.exists ? snap.data() : null;
    }

    // 2. Apply the re-assembled full cloud state (echo-suppress → diff → emit
    //    → advance shadow) from the current raw caches.
    this._applyAssembledCloud();
  }

  /**
   * Assemble the full cloud state from the CURRENT `_rawDefs`/`_rawMonths`,
   * suppress echoes (no-op when the new cloud equals our shadow), and emit the
   * cloud-side data for the hook to UNION-merge by `_t`. Shared by the listener
   * and refreshFromCloud() so both paths emit identically and stay
   * echo-suppressed.
   *
   * UNION-ONLY — IMPORTANT: this path NEVER emits deletes. A key's ABSENCE from
   * a cloud snapshot/read is NOT treated as a remote delete, because the cloud
   * view can legitimately lag our own writes: REST-fallback writes (used when
   * the SDK channel stalls on Safari) bypass the SDK listener's cache, and a
   * stalled streaming channel can deliver a view well behind reality. Deriving
   * "deleted" from "absent" erased records the user had just entered (the
   * rapid-entry data-loss bug). The hook merges by `_t` and PRESERVES any key
   * the snapshot is missing, so a stale/lagging view can never destroy data.
   *
   * Deletes propagate EXPLICITLY instead: a local delete of a map-domain key is
   * written as a tombstone (`{ _deleted: true, _t }`, see tombstones.js), and
   * tombstones in the cloud view are handed to the hook WITH their `_t`, which
   * removes the local record only if the tombstone is at least as new (so an
   * Undo or a re-rating wins). See _mergeCloudView for how a tombstone is
   * reconciled with a view that lags our own writes.
   */
  _applyAssembledCloud() {
    // Re-assemble the full cloud state.
    const { domains, shadow: newShadow, tombstones } = this._mergeCloudView(
      assembleDomainsFromDocs(this._rawDefs, this._rawMonths),
    );

    // Echo suppression: identical to our shadow → do nothing.
    if (this._shadowsEqual(this._shadow, newShadow)) return;

    // Emit cloud data for a UNION merge in the hook. Nothing is deleted by
    // absence (see above); only explicit tombstones that are news are applied.
    this.onCloudUpdate(domains, false, this._emitOpts(tombstones));

    // Advance the shadow to the cloud view and stamp time. If this view lagged
    // and dropped LIVE keys we still hold locally, the next local edit re-pushes
    // them (diff vs shadow), and the next complete snapshot re-adds them — both
    // self-healing and non-destructive. Tombstones we know about are carried
    // over by _mergeCloudView, so a lagging view never re-pushes a deleted key.
    this._shadow = newShadow;
    this.lastSynced = new Date();
  }

  // Emit opts for a union merge: never any absence-derived deletes; explicit
  // tombstones as `{ domain: { key: _t } }` (only the ones that are news).
  _emitOpts(tombstones) {
    return { deletes: {}, tombstones: tombstones || {} };
  }

  /**
   * Truly delete tombstones older than TOMBSTONE_TTL_MS so month docs do not
   * grow forever. Runs after reconcile (the shadow was just read from the
   * server). A failed write changes nothing and is retried next time. Trade-off:
   * a device offline for longer than the TTL that still holds the record will
   * re-add it. NEVER throws.
   */
  async _pruneTombstones() {
    const cutoff = this._now() - TOMBSTONE_TTL_MS;
    const byMonth = {}; // monthId → [{ domain, key }]
    for (const domain of MAP_DOMAINS) {
      const map = this._shadow[domain] || {};
      const expired = Object.keys(map).filter((k) => isTombstone(map[k]) && tOf(map[k]) < cutoff);
      const grouped = groupKeysByMonth(expired);
      for (const monthId of Object.keys(grouped)) {
        const list = byMonth[monthId] || (byMonth[monthId] = []);
        for (const key of grouped[monthId]) list.push({ domain, key });
      }
    }

    for (const monthId of Object.keys(byMonth)) {
      if (this._destroyed) return;
      const targets = byMonth[monthId];
      let result;
      try {
        result = await writeFieldUpdates(this._monthDocRef(monthId), {
          updates: {},
          deletes: targets.map(({ domain, key }) => `${fieldForMapDomain(domain)}.${key}`),
        });
      } catch {
        result = { ok: false };
      }
      if (this._destroyed || !result || !result.ok) continue;
      for (const { domain, key } of targets) {
        // Only if still the expired tombstone (a snapshot may have moved on).
        const current = (this._shadow[domain] || {})[key];
        if (!isTombstone(current) || tOf(current) >= cutoff) continue;
        const fresh = { ...this._shadow[domain] };
        delete fresh[key];
        this._shadow[domain] = fresh;
      }
    }
  }

  // Record a sign of cloud life (snapshot / hydrate / successful refresh). The
  // heartbeat compares _now() against this to detect a stalled listener.
  _touchActivity() {
    this._lastActivity = this._now();
  }

  /**
   * Re-read the full cloud once and apply it via the shared listener path.
   *
   * The catch-up re-fetch used by the heartbeat, the poll fallback, and the
   * hook's visibility handler when the streaming listener may have died or
   * never delivered. Reuses _applyAssembledCloud() so the emit + echo
   * suppression are identical to the live listener. Guarded against no-db /
   * destroyed; NEVER throws — a read error is captured in syncError.
   */
  async refreshFromCloud() {
    const db = getFirebaseDb();
    if (!db || this._destroyed) return;
    try {
      const { definitionsData, monthDocs } = await this._readCloud();
      if (this._destroyed) return;
      this._rawMonths = monthDocs;
      this._rawDefs = definitionsData;
      this._applyAssembledCloud();
      this._touchActivity();
    } catch (err) {
      this.syncError = err && err.message ? err.message : String(err);
      this._notifyStatus();
    }
  }

  // Start the heartbeat + poll timers once the listener is subscribed. Seeds
  // _lastActivity so the heartbeat does not fire immediately on a fresh start.
  _startResilienceTimers() {
    this._touchActivity();
    if (!this._heartbeatTimer) {
      this._heartbeatTimer = setInterval(
        () => this._checkHeartbeat(),
        HEARTBEAT_INTERVAL_MS,
      );
    }
    if (!this._pollTimer) {
      this._pollTimer = setInterval(() => this._pollTick(), POLL_INTERVAL_MS);
    }
  }

  // Heartbeat tick: if the listener has been silent past the dead threshold,
  // force a catch-up re-fetch (fire-and-forget; it refreshes activity on
  // success). A method so tests can invoke it deterministically.
  _checkHeartbeat() {
    if (this._destroyed) return;
    if (this._now() - this._lastActivity >= HEARTBEAT_DEAD_MS) {
      this.refreshFromCloud();
    }
  }

  // Poll tick: while the streaming listener has never delivered (channel
  // blocked), re-fetch the cloud directly. Once a snapshot has arrived this
  // no-ops. A method so tests can invoke it deterministically.
  _pollTick() {
    if (this._destroyed) return;
    if (!this._listenerDelivered) {
      this.refreshFromCloud();
    }
  }

  /**
   * Deep-equal two shadow objects, ignoring `_t`. Map + id-map domains compare
   * by key set and per-key equalIgnoringT; pinnedSymptoms by array equality;
   * trackingMode by equalIgnoringT (objects) or scalar equality. Private.
   */
  _shadowsEqual(a, b) {
    a = a || {};
    b = b || {};

    for (const domain of [...MAP_DOMAINS, ...ID_MAP_DOMAINS]) {
      if (!mapsEqual(a[domain] || {}, b[domain] || {})) return false;
    }

    // pinnedSymptoms: plain array, order-sensitive.
    const pa = a.pinnedSymptoms || [];
    const pb = b.pinnedSymptoms || [];
    if (pa.length !== pb.length) return false;
    for (let i = 0; i < pa.length; i++) {
      if (pa[i] !== pb[i]) return false;
    }

    // trackingMode: may be absent, a scalar, or a { value, _t } object.
    const ta = a.trackingMode;
    const tb = b.trackingMode;
    if (ta == null && tb == null) {
      // both absent — equal
    } else if (ta == null || tb == null) {
      return false;
    } else if (typeof ta === 'object' && typeof tb === 'object') {
      if (!equalIgnoringT(ta, tb)) return false;
    } else if (ta !== tb) {
      return false;
    }

    return true;
  }

  isReady() {
    return this._ready;
  }

  destroy() {
    this._destroyed = true;
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._unsubMonths) {
      this._unsubMonths();
      this._unsubMonths = null;
    }
    if (this._unsubDefs) {
      this._unsubDefs();
      this._unsubDefs = null;
    }
  }
}
