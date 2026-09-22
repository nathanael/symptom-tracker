// The one-line counts under each Home card. Pure over the raw stores so they can be unit
// tested and so Home itself stays presentational.
//
// Every line goes null at zero: a fresh morning should be three clean photographs, not three
// zeroes. That includes supplements — "0 of 9 taken" is deliberately not shown. If that ever
// feels wrong, the single line to change is in summaryLines.

import { getDateKey, isScheduledForDate } from './helpers';
import { mealDateKey } from '../food/mealKey';

// Entry values carry their own `date`, so count values rather than parsing keys — symptom ids
// contain hyphens and a key split would be wrong.
export function symptomsLogged(entries, date) {
  const dateKey = getDateKey(date);
  let n = 0;
  for (const entry of Object.values(entries || {})) {
    if (entry?.date === dateKey) n += 1;
  }
  return n;
}

export function mealsLogged(meals, date) {
  const dateKey = getDateKey(date);
  let n = 0;
  for (const key of Object.keys(meals || {})) {
    if (mealDateKey(key) === dateKey) n += 1;
  }
  return n;
}

// `taken` is counted over the due list only, so an entry left behind by an item that has since
// been descheduled or deactivated cannot push taken past due.
export function supplementsTaken(stackItems, stackEntries, date) {
  const dateKey = getDateKey(date);
  const due = (stackItems || []).filter((i) => i.active && isScheduledForDate(i.schedule, date));
  let taken = 0;
  for (const item of due) {
    if (stackEntries?.[`${dateKey}-${item.id}`]?.taken) taken += 1;
  }
  return { taken, due: due.length };
}

export function summaryLines({ entries, meals, stackItems, stackEntries, date }) {
  const symptoms = symptomsLogged(entries, date);
  const mealCount = mealsLogged(meals, date);
  const { taken, due } = supplementsTaken(stackItems, stackEntries, date);
  return {
    symptoms: symptoms === 0 ? null : `${symptoms} logged today`,
    meals: mealCount === 0 ? null : `${mealCount} meal${mealCount === 1 ? '' : 's'}`,
    supplements: taken === 0 ? null : `${taken} of ${due} taken`,
  };
}
