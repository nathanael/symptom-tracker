import { describe, it, expect } from 'vitest';
import { computeLevels, getLevelColor, computeInsight } from '../insightHelpers';

describe('computeLevels', () => {
  const weekDates = [
    '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26',
    '2026-03-27', '2026-03-28', '2026-03-29',
  ];

  it('returns 7 daily segments for W (7-day) timeframe', () => {
    const values = [100, 200, 150, 300, 250, 200, 100];
    const levels = computeLevels(values, weekDates, 7);
    expect(levels).toHaveLength(7);
    expect(levels[0].average).toBe(100);
    expect(levels[1].average).toBe(200);
    expect(levels[0].percentChange).toBeNull();
    expect(levels[1].percentChange).toBeCloseTo(100);
  });

  it('returns ~4 weekly segments for M (30-day) timeframe', () => {
    const dates = [];
    for (let d = 1; d <= 30; d++) {
      dates.push(`2026-03-${String(d).padStart(2, '0')}`);
    }
    const values = Array(30).fill(500);
    const levels = computeLevels(values, dates, 30);
    expect(levels.length).toBeGreaterThanOrEqual(4);
    expect(levels.length).toBeLessThanOrEqual(5);
    levels.forEach(l => expect(l.average).toBe(500));
  });

  it('returns 6 monthly segments for 6M (180-day) timeframe', () => {
    const dates = [];
    const start = new Date('2025-10-02T12:00:00');
    for (let i = 0; i < 180; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    const values = dates.map(ds => {
      const monthIdx = parseInt(ds.slice(5, 7)) - 10;
      const adjustedIdx = monthIdx < 0 ? monthIdx + 12 : monthIdx;
      return (adjustedIdx + 1) * 100;
    });
    const levels = computeLevels(values, dates, 180);
    expect(levels).toHaveLength(6);
    expect(levels[0].percentChange).toBeNull();
    expect(levels[1].percentChange).not.toBeNull();
  });

  it('excludes nulls from average calculation', () => {
    const values = [100, null, null, 200, 150, null, 300];
    const levels = computeLevels(values, weekDates, 7);
    expect(levels).toHaveLength(7);
    expect(levels[0].average).toBe(100);
    expect(levels[1].average).toBeNull();
    expect(levels[3].average).toBe(200);
  });

  it('omits segments with fewer than 2 data points for M/6M', () => {
    const dates = [];
    for (let d = 2; d <= 31; d++) {
      dates.push(`2026-03-${String(d).padStart(2, '0')}`);
    }
    const values = dates.map((ds) => {
      if (ds === '2026-03-30') return null;
      if (ds === '2026-03-31') return 100;
      return 500;
    });
    const levels = computeLevels(values, dates, 30);
    const lastLevel = levels[levels.length - 1];
    expect(lastLevel.endIdx).toBeLessThan(dates.length - 1);
  });
});

describe('getLevelColor', () => {
  it('returns green for favorable supplement increase', () => {
    expect(getLevelColor(10, false)).toBe('#34d399');
  });
  it('returns yellow for unfavorable supplement decrease', () => {
    expect(getLevelColor(-10, false)).toBe('#d4a017');
  });
  it('returns green for favorable symptom decrease', () => {
    expect(getLevelColor(-10, true)).toBe('#34d399');
  });
  it('returns yellow for unfavorable symptom increase', () => {
    expect(getLevelColor(10, true)).toBe('#d4a017');
  });
  it('returns grey for near-zero change (< 2%)', () => {
    expect(getLevelColor(1.5, false)).toBe('#9ca3af');
    expect(getLevelColor(-0.5, true)).toBe('#9ca3af');
  });
  it('returns grey for null', () => {
    expect(getLevelColor(null, false)).toBe('#9ca3af');
  });
});

describe('computeInsight', () => {
  it('generates insight text for supplement primary', () => {
    const result = computeInsight(
      { name: 'Vitamin D', average: 2000, priorAverage: 1800, unit: 'IU', isSymptom: false },
      [{ name: 'Fatigue', average: 3.2, priorAverage: 3.5, unit: '/5', isSymptom: true }],
      { timeframeLabel: '6 months' }
    );
    expect(result.percentChange).toBeCloseTo(11.1, 0);
    expect(result.insightText).toContain('Vitamin D');
    expect(result.insightText).toContain('2000');
    expect(result.insightText).toContain('above');
    expect(result.insightText).toContain('favorable');
  });

  it('generates insight text for symptom primary', () => {
    const result = computeInsight(
      { name: 'Fatigue', average: 3.2, priorAverage: 3.5, unit: '/5', isSymptom: true },
      [{ name: 'Vitamin D', average: 2000, priorAverage: 1800, unit: 'IU', isSymptom: false }],
      { timeframeLabel: '6 months' }
    );
    expect(result.percentChange).toBeCloseTo(-8.6, 0);
    expect(result.insightText).toContain('Fatigue');
    expect(result.insightText).toContain('below');
  });

  it('omits correlation when change is < 2%', () => {
    const result = computeInsight(
      { name: 'Vitamin D', average: 2000, priorAverage: 1990, unit: 'IU', isSymptom: false },
      [{ name: 'Fatigue', average: 3.2, priorAverage: 3.19, unit: '/5', isSymptom: true }],
      { timeframeLabel: '6 months' }
    );
    expect(result.insightText).not.toContain('favorable');
  });

  it('handles no secondary series', () => {
    const result = computeInsight(
      { name: 'Vitamin D', average: 2000, priorAverage: 1800, unit: 'IU', isSymptom: false },
      [],
      { timeframeLabel: '6 months' }
    );
    expect(result.insightText).toContain('Vitamin D');
    expect(result.insightText).not.toContain('favorable');
  });

  it('does not mark two symptoms both increasing as favorable', () => {
    const result = computeInsight(
      { name: 'Fatigue', average: 4.0, priorAverage: 3.0, unit: '/5', isSymptom: true },
      [{ name: 'Brain Fog', average: 3.5, priorAverage: 2.5, unit: '/5', isSymptom: true }],
      { timeframeLabel: '6 months' }
    );
    expect(result.insightText).not.toContain('favorable');
  });

  it('handles zero priorAverage gracefully', () => {
    const result = computeInsight(
      { name: 'Vitamin D', average: 2000, priorAverage: 0, unit: 'IU', isSymptom: false },
      [],
      { timeframeLabel: '6 months' }
    );
    expect(result.percentChange).toBeNull();
  });
});
