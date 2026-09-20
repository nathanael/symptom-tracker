import { useState, useMemo } from 'react';
import './desktopNav.css';
import './listUi.css';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CHEV_LEFT = <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg>;
const CHEV_RIGHT = <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>;

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
    <div className="sp-back" onClick={onClose}>
      <div className="sp-cal" onClick={(e) => e.stopPropagation()}>
        <div className="sp-cal-head">
          <button className="dn-icon" aria-label="Previous month" onClick={() => changeMonth(-1)}>{CHEV_LEFT}</button>
          <h3>{viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
          <button className="dn-icon" aria-label="Next month" onClick={() => changeMonth(1)}>{CHEV_RIGHT}</button>
        </div>
        <div className="sp-cal-grid head">
          {DAY_LABELS.map((day, i) => <span key={i}>{day}</span>)}
        </div>
        <div className="sp-cal-grid">
          {calendarDays.map((day, i) => {
            if (!day) return <span key={i} />;
            const dateStr = day.toISOString().split('T')[0];
            const cls = `${dateStr === selectedDate ? 'on' : ''} ${day.getTime() === today.getTime() ? 'today' : ''}`;
            return <button key={i} className={cls} disabled={day < today} onClick={() => handleSelectDate(day)}>{day.getDate()}</button>;
          })}
        </div>
        <button className="dn-btn sp-cal-today" onClick={() => handleSelectDate(today)}>Start today</button>
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

  const interval = currentSchedule.interval || 2;

  return (
    <div className="sp">
      <div className="dn-seg">
        {[
          { type: 'daily', label: 'Daily' },
          { type: 'days', label: 'Days of week' },
          { type: 'interval', label: 'Every X days' },
        ].map(({ type, label }) => (
          <button key={type} type="button" className={currentSchedule.type === type ? 'on' : ''} onClick={() => handleTypeChange(type)}>{label}</button>
        ))}
      </div>

      {currentSchedule.type === 'days' && (
        <div className="sp-line">
          <span>Take on</span>
          <div className="dn-seg sp-days">
            {DAY_LABELS.map((label, index) => (
              <button key={index} type="button" title={DAY_NAMES[index]} className={currentSchedule.days?.includes(index) ? 'on' : ''} onClick={() => toggleDay(index)}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {currentSchedule.type === 'interval' && (
        <>
          <div className="sp-line">
            <span>Take every</span>
            <div className="dn-step">
              <button type="button" aria-label="Fewer days" disabled={interval <= 2} onClick={() => handleIntervalChange(-1)}>−</button>
              <span className="dn-date">{interval}</span>
              <button type="button" aria-label="More days" disabled={interval >= 30} onClick={() => handleIntervalChange(1)}>+</button>
            </div>
            <span>days</span>
          </div>
          <div className="sp-line">
            <span>Starting from</span>
            <button type="button" className="dn-btn" onClick={() => setShowDatePicker(true)}>
              {formatFriendlyDate(currentSchedule.startDate || getTodayString())}
            </button>
          </div>
        </>
      )}

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
