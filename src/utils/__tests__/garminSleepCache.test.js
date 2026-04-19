import { describe, it, expect } from 'vitest';
import { mergeDays } from '../garminSleepCache';

describe('mergeDays', () => {
  it('returns incoming sorted when cache is empty', () => {
    expect(mergeDays([], [{ date: '2026-04-02' }, { date: '2026-04-01' }]))
      .toEqual([{ date: '2026-04-01' }, { date: '2026-04-02' }]);
  });

  it('replaces cached entries with newer incoming ones on same date', () => {
    const cache = [{ date: '2026-04-01', sleepScore: 70 }];
    const incoming = [{ date: '2026-04-01', sleepScore: 82 }];
    expect(mergeDays(cache, incoming)).toEqual([{ date: '2026-04-01', sleepScore: 82 }]);
  });

  it('concatenates non-overlapping days', () => {
    const cache = [{ date: '2026-04-01', sleepScore: 70 }];
    const incoming = [{ date: '2026-04-02', sleepScore: 75 }];
    expect(mergeDays(cache, incoming)).toEqual([
      { date: '2026-04-01', sleepScore: 70 },
      { date: '2026-04-02', sleepScore: 75 },
    ]);
  });
});
