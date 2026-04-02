import { describe, it, expect } from 'vitest';
import { computeHealthScore, computeRollingAvg } from '../healthScore';
import { getHealthScoreSeries } from '../correlationHelpers';
import { interpolateSmallGaps, smooth, generateDateRange } from '../chartHelpers';

// Generate realistic-scale test data
function generateTestData(numSymptoms, numDays) {
  const symptoms = [];
  for (let i = 0; i < numSymptoms; i++) {
    symptoms.push({ id: `s${i}`, name: `Symptom ${i}`, active: true });
  }

  const entries = {};
  const dates = generateDateRange(numDays);
  for (const dateStr of dates) {
    // ~80% of symptoms logged per day (realistic)
    for (const sym of symptoms) {
      if (Math.random() > 0.2) {
        entries[`${dateStr}-${sym.id}-daily`] = {
          severity: Math.floor(Math.random() * 6),
          date: dateStr,
          symptomId: sym.id,
          time: 'daily',
        };
      }
    }
  }

  return { symptoms, entries, dates };
}

describe('Performance: health score pipeline', () => {
  const scales = [
    { symptoms: 10, days: 30, label: '10 symptoms × 30 days' },
    { symptoms: 20, days: 30, label: '20 symptoms × 30 days' },
    { symptoms: 20, days: 180, label: '20 symptoms × 180 days' },
    { symptoms: 30, days: 180, label: '30 symptoms × 180 days' },
  ];

  for (const { symptoms: n, days, label } of scales) {
    it(`computeHealthScore: ${label}`, () => {
      const { symptoms, entries, dates } = generateTestData(n, days);
      const start = performance.now();
      for (const d of dates) {
        computeHealthScore(symptoms, entries, d, 'simple');
      }
      const elapsed = performance.now() - start;
      console.log(`  computeHealthScore (${label}): ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(500);
    });

    it(`getHealthScoreSeries + interpolate + smooth: ${label}`, () => {
      const { symptoms, entries, dates } = generateTestData(n, days);
      const start = performance.now();
      const raw = getHealthScoreSeries(symptoms, entries, dates, 'simple');
      const filled = interpolateSmallGaps(raw);
      const smoothed = smooth(filled, 5);
      const elapsed = performance.now() - start;
      console.log(`  full pipeline (${label}): ${elapsed.toFixed(1)}ms`);
      expect(smoothed.length).toBe(dates.length);
      expect(elapsed).toBeLessThan(500);
    });

    it(`computeRollingAvg: ${label}`, () => {
      const { symptoms, entries, dates } = generateTestData(n, days);
      const lastDate = dates[dates.length - 1];
      const start = performance.now();
      computeRollingAvg(symptoms, entries, lastDate, 'simple', 7);
      const elapsed = performance.now() - start;
      console.log(`  computeRollingAvg (${label}): ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(100);
    });
  }

  it('full render pipeline: useHealthScore + healthScoreTransformed + hsYRange', () => {
    const { symptoms, entries, dates } = generateTestData(20, 30);

    const start = performance.now();

    // Simulate useHealthScore hook
    const todayStr = dates[dates.length - 1];
    const { score } = computeHealthScore(symptoms, entries, todayStr, 'simple');
    const rollingAvg = computeRollingAvg(symptoms, entries, todayStr, 'simple', 7);

    // Simulate healthScoreTransformed useMemo
    const raw = getHealthScoreSeries(symptoms, entries, dates, 'simple');
    const filled = interpolateSmallGaps(raw);
    const smoothed = smooth(filled, 5);

    // Simulate hsYRange useMemo
    const valid = smoothed.filter(v => v !== null);
    const dataMin = Math.min(...valid);
    const dataMax = Math.max(...valid);
    const yMin = Math.floor(dataMin / 10) * 10;
    const yMax = Math.ceil(dataMax / 10) * 10;

    const elapsed = performance.now() - start;
    console.log(`  FULL render pipeline (20 symptoms × 30 days): ${elapsed.toFixed(1)}ms`);
    console.log(`    score=${score}, rollingAvg=${rollingAvg}, yRange=${yMin}-${yMax}`);
    expect(elapsed).toBeLessThan(200);
  });
});
