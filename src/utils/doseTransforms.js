/**
 * Passthrough — returns data as-is.
 */
export function aggregateDaily(series, dates) {
  return { values: [...series], dates: [...dates], labels: [...dates] };
}

/**
 * Get ISO week start (Monday) for a given date string.
 */
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Get month key (YYYY-MM) for a given date string.
 */
function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

/**
 * Get midpoint date from an array of date strings.
 */
function getMidpointDate(dates) {
  const midIdx = Math.floor((dates.length - 1) / 2);
  return dates[midIdx];
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Group series by period, compute avg or total.
 * Returns { values, dates, labels } — empty arrays if all null.
 */
function aggregateByPeriod(series, dates, mode, getKey, getLabel) {
  const periods = [];
  let currentKey = null;
  let currentGroup = null;

  for (let i = 0; i < dates.length; i++) {
    const key = getKey(dates[i]);
    if (key !== currentKey) {
      if (currentGroup) periods.push(currentGroup);
      currentKey = key;
      currentGroup = { key, values: [], dates: [] };
    }
    currentGroup.values.push(series[i]);
    currentGroup.dates.push(dates[i]);
  }
  if (currentGroup) periods.push(currentGroup);

  const result = { values: [], dates: [], labels: [] };
  for (const period of periods) {
    const nonNull = period.values.filter(v => v !== null && v !== undefined);
    if (nonNull.length === 0) continue;

    const total = nonNull.reduce((s, v) => s + v, 0);
    result.values.push(mode === 'total' ? total : total / nonNull.length);
    result.dates.push(getMidpointDate(period.dates));
    result.labels.push(getLabel(period));
  }
  return result;
}

/**
 * Aggregate by ISO calendar week (Monday start).
 */
export function aggregateWeekly(series, dates, mode) {
  return aggregateByPeriod(series, dates, mode, getWeekStart,
    (period) => getWeekStart(period.dates[0])
  );
}

/**
 * Aggregate by calendar month.
 */
export function aggregateMonthly(series, dates, mode) {
  return aggregateByPeriod(series, dates, mode, getMonthKey,
    (period) => {
      const monthIdx = parseInt(period.key.slice(5, 7), 10) - 1;
      return MONTH_NAMES[monthIdx];
    }
  );
}
