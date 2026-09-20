import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import './listUi.css';
import { NA_SEVERITY } from '../utils/constants';
import { getDateKey, haptic } from '../utils/helpers';
import { isTyping, DraftInput, useReorderDrag, ChangeLog } from './listParts';
import { isApplicable, getStripDateKeys, getSeverityStrip, getLastSeverity, stepIndex, nextIndexBelow, reorder, makeId } from '../utils/listHelpers';
import { suggestGroup, groupNames, groupSymptoms, availableGroups, nextGroupOrder, groupColor } from '../utils/symptomGroups';
import { suggestGrouping, flareThresholds, flaringBadge } from '../utils/flareGroups';
import {
  createSymptomHistoryEntry,
  applySymptomPatch,
  reconstructSymptomStateAtEntry,
  formatSymptomChange,
} from '../utils/symptomHistory';

const SEVERITIES = [0, 1, 2, 3, 4, 5];
// 0 is the greenest (none is the good outcome), running through lime and yellow to red at 5.
// Grey is kept for "nothing logged" and N/A, so a logged 0 never looks like a gap.
const SEV_BG = ['rgba(34,197,94,.22)', 'rgba(132,204,22,.22)', 'rgba(202,210,40,.30)', 'rgba(234,179,8,.38)', 'rgba(249,115,22,.45)', 'rgba(239,68,68,.55)'];
const SEV_FG = ['#86efac', '#d9f99d', '#fef08a', '#fef9c3', '#ffedd5', '#fee2e2'];
const STRIP_COLOR = ['#16a34a', '#65a30d', '#a3a635', '#eab308', '#f97316', '#ef4444'];

