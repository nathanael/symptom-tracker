import { formatDate } from '../utils/helpers';
import HealthScoreBadge from './HealthScoreBadge';
import { useHealthScore } from '../hooks/useHealthScore';

export default function Header({
  selectedDate,
  changeDate,
  canGoForward,
  setShowCalendar,
  setCalendarMonth,
  symptoms,
  entries,
  trackingMode,
}) {
  const { score, delta } = useHealthScore(selectedDate, { symptoms, entries, trackingMode });

  return (
    <div style={{
      flexShrink: 0,
      padding: '8px 12px',
      zIndex: 100,
      background: 'rgba(8, 9, 10, 0.98)',
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <button
        onClick={() => changeDate(-1)}
        style={{
          background: 'transparent',
          border: 'none',
          width: '48px',
          height: '48px',
          color: '#9ca3af',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
      </button>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
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
            padding: '8px 0',
          }}
        >
          <span style={{
            color: '#f3f4f6',
            fontSize: '17px',
            fontWeight: '600',
            whiteSpace: 'nowrap',
          }}>
            {formatDate(selectedDate)}
          </span>
        </button>
        <HealthScoreBadge score={score} delta={delta} />
      </div>

      <button
        onClick={() => changeDate(1)}
        disabled={!canGoForward}
        style={{
          background: 'transparent',
          border: 'none',
          width: '48px',
          height: '48px',
          color: canGoForward ? '#9ca3af' : '#4b5563',
          cursor: canGoForward ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: canGoForward ? 1 : 0.5,
          flexShrink: 0,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    </div>
  );
}
