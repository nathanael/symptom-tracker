import { useState, useEffect, useMemo } from 'react';
import './listUi.css';
import { INPUT_CATEGORIES, VERDICT_COLORS } from '../utils/constants';
import {
  getDateKey,
  haptic,
  isScheduledForDate,
  createHistoryEntry,
  applyHistoricalState,
  reconstructStateAtEntry,
} from '../utils/helpers';
import { getStripDateKeys, stepIndex, reorder, makeId } from '../utils/listHelpers';
import {
  applySupplementPatch,
  applyInputPatch,
  formatSupplementChange,
  formatInputChange,
  nextDueLabel,
} from '../utils/protocolHistory';
import { matchSupplementCategory } from '../utils/supplementLookup';
import SchedulePicker, { formatSchedule } from './SchedulePicker';
import { isTyping, DraftInput, useReorderDrag, ChangeLog } from './listParts';

const UNITS = ['mg', 'mcg', 'g', 'IU', 'ml', 'drops', 'caps'];
const VERDICTS = [
  { value: null, label: 'None' },
  { value: 'testing', label: 'Testing' },
  { value: 'bad', label: 'Bad' },
  { value: 'good', label: 'Good' },
];
const HIDDEN_PREVIEW = 3;

const categoryOf = (id) => INPUT_CATEGORIES.find((c) => c.id === id) || INPUT_CATEGORIES[0];
const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
const matches = (item, search) => {
  if (!search) return true;
  const s = search.toLowerCase();
  return item.name.toLowerCase().includes(s) || (item.description || '').toLowerCase().includes(s);
};

