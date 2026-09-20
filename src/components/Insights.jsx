import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './desktopNav.css';
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
  barSlot,
  trackingMode,
  setStackItems,
}) {
  const [view, setView] = useState(readInitialView);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
  }, [view]);

  return (
    <div style={isDesktop ? {} : { padding: '12px 12px 0' }}>
      <div style={{ maxWidth: isDesktop ? '100%' : '700px', margin: '0 auto' }}>
        {barSlot && createPortal(<ViewToggle value={view} onChange={setView} />, barSlot)}
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
    <div className="dn-seg sm">
      {opts.map(opt => (
        <button key={opt.key} className={opt.key === value ? 'on' : ''} onClick={() => onChange(opt.key)}>{opt.label}</button>
      ))}
    </div>
  );
}
