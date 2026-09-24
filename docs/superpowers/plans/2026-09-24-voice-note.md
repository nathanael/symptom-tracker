# Voice Note from Home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A purple "Note" pill in the Home dock opens a full-screen recorder that transcribes speech live, lets the user fix the text, and appends it to today's day note.

**Architecture:** The Cloudflare voice worker gains a `/transcribe-token` route that mints an OpenAI *transcription-only* realtime session. A new `src/voice/dictation.js` connects to it with the existing WebRTC helper and turns transcription events into an ordered list of items through a pure reducer; `finish()` flushes the last uncommitted sentence before closing. `VoiceNote.jsx` is the recorder/review UI with a Siri-style ribbon (`VoiceRibbon.jsx`), and App appends the saved text to `dailyNotes` through a pure `appendToNote`.

**Tech Stack:** React 18, Vite, Vitest (`environment: 'node'`), Cloudflare Workers (wrangler), OpenAI Realtime API over WebRTC.

**Spec:** `docs/superpowers/specs/2026-09-24-voice-note-design.md` — read it first. Mockups: `mockups/voice-note.html` (Dock 2, Recorder C, Review).

---

## Notes for the engineer

- **Git on this machine:** plain `git` fails with an Xcode licence error. Prefix every git command with `DEVELOPER_DIR=/Library/Developer/CommandLineTools`, e.g. `DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit …`. The commands below already do.
- **Commit trailer:** end every commit message with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** `npx vitest run <path>` runs one file; `npx vitest run` runs all (983 passing at the start). Tests run in Node — no DOM — so only pure functions and injected fakes are unit tested; UI is checked in the preview.
- **Do not deploy anything** (worker or app) until Task 11, and only after the user says yes.
- **Dev preview:** `npm run dev` serves at `http://localhost:5173/` (no base path in dev). `?notedemo` (added in Task 5) runs the recorder on a scripted fake so the UI can be checked without the worker or a mic.
- **Style:** match the surrounding code — short comments that say *why*, no semicolon-free style changes, 2-space indent, single quotes.

## File map

| File | Responsibility |
|---|---|
| `src/voice/webrtcConnection.js` (modify) | `micErrorMessage(err, feature)`; `connect` throws mic failures as `name = 'MicError'` |
| `src/utils/voiceNote.js` (create) | Pure note helpers: `noteTime`, `appendToNote`, `stripBars` |
| `src/voice/dictation.js` (create) | `reduceTranscript`, `transcriptText`, `dictationErrorMessage`, `createDictation` |
| `src/voice/demoDictation.js` (create) | Dev-only scripted stand-in for `createDictation` |
| `cloudflare/voice/src/index.js` (modify) | `POST /transcribe-token`, `DAILY_CAPS.notes` |
| `src/components/VoiceRibbon.jsx` (create) | The Siri-style canvas ribbon, driven by a level ref |
| `src/components/VoiceNote.jsx`, `voiceNote.css` (create) | Recorder → finishing → review / error screens |
| `src/components/BottomNav.jsx`, `mobileNav.css` (modify) | The purple Note pill in the Home dock |
| `src/App.jsx` (modify) | `showVoiceNote` state, save handler, render `VoiceNote` |

---

### Task 1: Feature-labelled, typed mic errors

**Files:**
- Modify: `src/voice/webrtcConnection.js:5-9` and `:28-33`
- Test: `src/voice/__tests__/webrtcConnection.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `src/voice/__tests__/webrtcConnection.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { micErrorMessage, connect } from '../webrtcConnection';

const named = (name) => Object.assign(new Error(name), { name });

describe('micErrorMessage', () => {
  it('keeps talk mode wording by default', () => {
    expect(micErrorMessage(named('NotAllowedError'))).toBe('Microphone access is blocked. Allow it for this site to use talk mode.');
  });

  it('names the feature it is given', () => {
    expect(micErrorMessage(named('SecurityError'), 'voice notes')).toBe('Microphone access is blocked. Allow it for this site to use voice notes.');
  });

  it('has feature-neutral wording for a missing or failed mic', () => {
    expect(micErrorMessage(named('NotFoundError'), 'voice notes')).toBe('No microphone found.');
    expect(micErrorMessage(named('AbortError'), 'voice notes')).toBe("Couldn't start the microphone.");
  });
});

