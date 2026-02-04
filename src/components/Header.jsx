import { formatDate } from '../utils/helpers';

export default function Header({
  selectedDate,
  changeDate,
  canGoForward,
  setShowCalendar,
  setCalendarMonth,
}) {
  return (
    <div style={{
      flexShrink: 0,
      padding: '12px 20px',
      zIndex: 100,
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    }}>
      {/* Centered date navigation - expanded width */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: '8px',
        padding: '4px',
        border: '1px solid rgba(255, 255, 255, 0.05)',
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
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>
    </div>
  );
}