// Per-device view preferences (how the list is grouped, which groups are folded)
const GROUP_BY_KEY = 'symptomGroupBy';
const COLLAPSED_KEY = 'symptomGroupsCollapsed';
const readPref = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; }
};
const writePref = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } };
const NEW_GROUP = '__new__';

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
  const rootRef = useRef(null);
  const thumbAnchor = useRef(null);
  const defaultPeriod = () =>
    timePeriods.length === 1 ? timePeriods[0].id : (new Date().getHours() < 12 ? 'morning' : 'evening');

  const [focus, setFocus] = useState(() => ({ id: null, period: defaultPeriod() }));
  const [expandedId, setExpandedId] = useState(null);
  const [showHidden, setShowHidden] = useState(true);
  const [adding, setAdding] = useState(false);

  // Grouping: 'order' = the flat list, 'groups' = sections the person defined
  const [groupBy, setGroupByState] = useState(() => {
    const saved = readPref(GROUP_BY_KEY, 'order');
    return saved === 'groups' ? 'groups' : 'order';
  });
  const setGroupBy = (value) => { setGroupByState(value); writePref(GROUP_BY_KEY, value); };
  const [collapsed, setCollapsed] = useState(() => new Set(readPref(COLLAPSED_KEY, [])));
  const toggleCollapsed = (name) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    writePref(COLLAPSED_KEY, [...next]);
    return next;
  });
  const [draftGroups, setDraftGroups] = useState([]); // named in Edit but still empty, so not on any symptom yet
  const [namingFor, setNamingFor] = useState(null); // symptom id whose Group menu chose "New group…"
  const [addingGroup, setAddingGroup] = useState(false);
  const [suggestedIds, setSuggestedIds] = useState(() => new Set()); // grouped by suggestion this session
  // Outside Edit, grouping stays out of sight until the person has made a group: no switch, flat list.
  // Inside Edit the switch is always there, so Groups can be opened to start building them.
  const hasGroups = useMemo(() => symptoms.some((s) => s.active && s.group), [symptoms]) || draftGroups.length > 0;
  const grouped = groupBy === 'groups' && (hasGroups || editing);
  const [proposal, setProposal] = useState(null); // suggested grouping being previewed in Edit

  // What is on screen, in on-screen order. Rating, arrows and hover all walk this list.
  const sections = useMemo(
    () => (grouped ? groupSymptoms(activeSymptoms) : [{ name: undefined, rows: activeSymptoms }]),
    [grouped, activeSymptoms]
  );
  const rows = useMemo(
    () => sections.flatMap((sec) => (grouped && collapsed.has(sec.name ?? '')) ? [] : sec.rows),
    [sections, grouped, collapsed]
  );
  // A group of the person's own gets a "flaring" badge when most of it is above its normal on the day viewed
  const thresholds = useMemo(
    () => (grouped && !editing ? flareThresholds(activeSymptoms, entries, new Date()) : null),
    [grouped, editing, activeSymptoms, entries]
  );

  // Keep the focused period valid when tracking mode changes
  useEffect(() => {
    if (!timePeriods.some((p) => p.id === focus.period)) setFocus((f) => ({ ...f, period: defaultPeriod() }));
  }, [timePeriods]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop starts with the first row focused so the keyboard works immediately
  useEffect(() => {
    if (isDesktop && focus.id === null && rows.length > 0) {
      setFocus((f) => ({ ...f, id: rows[0].id }));
    }
  }, [isDesktop, rows, focus.id]);


  const stripKeys = useMemo(() => getStripDateKeys(selectedDate, 14), [dateKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const strips = useMemo(() => {
    if (!isDesktop) return {};
    const out = {};
    activeSymptoms.forEach((s) => { out[s.id] = getSeverityStrip(entries, s.id, stripKeys); });
    return out;
  }, [isDesktop, activeSymptoms, entries, stripKeys]);

  const entryFor = (symptom, periodId) => entries[`${dateKey}-${symptom.id}-${periodId}`];

  const counts = timePeriods.map((p) => {
    const applicable = activeSymptoms.filter((s) => isApplicable(s, p.id));
    return { label: p.label, done: applicable.filter((s) => entryFor(s, p.id)).length, total: applicable.length };
  });
  const hasEntriesToday = counts.some((c) => c.done > 0);

  const advance = useCallback((fromId, periodId, dir = 1) => {
    const from = rows.findIndex((s) => s.id === fromId);
    const idx = stepIndex(rows, from, dir, (s) => isApplicable(s, periodId));
    if (idx >= 0) setFocus({ id: rows[idx].id, period: periodId });
  }, [rows]);

  const rate = (symptom, periodId, severity, { stay = false } = {}) => {
    // Mobile: remember where the rating keys sit on screen so the next row's keys can be scrolled to the same spot
    if (!isDesktop && !stay) {
      const keys = rootRef.current?.querySelector('.lr-row.open .lr-keys');
      if (keys) thumbAnchor.current = { top: keys.getBoundingClientRect().top, at: Date.now() };
    }
    // Filling a blank jumps to the next blank slot below; correcting an existing value stays on the row
    const wasBlank = !entryFor(symptom, periodId);
    quickLog(symptom.id, severity, periodId);
    if (stay || !wasBlank) return;
    const from = rows.findIndex((s) => s.id === symptom.id);
    const idx = nextIndexBelow(rows, from, (s) => isApplicable(s, periodId) && !entryFor(s, periodId));
    if (idx >= 0) setFocus({ id: rows[idx].id, period: periodId });
  };

  // After a mobile rating advances to the next row, scroll so its keys land under the thumb
  useLayoutEffect(() => {
    const anchor = thumbAnchor.current;
    thumbAnchor.current = null;
    if (!anchor || Date.now() - anchor.at > 500) return;
    const keys = rootRef.current?.querySelector('.lr-row.open .lr-keys');
    if (!keys) return;
    let scroller = keys.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const delta = keys.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 1) (scroller || window).scrollBy({ top: delta, behavior: 'smooth' });
  }, [focus.id, focus.period]);

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
      const symptom = rows.find((s) => s.id === focus.id);
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

  // ---- Groups ----
  // A group lives on its symptoms (`group` + `groupOrder`), so every change here is a patch to symptoms
  const groupOrderOf = (name) => {
    const member = symptoms.find((s) => s.group === name && typeof s.groupOrder === 'number');
    return member ? member.groupOrder : nextGroupOrder(symptoms);
  };
  const setGroup = (ids, name, { suggested = false } = {}) => {
    const idSet = new Set(ids);
    const patch = name ? { group: name, groupOrder: groupOrderOf(name) } : { group: null };
    setSymptoms((prev) => prev.map((s) => (idSet.has(s.id) ? applySymptomPatch(s, patch) : s)));
    if (name) setDraftGroups((prev) => prev.filter((g) => g !== name));
    if (name && !hasGroups) setGroupBy('groups');
    setSuggestedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (suggested ? next.add(id) : next.delete(id)));
      return next;
    });
  };
  const groupExists = (name) => [...groupNames(symptoms), ...draftGroups].some((g) => g.toLowerCase() === name.toLowerCase());
  const renameGroup = (from, raw) => {
    const to = raw.trim();
    if (!to || to === from) return;
    if (groupExists(to) && to.toLowerCase() !== from.toLowerCase()) { setLastAction(`A group called ${to} already exists`); return; }
    if (draftGroups.includes(from)) { setDraftGroups((prev) => prev.map((g) => (g === from ? to : g))); return; }
    setSymptoms((prev) => prev.map((s) => (s.group === from ? applySymptomPatch(s, { group: to }) : s)));
    setLastAction(`Renamed ${from} to ${to}`);
  };
  const deleteGroup = (name) => {
    setDraftGroups((prev) => prev.filter((g) => g !== name));
    const members = symptoms.filter((s) => s.group === name).map((s) => s.id);
    if (members.length > 0) { setGroup(members, null); setLastAction(`${name} removed. Its symptoms are ungrouped, nothing was deleted`); }
  };
  const addGroup = (raw) => {
    setAddingGroup(false);
    const name = raw.trim();
    if (!name) return;
    if (groupExists(name)) { setLastAction(`A group called ${name} already exists`); return; }
    setDraftGroups((prev) => [...prev, name]);
    if (!hasGroups) setGroupBy('groups');
  };
  // An empty group only lives while Edit is open
  useEffect(() => { if (!editing) setDraftGroups([]); }, [editing]);
  const commitGroupReorder = (fromName, toName) => {
    const names = reorder(groupNames(symptoms), fromName, toName);
    setSymptoms((prev) => prev.map((s) => {
      const i = names.indexOf(s.group);
      return i === -1 || s.groupOrder === i ? s : applySymptomPatch(s, { groupOrder: i });
    }));
    haptic('medium');
  };
  // Suggestion box: flare history first, names for the rest. Nothing changes until Apply.
  const openProposal = () => {
    const active = symptoms.filter((s) => s.active).sort((a, b) => (a.order || 0) - (b.order || 0));
    setProposal(suggestGrouping(active, entries, new Date(), availableGroups(symptoms, draftGroups)));
  };
  // replace = false files only what is still ungrouped; replace = true re-files everything the way the proposal has it
  const applyProposal = (replace) => {
    const existing = groupNames(symptoms);
    const orderFor = new Map();
    let next = replace ? 0 : nextGroupOrder(symptoms);
    proposal.forEach((g) => {
      const member = !replace && symptoms.find((s) => s.group === g.name && typeof s.groupOrder === 'number');
      orderFor.set(g.name, member ? member.groupOrder : next++);
    });
    const target = new Map();
    proposal.forEach((g) => g.rows.forEach((r) => target.set(r.id, g.name)));
    setSymptoms((prev) => prev.map((s) => {
      if (!s.active) return s;
      if (!replace && s.group) return s;
      const name = target.get(s.id);
      if (!name) return replace && s.group ? applySymptomPatch(s, { group: null }) : s;
      return applySymptomPatch(s, { group: name, groupOrder: orderFor.get(name) });
    }));
    const count = [...target.keys()].filter((id) => replace || !symptoms.find((s) => s.id === id)?.group).length;
    setSuggestedIds(new Set([...target.keys()]));
    setProposal(null);
    setGroupBy('groups');
    setLastAction(replace && existing.length > 0
      ? 'Replaced your groups with the suggestion. Rename or move anything you like'
      : `Grouped ${count} symptom${count === 1 ? '' : 's'}. Rename or move anything you like`);
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
    // Once groups are in use, a new symptom is filed by its name. It is only a suggestion (marked ✦).
    const suggestion = groupNames(symptoms).length > 0 ? suggestGroup(name, '', availableGroups(symptoms, draftGroups)) : null;
    if (suggestion) {
      symptom.group = suggestion;
      symptom.groupOrder = groupOrderOf(suggestion);
      setDraftGroups((prev) => prev.filter((g) => g !== suggestion));
      setSuggestedIds((prev) => new Set([...prev, symptom.id]));
    }
    symptom.history = [createSymptomHistoryEntry(symptom)];
    setSymptoms((prev) => [...prev, symptom]);
    setLastAction(suggestion ? `Symptom added to ${suggestion} (suggested)` : 'Symptom added');
  };

  const revertTo = (symptom, historyIndex) => {
    const state = reconstructSymptomStateAtEntry(symptom.history || [], historyIndex);
    if (!state) return;
    patchSymptom(symptom.id, { name: state.name || symptom.name, description: state.description || '' });
    setLastAction(`Reverted ${symptom.name}`);
  };

  const commitReorder = (fromId, toId, dragGroup) => {
    if (dragGroup === 'groups') { commitGroupReorder(fromId, toId); return; }
    // Dropped on a group header: join that group (at its end). Dropped on a symptom: join its group, next to it.
    const header = toId.startsWith('group:') ? toId.slice(6) : null;
    const target = header === null ? symptoms.find((s) => s.id === toId) : null;
    if (grouped) {
      const name = header !== null ? (header || null) : (target?.group || null);
      if ((symptoms.find((s) => s.id === fromId)?.group || null) !== name) setGroup([fromId], name);
    }
    if (target) {
      const ids = reorder(orderedActive.map((s) => s.id), fromId, toId);
      setSymptoms((prev) => prev.map((s) => {
        const i = ids.indexOf(s.id);
        return i === -1 || s.order === i ? s : { ...s, order: i };
      }));
    }
    haptic('medium');
  };

  const { gripProps, rowClass: dragClass } = useReorderDrag(commitReorder);

  // Group menu on every edit row: groups in use, unused defaults, New group…, Ungrouped
  const renderGroupSelect = (symptom) => (namingFor === symptom.id ? (
    <DraftInput className="lr-input boxed lr-gname" value="" placeholder="Group name" autoFocus
      onCommit={(v) => { setNamingFor(null); const name = v.trim(); if (name) setGroup([symptom.id], groupNames(symptoms).find((g) => g.toLowerCase() === name.toLowerCase()) || name); }}
      onAbandon={() => setNamingFor(null)} />
  ) : (
    <span className="lr-gselect" style={{ '--c': groupColor(symptom.group) }}>
      <i />
      <select
        value={symptom.group || ''}
        aria-label={`Group for ${symptom.name}`}
        onChange={(e) => (e.target.value === NEW_GROUP ? setNamingFor(symptom.id) : setGroup([symptom.id], e.target.value || null))}
      >
        {availableGroups(symptoms, draftGroups).map((g) => <option key={g} value={g}>{g}</option>)}
        <option value="">Ungrouped</option>
        <option value={NEW_GROUP}>New group…</option>
      </select>
      {suggestedIds.has(symptom.id) && <em title="Suggested from the name. Change it here if it is wrong.">✦</em>}
    </span>
  ));

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
            {hidden ? <span /> : renderGroupSelect(symptom)}
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
            {!isDesktop && !hidden && <div className="lr-prow"><span>Group</span>{renderGroupSelect(symptom)}</div>}
            {!isDesktop && timePeriods.length > 1 && <div className="lr-prow"><span>Tracked in</span>{toggles}</div>}
            {renderLog(symptom)}
            {!isDesktop && <div className="lr-prow">{actions}</div>}
          </div>
        )}
      </div>
    );
  };

  // ---- Render ----
  const rootClass = `lr sym ${isDesktop ? 'desktop' : 'mobile'} ${editing ? 'edit' : ''}`;
  const rootStyle = { '--lr-periods': timePeriods.length };

  // Scope + actions live in the nav's context bar (desktop) or the second row of the mobile top bar
  const toggleEdit = () => { setEditing(!editing); setExpandedId(null); setNamingFor(null); setAddingGroup(false); setProposal(null); };
  const ungroupedIds = new Set(symptoms.filter((s) => s.active && !s.group).map((s) => s.id));
  const proposalFiles = proposal ? proposal.flatMap((g) => g.rows).filter((r) => ungroupedIds.has(r.id)).length : 0;
  const proposalPanel = proposal && (
    <div className="lr-suggest">
      <div className="lr-suggest-head">
        <b>Suggested grouping</b>
        <small>Nothing changes until you apply it. You can rename or move anything afterwards.</small>
      </div>
      {proposal.length === 0 ? (
        <p>No suggestion yet. There is not enough flare history, and none of the names match Gut, Mood, Nerve &amp; pain or Skin.</p>
      ) : proposal.map((g) => (
        <div className="lr-suggest-row" key={g.name} style={{ '--c': groupColor(g.name) }}>
          <i /><b>{g.name}</b>
          <span>{g.rows.map((r) => r.name).join(' · ')}</span>
          <small>{g.source === 'history' ? 'from your flare history' : 'from the name'}</small>
        </div>
      ))}
      <div className="lr-suggest-acts">
        {hasGroups && proposal.length > 0 && (
          <small>{proposalFiles === 0
            ? 'Everything this can place is already in one of your groups.'
            : `Apply files the ${proposalFiles} symptom${proposalFiles === 1 ? '' : 's'} you have not grouped. Your own groups stay as they are.`}</small>
        )}
        <span className="lr-spacer" />
        <button className="dn-btn" onClick={() => setProposal(null)}>Dismiss</button>
        {hasGroups && proposal.length > 0 && <button className="dn-btn" onClick={() => { if (confirm('Replace your current groups with this suggestion? Symptoms and their history are not affected.')) applyProposal(true); }}>Replace my groups</button>}
        {proposal.length > 0 && <button className="dn-btn primary" disabled={hasGroups && proposalFiles === 0} onClick={() => applyProposal(!hasGroups)}>Apply</button>}
      </div>
    </div>
  );
  const groupByControl = (
    <div className={`dn-seg ${isDesktop ? 'sm' : ''} lr-groupby`} role="group" aria-label="Group symptoms by">
      <button className={grouped ? '' : 'on'} onClick={() => setGroupBy('order')}>Order</button>
      <button className={grouped ? 'on' : ''} onClick={() => setGroupBy('groups')}>Groups</button>
    </div>
  );
  const bar = barSlot ? createPortal(
    <>
      {editing ? <span className="dn-progress"><b>{orderedActive.length}</b> active</span> : counts.map((c) => (
        <span className="dn-progress" key={c.label}>
          {timePeriods.length > 1 ? c.label : 'Logged'} <b>{c.done}/{c.total}</b>
          <i style={{ '--p': `${c.total ? (c.done / c.total) * 100 : 0}%` }} />
        </span>
      ))}
      {isDesktop && (hasGroups || editing) && groupByControl}
      <span className="lr-spacer" />
      {editing && <button className={`dn-btn ${proposal ? 'on' : ''}`} onClick={() => (proposal ? setProposal(null) : openProposal())}>Suggest grouping</button>}
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
            <div /><div>NAME AND DESCRIPTION</div><div>GROUP</div>
            {timePeriods.length > 1 ? <div className="c" style={{ gridColumn: `span ${timePeriods.length}` }}>TRACKED IN</div> : <div />}
            <div />
          </div>
        )}
        {!isDesktop && groupByControl}
        {proposal && proposalPanel}
        {grouped ? groupSymptoms(orderedActive, draftGroups).map((sec) => {
          const key = sec.name ?? '';
          const draft = sec.name !== null && sec.rows.length === 0;
          return (
            <div key={`g-${key}`}>
              <div
                className={`lr-ghead edit ${sec.name !== null && !draft ? dragClass(sec.name) : ''}`}
                style={{ '--c': groupColor(sec.name) }}
                data-reorder-id={`group:${key}`} data-reorder-group="default"
              >
                {/* a second, inner target so group headers can also be reordered among themselves */}
                <span className="lr-ghead-in" data-reorder-id={sec.name !== null && !draft ? sec.name : undefined} data-reorder-group={sec.name !== null && !draft ? 'groups' : undefined}>
                  {sec.name !== null && !draft ? <span className="lr-grip" {...gripProps(sec.name, 'groups')}>⠿</span> : <span className="lr-grip" style={{ visibility: 'hidden' }}>⠿</span>}
                  <i />
                  {sec.name === null
                    ? <b>Ungrouped</b>
                    : <DraftInput className="lr-input lr-gname" value={sec.name} placeholder="Group name" onCommit={(v) => renameGroup(sec.name, v)} />}
                  <small>{draft ? 'Empty. Drag a symptom here, or pick it from a symptom\'s Group menu' : `${sec.rows.length} symptom${sec.rows.length === 1 ? '' : 's'}`}</small>
                  {sec.name !== null && <button className="lr-link" onClick={() => deleteGroup(sec.name)}>{draft ? 'Remove' : 'Delete group'}</button>}
                </span>
              </div>
              {sec.rows.map((s) => renderEditRow(s, false))}
            </div>
          );
        }) : orderedActive.map((s) => renderEditRow(s, false))}
        {grouped && (addingGroup ? (
          <div className="lr-row lr-cols lr-add">
            <span className="lr-grip" style={{ cursor: 'default' }}>+</span>
            <div className="lr-fields">
              <DraftInput className="lr-input name" value="" placeholder="New group name" autoFocus onCommit={addGroup} onAbandon={() => setAddingGroup(false)} />
            </div>
          </div>
        ) : (
          <div className="lr-row lr-cols lr-add" onClick={() => setAddingGroup(true)}>
            <span className="lr-grip" style={{ cursor: 'pointer' }}>+</span><div>Add group</div>
          </div>
        ))}
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
    <div ref={rootRef} className={rootClass} style={rootStyle}>
      {bar}
      {activeSymptoms.length === 0 ? (
        <div className="lr-empty">{symptomSearch ? `No symptoms match "${symptomSearch}"` : 'No symptoms yet. Use Edit symptoms to add one.'}</div>
      ) : (
        <>
          {!isDesktop && hasGroups && groupByControl}
          <div className="lr-head lr-cols">
            <div />
            {isDesktop && <div className="strip-h">LAST 14 DAYS</div>}
            {timePeriods.map((p) => <div className="c" key={p.id}>{timePeriods.length > 1 ? p.label : 'TODAY'}</div>)}
          </div>
          {sections.map((sec) => {
            const key = sec.name ?? '';
            const folded = grouped && collapsed.has(key);
            const slots = sec.rows.filter((s) => isApplicable(s, focus.period));
            const badge = grouped && sec.name && thresholds ? flaringBadge(sec.rows, thresholds, entries, selectedDate) : null;
            const header = grouped && (
              <div key={`h-${key}`} className={`lr-ghead ${folded ? 'folded' : ''}`} style={{ '--c': groupColor(sec.name) }} onClick={() => toggleCollapsed(key)}>
                <i /><b>{sec.name ?? 'Ungrouped'}</b>
                {badge && <em className="lr-gbadge">{badge}</em>}
                <span>{slots.filter((s) => entryFor(s, focus.period)).length}/{slots.length} logged</span>
                <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
              </div>
            );
            return [header, ...(folded ? [] : sec.rows.map((symptom) => {
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
                // Desktop: the row under the mouse is the selected row. Uses mousemove, not mouseenter, so rows
                // sliding under a resting cursor (scrolling, arrow keys) don't steal the keyboard selection.
                onMouseMove={isDesktop && !open ? () => {
                  const period = isApplicable(symptom, focus.period) ? focus.period : timePeriods.find((p) => isApplicable(symptom, p.id)).id;
                  setFocus({ id: symptom.id, period });
                } : undefined}
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
                {/* Desktop: while a row is open, the rating keys take the chart's place on the same row */}
                {isDesktop && open && isApplicable(symptom, focus.period) && (
                  <div className="lr-ikeys" onClick={(e) => e.stopPropagation()}>
                    {[...SEVERITIES, NA_SEVERITY].map((n) => {
                      const selected = current?.severity === n;
                      return (
                        <button
                          key={n}
                          className={`${n === NA_SEVERITY ? 'na' : ''} ${selected ? 'on' : lastSeverity === n ? 'last' : ''}`}
                          style={n === NA_SEVERITY ? undefined : { '--c': STRIP_COLOR[n], '--bg': SEV_BG[n], '--fg': SEV_FG[n] }}
                          title={selected ? 'Click again to clear' : lastSeverity === n ? 'Last time' : undefined}
                          onClick={() => (selected ? clearEntry(symptom, focus.period) : rate(symptom, focus.period, n, { stay: true }))}
                        >
                          {n === NA_SEVERITY ? 'N/A' : n}
                        </button>
                      );
                    })}
                  </div>
                )}
                {isDesktop && !(open && isApplicable(symptom, focus.period)) && (
                  <div className="lr-strip sev" title="Open history" onClick={(e) => { e.stopPropagation(); onOpenGraph?.(symptom.id); }}>
                    {(strips[symptom.id] || []).map((v, i) => (
                      <i key={i} className={v === null ? '' : 'v'} style={v === null ? undefined : { background: STRIP_COLOR[Math.round(v)] }} />
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
                {!isDesktop && open && currentPeriod && isApplicable(symptom, focus.period) && (
                  <div className="lr-keys" onClick={(e) => e.stopPropagation()}>
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
                    <button className="lr-key wide" onClick={() => onOpenGraph?.(symptom.id)}>History</button>
                  </div>
                )}
              </div>
            );
            }))];
          })}
          {isDesktop && (
            <div className="lr-hintbar">
              <span><i className="lr-lastdot" />last time</span>
              <span><kbd>0</kbd>–<kbd>5</kbd> rate</span>
              <span><kbd>N</kbd> n/a</span>
              <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
              {timePeriods.length > 1 ? (
                <>
                  <span><kbd>←</kbd><kbd>→</kbd> {timePeriods.map((p) => p.label).join('/')}</span>
                  <span><kbd>[</kbd><kbd>]</kbd> day</span>
                </>
              ) : (
                <span><kbd>←</kbd><kbd>→</kbd> day</span>
              )}
              <span><kbd>⌫</kbd> clear</span>
              <span><kbd>E</kbd> edit</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
