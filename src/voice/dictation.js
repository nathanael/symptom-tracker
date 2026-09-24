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
