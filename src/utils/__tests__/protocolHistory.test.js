import { describe, it, expect } from 'vitest';
import { applySupplementPatch, applyInputPatch, formatSupplementChange, formatInputChange, nextDueLabel } from '../protocolHistory';

describe('applySupplementPatch', () => {
  const item = { id: 'zinc', name: 'Zinc', defaultDose: 18, unit: 'mg', description: '', schedule: { type: 'daily' }, active: true, history: [] };
  it('records a history entry for tracked fields', () => {
    const next = applySupplementPatch(item, { defaultDose: 30 });
    expect(next.defaultDose).toBe(30);
    expect(next.history).toHaveLength(1);
    expect(next.history[0].changes.defaultDose).toEqual({ from: 18, to: 30 });
    expect(formatSupplementChange(next.history[0], 'mg')).toBe('Dose: 18mg → 30mg');
  });
  it('records nothing for untracked or unchanged fields', () => {
    expect(applySupplementPatch(item, { halfLifeCategory: 'fast' }).history).toHaveLength(0);
    expect(applySupplementPatch(item, { name: 'Zinc' }).history).toHaveLength(0);
  });
});

describe('applyInputPatch', () => {
  const item = { id: 'alcohol', name: 'Alcohol', description: '', category: 'substance', verdict: null, active: true, history: [] };
  it('stamps verdictDate only when the verdict changes', () => {
    const next = applyInputPatch(item, { verdict: 'bad' });
    expect(next.verdictDate).toBeTruthy();
    expect(formatInputChange(next.history[0])).toBe('Verdict: none → bad');
    const renamed = applyInputPatch(item, { name: 'Booze' });
    expect(renamed.verdictDate).toBeUndefined();
    expect(formatInputChange(renamed.history[0])).toBe('Name: Alcohol → Booze');
  });
  it('treats null and undefined verdicts as the same', () => {
    expect(applyInputPatch({ ...item, verdict: undefined }, { verdict: null }).history).toHaveLength(0);
  });
});

describe('nextDueLabel', () => {
  const wed = new Date(2026, 8, 16); // Wed Sep 16 2026
  it('finds the next interval day', () => {
    expect(nextDueLabel({ type: 'interval', interval: 5, startDate: '2026-09-14' }, wed)).toBe('Sat');
  });
  it('says Tomorrow for the next day and a date beyond a week', () => {
    expect(nextDueLabel({ type: 'days', days: [4] }, wed)).toBe('Tomorrow');
    expect(nextDueLabel({ type: 'interval', interval: 30, startDate: '2026-09-15' }, wed)).toBe('Oct 15');
  });
  it('returns null when nothing is scheduled', () => {
    expect(nextDueLabel({ type: 'days', days: [] }, wed)).toBe(null);
  });
});
