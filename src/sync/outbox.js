// Durable offline outbox for the granular sync write path.
//
// SyncEngineV2 enqueues per-doc field updates in memory and debounce-flushes
// them. When a flush fails (offline), the in-memory re-queue alone is lost if
// the app reloads before reconnecting. This module persists failed writes to
// localStorage so they survive reload and replay on the next boot / reconnect.
//
// Each op record:
//   { id, docPath, updates: {fieldPath:value}, deletes: [fieldPath],
//     deleteBaseT: {fieldPath:number}, ts }
//
// Pure-ish: all localStorage access is guarded in try/catch — corrupt JSON is
// treated as an empty queue and never throws. The caller supplies `ts` (and we
// derive a deterministic id from it) so the module needs no clock of its own.

export const OUTBOX_KEY = 'symptomTracker_outbox_v2';
export const MAX_OPS = 500;

// A record counts as valid only if it carries the fields replay relies on.
function isValidOp(op) {
  return (
    op &&
    typeof op === 'object' &&
    typeof op.id === 'string' &&
    typeof op.docPath === 'string'
  );
}

// Read the raw array from storage, tolerating any corruption. Returns a fresh
// array of well-formed ops (oldest-first as stored); corrupt entries dropped.
function readRaw() {
  let raw;
  try {
    raw = localStorage.getItem(OUTBOX_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidOp);
}

function writeRaw(ops) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
  } catch {
    // Storage full / unavailable — nothing we can durably do; do not throw.
  }
}

/**
 * Append an op to the outbox. The caller supplies `ts` (engine clock) so this
 * stays deterministic/testable. Returns the stored op (with an assigned id).
 * Bounds the queue to MAX_OPS, dropping the OLDEST overflow with a warning.
 */
export function enqueueOp({ docPath, updates = {}, deletes = [], deleteBaseT = {}, ts }) {
  const ops = readRaw();
  // Monotonic-ish id from the caller's ts plus a per-queue tiebreaker so two
  // ops enqueued at the same ts still get distinct ids.
  const id = `${ts}-${ops.length}-${Math.random().toString(36).slice(2, 8)}`;
  const op = { id, docPath, updates, deletes, deleteBaseT, ts };
  ops.push(op);

  if (ops.length > MAX_OPS) {
    const dropped = ops.length - MAX_OPS;
    ops.splice(0, dropped); // drop oldest
    console.warn(`[outbox] queue exceeded ${MAX_OPS}; dropped ${dropped} oldest op(s)`);
  }

  writeRaw(ops);
  return op;
}

/** All ops, oldest-first; corrupt entries skipped. */
export function listOps() {
  return readRaw();
}

/** Remove the op with the given id. */
export function removeOp(id) {
  const ops = readRaw();
  const next = ops.filter((o) => o.id !== id);
  if (next.length !== ops.length) writeRaw(next);
}

/** Empty the outbox. */
export function clearOutbox() {
  try {
    localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // ignore
  }
}
