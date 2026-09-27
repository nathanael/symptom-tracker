// Pure helpers behind the desktop Sleep tab: last-night contributors, sleep
// balance, and the links between Garmin nights and Glimpse symptoms/protocol.
// A Garmin row's `date` is the morning the night ended, so row D pairs with
// symptoms logged on D and with supplements taken on D-1.
import { getDailyValue } from './chartHelpers';
import { isScheduledForDate } from './helpers';

const DAY_MS = 86400000;

export const asleepMinutes = (d) => {
  const s = (d.deepSleepSeconds || 0) + (d.lightSleepSeconds || 0) + (d.remSleepSeconds || 0);
  return s ? Math.round(s / 60) : null;
};

export function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

function sd(vals) {
  const m = mean(vals);
  if (vals.length < 2) return null;
  return Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length - 1));
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

const GOOD = '#4ade80', OK = '#fbbf24', BAD = '#f87171';
const clamp01 = (v) => Math.max(0.04, Math.min(1, v));

// Each contributor: how to read it off a row, which way is better, and a fixed guideline.
export const CONTRIBUTORS = [
  { key: 'duration', label: 'Duration', guide: 'your sleep need', get: asleepMinutes, dir: 1, fmt: (v) => `${Math.floor(v / 60)}h ${String(Math.round(v % 60)).padStart(2, '0')}m`,
    target: (v, row) => { const need = row.sleepNeedMinutes || 480; const r = v / need; return { pct: r, color: r >= 1 ? GOOD : r >= 0.88 ? OK : BAD }; } },
  { key: 'rem', label: 'REM', guide: '90 min', get: (d) => (d.remSleepSeconds != null ? Math.round(d.remSleepSeconds / 60) : null), dir: 1, fmt: (v) => `${v}m`,
    target: (v) => ({ pct: v / 90, color: v >= 90 ? GOOD : v >= 60 ? OK : BAD }) },
  { key: 'deep', label: 'Deep', guide: '60 min', get: (d) => (d.deepSleepSeconds != null ? Math.round(d.deepSleepSeconds / 60) : null), dir: 1, fmt: (v) => `${v}m`,
    target: (v) => ({ pct: v / 60, color: v >= 60 ? GOOD : v >= 45 ? OK : BAD }) },
  { key: 'spo2', label: 'SpO2', guide: '95% or higher', get: (d) => d.averageSpo2 ?? null, dir: 1, fmt: (v) => `${Math.round(v)}%`,
    target: (v) => ({ pct: (v - 85) / 10, color: v >= 95 ? GOOD : v >= 92 ? OK : BAD }) },
  { key: 'resp', label: 'Resp', guide: '12–20 breaths/min', get: (d) => d.averageRespiration ?? null, dir: -1, fmt: (v) => v.toFixed(1),
    target: (v) => ({ pct: v >= 12 && v <= 20 ? 0.9 : 0.5, color: v >= 12 && v <= 20 ? GOOD : BAD }) },
  { key: 'rhr', label: 'RHR', guide: '60 bpm or lower', get: (d) => d.restingHr ?? null, dir: -1, fmt: (v) => `${v}`,
    target: (v) => ({ pct: Math.min(1, 60 / v), color: v <= 60 ? GOOD : v <= 70 ? OK : BAD }) },
  { key: 'hrv', label: 'HRV', guide: "Garmin's status: balanced", get: (d) => d.hrvOvernight ?? null, dir: 1, fmt: (v) => `${v}ms`,
    target: (v, row) => {
      const s = row.hrvStatus;
      return { pct: s === 'BALANCED' ? 0.9 : s ? 0.5 : 0.7, color: s === 'BALANCED' ? GOOD : s === 'UNBALANCED' ? OK : s ? BAD : OK };
    } },
];

// basis 'baseline' judges a night against the previous 30; 'targets' against fixed guidelines.
export function contributorStanding(c, row, baselineRows, basis) {
  const v = c.get(row);
  if (v == null) return null;
  if (basis === 'baseline') {
    const vals = baselineRows.map(c.get).filter((x) => x != null);
    const s = sd(vals);
    if (vals.length >= 7 && s) {
      const z = ((v - mean(vals)) / s) * c.dir; // positive = better than usual
      return { value: v, pct: clamp01(0.7 + z * 0.15), color: z >= -1 ? GOOD : z >= -2 ? OK : BAD, tip: `${c.fmt(v)} · your usual ${c.fmt(Math.round(mean(vals)))}` };
    }
  }
  const t = c.target(v, row);
  return { value: v, pct: clamp01(t.pct), color: t.color, tip: `${c.fmt(v)} · guideline ${c.guide}` };
}

// Net minutes short (positive) or ahead (negative) across the given nights.
export function sleepBalance(rows) {
  let net = 0, counted = 0;
  const nights = rows.map((d) => {
    const got = asleepMinutes(d), need = d.sleepNeedMinutes;
    if (got == null || !need) return { date: d.date, ratio: null };
    net += need - got;
    counted++;
    return { date: d.date, got, need, ratio: got / need };
  });
  return { net, counted, nights };
}

export function scoreVerdict(score) {
  if (score == null) return { label: '—', color: '#6b7280' };
  if (score >= 90) return { label: 'Excellent', color: GOOD };
  if (score >= 80) return { label: 'Good', color: GOOD };
  if (score >= 60) return { label: 'Fair', color: OK };
  return { label: 'Poor', color: BAD };
}

