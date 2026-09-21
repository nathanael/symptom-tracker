// The meals logged on the day being viewed. Read-only summary; tapping one reopens the review
// sheet so it can be corrected or deleted.

import { mealDateKey, compareMealKeys } from '../food/mealKey';
import { solar } from './solarIcons';

const timeLabel = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function MealList({ meals, dateKey, onOpen, onAdd }) {
  const keys = Object.keys(meals || {})
    .filter((key) => mealDateKey(key) === dateKey)
    .sort(compareMealKeys);

  return (
    <>
      <div className="lr-sec">
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
