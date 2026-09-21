import { speak } from './voiceApi';

// Spoken lines, synthesized once and replayed from Cache Storage. Falls back to the browser's
// own speech synthesis when the voice service can't be reached, so talk mode degrades rather
// than going silent.
const CACHE = 'talk-mode-tts-v1';
const keyFor = (text) => `https://tts.local/${encodeURIComponent(text)}`;

const cached = async (text) => {
  try {
    return await (await (await caches.open(CACHE)).match(keyFor(text)))?.blob();
  } catch {
    return undefined; // Cache Storage unavailable (private mode): synthesize every time
  }
};

const fetchClip = async (text) => {
  const hit = await cached(text);
  if (hit) return hit;
  const blob = await speak(text);
  try {
    await (await caches.open(CACHE)).put(keyFor(text), new Response(blob, { headers: { 'Content-Type': 'audio/mpeg' } }));
  } catch {
    // not cached; still playable
  }
  return blob;
};

// iOS only lets an <audio> element play without a tap once it has played inside one. Talk mode
// speaks after async work (token, synthesis), so the launch tap primes this shared element.
let audio = null;
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
export const unlockAudio = () => {
  audio = audio || new Audio();
  audio.src = SILENCE;
  audio.play().catch(() => {});
};

export const createSpeaker = () => {
  audio = audio || new Audio();
  let settle = null;

  const stop = () => {
    audio.pause();
    window.speechSynthesis?.cancel();
    settle?.();
  };

  const playBlob = (blob) => new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    settle = () => {
      settle = null;
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onended = audio.onerror = () => settle?.();
    audio.src = url;
    audio.play().catch(() => settle?.());
  });

  const playSynth = (text) => new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    settle = () => {
      settle = null;
      resolve();
    };
    utterance.onend = utterance.onerror = () => settle?.();
    window.speechSynthesis.speak(utterance);
    // Some browsers never fire onend (no voices installed): don't let the conversation hang on it
    const mine = settle;
    setTimeout(() => settle === mine && settle(), 1200 + text.length * 70);
  });

  return {
    // Resolves when the line has finished (or was interrupted by stop())
    say: async (text) => {
      stop();
      let blob = null;
      try {
        blob = await fetchClip(text);
      } catch (err) {
        console.warn('[voice] TTS unavailable, using browser speech', err.message);
      }
      return blob ? playBlob(blob) : playSynth(text);
    },
    // Fetch clips ahead of time so the first run isn't a string of pauses
    warm: (texts) => texts.forEach((text) => fetchClip(text).catch(() => {})),
    stop,
    get speaking() { return settle !== null; },
  };
};
