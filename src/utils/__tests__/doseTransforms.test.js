import { describe, it, expect } from 'vitest';
import { aggregateWeekly, aggregateMonthly, aggregateDaily, computeCumulativeLevel } from '../doseTransforms';

describe('aggregateWeekly', () => {
  // Mon Mar 2 to Sun Mar 15, 2026 = two full weeks
  const dates = [];
  for (let d = 2; d <= 15; d++) {
    dates.push(`2026-03-${String(d).padStart(2, '0')}`);
  }
  // 14 values: 100mg daily
  const series = Array(14).fill(100);

  it('returns average daily dose per week by default', () => {
    const result = aggregateWeekly(series, dates, 'average');
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toBe(100);
    expect(result.values[1]).toBe(100);
    expect(result.dates).toHaveLength(2);
    expect(result.labels).toHaveLength(2);
  });

  it('returns total dose per week', () => {
    const result = aggregateWeekly(series, dates, 'total');
    expect(result.values[0]).toBe(700);
    expect(result.values[1]).toBe(700);
  });

  it('labels are Monday dates', () => {
    const result = aggregateWeekly(series, dates, 'average');
    expect(result.labels[0]).toBe('2026-03-02');
    expect(result.labels[1]).toBe('2026-03-09');
  });

  it('handles partial weeks', () => {
    // Wed Mar 4 to Tue Mar 10 = partial first week (5 days) + partial second (2 days)
    const partialDates = dates.slice(2, 9); // Mar 4-10
    const partialSeries = Array(7).fill(100);
    const result = aggregateWeekly(partialSeries, partialDates, 'total');
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toBe(500); // Wed-Sun = 5 days (week of Mar 2)
    expect(result.values[1]).toBe(200); // Mon-Tue = 2 days (week of Mar 9)
  });

  it('handles null values by excluding from average', () => {
    const withNulls = [100, null, 100, null, 100, null, 100, ...Array(7).fill(200)];
    const result = aggregateWeekly(withNulls, dates, 'average');
    expect(result.values[0]).toBe(100);
    expect(result.values[1]).toBe(200);
  });

  it('returns empty arrays for all-null input', () => {
    const result = aggregateWeekly(Array(14).fill(null), dates, 'average');
    expect(result.values).toEqual([]);
    expect(result.dates).toEqual([]);
    expect(result.labels).toEqual([]);
  });
});

describe('aggregateMonthly', () => {
  const dates = [];
  for (let m = 1; m <= 2; m++) {
    const daysInMonth = m === 1 ? 31 : 28;
    for (let d = 1; d <= daysInMonth; d++) {
      dates.push(`2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }
  const series = Array(59).fill(100);

  it('returns average daily dose per month', () => {
    const result = aggregateMonthly(series, dates, 'average');
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toBe(100);
    expect(result.values[1]).toBe(100);
  });

  it('returns total dose per month', () => {
    const result = aggregateMonthly(series, dates, 'total');
    expect(result.values[0]).toBe(3100);
    expect(result.values[1]).toBe(2800);
  });

  it('labels are month names', () => {
    const result = aggregateMonthly(series, dates, 'average');
    expect(result.labels[0]).toBe('Jan');
    expect(result.labels[1]).toBe('Feb');
  });

  it('returns empty arrays for all-null input', () => {
    const result = aggregateMonthly(Array(59).fill(null), dates, 'average');
    expect(result.values).toEqual([]);
  });
});

describe('aggregateDaily', () => {
  it('returns input unchanged', () => {
    const dates = ['2026-03-01', '2026-03-02', '2026-03-03'];
    const series = [100, null, 200];
    const result = aggregateDaily(series, dates);
    expect(result.values).toEqual([100, null, 200]);
    expect(result.dates).toEqual(dates);
    expect(result.labels).toEqual(dates);
  });
});

describe('computeCumulativeLevel', () => {
  const dates = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];

  it('accumulates with decay for moderate category', () => {
    const series = [100, 100, 100, 100, 100];
    const result = computeCumulativeLevel(series, dates, 'moderate');
    expect(result.values).toHaveLength(5);
    expect(result.dates).toEqual(dates);
    expect(result.values[0]).toBeCloseTo(100);
    expect(result.values[1]).toBeGreaterThan(100);
    for (let i = 1; i < 5; i++) {
      expect(result.values[i]).toBeGreaterThan(result.values[i - 1]);
    }
  });

  it('decays when doses are missed', () => {
    const series = [100, 100, null, null, null];
    const result = computeCumulativeLevel(series, dates, 'moderate');
    expect(result.values[2]).toBeLessThan(result.values[1]);
    expect(result.values[3]).toBeLessThan(result.values[2]);
    expect(result.values[4]).toBeLessThan(result.values[3]);
    expect(result.values[4]).toBeGreaterThan(0);
  });

  it('fast decay clears faster than slow', () => {
    const series = [1000, null, null, null, null];
    const fast = computeCumulativeLevel(series, dates, 'fast');
    const slow = computeCumulativeLevel(series, dates, 'slow');
    expect(fast.values[4]).toBeLessThan(slow.values[4]);
  });

  it('defaults to moderate when category is null', () => {
    const series = [100, 100, 100, 100, 100];
    const withNull = computeCumulativeLevel(series, dates, null);
    const withModerate = computeCumulativeLevel(series, dates, 'moderate');
    expect(withNull.values).toEqual(withModerate.values);
  });

  it('returns continuous array with no nulls', () => {
    const series = [100, null, 100, null, 100];
    const result = computeCumulativeLevel(series, dates, 'moderate');
    result.values.forEach(v => {
      expect(v).not.toBeNull();
      expect(typeof v).toBe('number');
    });
  });

  it('starts from zero (no prior supplementation)', () => {
    const series = [0, 0, 0, 0, 100];
    const result = computeCumulativeLevel(series, dates, 'moderate');
    expect(result.values[0]).toBe(0);
    expect(result.values[3]).toBe(0);
    expect(result.values[4]).toBe(100);
  });
});
