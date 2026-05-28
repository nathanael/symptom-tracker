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

    // Per-domain last-synced view, used for diffing on the write path (later).
    this._shadow = {};

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

      const { domains, shadow } = assembleDomainsFromDocs(definitionsData, monthDocs);
      this._shadow = shadow;

      if (hasAnyData(domains) && !this._destroyed) {
        this.onCloudUpdate(domains, true);
      }

      this._ready = true;
      return { domains, shadow };
    } catch (err) {
      this.syncError = err.message;
      this._ready = true;
      return null;
    }
  }

  isReady() {
    return this._ready;
  }

  destroy() {
    // Listener teardown comes in Task 10; just set the flag so an in-flight
    // hydrate skips its emit.
    this._destroyed = true;
  }
}