describe('connect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws a MicError in the caller\'s words when the mic is refused', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(named('NotAllowedError')) } });
    await expect(connect({ secret: 's', onEvent: () => {}, feature: 'voice notes' })).rejects.toMatchObject({
      name: 'MicError',
      message: 'Microphone access is blocked. Allow it for this site to use voice notes.',
    });
  });

  it('defaults to talk mode wording when no feature is passed', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(named('NotAllowedError')) } });
    await expect(connect({ secret: 's', onEvent: () => {} })).rejects.toMatchObject({
      name: 'MicError',
      message: 'Microphone access is blocked. Allow it for this site to use talk mode.',
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/voice/__tests__/webrtcConnection.test.js`
Expected: FAIL — the "names the feature" test gets talk mode wording, and the `connect` tests get `name: 'Error'`.

- [ ] **Step 3: Implement**

In `src/voice/webrtcConnection.js`, replace `micErrorMessage`:

```js
// `feature` names what needs the mic, so talk mode and voice notes each read right
export const micErrorMessage = (err, feature = 'talk mode') => {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return `Microphone access is blocked. Allow it for this site to use ${feature}.`;
  if (err?.name === 'NotFoundError') return 'No microphone found.';
  return "Couldn't start the microphone.";
};
```

Change the `connect` signature and the `getUserMedia` catch:

```js
export const connect = async ({ secret, onEvent, onLevel, onClosed, playRemoteAudio = false, feature }) => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    // Named, so a caller can tell "the mic" apart from "the connection" without matching strings
    const micError = new Error(micErrorMessage(err, feature));
    micError.name = 'MicError';
    throw micError;
  }
```

(`feature` undefined falls through to the default parameter, so talk mode is unchanged.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/voice/__tests__/webrtcConnection.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add src/voice/webrtcConnection.js src/voice/__tests__/webrtcConnection.test.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(voice): feature-labelled mic errors, typed as MicError

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Note helpers — `noteTime`, `appendToNote`, `stripBars`

**Files:**
- Create: `src/utils/voiceNote.js`
- Test: `src/utils/__tests__/voiceNote.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/voiceNote.test.js`:

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/utils/__tests__/voiceNote.test.js`
Expected: FAIL — "Failed to resolve import '../voiceNote'".

- [ ] **Step 3: Implement**

Create `src/utils/voiceNote.js`:

```js
// Pure helpers for voice notes: how a spoken note is written into the day's note, and the still
// waveform shown on the review screen.

const pad = (n) => String(n).padStart(2, '0');

// Local 24-hour time, the prefix every voice note gets: "08:42"
export const noteTime = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

// The day's note with a timed line added after a blank line. Nothing to add leaves it as it was
// (apart from trailing whitespace, which is always trimmed).
export const appendToNote = (existing, text, date) => {
  const base = (existing || '').replace(/\s+$/, '');
  const body = (text || '').trim();
  if (!body) return base;
  const line = `${noteTime(date)} — ${body}`;
  return base ? `${base}\n\n${line}` : line;
};

// Mic levels sampled while recording, squeezed to at most `count` bars: each bar is the loudest
// reading in its slice, so short words still show
export const stripBars = (levels, count) => {
  if (!levels.length) return [];
  const n = Math.min(count, levels.length);
  return Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * levels.length) / n);
    const to = Math.max(Math.floor(((i + 1) * levels.length) / n), from + 1);
    return Math.max(...levels.slice(from, to));
  });
};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/utils/__tests__/voiceNote.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add src/utils/voiceNote.js src/utils/__tests__/voiceNote.test.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(voice-note): note helpers — timed append and review strip bars

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Transcript reducer and error wording

**Files:**
- Create: `src/voice/dictation.js`
- Test: `src/voice/__tests__/dictation.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/voice/__tests__/dictation.test.js`:

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/voice/__tests__/dictation.test.js`
Expected: FAIL — "Failed to resolve import '../dictation'".

- [ ] **Step 3: Implement**

Create `src/voice/dictation.js`:

```js
import { VoiceApiError } from './voiceApi';

// Voice notes: speech in, text out. One OpenAI transcription-only realtime session per note — no
// model ever answers. The service commits a stretch of speech at each pause and transcribes it as
// one "item"; the transcript is those items in order.

// ── Transcript ──

const findItem = (items, id) => items.findIndex((it) => it.id === id);
const setItem = (items, i, item) => items.map((it, j) => (j === i ? item : it));

// items: [{ id, text, done }] in the order each item_id was first seen. A commit always precedes
// its item's transcription events, so this is commit order in practice.
export const reduceTranscript = (items, event) => {
  const id = event?.item_id;
  const i = findItem(items, id);
  switch (event?.type) {
    case 'input_audio_buffer.committed':
      return i >= 0 ? items : [...items, { id, text: '', done: false }];
    case 'conversation.item.input_audio_transcription.delta':
      if (i < 0) return [...items, { id, text: event.delta || '', done: false }];
      if (items[i].done) return items;
      return setItem(items, i, { ...items[i], text: items[i].text + (event.delta || '') });
    case 'conversation.item.input_audio_transcription.completed': {
      const item = { id, text: event.transcript ?? '', done: true };
      return i < 0 ? [...items, item] : setItem(items, i, item);
    }
    case 'conversation.item.input_audio_transcription.failed':
      // Keep whatever was heard; `done` so finishing never waits on it
      return i < 0 ? [...items, { id, text: '', done: true }] : setItem(items, i, { ...items[i], done: true });
    default:
      return items;
  }
};

// Everything heard, finished or not
export const transcriptText = (items) => items.map((it) => it.text.trim()).filter(Boolean).join(' ');

// ── Errors ──

// One plain sentence for the recorder's error screen. `post` words its 401 for talk mode, so that
// one is replaced; offline and daily-limit messages already read right.
export const dictationErrorMessage = (err) => {
  if (err instanceof VoiceApiError) {
    if (err.status === 401) return 'Sign in to use voice notes.';
    if (err.status === 0 || err.status === 429) return err.message;
    return 'Something went wrong starting voice notes.';
  }
  if (err?.name === 'MicError') return err.message;
  if (err instanceof Error) return "Couldn't start voice notes. Try again in a moment.";
  return 'Something went wrong starting voice notes.';
};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/voice/__tests__/dictation.test.js`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add src/voice/dictation.js src/voice/__tests__/dictation.test.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(voice-note): transcript reducer and error wording

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `createDictation` — start, finish, cancel, drop

**Files:**
- Modify: `src/voice/dictation.js` (append)
- Test: `src/voice/__tests__/dictation.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/voice/__tests__/dictation.test.js` (and add `vi, afterEach` to the vitest import and `createDictation` to the `../dictation` import at the top of the file):

```js
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/voice/__tests__/dictation.test.js`
Expected: FAIL — `createDictation is not a function` (the Task 3 tests still pass).

- [ ] **Step 3: Implement**

At the top of `src/voice/dictation.js`, extend the imports:

```js
import { BASE, VoiceApiError, post } from './voiceApi';
import { connect as rtcConnect } from './webrtcConnection';
```

Append to `src/voice/dictation.js`:

```js
// ── Session ──

export const FINISH_TIMEOUT_MS = 3000;

const fetchToken = async () => (await post(`${BASE}/transcribe-token`, {})).json();

// createDictation({ onTranscript(items), onLevel(0..1), onDropped() })
//   -> { start(): Promise, finish(): Promise, cancel() }
// start() rejects with the token or connection error. onDropped fires only when the connection
// closes on its own while listening — never after finish() or cancel().
// getToken/connect are injectable for tests.
export const createDictation = ({ onTranscript, onLevel, onDropped, getToken = fetchToken, connect = rtcConnect, timeoutMs = FINISH_TIMEOUT_MS }) => {
  let items = [];
  let connection = null;
  let cancelled = false;
  let dropped = false;
  let finishing = null; // { replied } once finish() has sent its commit
  let finished = null;
  const waiters = new Set();
  const wake = () => waiters.forEach((check) => check());

  const onEvent = (event) => {
    if (event.type === 'error') {
      // While finishing, an error is the answer to our commit (nothing was left in the buffer)
      if (finishing) finishing.replied = true;
      else console.warn('[dictation]', event.error?.message || event.error?.code || event);
      wake();
      return;
    }
    if (finishing && event.type === 'input_audio_buffer.committed') finishing.replied = true;
    const next = reduceTranscript(items, event);
    if (next !== items) {
      items = next;
      onTranscript?.(items);
    }
    wake();
  };

  const onClosed = () => {
    dropped = true;
    wake();
    if (!finishing && !cancelled) onDropped?.();
  };

  const start = async () => {
    const { secret } = await getToken();
    if (cancelled) return;
    const conn = await connect({ secret, onEvent, onLevel, onClosed, feature: 'voice notes' });
    // Closed while connecting: never leave the mic running (and billed) behind a closed screen
    if (cancelled) {
      conn.close();
      return;
    }
    connection = conn;
  };

  // The stretch since the last pause has not been committed yet; closing now would lose it. So:
  // stop sending, commit, wait for the reply, wait for every item to finish — then close.
  const finish = () => {
    if (finished) return finished;
    finished = (async () => {
      if (!connection) return;
      if (dropped) {
        connection.close();
        return;
      }
      finishing = { replied: false };
      connection.setMuted(true);
      connection.send({ type: 'input_audio_buffer.commit' });
      await new Promise((resolve) => {
        let timer = null;
        const done = () => {
          clearTimeout(timer);
          waiters.delete(check);
          resolve();
        };
        function check() {
          if (dropped || (finishing.replied && items.every((it) => it.done))) done();
        }
        timer = setTimeout(done, timeoutMs);
        waiters.add(check);
        check();
      });
      connection.close();
    })();
    return finished;
  };

  const cancel = () => {
    cancelled = true;
    connection?.close();
  };

  return { start, finish, cancel };
};
```

Note: the new top-of-file import replaces the Task 3 `import { VoiceApiError } from './voiceApi';` line — keep exactly one import from `./voiceApi`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/voice/__tests__/dictation.test.js`
Expected: PASS (28 tests).

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add src/voice/dictation.js src/voice/__tests__/dictation.test.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(voice-note): createDictation — finish() keeps the last sentence, cancel is safe mid-connect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dev-only scripted dictation

For checking the recorder in the preview without the worker, a mic or a sign-in. Loaded only when `?notedemo` is in the URL of the dev server.

**Files:**
- Create: `src/voice/demoDictation.js`

- [ ] **Step 1: Create the file**

```js
import { reduceTranscript } from './dictation';

// Dev only (`?notedemo`): the same interface as createDictation, playing a scripted note so the
// recorder can be laid out without a mic, a sign-in or the worker.
const SCRIPT = [
  'Woke up with a mild headache behind the eyes.',
  'Took the magnesium last night and slept better than usual,',
  'but my stomach felt a bit off after breakfast.',
];

export const createDemoDictation = ({ onTranscript, onLevel }) => {
  let items = [];
  const timers = [];
  let levelTimer = null;
  let speaking = false;
  let cancelled = false;
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const apply = (event) => {
    items = reduceTranscript(items, event);
    onTranscript?.(items);
  };
  const halt = () => {
    cancelled = true;
    timers.forEach(clearTimeout);
    clearInterval(levelTimer);
  };

  const start = async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (cancelled) return;
    levelTimer = setInterval(() => onLevel?.(speaking ? 0.25 + Math.random() * 0.5 : Math.random() * 0.05), 80);
    let t = 0;
    SCRIPT.forEach((sentence, n) => {
      const id = `demo${n}`;
      later(t, () => { speaking = true; apply({ type: 'input_audio_buffer.committed', item_id: id }); });
      sentence.split(' ').forEach((word, i) => {
        later((t += 260), () => apply({ type: 'conversation.item.input_audio_transcription.delta', item_id: id, delta: (i ? ' ' : '') + word }));
      });
      later((t += 400), () => { speaking = false; apply({ type: 'conversation.item.input_audio_transcription.completed', item_id: id, transcript: sentence }); });
      t += 900;
    });
  };

  return {
    start,
    finish: async () => {
      halt();
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
    cancel: halt,
  };
};
```

- [ ] **Step 2: Check it parses**

Run: `npx esbuild src/voice/demoDictation.js --log-level=error > /dev/null && echo ok`
Expected: `ok`. (Don't try to `import()` it in plain Node: the repo's imports have no file extensions, which only Vite/Vitest resolve.)

- [ ] **Step 3: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add src/voice/demoDictation.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "chore(voice-note): scripted dictation for the dev preview (?notedemo)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Worker route `POST /transcribe-token`

**Files:**
- Modify: `cloudflare/voice/src/index.js` — header comment (lines 1-7), `DAILY_CAPS` (line ~19), new function after `openaiToken` (~line 167), `routes` (~line 237)

The session shape below is checked against OpenAI's realtime transcription guide (2026-09-24): a client secret for `session.type: 'transcription'` with `audio.input.transcription.model`, `audio.input.turn_detection` and `audio.input.noise_reduction`. Over WebRTC the audio format is negotiated, so `format` is omitted.

- [ ] **Step 1: Add the daily cap**

Change:

```js
const DAILY_CAPS = { sessions: 150, meals: 50 };
```

to:

```js
const DAILY_CAPS = { sessions: 150, meals: 50, notes: 100 };
```

and in the comment above it change "`sessions` is talk mode; `meals` is photo/text meal analysis." to "`sessions` is talk mode; `meals` is photo/text meal analysis; `notes` is voice notes."

- [ ] **Step 2: Add the route function**

Directly after the closing `};` of `openaiToken`, add:

```js
// Voice notes: a transcription-only session. Speech in, text out; no model ever answers. Server
// VAD commits a stretch at each pause so the app gets it back sentence by sentence.
const transcribeToken = async (env, uid) => {
  requireKey(env, 'OPENAI_API_KEY');
  await spend(env, uid, 'notes', 1, "You've hit today's voice-note limit. It resets at midnight UTC.");
  const model = setting(env, 'TALK_TRANSCRIBE_MODEL');
  const session = {
    type: 'transcription',
    audio: {
      input: {
        transcription: { model },
        noise_reduction: { type: 'near_field' },
        turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
      },
    },
  };
  const data = await (await openai(env, '/realtime/client_secrets', { session })).json();
  return Response.json({ secret: data.value, expiresAt: data.expires_at, model });
};
```

- [ ] **Step 3: Register it**

Change:

```js
const routes = { 'gemini-token': geminiToken, token: openaiToken, log: saveLog, meal };
```

to:

```js
const routes = { 'gemini-token': geminiToken, token: openaiToken, 'transcribe-token': transcribeToken, log: saveLog, meal };
```

- [ ] **Step 4: Document it in the header**

After the line `//   POST /token          -> { secret }          OpenAI realtime (secret OPENAI_API_KEY)` add:

