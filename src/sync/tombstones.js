/**
 * Tombstones — how a delete travels between devices.
 *
 * The engine never infers "deleted" from a key being ABSENT in a cloud view: views can lag our own
 * writes, and treating absence as deletion once erased freshly entered data. So a delete of a
 * map-domain record is written as an explicit marker at the same key, `{ _deleted: true, _t }`.
 * It is a record like any other for last-writer-wins purposes: a newer tombstone removes an older
 * record, and a newer record (re-rating, undo) replaces an older tombstone.
 *
 * Tombstones live in the cloud and in the engine's shadow only. They are never handed to the app
 * as data; `splitTombstones` separates them out on the way in.
 *
 * Pure module.
 */

// After this long a tombstone is pruned (the field is truly deleted). A device that stayed offline
// longer than this while holding a stale copy could bring the record back.
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const tOf = (v) => ((v && typeof v === 'object' && typeof v._t === 'number') ? v._t : 0);

export const isTombstone = (record) => !!(record && typeof record === 'object' && record._deleted === true);

export const makeTombstone = (now) => ({ _deleted: true, _t: now });

/**
 * Split a flat cloud map into the records the app should see and the tombstones.
 * @returns {{ live: Object, tombstones: Object<string, number> }} tombstones as `{ key: _t }`
 */
export function splitTombstones(map) {
  const live = {};
  const tombstones = {};
  if (map && typeof map === 'object') {
    for (const key of Object.keys(map)) {
      if (isTombstone(map[key])) tombstones[key] = tOf(map[key]);
      else live[key] = map[key];
    }
  }
  return { live, tombstones };
}

/**
 * Remove every record a tombstone supersedes: same key, and the record is not newer than the
 * tombstone. A record with no `_t` counts as older than any tombstone. Returns the same reference
 * when nothing was removed.
 */
export function applyTombstones(map, tombstones) {
  if (!map || typeof map !== 'object' || !tombstones) return map;
  let next = null;
  for (const key of Object.keys(tombstones)) {
    if (key in map && tOf(map[key]) <= tombstones[key]) {
      if (!next) next = { ...map };
      delete next[key];
    }
  }
  return next || map;
}
