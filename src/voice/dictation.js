import { BASE, VoiceApiError, post } from './voiceApi';
import { connect as rtcConnect } from './webrtcConnection';

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
    // The reply to our commit: a `committed`, or the final transcript itself (gpt-live-transcribe
    // streams with no turn detection and need not confirm the commit). Either way we still wait
    // below for every item to finish, which is what keeps the last sentence in the transcript.
    if (finishing && (event.type === 'input_audio_buffer.committed' || event.type === 'conversation.item.input_audio_transcription.completed')) finishing.replied = true;
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
    // Closed while connecting, or finish() already ran and found no connection to close: never
    // leave the mic running (and billed) behind a closed screen
    if (cancelled || finished) {
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
      try {
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
            if (cancelled || dropped || (finishing.replied && items.every((it) => it.done))) done();
          }
          timer = setTimeout(done, timeoutMs);
          waiters.add(check);
          check();
        });
      } finally {
        // Idempotent, so this is safe even if the connection was already closed elsewhere
        connection.close();
      }
    })();
    return finished;
  };

  const cancel = () => {
    cancelled = true;
    connection?.close();
    wake();
  };

  return { start, finish, cancel };
};
