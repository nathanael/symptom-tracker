import { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import './desktopNav.css';
import './rapidEntry.css';
import { severityColors, NA_SEVERITY } from '../utils/constants';
import { getDateKey, getCurrentTimePeriod, formatDate } from '../utils/helpers';
import { getLastSeverity } from '../utils/listHelpers';
import * as queue from '../voice/checkinQueue';

// Full-screen, one-symptom-at-a-time logging. Rating jumps to the next unlogged symptom;
// finishing a period offers the other one, then closes with confetti.
export default function RapidEntry({
  symptoms, // active symptoms in list order
  entries,
  setEntries,
  selectedDate,
  trackingMode,
  timePeriods,
  quickLog,
  setCopyToastMessage,
  onClose,
}) {
  const dateKey = getDateKey(selectedDate);
  const entryKey = (symptom, periodId) => queue.entryKey(dateKey, symptom.id, periodId);
  const listFor = (periodId) => queue.listFor(symptoms, periodId);

  // Start in the current period, or the other one if this one is already complete
  const [period, setPeriod] = useState(() => queue.initialPeriod(symptoms, entries, dateKey, timePeriods, getCurrentTimePeriod(trackingMode)));
  const list = useMemo(() => listFor(period), [symptoms, period]);
  const isLogged = (symptom) => !!entries[entryKey(symptom, period)];

  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((s) => !isLogged(s))));
  const [done, setDone] = useState(() => list.every(isLogged));
  const current = list[Math.min(index, list.length - 1)];
  const periodLabel = timePeriods.length > 1 ? timePeriods.find((p) => p.id === period)?.label : '';
  const otherIncomplete = queue.otherIncomplete(symptoms, entries, dateKey, timePeriods, period);

  useEffect(() => {
    if (done) confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  }, [done]);

  const switchPeriod = (periodId) => {
    const next = listFor(periodId);
    setPeriod(periodId);
    setIndex(Math.max(0, next.findIndex((s) => !entries[entryKey(s, periodId)])));
    setDone(false);
  };

  // Next unlogged symptom after `from`, wrapping; -1 when everything else is logged
  const nextUnlogged = (from, skipId) => queue.nextUnlogged(list, isLogged, from, skipId);

  const finish = () => {
    if (otherIncomplete) {
      setDone(true);
      return;
    }
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    setCopyToastMessage('✓ All symptoms logged!');
    setTimeout(() => setCopyToastMessage(''), 3000);
    onClose();
  };

  const rate = (severity) => {
    if (!current) return;
    const key = entryKey(current, period);
    // Tapping the selected value again clears it
    if (entries[key]?.severity === severity) {
      setEntries((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    const wasLogged = isLogged(current);
    quickLog(current.id, severity, period);
    if (wasLogged) return; // editing an earlier answer: stay put
    const next = nextUnlogged(index, current.id);
    if (next === -1) finish();
    else setIndex(next);
  };

  const step = (dir) => setIndex((i) => (i + dir + list.length) % list.length);
  const skipToUnlogged = () => {
    const next = nextUnlogged(index);
    if (next === -1) finish();
    else setIndex(next);
  };

  const startOver = () => {
    setEntries((prev) => {
      const next = { ...prev };
      list.forEach((s) => delete next[entryKey(s, period)]);
      return next;
    });
    setIndex(0);
    setDone(false);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (done) return;
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (/^[0-5]$/.test(e.key)) rate(parseInt(e.key, 10));
      else if (e.key === 'n' || e.key === 'N') rate(NA_SEVERITY);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Most recent earlier rating for this symptom + period, to hint the likely answer
  const lastSeverity = useMemo(
    () => (current ? getLastSeverity(entries, current.id, period, selectedDate) : null),
    [current?.id, period, dateKey, entries]
  );

  const header = (
    <div className="re-bar">
      <button className="re-close" aria-label="Close rapid entry" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
      <h2>Rapid entry</h2>
      {timePeriods.length > 1 && (
        <div className="dn-seg sm">
          {timePeriods.map((p) => (
            <button key={p.id} className={p.id === period ? 'on' : ''} onClick={() => switchPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
      )}
    </div>
  );

  if (done || !current) {
    return (
      <div className="re">
        <div className="re-in">
          {header}
          <div className="re-done">
            <span className="re-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg></span>
            <h1>All {periodLabel} symptoms logged</h1>
            <p>{formatDate(selectedDate)} · {list.length} of {list.length}</p>
            <div className="re-done-actions">
              {otherIncomplete && <button className="dn-btn primary" onClick={() => switchPeriod(otherIncomplete.id)}>Continue to {otherIncomplete.label} · {otherIncomplete.left} left</button>}
              <button className={`dn-btn ${otherIncomplete ? '' : 'primary'}`} onClick={onClose}>Done</button>
              <button className="dn-btn ghost" onClick={startOver}>Start {periodLabel} over</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentSeverity = entries[entryKey(current, period)]?.severity;
  const loggedCount = list.filter(isLogged).length;

  return (
    <div className="re">
      <div className="re-in">
        {header}

        <div className="re-progress">
          <div className="re-count"><span>{formatDate(selectedDate)}{periodLabel && ` · ${periodLabel}`}</span><span><b>{loggedCount}</b> of {list.length} logged</span></div>
          <div className="re-ticks">
            {list.map((s) => {
              const entry = entries[entryKey(s, period)];
              return <i key={s.id} className={s.id === current.id ? 'cur' : entry ? (entry.severity === NA_SEVERITY ? 'na' : 'done') : ''} />;
            })}
          </div>
        </div>

        <div className="re-symptom">
          <h1>{current.name}</h1>
          <p>{current.description}</p>
          {lastSeverity !== null && currentSeverity === undefined && (
            <span className="re-last">Last time <b style={{ color: severityColors[lastSeverity] }}>{lastSeverity}</b></span>
          )}
        </div>

        <div className="re-pad">
          <div className="re-keys">
            {[0, 1, 2, 3, 4, 5].map((severity) => (
              <button
                key={severity}
                className={`re-key ${currentSeverity === severity ? 'on' : lastSeverity === severity && currentSeverity === undefined ? 'last' : ''}`}
                style={{ '--c': severityColors[severity] }}
                onClick={() => rate(severity)}
              >
                {severity}
              </button>
            ))}
          </div>
          <button className={`re-key na ${currentSeverity === NA_SEVERITY ? 'on' : ''}`} onClick={() => rate(NA_SEVERITY)}>N/A</button>
          <div className="re-nav">
            <button aria-label="Previous symptom" onClick={() => step(-1)}><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6" /></svg></button>
            <button aria-label="Next symptom" onClick={() => step(1)}><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg></button>
            <button aria-label="Next unlogged symptom" onClick={skipToUnlogged}>Next unlogged<svg viewBox="0 0 24 24"><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg></button>
          </div>
        </div>
      </div>
    </div>
  );
}
