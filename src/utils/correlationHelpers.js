import { getDailyValue, generateDateRange, interpolateSmallGaps } from './chartHelpers';
import { isScheduledForDate } from './helpers';

/**
 * Extract daily symptom severity series for a date range.
 * Returns array of numbers/nulls aligned to dates.
 */
export function getSymptomDailySeries(entries, symptomId, dates, trackingMode) {
  return dates.map(d => getDailyValue(entries, d, symptomId, trackingMode));
}

/**
 * Extract binary taken/not-taken series for a supplement.
 * Schedule-aware: null for days the supplement wasn't scheduled.
 * 1 = taken, 0 = not taken (but was scheduled).
 */
export function getSupplementBinarySeries(stackEntries, stackItems, itemId, dates) {
  const item = stackItems.find(i => i.id === itemId);
  if (!item) return dates.map(() => null);

  return dates.map(dateStr => {
    const d = new Date(dateStr + 'T12:00:00');
    if (!isScheduledForDate(item.schedule, d)) return null;
    const entryKey = `${dateStr}-${itemId}`;
    return stackEntries[entryKey]?.taken ? 1 : 0;
  });
}

/**
 * Extract dose series for a supplement.
 * Returns actual dose on taken days, null otherwise.
 * Falls back to defaultDose from stackItems when entry has no dose recorded.
 */
export function getSupplementDoseSeries(stackEntries, stackItems, itemId, dates) {
  const item = (stackItems || []).find(i => i.id === itemId);
  const fallbackDose = item?.defaultDose || 0;
  return dates.map(dateStr => {
    const entryKey = `${dateStr}-${itemId}`;
    const entry = stackEntries[entryKey];
    if (!entry?.taken) return null;
    const dose = Number(entry.dose) || fallbackDose;
    // Reject non-finite or absurdly large values
    if (!isFinite(dose) || dose > 100000) return fallbackDose || null;
    return dose;
  });
}

/**
 * Shift a series by lagDays positions.
 * Positive lag = "symptom response happens N days AFTER supplement intake"
 * i.e., symptom data is shifted forward (to the right) relative to supplement.
 */
export function applyLag(series, lagDays) {
  if (lagDays === 0) return series;
  const result = new Array(series.length).fill(null);
  for (let i = 0; i < series.length; i++) {
    const srcIdx = i - lagDays;
    if (srcIdx >= 0 && srcIdx < series.length) {
      result[i] = series[srcIdx];
    }
  }
  return result;
}

/**
 * Compute Pearson correlation coefficient between two series.
 * Ignores index positions where either value is null.
 * Requires at least minPairs valid pairs.
 * Returns { r, n, pValue }.
 */
export function pearsonCorrelation(seriesA, seriesB, minPairs = 7) {
  const pairs = [];
  for (let i = 0; i < Math.min(seriesA.length, seriesB.length); i++) {
    if (seriesA[i] !== null && seriesB[i] !== null) {
      pairs.push([seriesA[i], seriesB[i]]);
    }
  }

  const n = pairs.length;
  if (n < minPairs) return { r: null, n, pValue: null };

  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (const [a, b] of pairs) {
    sumA += a;
    sumB += b;
    sumAB += a * b;
    sumA2 += a * a;
    sumB2 += b * b;
  }

  const numerator = n * sumAB - sumA * sumB;
  const denomA = n * sumA2 - sumA * sumA;
  const denomB = n * sumB2 - sumB * sumB;
  const denom = Math.sqrt(denomA * denomB);

  if (denom === 0) return { r: 0, n, pValue: 1 };

  const r = numerator / denom;

  // p-value via t-distribution approximation
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  const pValue = tDistPValue(Math.abs(t), n - 2);

  return { r: Math.round(r * 1000) / 1000, n, pValue };
}

/**
 * Approximate two-tailed p-value from t-statistic and degrees of freedom.
 * Uses the incomplete beta function approximation.
 */
function tDistPValue(t, df) {
  if (df <= 0) return 1;
  const x = df / (df + t * t);
  // Regularized incomplete beta function approximation
  return incompleteBeta(df / 2, 0.5, x);
}

/**
 * Regularized incomplete beta function I_x(a, b) approximation.
 * Uses continued fraction for better convergence.
 */
function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use series expansion for small x
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);

  // Lentz's continued fraction
  if (x < (a + 1) / (a + b + 2)) {
    return front * betaCF(a, b, x) / a;
  } else {
    return 1 - front * betaCF(b, a, 1 - x) / b;
  }
}

function betaCF(a, b, x) {
  const maxIter = 200;
  const eps = 1e-10;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < eps) d = eps;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < eps) d = eps;
    c = 1 + aa / c;
    if (Math.abs(c) < eps) c = eps;
    d = 1 / d;
    h *= d * c;

    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < eps) d = eps;
    c = 1 + aa / c;
    if (Math.abs(c) < eps) c = eps;
    d = 1 / d;
    const del = d * c;
    h *= del;

    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

function lnGamma(z) {
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Compute Pearson r at each lag from -maxLag to +maxLag.
 * Returns array of { lag, r, n }.
 */
export function crossCorrelation(suppSeries, symptomSeries, maxLag = 21) {
  const results = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const laggedSymptom = applyLag(symptomSeries, lag);
    const { r, n } = pearsonCorrelation(suppSeries, laggedSymptom);
    results.push({ lag, r, n });
  }
  return results;
}

/**
 * Find the lag with highest absolute |r| across all results.
 * Returns { lag, r, direction }.
 */
export function findOptimalLag(crossCorrResults) {
  let best = { lag: 0, r: null, direction: 'none' };
  let bestAbs = 0;

  for (const { lag, r } of crossCorrResults) {
    if (r === null) continue;
    const absR = Math.abs(r);
    if (absR > bestAbs) {
      bestAbs = absR;
      best = {
        lag,
        r,
        direction: r < 0 ? 'helps' : r > 0 ? 'worsens' : 'none',
      };
    }
  }

  return best;
}