```js
//   POST /transcribe-token -> { secret }        OpenAI transcription-only session, for voice notes
```

- [ ] **Step 5: Check it parses**

Run: `node --check cloudflare/voice/src/index.js`
Expected: no output.

- [ ] **Step 6: Commit (do not deploy)**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add cloudflare/voice/src/index.js
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(voice-worker): /transcribe-token for voice notes, own daily cap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `VoiceRibbon` — the Siri-style waveform

**Files:**
- Create: `src/components/VoiceRibbon.jsx`

No unit test (canvas, Node test environment); checked in the preview in Task 10.

- [ ] **Step 1: Create the component**

```jsx
import { useEffect, useRef } from 'react';

// rgb, relative size, phase: three waves added together so they glow where they cross
const WAVES = [['56,189,248', 1, 0], ['167,139,250', 0.8, 1.7], ['244,114,182', 0.6, 3.1]];

// The voice as a ribbon: three soft waves that swell with the mic level and taper to a point at
// both edges. Reads the level from a ref so audio-rate updates never re-render. `active` false
// lets it settle to a thin line (connecting, finishing).
export default function VoiceRibbon({ levelRef, active }) {
  const canvasRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let energy = 0;
    let frame = 0;
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const target = activeRef.current ? Math.min(1, (levelRef.current || 0) * 1.6) : 0;
      energy += (target - energy) * (target > energy ? 0.3 : 0.08);
      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;

      // Reduced motion: a steady line whose thickness follows the voice
      if (still) {
        const h = 1.5 + energy * 10;
        ctx.fillStyle = 'rgba(167,139,250,.8)';
        ctx.fillRect(width * 0.08, mid - h / 2, width * 0.84, h);
        return;
      }

      const t = now / 1000;
      ctx.globalCompositeOperation = 'lighter';
      for (const [rgb, k, phase] of WAVES) {
        const amp = (3 + energy * height * 0.36) * k;
        // sin² envelope: zero at both edges, full in the middle
        const y = (x, side) => {
          const u = x / width;
          return mid + side * Math.sin(u * 9 + t * 3.2 * k + phase) * amp * Math.sin(Math.PI * u) ** 2;
        };
        ctx.beginPath();
        ctx.moveTo(0, y(0, 1));
        for (let x = 3; x <= width; x += 3) ctx.lineTo(x, y(x, 1));
        for (let x = width; x >= 0; x -= 3) ctx.lineTo(x, y(x, -0.6));
        ctx.closePath();
        ctx.fillStyle = `rgba(${rgb},.28)`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},.8)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [levelRef]);

  return <canvas ref={canvasRef} className="vn-ribbon" aria-hidden="true" />;
}
```

