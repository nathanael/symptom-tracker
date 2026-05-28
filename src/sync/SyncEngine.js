import { getFirebaseDb } from '../utils/firebase';
import { saveSnapshot } from '../utils/snapshots';

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

// Maps sync domain names to localStorage keys
const DOMAIN_STORAGE_KEYS = {
  symptoms: 'symptomTracker_symptoms',
  entries: 'symptomTracker_entries',
  dailyNotes: 'symptomTracker_notes',
  stackItems: 'symptomTracker_stackItems',
  stackEntries: 'symptomTracker_stackEntries',
  pinnedSymptoms: 'symptomTracker_pinned',
  trackingMode: 'symptomTracker_mode',
  inputItems: 'symptomTracker_inputItems',
  inputEntries: 'symptomTracker_inputEntries',
};

const DEBOUNCE_MS = 500;
const INIT_TIMEOUT_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 60000; // Check listener health every 60s
const HEARTBEAT_DEAD_MS = 120000; // Listener considered dead after 2min of silence

const LOG_PREFIX = '[Sync]';
const log = (...args) => console.log(LOG_PREFIX, ...args);
const logWarn = (...args) => console.warn(LOG_PREFIX, ...args);
const WRITE_TIMEOUT_MS = 8000;

// Domains stored as key-value maps (objects). Cloud data can be safely merged
// as a base layer under local changes: { ...cloudData, ...localData }.
const MAP_DOMAINS = new Set(['entries', 'dailyNotes', 'stackEntries', 'inputEntries']);

// Domains stored as arrays with .id fields. Merged by ID: cloud as base, local-only items preserved.
const ARRAY_ID_DOMAINS = new Set(['stackItems', 'symptoms', 'inputItems']);

// Domains with large nested maps that must be stored as JSON strings
// to avoid Firestore's INDEX_ENTRIES_COUNT_LIMIT_EXCEEDED (40k entry limit).
const STRINGIFIED_DOMAINS = new Set([
  'entries', 'dailyNotes', 'stackEntries', 'stackItems',
  'symptoms', 'inputItems', 'inputEntries', 'pinnedSymptoms',
]);

/** Encode domain data for Firestore: stringify large domains. */
function encodeDomain(domain, data) {
  if (STRINGIFIED_DOMAINS.has(domain)) {
    return JSON.stringify(data);
  }
  return data;
}

/** Decode domain data from Firestore: parse if it was stringified. */
function decodeDomain(domain, data) {
  if (typeof data === 'string' && STRINGIFIED_DOMAINS.has(domain)) {
    try { return JSON.parse(data); } catch (e) { return data; }
  }
  return data;
}

/** Deep equality on two objects/values, ignoring any _t field at the top level. */
function _equalIgnoringT(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a).filter(k => k !== '_t');
  const kb = Object.keys(b).filter(k => k !== '_t');
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

/** Race a promise against a timeout. Resolves 'timeout' if it takes too long. */
const withTimeout = (promise, ms = WRITE_TIMEOUT_MS) =>
  Promise.race([
    promise.then(() => 'ok'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), ms)),
  ]);

/** Convert a Firestore REST API value back to a JS value. */
function firestoreValueToJs(value) {
  if (value === null || value === undefined) return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return { toDate: () => new Date(value.timestampValue) };
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(firestoreValueToJs);
  }
  if ('mapValue' in value) {
    const result = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) {
      result[k] = firestoreValueToJs(v);
    }
    return result;
  }
  return null;
}