// Sleep measures tested against next-day symptoms. `low` = the worse end.
const FINDING_METRICS = [
  { key: 'deep', noun: 'deep sleep', unit: 'min', get: (d) => (d.deepSleepSeconds != null ? Math.round(d.deepSleepSeconds / 60) : null), worseLow: true },
  { key: 'rem', noun: 'REM', unit: 'min', get: (d) => (d.remSleepSeconds != null ? Math.round(d.remSleepSeconds / 60) : null), worseLow: true },
  { key: 'duration', noun: 'sleep', unit: 'h', get: asleepMinutes, worseLow: true, show: (v) => (v / 60).toFixed(1) },
  { key: 'hrv', noun: 'HRV', unit: 'ms', get: (d) => d.hrvOvernight ?? null, worseLow: true },
  { key: 'score', noun: 'sleep score', unit: '', get: (d) => d.sleepScore ?? null, worseLow: true },
  { key: 'spo2', noun: 'lowest SpO2', unit: '%', get: (d) => d.lowestSpo2 ?? null, worseLow: true },
  { key: 'stress', noun: 'sleep stress', unit: '', get: (d) => d.avgSleepStress ?? null, worseLow: false },
];

const MIN_GROUP = 5;

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Sleep → same-day symptom links. For each symptom and sleep measure, nights in
 * the worst third are compared with the rest; effect is the difference in mean
 * severity (0–5 scale, positive = worse after bad nights).
 */
export function symptomLinks(sleepRows, symptoms, entries, trackingMode, { minEffect = 0.5, limit = 3 } = {}) {
  const out = [];
  for (const sym of symptoms.filter((s) => s.active !== false)) {
    for (const m of FINDING_METRICS) {
      const pairs = [];
      for (const row of sleepRows) {
        const v = m.get(row);
        if (v == null) continue;
        const sev = getDailyValue(entries, row.date, sym.id, trackingMode);
        if (sev == null || sev < 0) continue;
        pairs.push({ v, sev });
      }
      if (pairs.length < MIN_GROUP * 2) continue;
      const sorted = pairs.map((p) => p.v).sort((a, b) => a - b);
      const cut = quantile(sorted, m.worseLow ? 1 / 3 : 2 / 3);
      const bad = pairs.filter((p) => (m.worseLow ? p.v <= cut : p.v >= cut));
      const rest = pairs.filter((p) => (m.worseLow ? p.v > cut : p.v < cut));
      if (bad.length < MIN_GROUP || rest.length < MIN_GROUP) continue;
      const a = mean(bad.map((p) => p.sev)), b = mean(rest.map((p) => p.sev));
      const effect = a - b;
      if (effect < minEffect) continue;
      out.push({
        kind: 'symptom', symptom: sym.name, metric: m.noun, effect,
        threshold: m.show ? m.show(cut) : Math.round(cut), unit: m.unit, below: m.worseLow,
        nights: bad.length, badAvg: a, restAvg: b,
      });
    }
  }
  // Keep the strongest measure per symptom, then the strongest symptoms
  const best = new Map();
  for (const f of out) if (!best.has(f.symptom) || best.get(f.symptom).effect < f.effect) best.set(f.symptom, f);
  return [...best.values()].sort((x, y) => y.effect - x.effect).slice(0, limit);
}

/** Supplement taken on D-1 → that night's sleep (row D). */
export function supplementLinks(sleepRows, stackItems, stackEntries, { limit = 2 } = {}) {
  const tests = [
    { noun: 'deep sleep', unit: 'min', get: (d) => (d.deepSleepSeconds != null ? d.deepSleepSeconds / 60 : null) },
    { noun: 'sleep score', unit: '', get: (d) => d.sleepScore ?? null },
    { noun: 'HRV', unit: 'ms', get: (d) => d.hrvOvernight ?? null },
  ];
  const out = [];
  for (const item of stackItems || []) {
    for (const t of tests) {
      const taken = [], skipped = [];
      for (const row of sleepRows) {
        const v = t.get(row);
        if (v == null) continue;
        const day = shiftDate(row.date, -1);
        if (!isScheduledForDate(item.schedule, new Date(day + 'T12:00:00'))) continue;
        (stackEntries[`${day}-${item.id}`]?.taken ? taken : skipped).push(v);
      }
      if (taken.length < MIN_GROUP || skipped.length < MIN_GROUP) continue;
      const a = mean(taken), b = mean(skipped);
      if (!b || Math.abs(a - b) / b < 0.08) continue;
      out.push({ kind: 'supplement', item: item.name, metric: t.noun, unit: t.unit, takenAvg: a, skippedAvg: b, diff: a - b, rel: Math.abs(a - b) / b, nights: taken.length, total: taken.length + skipped.length });
    }
  }
  const best = new Map();
  for (const f of out) if (!best.has(f.item) || best.get(f.item).rel < f.rel) best.set(f.item, f);
  return [...best.values()].sort((x, y) => y.rel - x.rel).slice(0, limit);
}

// Consecutive missing nights become one run, so a week off shows as one block with one label
export function gapRuns(rows) {
  const runs = [];
  rows.forEach((r, i) => {
    if (!r.missing) return;
    const last = runs[runs.length - 1];
    if (last && last.endIdx === i - 1) { last.end = r.date; last.endIdx = i; last.n++; }
    else runs.push({ start: r.date, end: r.date, endIdx: i, n: 1 });
  });
  return runs;
}

// Label a gap only when it has room: "no data · 6 nights", then "no data", then nothing
export function gapLabel(run, pxPerNight) {
  const w = run.n * pxPerNight;
  const value = run.n > 1 && w >= 104 ? `no data · ${run.n} nights` : w >= 46 ? 'no data' : null;
  return value ? { value, fill: '#6b7280', fontSize: 10, position: 'insideTop' } : undefined;
}

export { DAY_MS };
