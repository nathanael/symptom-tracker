import { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import './desktopNav.css';
import './rapidEntry.css';
import './listUi.css';
import './talkMode.css';
import { NA_SEVERITY } from '../utils/constants';
import { isApplicable, getLastSeverity } from '../utils/listHelpers';
import { SEVERITIES, SEV_BG, SEV_FG, STRIP_COLOR } from './severityStyle';
import { getDateKey, getCurrentTimePeriod, formatDate } from '../utils/helpers';
import { entryKey, initialPeriod, listFor } from '../voice/checkinQueue';
import { createCheckin } from '../voice/scripts/dailyCheckin';
import { createRealtimeEngine } from '../voice/realtimeEngine';
import { createGeminiEngine } from '../voice/geminiEngine';
import { createDemoEngine } from '../voice/demoEngine';
import VoiceOrb from './VoiceOrb';
import SpokenWords from './SpokenWords';

const ENGINES = { realtime: createRealtimeEngine, gemini: createGeminiEngine };

// After this many conversations on this device the long introduction stops
const INTRO_SESSIONS = 2;
const SESSIONS_KEY = 'talkModeSessions';
const sessionsSoFar = () => { try { return Number(localStorage.getItem(SESSIONS_KEY)) || 0; } catch { return 0; } };

const STATUS = { connecting: 'Connecting', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', error: 'Not listening' };
// Silent walk-through of the screen for checking layout, dev server only
const DEMO = import.meta.env.DEV && new URLSearchParams(window.location.search).has('talkdemo');

// Full-screen spoken check-in: the app names each symptom, the user answers with a number and
// anything else they want noted. Tapping a rating works too. The voice fills the lower part of the
// screen (all of it while connecting); above it is the ordinary symptom list, filling itself in. Progress lives in `entries`, so
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
  const levelRef = useRef(0); // mic level, read by the orb each frame
  const [current, setCurrent] = useState({ symptom: null, period: null });
  // The demo never writes real ratings: its answers live here, for this screen only
  const [demoEntries, setDemoEntries] = useState({});

  // The engine outlives renders; give it the latest values through refs
  const live = useRef({});
  live.current = { ...live.current, entries, quickLog, onClose, setCopyToastMessage, onCost };
  // Ratings that were already there when talk mode opened: only new ones pulse
  const before = useRef(entries);
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
      seasoned: sessionsSoFar() >= INTRO_SESSIONS,
      log: (symptomId, severity, periodId, note) => {
        if (DEMO) setDemoEntries((prev) => ({ ...prev, [entryKey(dateKey, symptomId, periodId)]: { severity, note } }));
        else live.current.quickLog(symptomId, severity, periodId, note);
      },
      onCurrent: (symptom, period) => !disposed && setCurrent({ symptom, period }),
    });
    const create = DEMO ? createDemoEngine : ENGINES[engineKind] || createGeminiEngine;
    const engine = create({
      checkin,
      onState: (next) => !disposed && setStatus(next),
      onCaption: ({ who, text }) => !disposed && setCaptions((prev) => ({ ...prev, [who]: text })),
      onLevel: (value) => { levelRef.current = value; },
      onError: (message) => !disposed && setError(message),
      onEnd: (reason, stats) => {
        if (disposed) return;
        // A session that never reached the model reports no turns: nothing to price
        if (stats?.turns > 0) {
          live.current.onCost?.(stats);
          try { localStorage.setItem(SESSIONS_KEY, String(sessionsSoFar() + 1)); } catch { /* private mode */ }
        }
        if (reason === 'finished' || live.current.complete) {
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

  const period = current.period;
  if (DEMO) entries = { ...entries, ...demoEntries };
  const list = useMemo(() => (period ? listFor(symptoms, period) : []), [symptoms, period]);
  const loggedCount = list.filter((s) => entries[entryKey(dateKey, s.id, period)]).length;
  const loading = status === 'connecting' && !error;
  const complete = !loading && list.length > 0 && loggedCount === list.length;
  live.current.complete = complete;
  const stop = () => session.current?.engine.stop();
  const speechProgress = () => session.current?.engine.speechProgress?.() ?? null;

  // The open row trails the conversation by a moment, so a rating is seen landing in its slot
  // before the list moves on, the way it does when you fill the list in by hand
  const [shown, setShown] = useState(null);
  const currentId = current.symptom?.id ?? null;
  useEffect(() => {
    const timer = setTimeout(() => setShown(currentId), shown ? 750 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);
  const settled = shown === currentId;

  // Keep the open row centred: when it changes, and while the window itself changes size (the
  // voice shrinking from full screen once connected)
  const listRef = useRef(null);
  const centre = (behavior) => {
    const box = listRef.current;
    const row = box?.querySelector('.lr-row.open');
    if (row) box.scrollTo({ top: row.offsetTop - box.offsetTop - (box.clientHeight - row.offsetHeight) / 2, behavior });
  };
  useEffect(() => centre('smooth'), [shown, period]);
  useEffect(() => {
    const observer = new ResizeObserver(() => centre('auto'));
    observer.observe(listRef.current);
    return () => observer.disconnect();
  }, []);

  const lastSeverity = shown && settled ? getLastSeverity(entries, shown, period, selectedDate) : null;

  return (
    <div className={`re tm${loading ? ' loading' : ''}`}>
      <div className="re-in">
        <div className="re-bar">
          <button className="re-close" aria-label="Stop talk mode" onClick={stop}><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
          <h2>Talk me through it</h2>
          {!loading && <span className="tm-count">{formatDate(selectedDate)} · <b>{loggedCount}</b> of {list.length}</span>}
        </div>

        {/* The same list as the Symptoms tab, filled in as she goes: the row being asked is open with its keys, the answer lands in its slot, the list moves on */}
        <div className="tm-top lr sym mobile" style={{ '--lr-periods': timePeriods.length }}>
          <div className="lr-head lr-cols">
            <div />
            {timePeriods.map((p) => <div className="c" key={p.id}>{timePeriods.length > 1 ? p.label : 'TODAY'}</div>)}
          </div>
          <div className="tm-list" ref={listRef}>
            {list.map((symptom) => {
              const open = symptom.id === shown;
              const entry = entries[entryKey(dateKey, symptom.id, period)];
              const done = timePeriods.every((p) => !isApplicable(symptom, p.id) || entries[entryKey(dateKey, symptom.id, p.id)]);
              return (
                <div key={symptom.id} className={`lr-row lr-cols ${open ? 'open' : ''} ${done ? 'done' : ''}`}>
                  <div className="lr-name">
                    {symptom.name}{symptom.description && <small>{symptom.description}</small>}
                    {entry?.note && <span className="lr-noted">{entry.note}</span>}
                  </div>
                  {timePeriods.map((p) => {
                    if (!isApplicable(symptom, p.id)) return <span key={p.id} className="lr-pill none">–</span>;
                    const slot = entries[entryKey(dateKey, symptom.id, p.id)];
                    const cur = open && p.id === period ? ' cur' : '';
                    if (!slot) return <span key={p.id} className={`lr-pill empty${cur}`}>·</span>;
                    if (slot.severity === NA_SEVERITY) return <span key={p.id} className={`lr-pill na${cur}`}>N/A</span>;
                    const landed = before.current[entryKey(dateKey, symptom.id, p.id)]?.severity !== slot.severity;
                    return <span key={`${p.id}-${slot.severity}`} className={`lr-pill${landed ? ' tm-land' : ''}${cur}`} style={{ background: SEV_BG[slot.severity], color: SEV_FG[slot.severity] }}>{slot.severity}</span>;
                  })}
                  {open && (
                    <div className="lr-keys">
                      {SEVERITIES.map((n) => (
                        <button
                          key={n}
                          className={`lr-key ${entry?.severity === n ? 'tm-land' : lastSeverity === n && !entry ? 'last' : ''}`}
                          style={entry?.severity === n ? { background: SEV_BG[n], color: SEV_FG[n], borderColor: 'transparent' } : lastSeverity === n ? { '--c': STRIP_COLOR[n] } : undefined}
                          disabled={!settled}
                          onClick={() => rate(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!loading && !currentId && shown === null && <div className="tm-alldone">All caught up</div>}
          </div>
        </div>

        <div className="tm-stage">
          {/* A fixed band: what she says never pushes the voice around */}
          <div className="tm-captions" aria-live="polite">
            {error ? <p className="tm-error">{error}</p> : <SpokenWords text={captions.app} progress={speechProgress} />}
            <p className="user">{captions.user && `“${captions.user}”`}</p>
          </div>
          <VoiceOrb status={status} levelRef={levelRef} />
          <div className="tm-foot">
            <p className={`tm-state ${status}`}>{STATUS[status]}</p>
            {loading && <p className="tm-hint">Waking her up. This takes a few seconds.</p>}
            <div className="tm-actions">
              {loading ? <button onClick={stop}>Cancel</button>
                : complete ? <button className="done" onClick={stop}>Done</button>
                  : <button onClick={stop}><i />Continue later</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
