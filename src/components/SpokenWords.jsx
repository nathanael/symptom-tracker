import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { wordAt } from '../voice/speechPace';

// Roughly a word every 340ms when the engine cannot tell us where the audio is
const FALLBACK_MS = 340;

// What she is saying, as a ribbon of words sliding past: the word being spoken sits in the middle,
// a couple either side for context. `progress` is how far through the current utterance the audio
// actually is (0..1, null when unknown), so the words track her voice rather than a guessed pace.
export default function SpokenWords({ text, progress }) {
  const words = useMemo(() => (text || '').split(/\s+/).filter(Boolean), [text]);
  const [count, setCount] = useState(0);
  const live = useRef({ count: 0, first: '', started: 0 });
  live.current.words = words;
  live.current.progress = progress;

  useEffect(() => {
    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick);
      const state = live.current;
      const all = state.words;
      if (!all.length) return;
      // Her next turn starts the ribbon over
      if (state.first !== all[0]) {
        state.first = all[0];
        state.started = now;
        state.count = 0;
        setCount(0);
      }
      const fraction = state.progress?.();
      const target = fraction === null || fraction === undefined
        ? Math.floor((now - state.started) / FALLBACK_MS) + 1
        : wordAt(all, fraction);
      // Only ever forwards: late transcript makes the fraction jump back, and rereading is worse
      const next = Math.min(all.length, Math.max(state.count, target));
      if (next !== state.count) {
        state.count = next;
        setCount(next);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const innerRef = useRef(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const word = innerRef.current?.children[Math.max(0, count - 1)];
    if (word) setShift(word.offsetLeft + word.offsetWidth / 2);
  }, [count, words]);

  return (
    <div className="tm-words">
      <div className="tm-words-in" ref={innerRef} style={{ transform: `translateX(${-shift}px)` }}>
        {words.map((word, index) => (
          <span key={index} className={index < count - 1 ? 'said' : index === count - 1 ? 'now' : ''}>{word}</span>
        ))}
      </div>
    </div>
  );
}
