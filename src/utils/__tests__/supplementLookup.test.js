import { describe, it, expect } from 'vitest';
import { CATEGORY_HALF_LIVES, matchSupplementCategory } from '../supplementLookup';

describe('CATEGORY_HALF_LIVES', () => {
  it('has fast, moderate, slow categories with correct half-lives in days', () => {
    expect(CATEGORY_HALF_LIVES.fast).toBe(0.5);
    expect(CATEGORY_HALF_LIVES.moderate).toBe(3);
    expect(CATEGORY_HALF_LIVES.slow).toBe(21);
  });
});

describe('matchSupplementCategory', () => {
  it('matches exact supplement names (case-insensitive)', () => {
    expect(matchSupplementCategory('Vitamin D')).toBe('slow');
    expect(matchSupplementCategory('vitamin d')).toBe('slow');
    expect(matchSupplementCategory('MAGNESIUM')).toBe('moderate');
  });

  it('matches partial/abbreviated names via token overlap', () => {
    expect(matchSupplementCategory('Vit D3 5000IU')).toBe('slow');
    expect(matchSupplementCategory('Mag Glycinate 400mg')).toBe('moderate');
  });

  it('matches common supplement variations', () => {
    expect(matchSupplementCategory('Vitamin C')).toBe('fast');
    expect(matchSupplementCategory('Vitamin K2')).toBe('slow');
    expect(matchSupplementCategory('Zinc')).toBe('moderate');
    expect(matchSupplementCategory('Fish Oil')).toBe('slow');
    expect(matchSupplementCategory('Caffeine')).toBe('fast');
    expect(matchSupplementCategory('B12')).toBe('fast');
  });

  it('returns null for unknown supplements', () => {
    expect(matchSupplementCategory('Mystery Powder')).toBeNull();
    expect(matchSupplementCategory('XYZ-1234')).toBeNull();
  });

  it('handles empty/null input gracefully', () => {
    expect(matchSupplementCategory('')).toBeNull();
    expect(matchSupplementCategory(null)).toBeNull();
    expect(matchSupplementCategory(undefined)).toBeNull();
  });
});
