/** Convert a Firestore REST API value back to a JS value. */
export function firestoreValueToJs(value) {
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
export function jsToFirestoreValue(value) {
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

/**
 * Backtick-quote any dotted field-path segment that is not a simple
 * identifier (i.e. does not match /^[A-Za-z_][A-Za-z0-9_]*$/). Real
 * Firestore field paths require segments containing special characters
 * (hyphens, leading digits, etc.) to be wrapped in backticks in the
 * updateMask.fieldPaths query.
 */
export function quoteFieldPath(dotted) {
  return dotted
    .split('.')
    .map(seg => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(seg) ? seg : `\`${seg}\``))
    .join('.');
}

/**
 * Build a Firestore REST PATCH payload for writing/deleting specific nested
 * fields via updateMask.fieldPaths.
 *
 * @param {Object} updates - dotted field path -> JS value to write.
 * @param {string[]} deletes - dotted field paths to delete.
 * @returns {{ fields: Object, mask: string[] }}
 *   - mask: all field paths (updates first in key order, then deletes), quoted.
 *   - fields: nested Firestore-format document body. Update paths build a
 *     nested mapValue structure keyed by raw segment names. Delete paths are
 *     present in the mask but absent from fields (REST: masked path with no
 *     value = delete).
 */
export function buildFieldPathPayload(updates = {}, deletes = []) {
  const fields = {};
  const mask = [];

  for (const [dotted, value] of Object.entries(updates)) {
    mask.push(quoteFieldPath(dotted));
    const segments = dotted.split('.');
    let cursor = fields;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      if (isLast) {
        cursor[seg] = jsToFirestoreValue(value);
      } else {
        if (!cursor[seg]) {
          cursor[seg] = { mapValue: { fields: {} } };
        }
        cursor = cursor[seg].mapValue.fields;
      }
    }
  }

  for (const dotted of deletes) {
    mask.push(quoteFieldPath(dotted));
  }

  return { fields, mask };
}
