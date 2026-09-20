import { describe, it, expect } from 'vitest';
import { getProtocolEvents, normalRange, changeEffect, addDays } from '../protocolEvents';

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

describe('changeEffect', () => {
  const series = (map) => (dates) => dates.map((d) => (d in map ? map[d] : null));
  // `value(i)` for each of `days` days starting at `from`
  const fill = (map, from, days, value) => { for (let i = 0; i < days; i++) map[addDays(from, i)] = typeof value === 'function' ? value(i) : value; return map; };

  it('reports a clear improvement in points', () => {
    const map = fill(fill({}, '2026-08-02', 30, 3), '2026-09-01', 20, 1);
    expect(changeEffect(series(map), '2026-09-01', TODAY)).toMatchObject({ status: 'ok', before: 3, after: 1, delta: -2, meaningful: true });
  });

  it('does not call a wobble of a tenth of a point a change', () => {
    const map = fill(fill({}, '2026-08-02', 30, (i) => (i % 2 ? 1 : 2)), '2026-09-01', 20, (i) => (i % 5 ? 1.5 : 1));
    const effect = changeEffect(series(map), '2026-09-01', TODAY);
    expect(effect.status).toBe('ok');
    expect(effect.meaningful).toBe(false);
  });

  it('asks for more than half a point when the symptom is noisy anyway', () => {
    const map = fill(fill({}, '2026-08-02', 30, (i) => (i % 2 ? 0 : 5)), '2026-09-01', 20, (i) => (i % 2 ? 0 : 3.8));
    expect(changeEffect(series(map), '2026-09-01', TODAY).meaningful).toBe(false);
  });

  it('says it is too early until a week is logged since the change', () => {
    const map = fill(fill({}, '2026-08-10', 36, 3), '2026-09-15', 5, 1);
    expect(changeEffect(series(map), '2026-09-15', TODAY).status).toBe('early');
  });

  it('only compares clean stretches: stops at the next change and starts at the previous one', () => {
    const map = fill(fill(fill({}, '2026-08-01', 20, 3), '2026-08-21', 10, 1), '2026-08-31', 21, 4);
    const effect = changeEffect(series(map), '2026-08-21', TODAY, { nextChange: '2026-08-31' });
    expect(effect).toMatchObject({ status: 'ok', before: 3, after: 1 });
    expect(changeEffect(series(map), '2026-08-21', TODAY, { nextChange: '2026-08-25' }).status).toBe('crowded');
    expect(changeEffect(series(map), '2026-08-21', TODAY, { prevChange: '2026-08-17' }).status).toBe('crowded');
  });
});
