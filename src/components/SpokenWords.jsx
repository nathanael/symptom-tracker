import { useEffect, useMemo, useState } from 'react';

const WORDS_PER_LINE = 4;
const CHARS_PER_LINE = 24;

// Her words a few at a time: short lines that end at punctuation where they can
const toLines = (words) => {
  const lines = [];
  let line = [];
  let chars = 0;
  words.forEach((word, index) => {
    if (line.length && (line.length >= WORDS_PER_LINE || chars + word.length > CHARS_PER_LINE)) {
      lines.push(line);
      line = [];
      chars = 0;
    }
    line.push({ word, index });
    chars += word.length + 1;
    if (/[.?!,]$/.test(word) && line.length > 1) {
      lines.push(line);
      line = [];
      chars = 0;
    }
  });
  if (line.length) lines.push(line);
  return lines;
};

// What she is saying, large and a few words at a time, each word lighting up at about speaking
// pace. The transcript arrives in bursts ahead of the audio and carries no timings, so the pace is
// ours: steady, a little quicker when the transcript has run ahead.
export default function SpokenWords({ text }) {
  const words = useMemo(() => (text || '').split(/\s+/).filter(Boolean), [text]);
  const [spoken, setSpoken] = useState({ count: 0, first: '' });
  // A new turn starts the transcript over
  const count = spoken.first === words[0] && spoken.count <= words.length ? spoken.count : 0;

  useEffect(() => {
    if (count >= words.length) return undefined;
    const behind = words.length - count;
    const timer = setTimeout(() => setSpoken({ count: count + 1, first: words[0] }), count === 0 ? 0 : behind > 8 ? 190 : 300);
    return () => clearTimeout(timer);
  }, [count, words]);

  const lines = useMemo(() => toLines(words), [words]);
  const line = lines.find((l) => l[l.length - 1].index >= count - 1) || lines[lines.length - 1];
  if (!line) return <p className="tm-words" />;
  return (
    <p className="tm-words" key={line[0].index}>
      {line.map(({ word, index }) => <span key={index} className={index < count - 1 ? 'said' : index === count - 1 ? 'now' : ''}>{word} </span>)}
    </p>
  );
}
