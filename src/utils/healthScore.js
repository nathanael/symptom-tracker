import { getDailyValue } from './chartHelpers';

const SLEEP_WEIGHT = 0.10; // sleep score is 10% of health score when available

function getSleepScoreForDate(dateStr) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('garminSleepCache');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const days = parsed.days;
    if (!Array.isArray(days)) return null;
    const day = days.find(d => d.date === dateStr);
    return day?.sleepScore ?? null;
  } catch {
    return null;
  }
}

/**
 * Compute health score for a single date.
 * When Garmin sleep data is available, blends 90% symptom score + 10% sleep score.
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

  const symptomScore = 100 - (sum / (loggedCount * 5)) * 100;
  const sleepScore = getSleepScoreForDate(dateStr);

  let score;
  if (sleepScore != null) {
    score = Math.round(symptomScore * (1 - SLEEP_WEIGHT) + sleepScore * SLEEP_WEIGHT);
  } else {
    score = Math.round(symptomScore);
  }

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
