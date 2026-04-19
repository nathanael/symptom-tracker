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
