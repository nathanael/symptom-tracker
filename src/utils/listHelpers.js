import { getDateKey } from './helpers';
import { NA_SEVERITY } from './constants';

// Whether a symptom is tracked in a given period (null applicablePeriods = all)
export const isApplicable = (symptom, periodId) =>
  !symptom.applicablePeriods || symptom.applicablePeriods.includes(periodId);

// Date keys for the `days` days ending at (and including) endDate, oldest first
export const getStripDateKeys = (endDate, days = 14) => {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    keys.push(getDateKey(d));
  }
  return keys;
};

// Max logged severity per day for one symptom; null = nothing logged (N/A counts as nothing)
export const getSeverityStrip = (entries, symptomId, dateKeys, periods) =>
  dateKeys.map((dateKey) => {
    let max = null;
    for (const period of periods) {
      const entry = entries[`${dateKey}-${symptomId}-${period.id}`];
      if (!entry || entry.severity === NA_SEVERITY || entry.severity == null) continue;
      if (max === null || entry.severity > max) max = entry.severity;
    }
    return max;
  });

// Remove every entry whose `date` is dateKey. Returns the new map plus what was removed (for undo).
export const clearDay = (entryMap, dateKey) => {
  const next = {};
  const removed = {};
  for (const [key, entry] of Object.entries(entryMap)) {
    if (entry && entry.date === dateKey) removed[key] = entry;
    else next[key] = entry;
  }
  return { next, removed };
};

// Put a day back exactly as it was in `snapshot` (entries for dateKey), leaving other days untouched
export const restoreDay = (entryMap, dateKey, snapshot) => ({ ...clearDay(entryMap, dateKey).next, ...snapshot });

// Next row index (wrapping) whose item passes `accept`, starting after `from` in direction dir
export const stepIndex = (list, from, dir, accept = () => true) => {
  const n = list.length;
  if (n === 0) return -1;
  for (let i = 1; i <= n; i++) {
    const idx = (((from + dir * i) % n) + n) % n;
    if (accept(list[idx])) return idx;
  }
  return from;
};

// Move an item within an ordered list and return [{id, order}] for every item
export const reorder = (orderedIds, fromId, toId) => {
  const ids = [...orderedIds];
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from === -1 || to === -1 || from === to) return ids;
  ids.splice(from, 1);
  ids.splice(to, 0, fromId);
  return ids;
};

// Ids must not contain '.', which the sync layer treats as a field-path separator
export const makeId = (name) =>
  `${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}${Math.floor(Math.random() * 1e6)}`;
