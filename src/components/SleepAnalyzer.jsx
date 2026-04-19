import React, { useMemo, useState } from 'react';
import { useGarminSleep } from '../hooks/useGarminSleep';
import { aggregate, rangeForPreset } from '../utils/garminSleepCache';

const PRESETS = [
  { key: '7d',  label: '7D'  },
  { key: '14d', label: '14D' },
  { key: '30d', label: '30D' },
  { key: '3mo', label: '3M'  },
  { key: '6mo', label: '6M'  },
  { key: '1y',  label: '1Y'  },
  { key: 'all', label: 'All' },
];

const MODES = [
  { key: 'days',   label: 'Days'   },
  { key: 'weeks',  label: 'Weeks'  },
  { key: 'months', label: 'Months' },
];

export const METRICS = [
  { key: 'sleepScore',       label: 'Score',  unit: '' },
  { key: 'duration',         label: 'Time',   unit: 'min',
    compute: d => {
      const total = (d.deepSleepSeconds || 0) + (d.lightSleepSeconds || 0) + (d.remSleepSeconds || 0);
      return total ? Math.round(total / 60) : null;
    } },
  { key: 'remSleepSeconds',  label: 'REM',    unit: 'min',
    transform: v => Math.round(v / 60),
    refs: [{ y: 60, color: '#ef4444' }, { y: 90, color: '#10b981' }] },
  { key: 'deepSleepSeconds', label: 'Deep',   unit: 'min',
    transform: v => Math.round(v / 60),
    refs: [{ y: 60, color: '#f59e0b' }] },
  { key: 'averageRespiration', label: 'Resp', unit: 'brpm' },
  { key: 'lowestSpo2',       label: 'SpO2',   unit: '%' },
  { key: 'avgSleepStress',   label: 'Stress', unit: '' },
  { key: 'hrvOvernight',     label: 'HRV',    unit: 'ms' },
];

export function valueForRow(metric, row) {
  if (!row) return null;
  if (metric.compute) return metric.compute(row);
  const raw = row[metric.key];
  if (raw == null) return null;
  return metric.transform ? metric.transform(raw) : raw;
}

export default function SleepAnalyzer({ user, isDesktop }) {
  const { days, loading, error } = useGarminSleep(user);
  const [preset, setPreset] = useState('3mo');
  const [viewMode, setViewMode] = useState('weeks');
  const [activeMetric, setActiveMetric] = useState('sleepScore');

  const availableMin = days.length ? days[0].date : null;
  const availableMax = days.length ? days[days.length - 1].date : null;

  const visible = useMemo(() => {
    if (!days.length) return [];
    const range = rangeForPreset(preset, availableMin, availableMax);
    const sliced = days.filter(d => d.date >= range.start && d.date <= range.end);
    return aggregate(sliced, viewMode);
  }, [days, preset, viewMode, availableMin, availableMax]);

  const activeMetricDef = useMemo(
    () => METRICS.find(m => m.key === activeMetric),
    [activeMetric]
  );

  if (!user) {
    return <div style={styles.empty}>Sign in with Google in Settings to view Garmin sleep data.</div>;
  }
  if (loading && days.length === 0) {
    return <div style={styles.empty}>Loading…</div>;
  }
  if (error && days.length === 0) {
    return <div style={styles.empty}>Could not load sleep data. Check your connection.</div>;
  }
  if (days.length === 0) {
    return (
      <div style={styles.empty}>
        No sleep data synced yet. Run{' '}
        <code>sync.py &amp;&amp; push_to_firestore.py</code> on your Mac.
      </div>
    );
  }

  const firstValue = visible.length ? valueForRow(activeMetricDef, visible[0]) : null;
  const lastValue = visible.length ? valueForRow(activeMetricDef, visible[visible.length - 1]) : null;

  return (
    <div style={styles.root}>
      <SegmentedToggle options={METRICS.map(m => ({ key: m.key, label: m.label }))}
                       value={activeMetric} onChange={setActiveMetric} />
      <div style={{ height: 8 }} />
      <SegmentedToggle options={PRESETS} value={preset} onChange={setPreset} />
      <div style={{ height: 8 }} />
      <SegmentedToggle options={MODES} value={viewMode} onChange={setViewMode} />
      <div style={styles.stub}>
        <div style={{ fontWeight: 600, color: '#e5e7eb', marginBottom: 4 }}>
          {activeMetricDef.label} {activeMetricDef.unit && `(${activeMetricDef.unit})`}
        </div>
        <div style={{ fontSize: 12 }}>
          {visible.length} bucket(s). First: {firstValue}, Last: {lastValue}
        </div>
      </div>
    </div>
  );
}

function SegmentedToggle({ options, value, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 2, borderRadius: 8,
      background: 'rgba(255,255,255,0.06)', padding: 2,
    }}>
      {options.map(opt => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              padding: '6px 0', fontSize: 13, borderRadius: 6,
              border: 'none', cursor: 'pointer', flex: 1,
              color: active ? '#fff' : '#9ca3af',
              background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
              fontWeight: active ? 600 : 500,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const styles = {
  root: { color: '#e5e7eb' },
  empty: { color: '#9ca3af', padding: '24px', textAlign: 'center' },
  stub: { marginTop: 16, color: '#9ca3af', fontSize: 13 },
};