- [ ] **Step 2: Check it parses**

It is not imported anywhere yet, so the build would not see it. Parse it on its own:

Run: `npx esbuild src/components/VoiceRibbon.jsx --loader:.jsx=jsx --log-level=error > /dev/null && echo ok`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add src/components/VoiceRibbon.jsx
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(voice-note): VoiceRibbon, the Siri-style waveform

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `VoiceNote` — recorder, finishing, review, error

**Files:**
- Create: `src/components/VoiceNote.jsx`
- Create: `src/components/voiceNote.css`

- [ ] **Step 1: Create the stylesheet**

Create `src/components/voiceNote.css`:

```css
/* Voice note: a full-screen recorder over everything. Portalled to <body> so the dock can't paint
   over it (iOS draws fixed layers inside the app's scroll container under the dock). */
.vn { position: fixed; inset: 0; z-index: 300; display: flex; flex-direction: column; background: radial-gradient(120% 70% at 50% 100%, #1a1030 0%, #08090a 60%); color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
.vn button, .vn textarea { font-family: inherit; }
.vn button { cursor: pointer; -webkit-tap-highlight-color: transparent; }

.vn-top { flex: none; display: grid; grid-template-columns: 64px 1fr 64px; align-items: center; padding: calc(12px + env(safe-area-inset-top)) 16px 0; }
.vn-x { width: 40px; height: 40px; border: 0; border-radius: 50%; background: rgba(255,255,255,.06); color: #9ca3af; display: grid; place-items: center; }
.vn-x svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
.vn-when { text-align: center; }
.vn-when b { display: block; font-size: 15px; font-weight: 600; }
.vn-when small { font-size: 12px; color: #6b7280; }
.vn-timer { justify-self: end; display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; color: #6b7280; }
.vn-timer.on { color: #f87171; }
.vn-timer i { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; animation: vn-blink 1.2s infinite; }
@keyframes vn-blink { 50% { opacity: .25; } }

/* Words fill the screen, newest line just above the ribbon; older lines fade out at the top */
.vn-words { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end; padding: 28px 24px 0; font-size: 24px; line-height: 1.35; font-weight: 500; letter-spacing: -.01em; -webkit-mask-image: linear-gradient(transparent, #000 30%); mask-image: linear-gradient(transparent, #000 30%); }
.vn-words .old { color: #6b7280; }
.vn-words .now { color: #f3f4f6; }
.vn-words .live { color: #c4b5fd; }
.vn-caret { display: inline-block; width: 2px; height: 1em; margin-left: 1px; vertical-align: -3px; background: #a78bfa; animation: vn-blink 1s infinite; }
.vn-finishing { margin: 10px 0 0; font-size: 14px; font-weight: 400; color: #9ca3af; }
.vn-ribbon { display: block; flex: none; width: 100%; height: 170px; }

.vn-controls { flex: none; display: flex; justify-content: center; padding: 8px 0 calc(28px + env(safe-area-inset-bottom)); }
.vn-stop { width: 78px; height: 78px; border-radius: 50%; border: 3px solid rgba(255,255,255,.85); background: none; display: grid; place-items: center; transition: opacity .2s, transform .1s; }
.vn-stop i { width: 30px; height: 30px; border-radius: 8px; background: #ef4444; }
.vn-stop:disabled { opacity: .35; cursor: default; }
.vn-stop:not(:disabled):active { transform: scale(.96); }

/* Review */
.vn.review { background: #08090a; }
.vn-notice { flex: none; margin: 16px 18px 0; font-size: 13px; color: #fbbf24; }
.vn-edit { flex: 1; min-height: 0; margin: 18px 16px 0; padding: 16px; border-radius: 16px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); color: #f3f4f6; font-size: 18px; line-height: 1.5; resize: none; outline: none; }
.vn-edit:focus { border-color: rgba(167,139,250,.5); }
.vn-strip { flex: none; margin: 12px 16px 0; height: 44px; padding: 0 12px; border-radius: 12px; background: rgba(255,255,255,.04); display: flex; align-items: center; gap: 2px; }
.vn-strip span { flex: 1; border-radius: 2px; background: #6b7280; }
.vn-dest { flex: none; margin: 12px 18px 0; font-size: 12px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vn-dest b { color: #9ca3af; font-weight: 500; }
.vn-acts { flex: none; display: flex; gap: 10px; padding: 16px 16px calc(24px + env(safe-area-inset-bottom)); }
.vn-btn { flex: 1; height: 54px; border: 0; border-radius: 18px; background: rgba(255,255,255,.06); color: #d1d5db; font-size: 16px; font-weight: 600; }
.vn-btn.primary { background: #8b5cf6; color: #fff; }
.vn-btn.primary:disabled { opacity: .4; cursor: default; }
.vn-btn.danger { background: rgba(239,68,68,.16); color: #fca5a5; }
.vn-confirm { flex: none; }
.vn-confirm p { margin: 16px 0 0; text-align: center; font-size: 15px; color: #e5e7eb; }

/* Error */
.vn-error { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 10px; padding: 24px 24px calc(24px + env(safe-area-inset-bottom)); }
.vn-error p { margin: 0 0 14px; text-align: center; font-size: 17px; line-height: 1.45; color: #e5e7eb; }
.vn-error .vn-btn { flex: none; }
```

