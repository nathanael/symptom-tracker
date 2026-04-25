// Sleep metric definitions used by SleepAnalyzer and the comparison view.
// Pure data — no React dependency — so non-component utilities can import.
export const METRICS = [
  { key: 'sleepScore',       label: 'Score',  unit: '', higherIsBetter: true },
  { key: 'duration',         label: 'Time',   unit: 'min', higherIsBetter: true,
    compute: d => {
      const total = (d.deepSleepSeconds || 0) + (d.lightSleepSeconds || 0) + (d.remSleepSeconds || 0);
      return total ? Math.round(total / 60) : null;
    } },
  { key: 'remSleepSeconds',  label: 'REM',    unit: 'min', higherIsBetter: true,
    transform: v => Math.round(v / 60),
    refs: [{ y: 60, color: '#ef4444' }, { y: 90, color: '#10b981' }] },
  { key: 'deepSleepSeconds', label: 'Deep',   unit: 'min', higherIsBetter: true,
    transform: v => Math.round(v / 60),
    refs: [{ y: 60, color: '#f59e0b' }] },
  { key: 'averageRespiration', label: 'Resp', unit: 'brpm', higherIsBetter: false },
  { key: 'lowestSpo2',       label: 'SpO2',   unit: '%', higherIsBetter: true },
  { key: 'avgSleepStress',   label: 'Stress', unit: '', higherIsBetter: false },
  { key: 'hrvOvernight',     label: 'HRV',    unit: 'ms', higherIsBetter: true },
];

export function valueForRow(metric, row) {
  if (!row) return null;
  if (metric.compute) return metric.compute(row);
  const raw = row[metric.key];
  if (raw == null) return null;
  return metric.transform ? metric.transform(raw) : raw;
}
