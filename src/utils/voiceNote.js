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
