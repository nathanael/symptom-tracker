import { useMemo } from 'react';
import './desktopNav.css';
import './calendar.css';
import { NA_SEVERITY } from '../utils/constants';
import { getDateKey } from '../utils/helpers';

// Average-severity scale, best to worst
const HEAT = ['#4ade80', '#a3e635', '#facc15', '#fb923c', '#ef4444'];

export default function Calendar({
  selectedDate,
  selectDate,
  calendarMonth,
  setCalendarMonth,
  entries,
  onClose,
  isDesktop,
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
  const selectedKey = getDateKey(selectedDate);
  const todayKey = getDateKey(today);
  const isCurrentMonth = calendarMonth.getFullYear() === today.getFullYear() && calendarMonth.getMonth() === today.getMonth();
  const loggedDays = calendarDays.filter((day) => day && daySeverityMap[getDateKey(day)]).length;

  return (
    <>
      <div className="cal-dim" onClick={onClose} />
      <div className={`cal ${isDesktop ? 'desktop' : 'mobile'}`} role="dialog" aria-label="Choose a date">
        <div className="cal-head">
          <h3>{calendarMonth.toLocaleDateString('en-US', { month: 'long' })} <span>{calendarMonth.getFullYear()}</span></h3>
          {(selectedKey !== todayKey || !isCurrentMonth) && <button className="dn-btn ghost" onClick={() => selectDate(new Date())}>Today</button>}
          <div className="dn-step">
            <button aria-label="Previous month" onClick={() => changeMonth(-1)}><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg></button>
            <button aria-label="Next month" disabled={isCurrentMonth} onClick={() => changeMonth(1)}><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg></button>
          </div>
        </div>

        <div className="cal-grid">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => <div className="cal-dow" key={i}>{day}</div>)}
          {calendarDays.map((day, i) => {
            if (!day) return <div key={i} />;
            const dateKey = getDateKey(day);
            const dayData = daySeverityMap[dateKey];
            // Heat bar under the number: average severity for the day
            const heat = dayData ? HEAT[Math.min(4, Math.max(0, Math.ceil(dayData.avg) - 1))] : undefined;
            return (
              <button
                key={i}
                className={`cal-day ${dateKey === selectedKey ? 'sel' : ''} ${dateKey === todayKey ? 'today' : ''}`}
                disabled={day > today}
                onClick={() => selectDate(day)}
              >
                {day.getDate()}
                <i style={heat && { '--c': heat }} />
              </button>
            );
          })}
        </div>

        <div className="cal-foot">
          <span><b>{loggedDays}</b> {loggedDays === 1 ? 'day' : 'days'} logged</span>
          <span className="cal-scale">Good<span>{HEAT.map((c) => <i key={c} style={{ background: c }} />)}</span>Severe</span>
        </div>
      </div>
    </>
  );
}
