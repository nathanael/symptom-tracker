import { describe, it, expect } from 'vitest';
import { sleepBalance, symptomLinks, supplementLinks, contributorStanding, CONTRIBUTORS, pearson, shiftDate } from '../sleepInsights';

const dates = Array.from({ length: 30 }, (_, i) => shiftDate('2026-09-01', i));

describe('sleepBalance', () => {
  it('nets surplus nights against short ones', () => {
    const rows = [
      { date: '2026-09-01', deepSleepSeconds: 3600, lightSleepSeconds: 18000, remSleepSeconds: 5400, sleepNeedMinutes: 480 }, // 450 → 30 short
      { date: '2026-09-02', deepSleepSeconds: 3600, lightSleepSeconds: 14400, remSleepSeconds: 3600, sleepNeedMinutes: 480 }, // 360 → 120 short
      { date: '2026-09-03', deepSleepSeconds: 3600, lightSleepSeconds: 21600, remSleepSeconds: 5400, sleepNeedMinutes: 480 }, // 510 → 30 ahead
      { date: '2026-09-04' },
    ];
    const b = sleepBalance(rows);
    expect(b.net).toBe(120);
    expect(b.counted).toBe(3);
    expect(b.nights[3].ratio).toBeNull();
  });
});

describe('symptomLinks', () => {
  it('finds worse symptoms on days after low deep sleep', () => {
    const sleep = dates.map((date, i) => ({ date, deepSleepSeconds: (i % 3 === 0 ? 30 : 80) * 60 }));
    const entries = {};
    dates.forEach((date, i) => { entries[`${date}-fat-daily`] = { severity: i % 3 === 0 ? 4 : 1 }; });
    const links = symptomLinks(sleep, [{ id: 'fat', name: 'Fatigue', active: true }], entries, 'daily');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ symptom: 'Fatigue', metric: 'deep sleep', below: true, nights: 10 });
    expect(links[0].effect).toBeCloseTo(3);
  });

  it('stays quiet without enough overlap', () => {
    const sleep = dates.slice(0, 6).map((date) => ({ date, deepSleepSeconds: 3000 }));
    expect(symptomLinks(sleep, [{ id: 'fat', name: 'Fatigue', active: true }], {}, 'daily')).toEqual([]);
  });
});

describe('supplementLinks', () => {
  it('pairs a supplement taken the day before with that night', () => {
    const sleep = dates.map((date, i) => ({ date, deepSleepSeconds: (i % 2 ? 70 : 50) * 60 }));
    const stackEntries = {};
    // taken on the day before odd-index nights
    dates.forEach((date, i) => { if (i % 2) stackEntries[`${shiftDate(date, -1)}-mag`] = { taken: true }; });
    const links = supplementLinks(sleep, [{ id: 'mag', name: 'Magnesium' }], stackEntries);
    expect(links[0]).toMatchObject({ item: 'Magnesium', metric: 'deep sleep' });
    expect(links[0].diff).toBeCloseTo(20);
  });
});

describe('contributorStanding', () => {
  const deep = CONTRIBUTORS.find((c) => c.key === 'deep');
  it('uses fixed targets when asked', () => {
    expect(contributorStanding(deep, { deepSleepSeconds: 40 * 60 }, [], 'targets').color).toBe('#f87171');
  });
  it('falls back to targets when the baseline is too short', () => {
    expect(contributorStanding(deep, { deepSleepSeconds: 70 * 60 }, [], 'baseline').color).toBe('#4ade80');
  });
  it('judges against the baseline when there is one', () => {
    const base = dates.map((date, i) => ({ date, deepSleepSeconds: (40 + (i % 5)) * 60 }));
    expect(contributorStanding(deep, { deepSleepSeconds: 42 * 60 }, base, 'baseline').color).toBe('#4ade80');
  });
});

it('pearson is 1 for a perfect line', () => {
  expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
});
