import { buildFieldPathPayload } from './firestoreRest';

const PROJECT_ID = 'symptoms-dae26';
const DEFAULT_TIMEOUT_MS = 8000;

/** Split a dotted field path into raw, unquoted segments. */
function pathToSegments(dotted) {
  return dotted.split('.');
}

/**
 * Build a nested plain object from dotted update paths, for use as a
 * set(..., { merge: true }) body when creating a not-yet-existing doc.
 * e.g. { 'entries.k': v } -> { entries: { k: v } }
 */
function buildNestedSetObject(updates) {
  const out = {};
  for (const [dotted, value] of Object.entries(updates)) {
    const segments = pathToSegments(dotted);
    let cursor = out;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (i === segments.length - 1) {
        cursor[seg] = value;
      } else {
        if (typeof cursor[seg] !== 'object' || cursor[seg] === null) {
          cursor[seg] = {};
        }
        cursor = cursor[seg];
      }
    }
  }
  return out;
}

/**
 * Write/delete specific nested field paths on a single Firestore document.
 *
 * Atomic, granular write mechanism for the new sync. Never writes a whole
 * blob — only the supplied field paths. Robust on Safari: if the Firestore
 * SDK streaming channel hangs, falls back to the REST API.
 *
 * @param {Object} docRef - Firestore document reference (.update/.set/.path).
 * @param {Object} payload
 * @param {Object} payload.updates - dotted field path -> JS value to write.
 * @param {string[]} payload.deletes - dotted field paths to delete.
 * @param {Object} opts
 * @param {number} opts.timeoutMs - SDK update timeout before REST fallback.
 * @returns {Promise<Object>} one of:
 *   { ok:true, skipped:true } | { ok:true, via:'sdk'|'set-merge'|'rest' } |
 *   { ok:false, error }
 */
export async function writeFieldUpdates(docRef, { updates = {}, deletes = [] } = {}, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const updateKeys = Object.keys(updates);

  // 1. Nothing to do.
  if (updateKeys.length === 0 && deletes.length === 0) {
    return { ok: true, skipped: true };
  }

  const fb = window.firebase;
  const { FieldPath, FieldValue } = fb.firestore;

  // 2. Build the SDK varargs: (FieldPath, value, FieldPath, value, ...).
  const sdkArgs = [];
  for (const dotted of updateKeys) {
    sdkArgs.push(new FieldPath(...pathToSegments(dotted)), updates[dotted]);
  }
  for (const dotted of deletes) {
    sdkArgs.push(new FieldPath(...pathToSegments(dotted)), FieldValue.delete());
  }

  // Race the SDK update against a timeout. Resolve with a tagged outcome so we
  // can tell apart success, rejection (and its error), and timeout.
  let timer;
  const outcome = await Promise.race([
    docRef
      .update(...sdkArgs)
      .then(() => ({ status: 'ok' }))
      .catch(err => ({ status: 'error', err })),
    new Promise(resolve => {
      timer = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
    }),
  ]);
  clearTimeout(timer);

  // 3. SDK success.
  if (outcome.status === 'ok') {
    return { ok: true, via: 'sdk' };
  }

  // 4. Not-found -> the doc doesn't exist yet. Create it via set(merge).
  //    Deletes are skipped when creating (nothing to delete in a new doc).
  if (outcome.status === 'error' && outcome.err && outcome.err.code === 'not-found') {
    try {
      await docRef.set(buildNestedSetObject(updates), { merge: true });
      return { ok: true, via: 'set-merge' };
    } catch (err) {
      // set() failed too -> fall through to REST below.
      return restFallback(docRef, updates, deletes);
    }
  }

  // 5. Generic error or timeout -> REST fallback.
  return restFallback(docRef, updates, deletes);
}

/** PATCH the document via the Firestore REST API with an updateMask. */
async function restFallback(docRef, updates, deletes) {
  try {
    const token = await window.firebase.auth().currentUser.getIdToken();
    const { fields, mask } = buildFieldPathPayload(updates, deletes);

    const maskQuery = mask
      .map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`)
      .join('&');
    const url =
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}` +
      `/databases/(default)/documents/${docRef.path}?${maskQuery}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });

    if (response.ok) {
      return { ok: true, via: 'rest' };
    }
    throw new Error('REST PATCH ' + response.status);
  } catch (err) {
    // 6. REST failed too -> let the caller (outbox) decide. Do not throw.
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}