- [ ] **Step 2: Create the component**

Create `src/components/VoiceNote.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './voiceNote.css';
import { createDictation, dictationErrorMessage, transcriptText } from '../voice/dictation';
import { createDemoDictation } from '../voice/demoDictation';
import { noteTime, stripBars } from '../utils/voiceNote';
import VoiceRibbon from './VoiceRibbon';

const LIMIT_MS = 10 * 60 * 1000; // a note stops itself here, bounding its cost
const SAMPLE_MS = 150; // how often the timer ticks and the review strip samples the level
const STRIP_BARS = 70;
// Scripted note for laying the screen out, dev server only
const DEMO = import.meta.env.DEV && new URLSearchParams(window.location.search).has('notedemo');

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const firstWords = (text, n = 4) => {
  const words = text.trim().split(/\s+/);
  return words.length > n ? `${words.slice(0, n).join(' ')}…` : words.join(' ');
};

// Full-screen voice note: listen → (stop) finishing → review → save to today's note.
// phase: connecting | listening | finishing | review | error
export default function VoiceNote({ onSave, onClose, onTypeInstead }) {
  const [phase, setPhase] = useState('connecting');
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [dropped, setDropped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [bars, setBars] = useState([]);
  const levelRef = useRef(0);
  // Read from callbacks that outlive a render
  const live = useRef({ phase: 'connecting', items: [], history: [], startedAt: 0 });
  const dictation = useRef(null);

  const enter = (next) => {
    live.current.phase = next;
    setPhase(next);
    // A "Discard this note?" prompt belongs to the screen it was asked on
    setConfirming(false);
  };

  const toReview = () => {
    if (live.current.phase === 'review') return;
    levelRef.current = 0;
    setText(transcriptText(live.current.items));
    setBars(stripBars(live.current.history, STRIP_BARS));
    enter('review');
  };

  const stop = () => {
    if (live.current.phase !== 'listening') return;
    enter('finishing');
    levelRef.current = 0;
    dictation.current.finish().then(toReview);
  };

  const discard = () => {
    dictation.current?.cancel();
    onClose();
  };

  useEffect(() => {
    let disposed = false;
    const create = DEMO ? createDemoDictation : createDictation;
    const d = create({
      onTranscript: (next) => {
        live.current.items = next;
        if (!disposed) setItems(next);
      },
      // Only while listening: once Stop is pressed the ribbon settles even though the mic is open
      onLevel: (value) => { levelRef.current = live.current.phase === 'listening' ? value : 0; },
      // Only a drop while listening means "keep what was heard". A handshake that dies stays on
      // "Getting ready…" until ×, as talk mode does today.
      onDropped: () => {
        if (disposed || live.current.phase !== 'listening') return;
        setDropped(true);
        toReview();
      },
    });
    dictation.current = d;
    d.start()
      .then(() => {
        if (disposed) return;
        live.current.startedAt = Date.now();
        enter('listening');
      })
      .catch((err) => {
        if (disposed) return;
        setError(dictationErrorMessage(err));
        enter('error');
      });
    return () => {
      disposed = true;
      d.cancel();
    };
    // One dictation per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer, review-strip samples and the 10-minute stop
  useEffect(() => {
    if (phase !== 'listening') return undefined;
    const timer = setInterval(() => {
      const ms = Date.now() - live.current.startedAt;
      live.current.history.push(levelRef.current);
      setSeconds(Math.floor(ms / 1000));
      if (ms >= LIMIT_MS) stop();
    }, SAMPLE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // iOS takes the mic from a backgrounded app: keep what was heard rather than lose it
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return;
      if (live.current.phase === 'listening') stop();
      else if (live.current.phase === 'connecting') discard();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  const heard = transcriptText(items) !== '';
  const hasText = phase === 'review' ? text.trim() !== '' : heard;
  const close = () => {
    if (phase === 'finishing') return; // a moment from review; × is ignored rather than half-handled
    if (hasText && (phase === 'listening' || phase === 'review')) setConfirming(true);
    else discard();
  };

  const confirmRow = (keepLabel) => (
    <div className="vn-confirm">
      <p>Discard this note?</p>
      <div className="vn-acts">
        <button type="button" className="vn-btn danger" onClick={discard}>Discard</button>
        <button type="button" className="vn-btn" onClick={() => setConfirming(false)}>{keepLabel}</button>
      </div>
    </div>
  );

  // Older finished sentences grey, the latest finished one white, anything still being heard purple
  const lastDone = items.reduce((at, it, i) => (it.done && it.text.trim() ? i : at), -1);
  const now = new Date();

  return createPortal(
    <div className={`vn ${phase}`} role="dialog" aria-label="Voice note">
      <div className="vn-top">
        <button type="button" className="vn-x" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <div className="vn-when">
          <b>{phase === 'review' ? 'Review note' : "Today's note"}</b>
          <small>{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</small>
        </div>
        <div className={`vn-timer${phase === 'listening' ? ' on' : ''}`}>
          {phase === 'listening' && <i />}
          {phase !== 'connecting' && phase !== 'error' && clock(seconds)}
        </div>
      </div>

      {phase === 'error' && (
        <div className="vn-error">
          <p>{error}</p>
          <button type="button" className="vn-btn primary" onClick={onTypeInstead}>Type instead</button>
          <button type="button" className="vn-btn" onClick={onClose}>Close</button>
        </div>
      )}

      {phase === 'review' && (
        <>
          {dropped && <p className="vn-notice">Connection lost — this is what was heard.</p>}
          <textarea className="vn-edit" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nothing was heard." aria-label="Note text" />
          {bars.length > 0 && (
            <div className="vn-strip" aria-hidden="true">
              {bars.map((v, i) => <span key={i} style={{ height: `${Math.max(3, v * 30)}px` }} />)}
            </div>
          )}
          <p className="vn-dest">Adds to <b>today's note</b>{text.trim() && ` as "${noteTime(now)} — ${firstWords(text)}"`}</p>
          {confirming ? confirmRow('Keep editing') : (
            <div className="vn-acts">
              <button type="button" className="vn-btn" onClick={discard}>Discard</button>
              <button type="button" className="vn-btn primary" disabled={!text.trim()} onClick={() => onSave(text.trim())}>Save</button>
            </div>
          )}
        </>
      )}

      {(phase === 'connecting' || phase === 'listening' || phase === 'finishing') && (
        <>
          <div className="vn-words" aria-live="polite">
            <div>
              {phase === 'connecting' && <span className="old">Getting ready…</span>}
              {phase === 'listening' && !heard && <span className="old">Listening…</span>}
              {items.map((it, i) => it.text.trim() && (
                <span key={it.id} className={!it.done ? 'live' : i === lastDone ? 'now' : 'old'}>{it.text.trim()} </span>
              ))}
              {phase === 'listening' && heard && <span className="vn-caret" />}
            </div>
            {phase === 'finishing' && <p className="vn-finishing">Finishing…</p>}
          </div>
          <VoiceRibbon levelRef={levelRef} active={phase === 'listening'} />
          {confirming ? confirmRow('Keep recording') : (
            <div className="vn-controls">
              <button type="button" className="vn-stop" aria-label="Stop" disabled={phase !== 'listening'} onClick={stop}><i /></button>
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: Check it builds and tests still pass**

Run: `npx vitest run && npm run build`
Expected: all tests pass; `✓ built in …`.

- [ ] **Step 4: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add src/components/VoiceNote.jsx src/components/voiceNote.css
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(voice-note): recorder, finishing, review and error screens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Note pill in the Home dock, and App wiring

**Files:**
- Modify: `src/components/BottomNav.jsx` (props list; dock JSX between the `mn-tabs` div and the `mn-more` button)
- Modify: `src/components/mobileNav.css` (after the `.mn-adv` rules and in the reduced-motion block)
- Modify: `src/App.jsx` (imports; state near `showTalkMode`; handler near `addDayNote`; `<BottomNav>` props; render near `{/* Note Modal */}`)

- [ ] **Step 1: BottomNav — accept the handler and render the pill**

In `src/components/BottomNav.jsx`, add `onVoiceNote,` to the destructured props after `onLogMeal,`.

Then, between the closing `</div>` of `<div className={`mn-tabs${easy ? ' easy' : ''}`}>` and the `<button className={`mn-more …`}>`, insert:

```jsx
          {/* Home only. Always mounted so it can fold away with the tabs, like "Advanced mode" */}
          <button
            className={`mn-note${easy ? ' easy' : ''}`}
            tabIndex={easy ? 0 : -1}
            aria-hidden={!easy || undefined}
            aria-label="Record a note"
            onClick={onVoiceNote}
          >
            <svg viewBox="0 0 24 24">{solar.mic}</svg><span>Note</span>
          </button>
