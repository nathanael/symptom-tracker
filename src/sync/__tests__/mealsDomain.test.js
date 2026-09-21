import { describe, it, expect } from 'vitest';
import { DOMAINS, MAP_DOMAINS, storageKeyFor, isMonthSharded } from '../domains.js';
import { assembleDomainsFromDocs } from '../hydrate.js';
import { STORAGE_KEY_MEALS } from '../../utils/constants.js';

describe('meals domain', () => {
  it('is a month-sharded map domain', () => {
    expect(DOMAINS.meals).toEqual({
      storageKey: 'symptomTracker_meals',
      kind: 'map',
      sharding: 'month',
    });
    expect(MAP_DOMAINS).toContain('meals');
    expect(isMonthSharded('meals')).toBe(true);
    expect(storageKeyFor('meals')).toBe(STORAGE_KEY_MEALS);
  });

  it('hydrates from month docs under a `meals` field', () => {
    const { domains, shadow } = assembleDomainsFromDocs({}, {
      '2026-09': { meals: { '2026-09-21T12:41:07-ab12': { name: 'Wrap', ingredients: ['chicken'], _t: 5 } } },
      '2026-08': { meals: { '2026-08-02T08:00:00-cd34': { name: 'Eggs', ingredients: ['egg'], _t: 4 } } },
    });
    expect(Object.keys(domains.meals).sort()).toEqual([
      '2026-08-02T08:00:00-cd34',
      '2026-09-21T12:41:07-ab12',
    ]);
    expect(domains.meals['2026-09-21T12:41:07-ab12'].name).toBe('Wrap');
    expect(shadow.meals).toBeDefined();
  });

  it('keeps a tombstoned meal out of the app view but in the shadow', () => {
    const { domains, shadow, tombstones } = assembleDomainsFromDocs({}, {
      '2026-09': { meals: { '2026-09-21T12:41:07-ab12': { _deleted: true, _t: 9 } } },
    });
    expect(domains.meals).toEqual({});
    expect(shadow.meals['2026-09-21T12:41:07-ab12']).toEqual({ _deleted: true, _t: 9 });
    expect(tombstones.meals).toEqual({ '2026-09-21T12:41:07-ab12': 9 });
  });
});
