import { getFirebaseDb } from '../utils/firebase';

export const SYNC_DOMAINS = [
  'symptoms',
  'entries',
  'dailyNotes',
  'stackItems',
  'stackEntries',
  'pinnedSymptoms',
  'trackingMode',
  'inputItems',
  'inputEntries',
];

const DEBOUNCE_MS = 500;
const INIT_TIMEOUT_MS = 3000;

export default class SyncEngine {
  constructor(uid, onCloudUpdate) {
    this.uid = uid;
    this.onCloudUpdate = onCloudUpdate;
    this.sessionId = Math.random().toString(36).substring(2, 8);
    this.writeCounter = 0;

    // Per-domain version vector (local knowledge of current version)
    this.versions = {};
    SYNC_DOMAINS.forEach(d => { this.versions[d] = 0; });

    // Pending local changes waiting to be flushed
    this.pendingChanges = new Map();

    // Debounce timer
    this._flushTimer = null;

    // Firestore listener unsubscribe
    this._unsubscribe = null;

    // Initialization state
    this._ready = false;
    this._initializing = false;
    this._destroyed = false;

    // Sync status
    this.syncing = false;
    this.lastSynced = null;
    this.syncError = null;

    // Track our last write ID for echo detection
    this._lastWriteId = null;

    // Whether we've seen server-confirmed data (not just cache)
    this._hasServerData = false;

    // Flag: currently flushing (prevents re-entrant flushes)
    this._flushing = false;

    // Status change callback (for React to pick up syncing/lastSynced/syncError)
    this.onStatusChange = null;
  }

  /**
   * Initialize: set up Firestore listener, resolve when server data arrives or timeout.
   * Returns initial data for the caller to apply.
   */
  initialize() {
    if (this._initializing || this._ready) return Promise.resolve(null);
    this._initializing = true;

    const db = getFirebaseDb();
    if (!db) {
      this._ready = true;
      this._initializing = false;
      return Promise.resolve(null);
    }

    const docRef = db.collection('users').doc(this.uid);

    return new Promise((resolve) => {
      let resolved = false;
      let cachedData = null;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this._ready = true;
          this._initializing = false;
          // Flush any changes the user made during initialization
          if (this.pendingChanges.size > 0) {
            this._scheduleFlush();
          }
          // Resolve with cached data if we have it, otherwise null
          resolve(cachedData);
        }
      }, INIT_TIMEOUT_MS);

