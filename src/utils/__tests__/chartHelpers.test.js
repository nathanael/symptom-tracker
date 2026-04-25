import { describe, it, expect } from 'vitest';
import { buildStepPath } from '../chartHelpers';

describe('buildStepPath', () => {
  it('returns empty string for empty input', () => {
    expect(buildStepPath([], 5)).toBe('');
  });

  it('returns single moveto for one point', () => {
    expect(buildStepPath([{ x: 10, y: 20 }], 5)).toBe('M10,20');
  });

  it('draws horizontal line for two equal-y points (no transition)', () => {
    const d = buildStepPath([{ x: 0, y: 50 }, { x: 100, y: 50 }], 5);
    expect(d).toBe('M0,50L100,50');
  });

  it('places the rounded transition at the midpoint between two points', () => {
    // dy=30, radius=10, big-elbow case. Transition is centered at x=50.
    const d = buildStepPath([{ x: 0, y: 50 }, { x: 100, y: 80 }], 10);
    expect(d).toBe('M0,50L40,50Q50,50,50,60L50,70Q50,80,60,80L100,80');
  });

  it('extends the plateau to cur.x after the post-corner so data points sit on the flat', () => {
    // Three points; the plateau at y=80 spans from the post-corner of the
    // first transition (60,80) all the way to cur.x at the second point (200,80).
    const d = buildStepPath([
      { x: 0, y: 50 }, { x: 100, y: 80 }, { x: 200, y: 80 },
    ], 10);
    expect(d).toBe('M0,50L40,50Q50,50,50,60L50,70Q50,80,60,80L100,80L200,80');
  });

  it('clamps horizontal radius when adjacent points are too close', () => {
    // dx=10, radius=20 → r clamps to dx/2=5; midpoint at x=5; dy=80 leaves
    // room for two separate elbows at the full vertical radius.
    const d = buildStepPath([
      { x: 0, y: 0 }, { x: 10, y: 80 }, { x: 20, y: 80 },
    ], 20);
    expect(d).toBe('M0,0L0,0Q5,0,5,20L5,60Q5,80,10,80L10,80L20,80');
  });

  it('uses an S-curve when vertical span is too small for two separate elbows', () => {
    // dy=10 with radius=20: the two elbows would overlap, so the transition
    // becomes a single cubic-Bézier S-curve centered on the midpoint x=50.
    const d = buildStepPath([
      { x: 0, y: 50 }, { x: 100, y: 60 }, { x: 200, y: 60 },
    ], 20);
    expect(d).toBe('M0,50L30,50C50,50,50,60,70,60L100,60L200,60');
  });

  it('uses an S-curve for a small step with no continuation', () => {
    const d = buildStepPath([{ x: 0, y: 50 }, { x: 100, y: 60 }], 20);
    expect(d).toBe('M0,50L30,50C50,50,50,60,70,60L100,60');
  });

  it('handles downward step (negative y direction)', () => {
    const d = buildStepPath([{ x: 0, y: 80 }, { x: 100, y: 50 }], 10);
    expect(d).toBe('M0,80L40,80Q50,80,50,70L50,60Q50,50,60,50L100,50');
  });

  it('rounds every transition independently for points at three distinct y values', () => {
    // First transition centered at x=50 (between 0 and 100), second at x=150
    // (between 100 and 200). Each plateau is bounded by its own pair of corners.
    const d = buildStepPath([{ x: 0, y: 50 }, { x: 100, y: 80 }, { x: 200, y: 60 }], 10);
    expect(d).toBe(
      'M0,50L40,50Q50,50,50,60L50,70Q50,80,60,80L100,80L140,80Q150,80,150,70L150,70Q150,60,160,60L200,60'
    );
  });

  it('breaks path on null y (no segment connection across gaps)', () => {
    const d = buildStepPath([
      { x: 0, y: 50 }, { x: 50, y: null }, { x: 100, y: 80 },
    ], 10);
    expect(d).toBe('M0,50M100,80');
  });
});
