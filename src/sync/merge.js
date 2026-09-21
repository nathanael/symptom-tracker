/**
 * Shared per-key / per-id last-write-wins merge helpers.
 *
 * Each entry/item carries an optional `_t` (write time in ms since epoch).
 * For each key/id present in either side, the version with the higher `_t`
 * wins. Entries without `_t` are treated as `_t = 0` (legacy data — any
 * stamped write supersedes them).
 *
 * Tie-breaking matches the original useSyncEngine helpers exactly:
 *   - map: `tOf(p) > tOf(c) ? p : c` → cloud wins ties.
 *   - id-array: local is kept only when strictly greater than the existing
 *     (cloud) entry → cloud/existing wins ties.
 *
 * Both helpers return the `prev` reference unchanged when the merged result
 * is deep-equal to it, to avoid unnecessary React re-renders.
 */

import { isTombstone, tOf } from './tombstones.js';

const jsonEqual = (a, b) => {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
};


/**
 * Merge two `{ key: value }` map domains by `_t`.
 * @param {Object} prev - local map
 * @param {Object} cloud - cloud map
 * @returns {Object} merged map (or `prev` reference if unchanged)
 */
export const mergeMapByTime = (prev, cloud) => {
  if (!prev || typeof prev !== 'object') return cloud;
  if (!cloud || typeof cloud !== 'object') return prev;
  if (jsonEqual(prev, cloud)) return prev;
  const merged = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(cloud)]);
  for (const k of keys) {
    const p = prev[k];
    const c = cloud[k];
    if (p === undefined) merged[k] = c;
    else if (c === undefined) merged[k] = p;
    else merged[k] = tOf(p) > tOf(c) ? p : c;
  }
  return jsonEqual(prev, merged) ? prev : merged;
};

/**
 * Merge two arrays of `{ id, ... }` items by `.id`, resolving conflicts by `_t`.
 * @param {Array} prev - local array
 * @param {Array} cloud - cloud array
 * @returns {Array} merged array (or `prev` reference if unchanged)
 */
export const mergeIdArrayByTime = (prev, cloud) => {
  if (!Array.isArray(prev)) return cloud;
  if (!Array.isArray(cloud)) return prev;
  if (jsonEqual(prev, cloud)) return prev;
  const byId = new Map();
  for (const item of cloud) {
    if (item && item.id != null) byId.set(item.id, item);
  }
  for (const item of prev) {
    if (!item || item.id == null) continue;
    const existing = byId.get(item.id);
    if (!existing) byId.set(item.id, item);
    else if (tOf(item) > tOf(existing)) byId.set(item.id, item);
  }
  const merged = [...byId.values()];
  return jsonEqual(prev, merged) ? prev : merged;
};

/**
 * The hook-side merge for one map domain: union-merge the cloud's LIVE records
 * by `_t`, then apply the cloud's tombstones (`{ key: _t }`).
 *
 * A tombstone removes the local record only when `tombstone._t >= local._t`; a
 * newer local write (a re-rating, an Undo) survives and the engine replaces the
 * tombstone in the cloud. A local record with no `_t` is older than any
 * tombstone. Any tombstone OBJECT found in local state (merged in by an app
 * version from before tombstones) is stripped — they must never reach the UI.
 *
 * @param {Object} prev - local map
 * @param {Object} cloud - cloud map (live records only)
 * @param {Object<string, number>} [tombstones] - key → tombstone `_t`
 * @returns {Object} merged map (or `prev` reference if unchanged)
 */
export const mergeCloudMap = (prev, cloud, tombstones) => {
  const merged = mergeMapByTime(prev, cloud);
  if (!merged || typeof merged !== 'object') return merged;
  const dead = (tombstones && typeof tombstones === 'object') ? tombstones : {};
  let next = null;
  for (const k of Object.keys(merged)) {
    const v = merged[k];
    if (isTombstone(v) || (k in dead && dead[k] >= tOf(v))) {
      if (!next) next = { ...merged };
      delete next[k];
    }
  }
  return next || merged;
};
