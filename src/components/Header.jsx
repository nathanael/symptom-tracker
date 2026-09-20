import './desktopNav.css';
import './mobileNav.css';
import { formatDate } from '../utils/helpers';
import { getScoreColor } from '../utils/healthScore';
import { useHealthScore } from '../hooks/useHealthScore';

const Chevron = ({ points }) => <svg viewBox="0 0 24 24"><polyline points={points} /></svg>;

// Mobile top bar: scope on the left (date, or the Insights view switch), score on the right.
// Row two is filled by the active list: progress left, its one primary action right.
export default function Header({
  selectedDate,
  changeDate,
  canGoForward,
  setShowCalendar,
  setCalendarMonth,
  symptoms,
  entries,
  trackingMode,
  showInsights,
  slotRef,
}) {
  const { score, delta, rollingAvg } = useHealthScore(selectedDate, { symptoms, entries, trackingMode });
  const scoreValue = score !== null ? score : rollingAvg;
  const isToday = selectedDate.toDateString() === new Date().toDateString();

  return (
    <div className="mn-top">
      <div className="mn-r1">
        {showInsights ? (
          <div className="dn-slot" ref={slotRef} />
        ) : (
          <>
            <div className="dn-step">
              <button aria-label="Previous day" onClick={() => changeDate(-1)}><Chevron points="15 18 9 12 15 6" /></button>
              <button
                className="dn-date"
                onClick={() => {
                  setCalendarMonth(new Date(selectedDate));
                  setShowCalendar(true);
                }}
              >
                {formatDate(selectedDate)}
                {isToday && <small>{selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</small>}
              </button>
              <button aria-label="Next day" disabled={!canGoForward} onClick={() => changeDate(1)}><Chevron points="9 18 15 12 9 6" /></button>
            </div>
            {!isToday && (
              <button
                className="dn-btn ghost"
                onClick={() => {
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  changeDate(Math.round((today - new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate())) / (1000 * 60 * 60 * 24)));
                }}
              >
                Today
              </button>
            )}
            <span style={{ marginLeft: 'auto' }} />
          </>
        )}
        {scoreValue !== null && (
          <div className="dn-score">
            <span className="dn-ring" style={{ background: `conic-gradient(${getScoreColor(scoreValue)} ${scoreValue}%, rgba(255,255,255,.08) 0)` }} />
            {scoreValue}%
            {delta !== null && delta !== 0 && (
              <small style={{ color: delta > 0 ? '#22c55e' : '#ef4444' }}>{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}</small>
            )}
          </div>
        )}
      </div>
      {!showInsights && <div className="mn-r2 dn-slot" ref={slotRef} />}
    </div>
  );
}
