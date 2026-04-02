import { useMemo } from 'react';
import { computeHealthScore, computeRollingAvg } from '../utils/healthScore';

export function useHealthScore(date, { symptoms, entries, trackingMode, rollingDays = 7 }) {
  const dateStr = typeof date === 'string' ? date
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  return useMemo(() => {
    const { score, loggedCount, totalActive } = computeHealthScore(symptoms, entries, dateStr, trackingMode);
    const rollingAvg = computeRollingAvg(symptoms, entries, dateStr, trackingMode, rollingDays);
    const delta = (score !== null && rollingAvg !== null) ? score - rollingAvg : null;

    return { score, loggedCount, totalActive, rollingAvg, delta, rollingDays };
  }, [dateStr, symptoms, entries, trackingMode, rollingDays]);
}
