/**
 * changeDiff — compute the exact records that changed or were deleted between a
 * previous synced view of a domain and the new local view.
 *
 * Pure module, no imports. The heart of "write only what changed": changed
 * records are stamped with `_t` (write time, ms); deletions are reported by key.
 */

/** Deep equality on two values, ignoring any `_t` field at the top level. */
export function equalIgnoringT(a, b) {
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

/**
 * Diff a `{ key: value }` map domain.
 *
 * @param {object|undefined} prev previous synced view (falsy/non-object → {})
 * @param {object} next new local view
 * @param {number} now write timestamp stamped onto changed records
 * @returns {{ changed: Object<string, object>, deleted: string[] }}
 */
export function diffMapDomain(prev, next, now = Date.now()) {
  const base = (prev && typeof prev === 'object') ? prev : {};
  const view = (next && typeof next === 'object') ? next : {};
  const changed = {};
  const deleted = [];

  for (const k of Object.keys(view)) {
    if (!(k in base) || !equalIgnoringT(base[k], view[k])) {
      changed[k] = { ...view[k], _t: now };
    }
  }
  for (const k of Object.keys(base)) {
    if (!(k in view)) deleted.push(k);
  }

  return { changed, deleted };
}

/**
 * Diff an id-keyed definition map `{ id: { id, ... } }`. The shape is identical
 * to a map domain, so the logic is the same.
 */
export const diffIdMapDomain = diffMapDomain;
