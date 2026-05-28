import { describe, it, expect } from 'vitest';
import { firestoreValueToJs, jsToFirestoreValue, buildFieldPathPayload, quoteFieldPath } from '../firestoreRest';

describe('value round-trip', () => {
  it('round-trips a nested record', () => {
    const v = { severity: 2, time: 'morning', nested: { a: 1 }, flag: true, missing: null };
    expect(firestoreValueToJs(jsToFirestoreValue(v))).toEqual(v);
  });
  it('encodes integers as integerValue strings', () => {
    expect(jsToFirestoreValue(5)).toEqual({ integerValue: '5' });
  });
});

describe('quoteFieldPath', () => {
  it('backtick-quotes segments with hyphens', () => {
    expect(quoteFieldPath('entries.2026-05-28-flushing-morning'))
      .toBe('entries.`2026-05-28-flushing-morning`');
  });
  it('leaves plain segments unquoted', () => {
    expect(quoteFieldPath('trackingMode')).toBe('trackingMode');
  });
});

describe('buildFieldPathPayload', () => {
  it('builds nested fields and a mask for updates', () => {
    const { fields, mask } = buildFieldPathPayload(
      { 'entries.2026-05-28-x': { severity: 2 } }, []);
    expect(mask).toEqual(['entries.`2026-05-28-x`']);
    expect(fields).toEqual({
      entries: { mapValue: { fields: {
        '2026-05-28-x': { mapValue: { fields: { severity: { integerValue: '2' } } } },
      } } },
    });
  });
  it('puts deletes in the mask but not in fields', () => {
    const { fields, mask } = buildFieldPathPayload({}, ['entries.2026-05-28-gone']);
    expect(mask).toEqual(['entries.`2026-05-28-gone`']);
    expect(fields).toEqual({});
  });
  it('merges multiple update paths under the same top key', () => {
    const { fields } = buildFieldPathPayload(
      { 'entries.a': { s: 1 }, 'entries.b': { s: 2 } }, []);
    expect(Object.keys(fields.entries.mapValue.fields)).toEqual(['a', 'b']);
  });
});
