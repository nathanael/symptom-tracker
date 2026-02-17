import { useMemo } from 'react';
import { severityColors, NA_SEVERITY } from '../utils/constants';
import { getDateKey } from '../utils/helpers';

export default function Calendar({
  selectedDate,
  selectDate,
  calendarMonth,
  setCalendarMonth,
  entries,
  onClose,
}) {
  // Calculate days in month
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days = [];

    // Add empty cells for days before the first of the month
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }

    return days;
  }, [calendarMonth]);

  // Calculate severity map for heat visualization
  const daySeverityMap = useMemo(() => {
    const map = {};
    Object.values(entries).forEach(entry => {
      if (entry.severity === NA_SEVERITY) return;
      if (!map[entry.date]) {
        map[entry.date] = { total: 0, count: 0 };
      }
      map[entry.date].total += entry.severity;
      map[entry.date].count += 1;
    });
    Object.keys(map).forEach(date => {
      map[date].avg = map[date].total / map[date].count;
    });
    return map;
  }, [entries]);

  const changeMonth = (delta) => {
    setCalendarMonth(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + delta);
      return newDate;
    });
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(15, 17, 21, 0.95)',
          borderRadius: '12px',
          padding: '20px',
          width: '100%',
          maxWidth: '360px',
          border: '1px solid rgba(99, 102, 241, 0.3)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}>
          <button
            onClick={() => changeMonth(-1)}
            style={{
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '5px',
              width: '36px',
              height: '36px',
              color: '#a5b4fc',
              fontSize: '18px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ‹
          </button>

          <h3 style={{
            color: '#f8fafc',
            fontSize: '18px',
            fontWeight: '600',
            margin: 0,
          }}>
            {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </h3>

          <button
            onClick={() => changeMonth(1)}
            style={{
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '5px',
              width: '36px',
              height: '36px',
              color: '#a5b4fc',
              fontSize: '18px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ›
          </button>
        </div>

        {/* Day labels */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '4px',
          marginBottom: '8px',
        }}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                color: '#64748b',
                fontSize: '12px',
                fontWeight: '600',
                padding: '4px',
              }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '4px',
        }}>
          {calendarDays.map((day, i) => {
            if (!day) {
              return <div key={i} />;
            }

            const dateKey = getDateKey(day);
            const isSelected = dateKey === getDateKey(selectedDate);
            const isToday = dateKey === getDateKey(new Date());
            const isFuture = day > today;
            const dayData = daySeverityMap[dateKey];
            const hasData = !!dayData;

            // Determine heat color based on average severity
            let heatColor = 'transparent';
            if (hasData) {
              const avg = dayData.avg;
              if (avg <= 1) heatColor = 'rgba(34, 197, 94, 0.3)';
              else if (avg <= 2) heatColor = 'rgba(163, 230, 53, 0.3)';
              else if (avg <= 3) heatColor = 'rgba(250, 204, 21, 0.3)';
              else if (avg <= 4) heatColor = 'rgba(251, 146, 60, 0.3)';
              else heatColor = 'rgba(239, 68, 68, 0.3)';
            }

            return (
              <button
                key={i}
                onClick={() => !isFuture && selectDate(day)}
                disabled={isFuture}
                style={{
                  aspectRatio: '1',
                  background: isSelected
                    ? 'rgba(139, 92, 246, 0.4)'
                    : heatColor,
                  border: isToday
                    ? '2px solid #8b5cf6'
                    : isSelected
                    ? '2px solid rgba(139, 92, 246, 0.6)'
                    : '1px solid transparent',
                  borderRadius: '8px',
                  color: isFuture ? '#475569' : isSelected ? '#fff' : '#e2e8f0',
                  fontSize: '14px',
                  fontWeight: isToday || isSelected ? '700' : '400',
                  cursor: isFuture ? 'default' : 'pointer',
                  opacity: isFuture ? 0.4 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '12px',
          marginTop: '16px',
          paddingTop: '12px',
          borderTop: '1px solid rgba(100, 116, 139, 0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'rgba(34, 197, 94, 0.5)' }} />
            <span style={{ color: '#64748b', fontSize: '11px' }}>Good</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'rgba(250, 204, 21, 0.5)' }} />
            <span style={{ color: '#64748b', fontSize: '11px' }}>Moderate</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: 'rgba(239, 68, 68, 0.5)' }} />
            <span style={{ color: '#64748b', fontSize: '11px' }}>Severe</span>
          </div>
        </div>

        {/* Today button */}
        <button
          onClick={() => selectDate(new Date())}
          style={{
            width: '100%',
            marginTop: '12px',
            padding: '10px',
            background: 'rgba(139, 92, 246, 0.2)',
            border: '1px solid rgba(139, 92, 246, 0.4)',
            borderRadius: '8px',
            color: '#c4b5fd',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Go to Today
        </button>
      </div>
    </div>
  );
}
