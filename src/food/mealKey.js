// Keys for meal records.
//
// A key is a LOCAL wall-clock timestamp plus a short random suffix:
//   2026-09-21T12:41:07-ab12
//
// Local, not UTC, for two reasons: the sync engine shards map domains by the
// key's `YYYY-MM` prefix (see sync/keyRouting.js), and the app groups meals by
// the day the user saw on the clock. A UTC key would file a late-evening meal
// under tomorrow.
//
// Pure module.

const DATE_RE = /^(\d{4}-\d{2}-\d{2})T/;

const pad = (n) => String(n).padStart(2, '0');

const randomSuffix = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/**
 * @param {Date} date - defaults to now
 * @param {() => string} suffix - injectable for tests
 * @returns {string} e.g. '2026-09-21T12:41:07-ab12'
 */
export function mealKey(date = new Date(), suffix = randomSuffix) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${stamp}-${suffix()}`;
}

/** The 'YYYY-MM-DD' a meal key belongs to, or '' if the key is malformed. */
export function mealDateKey(key) {
  if (typeof key !== 'string') return '';
  const m = key.match(DATE_RE);
  return m ? m[1] : '';
}

/** Chronological comparator. Keys are fixed-width, so a string compare is chronological. */
export function compareMealKeys(a, b) {
  return String(a).localeCompare(String(b));
}
