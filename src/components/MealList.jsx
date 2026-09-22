// The meals logged on the day being viewed. Read-only summary; tapping one reopens the review
// sheet so it can be corrected or deleted.

import { useEffect, useRef } from 'react';
import { mealDateKey, compareMealKeys } from '../food/mealKey';
import { solar } from './solarIcons';

const timeLabel = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

// A meal's own key encodes the local wall-clock time it was created at, in the same fixed-width
// format `compareMealKeys` sorts chronologically as a string, so it doubles as a fallback "time"
// when `meal.time` is missing or unparseable (e.g. a record restored from an old backup).
const KEY_STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;
const sortMs = (key, meal) => {
  const t = meal?.time ? new Date(meal.time).getTime() : NaN;
  if (!Number.isNaN(t)) return t;
  const m = KEY_STAMP_RE.exec(String(key));
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
};

// Sort by the meal's displayed time, not by key — editing a meal's time keeps its key stable
// (see mealKey.js), so the two can diverge. Fall back to the key's own embedded time when
// `meal.time` is missing, and to `compareMealKeys` as a stable tiebreaker for equal times.
const byDisplayedTime = (meals) => (a, b) => {
  const ma = sortMs(a, meals[a]);
  const mb = sortMs(b, meals[b]);
  if (!Number.isNaN(ma) && !Number.isNaN(mb) && ma !== mb) return ma - mb;
  return compareMealKeys(a, b);
};

export default function MealList({ meals, dateKey, onOpen, onAdd, scrollIntoViewOnMount }) {
  const headingRef = useRef(null);

  // "Today's meals" on the Home screen lands on the Protocol tab, where this section sits below
  // the whole supplement list and would otherwise be off-screen on arrival.
  useEffect(() => {
    if (scrollIntoViewOnMount) headingRef.current?.scrollIntoView({ block: 'start' });
  }, [scrollIntoViewOnMount]);

  const keys = Object.keys(meals || {})
    .filter((key) => mealDateKey(key) === dateKey)
    .sort(byDisplayedTime(meals || {}));

  return (
    <>
      <div className="lr-sec" ref={headingRef}>
        <b>MEALS</b> {keys.length === 0 ? 'none logged' : `${keys.length} logged`}
      </div>
      {keys.map((key) => {
        const meal = meals[key];
        const count = meal.ingredients?.length || 0;
        return (
          <div className="lr-row lr-cols" key={key} onClick={() => onOpen(key)}>
            <div className="lr-name">
              {meal.name || 'Meal'}
              <small>{timeLabel(meal.time)} · {count} ingredient{count === 1 ? '' : 's'}</small>
            </div>
          </div>
        );
      })}
      <div className="lr-row lr-cols lr-add" onClick={onAdd}>
        <svg viewBox="0 0 24 24" width="18" height="18">{solar.camera}</svg>
        <div className="lr-fields">Log a meal</div>
      </div>
    </>
  );
}
