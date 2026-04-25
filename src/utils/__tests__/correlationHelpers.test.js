import { describe, it, expect } from 'vitest';
import { getSleepDailySeries } from '../correlationHelpers';

describe('getSleepDailySeries', () => {
  const days = [
    { date: '2026-04-23', sleepScore: 85, deepSleepSeconds: 3600, lightSleepSeconds: 7200, remSleepSeconds: 5400 },
    { date: '2026-04-24', sleepScore: 72, deepSleepSeconds: 1800, lightSleepSeconds: 9000, remSleepSeconds: 4200 },
    // 2026-04-25 missing on purpose
  ];

  it('returns null for missing dates', () => {
    expect(getSleepDailySeries(days, 'sleepScore', ['2026-04-25'])).toEqual([null]);
  });

  it('returns the metric value for present dates', () => {
    expect(getSleepDailySeries(days, 'sleepScore', ['2026-04-23', '2026-04-24', '2026-04-25']))
      .toEqual([85, 72, null]);
  });

  it('applies metric.transform (e.g., REM seconds → minutes)', () => {
    expect(getSleepDailySeries(days, 'remSleepSeconds', ['2026-04-23', '2026-04-24']))
      .toEqual([90, 70]);
  });

  it('applies metric.compute (e.g., total duration)', () => {
    // duration = (deep + light + rem) / 60
    // 2026-04-23: (3600 + 7200 + 5400)/60 = 270
    // 2026-04-24: (1800 + 9000 + 4200)/60 = 250
    expect(getSleepDailySeries(days, 'duration', ['2026-04-23', '2026-04-24']))
      .toEqual([270, 250]);
  });

  it('returns null array when days is empty', () => {
    expect(getSleepDailySeries([], 'sleepScore', ['2026-04-23', '2026-04-24']))
      .toEqual([null, null]);
  });

  it('returns null for unknown metric key', () => {
    expect(getSleepDailySeries(days, 'nope', ['2026-04-23'])).toEqual([null]);
  });
});
