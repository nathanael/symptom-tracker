import { useEffect, useState } from 'react';
import ComparisonStudio from './ComparisonStudio';
import SleepAnalyzer from './SleepAnalyzer';

const VIEW_KEY = 'insightsView';

function readInitialView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'sleep' ? 'sleep' : 'comparison';
  } catch {
    return 'comparison';
  }
}

export default function Insights({
  user,
  entries,
  symptoms,
  stackItems,
  stackEntries,
  isDesktop,
  trackingMode,
  setStackItems,
}) {
  const [view, setView] = useState(readInitialView);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
  }, [view]);

  return (
    <div
      style={isDesktop ? {} : {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#08090A',
        zIndex: 100,
        overflowY: 'auto',
        padding: '20px 20px 120px 20px',
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
      }}
    >
      <div style={{ maxWidth: isDesktop ? '100%' : '700px', margin: '0 auto' }}>
        <ViewToggle value={view} onChange={setView} />
        <div style={{ height: 12 }} />
        {view === 'comparison' ? (
          <ComparisonStudio
            entries={entries}
            symptoms={symptoms}
            stackItems={stackItems}
            stackEntries={stackEntries}
            trackingMode={trackingMode}
            isDesktop={isDesktop}
            setStackItems={setStackItems}
            user={user}
          />
        ) : (
          <SleepAnalyzer user={user} isDesktop={isDesktop} />
        )}
      </div>
    </div>
  );
}

function ViewToggle({ value, onChange }) {
  const opts = [
    { key: 'comparison', label: 'Comparison' },
    { key: 'sleep',      label: 'Sleep'      },
  ];
  return (
    <div style={{
      display: 'flex', gap: 2, borderRadius: 8,
      background: 'rgba(255,255,255,0.06)', padding: 2,
    }}>
      {opts.map(opt => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              padding: '7px 0', fontSize: 13, borderRadius: 6,
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