```

- [ ] **Step 2: Style the pill**

In `src/components/mobileNav.css`, after the line starting `.mn-adv:active`, add:

```css
/* Home: a purple Note pill between Advanced mode and ⋯, the same height and corners as the
   Advanced mode pill. Collapses to nothing (width, the dock's 10px gap via the margin, opacity)
   when the tabs unfold, so they get the full width back. */
.mn-note { flex: none; width: 0; height: 56px; margin-left: -10px; padding: 0; overflow: hidden; border: 0; border-radius: 22px; background: linear-gradient(135deg, #7c3aed, #a855f7); color: #fff; display: flex; align-items: center; justify-content: center; gap: 7px; font-size: 15px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; opacity: 0; pointer-events: none; box-shadow: inset 0 0 0 1px rgba(255,255,255,.18), 0 10px 30px rgba(124,58,237,.35); transition: width .32s cubic-bezier(.22,1,.36,1), margin .32s cubic-bezier(.22,1,.36,1), opacity .18s ease; }
.mn-note.easy { width: 108px; margin-left: 0; opacity: 1; pointer-events: auto; transition-delay: .16s; }
.mn-note svg { width: 20px; height: 20px; }
.mn-note:active { filter: brightness(1.12); }
/* 320pt phones: Advanced mode is left about 110px, so its label and the gaps tighten */
@media (max-width: 359px) {
  .mn-dock-in { gap: 8px; }
  .mn-adv { font-size: 14px; }
  .mn-note { margin-left: -8px; }
  .mn-note.easy { margin-left: 0; }
}
```

and change the reduced-motion rule:

```css
  .mn-tablist button, .mn-adv { transition: none; }
```

to:

```css
  .mn-tablist button, .mn-adv, .mn-note { transition: none; }
```

- [ ] **Step 3: App — imports, state, handler, props, render**

In `src/App.jsx`:

1. After `import NoteModal from './components/NoteModal';` add:

```js
import VoiceNote from './components/VoiceNote';
import { appendToNote } from './utils/voiceNote';
```

2. After `const [showTalkMode, setShowTalkMode] = useState(false);` add:

```js
  const [showVoiceNote, setShowVoiceNote] = useState(false);
```

3. After the `addDayNote` `useCallback` block (ends `}, [selectedDate, setDailyNotes]);`), add:

```js
  // A voice note always lands on today, keyed when it is saved (not when it was started)
  const saveVoiceNote = useCallback((text) => {
    const now = new Date();
    const dateKey = getDateKey(now);
    setDailyNotes((prev) => ({ ...prev, [dateKey]: { text: appendToNote(noteText(prev[dateKey]), text, now) } }));
    setShowVoiceNote(false);
    setCopyToastMessage("Saved to today's note");
    setTimeout(() => setCopyToastMessage(''), 2250);
  }, [setDailyNotes]);
