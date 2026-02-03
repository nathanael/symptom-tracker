import { formatDate } from '../utils/helpers';

export default function Header({
  selectedDate,
  changeDate,
  canGoForward,
  setShowCalendar,
  setCalendarMonth,
  appMode,
  setShowAddSymptom,
  setShowManageStack,
}) {
  return (
    <div style={{
      flexShrink: 0,
      padding: '12px 12px',
      zIndex: 100,
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {/* Left side: date navigation - FIXED WIDTH */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          padding: '4px',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          width: '192px',
          justifyContent: 'space-between',
        }}>
          <button
            onClick={() => changeDate(-1)}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              width: '44px',
              height: '44px',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              margin: '-8px',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
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
              textAlign: 'center',
              padding: '4px 0',
              flex: 1,
            }}
          >
            <span style={{
              color: '#f3f4f6',
              fontSize: '14px',
              fontWeight: '500',
              whiteSpace: 'nowrap',
            }}>
              {formatDate(selectedDate)}
            </span>
          </button>

          <button
            onClick={() => changeDate(1)}
            disabled={!canGoForward}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              width: '44px',
              height: '44px',
              color: canGoForward ? '#9ca3af' : '#4b5563',
              cursor: canGoForward ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canGoForward ? 1 : 0.5,
              flexShrink: 0,
              margin: '-8px',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>

        {/* Right side: Edit List button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {appMode === 'symptoms' && (
            <button
              onClick={() => setShowAddSymptom(true)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '8px 12px',
                color: '#8b5cf6',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Edit List
            </button>
          )}
          {appMode === 'stack' && (
            <button
              onClick={() => setShowManageStack(true)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '8px 12px',
                color: '#8b5cf6',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Edit List
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
