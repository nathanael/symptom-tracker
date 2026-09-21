import { describe, it, expect } from 'vitest';
import { normalizeMeal } from '../mealParse.js';

describe('normalizeMeal', () => {
  it('keeps a well-formed reply', () => {
    expect(normalizeMeal({ name: 'Chicken caesar wrap', ingredients: ['chicken', 'romaine'] }))
      .toEqual({ name: 'Chicken caesar wrap', ingredients: ['chicken', 'romaine'] });
  });

  it('trims and lowercases ingredients but not the name', () => {
    expect(normalizeMeal({ name: '  Greek Salad  ', ingredients: ['  Feta ', 'OLIVE OIL'] }))
      .toEqual({ name: 'Greek Salad', ingredients: ['feta', 'olive oil'] });
  });

  it('de-duplicates case-insensitively, keeping first order', () => {
    expect(normalizeMeal({ name: 'x', ingredients: ['Egg', 'egg', 'butter', 'EGG'] }).ingredients)
      .toEqual(['egg', 'butter']);
  });

  it('drops empty and whitespace-only ingredients', () => {
    expect(normalizeMeal({ name: 'x', ingredients: ['egg', '', '   ', null, 'butter'] }).ingredients)
      .toEqual(['egg', 'butter']);
  });

  it('caps the list at 40 items', () => {
    const many = Array.from({ length: 60 }, (_, i) => `item${i}`);
    expect(normalizeMeal({ name: 'x', ingredients: many }).ingredients).toHaveLength(40);
  });

  it('caps the name at 80 characters', () => {
    expect(normalizeMeal({ name: 'a'.repeat(200), ingredients: [] }).name).toHaveLength(80);
  });

  it('coerces non-string ingredients to strings', () => {
    expect(normalizeMeal({ name: 'x', ingredients: [42, 'egg'] }).ingredients).toEqual(['42', 'egg']);
  });

  it('returns an empty meal for junk input', () => {
    const empty = { name: '', ingredients: [] };
    expect(normalizeMeal(null)).toEqual(empty);
    expect(normalizeMeal(undefined)).toEqual(empty);
    expect(normalizeMeal('a string')).toEqual(empty);
    expect(normalizeMeal(42)).toEqual(empty);
    expect(normalizeMeal([])).toEqual(empty);
    expect(normalizeMeal({})).toEqual(empty);
    expect(normalizeMeal({ name: 'x', ingredients: 'not an array' })).toEqual({ name: 'x', ingredients: [] });
  });

  it('survives object with throwing name getter', () => {
    const poisoned = {
      get name() { throw new Error('boom'); },
      ingredients: ['egg']
    };
    expect(normalizeMeal(poisoned)).toEqual({ name: '', ingredients: ['egg'] });
  });

  it('survives object with throwing ingredients getter', () => {
    const poisoned = {
      name: 'Salad',
      get ingredients() { throw new Error('boom'); }
    };
    expect(normalizeMeal(poisoned)).toEqual({ name: 'Salad', ingredients: [] });
  });

  it('skips ingredients that throw on toString', () => {
    const poisoned = {
      toString() { throw new Error('boom'); }
    };
    const result = normalizeMeal({
      name: 'x',
      ingredients: [42, poisoned, 'egg']
    });
    expect(result).toEqual({ name: 'x', ingredients: ['42', 'egg'] });
  });

  it('handles Object.create(null)', () => {
    const nullProto = Object.create(null);
    expect(normalizeMeal(nullProto)).toEqual({ name: '', ingredients: [] });
  });
});
