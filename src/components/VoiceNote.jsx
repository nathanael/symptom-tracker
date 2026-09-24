import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './voiceNote.css';
import { createDictation, dictationErrorMessage, transcriptText } from '../voice/dictation';
import { createDemoDictation } from '../voice/demoDictation';
import { noteTime, stripBars } from '../utils/voiceNote';
import VoiceRibbon from './VoiceRibbon';

const LIMIT_MS = 10 * 60 * 1000; // a note stops itself here, bounding its cost
const SAMPLE_MS = 150; // how often the timer ticks and the review strip samples the level
const STRIP_BARS = 70;
// Scripted note for laying the screen out, dev server only
const DEMO = import.meta.env.DEV && new URLSearchParams(window.location.search).has('notedemo');

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const firstWords = (text, n = 4) => {
  const words = text.trim().split(/\s+/);
  return words.length > n ? `${words.slice(0, n).join(' ')}…` : words.join(' ');
};

// Full-screen voice note: listen → (stop) finishing → review → save to today's note.
// phase: connecting | listening | finishing | review | error
export default function VoiceNote({ onSave, onClose, onTypeInstead }) {
  const [phase, setPhase] = useState('connecting');
  const [items, setItems] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [dropped, setDropped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [bars, setBars] = useState([]);
  const levelRef = useRef(0);
  // Read from callbacks that outlive a render
  const live = useRef({ phase: 'connecting', items: [], history: [], startedAt: 0 });
  const dictation = useRef(null);
  const saved = useRef(false);

  const enter = (next) => {
    live.current.phase = next;
    setPhase(next);
    // A "Discard this note?" prompt belongs to the screen it was asked on
    setConfirming(false);
  };

  const toReview = () => {
    if (live.current.phase === 'review') return;
    levelRef.current = 0;
    setText(transcriptText(live.current.items));
    setBars(stripBars(live.current.history, STRIP_BARS));
    enter('review');
  };

  const stop = () => {
    if (live.current.phase !== 'listening') return;
    enter('finishing');
    levelRef.current = 0;
    dictation.current.finish().catch((err) => console.warn('[voice-note] finish', err)).then(toReview);
  };

  const discard = () => {
    dictation.current?.cancel();
    onClose();
  };

  useEffect(() => {
    let disposed = false;
    const create = DEMO ? createDemoDictation : createDictation;
    const d = create({
      onTranscript: (next) => {
        live.current.items = next;
        if (!disposed) setItems(next);
      },
      // Only while listening: once Stop is pressed the ribbon settles even though the mic is open
      onLevel: (value) => { levelRef.current = live.current.phase === 'listening' ? value : 0; },
      // Only a drop while listening means "keep what was heard". A handshake that dies stays on
      // "Getting ready…" until ×, as talk mode does today.
      onDropped: () => {
        if (disposed || live.current.phase !== 'listening') return;
        setDropped(true);
        toReview();
      },
    });
    dictation.current = d;
    d.start()
      .then(() => {
        if (disposed) return;
        live.current.startedAt = Date.now();
        enter('listening');
      })
      .catch((err) => {
        if (disposed) return;
        setError(dictationErrorMessage(err));
        enter('error');
      });
    return () => {
      disposed = true;
      d.cancel();
    };
    // One dictation per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer, review-strip samples and the 10-minute stop
  useEffect(() => {
    if (phase !== 'listening') return undefined;
    const timer = setInterval(() => {
      const ms = Date.now() - live.current.startedAt;
      live.current.history.push(levelRef.current);
      setSeconds(Math.floor(ms / 1000));
      if (ms >= LIMIT_MS) stop();
    }, SAMPLE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // iOS takes the mic from a backgrounded app: keep what was heard rather than lose it
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return;
      if (live.current.phase === 'listening') stop();
      else if (live.current.phase === 'connecting') discard();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  const heard = transcriptText(items) !== '';
  const hasText = phase === 'review' ? text.trim() !== '' : heard;
  const close = () => {
    if (phase === 'finishing') return; // a moment from review; × is ignored rather than half-handled
    if (hasText && (phase === 'listening' || phase === 'review')) setConfirming(true);
    else discard();
  };

  const confirmRow = (keepLabel) => (
    <div className="vn-confirm">
      <p>Discard this note?</p>
      <div className="vn-acts">
        <button type="button" className="vn-btn danger" onClick={discard}>Discard</button>
        <button type="button" className="vn-btn" onClick={() => setConfirming(false)}>{keepLabel}</button>
      </div>
    </div>
  );

  // Older finished sentences grey, the latest finished one white, anything still being heard purple
  const lastDone = items.reduce((at, it, i) => (it.done && it.text.trim() ? i : at), -1);
  const now = new Date();

  return createPortal(
    <div className={`vn ${phase}`} role="dialog" aria-modal="true" aria-label="Voice note">
      <div className="vn-top">
        <button type="button" className="vn-x" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <div className="vn-when">
          <b>{phase === 'review' ? 'Review note' : "Today's note"}</b>
          <small>{now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</small>
        </div>
        <div className={`vn-timer${phase === 'listening' ? ' on' : ''}`}>
          {phase === 'listening' && <i />}
          {phase !== 'connecting' && phase !== 'error' && clock(seconds)}
        </div>
      </div>

      {phase === 'error' && (
        <div className="vn-error">
          <p>{error}</p>
          <button type="button" className="vn-btn primary" onClick={onTypeInstead}>Type instead</button>
          <button type="button" className="vn-btn" onClick={onClose}>Close</button>
        </div>
      )}

      {phase === 'review' && (
        <>
          {dropped && <p className="vn-notice">Connection lost — this is what was heard.</p>}
          <textarea className="vn-edit" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nothing was heard." aria-label="Note text" />
          {bars.length > 0 && (
            <div className="vn-strip" aria-hidden="true">
              {bars.map((v, i) => <span key={i} style={{ height: `${Math.max(3, v * 30)}px` }} />)}
            </div>
          )}
          <p className="vn-dest">Adds to <b>today's note</b>{text.trim() && ` as "${noteTime(now)} — ${firstWords(text)}"`}</p>
          {confirming ? confirmRow('Keep editing') : (
            <div className="vn-acts">
              <button type="button" className="vn-btn" onClick={discard}>Discard</button>
              <button type="button" className="vn-btn primary" disabled={!text.trim()} onClick={() => {
                if (saved.current) return;
                saved.current = true;
                onSave(text.trim());
              }}>Save</button>
            </div>
          )}
        </>
      )}

      {(phase === 'connecting' || phase === 'listening' || phase === 'finishing') && (
        <>
          <div className="vn-words" aria-live="polite">
            <div>
              {phase === 'connecting' && <span className="old">Getting ready…</span>}
              {phase === 'listening' && !heard && <span className="old">Listening…</span>}
              {items.map((it, i) => it.text.trim() && (
                <span key={it.id} className={!it.done ? 'live' : i === lastDone ? 'now' : 'old'}>{it.text.trim()} </span>
              ))}
              {phase === 'listening' && heard && <span className="vn-caret" />}
            </div>
            {phase === 'finishing' && <p className="vn-finishing">Finishing…</p>}
          </div>
          <VoiceRibbon levelRef={levelRef} active={phase === 'listening'} />
          {confirming ? confirmRow('Keep recording') : (
            <div className="vn-controls">
              <button type="button" className="vn-stop" aria-label="Stop" disabled={phase !== 'listening'} onClick={stop}><i /></button>
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
