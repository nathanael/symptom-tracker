import { isApplicable } from '../utils/listHelpers';

// Sequencing shared by Rapid entry and talk mode: which symptoms a period asks about,
// which are still unlogged, and what comes next. Pure — callers own the state.

export const entryKey = (dateKey, symptomId, periodId) => `${dateKey}-${symptomId}-${periodId}`;

export const listFor = (symptoms, periodId) => symptoms.filter((s) => isApplicable(s, periodId));

export const unloggedIn = (symptoms, entries, dateKey, periodId) =>
  listFor(symptoms, periodId).filter((s) => !entries[entryKey(dateKey, s.id, periodId)]);

// Start in the current period, or the first other one with anything left if this one is complete
export const initialPeriod = (symptoms, entries, dateKey, timePeriods, currentPeriodId) => {
  const now = timePeriods.find((p) => p.id === currentPeriodId)?.id || timePeriods[0].id;
  if (unloggedIn(symptoms, entries, dateKey, now).length > 0) return now;
  return timePeriods.find((p) => unloggedIn(symptoms, entries, dateKey, p.id).length > 0)?.id || now;
};

// Index of the next unlogged symptom after `from`, wrapping; -1 when everything else is logged
export const nextUnlogged = (list, isLogged, from, skipId) => {
  for (let offset = 1; offset <= list.length; offset++) {
    const i = (from + offset) % list.length;
    if (list[i].id !== skipId && !isLogged(list[i])) return i;
  }
  return -1;
};

// Another period that still has unlogged symptoms, with how many are left
export const otherIncomplete = (symptoms, entries, dateKey, timePeriods, periodId) =>
  timePeriods
    .filter((p) => p.id !== periodId)
    .map((p) => ({ ...p, left: unloggedIn(symptoms, entries, dateKey, p.id).length }))
    .find((p) => p.left > 0);
