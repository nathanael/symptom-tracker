import { describe, it, expect } from 'vitest';
import { mergeBackupMeals } from '../mealBackup.js';

const meal = (name) => ({ time: '2026-09-21T12:00:00.000Z', name, ingredients: ['egg'], source: 'photo' });

describe('mergeBackupMeals', () => {
  it('adds meals the device does not have', () => {
    const { merged, added } = mergeBackupMeals({ a: meal('Have') }, { b: meal('New') });
    expect(Object.keys(merged).sort()).toEqual(['a', 'b']);
    expect(added).toBe(1);
  });

  it('never overwrites a meal already on the device', () => {
    const { merged, added } = mergeBackupMeals({ a: meal('Mine') }, { a: meal('Theirs') });
    expect(merged.a.name).toBe('Mine');
    expect(added).toBe(0);
  });

  it('tolerates a backup with no meals', () => {
    expect(mergeBackupMeals({ a: meal('Mine') }, undefined)).toEqual({ merged: { a: meal('Mine') }, added: 0 });
    expect(mergeBackupMeals({ a: meal('Mine') }, null).added).toBe(0);
    expect(mergeBackupMeals({ a: meal('Mine') }, 'junk').added).toBe(0);
  });

  it('tolerates empty current state', () => {
    const { merged, added } = mergeBackupMeals(undefined, { b: meal('New') });
    expect(merged).toEqual({ b: meal('New') });
    expect(added).toBe(1);
  });
});
