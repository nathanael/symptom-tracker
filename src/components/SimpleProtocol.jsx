// The simplified supplement view: what's due today, a name and a big check, nothing else.
// No doses, no time-of-day columns, no inputs section.
//
// It writes exactly the record protocolCheckAll writes, so sync, backup, tombstones and the
// supplement graphs are unaffected. No undo toast either — a mistap is undone by tapping the
// row again, which is faster than reaching for a toast.

import { useEffect } from 'react';
import { getDateKey, isScheduledForDate, haptic } from '../utils/helpers';
import './simpleProtocol.css';

export default function SimpleProtocol({
  stackItems,
  stackEntries,
  setStackEntries,
  selectedDate,
  onFullDetail,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dateKey = getDateKey(selectedDate);
  const due = (stackItems || []).filter((i) => i.active && isScheduledForDate(i.schedule, selectedDate));
  const keyFor = (item) => `${dateKey}-${item.id}`;
  const isTaken = (item) => !!stackEntries[keyFor(item)]?.taken;
  const taken = due.filter(isTaken).length;

  const toggle = (item) => {
    const key = keyFor(item);
    setStackEntries((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { date: dateKey, itemId: item.id, dose: item.defaultDose, taken: true } };
    });
    haptic('light');
  };

  return (
    <div className="sp">
      <div className="sp-in">
        <div className="sp-bar">
          <button className="sp-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <h2>Today</h2>
          {due.length > 0 && <span>{taken} of {due.length}</span>}
        </div>

        <div className="sp-list">
          {due.length === 0 ? (
            <p className="sp-empty">Nothing scheduled today.</p>
          ) : due.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sp-row${isTaken(item) ? ' on' : ''}`}
              aria-pressed={isTaken(item)}
              onClick={() => toggle(item)}
            >
              <span>{item.name}</span>
              <i />
            </button>
          ))}
        </div>

        <div className="sp-foot">
          <button onClick={onFullDetail}>Full detail →</button>
        </div>
      </div>
    </div>
  );
}
