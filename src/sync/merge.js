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

const jsonEqual = (a, b) => {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
};

const tOf = (v) =>
  (v && typeof v === 'object' && typeof v._t === 'number') ? v._t : 0;

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
