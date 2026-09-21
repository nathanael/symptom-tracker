import { describe, it, expect } from 'vitest';
import { parseUtterance, lineFor, linesFor, stateFor, LINES } from '../lines';

const asking = { asking: { symptom_id: 'headache', name: 'Headache' } };
const record = (severity, note) => ({ name: 'record_symptom', args: { symptom_id: 'headache', severity, ...(note ? { note } : {}) } });

describe('parseUtterance', () => {
  it('reads plain numbers, digits and number words', () => {
    expect(parseUtterance('Two.', asking)).toEqual(record(2));
    expect(parseUtterance('3', asking)).toEqual(record(3));
    expect(parseUtterance('zero', asking)).toEqual(record(0));
    expect(parseUtterance("I'd say a four", asking)).toEqual(record(4));
  });

  it('keeps what follows the number as the note, in the user\'s words', () => {
    expect(parseUtterance('Two, worse after coffee', asking)).toEqual(record(2, 'worse after coffee'));
    expect(parseUtterance('3 and it woke me up twice', asking)).toEqual(record(3, 'it woke me up twice'));
  });

  it('trusts homophones only as the whole utterance', () => {
    expect(parseUtterance('too', asking)).toEqual(record(2));
    expect(parseUtterance('For.', asking)).toEqual(record(4));
    expect(parseUtterance('no', asking)).toEqual(record(0));
    expect(parseUtterance('for the most part fine', asking)).toBeNull();
  });

  it('handles skip, pause and not applicable', () => {
    expect(parseUtterance('skip that one', asking)).toEqual({ name: 'skip_symptom', args: { symptom_id: 'headache' } });
    expect(parseUtterance("Let's stop there", asking)).toEqual({ name: 'pause_session', args: {} });
    expect(parseUtterance('N/A', asking)).toEqual(record(-1));
  });

  it('leaves ambiguity, corrections and chatter to the model', () => {
    expect(parseUtterance('two or three', asking)).toBeNull();
    expect(parseUtterance('actually make brain fog a three', asking)).toBeNull();
    expect(parseUtterance('what does that one mean', asking)).toBeNull();
    expect(parseUtterance('it was bad this morning maybe a four', asking)).toBeNull();
    expect(parseUtterance('', asking)).toBeNull();
    expect(parseUtterance('two', {})).toBeNull();
  });

  it('answers the continue-with-evening question', () => {
    const done = { done: { other_period: { period_id: 'evening', label: 'PM', left: 4 } } };
    expect(parseUtterance('Yeah, sure', done)).toEqual({ name: 'switch_period', args: { period_id: 'evening' } });
    expect(parseUtterance('no thanks', done)).toEqual({ name: 'finish', args: {} });
    expect(parseUtterance('yes', { done: { other_period: null } })).toBeNull();
  });
});

describe('lineFor / stateFor', () => {
  it('asks the next symptom with its last rating when there is one', () => {
    const result = { saved: {}, next: { symptom_id: 'brain-fog', name: 'Brain fog', last_time: 2 }, remaining: 3 };
    expect(lineFor(result)).toBe('Brain fog. Last time was a two.');
    expect(lineFor({ next: { symptom_id: 'x', name: 'Nausea' }, remaining: 1 })).toBe('Nausea.');
    expect(linesFor({ acknowledge: { reflect_note: 'after coffee' }, next: { symptom_id: 'x', name: 'Nausea', last_time: 0 } })).toEqual(["Got it, I've noted that.", 'Nausea. Last time was zero.']);
    expect(linesFor({ acknowledge: { say: 'Mm-hm.' }, next: { symptom_id: 'x', name: 'Nausea' } })).toEqual(['Mm-hm.', 'Nausea.']);
    expect(linesFor({ paused: true, acknowledge: { say: 'Okay.' } })).toEqual([LINES.paused]);
    expect(stateFor(result)).toEqual({ asking: { symptom_id: 'brain-fog', name: 'Brain fog' } });
  });

  it('offers the other period, then finishes', () => {
    const done = { done: true, other_period: { period_id: 'evening', label: 'PM', left: 4 } };
    expect(lineFor(done)).toMatch(/evening ones too/);
    expect(stateFor(done)).toEqual({ done: { other_period: done.other_period } });
    expect(lineFor({ done: true, other_period: null })).toBe(LINES.finished);
  });

  it('speaks errors without losing the current question', () => {
    expect(lineFor({ error: 'severity must be an integer 0 to 5, or -1 for not applicable. Ask the user again.' })).toBe(LINES.badSeverity);
    expect(lineFor({ error: 'Anxiety has no rating yet. Ask for a number from 0 to 5.' })).toBe(LINES.notRated);
    expect(lineFor({ error: 'No symptom matches "x".' })).toBe(LINES.notFound);
    expect(lineFor({ error: 'More than one', candidates: ['Anxiety physical', 'Anxiety mental'] })).toBe('Which one: Anxiety physical, or Anxiety mental?');
    expect(stateFor({ error: 'x' }, asking)).toBe(asking);
    expect(lineFor({ paused: true })).toBe(LINES.paused);
  });
});
