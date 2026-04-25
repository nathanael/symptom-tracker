import { describe, it, expect } from 'vitest';
import { buildStepPath } from '../chartHelpers';

describe('buildStepPath', () => {
  it('returns empty string for empty input', () => {
    expect(buildStepPath([], 5)).toBe('');
  });

  it('returns single moveto for one point', () => {
    expect(buildStepPath([{ x: 10, y: 20 }], 5)).toBe('M10,20');
  });

  it('draws horizontal line for two equal-y points (no corner needed)', () => {
    const d = buildStepPath([{ x: 0, y: 50 }, { x: 100, y: 50 }], 5);
    expect(d).toBe('M0,50L100,50');
  });

  it('produces step-before path with rounded corners on dose change', () => {
    const d = buildStepPath([{ x: 0, y: 50 }, { x: 100, y: 80 }], 10);
    expect(d).toBe('M0,50L90,50Q100,50,100,60L100,80');
  });

  it('rounds both elbows when there is a horizontal continuation after the step', () => {
    const d = buildStepPath([
      { x: 0, y: 50 }, { x: 100, y: 80 }, { x: 200, y: 80 },
    ], 10);
    expect(d).toBe('M0,50L90,50Q100,50,100,60L100,70Q100,80,110,80L200,80');
  });

  it('clamps radius to half the shorter adjacent segment', () => {
    const d = buildStepPath([
      { x: 0, y: 50 }, { x: 10, y: 80 }, { x: 20, y: 80 },
    ], 20);
    expect(d).toBe('M0,50L5,50Q10,50,10,55L10,75Q10,80,15,80L20,80');
  });

  it('handles downward step (negative y direction)', () => {
    const d = buildStepPath([{ x: 0, y: 80 }, { x: 100, y: 50 }], 10);
    expect(d).toBe('M0,80L90,80Q100,80,100,70L100,50');
  });

  it('breaks path on null y (no segment connection across gaps)', () => {
    const d = buildStepPath([
      { x: 0, y: 50 }, { x: 50, y: null }, { x: 100, y: 80 },
    ], 10);
    expect(d).toBe('M0,50M100,80');
  });
});
