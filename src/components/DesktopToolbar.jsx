import { formatDate, getCurrentTimePeriod } from '../utils/helpers';
import DayNightToggle from './DayNightToggle';
import HealthScoreBadge from './HealthScoreBadge';
import { useHealthScore } from '../hooks/useHealthScore';

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
  // AM/PM toggle
  quickLogTime,
  setQuickLogTime,
  trackingMode,
  flashColumn,
  setFlashColumn,
  setCopyToastMessage,
  // Action handlers
  onOpenSettings,
  symptoms,
  entries,
}) {
  const isToday = selectedDate.toDateString() === new Date().toDateString();

  // Determine active tab
  const activeTab = showInsights ? 'insights' : appMode;

  const { score, delta } = useHealthScore(selectedDate, { symptoms, entries, trackingMode });

  const handleTabClick = (tab) => {
    if (tab === 'insights') {
      setShowInsights(true);
    } else {
      setShowInsights(false);
      setAppMode(tab);
    }
  };

  // Icons
  const GearIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;

  return (
    <div style={{
      flexShrink: 0,
      height: '56px',
      background: 'rgba(8, 9, 10, 0.98)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      display: 'flex',
      alignItems: 'center',
      zIndex: 200,
    }}>
      <div style={{
        maxWidth: '1400px',
        width: '100%',
        margin: '0 auto',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
      }}>
        {/* Left: Date navigation — fixed width, hidden on insights */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          flexShrink: 0,
          width: '280px',
          visibility: activeTab === 'insights' ? 'hidden' : 'visible',
        }}>
          <button
            onClick={() => changeDate(-1)}
            style={{
              background: 'transparent',
              border: 'none',
              width: '32px',
              height: '32px',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          <button
            onClick={() => {
              setCalendarMonth(new Date(selectedDate));
              setShowCalendar(true);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '6px 12px',
              borderRadius: '6px',
              color: '#f3f4f6',
              fontSize: '15px',
              fontWeight: '600',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {formatDate(selectedDate)}
          </button>

          <button
            onClick={() => changeDate(1)}
            disabled={!canGoForward}
            style={{
              background: 'transparent',
              border: 'none',
              width: '32px',
              height: '32px',
              color: canGoForward ? '#9ca3af' : '#4b5563',
              cursor: canGoForward ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canGoForward ? 1 : 0.5,
              borderRadius: '6px',
            }}
            onMouseEnter={(e) => { if (canGoForward) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {!isToday && (
            <button
              onClick={() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                setShowCalendar(false);
                changeDate(Math.round((today - new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())) / (1000 * 60 * 60 * 24)));
              }}
              style={{
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                borderRadius: '6px',
                padding: '4px 10px',
                color: '#a78bfa',
                fontSize: '12px',
                fontWeight: '500',
                cursor: 'pointer',
                marginLeft: '4px',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)'; }}
            >
              Today
            </button>
          )}
        </div>

        {/* Center: View tabs — fixed in center */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
        }}>
          {[
            { id: 'symptoms', label: 'Symptoms' },
            { id: 'stack', label: 'Protocol' },
            { id: 'insights', label: 'Insights' },
          ].map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '8px 20px',
                  color: isActive ? '#f3f4f6' : '#6b7280',
                  fontSize: '14px',
                  fontWeight: isActive ? '600' : '500',
                  cursor: 'pointer',
                  position: 'relative',
                  borderBottom: isActive ? '2px solid #8b5cf6' : '2px solid transparent',
                  marginBottom: '-1px',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = '#9ca3af'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = '#6b7280'; }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Right: Settings only — fixed width to balance left */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          flexShrink: 0,
          width: '280px',
          justifyContent: 'flex-end',
        }}>
          <HealthScoreBadge score={score} delta={delta} />
          <button
            onClick={onOpenSettings}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px',
              color: '#9ca3af',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              e.currentTarget.style.color = '#e5e7eb';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#9ca3af';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', width: '14px', height: '14px' }}>{GearIcon}</span>
            Settings
          </button>
        </div>
      </div>
    </div>
  );
}
