export const TIMEFRAMES = [
  { label: 'W', days: 7 },
  { label: 'M', days: 30 },
  { label: '3M', days: 90 },
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

export const SMOOTH_WINDOWS = { 7: 2, 30: 5, 90: 10, 180: 14 };

export function generateDateRange(days) {
  const dates = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
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
  if (timeframe <= 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  } else if (timeframe <= 30) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else if (timeframe <= 90) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return d.toLocaleDateString('en-US', { month: 'short' });
  }
}

export function getXLabelInterval(timeframe) {
  if (timeframe <= 7) return 1;
  if (timeframe <= 30) return 7;
  if (timeframe <= 90) return 10;
  return 30;
}

// Build SVG path that breaks on null gaps
export function buildPath(points) {
  // Split into contiguous segments (break on null y)
  const segments = [];
  let seg = [];
  for (const pt of points) {
    if (pt.y === null) {
      if (seg.length) { segments.push(seg); seg = []; }
    } else {
      seg.push(pt);
    }
  }
  if (seg.length) segments.push(seg);

  let d = '';
  for (const pts of segments) {
    if (pts.length === 0) continue;
    d += `M${pts[0].x},${pts[0].y}`;
    if (pts.length === 1) continue;
    if (pts.length === 2) {
      d += `L${pts[1].x},${pts[1].y}`;
      continue;
    }
    // Monotone cubic Hermite spline (Fritsch–Carlson)
    const n = pts.length;
    const dx = [], dy = [], m = [];
    for (let i = 0; i < n - 1; i++) {
      dx.push(pts[i + 1].x - pts[i].x);
      dy.push(pts[i + 1].y - pts[i].y);
      m.push(dy[i] / dx[i]);
    }
    const tangents = [m[0]];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) {
        tangents.push(0);
      } else {
        tangents.push((m[i - 1] + m[i]) / 2);
      }
    }
    tangents.push(m[n - 2]);
    // Fritsch–Carlson monotonicity correction
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(m[i]) < 1e-10) {
        tangents[i] = 0;
        tangents[i + 1] = 0;
      } else {
        const a = tangents[i] / m[i];
        const b = tangents[i + 1] / m[i];
        const s = a * a + b * b;
        if (s > 9) {
          const t = 3 / Math.sqrt(s);
          tangents[i] = t * a * m[i];
          tangents[i + 1] = t * b * m[i];
        }
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const c1x = pts[i].x + dx[i] / 3;
      const c1y = pts[i].y + tangents[i] * dx[i] / 3;
      const c2x = pts[i + 1].x - dx[i] / 3;
      const c2y = pts[i + 1].y - tangents[i + 1] * dx[i] / 3;
      d += `C${c1x},${c1y},${c2x},${c2y},${pts[i + 1].x},${pts[i + 1].y}`;
    }
  }
  return d;
}

// Build a step-mid SVG path with rounded transitions at every dose change.
export function buildStepPath(points, radius) {
  const segments = [];
  let seg = [];
  for (const pt of points) {
    if (pt.y === null) {
      if (seg.length) { segments.push(seg); seg = []; }
    } else {
      seg.push(pt);
    }
  }
  if (seg.length) segments.push(seg);

  let d = '';
  for (const pts of segments) {
    if (pts.length === 0) continue;
    d += `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      if (cur.y === prev.y) {
        d += `L${cur.x},${cur.y}`;
        continue;
      }
      const dx = cur.x - prev.x;
      const dyAbs = Math.abs(cur.y - prev.y);
      const dir = cur.y > prev.y ? 1 : -1;
      const midX = (prev.x + cur.x) / 2;
      const r = Math.min(radius, dx / 2);

      if (dyAbs >= 2 * radius) {
        d += `L${midX - r},${prev.y}`;
        d += `Q${midX},${prev.y},${midX},${prev.y + dir * radius}`;
        d += `L${midX},${cur.y - dir * radius}`;
        d += `Q${midX},${cur.y},${midX + r},${cur.y}`;
        d += `L${cur.x},${cur.y}`;
      } else {
        // Small step: single smooth S-curve centered at midX.
        d += `L${midX - r},${prev.y}`;
        d += `C${midX},${prev.y},${midX},${cur.y},${midX + r},${cur.y}`;
        d += `L${cur.x},${cur.y}`;
      }
    }
  }
  return d;
}
