export const TIMEFRAMES = [
  { label: '2W', days: 14 },
  { label: '4W', days: 28 },
  { label: '2M', days: 60 },
  { label: '4M', days: 120 },
  { label: '6M', days: 180 },
];

export const COLORS = {
  primary: '#8b5cf6',
  compare1: '#f59e0b',
  compare2: '#06b6d4',
};

export const STUDIO_COLORS = {
  supplement: '#8b5cf6',
  symptom: '#fb7185',
  corrPositive: '#34d399',
  corrNegative: '#fb7185',
  corrWeak: '#6b7280',
};

export function getDailyValue(entries, dateKey, symptomId, trackingMode) {
  if (trackingMode === 'ampm') {
    const am = entries[`${dateKey}-${symptomId}-morning`];
    const pm = entries[`${dateKey}-${symptomId}-evening`];
    const vals = [];
    if (am && am.severity !== -1) vals.push(am.severity);
    if (pm && pm.severity !== -1) vals.push(pm.severity);
    if (vals.length === 0) {
      const daily = entries[`${dateKey}-${symptomId}-daily`];
      if (daily && daily.severity !== -1) return daily.severity;
      return null;
    }
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  } else {
    const daily = entries[`${dateKey}-${symptomId}-daily`];
    if (daily && daily.severity !== -1) return daily.severity;
    const am = entries[`${dateKey}-${symptomId}-morning`];
    const pm = entries[`${dateKey}-${symptomId}-evening`];
    const vals = [];
    if (am && am.severity !== -1) vals.push(am.severity);
    if (pm && pm.severity !== -1) vals.push(pm.severity);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
}

export const SMOOTH_WINDOWS = { 14: 3, 28: 5, 60: 7, 120: 9, 180: 10 };

export function generateDateRange(days) {
  const dates = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

// Fill small gaps (≤3 days) with linear interpolation
export function interpolateSmallGaps(values, maxGap = 3) {
  const result = [...values];
  let i = 0;
  while (i < result.length) {
    if (result[i] !== null) { i++; continue; }
    const gapStart = i;
    while (i < result.length && result[i] === null) i++;
    const gapLen = i - gapStart;
    const leftVal = gapStart > 0 ? result[gapStart - 1] : null;
    const rightVal = i < result.length ? result[i] : null;
    if (gapLen <= maxGap && leftVal !== null && rightVal !== null) {
      for (let j = 0; j < gapLen; j++) {
        result[gapStart + j] = leftVal + (rightVal - leftVal) * ((j + 1) / (gapLen + 1));
      }
    }
  }
  return result;
}

export function smooth(values, windowSize) {
  return values.map((val, i) => {
    if (val === null) return null;
    const half = Math.floor(windowSize / 2);
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    let sum = 0, count = 0;
    for (let j = start; j < end; j++) {
      if (values[j] !== null) { sum += values[j]; count++; }
    }
    return count > 0 ? sum / count : null;
  });
}

export function formatXLabel(dateStr, timeframe) {
  const d = new Date(dateStr + 'T12:00:00');
  if (timeframe <= 28) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return d.toLocaleDateString('en-US', { month: 'short' });
  }
}

export function getXLabelInterval(timeframe) {
  if (timeframe <= 7) return 1;
  if (timeframe <= 14) return 2;
  if (timeframe <= 28) return 7;
  if (timeframe <= 90) return 14;
  return 30;
}

// Build SVG path that breaks on null gaps
export function buildPath(points) {
  let d = '';
  let drawing = false;
  for (const pt of points) {
    if (pt.y === null) { drawing = false; continue; }
    if (!drawing) { d += `M${pt.x},${pt.y}`; drawing = true; }
    else { d += `L${pt.x},${pt.y}`; }
  }
  return d;
}