```

4. In the `<BottomNav …>` props, after `onLogMeal={() => setMealSheet({})}` add:

```jsx
          onVoiceNote={() => setShowVoiceNote(true)}
```

5. Directly before `{/* Note Modal */}` add:

```jsx
      {/* Voice note (Home dock) */}
      {showVoiceNote && (
        <VoiceNote
          onSave={saveVoiceNote}
          onClose={() => setShowVoiceNote(false)}
          onTypeInstead={() => { setShowVoiceNote(false); setShowNoteModal(true); }}
        />
      )}

```

- [ ] **Step 4: Tests and build**

Run: `npx vitest run && npm run build`
Expected: all tests pass; `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add src/components/BottomNav.jsx src/components/mobileNav.css src/App.jsx
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "feat(voice-note): Note pill in the Home dock, saved to today's note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Check it in the preview

Uses the dev server (`npm run dev`, or the preview server named `symptom-tracker` in `.claude/launch.json`) at a phone viewport. `?notedemo` swaps in the scripted dictation.

- [ ] **Step 1: Dock at 375×812** — open `http://localhost:5173/?notedemo`. On Home the dock reads `Advanced mode | [mic] Note | ⋯`, the Note pill purple, 108×56, corners matching Advanced mode. In the console: `[...document.querySelectorAll('.mn-dock-in > *')].map(e => Math.round(e.getBoundingClientRect().height))` → `[56, 56, 54]`.