export default function ProtocolRows({
  stackItems,
  setStackItems,
  stackEntries,
  setStackEntries,
  inputItems,
  setInputItems,
  inputEntries,
  setInputEntries,
  selectedDate,
  setLastAction,
  search,
  setSearch,
  onOpenSupplementGraph,
  onCheckAll,
  onClearDay,
  onMatchYesterday,
  onDeleteItem,
  editing,
  setEditing,
  keyboardEnabled,
  isDesktop,
}) {
  const dateKey = getDateKey(selectedDate);
  const isToday = selectedDate.toDateString() === new Date().toDateString();

  const [focusId, setFocusId] = useState(null);
  const [dosingId, setDosingId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [showAllHidden, setShowAllHidden] = useState(false);
  const [adding, setAdding] = useState(null); // 'supplement' | 'factor'

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  useEffect(() => setScheduleDraft(null), [expandedId]);

  // ---- View model ----
  // Supplements as they were on the selected date, split into due and not-due
  const { dueItems, otherItems } = useMemo(() => {
    const withHistory = stackItems.map((item) => applyHistoricalState(item, selectedDate));
    const activeThen = withHistory.filter((item) => item.active !== false);
    const due = activeThen.filter((item) => isScheduledForDate(item.schedule, selectedDate));
    const dueIds = new Set(due.map((i) => i.id));
    // Anything logged that day is shown as a normal row even if it was off-schedule or since hidden
    const logged = withHistory.filter((item) => !dueIds.has(item.id) && stackEntries[`${dateKey}-${item.id}`]);
    const shown = new Set([...dueIds, ...logged.map((i) => i.id)]);
    const others = activeThen.filter((item) => !shown.has(item.id));
    return {
      dueItems: [...due, ...logged].sort(byOrder).filter((i) => matches(i, search)),
      otherItems: others.sort(byOrder).filter((i) => matches(i, search)),
    };
  }, [stackItems, stackEntries, selectedDate, dateKey, search]);

  const factors = useMemo(() => {
    const active = inputItems.filter((i) => i.active);
    const activeIds = new Set(active.map((i) => i.id));
    const logged = inputItems.filter((i) => !activeIds.has(i.id) && inputEntries[`${dateKey}-${i.id}`]);
    return [...active, ...logged].sort(byOrder).filter((i) => matches(i, search));
  }, [inputItems, inputEntries, dateKey, search]);

  const stripKeys = useMemo(() => getStripDateKeys(selectedDate, 14), [dateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows reachable from the keyboard, in display order
  const navRows = useMemo(
    () => [...dueItems.map((i) => ({ id: i.id, kind: 'supplement' })), ...factors.map((i) => ({ id: i.id, kind: 'factor' }))],
    [dueItems, factors]
  );

  useEffect(() => {
    if (isDesktop && focusId === null && navRows.length > 0) setFocusId(navRows[0].id);
  }, [isDesktop, navRows, focusId]);

  const takenCount = dueItems.filter((i) => stackEntries[`${dateKey}-${i.id}`]).length;
  const loggedCount = factors.filter((i) => inputEntries[`${dateKey}-${i.id}`]).length;
  const hasAnyToday = takenCount + loggedCount > 0;

  // ---- Logging ----
  const toggleSupplement = (item) => {
    haptic('light');
    const key = `${dateKey}-${item.id}`;
    setStackEntries((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { date: dateKey, itemId: item.id, dose: item.defaultDose || 0, taken: true } };
    });
    setLastAction(`${stackEntries[key] ? 'Removed' : 'Took'} ${item.name}`);
  };

  const setDose = (item, raw) => {
    setDosingId(null);
    const dose = parseFloat(raw);
    if (!Number.isFinite(dose)) return;
    const key = `${dateKey}-${item.id}`;
    setStackEntries((prev) => ({
      ...prev,
      [key]: prev[key] ? { ...prev[key], dose } : { date: dateKey, itemId: item.id, dose, taken: true },
    }));
    setLastAction(`${item.name}: ${dose}${item.unit}`);
  };

  const setFactorCount = (item, count) => {
    haptic('light');
    const key = `${dateKey}-${item.id}`;
    setInputEntries((prev) => {
      if (count <= 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { ...(prev[key] || { date: dateKey, inputId: item.id, logged: true }), count } };
    });
    setLastAction(count <= 0 ? `Removed ${item.name}` : count === 1 ? `Logged ${item.name}` : `${item.name} x${count}`);
  };

  const toggleRow = (row) => {
    if (row.kind === 'supplement') {
      const item = [...dueItems, ...otherItems].find((i) => i.id === row.id);
      if (item) toggleSupplement(item);
    } else {
      const item = factors.find((i) => i.id === row.id);
      if (item) setFactorCount(item, inputEntries[`${dateKey}-${item.id}`] ? 0 : 1);
    }
  };

  const moveFocus = (dir) => {
    const from = navRows.findIndex((r) => r.id === focusId);
    const idx = stepIndex(navRows, from, dir);
    if (idx >= 0) setFocusId(navRows[idx].id);
  };

  useEffect(() => {
    if (!isDesktop || editing || !keyboardEnabled) return;
    const onKey = (e) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const row = navRows.find((r) => r.id === focusId);
      if (e.key === 'e' || e.key === 'E') setEditing(true);
      else if (e.key === 'ArrowDown') moveFocus(1);
      else if (e.key === 'ArrowUp') moveFocus(-1);
      else if (row && (e.key === ' ' || e.key === 'x' || e.key === 'X')) { toggleRow(row); moveFocus(1); }
      else if (row && row.kind === 'supplement' && (e.key === 'd' || e.key === 'D')) setDosingId(row.id);
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
  const activeSupplements = useMemo(() => stackItems.filter((i) => i.active).sort(byOrder), [stackItems]);
  const activeFactors = useMemo(() => inputItems.filter((i) => i.active).sort(byOrder), [inputItems]);
  const hiddenRows = useMemo(
    () => [
      ...stackItems.filter((i) => !i.active).map((item) => ({ item, kind: 'supplement' })),
      ...inputItems.filter((i) => !i.active).map((item) => ({ item, kind: 'factor' })),
    ],
    [stackItems, inputItems]
  );

  const patchSupplement = (id, patch) =>
    setStackItems((prev) => prev.map((i) => (i.id === id ? applySupplementPatch(i, patch) : i)));
  const patchFactor = (id, patch) =>
    setInputItems((prev) => prev.map((i) => (i.id === id ? applyInputPatch(i, patch) : i)));
  const patch = (kind, id, p) => (kind === 'supplement' ? patchSupplement(id, p) : patchFactor(id, p));

  const commitDefaultDose = (item, raw) => {
    const dose = parseFloat(raw);
    if (!Number.isFinite(dose) || dose === item.defaultDose) return;
    patchSupplement(item.id, { defaultDose: dose });
    // Keep today's entry in step unless its dose was customised
    const key = `${dateKey}-${item.id}`;
    setStackEntries((prev) => (prev[key] && prev[key].dose === item.defaultDose ? { ...prev, [key]: { ...prev[key], dose } } : prev));
  };

  const revertSupplement = (item, index) => {
    const state = reconstructStateAtEntry(item.history || [], index);
    if (!state) return;
    patchSupplement(item.id, {
      name: state.name || item.name,
      defaultDose: state.defaultDose ?? item.defaultDose,
      unit: state.unit || item.unit,
      description: state.description || '',
      schedule: state.schedule || item.schedule,
    });
    setLastAction(`Reverted ${item.name}`);
  };

  const addItem = (kind, raw) => {
    setAdding(null);
    const name = raw.trim();
    if (!name) return;
    const list = kind === 'supplement' ? stackItems : inputItems;
    const existing = list.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!existing.active) patch(kind, existing.id, { active: true });
      setLastAction(existing.active ? `${name} already exists` : `Restored ${existing.name}`);
      return;
    }
    const order = Math.max(-1, ...list.map((i) => i.order || 0)) + 1;
    if (kind === 'supplement') {
      const item = {
        id: makeId(name), name, unit: 'mg', defaultDose: 0, description: '',
        schedule: { type: 'daily', startDate: getDateKey(new Date()) },
        halfLifeCategory: matchSupplementCategory(name) || null, active: true, order,
      };
      item.history = [createHistoryEntry(item)];
      setStackItems((prev) => [...prev, item]);
      setExpandedId(item.id);
    } else {
      const item = { id: makeId(name), name, description: '', category: 'food', active: true, order, verdict: null, verdictDate: null };
      item.history = [{ timestamp: new Date().toISOString(), type: 'created', snapshot: { name, description: '', category: 'food', active: true, verdict: null } }];
      setInputItems((prev) => [...prev, item]);
      setExpandedId(item.id);
    }
    setLastAction(`Added ${name}`);
  };

  const commitReorder = (fromId, toId, group) => {
    const list = group === 'supplement' ? activeSupplements : activeFactors;
    const ids = reorder(list.map((i) => i.id), fromId, toId);
    const apply = (prev) => prev.map((i) => {
      const idx = ids.indexOf(i.id);
      return idx === -1 || i.order === idx ? i : { ...i, order: idx };
    });
    if (group === 'supplement') setStackItems(apply); else setInputItems(apply);
    haptic('medium');
  };
  const { gripProps, rowClass: dragClass } = useReorderDrag(commitReorder);

  const summaryOf = (item, kind) => {
    if (kind === 'supplement') return formatSchedule(item.schedule) || 'Daily';
    const verdict = VERDICTS.find((v) => v.value === (item.verdict || null));
    return `${categoryOf(item.category).label}${verdict.value ? ` · ${verdict.label}` : ''}`;
  };

  const renderPanel = (item, kind, hidden) => {
    const segmented = (options, current, onPick) => (
      <div className="lr-seg">
        {options.map((o) => (
          <button key={String(o.value)} className={current === o.value ? 'on' : ''} onClick={() => onPick(o.value)}>{o.label}</button>
        ))}
      </div>
    );
    const schedule = scheduleDraft ?? item.schedule;
    return (
      <div className="lr-panel">
        {!isDesktop && renderFields(item, kind)}
        {!isDesktop && kind === 'supplement' && <div className="lr-field"><label>Dose</label>{renderDose(item)}</div>}
        {kind === 'supplement' ? (
          <>
            <div className="lr-field top">
              <label>Schedule</label>
              <div className="lr-schedule">
                <SchedulePicker schedule={schedule} onChange={setScheduleDraft} />
                {scheduleDraft && (
                  <div className="lr-prow" style={{ marginTop: 8 }}>
                    <button className="lr-btn primary" onClick={() => { patchSupplement(item.id, { schedule: scheduleDraft }); setScheduleDraft(null); }}>Save schedule</button>
                    <button className="lr-btn" onClick={() => setScheduleDraft(null)}>Cancel</button>
                  </div>
                )}
              </div>
            </div>
            <div className="lr-field">
              <label>Decay rate</label>
              <select className="lr-input boxed" value={item.halfLifeCategory || ''} onChange={(e) => patchSupplement(item.id, { halfLifeCategory: e.target.value || null })}>
                <option value="">Auto / Default (Moderate)</option>
                <option value="fast">Fast (~12 hours)</option>
                <option value="moderate">Moderate (~3 days)</option>
                <option value="slow">Slow (~21 days)</option>
              </select>
              <small>Used by the body-level chart</small>
            </div>
          </>
        ) : (
          <>
            <div className="lr-field"><label>Category</label>{segmented(INPUT_CATEGORIES.map((c) => ({ value: c.id, label: c.label })), item.category, (v) => patchFactor(item.id, { category: v }))}</div>
            <div className="lr-field"><label>Verdict</label>{segmented(VERDICTS, item.verdict || null, (v) => patchFactor(item.id, { verdict: v }))}</div>
          </>
        )}
        <ChangeLog
          history={item.history}
          format={kind === 'supplement' ? (e) => formatSupplementChange(e, item.unit) : formatInputChange}
          onRevert={kind === 'supplement' ? (index) => revertSupplement(item, index) : null}
        />
        {!isDesktop && <div className="lr-prow">{renderActions(item, kind, hidden)}</div>}
      </div>
    );
  };

  const renderFields = (item, kind) => (
    <div className="lr-fields">
      <DraftInput className="lr-input name" value={item.name} placeholder="Name" onCommit={(v) => v.trim() && patch(kind, item.id, { name: v.trim() })} />
      <DraftInput className="lr-input desc" value={item.description} placeholder="Add a description" onCommit={(v) => patch(kind, item.id, { description: v.trim() })} />
    </div>
  );

  const renderDose = (item) => (
    <div className="lr-dosefields">
      <DraftInput className="lr-input num" inputMode="decimal" value={item.defaultDose} onCommit={(v) => commitDefaultDose(item, v)} />
      <select className="lr-input unit" value={item.unit} onChange={(e) => patchSupplement(item.id, { unit: e.target.value })}>
        {(UNITS.includes(item.unit) ? UNITS : [item.unit, ...UNITS]).map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  );

  const renderActions = (item, kind, hidden) => hidden ? (
    <>
      <button className="lr-link" onClick={() => patch(kind, item.id, { active: true })}>Restore</button>
      {onDeleteItem && <button className="lr-link danger" onClick={() => onDeleteItem(item, kind)}>Delete</button>}
    </>
  ) : (
    <button className="lr-link" onClick={() => { patch(kind, item.id, { active: false }); setLastAction(`${item.name} hidden (history preserved)`); }}>Hide</button>
  );

  const renderEditRow = ({ item, kind }, hidden) => {
    const expanded = expandedId === item.id;
    const toggleExpand = () => setExpandedId(expanded ? null : item.id);
    const summary = summaryOf(item, kind);
    return (
      <div
        key={item.id}
        className={`lr-row lr-cols ${hidden ? 'lr-hidden' : ''} ${expanded ? 'expanded' : ''} ${dragClass(item.id)}`}
        data-reorder-id={hidden ? undefined : item.id}
        data-reorder-group={hidden ? undefined : kind}
      >
        {hidden ? <span /> : <span className="lr-grip" {...gripProps(item.id, kind)}>⠿</span>}
        {isDesktop ? (
          <>
            {renderFields(item, kind)}
            {kind === 'supplement' ? renderDose(item) : <span />}
            <button className="lr-chip" onClick={toggleExpand}>{summary}</button>
            <div className="lr-rowacts">
              <button className="lr-link" onClick={toggleExpand}>{expanded ? 'Close' : 'More'}</button>
              {renderActions(item, kind, hidden)}
            </div>
          </>
        ) : (
          <>
            <div className="lr-name" onClick={toggleExpand}>
              {item.name || 'Untitled'}
              <small>{kind === 'supplement' ? `${item.defaultDose} ${item.unit} · ` : ''}{summary}</small>
            </div>
            <span />
            <button className="lr-link" onClick={toggleExpand}>{expanded ? '▴' : '▾'}</button>
          </>
        )}
        {expanded && renderPanel(item, kind, hidden)}
      </div>
    );
  };

  const renderAddRow = (kind, label) => adding === kind ? (
    <div className="lr-row lr-cols lr-add">
      <span className="lr-grip" style={{ cursor: 'default' }}>+</span>
      <div className="lr-fields">
        <DraftInput className="lr-input name" value="" placeholder={`New ${kind} name`} autoFocus onCommit={(v) => addItem(kind, v)} onAbandon={() => setAdding(null)} />
      </div>
    </div>
  ) : (
    <div className="lr-row lr-cols lr-add" onClick={() => setAdding(kind)}>
      <span className="lr-grip" style={{ cursor: 'pointer' }}>+</span><div>{label}</div>
    </div>
  );

  // ---- Render ----
  const rootClass = `lr lr-protocol ${isDesktop ? 'desktop' : 'mobile'} ${editing ? 'edit' : ''}`;

  const bar = (
    <div className={`lr-bar ${menuOpen ? 'menu' : ''}`}>
      {isDesktop && !editing && (
        <input className="lr-search" type="text" value={search} placeholder="Search…" onChange={(e) => setSearch(e.target.value)} />
      )}
      <span className="lr-count">
        {editing ? `${activeSupplements.length + activeFactors.length} active` : `${takenCount + loggedCount} / ${dueItems.length + factors.length} logged`}
      </span>
      <span className="lr-spacer" />
      <div className="lr-actions">
        {!editing && <button className="lr-btn" onClick={onMatchYesterday}>Match yesterday</button>}
        {!editing && <button className="lr-btn" onClick={onCheckAll}>Check all</button>}
        {!editing && hasAnyToday && <button className="lr-btn" onClick={onClearDay}>Clear day</button>}
        <button className={`lr-btn ${editing ? 'primary' : ''}`} onClick={() => { setEditing(!editing); setExpandedId(null); }}>{editing ? 'Done' : 'Edit protocol'}</button>
      </div>
      <button className="lr-btn lr-more" onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}>⋯</button>
    </div>
  );

  if (editing) {
    const visibleHidden = showAllHidden ? hiddenRows : hiddenRows.slice(0, HIDDEN_PREVIEW);
    return (
      <div className={rootClass}>
        {bar}
        <div className="lr-sec"><b>SUPPLEMENTS</b> {activeSupplements.length} active</div>
        {activeSupplements.map((item) => renderEditRow({ item, kind: 'supplement' }, false))}
        {renderAddRow('supplement', 'Add supplement')}
        <div className="lr-sec"><b>OTHER FACTORS</b> {activeFactors.length} active</div>
        {activeFactors.map((item) => renderEditRow({ item, kind: 'factor' }, false))}
        {renderAddRow('factor', 'Add factor')}
        {hiddenRows.length > 0 && (
          <>
            <div className="lr-sec">HIDDEN · {hiddenRows.length} · history is kept</div>
            {visibleHidden.map((row) => renderEditRow(row, true))}
            {hiddenRows.length > HIDDEN_PREVIEW && (
              <div className="lr-row lr-cols lr-showmore" onClick={() => setShowAllHidden((v) => !v)}>
                <span /><div>{showAllHidden ? 'Show fewer' : `Show ${hiddenRows.length - HIDDEN_PREVIEW} more`}</div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const renderStrip = (id, entryMap, schedule, onClick) => (
    <div className="lr-strip check" title={onClick ? 'Open chart' : undefined} onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined} style={onClick ? undefined : { cursor: 'default' }}>
      {stripKeys.map((k) => {
        const on = !!entryMap[`${k}-${id}`];
        const skip = !on && schedule && !isScheduledForDate(schedule, new Date(`${k}T12:00:00`));
        return <i key={k} className={on ? 'y' : skip ? 'skip' : ''} />;
      })}
    </div>
  );

  const renderSupplementRow = (item, due) => {
    const entry = stackEntries[`${dateKey}-${item.id}`];
    const focused = isDesktop && focusId === item.id;
    const dueLabel = !due ? nextDueLabel(item.schedule, selectedDate) : null;
    return (
      <div
        key={item.id}
        className={`lr-row lr-cols ${focused ? 'focus' : ''} ${entry ? 'done' : ''} ${due ? '' : 'muted'}`}
        onClick={() => { if (due) setFocusId(item.id); if (!isDesktop) toggleSupplement(item); }}
      >
        <div className="lr-name">{item.name}{item.description && <small>{item.description}</small>}</div>
        {isDesktop && renderStrip(item.id, stackEntries, item.schedule, onOpenSupplementGraph ? () => onOpenSupplementGraph(item.id) : null)}
        {dosingId === item.id ? (
          <div className="lr-dose editing" onClick={(e) => e.stopPropagation()}>
            <DraftInput className="lr-input num boxed" inputMode="decimal" autoFocus value={entry?.dose ?? item.defaultDose} onCommit={(v) => setDose(item, v)} onAbandon={() => setDosingId(null)} />{item.unit}
          </div>
        ) : (
          <button className="lr-dose" onClick={(e) => { e.stopPropagation(); setDosingId(item.id); }}>
            <b>{entry?.dose ?? item.defaultDose}</b>{item.unit}
          </button>
        )}
        {due || entry ? (
          <button className={`lr-pill ${entry ? 'on' : 'empty'}`} onClick={(e) => { e.stopPropagation(); setFocusId(item.id); toggleSupplement(item); }}>✓</button>
        ) : (
          <button className="lr-due" title="Log anyway" onClick={(e) => { e.stopPropagation(); toggleSupplement(item); }}>{dueLabel ? `due ${dueLabel}` : 'log'}</button>
        )}
      </div>
    );
  };

  const renderFactorRow = (item) => {
    const entry = inputEntries[`${dateKey}-${item.id}`];
    const count = entry ? entry.count || 1 : 0;
    const focused = isDesktop && focusId === item.id;
    const category = categoryOf(item.category);
    return (
      <div
        key={item.id}
        className={`lr-row lr-cols ${focused ? 'focus' : ''} ${entry ? 'done' : ''}`}
        onClick={() => { setFocusId(item.id); if (!isDesktop) setFactorCount(item, count ? 0 : 1); }}
      >
        <div className="lr-name">
          <i className="lr-dot" style={{ background: category.color }} />
          {item.name}
          {item.verdict && <span className="lr-verdict" style={{ color: VERDICT_COLORS[item.verdict], borderColor: `${VERDICT_COLORS[item.verdict]}55` }}>{item.verdict}</span>}
          {item.description && <small>{item.description}</small>}
        </div>
        {isDesktop && renderStrip(item.id, inputEntries, null, null)}
        {count > 0 ? (
          <div className="lr-stepper" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setFactorCount(item, count - 1)}>−</button>
            <span>×{count}</span>
            <button onClick={() => setFactorCount(item, count + 1)}>+</button>
          </div>
        ) : <span />}
        <button className={`lr-pill ${entry ? 'on' : 'empty'}`} onClick={(e) => { e.stopPropagation(); setFocusId(item.id); setFactorCount(item, count ? 0 : 1); }}>✓</button>
      </div>
    );
  };

  return (
    <div className={rootClass}>
      {bar}
      <div className="lr-sec">
        <b>SUPPLEMENTS</b> {takenCount} of {dueItems.length} taken
        {isDesktop && <span>LAST 14 DAYS</span>}
      </div>
      {dueItems.length === 0 && otherItems.length === 0 && (
        <div className="lr-empty">{search ? `Nothing matches "${search}"` : 'No supplements yet. Use Edit protocol to add one.'}</div>
      )}
      {dueItems.map((item) => renderSupplementRow(item, true))}
      {otherItems.map((item) => renderSupplementRow(item, false))}
      <div className="lr-sec"><b>OTHER FACTORS</b> {loggedCount} of {factors.length} {isToday ? 'today' : 'logged'}</div>
      {factors.length === 0 && <div className="lr-empty">{search ? `Nothing matches "${search}"` : 'No factors yet.'}</div>}
      {factors.map(renderFactorRow)}
      {isDesktop && (
        <div className="lr-hintbar"><span><kbd>Space</kbd> check and move down · <kbd>D</kbd> dose · <kbd>↑</kbd><kbd>↓</kbd> · <kbd>E</kbd> edit</span></div>
      )}
    </div>
  );
}
