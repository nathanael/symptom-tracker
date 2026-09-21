import { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import './desktopNav.css';
import './rapidEntry.css';
import './talkMode.css';
import { severityColors, NA_SEVERITY } from '../utils/constants';
import { getDateKey, getCurrentTimePeriod, formatDate } from '../utils/helpers';
import { entryKey, initialPeriod, listFor } from '../voice/checkinQueue';
import { createCheckin } from '../voice/scripts/dailyCheckin';
import { createRealtimeEngine } from '../voice/realtimeEngine';
import { createGeminiEngine } from '../voice/geminiEngine';

const ENGINES = { realtime: createRealtimeEngine, gemini: createGeminiEngine };

const STATUS = { connecting: 'Connecting…', listening: 'Listening', thinking: 'Thinking…', speaking: 'Speaking', error: 'Not listening' };
const SHOW_TEXT_INPUT = import.meta.env.DEV || new URLSearchParams(window.location.search).has('talkdebug');

// Full-screen spoken check-in: the app names each symptom, the user answers with a number and
// anything else they want noted. Tapping a rating works too. Progress lives in `entries`, so
// stopping at any point loses nothing and reopening resumes at the next unlogged symptom.
export default function TalkMode({
  symptoms, // active symptoms in list order
  entries, // live entries, not the deferred copy
  selectedDate,
  trackingMode,
  timePeriods,
  quickLog,
  engineKind, // 'gemini' | 'realtime'
  onCost, // called with the conversation's cost stats when it ends (omit to not report)
  setCopyToastMessage,
  onClose,
}) {
  const dateKey = getDateKey(selectedDate);
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [captions, setCaptions] = useState({ app: '', user: '' });
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState({ symptom: null, period: null });
  const [saved, setSaved] = useState(null); // last rating written, shown briefly as confirmation
  const [draft, setDraft] = useState('');

  // The engine outlives renders; give it the latest values through refs
  const live = useRef({});
  live.current = { entries, quickLog, onClose, setCopyToastMessage, onCost };
  const session = useRef(null);

  useEffect(() => {
    let disposed = false;
    const toast = (message) => {
      live.current.setCopyToastMessage(message);
      setTimeout(() => live.current.setCopyToastMessage(''), 3000);
    };
    const checkin = createCheckin({
      symptoms,
      timePeriods,
      selectedDate,
      dateKey,
      period: initialPeriod(symptoms, entries, dateKey, timePeriods, getCurrentTimePeriod(trackingMode)),
      getEntries: () => live.current.entries,
      log: (symptomId, severity, periodId, note) => {
        live.current.quickLog(symptomId, severity, periodId, note);
        setSaved({ name: symptoms.find((s) => s.id === symptomId)?.name, severity, note });
      },
      onCurrent: (symptom, period) => !disposed && setCurrent({ symptom, period }),
    });
    const create = ENGINES[engineKind] || createGeminiEngine;
    const engine = create({
      checkin,
      onState: (next) => !disposed && setStatus(next),
      onCaption: ({ who, text }) => !disposed && setCaptions((prev) => ({ ...prev, [who]: text })),
      onLevel: (value) => !disposed && setLevel(value),
      onError: (message) => !disposed && setError(message),
      onEnd: (reason, stats) => {
        if (disposed) return;
        // A session that never reached the model reports no turns: nothing to price
        if (stats?.turns > 0) live.current.onCost?.(stats);
        if (reason === 'finished') {
          confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
          toast('✓ Check-in complete');
        } else {
          toast('Paused. Your progress is saved');
        }
        live.current.onClose();
      },
    });
    session.current = { checkin, engine };
    engine.start();
    return () => {
      disposed = true;
      engine.stop();
    };
    // One session per open: symptoms/date are fixed while the overlay is up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape') session.current?.engine.stop();
      else if (/^[0-5]$/.test(e.key)) rate(parseInt(e.key, 10));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Tapping a rating answers the current question by hand; the voice carries on from there
  const rate = (severity) => {
    if (!current.symptom || !session.current) return;
    const { checkin, engine } = session.current;
    engine.advance(checkin.handle('record_symptom', { symptom_id: current.symptom.id, severity }));
  };

  const toggleMute = () => {
    session.current?.engine.setMuted(!muted);
    setMuted(!muted);
  };

  // Keydown rather than a form submit: the app's list shortcuts swallow Enter before it submits
  const sendDraft = (e) => {
    if (e.key !== 'Enter' || !draft.trim()) return;
    e.preventDefault();
    session.current?.engine.sendText(draft.trim());
    setDraft('');
  };

  const period = current.period;
  const list = useMemo(() => (period ? listFor(symptoms, period) : []), [symptoms, period]);
  const loggedCount = list.filter((s) => entries[entryKey(dateKey, s.id, period)]).length;
  const periodLabel = timePeriods.length > 1 ? timePeriods.find((p) => p.id === period)?.label : '';
  const savedLabel = saved && (saved.severity === NA_SEVERITY ? 'N/A' : saved.severity);

  return (
    <div className="re tm">
      <div className="re-in">
        <div className="re-bar">
          <button className="re-close" aria-label="Stop talk mode" onClick={() => session.current?.engine.stop()}><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
          <h2>Talk me through it</h2>
          <span className={`tm-status ${status}`}><i style={{ '--level': muted ? 0 : level }} />{muted && status === 'listening' ? 'Muted' : STATUS[status]}</span>
        </div>

        <div className="re-progress">
          <div className="re-count"><span>{formatDate(selectedDate)}{periodLabel && ` · ${periodLabel}`}</span><span><b>{loggedCount}</b> of {list.length} logged</span></div>
          <div className="re-ticks">
            {list.map((s) => {
              const entry = entries[entryKey(dateKey, s.id, period)];
              return <i key={s.id} className={s.id === current.symptom?.id ? 'cur' : entry ? (entry.severity === NA_SEVERITY ? 'na' : 'done') : ''} />;
            })}
          </div>
        </div>

        <div className="re-symptom">
          <h1>{current.symptom ? current.symptom.name : status === 'connecting' ? 'Getting ready…' : 'All caught up'}</h1>
          <p>{current.symptom?.description}</p>
          {saved && (
            <span className="tm-saved" key={`${saved.name}-${saved.severity}-${saved.note}`}>
              ✓ {saved.name} <b style={{ color: severityColors[saved.severity] }}>{savedLabel}</b>{saved.note && <em>{saved.note}</em>}
            </span>
          )}
        </div>

        <div className="tm-captions" aria-live="polite">
          {error && <p className="tm-error">{error}</p>}
          <p className="app">{captions.app}</p>
          <p className="user">{captions.user && `“${captions.user}”`}</p>
        </div>

        <div className="re-pad">
          {SHOW_TEXT_INPUT && (
            <div className="tm-debug">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={sendDraft} placeholder="Type what you would say" aria-label="Type instead of speaking" />
            </div>
          )}
          <div className="tm-keys">
            {[0, 1, 2, 3, 4, 5].map((severity) => (
              <button key={severity} className="re-key" style={{ '--c': severityColors[severity] }} disabled={!current.symptom} onClick={() => rate(severity)}>{severity}</button>
            ))}
          </div>
          <div className="tm-actions">
            <button className={muted ? 'on' : ''} onClick={toggleMute} aria-pressed={muted}>{muted ? 'Unmute' : 'Mute'}</button>
            <button className="stop" onClick={() => session.current?.engine.stop()}>Stop</button>
          </div>
        </div>
      </div>
    </div>
  );
}
