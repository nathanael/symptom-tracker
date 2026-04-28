import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { computeHealthScore, computeRollingAvg, getScoreColor } from '../healthScore';
import { getHealthScoreSeries } from '../correlationHelpers';

describe('computeHealthScore', () => {
  const symptoms = [
    { id: 's1', name: 'Headache', active: true },
    { id: 's2', name: 'Fatigue', active: true },
    { id: 's3', name: 'Nausea', active: false },
  ];

  it('returns null when no symptoms are logged', () => {
    const result = computeHealthScore(symptoms, {}, '2026-03-30', 'simple');
    expect(result).toEqual({ score: null, loggedCount: 0, totalActive: 2 });
  });

  it('computes score from logged severities (inverted: 100 = healthy)', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: 2, date: '2026-03-30', symptomId: 's1', time: 'daily' },
      '2026-03-30-s2-daily': { severity: 3, date: '2026-03-30', symptomId: 's2', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    // 100 - (2+3)/(2*5)*100 = 100 - 50 = 50
    expect(result).toEqual({ score: 50, loggedCount: 2, totalActive: 2 });
  });

  it('excludes N/A entries (severity -1)', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: -1, date: '2026-03-30', symptomId: 's1', time: 'daily' },
      '2026-03-30-s2-daily': { severity: 4, date: '2026-03-30', symptomId: 's2', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    // 100 - 4/(1*5)*100 = 100 - 80 = 20
    expect(result).toEqual({ score: 20, loggedCount: 1, totalActive: 2 });
  });

  it('only considers active symptoms', () => {
    const entries = {
      '2026-03-30-s3-daily': { severity: 5, date: '2026-03-30', symptomId: 's3', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    expect(result).toEqual({ score: null, loggedCount: 0, totalActive: 2 });
  });

  it('handles AM/PM mode by averaging', () => {
    const entries = {
      '2026-03-30-s1-morning': { severity: 2, date: '2026-03-30', symptomId: 's1', time: 'morning' },
      '2026-03-30-s1-evening': { severity: 4, date: '2026-03-30', symptomId: 's1', time: 'evening' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'ampm');
    // AM/PM avg: (2+4)/2=3, score: 100 - 3/(1*5)*100 = 100 - 60 = 40
    expect(result).toEqual({ score: 40, loggedCount: 1, totalActive: 2 });
  });

  it('returns score of 100 when all logged symptoms are severity 0', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: 0, date: '2026-03-30', symptomId: 's1', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    // 100 - 0/(1*5)*100 = 100
    expect(result).toEqual({ score: 100, loggedCount: 1, totalActive: 2 });
  });

  describe('with sleep score blending', () => {
    const store = {};
    beforeAll(() => {
      globalThis.localStorage = {
        getItem: (key) => store[key] ?? null,
        setItem: (key, val) => { store[key] = val; },
        removeItem: (key) => { delete store[key]; },
      };
    });
    afterEach(() => {
      delete store.garminSleepCache;
    });
    afterAll(() => {
      delete globalThis.localStorage;
    });

    it('blends 90% symptom + 10% sleep when sleep data available', () => {
      localStorage.setItem('garminSleepCache', JSON.stringify({
        days: [{ date: '2026-03-30', sleepScore: 80 }],
      }));
      const entries = {
        '2026-03-30-s1-daily': { severity: 2, date: '2026-03-30', symptomId: 's1', time: 'daily' },
        '2026-03-30-s2-daily': { severity: 3, date: '2026-03-30', symptomId: 's2', time: 'daily' },
      };
      const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
      // symptom: 100 - (2+3)/(2*5)*100 = 50
      // blended: 50*0.9 + 80*0.1 = 45 + 8 = 53
      expect(result).toEqual({ score: 53, loggedCount: 2, totalActive: 2 });
    });

    it('uses pure symptom score when no sleep data for date', () => {
      localStorage.setItem('garminSleepCache', JSON.stringify({
        days: [{ date: '2026-03-29', sleepScore: 80 }],
      }));
      const entries = {
        '2026-03-30-s1-daily': { severity: 2, date: '2026-03-30', symptomId: 's1', time: 'daily' },
      };
      const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
      // 100 - 2/(1*5)*100 = 60, no sleep data for this date
      expect(result).toEqual({ score: 60, loggedCount: 1, totalActive: 2 });
    });
  });
});

