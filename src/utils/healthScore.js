import { getDailyValue } from './chartHelpers';

/**
 * Compute health score for a single date.
 * Returns { score: number|null, loggedCount: number, totalActive: number }
 */
export function computeHealthScore(symptoms, entries, dateStr, trackingMode) {
  const active = symptoms.filter(s => s.active);
  const totalActive = active.length;

  let sum = 0;
  let loggedCount = 0;

  for (const sym of active) {
    const val = getDailyValue(entries, dateStr, sym.id, trackingMode);
    if (val === null || val === -1) continue;
    sum += val;
    loggedCount++;
  }

  if (loggedCount === 0) return { score: null, loggedCount: 0, totalActive };

  const score = 100 - Math.round((sum / (loggedCount * 5)) * 100);
  return { score, loggedCount, totalActive };
}

/**
 * Compute rolling average of health score over past N days (excludes current date).
 * Returns number or null.
 */
export function computeRollingAvg(symptoms, entries, dateStr, trackingMode, days = 7) {
  const scores = [];
  const d = new Date(dateStr + 'T00:00:00');

  for (let i = 1; i <= days; i++) {
    const past = new Date(d);
    past.setDate(past.getDate() - i);
    const y = past.getFullYear();
    const m = String(past.getMonth() + 1).padStart(2, '0');
    const day = String(past.getDate()).padStart(2, '0');
    const pastStr = `${y}-${m}-${day}`;

    const { score } = computeHealthScore(symptoms, entries, pastStr, trackingMode);
    if (score !== null) scores.push(score);
  }

  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function getScoreColor(score) {
  if (score === null) return '#64748b';
  if (score >= 80) return '#22c55e';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}
