import { describe, it, expect } from 'vitest';
import { noteTime, appendToNote, stripBars } from '../voiceNote';

// Local-time constructor: the helpers format local time, so the test must not depend on the TZ
const at = (h, m) => new Date(2026, 8, 24, h, m);

describe('noteTime', () => {
  it('is 24-hour HH:MM with leading zeros', () => {
    expect(noteTime(at(8, 5))).toBe('08:05');
    expect(noteTime(at(0, 0))).toBe('00:00');
    expect(noteTime(at(23, 59))).toBe('23:59');
  });
});

describe('appendToNote', () => {
  it('starts an empty day with just the timed line', () => {
    expect(appendToNote('', 'Headache behind the eyes.', at(8, 42))).toBe('08:42 — Headache behind the eyes.');
  });

  it('adds a blank line after existing text', () => {
    expect(appendToNote('Slept badly', 'Better after coffee.', at(14, 3))).toBe('Slept badly\n\n14:03 — Better after coffee.');
  });

  it('trims the new text and the end of the existing text', () => {
    expect(appendToNote('Morning note\n\n', '  spoken words  ', at(9, 0))).toBe('Morning note\n\n09:00 — spoken words');
  });

  it('leaves the note alone when there is nothing to add', () => {
    expect(appendToNote('Existing', '   ', at(9, 0))).toBe('Existing');
    expect(appendToNote('', '', at(9, 0))).toBe('');
  });

  it('treats a missing note as empty', () => {
    expect(appendToNote(undefined, 'Hi', at(7, 7))).toBe('07:07 — Hi');
  });
});

describe('stripBars', () => {
  it('is empty for no levels', () => {
    expect(stripBars([], 70)).toEqual([]);
  });

  it('keeps every level when there are fewer than the bar count', () => {
    expect(stripBars([0.1, 0.5, 0.2], 70)).toEqual([0.1, 0.5, 0.2]);
  });

  it('takes the loudest level in each slice', () => {
    const levels = Array.from({ length: 140 }, (_, i) => (i % 2 ? 0.8 : 0.1));
    const bars = stripBars(levels, 70);
    expect(bars).toHaveLength(70);
    expect(bars.every((v) => v === 0.8)).toBe(true);
  });
});
