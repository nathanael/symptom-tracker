import { describe, it, expect } from 'vitest';
import { mergeDays, aggregate } from '../garminSleepCache';

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

describe('aggregate', () => {
  const days = [
    { date: '2026-04-06', sleepScore: 80, remSleepSeconds: 3600 }, // Mon
    { date: '2026-04-07', sleepScore: 82, remSleepSeconds: 3900 },
    { date: '2026-04-08', sleepScore: 84, remSleepSeconds: 4200 },
    { date: '2026-04-13', sleepScore: 70, remSleepSeconds: 3000 }, // next Mon
  ];

  it('passes through in days mode', () => {
    expect(aggregate(days, 'days')).toEqual(days);
  });

  it('buckets by ISO week and averages numeric fields', () => {
    const weeks = aggregate(days, 'weeks');
    expect(weeks).toHaveLength(2);
    expect(weeks[0].date).toBe('2026-04-06');
    expect(weeks[0].sleepScore).toBe(82);       // (80+82+84)/3
    expect(weeks[0].remSleepSeconds).toBe(3900);
    expect(weeks[1].date).toBe('2026-04-13');
    expect(weeks[1].sleepScore).toBe(70);
  });

  it('buckets by month', () => {
    const months = aggregate(days, 'months');
    expect(months).toHaveLength(1);
    expect(months[0].date).toBe('2026-04-01');
    expect(months[0].sleepScore).toBe(79);      // (80+82+84+70)/4 rounded
  });
});

import { rangeForPreset } from '../garminSleepCache';

describe('rangeForPreset', () => {
  const availableMax = '2026-04-19';
  const availableMin = '2024-01-01';

  it('7d returns last 7 days', () => {
    expect(rangeForPreset('7d', availableMin, availableMax))
      .toEqual({ start: '2026-04-13', end: '2026-04-19' });
  });

  it('1y returns last year', () => {
    expect(rangeForPreset('1y', availableMin, availableMax))
      .toEqual({ start: '2025-04-20', end: '2026-04-19' });
  });

  it('all returns full available range', () => {
    expect(rangeForPreset('all', availableMin, availableMax))
      .toEqual({ start: '2024-01-01', end: '2026-04-19' });
  });

  it('clamps start to availableMin', () => {
    expect(rangeForPreset('1y', '2026-03-01', '2026-04-19'))
      .toEqual({ start: '2026-03-01', end: '2026-04-19' });
  });
});

import { extractSyncedAtIso, applyFirestoreSnapshot } from '../garminSleepCache';

describe('extractSyncedAtIso', () => {
  it('returns null when syncedAt missing', () => {
    expect(extractSyncedAtIso({ date: '2026-04-18' })).toBe(null);
  });

  it('handles Firestore Timestamp with toDate()', () => {
    const ts = { toDate: () => new Date('2026-04-18T12:00:00.000Z') };
    expect(extractSyncedAtIso({ syncedAt: ts })).toBe('2026-04-18T12:00:00.000Z');
  });

  it('handles serialized {seconds, nanoseconds} shape', () => {
    const ts = { seconds: 1776470400, nanoseconds: 0 };  // 2026-04-18T00:00:00Z
    expect(extractSyncedAtIso({ syncedAt: ts })).toBe('2026-04-18T00:00:00.000Z');
  });

  it('passes through ISO string', () => {
    expect(extractSyncedAtIso({ syncedAt: '2026-04-18T12:00:00.000Z' }))
      .toBe('2026-04-18T12:00:00.000Z');
  });
});

describe('applyFirestoreSnapshot', () => {
  it('first load: merges all docs and picks newest syncedAt', () => {
    const docs = [
      { date: '2026-04-17', sleepScore: 80, syncedAt: { toDate: () => new Date('2026-04-18T01:00:00Z') } },
      { date: '2026-04-18', sleepScore: 82, syncedAt: { toDate: () => new Date('2026-04-19T02:00:00Z') } },
    ];
    const { merged, newestTs } = applyFirestoreSnapshot([], null, docs);
    expect(merged.map(d => d.date)).toEqual(['2026-04-17', '2026-04-18']);
    expect(merged[1].sleepScore).toBe(82);
    expect(newestTs).toBe('2026-04-19T02:00:00.000Z');
  });

  it('delta load: incoming overrides existing cache entry by date', () => {
    const cache = [{ date: '2026-04-18', sleepScore: 70, syncedAt: '2026-04-18T12:00:00.000Z' }];
    const docs = [
      { date: '2026-04-18', sleepScore: 82, syncedAt: { toDate: () => new Date('2026-04-19T01:00:00Z') } },
    ];
    const { merged, newestTs } = applyFirestoreSnapshot(cache, '2026-04-18T12:00:00.000Z', docs);
    expect(merged).toHaveLength(1);
    expect(merged[0].sleepScore).toBe(82);
    expect(newestTs).toBe('2026-04-19T01:00:00.000Z');
  });

  it('no incoming docs: returns cache + existing lastPushedAt', () => {
    const cache = [{ date: '2026-04-18', sleepScore: 70, syncedAt: '2026-04-18T12:00:00.000Z' }];
    const { merged, newestTs } = applyFirestoreSnapshot(cache, '2026-04-18T12:00:00.000Z', []);
    expect(merged).toEqual(cache);
    expect(newestTs).toBe('2026-04-18T12:00:00.000Z');
  });

  it('normalizes syncedAt on incoming docs to ISO string', () => {
    const docs = [
      { date: '2026-04-18', syncedAt: { toDate: () => new Date('2026-04-19T01:00:00Z') } },
    ];
    const { merged } = applyFirestoreSnapshot([], null, docs);
    expect(merged[0].syncedAt).toBe('2026-04-19T01:00:00.000Z');
  });
});
