/**
 * changeDiff — compute the exact records that changed or were deleted between a
 * previous synced view of a domain and the new local view.
 *
 * Pure module, no imports. The heart of "write only what changed": changed
 * records are stamped with `_t` (write time, ms); deletions are reported by key.
 */

/**
 * Recursive deep equal that is key-order INsensitive for objects and order
 * SENSITIVE for arrays. `null` is a distinct value (null !== missing/undefined).
 * Private — not exported.
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) return false;
  if (aArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) { if (!(k in b)) return false; if (!deepEqual(a[k], b[k])) return false; }
  return true;
}

/**
 * Deep equality on two values, ignoring any `_t` field at the top level.
 * Note: `_t` is stripped at the top level ONLY; records must not carry nested `_t`.
 * Key-order insensitive for objects (Firestore does not preserve nested map key order).
 */
export function equalIgnoringT(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const strip = (o) => { const { _t, ...rest } = o; return rest; };
  return deepEqual(strip(a), strip(b));
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
