import { describe, it, expect, vi, afterEach } from 'vitest';
import { reduceTranscript, transcriptText, dictationErrorMessage, createDictation } from '../dictation';
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

// A connection that records what the dictation does to it; `hooks` are the callbacks it was given
const setup = ({ getToken = async () => ({ secret: 's' }), connectImpl } = {}) => {
  const conn = { sent: [], setMuted: vi.fn(), send: vi.fn((e) => conn.sent.push(e)), close: vi.fn() };
  let hooks = null;
  const connect = vi.fn(connectImpl || (async (args) => { hooks = args; return conn; }));
  const onTranscript = vi.fn();
  const onDropped = vi.fn();
  const dictation = createDictation({ onTranscript, onDropped, getToken, connect });
  return { dictation, conn, connect, onTranscript, onDropped, emit: (e) => hooks.onEvent(e), drop: () => hooks.onClosed(), hooks: () => hooks };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const lastText = (onTranscript) => transcriptText(onTranscript.mock.calls.at(-1)[0]);

describe('createDictation', () => {
  afterEach(() => vi.useRealTimers());

  it('connects with the token and labels the mic for voice notes', async () => {
    const { dictation, connect } = setup();
    await dictation.start();
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ secret: 's', feature: 'voice notes' }));
  });

  it('reports the transcript as it changes', async () => {
    const { dictation, emit, onTranscript } = setup();
    await dictation.start();
    emit(committed('a'));
    emit(delta('a', 'Hello'));
    expect(lastText(onTranscript)).toBe('Hello');
  });

  it('rejects start() with the token error', async () => {
    const err = new VoiceApiError(401, 'Sign in to use talk mode.');
    const { dictation } = setup({ getToken: async () => { throw err; } });
    await expect(dictation.start()).rejects.toBe(err);
  });

  it('finish() mutes, commits once, and waits for the last sentence', async () => {
    const { dictation, conn, emit, onTranscript, onDropped } = setup();
    await dictation.start();
    emit(committed('a'));
    emit(completed('a', 'Hello.'));
    let resolved = false;
    const finished = dictation.finish().then(() => { resolved = true; });
    expect(conn.setMuted).toHaveBeenCalledWith(true);
    expect(conn.sent).toEqual([{ type: 'input_audio_buffer.commit' }]);
    await tick();
    // Every earlier item is done, but the commit has not been answered: keep waiting
    expect(resolved).toBe(false);
    emit(committed('b'));
    await tick();
    expect(resolved).toBe(false);
    emit(completed('b', 'Last words.'));
    await finished;
    expect(lastText(onTranscript)).toBe('Hello. Last words.');
    expect(conn.close).toHaveBeenCalled();
    expect(onDropped).not.toHaveBeenCalled();
  });

  it('finish() resolves on the empty-buffer error when nothing was left', async () => {
    const { dictation, conn, emit } = setup();
    await dictation.start();
    const finished = dictation.finish();
    emit({ type: 'error', error: { code: 'input_audio_buffer_commit_empty', message: 'buffer too small' } });
    await finished;
    expect(conn.close).toHaveBeenCalled();
  });

  it('finish() gives up after 3 seconds', async () => {
    vi.useFakeTimers();
    const { dictation, conn } = setup();
    await dictation.start();
    let resolved = false;
    dictation.finish().then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(2999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    expect(conn.close).toHaveBeenCalled();
  });

  it('finish() resolves at once if the connection drops while waiting, without onDropped', async () => {
    const { dictation, drop, onDropped } = setup();
    await dictation.start();
    const finished = dictation.finish();
    drop();
    await finished;
    expect(onDropped).not.toHaveBeenCalled();
  });

  it('finish() is idempotent', async () => {
    const { dictation, conn, emit } = setup();
    await dictation.start();
    const first = dictation.finish();
    expect(dictation.finish()).toBe(first);
    emit({ type: 'error', error: { code: 'input_audio_buffer_commit_empty' } });
    await first;
    expect(conn.sent).toHaveLength(1);
  });

  it('reports a drop while listening', async () => {
    const { dictation, drop, onDropped } = setup();
    await dictation.start();
    drop();
    expect(onDropped).toHaveBeenCalledTimes(1);
  });

  it('cancel() during start closes the connection when it arrives and reports nothing', async () => {
    let release;
    const conn = { setMuted: vi.fn(), send: vi.fn(), close: vi.fn() };
    const { dictation, onTranscript, onDropped } = setup({
      connectImpl: () => new Promise((resolve) => { release = () => resolve(conn); }),
    });
    const started = dictation.start();
    await tick();
    dictation.cancel();
    release();
    await started;
    expect(conn.close).toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onDropped).not.toHaveBeenCalled();
  });

  it('cancel() before the token arrives never connects', async () => {
    let release;
    const { dictation, connect } = setup({ getToken: () => new Promise((resolve) => { release = () => resolve({ secret: 's' }); }) });
    const started = dictation.start();
    dictation.cancel();
    release();
    await started;
    expect(connect).not.toHaveBeenCalled();
  });
});