/** Convert a JS value to Firestore REST API value format. */
function jsToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(jsToFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = jsToFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

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

    // Last cloud-side data we saw per domain — used to detect which keys/items
    // the user actually changed in notifyLocalChange so we only stamp those
    // with a fresh _t. Without this baseline, every write would re-stamp every
    // entry and last-writer-wins degenerates to last-flush-wins.
    this._lastAppliedCloud = {};

    // Dirty domains are tracked in-memory only — never resurrected across
    // sessions. Resurrecting stale dirty flags caused bidirectional overwrites:
    // a device reopened within the expiry window would re-flush its old
    // localStorage data and clobber edits made on other devices in the gap.
    // Trade-off: edits made within the ~500ms debounce window that get
    // force-killed before flushNow() runs may be lost. visibilitychange and
    // beforeunload normally cover those cases.
    this._dirtyDomains = new Set();
    try { localStorage.removeItem(`syncDirty_${uid}`); } catch (e) { /* ignore */ }
    log('Constructor: session=', this.sessionId);

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

    // Cache the most recent snapshot so we can re-process it after flush
    // clears dirty flags (fixes: snapshot arrives before flush completes → skipped → never retried)
    this._lastSnapshotData = null;
    this._lastSnapshotMeta = null;

    // Flag: currently flushing (prevents re-entrant flushes)
    this._flushing = false;

    // Polling fallback when streaming listener is broken
    this._pollTimer = null;
    this._listenerWorking = false; // true once onSnapshot delivers server data

    // Heartbeat: detect when listener dies silently
    this._lastSnapshotTime = null; // timestamp of last received snapshot
    this._heartbeatTimer = null;

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
    log('Initializing...');

    const db = getFirebaseDb();
    if (!db) {
      logWarn('No Firestore DB — init aborted');
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
          logWarn('Init TIMEOUT after', INIT_TIMEOUT_MS, 'ms — listener never got server data, trying direct get()...');
          // The onSnapshot listener uses a streaming channel that may be blocked.
          // Fallback: try a direct get() which uses a single HTTP request.
          docRef.get({ source: 'server' }).then(snap => {
            if (resolved || this._destroyed) return;
            if (snap.exists) {
              const data = snap.data();
              const versionInfo = {};
              SYNC_DOMAINS.forEach(d => {
                if (data[`_v_${d}`] !== undefined) versionInfo[d] = data[`_v_${d}`];
              });
              log('Direct get() SUCCESS: versions=', versionInfo);
              resolved = true;
              this._hasServerData = true;
              this._seedVersions(data);
              this._ready = true;
              this._initializing = false;
              this._requeueDirtyDomains();
              this._mergeCloudIntoAllPending(data);
              resolve(data);
            } else {
              log('Direct get(): doc does not exist');
              resolved = true;
              this._ready = true;
              this._initializing = false;
              this._requeueDirtyDomains();
              resolve(null);
            }
          }).catch(err => {
            logWarn('Direct get() FAILED:', err.message, '— resolving with', cachedData ? 'cached data' : 'null');
            if (!resolved) {
              resolved = true;
              this._ready = true;
              this._initializing = false;
              this._requeueDirtyDomains();
              resolve(cachedData);
            }
          });
        }
      }, INIT_TIMEOUT_MS);

      this._unsubscribe = docRef.onSnapshot(
        (docSnap) => {
          if (this._destroyed) return;

          if (!docSnap.exists) {
            log('Snapshot: doc does not exist');
            if (!resolved) {
              clearTimeout(timeout);
              resolved = true;
              this._ready = true;
              this._initializing = false;
              this._requeueDirtyDomains();
              resolve(null);
            }
            return;
          }

          const data = docSnap.data();
          const metadata = docSnap.metadata;
          const isFromCache = metadata.fromCache === true;
          const hasPending = metadata.hasPendingWrites === true;

          // Log version info from server
          const versionInfo = {};
          SYNC_DOMAINS.forEach(d => {
            if (data[`_v_${d}`] !== undefined) versionInfo[d] = data[`_v_${d}`];
          });

          if (!resolved) {
            // Still initializing
            if (isFromCache && !this._hasServerData) {
              log('Snapshot (INIT/CACHE): versions=', versionInfo, 'hasPending=', hasPending);
              cachedData = data;
              this._seedVersions(data);
              const domains = this._extractDomains(data, true);
              log('  Applying cache domains:', Object.keys(domains));
              if (Object.keys(domains).length > 0) {
                this.onCloudUpdate(domains, true);
              }
            } else {
              log('Snapshot (INIT/SERVER): versions=', versionInfo, 'hasPending=', hasPending, 'fromCache=', isFromCache);
              clearTimeout(timeout);
              resolved = true;
              this._hasServerData = true;
              this._listenerWorking = true;
              this._touchHeartbeat();
              this._seedVersions(data);
              this._ready = true;
              this._initializing = false;
              this._requeueDirtyDomains();
              // Merge cloud data into any pending changes so flush doesn't lose it
              this._mergeCloudIntoAllPending(data);
              log('  Local versions after seed:', { ...this.versions });
              log('  Dirty domains:', [...this._dirtyDomains], 'Pending:', [...this.pendingChanges.keys()]);
              resolve(data);
            }
          } else {
            log('Snapshot (REALTIME): versions=', versionInfo, 'fromCache=', isFromCache, 'hasPending=', hasPending, 'writeId=', data._lastWriteId);
            if (!isFromCache && !hasPending) {
              this._listenerWorking = true;
              this._touchHeartbeat();
              this._stopPolling();
            }
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
            this._requeueDirtyDomains();
            resolve(cachedData);
          }
        }
      );
    });
  }

  /**
   * Seed the version vector from cloud data.
   * If cloud has _v_* fields, use them. Otherwise start at 0.
   * If there are pending/dirty local changes for a domain, ensure our version
   * exceeds the cloud version so our flush takes precedence.
   */
  _seedVersions(data) {
    SYNC_DOMAINS.forEach(domain => {
      const key = `_v_${domain}`;
      const cloudVersion = (typeof data[key] === 'number') ? data[key] : 0;
      if (this.pendingChanges.has(domain) || this._dirtyDomains.has(domain)) {
        this.versions[domain] = Math.max(this.versions[domain], cloudVersion + 1);
      } else {
        this.versions[domain] = cloudVersion;
      }
    });
  }

  /**
   * Extract just the synced domain data from a Firestore doc.
   * @param {object} data - Firestore doc data
   * @param {'all'|'skipPending'|'skipDirty'} mode
   *   'all'         — return all domains
   *   'skipPending'  — skip domains with pending in-flight changes (this session only)
   *   'skipDirty'    — skip domains with pending OR dirty flags (most conservative)
   */
  _extractDomains(data, mode = 'all') {
    // Backward compat: boolean true → 'skipDirty', false → 'all'
    if (mode === true) mode = 'skipDirty';
    if (mode === false) mode = 'all';

    const result = {};
    SYNC_DOMAINS.forEach(domain => {
      if (data[domain] === undefined) return;
      const decoded = decodeDomain(domain, data[domain]);
      // Always record cloud baseline so notifyLocalChange can detect which
      // keys changed — even for "skipped" domains, the cloud values are real.
      this._lastAppliedCloud[domain] = decoded;
      if (mode === 'skipDirty' && (this.pendingChanges.has(domain) || this._dirtyDomains.has(domain))) {
        return; // merge will preserve local on top later
      }
      if (mode === 'skipPending' && this.pendingChanges.has(domain)) {
        return;
      }
      result[domain] = decoded;
    });
    return result;
  }

  /**
   * Re-read dirty domain data from localStorage and queue for flush.
   * Called after initialization completes to push any unsynced changes.
   */
  _requeueDirtyDomains() {
    if (this._dirtyDomains.size === 0) return;
    this._dirtyDomains.forEach(domain => {
      if (!this.pendingChanges.has(domain)) {
        try {
          const storageKey = DOMAIN_STORAGE_KEYS[domain];
          if (!storageKey) return;
          const raw = localStorage.getItem(storageKey);
          if (raw !== null) {
            const data = JSON.parse(raw);
            this.pendingChanges.set(domain, data);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    });
    if (this.pendingChanges.size > 0) {
      this._scheduleFlush();
    }
  }

  /**
   * Handle a post-initialization snapshot from Firestore.
   */
  _handleSnapshot(data, metadata) {
    // Skip our own unconfirmed writes
    if (metadata.hasPendingWrites) {
      log('  _handleSnapshot: SKIP (hasPendingWrites)');
      return;
    }

    // Skip our own confirmed echoes
    if (data._lastWriteId && data._lastWriteId === this._lastWriteId) {
      log('  _handleSnapshot: SKIP (own echo)', data._lastWriteId);
      return;
    }

    // Cache latest snapshot so we can re-process after flush clears dirty flags
    this._lastSnapshotData = data;
    this._lastSnapshotMeta = metadata;

    this._applySnapshot(data);
  }

  /**
   * Merge cloud data into pending changes for a domain.
   * For map domains (entries, dailyNotes, etc.): cloud as base, local on top.
   * For array-id domains (stackItems, symptoms, etc.): merge by .id field.
   * For non-map domains (scalars): local wins entirely (can't safely merge).
   */
  _mergeCloudIntoPending(domain, cloudDomainData) {
    if (!this.pendingChanges.has(domain)) return false;
    if (cloudDomainData === undefined) return false;

    const localData = this.pendingChanges.get(domain);

    if (MAP_DOMAINS.has(domain)) {
      // Cloud as base, local changes on top — local keys win for conflicts
      const merged = { ...cloudDomainData, ...localData };
      this.pendingChanges.set(domain, merged);
      const cloudKeys = Object.keys(cloudDomainData).length;
      const localKeys = Object.keys(localData).length;
      const mergedKeys = Object.keys(merged).length;
      log('  _mergeCloudIntoPending:', domain, `cloud=${cloudKeys} local=${localKeys} merged=${mergedKeys}`);
      return true;
    }

    if (ARRAY_ID_DOMAINS.has(domain) && Array.isArray(cloudDomainData) && Array.isArray(localData)) {
      // ID-based merge: local items win for conflicts, cloud-only items preserved
      const cloudById = new Map(cloudDomainData.map(i => [i.id, i]));
      const localById = new Map(localData.map(i => [i.id, i]));
      const merged = new Map(cloudById);
      localById.forEach((item, id) => merged.set(id, item)); // local wins
      this.pendingChanges.set(domain, [...merged.values()]);
      log('  _mergeCloudIntoPending:', domain, `cloud=${cloudDomainData.length} local=${localData.length} merged=${merged.size}`);
      return true;
    }

    return false;
  }

  /**
   * Merge cloud data into ALL pending changes (map + array-id domains).
   * Called during init when server data arrives and some domains have pending changes.
   * Ensures the upcoming flush includes cloud data, not just stale local data.
   */
  _mergeCloudIntoAllPending(data) {
    if (this.pendingChanges.size === 0) return;
    this.pendingChanges.forEach((_, domain) => {
      if (data[domain] !== undefined) {
        this._mergeCloudIntoPending(domain, decodeDomain(domain, data[domain]));
      }
    });
  }

  /**
   * Apply domain data from a snapshot. Cloud data is always emitted; the
   * React-side merge in useSyncEngine resolves per-key by _t timestamp so
   * stale snapshots cannot clobber newer local edits.
   *
   * Domains with in-flight pending writes are still emitted (the merge will
   * keep local on top), so we never let polling leave the UI stale just
   * because we have unflushed changes.
   */
  _applySnapshot(data) {
    const updates = {};
    let hasUpdates = false;

    SYNC_DOMAINS.forEach(domain => {
      if (data[domain] === undefined) return;
      const decoded = decodeDomain(domain, data[domain]);
      updates[domain] = decoded;
      this._lastAppliedCloud[domain] = decoded;
      const cloudVersion = (typeof data[`_v_${domain}`] === 'number') ? data[`_v_${domain}`] : 0;
      if (cloudVersion > this.versions[domain]) {
        this.versions[domain] = cloudVersion;
      }
      hasUpdates = true;
    });

    log('  _applySnapshot: applying=', Object.keys(updates));

    if (hasUpdates) {
      this.lastSynced = (typeof data.updatedAt?.toDate === 'function') ? data.updatedAt.toDate() : new Date();
      this._notifyStatus();
      this.onCloudUpdate(updates, false);
    }
  }

  /**
   * Called when local data changes in a domain.
   * Stamps newly changed keys/items with _t = now so cross-device merges can
   * resolve by timestamp, then queues a debounced flush.
   */
  notifyLocalChange(domain, data) {
    if (this._destroyed) return;
    const stamped = this._stampChanges(domain, data);
    log('notifyLocalChange:', domain, 'version:', this.versions[domain], '->', this.versions[domain] + 1);
    this.pendingChanges.set(domain, stamped);
    this.versions[domain]++;
    this._dirtyDomains.add(domain);
    this._persistDirty();
    if (this._ready) {
      this._scheduleFlush();
    }
  }

  /**
   * Compare new local data against the last known cloud state for this domain.
   * Add _t = now to any key/item that differs (or is new). Unchanged entries
   * keep their existing _t (preserving "when this was last edited" info).
   */
  _stampChanges(domain, data) {
    const now = Date.now();
    const lastSeen = this._lastAppliedCloud[domain];

    if (MAP_DOMAINS.has(domain) && data && typeof data === 'object' && !Array.isArray(data)) {
      const lastMap = (lastSeen && typeof lastSeen === 'object') ? lastSeen : {};
      const stamped = {};
      for (const [k, v] of Object.entries(data)) {
        const prev = lastMap[k];
        if (prev && _equalIgnoringT(prev, v)) {
          stamped[k] = prev; // unchanged → keep cloud's _t
        } else if (v && typeof v === 'object' && !Array.isArray(v)) {
          stamped[k] = { ...v, _t: now };
        } else {
          // Non-object value (rare for map domains). Wrap so we can carry _t.
          stamped[k] = v;
        }
      }
      return stamped;
    }

    if (ARRAY_ID_DOMAINS.has(domain) && Array.isArray(data)) {
      const lastById = new Map(Array.isArray(lastSeen) ? lastSeen.map(i => [i.id, i]) : []);
      return data.map(item => {
        if (!item || typeof item !== 'object' || item.id == null) return item;
        const prev = lastById.get(item.id);
        if (prev && _equalIgnoringT(prev, item)) {
          return prev; // unchanged
        }
        return { ...item, _t: now };
      });
    }

    return data;
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
   * Dirty flags are in-memory only (see constructor). This still clears any
   * legacy localStorage entry that may exist from older builds.
   */
  _persistDirty() {
    try { localStorage.removeItem(`syncDirty_${this.uid}`); } catch (e) { /* ignore */ }
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

    // ALWAYS pre-flush merge with cloud, even when the listener is healthy.
    // Reason: there is a race where the listener delivers cloud-side keys and
    // applyCloudData merges them into React state, but isApplyingCloudRef is
    // true during that apply so useLocalStorage skips notifyLocalChange and
    // pendingChanges never picks up the cloud-side keys. If we then flush
    // those pendingChanges as-is, the Firestore set({merge:true}) replaces the
    // domain field and destroys cloud-only keys. Pre-flush merge re-reads the
    // cloud and unions by per-key _t before writing.
    //
    // We deliberately do NOT call onCloudUpdate to push the merged result
    // back into React state — doing so triggers applyCloudData every flush,
    // which fires the >50% shrink guard on single-domain updates (cloudTotal
    // for one domain ≪ localTotal), saves a snapshot per flush, and was
    // visibly undoing user edits (e.g., supplement hide reverting after the
    // 500ms debounce). The post-write listener echo will sync local state.
    await this._preFlushMerge(changes);

    // Build the Firestore update payload
    const payload = {};
    changes.forEach((data, domain) => {
      payload[domain] = encodeDomain(domain, data);
      payload[`_v_${domain}`] = this.versions[domain];
    });

    // Write ID for echo detection
    this.writeCounter++;
    const writeId = `${this.sessionId}-${this.writeCounter}`;
    this._lastWriteId = writeId;
    payload._lastWriteId = writeId;
    payload.updatedAt = window.firebase.firestore.FieldValue.serverTimestamp();
    payload.version = '4.0';

    log('Flushing domains:', [...changes.keys()], 'writeId:', writeId);

    try {
      const result = await withTimeout(
        db.collection('users').doc(this.uid).set(payload, { merge: true })
      );
      if (result === 'timeout') {
        log('Flush TIMEOUT for:', [...changes.keys()], '(queued locally, server pending)');
      } else {
        log('Flush SUCCESS for:', [...changes.keys()]);
      }
      // Treat both as success — data is saved locally, server will eventually get it
      this.lastSynced = new Date();
      this.syncError = null;
      const hadDirty = this._dirtyDomains.size > 0;
      changes.forEach((data, domain) => {
        this._dirtyDomains.delete(domain);
      });
      this._persistDirty();

      // If dirty flags were blocking cloud data, re-process the last snapshot
      // now that they're cleared. This handles the race where a snapshot arrived
      // while dirty flags were set, was skipped, and no new snapshot follows.
      if (hadDirty && this._dirtyDomains.size === 0 && this._lastSnapshotData) {
        this._applySnapshot(this._lastSnapshotData);
      }
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
   * Per-key/per-id _t-based merge: latest write wins per key, all keys preserved.
   * This is the same merge the React side uses (mergeMapByTime/mergeArrayByTime)
   * applied here so flushes never overwrite cloud-side keys this device hasn't
   * seen yet.
   *
   * For non-map/non-array domains (scalars like trackingMode) we keep `local`
   * since the caller decided to flush it.
   */
  _tMergeForFlush(domain, cloud, local) {
    const tOf = (v) => (v && typeof v === 'object' && typeof v._t === 'number') ? v._t : 0;

    if (MAP_DOMAINS.has(domain) && cloud && typeof cloud === 'object' && !Array.isArray(cloud)
        && local && typeof local === 'object' && !Array.isArray(local)) {
      const merged = {};
      const keys = new Set([...Object.keys(cloud), ...Object.keys(local)]);
      for (const k of keys) {
        const c = cloud[k];
        const l = local[k];
        if (c === undefined) merged[k] = l;
        else if (l === undefined) merged[k] = c;
        else merged[k] = tOf(l) >= tOf(c) ? l : c;
      }
      return merged;
    }

    if (ARRAY_ID_DOMAINS.has(domain) && Array.isArray(cloud) && Array.isArray(local)) {
      const byId = new Map();
      for (const it of cloud) { if (it && it.id != null) byId.set(it.id, it); }
      for (const it of local) {
        if (!it || it.id == null) continue;
        const existing = byId.get(it.id);
        if (!existing || tOf(it) >= tOf(existing)) byId.set(it.id, it);
      }
      return [...byId.values()];
    }

    return local;
  }

  /**
   * Pre-flush safety read: fetch the latest cloud data and merge into the
   * changes we're about to flush. Uses per-key/per-id _t merge so cloud-only
   * keys are preserved even when the listener has already delivered them but
   * the user's pendingChanges (built from React state at edit time) haven't
   * caught up. This is what prevents the catastrophic case where Device B
   * overwrites Device A's just-pushed key K because B's listener fired after
   * B's edit was queued.
   *
   * Returns true if the merge actually changed any flushed domain (so callers
   * can re-apply to React state).
   */
  async _preFlushMerge(changes) {
    let mutated = false;
    try {
      const cloudData = await this._restApiGet();
      if (!cloudData) return false;

      log('Pre-flush merge: got cloud data, merging into', [...changes.keys()]);

      changes.forEach((localData, domain) => {
        if (cloudData[domain] === undefined) return;
        const decoded = decodeDomain(domain, cloudData[domain]);
        const before = localData;
        const merged = this._tMergeForFlush(domain, decoded, localData);
        if (merged !== before) {
          changes.set(domain, merged);
          mutated = true;
        }

        // Also update version to at least match cloud so our write supersedes it.
        const cloudVersion = (typeof cloudData[`_v_${domain}`] === 'number')
          ? cloudData[`_v_${domain}`] : 0;
        if (cloudVersion >= this.versions[domain]) {
          this.versions[domain] = cloudVersion + 1;
        }
        // Cache the cloud-side view so subsequent _stampChanges has the right baseline.
        this._lastAppliedCloud[domain] = decoded;
      });
    } catch (e) {
      log('Pre-flush merge failed (continuing with local data):', e.message);
    }
    return mutated;
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
   * Push local data to the server. SAFE by default: pre-merges with cloud
   * (per-key _t merge) so cloud-only keys are preserved. This is what
   * "Sync Now" calls, and it must never destroy data the user has on another
   * device.
   *
   * Pass {destructive: true} to bypass the pre-merge and write the supplied
   * local data verbatim. Only the "Replace cloud with local" path should use
   * that, and only after a user confirmation.
   *
   * Uses the Firestore REST API directly (via fetch) to bypass the SDK's
   * streaming channel which sometimes hangs.
   *
   * @param {Object} allData - Map of domain name to current local data
   * @param {{destructive?: boolean}} opts
   */
  async forcePush(allData, opts = {}) {
    if (this._destroyed) return;
    const { destructive = false } = opts;

    // Snapshot first — every push that touches cloud is a candidate for the
    // user to want to undo.
    saveSnapshot(destructive ? 'preForcePushReplace' : 'preForcePush');

    this.syncing = true;
    this.syncError = null;
    this._notifyStatus();

    // Build a merged view: cloud + local, picking newer _t per key. For the
    // destructive path we skip this and push `allData` as-is.
    let toWrite = { ...allData };
    let mergedFromCloud = false;
    if (!destructive) {
      try {
        const cloudData = await this._restApiGet();
        if (cloudData) {
          SYNC_DOMAINS.forEach(domain => {
            const local = allData[domain];
            const cloudRaw = cloudData[domain];
            if (cloudRaw === undefined) return;
            const cloud = decodeDomain(domain, cloudRaw);
            if (local === undefined) {
              toWrite[domain] = cloud;
              mergedFromCloud = true;
              return;
            }
            const merged = this._tMergeForFlush(domain, cloud, local);
            if (merged !== local) {
              toWrite[domain] = merged;
              mergedFromCloud = true;
            }
            const cloudVersion = (typeof cloudData[`_v_${domain}`] === 'number')
              ? cloudData[`_v_${domain}`] : 0;
            if (cloudVersion >= this.versions[domain]) {
              this.versions[domain] = cloudVersion;
            }
          });
        }
      } catch (e) {
        log('forcePush pre-merge failed (continuing with local only):', e.message);
      }
    }

    const payload = {};
    SYNC_DOMAINS.forEach(domain => {
      if (toWrite[domain] !== undefined) {
        payload[domain] = encodeDomain(domain, toWrite[domain]);
        this.versions[domain] = (this.versions[domain] || 0) + 100;
        payload[`_v_${domain}`] = this.versions[domain];
        this._lastAppliedCloud[domain] = toWrite[domain];
      }
    });

    this.writeCounter++;
    const writeId = `${this.sessionId}-${this.writeCounter}`;
    this._lastWriteId = writeId;
    payload._lastWriteId = writeId;
    payload.updatedAt = new Date().toISOString();
    payload.version = '4.0';

    try {
      // Get auth token for REST API
      const token = await window.firebase.auth().currentUser.getIdToken();
      const projectId = 'symptoms-dae26';
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${this.uid}`;

      // Convert JS data to Firestore REST format
      const firestoreDoc = { fields: {} };
      for (const [key, value] of Object.entries(payload)) {
        firestoreDoc.fields[key] = jsToFirestoreValue(value);
      }

      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(firestoreDoc),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`REST API error ${response.status}: ${errText}`);
      }

      log('forcePush SUCCESS (REST API), new versions:', { ...this.versions });
      this.lastSynced = new Date();
      this.syncError = null;
      this._dirtyDomains.clear();
      this.pendingChanges.clear();
      this._persistDirty();
      // Listener echo will resync React state with the cloud-side merged
      // result. We don't call onCloudUpdate here for the same reason as flush:
      // single-domain updates trigger the >50% shrink guard, which both
      // saves spurious snapshots and (when not aborting) can race with the
      // user's just-committed local edit.
    } catch (error) {
      console.error('SyncEngine: forcePush failed', error);
      this.syncError = error.message;
    } finally {
      this.syncing = false;
      this._notifyStatus();
    }
  }

  /**
   * Pull cloud data. Safe by default: takes a local snapshot first, then
   * merges cloud with local using per-key _t timestamps (keys present only
   * locally are preserved). Pass {destructive:true} to instead replace local
   * state entirely with cloud — only use after the user confirms.
   *
   * Returns { summary, snapshotId, destructive } so the UI can tell the user
   * exactly what happened and how to roll back.
   */
  async forcePull({ destructive = false } = {}) {
    if (this._destroyed) return null;
    this.syncing = true;
    this.syncError = null;
    this._notifyStatus();

    // ALWAYS snapshot first, even for the merge path — Pull has historically
    // been the operation most likely to lose data and the cost of a snapshot
    // is negligible.
    const snapshotId = saveSnapshot(destructive ? 'preForcePullReplace' : 'preForcePullMerge');

    try {
      const data = await this._restApiGet();
      if (!data) throw new Error('Could not fetch cloud document');

      const updates = {};
      const summary = {};
      SYNC_DOMAINS.forEach(domain => {
        if (data[domain] === undefined) return;
        const decoded = decodeDomain(domain, data[domain]);
        updates[domain] = decoded;
        this._lastAppliedCloud[domain] = decoded;
        const cloudVersion = (typeof data[`_v_${domain}`] === 'number') ? data[`_v_${domain}`] : 0;
        if (cloudVersion > this.versions[domain]) this.versions[domain] = cloudVersion;
        summary[domain] = Array.isArray(decoded) ? decoded.length
          : (decoded && typeof decoded === 'object') ? Object.keys(decoded).length
          : (decoded != null ? 1 : 0);
      });

      if (destructive) {
        this.pendingChanges.clear();
        this._dirtyDomains.clear();
      }

      log('forcePull:', destructive ? 'REPLACE' : 'MERGE', 'summary:', summary, 'snapshot:', snapshotId);
      this.lastSynced = new Date();

      if (Object.keys(updates).length > 0) {
        // 3rd arg = forceReplace: destructive caller only.
        this.onCloudUpdate(updates, false, destructive);
      }
      return { summary, snapshotId, destructive };
    } catch (error) {
      console.error('SyncEngine: forcePull failed', error);
      this.syncError = error.message;
      return null;
    } finally {
      this.syncing = false;
      this._notifyStatus();
    }
  }

  /**
   * Force-push also snapshots first so the user can roll back if force-push
   * sent the wrong device's data to cloud.
   */
  async forcePushSafe(allData) {
    const snapshotId = saveSnapshot('preForcePush');
    log('forcePush: snapshot saved as', snapshotId);
    return this.forcePush(allData);
  }

  /**
   * Read the user's document via Firestore REST API (bypasses SDK streaming).
   * Returns the document data as a plain JS object, or null on failure.
   */
  async _restApiGet() {
    try {
      const currentUser = window.firebase?.auth()?.currentUser;
      if (!currentUser) return null;
      const token = await currentUser.getIdToken();
      const projectId = 'symptoms-dae26';
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${this.uid}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const doc = await response.json();
      if (!doc.fields) return null;
      // Convert Firestore REST format to plain JS object
      const data = {};
      for (const [key, value] of Object.entries(doc.fields)) {
        data[key] = firestoreValueToJs(value);
      }
      return data;
    } catch (e) {
      log('REST API get failed:', e.message);
      return null;
    }
  }

  /**
   * Start polling fallback if the streaming listener isn't working.
   * Called after initialization completes.
   */
  _startPollingIfNeeded() {
    // Always start heartbeat monitoring to detect listener death
    this._startHeartbeat();

    if (this._listenerWorking || this._pollTimer || this._destroyed) return;

    const POLL_INTERVAL_MS = 30000;
    log('Streaming listener not working — starting poll every', POLL_INTERVAL_MS / 1000, 's');

    const poll = async () => {
      if (this._destroyed || this._listenerWorking) {
        this._stopPolling();
        return;
      }

      // Try SDK get() first, fall back to REST API if it fails
      let data = null;
      const db = getFirebaseDb();
      if (db) {
        try {
          const snap = await db.collection('users').doc(this.uid).get({ source: 'server' });
          if (snap.exists) data = snap.data();
        } catch (e) {
          log('SDK poll failed, trying REST API fallback');
        }
      }

      // REST API fallback — bypasses broken SDK streaming channel
      if (!data) {
        data = await this._restApiGet();
        if (data) log('REST API poll succeeded');
      }

      if (data && !this._destroyed) {
        this._lastSnapshotData = data;
        this._applySnapshot(data);
      }
    };

    this._pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  }

  /**
   * Stop the polling fallback (e.g., when the streaming listener starts working).
   */
  _stopPolling() {
    if (this._pollTimer) {
      log('Stopping poll fallback (listener now working)');
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Start a heartbeat timer that monitors whether the streaming listener
   * is still delivering snapshots. If no snapshot arrives within
   * HEARTBEAT_DEAD_MS, assume the listener has died and restart polling.
   */
  _startHeartbeat() {
    if (this._heartbeatTimer || this._destroyed) return;
    this._lastSnapshotTime = Date.now();

    this._heartbeatTimer = setInterval(() => {
      if (this._destroyed) {
        this._stopHeartbeat();
        return;
      }
      if (!this._listenerWorking) return; // already polling

      const elapsed = Date.now() - (this._lastSnapshotTime || 0);
      if (elapsed >= HEARTBEAT_DEAD_MS) {
        logWarn('Listener appears dead (no snapshot in', Math.round(elapsed / 1000), 's) — restarting polling');
        this._listenerWorking = false;
        this._startPollingIfNeeded();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop the heartbeat timer.
   */
  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Record that a snapshot was received, resetting the heartbeat timer.
   */
  _touchHeartbeat() {
    this._lastSnapshotTime = Date.now();
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
    this._stopPolling();
    this._stopHeartbeat();
    this.pendingChanges.clear();
  }
}