- [ ] **Step 2: Dock collapse** — tap Advanced mode. The pill fades and collapses; the four tabs take the full width with no leftover gap before ⋯. Tap Home: the pill grows back.

- [ ] **Step 3: Dock at 320×568** — "Advanced mode" fits on one line without clipping.

- [ ] **Step 4: Recorder** — tap Note. "Getting ready…" then words appear sentence by sentence: the sentence being spoken in purple with a caret, the latest finished one white, older ones grey and fading toward the top; the ribbon swells while "speaking" and settles between sentences; the timer counts in red.

- [ ] **Step 5: Finishing and review** — tap Stop mid-sentence. "Finishing…" shows briefly, then the review screen: editable text including the half-finished sentence, the grey bar strip, `Adds to today's note as "HH:MM — Woke up with a…"`, Discard / Save.

- [ ] **Step 6: Save** — Save closes the screen and shows "Saved to today's note". Advanced mode → ⋯ → Day notes shows the note with its time; a second voice note is added after a blank line.

- [ ] **Step 7: Discard paths** — × while listening with words shows "Discard this note?" with Discard / Keep recording; Keep recording carries on. × in review with text asks the same with Keep editing. × before any words closes straight away.

- [ ] **Step 8: Error path** — open `http://localhost:5173/` (no `?notedemo`) while signed out and tap Note: "Sign in to use voice notes." with Type instead (opens Day notes) and Close.

- [ ] **Step 9: Stacking** — with the recorder open, nothing from the app shows on top of it (dock, toasts, undo toast). If something does, raise `.vn`'s `z-index` above it.

- [ ] **Step 10: Reset the viewport** to desktop and confirm the desktop app has no Note pill and is unchanged.

Fix anything that fails, re-run `npx vitest run && npm run build`, and commit the fix with a message describing it.

---

### Task 11: Release (ask the user first)

The worker must be live before the app, or the Note button fails with "Something went wrong starting voice notes."

- [ ] **Step 1: Ask the user** to confirm deploying the voice worker (`cloudflare/voice`) — it is their production backend and runs on their OpenAI key. Do not continue without a yes.

- [ ] **Step 2: Deploy the worker**

Run (from `cloudflare/voice`): `npx wrangler deploy`
Expected: `Uploaded glimpse-voice` … `Deployed glimpse-voice triggers`.

- [ ] **Step 3: Release the app** per `CLAUDE.md`

```bash
npm version <next patch or minor> --no-git-tag-version
DEVELOPER_DIR=/Library/Developer/CommandLineTools git add package.json package-lock.json
DEVELOPER_DIR=/Library/Developer/CommandLineTools git commit -m "chore: release v<x.y.z> (voice notes from Home)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
DEVELOPER_DIR=/Library/Developer/CommandLineTools git push
npm run build && DEVELOPER_DIR=/Library/Developer/CommandLineTools npm run deploy
```

Expected: push succeeds; deploy prints `Published`.

- [ ] **Step 4: Hand the phone test to the user** — in the PWA after updating: dictate a few sentences and tap Stop right after the last word (the last sentence must be in the review); lock the screen mid-note (review may only appear on return); airplane mode → the offline message with Type instead.
