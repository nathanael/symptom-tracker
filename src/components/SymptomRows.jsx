import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './listUi.css';
import { NA_SEVERITY } from '../utils/constants';
import { getDateKey, haptic } from '../utils/helpers';
import { isTyping, DraftInput, useReorderDrag, ChangeLog } from './listParts';
import { isApplicable, getStripDateKeys, getSeverityStrip, getLastSeverity, stepIndex, reorder, makeId } from '../utils/listHelpers';
import {
  createSymptomHistoryEntry,
  applySymptomPatch,
  reconstructSymptomStateAtEntry,
  formatSymptomChange,
} from '../utils/symptomHistory';

const SEVERITIES = [0, 1, 2, 3, 4, 5];
const SEV_BG = ['rgba(255,255,255,.05)', 'rgba(132,204,22,.22)', 'rgba(202,210,40,.30)', 'rgba(234,179,8,.38)', 'rgba(249,115,22,.45)', 'rgba(239,68,68,.55)'];
const SEV_FG = ['#6b7280', '#d9f99d', '#fef08a', '#fef9c3', '#ffedd5', '#fee2e2'];
const STRIP_COLOR = ['rgba(255,255,255,.14)', '#3f6212', '#a3a635', '#eab308', '#f97316', '#ef4444'];

export default function SymptomRows({
  symptoms,
  setSymptoms,
  activeSymptoms,
  entries,
  setEntries,
  selectedDate,
  timePeriods,
  pinnedSymptoms,
  quickLog,
  setLastAction,
  symptomSearch,
  setSymptomSearch,
  onOpenGraph,
  onEditNote,
  onClearDay,
  onDeleteSymptom,
  editing,
  setEditing,
  keyboardEnabled,
  isDesktop,
  barSlot,
}) {
  const dateKey = getDateKey(selectedDate);
  const defaultPeriod = () =>
    timePeriods.length === 1 ? timePeriods[0].id : (new Date().getHours() < 12 ? 'morning' : 'evening');

  const [focus, setFocus] = useState(() => ({ id: null, period: defaultPeriod() }));
  const [expandedId, setExpandedId] = useState(null);
  const [showHidden, setShowHidden] = useState(true);
  const [adding, setAdding] = useState(false);

  // Keep the focused period valid when tracking mode changes
  useEffect(() => {
    if (!timePeriods.some((p) => p.id === focus.period)) setFocus((f) => ({ ...f, period: defaultPeriod() }));
  }, [timePeriods]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop starts with the first row focused so the keyboard works immediately
  useEffect(() => {
    if (isDesktop && focus.id === null && activeSymptoms.length > 0) {
      setFocus((f) => ({ ...f, id: activeSymptoms[0].id }));
    }
  }, [isDesktop, activeSymptoms, focus.id]);


  const stripKeys = useMemo(() => getStripDateKeys(selectedDate, 14), [dateKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const strips = useMemo(() => {
    if (!isDesktop) return {};
    const out = {};
    activeSymptoms.forEach((s) => { out[s.id] = getSeverityStrip(entries, s.id, stripKeys, timePeriods); });
    return out;
  }, [isDesktop, activeSymptoms, entries, stripKeys, timePeriods]);

  const entryFor = (symptom, periodId) => entries[`${dateKey}-${symptom.id}-${periodId}`];

  const counts = timePeriods.map((p) => {
    const applicable = activeSymptoms.filter((s) => isApplicable(s, p.id));
    return { label: p.label, done: applicable.filter((s) => entryFor(s, p.id)).length, total: applicable.length };
  });
  const hasEntriesToday = counts.some((c) => c.done > 0);

  const advance = useCallback((fromId, periodId, dir = 1) => {
    const from = activeSymptoms.findIndex((s) => s.id === fromId);
    const idx = stepIndex(activeSymptoms, from, dir, (s) => isApplicable(s, periodId));
    if (idx >= 0) setFocus({ id: activeSymptoms[idx].id, period: periodId });
  }, [activeSymptoms]);

  const rate = (symptom, periodId, severity) => {
    quickLog(symptom.id, severity, periodId);
    advance(symptom.id, periodId);
  };

  const clearEntry = (symptom, periodId) => {
    const key = `${dateKey}-${symptom.id}-${periodId}`;
    if (!entries[key]) return;
    setEntries((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    haptic('light');
    setLastAction(`Removed ${symptom.name}`);
  };

  // Desktop keyboard entry
  useEffect(() => {
    if (!isDesktop || editing || !keyboardEnabled) return;
    const onKey = (e) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const symptom = activeSymptoms.find((s) => s.id === focus.id);
      if (e.key === 'e' || e.key === 'E') { setEditing(true); e.preventDefault(); return; }
      if (!symptom) return;
      if (/^[0-5]$/.test(e.key)) {
        if (isApplicable(symptom, focus.period)) rate(symptom, focus.period, Number(e.key));
      } else if (e.key === 'n' || e.key === 'N') {
        if (isApplicable(symptom, focus.period)) rate(symptom, focus.period, NA_SEVERITY);
      } else if (e.key === 'ArrowDown') advance(symptom.id, focus.period, 1);
      else if (e.key === 'ArrowUp') advance(symptom.id, focus.period, -1);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = timePeriods.findIndex((p) => p.id === focus.period);
        const target = timePeriods[i + (e.key === 'ArrowLeft' ? -1 : 1)];
        if (target && isApplicable(symptom, target.id)) setFocus({ id: symptom.id, period: target.id });
      } else if (e.key === 'Backspace' || e.key === 'Delete') clearEntry(symptom, focus.period);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!editing) return;
    const onKey = (e) => { if (e.key === 'Escape' && !isTyping(e.target)) setEditing(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, setEditing]);

  // ---- Edit mode ----
  const orderedActive = useMemo(
    () => symptoms.filter((s) => s.active).sort((a, b) => (a.order || 0) - (b.order || 0)),
    [symptoms]
  );
  const hiddenSymptoms = useMemo(() => symptoms.filter((s) => !s.active), [symptoms]);

  const patchSymptom = (id, patch) =>
    setSymptoms((prev) => prev.map((s) => (s.id === id ? applySymptomPatch(s, patch) : s)));

  const commitName = (symptom, raw) => {
    const name = raw.trim();
    if (name) patchSymptom(symptom.id, { name });
  };

  const togglePeriod = (symptom, periodId) => {
    const all = timePeriods.map((p) => p.id);
    const current = symptom.applicablePeriods || all;
    const next = current.includes(periodId) ? current.filter((p) => p !== periodId) : [...current, periodId];
    if (next.length === 0) return; // must apply to at least one period
    patchSymptom(symptom.id, { applicablePeriods: next.length === all.length ? null : next });
  };

  // Nothing is written until a name is committed, so an abandoned row leaves no trace
  const addSymptom = (raw) => {
    setAdding(false);
    const name = raw.trim();
    if (!name) return;
    const existing = symptoms.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!existing.active) patchSymptom(existing.id, { active: true });
      setLastAction(existing.active ? 'Symptom already exists' : 'Symptom restored');
      return;
    }
    const maxOrder = Math.max(-1, ...orderedActive.map((s) => s.order || 0));
    const symptom = { id: makeId(name), name, active: true, order: maxOrder + 1 };
    symptom.history = [createSymptomHistoryEntry(symptom)];
    setSymptoms((prev) => [...prev, symptom]);
    setLastAction('Symptom added');
  };

  const revertTo = (symptom, historyIndex) => {
    const state = reconstructSymptomStateAtEntry(symptom.history || [], historyIndex);
    if (!state) return;
    patchSymptom(symptom.id, { name: state.name || symptom.name, description: state.description || '' });
    setLastAction(`Reverted ${symptom.name}`);
  };

  const commitReorder = (fromId, toId) => {
    const ids = reorder(orderedActive.map((s) => s.id), fromId, toId);
    setSymptoms((prev) => prev.map((s) => {
      const i = ids.indexOf(s.id);
      return i === -1 || s.order === i ? s : { ...s, order: i };
    }));
    haptic('medium');
  };

  const { gripProps, rowClass: dragClass } = useReorderDrag(commitReorder);

  const periodSummary = (symptom) => {
    if (timePeriods.length === 1) return '';
    const on = timePeriods.filter((p) => isApplicable(symptom, p.id));
    return on.length === timePeriods.length ? on.map((p) => p.label).join(' · ') : `${on[0].label} only`;
  };

  const renderLog = (symptom) => (
    <ChangeLog history={symptom.history} format={formatSymptomChange} onRevert={(index) => revertTo(symptom, index)} />
  );

  const renderEditRow = (symptom, hidden) => {
    const expanded = expandedId === symptom.id;
    const fields = (
      <div className="lr-fields">
        <DraftInput className="lr-input name" value={symptom.name} placeholder="Name" onCommit={(v) => commitName(symptom, v)} />
        <DraftInput className="lr-input desc" value={symptom.description} placeholder="Add a description" onCommit={(v) => patchSymptom(symptom.id, { description: v.trim() })} />
      </div>
    );
    const toggles = timePeriods.length > 1
      ? timePeriods.map((p) => (
          <button key={p.id} className={`lr-toggle ${isApplicable(symptom, p.id) ? 'on' : ''}`} onClick={() => togglePeriod(symptom, p.id)}>{p.label}</button>
        ))
      : <span />;
    const actions = hidden ? (
      <>
        <button className="lr-link" onClick={() => patchSymptom(symptom.id, { active: true })}>Restore</button>
        {onDeleteSymptom && <button className="lr-link danger" onClick={() => onDeleteSymptom(symptom)}>Delete</button>}
      </>
    ) : (
      <button className="lr-link" onClick={() => { patchSymptom(symptom.id, { active: false }); setLastAction('Symptom hidden (history preserved)'); }}>Hide</button>
    );
    const toggleExpand = () => setExpandedId(expanded ? null : symptom.id);
    const rowClass = [
      'lr-row lr-cols',
      hidden ? 'lr-hidden' : '',
      expanded ? 'expanded' : '',
      dragClass(symptom.id),
    ].join(' ');

    return (
      <div key={symptom.id} className={rowClass} data-reorder-id={hidden ? undefined : symptom.id} data-reorder-group={hidden ? undefined : 'default'}>
        {hidden ? <span /> : <span className="lr-grip" {...gripProps(symptom.id)}>⠿</span>}
        {isDesktop ? (
          <>
            {fields}
            {toggles}
            <div className="lr-rowacts">
              <button className="lr-link" onClick={toggleExpand}>{expanded ? 'Close' : 'History'}</button>
              {actions}
            </div>
          </>
        ) : (
          <>
            <div className="lr-name" onClick={toggleExpand}>{symptom.name || 'Untitled'}{symptom.description && <small>{symptom.description}</small>}</div>
            <div className="lr-sum" onClick={toggleExpand}>{periodSummary(symptom)}</div>
            <button className="lr-link" onClick={toggleExpand}>{expanded ? '▴' : '▾'}</button>
          </>
        )}
        {expanded && (
          <div className="lr-panel">
            {!isDesktop && fields}
            {!isDesktop && timePeriods.length > 1 && <div className="lr-prow"><span>Tracked in</span>{toggles}</div>}
            {renderLog(symptom)}
            {!isDesktop && <div className="lr-prow">{actions}</div>}
          </div>
        )}
      </div>
    );
  };

  // ---- Render ----
  const rootClass = `lr ${isDesktop ? 'desktop' : 'mobile'} ${editing ? 'edit' : ''}`;
  const rootStyle = { '--lr-periods': timePeriods.length };

  // Scope + actions live in the nav's context bar (desktop) or the second row of the mobile top bar
  const toggleEdit = () => { setEditing(!editing); setExpandedId(null); };
  const bar = barSlot ? createPortal(
    <>
      {editing ? <span className="dn-progress"><b>{orderedActive.length}</b> active</span> : counts.map((c) => (
        <span className="dn-progress" key={c.label}>
          {timePeriods.length > 1 ? c.label : 'Logged'} <b>{c.done}/{c.total}</b>
          <i style={{ '--p': `${c.total ? (c.done / c.total) * 100 : 0}%` }} />
        </span>
      ))}
      <span className="lr-spacer" />
      {isDesktop && !editing && hasEntriesToday && <button className="dn-btn ghost" onClick={onClearDay}>Clear day</button>}
      {isDesktop && !editing && <button className="dn-btn" onClick={onEditNote}>Day notes</button>}
      {(isDesktop || editing) && <button className={`dn-btn ${editing ? 'primary' : ''}`} onClick={toggleEdit}>{editing ? 'Done' : 'Edit symptoms'}</button>}
    </>,
    barSlot
  ) : null;

  if (editing) {
    return (
      <div className={rootClass} style={rootStyle}>
        {bar}
        {isDesktop && (
          <div className="lr-head lr-cols">
            <div /><div>NAME AND DESCRIPTION</div>
            {timePeriods.length > 1 ? <div className="c" style={{ gridColumn: `span ${timePeriods.length}` }}>TRACKED IN</div> : <div />}
            <div />
          </div>
        )}
        {orderedActive.map((s) => renderEditRow(s, false))}
        {adding ? (
          <div className="lr-row lr-cols lr-add">
            <span className="lr-grip" style={{ cursor: 'default' }}>+</span>
            <div className="lr-fields">
              <DraftInput className="lr-input name" value="" placeholder="New symptom name" autoFocus onCommit={addSymptom} onAbandon={() => setAdding(false)} />
            </div>
          </div>
        ) : (
          <div className="lr-row lr-cols lr-add" onClick={() => setAdding(true)}>
            <span className="lr-grip" style={{ cursor: 'pointer' }}>+</span><div>Add symptom</div>
          </div>
        )}
        {hiddenSymptoms.length > 0 && (
          <>
            <div className="lr-sec clickable" onClick={() => setShowHidden((v) => !v)}>
              HIDDEN · {hiddenSymptoms.length} · history is kept<span>{showHidden ? 'Collapse' : 'Show'}</span>
            </div>
            {showHidden && hiddenSymptoms.map((s) => renderEditRow(s, true))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={rootClass} style={rootStyle}>
      {bar}
      {activeSymptoms.length === 0 ? (
        <div className="lr-empty">{symptomSearch ? `No symptoms match "${symptomSearch}"` : 'No symptoms yet. Use Edit symptoms to add one.'}</div>
      ) : (
        <>
          <div className="lr-head lr-cols">
            <div />
            {isDesktop && <div className="strip-h">LAST 14 DAYS</div>}
            {timePeriods.map((p) => <div className="c" key={p.id}>{timePeriods.length > 1 ? p.label : 'TODAY'}</div>)}
          </div>
          {activeSymptoms.map((symptom) => {
            const open = focus.id === symptom.id;
            const done = timePeriods.every((p) => !isApplicable(symptom, p.id) || entryFor(symptom, p.id));
            const currentPeriod = timePeriods.find((p) => p.id === focus.period);
            const current = entryFor(symptom, focus.period);
            // Until this slot is rated, outline the value picked last time
            const lastSeverity = open && !current ? getLastSeverity(entries, symptom.id, focus.period, selectedDate) : null;
            return (
              <div
                key={symptom.id}
                className={`lr-row lr-cols ${open ? 'open' : ''} ${done ? 'done' : ''}`}
                onClick={() => {
                  if (open && !isDesktop) { setFocus((f) => ({ ...f, id: null })); return; }
                  const period = isApplicable(symptom, focus.period) ? focus.period : timePeriods.find((p) => isApplicable(symptom, p.id)).id;
                  setFocus({ id: symptom.id, period });
                }}
              >
                <div className="lr-name">
                  {pinnedSymptoms?.has(symptom.id) && <span className="lr-pin">⊙</span>}
                  {symptom.name}{symptom.description && <small>{symptom.description}</small>}
                </div>
                {isDesktop && (
                  <div className="lr-strip" title="Open history" onClick={(e) => { e.stopPropagation(); onOpenGraph?.(symptom.id); }}>
                    {(strips[symptom.id] || []).map((v, i) => (
                      <i key={i} style={v === null ? undefined : { height: 3 + v * 3, background: STRIP_COLOR[v] }} />
                    ))}
                  </div>
                )}
                {timePeriods.map((p) => {
                  if (!isApplicable(symptom, p.id)) return <span key={p.id} className="lr-pill none">–</span>;
                  const entry = entryFor(symptom, p.id);
                  const cur = open && focus.period === p.id ? ' cur' : '';
                  const select = (e) => { e.stopPropagation(); setFocus({ id: symptom.id, period: p.id }); };
                  if (!entry) return <button key={p.id} className={`lr-pill empty${cur}`} onClick={select}>·</button>;
                  if (entry.severity === NA_SEVERITY) return <button key={p.id} className={`lr-pill na${cur}`} onClick={select}>N/A</button>;
                  return (
                    <button key={p.id} className={`lr-pill${cur}`} style={{ background: SEV_BG[entry.severity], color: SEV_FG[entry.severity] }} onClick={select}>
                      {entry.severity}
                    </button>
                  );
                })}
                {open && currentPeriod && isApplicable(symptom, focus.period) && (
                  <div className="lr-keys" onClick={(e) => e.stopPropagation()}>
                    {timePeriods.length > 1 && <span className="lr-tag">{currentPeriod.label}</span>}
                    {SEVERITIES.map((n) => (
                      <button
                        key={n}
                        className={`lr-key ${lastSeverity === n ? 'last' : ''}`}
                        style={current?.severity === n ? { background: SEV_BG[n], color: SEV_FG[n], borderColor: 'transparent' } : lastSeverity === n ? { '--c': STRIP_COLOR[n] } : undefined}
                        onClick={() => rate(symptom, focus.period, n)}
                      >
                        {n}
                      </button>
                    ))}
                    <button className="lr-key wide" onClick={() => rate(symptom, focus.period, NA_SEVERITY)}>N/A</button>
                    {current && <button className="lr-key wide" onClick={() => clearEntry(symptom, focus.period)}>Clear</button>}
                    <button className="lr-key wide mobile-only" onClick={() => onOpenGraph?.(symptom.id)}>History</button>
                    <span className="lr-hint"><kbd>0</kbd>–<kbd>5</kbd> rate · <kbd>←</kbd><kbd>→</kbd> {timePeriods.map((p) => p.label).join('/')} · <kbd>⌫</kbd> clear</span>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
