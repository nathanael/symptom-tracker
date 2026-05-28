import { describe, it, expect } from 'vitest';
import { DOMAINS, MAP_DOMAINS, DEFINITION_DOMAINS, storageKeyFor, isMonthSharded } from '../domains';

describe('domains config', () => {
  it('lists all nine sync domains', () => {
    expect(Object.keys(DOMAINS).sort()).toEqual([
      'dailyNotes','entries','inputEntries','inputItems','pinnedSymptoms',
      'stackEntries','stackItems','symptoms','trackingMode',
    ]);
  });
  it('classifies month-sharded map domains', () => {
    expect(MAP_DOMAINS).toEqual(
      expect.arrayContaining(['entries','stackEntries','inputEntries','dailyNotes']));
    ['entries','stackEntries','inputEntries','dailyNotes'].forEach(d =>
      expect(isMonthSharded(d)).toBe(true));
    expect(isMonthSharded('symptoms')).toBe(false);
  });
  it('classifies definition domains', () => {
    expect(DEFINITION_DOMAINS).toEqual(
      expect.arrayContaining(['symptoms','stackItems','inputItems','pinnedSymptoms','trackingMode']));
  });
  it('maps domains to their localStorage keys', () => {
    expect(storageKeyFor('entries')).toBe('symptomTracker_entries');
    expect(storageKeyFor('dailyNotes')).toBe('symptomTracker_notes');
  });
});
