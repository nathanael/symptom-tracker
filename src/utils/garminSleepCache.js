export function mergeDays(cache, incoming) {
  const byDate = new Map();
  for (const d of cache) byDate.set(d.date, d);
  for (const d of incoming) byDate.set(d.date, d);  // incoming wins on conflict
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

const NUMERIC_FIELDS = [
  'sleepScore', 'deepSleepSeconds', 'lightSleepSeconds', 'remSleepSeconds',
  'awakeSleepSeconds', 'averageRespiration', 'lowestRespiration',
  'avgSleepStress', 'averageSpo2', 'lowestSpo2', 'hrvOvernight',
  'hrvWeeklyAvg', 'restingHr',
];

function bucketKey(dateStr, mode) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (mode === 'weeks') {
    // ISO-ish week: back up to Monday
    const day = dt.getUTCDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day);
    dt.setUTCDate(dt.getUTCDate() + diff);
    return dt.toISOString().slice(0, 10);
  }
  if (mode === 'months') {
    return `${y}-${String(m).padStart(2, '0')}-01`;
  }
  return dateStr;
}

export function aggregate(days, mode) {
  if (mode === 'days') return days;
  const buckets = new Map();
  for (const d of days) {
    const key = bucketKey(d.date, mode);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(d);
  }
  const out = [];
  for (const [key, rows] of buckets.entries()) {
    const row = { date: key };
    for (const f of NUMERIC_FIELDS) {
      const vals = rows.map(r => r[f]).filter(v => typeof v === 'number');
      if (vals.length) {
        row[f] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      }
    }
    out.push(row);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const PRESET_DAYS = { '7d': 7, '14d': 14, '30d': 30, '3mo': 90, '6mo': 180, '1y': 365 };

export function rangeForPreset(preset, availableMin, availableMax) {
  if (preset === 'all') return { start: availableMin, end: availableMax };
  const days = PRESET_DAYS[preset];
  if (!days) throw new Error(`Unknown preset: ${preset}`);
  const end = new Date(availableMax + 'T00:00:00Z');
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startStr = start.toISOString().slice(0, 10);
  return {
    start: startStr < availableMin ? availableMin : startStr,
    end: availableMax,
  };
}

export function extractSyncedAtIso(data) {
  const ts = data && data.syncedAt;
  if (!ts) return null;
  if (typeof ts === 'string') return ts;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000).toISOString();
  return null;
}

export function applyFirestoreSnapshot(cache, lastPushedAt, docs) {
  const incoming = docs.map(raw => {
    const { syncedAt: _omit, ...rest } = raw;
    return { ...rest, syncedAt: extractSyncedAtIso(raw) };
  });
  let newestTs = lastPushedAt;
  for (const d of incoming) {
    if (d.syncedAt && (!newestTs || d.syncedAt > newestTs)) newestTs = d.syncedAt;
  }
  return { merged: mergeDays(cache, incoming), newestTs };
}

// Compute {avgA, avgB, delta, pctChange, betterSide} for a metric across two row sets.
// valueFn extracts the numeric value from a row (typically the caller wraps valueForRow).
// betterSide is 'a', 'b', or 'equal' based on higherIsBetter.
export function computeCompareStats(rowsA, rowsB, valueFn, higherIsBetter) {
  const avg = (rows) => {
    const vals = rows.map(valueFn).filter(v => typeof v === 'number');
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  const avgA = avg(rowsA);
  const avgB = avg(rowsB);
  if (avgA == null || avgB == null) {
    return { avgA, avgB, delta: null, pctChange: null, betterSide: 'equal' };
  }
  const delta = avgB - avgA;
  const pctChange = avgA === 0 ? null : (delta / avgA) * 100;
  let betterSide = 'equal';
  if (avgB > avgA) betterSide = higherIsBetter ? 'b' : 'a';
  else if (avgB < avgA) betterSide = higherIsBetter ? 'a' : 'b';
  return { avgA, avgB, delta, pctChange, betterSide };
}

// Given sorted-ascending days and a "now" date (ISO string), return default
// period2 = last 14 days of data, period1 = the 14 days before that.
// Uses calendar arithmetic, not array slicing (data may be sparse).
export function defaultComparePeriods(days) {
  if (!days.length) {
    return { period1: { start: '', end: '' }, period2: { start: '', end: '' } };
  }
  const max = days[days.length - 1].date;
  const maxDate = new Date(max + 'T00:00:00Z');
  const p2Start = new Date(maxDate);
  p2Start.setUTCDate(p2Start.getUTCDate() - 13);
  const p1End = new Date(p2Start);
  p1End.setUTCDate(p1End.getUTCDate() - 1);
  const p1Start = new Date(p1End);
  p1Start.setUTCDate(p1Start.getUTCDate() - 13);
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    period1: { start: iso(p1Start), end: iso(p1End) },
    period2: { start: iso(p2Start), end: max },
  };
}

// Shift period1 to be the "previous period" of period2 (same length, immediately before).
export function previousPeriodOf(period2) {
  const start2 = new Date(period2.start + 'T00:00:00Z');
  const end2 = new Date(period2.end + 'T00:00:00Z');
  const lengthDays = Math.round((end2 - start2) / 86400000) + 1;
  const end1 = new Date(start2);
  end1.setUTCDate(end1.getUTCDate() - 1);
  const start1 = new Date(end1);
  start1.setUTCDate(start1.getUTCDate() - (lengthDays - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start1), end: iso(end1) };
}

// Shift period1 to be "same period last year" of period2.
export function priorYearPeriodOf(period2) {
  const shift = (iso) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d.toISOString().slice(0, 10);
  };
  return { start: shift(period2.start), end: shift(period2.end) };
}

// Align two sequential row sets by relative index for a shared X chart.
// Each output entry: { i, aValue, bValue }.
export function alignByIndex(rowsA, rowsB, valueFn) {
  const n = Math.max(rowsA.length, rowsB.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      i,
      aValue: i < rowsA.length ? valueFn(rowsA[i]) : null,
      bValue: i < rowsB.length ? valueFn(rowsB[i]) : null,
    });
  }
  return out;
}
