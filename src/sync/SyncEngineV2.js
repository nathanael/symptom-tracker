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
import { equalIgnoringT } from './changeDiff';
import { MAP_DOMAINS } from './domains';

// Definition domains stored as id-keyed maps in the shadow (so remote deletes
// of individual records can be detected the same way map domains are).
const ID_MAP_DOMAINS = ['symptoms', 'stackItems', 'inputItems'];

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

    // Parity with the old engine; status notification is optional here.
    this.lastSynced = null;
    this.syncError = null;
    this.onStatusChange = null;
  }

  /**
   * Read the cloud once and push the assembled domains to React.
   *
   * Returns { domains, shadow } on a successful read, or null when there is no
   * db or the read fails. Never throws — read errors are captured in
   * this.syncError and the engine is still marked ready.
   */
  async initialize() {
    const db = getFirebaseDb();
    if (!db) {
      this._ready = true;
      return null;
    }

    try {
      const userDoc = db.collection('users').doc(this.uid);
      const defRef = userDoc.collection('meta').doc('definitions');
      const monthsRef = userDoc.collection('months');

      const [defSnap, monthsSnap] = await Promise.all([
        defRef.get({ source: 'server' }),
        monthsRef.get({ source: 'server' }),
      ]);

      // If destroy() was called mid-flight, do not mutate our own state or
      // emit — a destroyed engine must be fully inert.
      if (this._destroyed) return null;

      const monthDocs = monthsSnap.docs.map((d) => ({ id: d.id, data: d.data() }));
      const definitionsData = defSnap.exists ? defSnap.data() : null;

      // Seed the raw caches so the first listener diff has a baseline.
      this._rawMonths = monthDocs;
      this._rawDefs = definitionsData;

      const { domains, shadow } = assembleDomainsFromDocs(definitionsData, monthDocs);
      this._shadow = shadow;

      if (hasAnyData(domains) && !this._destroyed) {
        this.onCloudUpdate(domains, true);
      }

      this._ready = true;

      // Begin watching for cloud changes (guarded inside).
      this._startListening();

      return { domains, shadow };
    } catch (err) {
      this.syncError = err.message;
      this._ready = true;
      return null;
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
  }

  _onListenError(err) {
    // Capture and never throw — a listener error must not crash the app.
    this.syncError = err && err.message ? err.message : String(err);
  }

  /**
   * Handle a snapshot from either source. Refresh the relevant raw cache,
   * re-assemble the FULL cloud state, suppress echoes (no-op when the new
   * cloud equals our shadow), then emit only the cloud-side changes plus a
   * per-domain list of REMOTE deletes (keys/ids that left the cloud).
   */
  _onCloudChanged(source, snap) {
    if (this._destroyed) return;

    // 1. Update the relevant raw cache.
    if (source === 'months') {
      this._rawMonths = (snap.docs || []).map((d) => ({ id: d.id, data: d.data() }));
    } else {
      this._rawDefs = snap && snap.exists ? snap.data() : null;
    }

    // 2. Re-assemble the full cloud state.
    const { domains, shadow: newShadow } = assembleDomainsFromDocs(
      this._rawDefs,
      this._rawMonths,
    );

    // 3. Echo suppression: identical to our shadow → do nothing.
    if (this._shadowsEqual(this._shadow, newShadow)) return;

    // 4. Compute remote deletes per domain from (old cloud) MINUS (new cloud).
    //    Deletes are derived ONLY from the shadow diff — never from local
    //    state — so the engine can never instruct deletion of a local-only
    //    pending key it never had in its shadow (clobber guard).
    const deletes = {};
    for (const domain of [...MAP_DOMAINS, ...ID_MAP_DOMAINS]) {
      const removed = deletedKeys(this._shadow[domain], newShadow[domain]);
      if (removed.length > 0) deletes[domain] = removed;
    }

    // 5. Emit the full assembled cloud state + deletes.
    this.onCloudUpdate(domains, false, { deletes });

    // 6. Advance the shadow and stamp last-synced.
    this._shadow = newShadow;
    this.lastSynced = new Date();
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
