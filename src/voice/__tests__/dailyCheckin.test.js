import { describe, it, expect, vi } from 'vitest';
import { createCheckin, parseSeverity, matchSymptom, handEntryMessage, TOOLS } from '../scripts/dailyCheckin';
import { initialPeriod, nextUnlogged, otherIncomplete, unloggedIn } from '../checkinQueue';

const periods = [{ id: 'morning', label: 'AM' }, { id: 'evening', label: 'PM' }];
const symptoms = [
  { id: 'headache', name: 'Headache' },
  { id: 'brain-fog', name: 'Brain fog', description: 'Trouble focusing' },
  { id: 'anxiety-physical', name: 'Anxiety', description: 'Physical' },
  { id: 'night-sweats', name: 'Night sweats', applicablePeriods: ['evening'] },
];
const dateKey = '2026-09-21';
const selectedDate = new Date(2026, 8, 21);
const entry = (severity, extra = {}) => ({ severity, ...extra });

const setup = (initial = {}, period = 'morning') => {
  const entries = { ...initial };
  const ctx = {
    symptoms, timePeriods: periods, selectedDate, dateKey, period,
    getEntries: () => entries,
    log: vi.fn(),
    onPause: vi.fn(), onFinish: vi.fn(), onCurrent: vi.fn(),
  };
  return { ctx, checkin: createCheckin(ctx) };
};

describe('checkinQueue', () => {
  it('starts in the current period unless it is complete', () => {
    expect(initialPeriod(symptoms, {}, dateKey, periods, 'evening')).toBe('evening');
    const morningDone = Object.fromEntries(['headache', 'brain-fog', 'anxiety-physical'].map((id) => [`${dateKey}-${id}-morning`, entry(1)]));
    expect(initialPeriod(symptoms, morningDone, dateKey, periods, 'morning')).toBe('evening');
    expect(otherIncomplete(symptoms, morningDone, dateKey, periods, 'morning')).toMatchObject({ id: 'evening', left: 4 });
  });

  it('only asks about symptoms applicable to the period', () => {
    expect(unloggedIn(symptoms, {}, dateKey, 'morning').map((s) => s.id)).not.toContain('night-sweats');
  });

  it('wraps to earlier unlogged symptoms and returns -1 when none remain', () => {
    const list = symptoms.slice(0, 3);
    const logged = new Set(['brain-fog', 'anxiety-physical']);
    expect(nextUnlogged(list, (s) => logged.has(s.id), 2)).toBe(0);
    logged.add('headache');
    expect(nextUnlogged(list, (s) => logged.has(s.id), 0)).toBe(-1);
  });
});

describe('parseSeverity', () => {
  it('accepts 0-5, -1 and "na"; rejects everything else', () => {
    expect(parseSeverity(0)).toBe(0);
    expect(parseSeverity('3')).toBe(3);
    expect(parseSeverity('N/A')).toBe(-1);
    expect(parseSeverity(-1)).toBe(-1);
    expect(parseSeverity(6)).toBeNull();
    expect(parseSeverity(2.5)).toBeNull();
    expect(parseSeverity('')).toBeNull();
  });
});

describe('matchSymptom', () => {
  it('matches exact, contained and partial names, and flags ties', () => {
    expect(matchSymptom(symptoms, 'headache').id).toBe('headache');
    expect(matchSymptom(symptoms, 'the brain fog one').id).toBe('brain-fog');
    expect(matchSymptom(symptoms, 'sweats').id).toBe('night-sweats');
    expect(matchSymptom(symptoms, 'nausea')).toBeNull();
    const twins = [{ id: 'a', name: 'Anxiety physical' }, { id: 'b', name: 'Anxiety mental' }];
    expect(matchSymptom(twins, 'anxiety').ambiguous).toEqual(['Anxiety physical', 'Anxiety mental']);
  });
});

