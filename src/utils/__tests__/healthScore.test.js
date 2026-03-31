import { describe, it, expect } from 'vitest';
import { computeHealthScore, computeRollingAvg, getScoreColor } from '../healthScore';

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

  it('computes score from logged severities', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: 2, date: '2026-03-30', symptomId: 's1', time: 'daily' },
      '2026-03-30-s2-daily': { severity: 3, date: '2026-03-30', symptomId: 's2', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    expect(result).toEqual({ score: 50, loggedCount: 2, totalActive: 2 });
  });

  it('excludes N/A entries (severity -1)', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: -1, date: '2026-03-30', symptomId: 's1', time: 'daily' },
      '2026-03-30-s2-daily': { severity: 4, date: '2026-03-30', symptomId: 's2', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    expect(result).toEqual({ score: 80, loggedCount: 1, totalActive: 2 });
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
    expect(result).toEqual({ score: 60, loggedCount: 1, totalActive: 2 });
  });

  it('returns score of 0 when all logged symptoms are severity 0', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: 0, date: '2026-03-30', symptomId: 's1', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    expect(result).toEqual({ score: 0, loggedCount: 1, totalActive: 2 });
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
    const result = computeRollingAvg(symptoms, entries, '2026-03-30', 'simple', 7);
    expect(result).toBe(40);
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
    // Mar 28: 1/5*100=20, Mar 29: 3/5*100=60, avg = 40
    const result = computeRollingAvg(symptoms, entries, '2026-03-30', 'simple', 7);
    expect(result).toBe(40);
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
  it('returns green for 0-20%', () => {
    expect(getScoreColor(0)).toBe('#22c55e');
    expect(getScoreColor(20)).toBe('#22c55e');
  });

  it('returns amber for 21-50%', () => {
    expect(getScoreColor(21)).toBe('#f59e0b');
    expect(getScoreColor(50)).toBe('#f59e0b');
  });

  it('returns red for 51-100%', () => {
    expect(getScoreColor(51)).toBe('#ef4444');
    expect(getScoreColor(100)).toBe('#ef4444');
  });

  it('returns gray for null', () => {
    expect(getScoreColor(null)).toBe('#64748b');
  });
});
