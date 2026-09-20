import { describe, it, expect } from 'vitest';
import { getProtocolEvents, normalRange, beforeAfter, addDays } from '../protocolEvents';

const TODAY = '2026-09-20';

// Log `itemId` on every day from `from` for `days` days, at `dose`
const log = (entries, itemId, from, days, dose = 100) => {
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    entries[`${date}-${itemId}`] = { date, itemId, dose, taken: true };
  }
  return entries;
};

const items = [
  { id: 'base', name: 'Zinc', unit: 'mg', defaultDose: 100 },
  { id: 'nac', name: 'NAC', unit: 'mg', defaultDose: 600 },
];

describe('getProtocolEvents', () => {
  it('ignores whatever was already being taken on the first day of tracking', () => {
    const entries = log({}, 'base', '2026-08-01', 51);
    expect(getProtocolEvents(items, entries, TODAY)).toEqual([]);
  });

  it('marks a supplement started after tracking began', () => {
    const entries = log(log({}, 'base', '2026-08-01', 51), 'nac', '2026-09-01', 20, 600);
    const events = getProtocolEvents(items, entries, TODAY);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ date: '2026-09-01', itemId: 'nac', type: 'start', label: 'Started NAC', since: 'starting NAC' });
  });

  it('marks a stop once the gap is long enough, dated the day after the last dose', () => {
    const entries = log(log({}, 'base', '2026-08-01', 51), 'nac', '2026-08-05', 10, 600);
    const events = getProtocolEvents(items, entries, TODAY);
    expect(events.map((e) => [e.type, e.date])).toEqual([['start', '2026-08-05'], ['stop', '2026-08-15']]);
    expect(events[1].label).toBe('Stopped NAC');
  });

  it('does not call a few missed days a stop', () => {
    const entries = log(log({}, 'base', '2026-08-01', 51), 'nac', '2026-08-05', 10, 600);
    log(entries, 'nac', '2026-08-20', 32, 600);
    expect(getProtocolEvents(items, entries, TODAY).map((e) => e.type)).toEqual(['start']);
  });

  it('marks a dose change that sticks, and ignores a one-off', () => {
    const entries = log({}, 'base', '2026-08-01', 20, 100);
    entries['2026-08-10-base'].dose = 300; // one-off
    log(entries, 'base', '2026-08-21', 31, 200);
    const events = getProtocolEvents(items, entries, TODAY);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ date: '2026-08-21', type: 'dose', from: 100, to: 200, label: 'Zinc 100 → 200 mg', since: 'Zinc went 100 → 200 mg' });
  });

  it('skips deleted supplements and returns events oldest first', () => {
    const entries = log(log(log({}, 'base', '2026-08-01', 51), 'nac', '2026-09-05', 16), 'gone', '2026-08-20', 30);
    const all = [...items, { id: 'gone', name: 'Gone', unit: 'mg', deletedAt: '2026-09-19T00:00:00.000Z' }];
    expect(getProtocolEvents(all, entries, TODAY).map((e) => e.itemId)).toEqual(['nac']);
  });
});

describe('normalRange', () => {
  it('needs two weeks of logged days', () => {
    expect(normalRange([1, 2, 3, null, null])).toBeNull();
  });

  it('is centred on the mean, at least 0.75 either side, and never below 0', () => {
    const steady = normalRange(Array(20).fill(2));
    expect(steady.lo).toBeCloseTo(1.25);
    expect(steady.hi).toBeCloseTo(2.75);
    expect(normalRange(Array(20).fill(0.25)).lo).toBe(0);
    expect(normalRange(Array(20).fill(4.8)).hi).toBe(5);
  });
});

describe('beforeAfter', () => {
  const series = (map) => (dates) => dates.map((d) => (d in map ? map[d] : null));

  it('averages up to 30 days either side of the change', () => {
    const map = {};
    for (let i = 1; i <= 10; i++) map[addDays('2026-09-01', -i)] = 3;
    for (let i = 0; i < 10; i++) map[addDays('2026-09-01', i)] = 1;
    expect(beforeAfter(series(map), '2026-09-01', TODAY)).toEqual({ before: 3, after: 1, afterDays: 20 });
  });

  it('returns null until there are three logged days on each side', () => {
    const map = { '2026-09-18': 2, '2026-09-19': 2, '2026-09-10': 3, '2026-09-11': 3, '2026-09-12': 3 };
    expect(beforeAfter(series(map), '2026-09-18', TODAY)).toBeNull();
  });
});
