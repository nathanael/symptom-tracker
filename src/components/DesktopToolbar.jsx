import { useEffect, useRef } from 'react';
import './desktopNav.css';
import { formatDate } from '../utils/helpers';
import { getScoreColor } from '../utils/healthScore';
import { useHealthScore } from '../hooks/useHealthScore';

const TABS = [
  { id: 'symptoms', label: 'Symptoms' },
  { id: 'stack', label: 'Protocol' },
  { id: 'insights', label: 'Progress' },
];

const DAY_MS = 86400000;

// Garmin sync pill: dot colour tracks how fresh the newest night is
function garminStatus(sync, days) {
  const latest = days.reduce((max, d) => (d.date > max ? d.date : max), '');
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  };
  if (!latest) {
    return { tone: 'off', label: 'No data', tip: sync.serverAvailable ? 'Garmin: nothing synced yet' : 'Garmin: server not detected on this machine' };
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const nights = Math.round((today - new Date(latest + 'T00:00:00')) / DAY_MS);
  const label = nights <= 0 ? 'Last night' : nights === 1 ? '1 night behind' : `${nights} nights behind`;
  const parts = [`Garmin: newest night ${latest}`];
  if (sync.lastSync) parts.push(`synced ${ago(sync.lastSync)}`);
  if (sync.error) parts.push(sync.error);
  return { tone: sync.error ? 'warn' : nights <= 0 ? 'ok' : 'warn', label, tip: parts.join(' · ') };
}

const Chevron = ({ points }) => <svg viewBox="0 0 24 24"><polyline points={points} /></svg>;

export default function DesktopToolbar({
  // Date navigation
  selectedDate,
  changeDate,
  canGoForward,
  setShowCalendar,
  setCalendarMonth,
  // Tab state
  appMode,
  setAppMode,
  showInsights,
  setShowInsights,
  trackingMode,
  // Search (filters the active list)
  search,
  setSearch,
  // The active view portals its scope + actions into this node
  slotRef,
  // Action handlers
  settingsOpen,
  onCloseSettings,
  onOpenSettings,
  onCopyData,
  copyDays,
  symptoms,
  entries,
  garminSync,
  garminSleepDays,
  showSleep,
  setShowSleep,
  sleepAvailable,
}) {
  const searchRef = useRef(null);
  const isToday = selectedDate.toDateString() === new Date().toDateString();
  const activeTab = showSleep ? 'sleep' : showInsights ? 'insights' : appMode === 'symptoms' ? 'symptoms' : 'stack';

  const { score, delta, rollingAvg } = useHealthScore(selectedDate, { symptoms, entries, trackingMode });
  const scoreValue = score !== null ? score : rollingAvg;
  const scoreColor = scoreValue !== null ? getScoreColor(scoreValue) : null;

  const handleTabClick = (tab) => {
    onCloseSettings?.();
    setShowSleep?.(tab === 'sleep');
    if (tab === 'sleep') {
      setShowInsights(false);
    } else if (tab === 'insights') {
      setShowInsights(true);
    } else {
      setShowInsights(false);
      setAppMode(tab);
    }
  };

  // ⌘K / Ctrl+K focuses search from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const relativeLabel = formatDate(selectedDate);
  const fullDate = selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <>
      {/* Layer 1: where am I — identical on every tab */}
      <div className="dn-top">
        <div className="dn-wrap">
          <div className="dn-brand" title="Glimpse" aria-label="Glimpse">
            <span className="dn-logo"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><circle className="pupil" cx="15.5" cy="11" r="3" /></svg></span>
          </div>

          <div className="dn-seg" role="tablist">
            {(sleepAvailable ? [...TABS, { id: 'sleep', label: 'Sleep' }] : TABS).map((tab) => (
              <button key={tab.id} role="tab" aria-selected={!settingsOpen && activeTab === tab.id} className={!settingsOpen && activeTab === tab.id ? 'on' : ''} onClick={() => handleTabClick(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="dn-right">
            {activeTab !== 'insights' && activeTab !== 'sleep' && !settingsOpen && (
              <label className="dn-search">
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  placeholder="Search"
                  aria-label={activeTab === 'symptoms' ? 'Search symptoms' : 'Search protocol'}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); e.target.blur(); } }}
                />
                <kbd>⌘K</kbd>
              </label>
            )}
            {scoreValue !== null && (
              <div className="dn-score" title="Health score">
                <span className="dn-ring" style={{ background: `conic-gradient(${scoreColor} ${scoreValue}%, rgba(255,255,255,.08) 0)` }} />
                {scoreValue}%
                {delta !== null && delta !== 0 && (
                  <small style={{ color: delta > 0 ? '#22c55e' : '#ef4444' }}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</small>
                )}
              </div>
            )}
            {garminSync && (() => {
              const g = garminStatus(garminSync, garminSleepDays || []);
              return (
                <button className={`dn-garmin ${g.tone}${garminSync.syncing ? ' syncing' : ''}`} data-tip={garminSync.syncing ? 'Garmin: syncing…' : g.tip} aria-label={g.tip} onClick={() => (sleepAvailable ? handleTabClick('sleep') : onOpenSettings())}>
                  <span className="dn-dot" />Garmin<small>{garminSync.syncing ? 'Syncing…' : g.label}</small>
                </button>
              );
            })()}
            <button className="dn-icon" data-tip={`Copy last ${copyDays} days of data`} aria-label={`Copy last ${copyDays} days of data`} onClick={onCopyData}>
              <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            </button>
            <button className={`dn-icon ${settingsOpen ? 'on' : ''}`} data-tip="Settings" aria-label="Settings" onClick={onOpenSettings}>
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Layer 2: what am I looking at (left) → what can I do (right) */}
      <div className="dn-context">
        <div className="dn-wrap">
          {activeTab !== 'insights' && activeTab !== 'sleep' && (
            <>
              <div className="dn-step">
                <button aria-label="Previous day" onClick={() => changeDate(-1)}><Chevron points="15 18 9 12 15 6" /></button>
                <button
                  className="dn-date"
                  title="Open calendar"
                  onClick={() => {
                    setCalendarMonth(new Date(selectedDate));
                    setShowCalendar(true);
                  }}
                >
                  {relativeLabel}
                  {relativeLabel !== fullDate && <small>{fullDate}</small>}
                </button>
                <button aria-label="Next day" disabled={!canGoForward} onClick={() => changeDate(1)}><Chevron points="9 18 15 12 9 6" /></button>
              </div>
              {!isToday && (
                <button
                  className="dn-btn ghost"
                  onClick={() => {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    setShowCalendar(false);
                    changeDate(Math.round((today - new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())) / (1000 * 60 * 60 * 24)));
                  }}
                >
                  Today
                </button>
              )}
            </>
          )}
          <div className="dn-slot" ref={slotRef} />
        </div>
      </div>
    </>
  );
}
