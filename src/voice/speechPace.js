// How long a word takes to say, in syllables. Used to pace the captions: a fixed rate per word
// makes "Anxiety, physical" run ahead and "was a two" lag behind.
//
// Pure module.

// Vowel groups, minus a silent trailing e, with digits read out as their words.
const DIGITS = { 0: 2, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 2, 8: 1, 9: 1 };

export const syllables = (word) => {
  const clean = String(word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!clean) return 0;
  if (/^\d+$/.test(clean)) return [...clean].reduce((n, d) => n + (DIGITS[d] || 1), 0);
  const groups = clean.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
};

// A word's share of the utterance: its syllables, plus the beat a comma or full stop adds after it
export const weightOf = (word) => syllables(word) + (/[.?!]$/.test(word) ? 1.6 : /[,;:]$/.test(word) ? 0.9 : 0);

export const totalWeight = (words) => words.reduce((sum, word) => sum + weightOf(word), 0);

// Which word a fraction of the way through an utterance lands on (1-based count, 0 when nothing
// has been said yet). Weighted, so the highlight tracks her voice instead of an even tick.
export const wordAt = (words, fraction) => {
  const total = totalWeight(words);
  if (!total) return 0;
  let seen = 0;
  for (let i = 0; i < words.length; i++) {
    seen += weightOf(words[i]);
    if (seen / total > fraction) return i + 1;
  }
  return words.length;
};
