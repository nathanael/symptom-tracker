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

export default function SleepAnalyzer({ user, isDesktop }) {
  const { days, loading, error } = useGarminSleep(user);
  const [preset, setPreset] = useState('3mo');
  const [viewMode, setViewMode] = useState('weeks');

  const availableMin = days.length ? days[0].date : null;
  const availableMax = days.length ? days[days.length - 1].date : null;

  const visible = useMemo(() => {
    if (!days.length) return [];
    const range = rangeForPreset(preset, availableMin, availableMax);
    const sliced = days.filter(d => d.date >= range.start && d.date <= range.end);
    return aggregate(sliced, viewMode);
  }, [days, preset, viewMode, availableMin, availableMax]);

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

  return (
    <div style={styles.root}>
      <SegmentedToggle options={PRESETS} value={preset} onChange={setPreset} />
      <div style={{ height: 8 }} />
      <SegmentedToggle options={MODES} value={viewMode} onChange={setViewMode} />
      <div style={styles.stub}>
        Visible: {visible.length} {viewMode === 'days' ? 'day' : viewMode.slice(0, -1)}
        {visible.length === 1 ? '' : 's'} ({availableMin} to {availableMax}, {days.length} total)
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