      this._unsubscribe = docRef.onSnapshot(
        (docSnap) => {
          if (this._destroyed) return;

          if (!docSnap.exists) {
            // No cloud doc yet — ready immediately
            if (!resolved) {
              clearTimeout(timeout);
              resolved = true;
              this._ready = true;
              this._initializing = false;
              resolve(null);
            }
            return;
          }

          const data = docSnap.data();
          const metadata = docSnap.metadata;
          const isFromCache = metadata.fromCache === true;

          if (!resolved) {
            // Still initializing
            if (isFromCache && !this._hasServerData) {
              // Cache hit — apply for fast display but wait for server
              cachedData = data;
              this._seedVersions(data);
              // Skip domains with pending local changes to preserve user edits
              const domains = this._extractDomains(data, true);
              if (Object.keys(domains).length > 0) {
                this.onCloudUpdate(domains, true);
              }
            } else {
              // Server-confirmed data — resolve initialization
              clearTimeout(timeout);
              resolved = true;
              this._hasServerData = true;
              this._seedVersions(data);
              this._ready = true;
              this._initializing = false;
              // Flush any changes the user made during initialization
              if (this.pendingChanges.size > 0) {
                this._scheduleFlush();
              }
              resolve(data);
            }
          } else {
            // Post-initialization: real-time updates
            this._handleSnapshot(data, metadata);
          }
        },
        (error) => {
          console.error('SyncEngine: listener error', error);
          if (!error.message?.includes('offline') && error.code !== 'unavailable') {
            this.syncError = error.message;
            this._notifyStatus();
          }
          if (!resolved) {
            clearTimeout(timeout);
            resolved = true;
            this._ready = true;
            this._initializing = false;
            if (this.pendingChanges.size > 0) {
              this._scheduleFlush();
            }
            resolve(cachedData);
          }
        }
      );
    });
  }

  /**
   * Seed the version vector from cloud data.
   * If cloud has _v_* fields, use them. Otherwise start at 0.
   * If there are pending local changes for a domain, ensure our version
   * exceeds the cloud version so our flush takes precedence.
   */
  _seedVersions(data) {
    SYNC_DOMAINS.forEach(domain => {
      const key = `_v_${domain}`;
      const cloudVersion = (typeof data[key] === 'number') ? data[key] : 0;
      if (this.pendingChanges.has(domain)) {
        this.versions[domain] = Math.max(this.versions[domain], cloudVersion + 1);
      } else {
        this.versions[domain] = cloudVersion;
      }
    });
  }

  /**
   * Extract just the synced domain data from a Firestore doc.
   * Skips domains with pending local changes to prevent cloud data
   * from overwriting the user's in-flight edits.
   */
  _extractDomains(data, skipPending = false) {
    const result = {};
    SYNC_DOMAINS.forEach(domain => {
      if (data[domain] !== undefined) {
        if (skipPending && this.pendingChanges.has(domain)) return;
        result[domain] = data[domain];
      }
    });
    return result;
  }

  /**
   * Handle a post-initialization snapshot from Firestore.
   */
  _handleSnapshot(data, metadata) {
    // Skip our own unconfirmed writes
    if (metadata.hasPendingWrites) return;

    // Skip our own confirmed echoes
    if (data._lastWriteId && data._lastWriteId === this._lastWriteId) return;

    // Per-domain: only accept if cloud version > our local version
    const updates = {};
    let hasUpdates = false;

    SYNC_DOMAINS.forEach(domain => {
      const cloudVersion = (typeof data[`_v_${domain}`] === 'number') ? data[`_v_${domain}`] : 0;
      const localVersion = this.versions[domain];

      if (cloudVersion > localVersion) {
        // If we have pending local changes for this domain, don't apply cloud data —
        // it would overwrite the user's in-flight changes during the debounce window.
        // Bump our version past the cloud so our pending flush takes precedence.
        if (this.pendingChanges.has(domain)) {
          this.versions[domain] = cloudVersion + 1;
          return;
        }
        if (data[domain] !== undefined) {
          updates[domain] = data[domain];
          this.versions[domain] = cloudVersion;
          hasUpdates = true;
        }
      }
    });

    if (hasUpdates) {
      this.lastSynced = data.updatedAt?.toDate() || new Date();
      this._notifyStatus();
      this.onCloudUpdate(updates, false);
    }
  }

  /**
   * Called when local data changes in a domain.
   * Queues the change and schedules a debounced flush.
   * Changes are queued even before initialization completes — they'll flush
   * once the engine is ready, and block cloud data from overwriting them.
   */
  notifyLocalChange(domain, data) {
    if (this._destroyed) return;

    this.pendingChanges.set(domain, data);
    this.versions[domain]++;
    if (this._ready) {
      this._scheduleFlush();
    }
  }

  /**
   * Schedule a debounced flush.
   */
  _scheduleFlush() {
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  /**
   * Cancel any pending debounce and flush immediately.
   * Called when the app is about to close/background.
   */
  flushNow() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._ready && this.pendingChanges.size > 0) {
      this.flush();
    }
  }

  /**
   * Flush pending changes to Firestore.
   */
  async flush() {
    if (this._flushing || this._destroyed || this.pendingChanges.size === 0) return;

    const db = getFirebaseDb();
    if (!db) return;

    this._flushing = true;
    this.syncing = true;
    this.syncError = null;
    this._notifyStatus();

    // Snapshot pending changes and clear
    const changes = new Map(this.pendingChanges);
    this.pendingChanges.clear();

    // Build the Firestore update payload
    const payload = {};
    changes.forEach((data, domain) => {
      payload[domain] = data;
      payload[`_v_${domain}`] = this.versions[domain];
    });

    // Write ID for echo detection
    this.writeCounter++;
    const writeId = `${this.sessionId}-${this.writeCounter}`;
    this._lastWriteId = writeId;
    payload._lastWriteId = writeId;
    payload.updatedAt = window.firebase.firestore.FieldValue.serverTimestamp();
    payload.version = '4.0';

    try {
      await db.collection('users').doc(this.uid).set(payload, { merge: true });
      this.lastSynced = new Date();
      this.syncError = null;
    } catch (error) {
      console.error('SyncEngine: flush failed', error);

      // Re-queue failed changes (don't overwrite newer pending changes)
      changes.forEach((data, domain) => {
        if (!this.pendingChanges.has(domain)) {
          this.pendingChanges.set(domain, data);
        }
      });

      if (error.message?.includes('offline') || error.code === 'unavailable') {
        // Retry silently for offline
        this._scheduleFlush();
      } else if (error.code === 'not-found') {
        this.syncError = 'Database not set up. Create Firestore database in Firebase Console.';
      } else if (error.code === 'permission-denied') {
        this.syncError = 'Permission denied. Check Firestore security rules.';
      } else {
        this.syncError = error.message;
      }
    } finally {
      this.syncing = false;
      this._flushing = false;
      this._notifyStatus();

      // If new changes accumulated during flush, schedule another
      if (this.pendingChanges.size > 0) {
        this._scheduleFlush();
      }
    }
  }

  /**
   * Notify status change callback.
   */
  _notifyStatus() {
    if (this.onStatusChange) {
      this.onStatusChange({
        syncing: this.syncing,
        lastSynced: this.lastSynced,
        syncError: this.syncError,
      });
    }
  }

  /**
   * Whether initialization is complete and writes are accepted.
   */
  isReady() {
    return this._ready;
  }

  /**
   * Tear down: unsubscribe listener, clear timers.
   */
  destroy() {
    this._destroyed = true;
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    // Best-effort: flush remaining changes synchronously won't work,
    // but at least they're in localStorage
    this.pendingChanges.clear();
  }
}
