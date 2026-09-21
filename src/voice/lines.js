import { NA_SEVERITY } from '../utils/constants';

// Pipeline engine: what the app says after each tool result, and a free local parser for the
// common answers. Fixed wording on purpose: every line is synthesized once and replayed from cache.

const SPOKEN_PERIOD = { morning: 'morning', evening: 'evening' };
const spokenPeriod = (other) => SPOKEN_PERIOD[other.period_id] || other.label;

export const SHORT_GREETING = "Okay, let's go.";

export const LINES = {
  paused: 'Okay, pausing here. Your progress is saved.',
  finished: 'All done. Nice work.',
  badSeverity: 'Sorry, I need a number from zero to five.',
  notFound: "I couldn't find that symptom. Which one did you mean?",
  notRated: "That one doesn't have a rating yet. What number should it be?",
  again: "Sorry, I didn't catch that.",
};

// The line to speak for a tool result from scripts/dailyCheckin.js
export const lineFor = (result) => {
  if (result.paused) return LINES.paused;
  if (result.finished) return LINES.finished;
  if (result.candidates) return `Which one: ${result.candidates.join(', or ')}?`;
  if (result.error && !result.next) {
    if (/0 to 5/.test(result.error)) return /no rating yet/.test(result.error) ? LINES.notRated : LINES.badSeverity;
    return LINES.notFound;
  }
  if (result.done) {
    if (result.other_period) return `That's everything for now. Want to do the ${spokenPeriod(result.other_period)} ones too?`;
    return LINES.finished;
  }
  return `${result.next.name}.`;
};

// What the model (or local parser) needs to know to interpret the next utterance
export const stateFor = (result, previous = {}) => {
  if (result.next) return { asking: { symptom_id: result.next.symptom_id, name: result.next.name } };
  if (result.done) return { done: { other_period: result.other_period } };
  return previous;
};

const NUMBERS = { zero: 0, none: 0, nothing: 0, one: 1, two: 2, three: 3, four: 4, five: 5 };
// Only trusted when they are the whole utterance: "for the most part fine" is not a 4
const HOMOPHONES = { oh: 0, o: 0, nope: 0, no: 0, nil: 0, won: 1, to: 2, too: 2, tu: 2, tree: 3, for: 4, fore: 4, fife: 5 };
const numberOf = (word) => (/^[0-5]$/.test(word) ? Number(word) : NUMBERS[word]);

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|continue|let s do it|let s go)\b/;
const NO = /^(no|nope|nah|not now|later|i m done|that s it|that s all|stop|finish)\b/;
const PAUSE = /^(pause|stop|hold on|that s enough|let s stop|i need to stop|i m done|i have to go|gotta go)\b/;
const SKIP = /^(skip|next|pass|i don t know|not sure|no idea|come back to (it|that))\b/;
const NA = /^(n a|na|not applicable|doesn t apply|does not apply)\b/;
const REVISION = /\b(actually|change|changed|instead|go back|make (it|that)|earlier|previous|wait)\b/;

// A tool call for the plain answers ("two", "3, worse after coffee", "skip", "pause"), or null
// when the utterance needs the language model.
export const parseUtterance = (text, state) => {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!words) return null;

  if (state?.done) {
    const other = state.done.other_period;
    if (other && YES.test(words)) return { name: 'switch_period', args: { period_id: other.period_id } };
    if (NO.test(words) || PAUSE.test(words)) return { name: 'finish', args: {} };
    return null;
  }
  if (!state?.asking || REVISION.test(words)) return null;
  const symptom_id = state.asking.symptom_id;

  if (PAUSE.test(words)) return { name: 'pause_session', args: {} };
  if (SKIP.test(words)) return { name: 'skip_symptom', args: { symptom_id } };
  if (NA.test(words)) return { name: 'record_symptom', args: { symptom_id, severity: NA_SEVERITY } };

  const tokens = words.split(' ');
  if (tokens.length === 1 && tokens[0] in HOMOPHONES) return { name: 'record_symptom', args: { symptom_id, severity: HOMOPHONES[tokens[0]] } };

  // "a two", "about a 3", "I'd say two" — the number has to lead; anything after it is the note
  const lead = tokens.findIndex((w) => numberOf(w) !== undefined);
  if (lead === -1 || lead > 4) return null;
  if (tokens.slice(0, lead).some((w) => !['a', 'an', 'about', 'around', 'maybe', 'probably', 'like', 'i', 'd', 'say', 'id', 'it', 's', 'its', 'is', 'that'].includes(w))) return null;
  // A second number ("two or three", "2 out of 5") is ambiguous: let the model ask
  if (tokens.slice(lead + 1).some((w) => numberOf(w) !== undefined)) return null;

  // Keep the note in the user's own words, from the original text after the number
  const spoken = String(text).trim();
  const match = spoken.match(new RegExp(`\\b${tokens[lead]}\\b[\\s,.;:!-]*`, 'i'));
  const note = match ? spoken.slice(match.index + match[0].length).replace(/^(and|but)\s+/i, '').trim() : '';
  return { name: 'record_symptom', args: { symptom_id, severity: numberOf(tokens[lead]), ...(note ? { note } : {}) } };
};
