import { describe, it, expect } from 'vitest';
import { assembleDomainsFromDocs } from '../hydrate';

// monthDocs input shape: an ARRAY of { id, data } where `id` is the YYYY-MM
// month string and `data` is the month doc's fields object. Each `data` may
// carry `entries`/`stackEntries`/`inputEntries`/`notes` maps.

describe('assembleDomainsFromDocs', () => {
  it('flattens two month docs into one entries map (keys from both months present)', () => {
    const monthDocs = [
      { id: '2026-04', data: { entries: { '2026-04-10-a': { severity: 1, _t: 1 } } } },
      { id: '2026-05', data: { entries: { '2026-05-01-x': { severity: 2, _t: 2 } } } },
    ];
    const { domains } = assembleDomainsFromDocs(null, monthDocs);
    expect(Object.keys(domains.entries).sort()).toEqual(['2026-04-10-a', '2026-05-01-x']);
    expect(domains.entries['2026-04-10-a'].severity).toBe(1);
    expect(domains.entries['2026-05-01-x'].severity).toBe(2);
  });

  it('maps the `notes` month-doc field to domains.dailyNotes', () => {
    const monthDocs = [
      { id: '2026-05', data: { notes: { '2026-05-01': { text: 'hi', _t: 3 } } } },
    ];
    const { domains, shadow } = assembleDomainsFromDocs(null, monthDocs);
    expect(domains.dailyNotes['2026-05-01'].text).toBe('hi');
    expect(domains.notes).toBeUndefined();
    expect(shadow.dailyNotes['2026-05-01'].text).toBe('hi');
  });

  it('flattens stackEntries and inputEntries across months too', () => {
    const monthDocs = [
      { id: '2026-04', data: { stackEntries: { '2026-04-01-s': { v: 1 } }, inputEntries: { '2026-04-01-i': { v: 2 } } } },
      { id: '2026-05', data: { stackEntries: { '2026-05-01-s': { v: 3 } } } },
    ];
    const { domains } = assembleDomainsFromDocs(null, monthDocs);
    expect(Object.keys(domains.stackEntries).sort()).toEqual(['2026-04-01-s', '2026-05-01-s']);
    expect(Object.keys(domains.inputEntries)).toEqual(['2026-04-01-i']);
  });

  it('converts definition id-maps to arrays via idMapToArray (respecting order)', () => {
    const definitionsDoc = {
      symptoms: {
        b: { id: 'b', order: 1, name: 'Beta' },
        a: { id: 'a', order: 0, name: 'Alpha' },
      },
      stackItems: { s1: { id: 's1', name: 'Stack' } },
      inputItems: { i1: { id: 'i1', name: 'Input' } },
    };
    const { domains } = assembleDomainsFromDocs(definitionsDoc, []);
    expect(Array.isArray(domains.symptoms)).toBe(true);
    expect(domains.symptoms.map((s) => s.id)).toEqual(['a', 'b']); // order 0 before 1
    expect(domains.stackItems.map((s) => s.id)).toEqual(['s1']);
    expect(domains.inputItems.map((s) => s.id)).toEqual(['i1']);
  });

  it('keeps shadow.symptoms as the id-keyed map form (not the array)', () => {
    const definitionsDoc = {
      symptoms: { a: { id: 'a', name: 'Alpha', _t: 7 }, b: { id: 'b', name: 'Beta', _t: 8 } },
    };
    const { domains, shadow } = assembleDomainsFromDocs(definitionsDoc, []);
    expect(Array.isArray(domains.symptoms)).toBe(true);
    expect(Array.isArray(shadow.symptoms)).toBe(false);
    expect(shadow.symptoms).toEqual({
      a: { id: 'a', name: 'Alpha', _t: 7 },
      b: { id: 'b', name: 'Beta', _t: 8 },
    });
  });

  it('passes pinnedSymptoms through as an array', () => {
    const definitionsDoc = { pinnedSymptoms: ['a', 'b'] };
    const { domains, shadow } = assembleDomainsFromDocs(definitionsDoc, []);
    expect(domains.pinnedSymptoms).toEqual(['a', 'b']);
    expect(shadow.pinnedSymptoms).toEqual(['a', 'b']);
  });

  it('unwraps trackingMode {value,_t} to a string', () => {
    const { domains } = assembleDomainsFromDocs({ trackingMode: { value: 'daily', _t: 5 } }, []);
    expect(domains.trackingMode).toBe('daily');
  });

  it('passes a plain string trackingMode through', () => {
    const { domains } = assembleDomainsFromDocs({ trackingMode: 'ampm' }, []);
    expect(domains.trackingMode).toBe('ampm');
  });

  it('omits trackingMode entirely when absent (no invented default)', () => {
    const { domains } = assembleDomainsFromDocs({}, []);
    expect('trackingMode' in domains).toBe(false);
  });

  it('defaults missing domains correctly ({} for maps, [] for id arrays + pinned)', () => {
    const { domains } = assembleDomainsFromDocs(null, []);
    expect(domains.entries).toEqual({});
    expect(domains.stackEntries).toEqual({});
    expect(domains.inputEntries).toEqual({});
    expect(domains.dailyNotes).toEqual({});
    expect(domains.symptoms).toEqual([]);
    expect(domains.stackItems).toEqual([]);
    expect(domains.inputItems).toEqual([]);
    expect(domains.pinnedSymptoms).toEqual([]);
  });

  it('retains _t on a record in BOTH domains and shadow', () => {
    const monthDocs = [{ id: '2026-05', data: { entries: { '2026-05-01-x': { severity: 2, _t: 42 } } } }];
    const { domains, shadow } = assembleDomainsFromDocs(null, monthDocs);
    expect(domains.entries['2026-05-01-x']._t).toBe(42);
    expect(shadow.entries['2026-05-01-x']._t).toBe(42);
  });

  it('shadow map domains equal the flat domains map (with _t)', () => {
    const monthDocs = [{ id: '2026-05', data: { entries: { '2026-05-01-x': { severity: 2, _t: 42 } } } }];
    const { domains, shadow } = assembleDomainsFromDocs(null, monthDocs);
    expect(shadow.entries).toEqual(domains.entries);
  });

  it('handles null definitionsDoc and empty monthDocs without throwing', () => {
    expect(() => assembleDomainsFromDocs(null, [])).not.toThrow();
    const { domains, shadow } = assembleDomainsFromDocs(null, []);
    expect(domains.entries).toEqual({});
    expect(domains.symptoms).toEqual([]);
    expect(shadow.symptoms).toEqual({});
    expect(shadow.entries).toEqual({});
  });

  it('also accepts monthDocs as an object map { monthId: data }', () => {
    const monthDocs = {
      '2026-04': { entries: { '2026-04-10-a': { severity: 1 } } },
      '2026-05': { entries: { '2026-05-01-x': { severity: 2 } } },
    };
    const { domains } = assembleDomainsFromDocs(null, monthDocs);
    expect(Object.keys(domains.entries).sort()).toEqual(['2026-04-10-a', '2026-05-01-x']);
  });
});