describe('createCheckin', () => {
  it('opens with the first unlogged symptom and its last rating', () => {
    const { checkin, ctx } = setup({ '2026-09-20-headache-morning': entry(2), [`${dateKey}-headache-evening`]: entry(1) });
    expect(checkin.start()).toEqual({ period: 'AM', next: { symptom_id: 'headache', name: 'Headache', last_time: 2, say: 'Headache. Last time was a two.' }, remaining: 3 });
    expect(ctx.onCurrent).toHaveBeenCalledWith(symptoms[0], 'morning');
  });

  it('records a rating with a note and moves on before React state catches up', () => {
    const { checkin, ctx } = setup();
    checkin.start();
    const result = checkin.handle('record_symptom', { symptom_id: 'headache', severity: 2, note: ' worse after coffee ' });
    expect(ctx.log).toHaveBeenCalledWith('headache', 2, 'morning', 'worse after coffee');
    // The note rides along so the voice can acknowledge it
    expect(result.saved).toEqual({ name: 'Headache', severity: 2, note: 'worse after coffee' });
    expect(result.next.symptom_id).toBe('brain-fog');
    expect(result.next.description).toBe('Trouble focusing');
    expect(result.remaining).toBe(2);
  });

  it('maps not-applicable to -1 and rejects out-of-range severities without advancing', () => {
    const { checkin, ctx } = setup();
    checkin.start();
    expect(checkin.handle('record_symptom', { symptom_id: 'headache', severity: 9 }).error).toMatch(/0 to 5/);
    expect(ctx.log).not.toHaveBeenCalled();
    checkin.handle('record_symptom', { symptom_id: 'headache', severity: 'na' });
    expect(ctx.log).toHaveBeenCalledWith('headache', -1, 'morning', undefined);
  });

  it('re-describes the current symptom when the id is unknown', () => {
    const { checkin } = setup();
    checkin.start();
    const result = checkin.handle('record_symptom', { symptom_id: 'nope', severity: 1 });
    expect(result.error).toMatch(/Unknown symptom_id/);
    expect(result.next).toBeDefined();
  });

  it('skips without logging, and reports skipped symptoms when the rest are done', () => {
    const { checkin, ctx } = setup();
    checkin.start();
    expect(checkin.handle('skip_symptom', { symptom_id: 'headache' }).next.symptom_id).toBe('brain-fog');
    checkin.handle('record_symptom', { symptom_id: 'brain-fog', severity: 1 });
    const done = checkin.handle('record_symptom', { symptom_id: 'anxiety-physical', severity: 0 });
    expect(ctx.log).toHaveBeenCalledTimes(2);
    expect(done).toMatchObject({ done: true, period: 'AM', skipped: 1, other_period: { period_id: 'evening', label: 'PM', left: 4 } });
  });

  it('revises an earlier answer by spoken name and stays on the current symptom', () => {
    const { checkin, ctx } = setup();
    checkin.start();
    checkin.handle('record_symptom', { symptom_id: 'headache', severity: 2 });
    const result = checkin.handle('revise_symptom', { symptom_name: 'headache', severity: 3 });
    expect(ctx.log).toHaveBeenLastCalledWith('headache', 3, 'morning', undefined);
    expect(result.next.symptom_id).toBe('brain-fog');
  });

  it('adds a note to an existing rating, and refuses a note-only revise of an unrated symptom', () => {
    const { checkin, ctx } = setup({ [`${dateKey}-headache-morning`]: entry(4) });
    checkin.start();
    checkin.handle('revise_symptom', { symptom_name: 'Headache', note: 'behind the eyes' });
    expect(ctx.log).toHaveBeenLastCalledWith('headache', 4, 'morning', 'behind the eyes');
    expect(checkin.handle('revise_symptom', { symptom_name: 'anxiety', note: 'x' }).error).toMatch(/no rating yet/);
  });

  it('switches period, resumes where a previous session stopped, and finishes', () => {
    const { checkin, ctx } = setup({ [`${dateKey}-headache-evening`]: entry(1) });
    const switched = checkin.handle('switch_period', { period_id: 'evening' });
    expect(switched).toMatchObject({ period: 'PM', next: { symptom_id: 'brain-fog' }, remaining: 3 });
    expect(checkin.handle('switch_period', { period_id: 'noon' }).error).toBeDefined();
    checkin.handle('pause_session');
    expect(ctx.onPause).toHaveBeenCalled();
    expect(checkin.handle('finish')).toEqual({ finished: true });
    expect(ctx.onFinish).toHaveBeenCalled();
    expect(checkin.handle('dance').error).toMatch(/Unknown tool/);
  });
});

describe('handEntryMessage', () => {
  it('never shows the model the tapped value, so it cannot copy it onto the next symptom', () => {
    const { checkin } = setup();
    checkin.start();
    const message = handEntryMessage(checkin.handle('record_symptom', { symptom_id: 'headache', severity: 3 }));
    expect(message).toContain('Headache');
    expect(message).toContain('brain-fog');
    expect(message).not.toMatch(/"severity"|\b3\b/);
  });
});

describe('TOOLS', () => {
  it('has a handler for every tool the model is offered', () => {
    const { checkin } = setup();
    checkin.start();
    for (const tool of TOOLS) expect(checkin.handle(tool.name, {}).error ?? '').not.toMatch(/Unknown tool/);
  });
});
