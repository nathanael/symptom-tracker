import { describe, it, expect } from 'vitest';
import { reduceTranscript, transcriptText, dictationErrorMessage } from '../dictation';
import { VoiceApiError } from '../voiceApi';

const committed = (id) => ({ type: 'input_audio_buffer.committed', item_id: id });
const delta = (id, text) => ({ type: 'conversation.item.input_audio_transcription.delta', item_id: id, delta: text });
const completed = (id, transcript) => ({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript });
const failed = (id) => ({ type: 'conversation.item.input_audio_transcription.failed', item_id: id });
const run = (...events) => events.reduce(reduceTranscript, []);

describe('reduceTranscript', () => {
  it('adds an empty item on commit, once', () => {
    expect(run(committed('a'), committed('a'))).toEqual([{ id: 'a', text: '', done: false }]);
  });

  it('accumulates deltas per item', () => {
    expect(run(committed('a'), delta('a', 'Woke'), delta('a', ' up'))).toEqual([{ id: 'a', text: 'Woke up', done: false }]);
  });

  it('replaces the partial with the final transcript on completion', () => {
    expect(run(committed('a'), delta('a', 'woke up'), completed('a', 'Woke up.'))).toEqual([{ id: 'a', text: 'Woke up.', done: true }]);
  });

  it('ignores a delta that arrives after completion', () => {
    expect(run(committed('a'), completed('a', 'Done.'), delta('a', ' late'))).toEqual([{ id: 'a', text: 'Done.', done: true }]);
  });

  it('keeps two items streaming at once separate', () => {
    const items = run(committed('a'), committed('b'), delta('a', 'first'), delta('b', 'second'), delta('a', ' one'));
    expect(items).toEqual([
      { id: 'a', text: 'first one', done: false },
      { id: 'b', text: 'second', done: false },
    ]);
  });

  it('orders by first sighting: an item first seen by a delta goes last', () => {
    const items = run(committed('a'), delta('x', 'stray'), committed('b'));
    expect(items.map((it) => it.id)).toEqual(['a', 'x', 'b']);
  });

  it('adds an item first seen by its completion', () => {
    expect(run(completed('z', 'Only this.'))).toEqual([{ id: 'z', text: 'Only this.', done: true }]);
  });

  it('marks a failed item done and keeps its partial', () => {
    expect(run(committed('a'), delta('a', 'half'), failed('a'))).toEqual([{ id: 'a', text: 'half', done: true }]);
  });

  it('returns the same list for events it does not handle', () => {
    const items = run(committed('a'));
    expect(reduceTranscript(items, { type: 'session.created' })).toBe(items);
    expect(reduceTranscript(items, { type: 'input_audio_buffer.speech_started' })).toBe(items);
  });
});

describe('transcriptText', () => {
  it('joins finished and partial text in order, skipping empty items', () => {
    const items = [
      { id: 'a', text: 'Woke up.', done: true },
      { id: 'b', text: '', done: false },
      { id: 'c', text: '  stomach off ', done: false },
    ];
    expect(transcriptText(items)).toBe('Woke up. stomach off');
  });

  it('is empty for no items', () => {
    expect(transcriptText([])).toBe('');
  });
});

describe('dictationErrorMessage', () => {
  it('uses its own sign-in wording for a 401', () => {
    expect(dictationErrorMessage(new VoiceApiError(401, 'Sign in to use talk mode.'))).toBe('Sign in to use voice notes.');
  });

  it('passes through the offline and daily-limit messages', () => {
    expect(dictationErrorMessage(new VoiceApiError(0, "Can't reach the voice service. Check your connection."))).toBe("Can't reach the voice service. Check your connection.");
    expect(dictationErrorMessage(new VoiceApiError(429, "You've hit today's voice-note limit. It resets at midnight UTC."))).toBe("You've hit today's voice-note limit. It resets at midnight UTC.");
  });

  it('is generic for any other worker failure', () => {
    expect(dictationErrorMessage(new VoiceApiError(503, 'This talk mode voice is not set up yet.'))).toBe('Something went wrong starting voice notes.');
  });

  it('shows a MicError as it is', () => {
    const err = Object.assign(new Error('No microphone found.'), { name: 'MicError' });
    expect(dictationErrorMessage(err)).toBe('No microphone found.');
  });

  it('treats any other Error as a connection failure', () => {
    expect(dictationErrorMessage(new Error('The voice service refused the connection.'))).toBe("Couldn't start voice notes. Try again in a moment.");
  });

  it('is generic for anything that is not an Error', () => {
    expect(dictationErrorMessage('boom')).toBe('Something went wrong starting voice notes.');
  });
});
