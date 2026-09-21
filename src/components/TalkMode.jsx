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
import { createDemoEngine } from '../voice/demoEngine';
import VoiceOrb from './VoiceOrb';

const ENGINES = { realtime: createRealtimeEngine, gemini: createGeminiEngine };

const STATUS = { connecting: 'Connecting', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', error: 'Not listening' };
const ROW = 40; // px, a reel row; the current one is CUR tall
const CUR = 92;
// Silent walk-through of the screen for checking layout, dev server only
const DEMO = import.meta.env.DEV && new URLSearchParams(window.location.search).has('talkdemo');
const SHOW_TEXT_INPUT = import.meta.env.DEV || new URLSearchParams(window.location.search).has('talkdebug');

// Full-screen spoken check-in: the app names each symptom, the user answers with a number and
// anything else they want noted. Tapping a rating works too. The voice fills the lower half of the
// screen (all of it while connecting); above it the symptom list scrolls by as she works through it. Progress lives in `entries`, so
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
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState({ symptom: null, period: null });
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
  const index = list.findIndex((s) => s.id === current.symptom?.id);
  const loading = status === 'connecting' && !error;
  const stop = () => session.current?.engine.stop();

  return (
    <div className={`re tm${loading ? ' loading' : ''}`}>
      <div className="re-in">
        <div className="re-bar">
          <button className="re-close" aria-label="Stop talk mode" onClick={stop}><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
          <h2>Talk me through it</h2>
          {!loading && <span className="tm-count">{formatDate(selectedDate)}{periodLabel && ` · ${periodLabel}`} · <b>{loggedCount}</b> of {list.length}</span>}
        </div>

        <div className="tm-top">
          <div className="re-ticks">
            {list.map((s) => {
              const entry = entries[entryKey(dateKey, s.id, period)];
              return <i key={s.id} className={s.id === current.symptom?.id ? 'cur' : entry ? (entry.severity === NA_SEVERITY ? 'na' : 'done') : ''} />;
            })}
          </div>

          {/* The list she is working through: answered rows roll up with their rating, the one being asked sits large in the middle */}
          <div className="tm-reel">
            {index < 0 ? (
              <div className="tm-reel-in" style={{ transform: `translateY(${-CUR / 2}px)` }}>
                <div className="tm-row cur"><span className="n">{loading ? '' : 'All caught up'}</span></div>
              </div>
            ) : (
              <div className="tm-reel-in" style={{ transform: `translateY(${-(index * ROW + CUR / 2)}px)` }}>
                {list.map((s, i) => {
                  const entry = entries[entryKey(dateKey, s.id, period)];
                  return (
                    <div key={s.id} className={`tm-row${i === index ? ' cur' : ''}${entry ? ' done' : ''}`}>
                      <span className="n">{s.name}</span>
                      {(i === index || s.description) && <span className="d">{s.description}</span>}
                      {entry && <b className="v" style={{ color: severityColors[entry.severity] }}>{entry.severity === NA_SEVERITY ? 'N/A' : entry.severity}</b>}
                      {entry?.note && i !== index && <em className="t">{entry.note}</em>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="tm-keys">
            {[0, 1, 2, 3, 4, 5].map((severity) => (
              <button key={severity} className="re-key" style={{ '--c': severityColors[severity] }} disabled={!current.symptom} onClick={() => rate(severity)}>{severity}</button>
            ))}
          </div>
        </div>

        <div className="tm-stage">
          <VoiceOrb status={status} muted={muted} levelRef={levelRef} />
          <div className="tm-captions" aria-live="polite">
            {error && <p className="tm-error">{error}</p>}
            <p className="app">{captions.app}</p>
            <p className="user">{captions.user && `“${captions.user}”`}</p>
          </div>
          <div className="tm-foot">
            <p className={`tm-state ${status}`}>{muted && status === 'listening' ? 'Muted' : STATUS[status]}</p>
            {loading && <p className="tm-hint">Waking her up. This takes a few seconds.</p>}
            {SHOW_TEXT_INPUT && !loading && (
              <div className="tm-debug">
                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={sendDraft} placeholder="Type what you would say" aria-label="Type instead of speaking" />
              </div>
            )}
            <div className="tm-actions">
              {!loading && <button className={muted ? 'on' : ''} onClick={toggleMute} aria-pressed={muted}>{muted ? 'Unmute' : 'Mute'}</button>}
              <button className="stop" onClick={stop}><i />{loading ? 'Cancel' : 'Stop'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
