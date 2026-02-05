import { useState, useMemo } from 'react';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const getTodayString = () => new Date().toISOString().split('T')[0];

const formatFriendlyDate = (dateString) => {
  const date = new Date(dateString + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${DAY_NAMES[date.getDay()]}, ${monthNames[date.getMonth()]} ${date.getDate()}`;
};

function DatePickerModal({ selectedDate, onSelect, onClose }) {
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(selectedDate + 'T00:00:00');
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const calendarDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days = [];
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push(null);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    return days;
  }, [viewMonth]);

  const changeMonth = (delta) => {
    setViewMonth(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + delta);
      return newDate;
    });
  };

  const handleSelectDate = (day) => {
    if (day < today) return;
    const dateStr = day.toISOString().split('T')[0];
    onSelect(dateStr);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 2000,
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
            {viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
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
          {DAY_LABELS.map((day, i) => (
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

            const dateStr = day.toISOString().split('T')[0];
            const isSelected = dateStr === selectedDate;
            const isToday = day.getTime() === today.getTime();
            const isPast = day < today;

            return (
              <button
                key={i}
                onClick={() => handleSelectDate(day)}
                disabled={isPast}
                style={{
                  aspectRatio: '1',
                  background: isSelected
                    ? 'rgba(139, 92, 246, 0.4)'
                    : 'transparent',
                  border: isToday
                    ? '2px solid #8b5cf6'
                    : isSelected
                    ? '2px solid rgba(139, 92, 246, 0.6)'
                    : '1px solid transparent',
                  borderRadius: '8px',
                  color: isPast ? '#475569' : isSelected ? '#fff' : '#e2e8f0',
                  fontSize: '14px',
                  fontWeight: isToday || isSelected ? '700' : '400',
                  cursor: isPast ? 'default' : 'pointer',
                  opacity: isPast ? 0.4 : 1,
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

        {/* Today button */}
        <button
          onClick={() => handleSelectDate(today)}
          style={{
            width: '100%',
            marginTop: '16px',
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
          Start Today
        </button>
      </div>
    </div>
  );
}

export default function SchedulePicker({ schedule, onChange }) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const currentSchedule = schedule || { type: 'daily', startDate: getTodayString() };

  const handleTypeChange = (type) => {
    // Preserve all existing schedule values when switching types
    // This prevents losing interval/days values when just peeking at other options
    const startDate = currentSchedule.startDate || getTodayString();
    onChange({
      ...currentSchedule,
      type,
      startDate,
      // Set defaults only if they don't already exist
      days: currentSchedule.days || [1, 3, 5],
      interval: currentSchedule.interval || 2,
    });
  };

  const handleStartDateChange = (value) => {
    onChange({ ...currentSchedule, startDate: value });
  };

  const toggleDay = (dayIndex) => {
    const currentDays = currentSchedule.days || [];
    const newDays = currentDays.includes(dayIndex)
      ? currentDays.filter(d => d !== dayIndex)
      : [...currentDays, dayIndex].sort((a, b) => a - b);

    // Don't allow empty days
    if (newDays.length === 0) return;

    onChange({ ...currentSchedule, days: newDays });
  };

  const handleIntervalChange = (delta) => {
    const current = currentSchedule.interval || 2;
    const interval = Math.max(2, Math.min(30, current + delta));
    onChange({ ...currentSchedule, interval });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Type selector */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {[
          { type: 'daily', label: 'Daily' },
          { type: 'days', label: 'Days of Week' },
          { type: 'interval', label: 'Every X Days' },
        ].map(({ type, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => handleTypeChange(type)}
            style={{
              flex: 1,
              padding: '8px 10px',
              background: currentSchedule.type === type
                ? 'rgba(99, 102, 241, 0.3)'
                : 'rgba(15, 23, 42, 0.5)',
              border: currentSchedule.type === type
                ? '1px solid rgba(99, 102, 241, 0.5)'
                : '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              color: currentSchedule.type === type ? '#a5b4fc' : '#9ca3af',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Days of week selector */}
      {currentSchedule.type === 'days' && (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'space-between' }}>
          {DAY_LABELS.map((label, index) => {
            const isSelected = currentSchedule.days?.includes(index);
            return (
              <button
                key={index}
                type="button"
                onClick={() => toggleDay(index)}
                title={DAY_NAMES[index]}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: isSelected
                    ? 'rgba(99, 102, 241, 0.4)'
                    : 'rgba(15, 23, 42, 0.5)',
                  border: isSelected
                    ? '1px solid rgba(99, 102, 241, 0.6)'
                    : '1px solid rgba(255, 255, 255, 0.1)',
                  color: isSelected ? '#c7d2fe' : '#6b7280',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Interval selector with date picker - compact single row */}
      {currentSchedule.type === 'interval' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => handleIntervalChange(-1)}
              disabled={(currentSchedule.interval || 2) <= 2}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: (currentSchedule.interval || 2) <= 2 ? '#4b5563' : '#a5b4fc',
                fontSize: '16px',
                fontWeight: '500',
                cursor: (currentSchedule.interval || 2) <= 2 ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              −
            </button>
            <span style={{
              color: '#f8fafc',
              fontSize: '14px',
              fontWeight: '600',
              minWidth: '18px',
              textAlign: 'center',
            }}>
              {currentSchedule.interval || 2}
            </span>
            <button
              type="button"
              onClick={() => handleIntervalChange(1)}
              disabled={(currentSchedule.interval || 2) >= 30}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: (currentSchedule.interval || 2) >= 30 ? '#4b5563' : '#a5b4fc',
                fontSize: '16px',
                fontWeight: '500',
                cursor: (currentSchedule.interval || 2) >= 30 ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              +
            </button>
            <span style={{ color: '#9ca3af', fontSize: '13px' }}>days</span>
          </div>
          <button
            type="button"
            onClick={() => setShowDatePicker(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '5px 8px',
              background: 'rgba(15, 23, 42, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            <span style={{ color: '#9ca3af' }}>from</span>
            <span style={{ color: '#f8fafc' }}>{formatFriendlyDate(currentSchedule.startDate || getTodayString())}</span>
          </button>
        </div>
      )}

      {/* Full-screen date picker modal */}
      {showDatePicker && (
        <DatePickerModal
          selectedDate={currentSchedule.startDate || getTodayString()}
          onSelect={handleStartDateChange}
          onClose={() => setShowDatePicker(false)}
        />
      )}
    </div>
  );
}

// Helper to format schedule for display
export const formatSchedule = (schedule) => {
  if (!schedule || schedule.type === 'daily') return null;

  if (schedule.type === 'days') {
    const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    return schedule.days?.map(d => dayLetters[d]).join('') || null;
  }

  if (schedule.type === 'interval') {
    return `Every ${schedule.interval}d`;
  }

  return null;
};