describe('computeRollingAvg', () => {
  const symptoms = [
    { id: 's1', name: 'Headache', active: true },
  ];

  it('averages scores over available days', () => {
    const entries = {
      '2026-03-29-s1-daily': { severity: 2, date: '2026-03-29', symptomId: 's1', time: 'daily' },
      '2026-03-30-s1-daily': { severity: 4, date: '2026-03-30', symptomId: 's1', time: 'daily' },
    };
    // Mar 29: 100 - 2/5*100 = 60
    const result = computeRollingAvg(symptoms, entries, '2026-03-30', 'simple', 7);
    expect(result).toBe(60);
  });

  it('returns null when no prior days have data', () => {
    const result = computeRollingAvg(symptoms, {}, '2026-03-30', 'simple', 7);
    expect(result).toBeNull();
  });

  it('averages multiple prior days correctly', () => {
    const entries = {
      '2026-03-28-s1-daily': { severity: 1, date: '2026-03-28', symptomId: 's1', time: 'daily' },
      '2026-03-29-s1-daily': { severity: 3, date: '2026-03-29', symptomId: 's1', time: 'daily' },
    };
    // Mar 28: 100-1/5*100=80, Mar 29: 100-3/5*100=40, avg = 60
    const result = computeRollingAvg(symptoms, entries, '2026-03-30', 'simple', 7);
    expect(result).toBe(60);
  });

  it('excludes current date from rolling average', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: 4, date: '2026-03-30', symptomId: 's1', time: 'daily' },
    };
    const result = computeRollingAvg(symptoms, entries, '2026-03-30', 'simple', 7);
    expect(result).toBeNull();
  });
});

describe('getScoreColor', () => {
  it('returns green for 80-100%', () => {
    expect(getScoreColor(80)).toBe('#22c55e');
    expect(getScoreColor(100)).toBe('#22c55e');
  });

  it('returns amber for 50-79%', () => {
    expect(getScoreColor(50)).toBe('#f59e0b');
    expect(getScoreColor(79)).toBe('#f59e0b');
  });

  it('returns red for 0-49%', () => {
    expect(getScoreColor(0)).toBe('#ef4444');
    expect(getScoreColor(49)).toBe('#ef4444');
  });

  it('returns gray for null', () => {
    expect(getScoreColor(null)).toBe('#64748b');
  });
});

describe('getHealthScoreSeries', () => {
  const symptoms = [
    { id: 's1', name: 'Headache', active: true },
    { id: 's2', name: 'Fatigue', active: true },
  ];

  it('returns array of scores aligned to dates', () => {
    const entries = {
      '2026-03-29-s1-daily': { severity: 2, date: '2026-03-29', symptomId: 's1', time: 'daily' },
      '2026-03-29-s2-daily': { severity: 4, date: '2026-03-29', symptomId: 's2', time: 'daily' },
      '2026-03-30-s1-daily': { severity: 1, date: '2026-03-30', symptomId: 's1', time: 'daily' },
    };
    const dates = ['2026-03-28', '2026-03-29', '2026-03-30'];
    const result = getHealthScoreSeries(symptoms, entries, dates, 'simple');
    // Day 1: no data = null
    // Day 2: 100-(2+4)/(2*5)*100 = 40
    // Day 3: 100-1/(1*5)*100 = 80
    expect(result).toEqual([null, 40, 80]);
  });

  it('returns all nulls when no entries exist', () => {
    const dates = ['2026-03-28', '2026-03-29'];
    const result = getHealthScoreSeries(symptoms, {}, dates, 'simple');
    expect(result).toEqual([null, null]);
  });
});
