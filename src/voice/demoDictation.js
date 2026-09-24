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
