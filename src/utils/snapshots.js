// Lightweight local snapshots of the symptomTracker_* localStorage keys.
// Stored as a single JSON blob per snapshot under `symptomTrackerSnap_<id>`.
// Used as a safety net before any operation that can overwrite local data
// (forcePull, forcePush) and as a periodic boot-time backup.
//
// These never touch Firestore — they're purely on-device. The intent is that
// even if cloud or merge logic destroys data, the previous local state can
// always be reconstructed from a snapshot taken seconds before the change.

const SNAP_PREFIX = 'symptomTrackerSnap_';
const TRACKED_KEYS = [
  'symptomTracker_symptoms',
  'symptomTracker_entries',
  'symptomTracker_notes',
  'symptomTracker_mode',
  'symptomTracker_stackItems',
  'symptomTracker_stackEntries',
  'symptomTracker_pinned',
  'symptomTracker_inputItems',
  'symptomTracker_inputEntries',
];

const MAX_SNAPSHOTS = 20;

function readTrackedKeys() {
  const snap = {};
  for (const k of TRACKED_KEYS) {
    const v = localStorage.getItem(k);
    if (v !== null) snap[k] = v;
  }
  return snap;
}

function totalKeyCount(snap) {
  let total = 0;
  for (const v of Object.values(snap)) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) total += parsed.length;
      else if (parsed && typeof parsed === 'object') total += Object.keys(parsed).length;
      else if (parsed != null) total += 1;
    } catch { /* ignore */ }
  }
  return total;
}

/**
 * Save a snapshot of all symptomTracker_* keys.
 * @param {string} label - free-form, e.g. 'preForcePull', 'boot', 'manual'
 * @returns {string|null} the snapshot id, or null on storage failure
 */
export function saveSnapshot(label = 'manual') {
  try {
    const data = readTrackedKeys();
    if (Object.keys(data).length === 0) return null;
    const ts = Date.now();
    const id = `${ts}_${label}`;
    const payload = {
      ts,
      label,
      itemCount: totalKeyCount(data),
      keys: data,
    };
    localStorage.setItem(SNAP_PREFIX + id, JSON.stringify(payload));
    pruneOldSnapshots();
    return id;
  } catch (e) {
    console.error('[snapshots] saveSnapshot failed:', e);
    return null;
  }
}

/**
 * List all available snapshots, newest first.
 * @returns {Array<{id:string, ts:number, label:string, itemCount:number}>}
 */
export function listSnapshots() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(SNAP_PREFIX)) continue;
    try {
      const raw = JSON.parse(localStorage.getItem(k));
      out.push({
        id: k.slice(SNAP_PREFIX.length),
        ts: raw.ts,
        label: raw.label,
        itemCount: raw.itemCount ?? 0,
      });
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/**
 * Restore a snapshot by id. Overwrites all tracked localStorage keys with
 * the snapshot's values. Caller must reload the page (or signal the engine
 * to re-read localStorage) for the in-memory React state to update.
 * @returns {boolean} success
 */
export function restoreSnapshot(id) {
  try {
    const raw = localStorage.getItem(SNAP_PREFIX + id);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (!payload.keys || typeof payload.keys !== 'object') return false;
    for (const [k, v] of Object.entries(payload.keys)) {
      if (TRACKED_KEYS.includes(k)) {
        localStorage.setItem(k, v);
      }
    }
    return true;
  } catch (e) {
    console.error('[snapshots] restoreSnapshot failed:', e);
    return false;
  }
}

/**
 * Delete a snapshot by id.
 */
export function deleteSnapshot(id) {
  try {
    localStorage.removeItem(SNAP_PREFIX + id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep at most MAX_SNAPSHOTS snapshots, deleting the oldest beyond that.
 */
function pruneOldSnapshots() {
  const snaps = listSnapshots();
  if (snaps.length <= MAX_SNAPSHOTS) return;
  const toDelete = snaps.slice(MAX_SNAPSHOTS);
  for (const s of toDelete) {
    deleteSnapshot(s.id);
  }
}

/**
 * Take a boot snapshot if the most recent existing snapshot is older than
 * a threshold. Cheap to call on every app load.
 */
export function bootSnapshotIfStale(thresholdMs = 6 * 60 * 60 * 1000) {
  const snaps = listSnapshots();
  const newest = snaps[0];
  if (!newest || (Date.now() - newest.ts) > thresholdMs) {
    return saveSnapshot('boot');
  }
  return null;
}
