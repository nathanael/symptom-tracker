// Pure helpers mapping date-prefixed record keys to per-month buckets.
const DATE_PREFIX_RE = /^(\d{4}-\d{2})-\d{2}/;
export const MONTH_RE = /^\d{4}-\d{2}$/;

export function monthIdForKey(key) {
  if (typeof key !== 'string') return null;
  const m = key.match(DATE_PREFIX_RE);
  return m ? m[1] : null;
}

export function monthIdForDate(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{4}-\d{2})-\d{2}/);
  return m ? m[1] : null;
}

export function groupKeysByMonth(keys) {
  const out = {};
  for (const key of keys) {
    const month = monthIdForKey(key);
    if (!month) continue;
    (out[month] ||= []).push(key);
  }
  return out;
}
