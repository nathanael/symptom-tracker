import { describe, it, expect } from 'vitest';
import { symptomsLogged, mealsLogged, supplementsTaken, summaryLines } from '../homeSummary';

const DAY = new Date(2026, 8, 22);        // 2026-09-22, a Tuesday
const OTHER = new Date(2026, 8, 21);

const entries = {
  '2026-09-22-head-ache-am': { date: '2026-09-22', symptomId: 'head-ache', time: 'am', severity: 3 },
  '2026-09-22-head-ache-pm': { date: '2026-09-22', symptomId: 'head-ache', time: 'pm', severity: 2 },
  '2026-09-21-head-ache-am': { date: '2026-09-21', symptomId: 'head-ache', time: 'am', severity: 1 },
};

const meals = {
  '2026-09-22T08:15:00-a1b2': { name: 'porridge', ingredients: ['oats'] },
  '2026-09-22T13:40:00-c3d4': { name: 'salad', ingredients: ['lettuce'] },
  '2026-09-21T19:02:00-e5f6': { name: 'curry', ingredients: ['rice'] },
};

const stackItems = [
  { id: 'd3', name: 'D3', defaultDose: 5000, active: true },
  { id: 'b2', name: 'B2', defaultDose: 250, active: true },
  { id: 'zinc', name: 'Zinc', defaultDose: 15, active: false },                       // inactive
  { id: 'iron', name: 'Iron', defaultDose: 20, active: true,
    schedule: { type: 'days', days: [1] } },                                          // Mondays only
];

const stackEntries = {
  '2026-09-22-d3': { date: '2026-09-22', itemId: 'd3', dose: 5000, taken: true },
  '2026-09-22-zinc': { date: '2026-09-22', itemId: 'zinc', dose: 15, taken: true },    // inactive item
};

describe('symptomsLogged', () => {
  it('counts entries recorded on the date', () => {
    expect(symptomsLogged(entries, DAY)).toBe(2);
  });

  it('counts a different date independently', () => {
    expect(symptomsLogged(entries, OTHER)).toBe(1);
  });

  it('is zero for an empty or missing store', () => {
    expect(symptomsLogged({}, DAY)).toBe(0);
    expect(symptomsLogged(undefined, DAY)).toBe(0);
  });
});

describe('mealsLogged', () => {
  it('counts meals whose key falls on the date', () => {
    expect(mealsLogged(meals, DAY)).toBe(2);
    expect(mealsLogged(meals, OTHER)).toBe(1);
  });

  it('is zero for an empty or missing store', () => {
    expect(mealsLogged({}, DAY)).toBe(0);
    expect(mealsLogged(undefined, DAY)).toBe(0);
  });
});

describe('supplementsTaken', () => {
  it('counts only active items scheduled for the date', () => {
    // D3 and B2 are due; Zinc is inactive; Iron is Mondays and the 22nd is a Tuesday.
    expect(supplementsTaken(stackItems, stackEntries, DAY)).toEqual({ taken: 1, due: 2 });
  });

  it('does not let an entry for a non-due item inflate taken past due', () => {
    const { taken, due } = supplementsTaken(stackItems, stackEntries, DAY);
    expect(taken).toBeLessThanOrEqual(due);
  });

  it('reports zero due when nothing is active', () => {
    expect(supplementsTaken([{ id: 'x', name: 'X', active: false }], {}, DAY))
      .toEqual({ taken: 0, due: 0 });
  });

  it('is safe on missing stores', () => {
    expect(supplementsTaken(undefined, undefined, DAY)).toEqual({ taken: 0, due: 0 });
  });

  it('counts a due item whose entry has taken: false', () => {
    // A merged/restored backup can carry `taken: false` on a key that still exists — presence
    // of the key is what SimpleProtocol and ProtocolRows check, so this must count as taken too.
    const entries = {
      '2026-09-22-d3': { date: '2026-09-22', itemId: 'd3', dose: 5000, taken: false },
    };
    expect(supplementsTaken(stackItems, entries, DAY)).toEqual({ taken: 1, due: 2 });
  });

  it('counts a due item whose entry has no taken field at all', () => {
    const entries = {
      '2026-09-22-d3': { date: '2026-09-22', itemId: 'd3', dose: 5000 },
    };
    expect(supplementsTaken(stackItems, entries, DAY)).toEqual({ taken: 1, due: 2 });
  });
});

describe('summaryLines', () => {
  it('phrases each line', () => {
    expect(summaryLines({ entries, meals, stackItems, stackEntries, date: DAY })).toEqual({
      symptoms: '2 logged today',
      meals: '2 meals',
      supplements: '1 of 2 taken',
    });
  });

  it('singularises one meal', () => {
    const one = { '2026-09-22T08:15:00-a1b2': { name: 'porridge' } };
    expect(summaryLines({ entries: {}, meals: one, stackItems: [], stackEntries: {}, date: DAY }).meals)
      .toBe('1 meal');
  });

  it('is silent on a fresh day so the cards stay clean', () => {
    expect(summaryLines({ entries: {}, meals: {}, stackItems, stackEntries: {}, date: DAY })).toEqual({
      symptoms: null,
      meals: null,
      supplements: null,
    });
  });
});
