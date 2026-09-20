import { describe, it, expect } from 'vitest';
import { computeFlareGroups, flareThreshold, flareSimilarity, flareThresholds, flaringBadge, suggestGrouping, MIN_HISTORY_DAYS } from '../flareGroups';
import { getStripDateKeys } from '../listHelpers';

const TODAY = new Date(2026, 8, 20);
const DAYS = 60;
const keys = getStripDateKeys(TODAY, DAYS); // oldest first

// Build an entry map: `pattern(dayIndex)` gives each symptom's severity for that day (null = not logged)
const build = (patterns, days = DAYS) => {
  const entries = {};
  keys.slice(DAYS - days).forEach((dateKey, i) => {
    Object.entries(patterns).forEach(([id, fn]) => {
      const severity = fn(i + (DAYS - days));
      if (severity !== null) entries[`${dateKey}-${id}-daily`] = { date: dateKey, severity };
    });
  });
  return entries;
};

const flareOn = (flareDays, high = 4, low = 0) => (i) => (flareDays.includes(i) ? high : low);
const GUT_DAYS = [5, 6, 14, 15, 27, 28, 40, 41, 52];
const MOOD_DAYS = [9, 10, 20, 21, 33, 34, 46, 47];

const symptoms = [
  { id: 'diarrhea', name: 'Diarrhea' },
  { id: 'irritable', name: 'Irritability' },
  { id: 'bloating', name: 'Bloating' },
  { id: 'anxiety', name: 'Anxiety' },
  { id: 'headache', name: 'Headache' },
];
const entries = build({
  diarrhea: flareOn(GUT_DAYS),
  bloating: flareOn(GUT_DAYS.map((d) => d + (d % 2)), 3, 1), // same flares, sometimes a day late, different baseline
  irritable: flareOn(MOOD_DAYS, 3),
  anxiety: flareOn(MOOD_DAYS, 5, 1),
  headache: flareOn([2, 18, 31, 44, 57], 3),
});

describe('flareThreshold', () => {
  it('sits above the symptom\'s own normal and never counts a 0 or a 1 as a flare', () => {
    expect(flareThreshold([0, 0, 0, 0])).toBe(2);
    expect(flareThreshold([0, 1, 0, 1])).toBe(2);
    expect(flareThreshold([3, 3, 3, 3])).toBe(3.75);
    expect(flareThreshold([null, null])).toBe(Infinity);
  });
});

describe('flareSimilarity', () => {
  it('is high for coinciding flares, allowing a day either side', () => {
    expect(flareSimilarity([5, 14, 27, 40], [6, 14, 28, 41], 90)).toBe(1);
  });
  it('is 0 without enough shared flares or when overlap is what chance would give', () => {
    expect(flareSimilarity([5, 14], [5, 14], 90)).toBe(0);
    const often = Array.from({ length: 45 }, (_, i) => i * 2);
    expect(flareSimilarity(often, often.map((d) => d + 1), 90)).toBe(0);
  });
});

describe('suggestGrouping', () => {
  it('uses flare history first, then names for what is left, and leaves out what it cannot place', () => {
    const extra = [...symptoms, { id: 'rash', name: 'Itchy rash' }, { id: 'odd', name: 'Urinary urgency' }];
    expect(suggestGrouping(extra, entries, TODAY).map((g) => [g.name, g.source, g.rows.map((r) => r.id)])).toEqual([
      ['Gut', 'history', ['diarrhea', 'bloating']],
      ['Mood', 'history', ['irritable', 'anxiety']],
      ['Nerve & pain', 'name', ['headache']],
      ['Skin', 'name', ['rash']],
    ]);
  });

  it('falls back to names alone for someone with no history', () => {
    expect(suggestGrouping(symptoms, {}, TODAY).map((g) => [g.name, g.source, g.rows.map((r) => r.id)])).toEqual([
      ['Gut', 'name', ['diarrhea', 'bloating']],
      ['Mood', 'name', ['irritable', 'anxiety']],
      ['Nerve & pain', 'name', ['headache']],
    ]);
  });
});

describe('flaringBadge', () => {
  it('badges any set of symptoms when most of them are up on the day viewed', () => {
    const thresholds = flareThresholds(symptoms, entries, TODAY);
    const gut = symptoms.filter((s) => ['diarrhea', 'bloating'].includes(s.id));
    const flareDay = new Date(2026, 8, 20 - (DAYS - 1 - 40));
    expect(flaringBadge(gut, thresholds, entries, flareDay)).toBe('flaring · 2 of 2 up');
    expect(flaringBadge(gut, thresholds, entries, TODAY)).toBe(null);
    expect(flaringBadge([gut[0]], thresholds, entries, flareDay)).toBe(null); // one symptom is not a group flare
  });
});

describe('computeFlareGroups', () => {
  it('groups symptoms whose bad days coincide, names the groups, and leaves loners on their own', () => {
    const { ready, sections } = computeFlareGroups(symptoms, entries, TODAY);
    expect(ready).toBe(true);
    expect(sections.map((s) => [s.name, s.rows.map((r) => r.id)])).toEqual([
      ['Gut', ['diarrhea', 'bloating']],
      ['Mood', ['irritable', 'anxiety']],
      [null, ['headache']],
    ]);
  });

  it('badges a group as flaring when most of it is up on the day being viewed', () => {
    const flareDay = new Date(2026, 8, 20 - (DAYS - 1 - 40)); // day index 40: both gut symptoms flare
    const { sections } = computeFlareGroups(symptoms, entries, TODAY, flareDay);
    expect(sections[0].badge).toBe('flaring · 2 of 2 up');
    expect(sections[1].badge).toBe(null);
    expect(computeFlareGroups(symptoms, entries, TODAY).sections[0].badge).toBe(null); // today is quiet
  });

  it('says it is not ready, and groups nothing, without about three weeks of history', () => {
    const short = build({ diarrhea: flareOn([50, 55, 58]), bloating: flareOn([50, 55, 58]) }, MIN_HISTORY_DAYS - 1);
    const result = computeFlareGroups(symptoms, short, TODAY);
    expect(result.ready).toBe(false);
    expect(result.sections).toEqual([{ name: null, rows: symptoms, badge: null }]);
  });

  it('ignores symptoms with too little history of their own', () => {
    const sparse = build({ ...{ diarrhea: flareOn(GUT_DAYS), bloating: flareOn(GUT_DAYS) }, headache: (i) => (i > 50 ? 4 : null) });
    const { sections } = computeFlareGroups(symptoms, sparse, TODAY);
    expect(sections.find((s) => s.name === null).rows.map((r) => r.id)).toContain('headache');
  });
});
