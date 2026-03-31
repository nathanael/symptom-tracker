import { useState, useRef, useEffect } from 'react';
import { severityColors, trackingModes, HOLD_DELAY, DRAG_SENSITIVITY, NA_SEVERITY } from '../utils/constants';
import { getDateKey, haptic, getSymptomTrend } from '../utils/helpers';
import SymptomEdit from './SymptomEdit';
import HealthScoreCard from './HealthScoreCard';
import { useHealthScore } from '../hooks/useHealthScore';

export default function SymptomList({
  symptoms,
  setSymptoms,
  activeSymptoms,
  entries,
  setEntries,
  selectedDate,
  trackingMode,
  timePeriods,
  pinnedSymptoms,
  setPinnedSymptoms,
  quickLogSymptom,
  setQuickLogSymptom,
  quickLogTime,
  setQuickLogTime,
  quickLog,
  setLastAction,
  symptomSearch,
  setSymptomSearch,
  searchVisible,
  setSearchVisible,
  showAddSymptom,
  setShowAddSymptom,
  getSymptomEntries,
  getMostRecentEntry,
  getCurrentTimePeriod,
  trendWindow,
  flashColumn,
  onOpenGraph,
  isDesktop,
  // Desktop inline action handlers
  onRapidEntry,
  onEditNote,
  onCopyData,
  copyDays,
  setCopyDays,
  onEditSymptoms,
}) {
  // Drag state for hold-to-edit
  const [activeSymptom, setActiveSymptom] = useState(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [fingerPosition, setFingerPosition] = useState({ x: 0, y: 0 });

  // Edit symptom state
  const [editingSymptomFullId, setEditingSymptomFullId] = useState(null);
  const [newSymptomName, setNewSymptomName] = useState('');
  const [newSymptomDescription, setNewSymptomDescription] = useState('');
  const [showHiddenSymptoms, setShowHiddenSymptoms] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const manageScrollRef = useRef(null);

  // Drag reorder state
  const [dragReorderId, setDragReorderId] = useState(null);
  const [dragReorderY, setDragReorderY] = useState(0);
  const dragReorderStartY = useRef(0);
  const dragReorderItemRects = useRef([]);

  // Popup position state
  const [popupPosition, setPopupPosition] = useState(null);

  // Desktop copy days dropdown
  const [showCopyDropdown, setShowCopyDropdown] = useState(false);

  // Refs
  const containerRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const holdTimerRef = useRef(null);
  const pendingSymptomRef = useRef(null);
  const isDraggingRef = useRef(false);
  const movedDuringHoldRef = useRef(false);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (showAddSymptom) {
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [showAddSymptom]);

  // Hold-to-edit handlers
  const enterEditMode = (symptomId, clientX, clientY) => {
    haptic('medium');

    const screenHeight = window.innerHeight;
    const relativeY = clientY / screenHeight;
    let initialSeverity;
    if (relativeY < 0.25) {
      initialSeverity = 5;
    } else if (relativeY > 0.75) {
      initialSeverity = 0;
    } else {
      initialSeverity = 2;
    }

    let clampedTimeIndex = 0;
    if (trackingMode !== 'simple') {
      const screenWidth = window.innerWidth;
      const numPeriods = timePeriods.length;
      const timeIndex = Math.floor((clientX / screenWidth) * numPeriods);
      clampedTimeIndex = Math.max(0, Math.min(numPeriods - 1, timeIndex));
    }

    setActiveSymptom(symptomId);
    setDragPosition({ x: clampedTimeIndex, y: initialSeverity });
    isDraggingRef.current = true;
    setIsDragging(true);
    pendingSymptomRef.current = null;
  };

  const handleTouchStart = (e, symptomId) => {
    const touch = e.touches[0];
    startPosRef.current = { x: touch.clientX, y: touch.clientY };
    setFingerPosition({ x: touch.clientX, y: touch.clientY });
    pendingSymptomRef.current = symptomId;
    movedDuringHoldRef.current = false;

    holdTimerRef.current = setTimeout(() => {
      if (pendingSymptomRef.current === symptomId) {
        if (!movedDuringHoldRef.current && onOpenGraph) {
          // Hold without drag → open graph
          haptic('medium');
          onOpenGraph(symptomId);
          pendingSymptomRef.current = null;
        } else {
          // Hold with drag → severity edit mode
          enterEditMode(symptomId, touch.clientX, touch.clientY);
        }
      }
    }, HOLD_DELAY);
  };


  const handleMove = (clientX, clientY) => {
    if (pendingSymptomRef.current && !isDragging) {
      const deltaX = Math.abs(clientX - startPosRef.current.x);
      const deltaY = Math.abs(clientY - startPosRef.current.y);

      // Track if finger moved enough to be a drag
      if (deltaX > 5 || deltaY > 5) {
        movedDuringHoldRef.current = true;
      }

      // Cancel hold entirely if finger moves too far (scrolling)
      if (deltaX > 10 || deltaY > 10) {
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        pendingSymptomRef.current = null;
      }
      return;
    }

    if (!isDragging || !activeSymptom) return;

    setFingerPosition({ x: clientX, y: clientY });

    let timeIndex = 0;
    if (trackingMode !== 'simple') {
      const screenWidth = window.innerWidth;
      const numPeriods = timePeriods.length;
      timeIndex = Math.floor((clientX / screenWidth) * numPeriods);
      timeIndex = Math.max(0, Math.min(numPeriods - 1, timeIndex));
    }

    const deltaY = startPosRef.current.y - clientY;
    let severityDelta = Math.round(deltaY / DRAG_SENSITIVITY);

    const screenHeight = window.innerHeight;
    const relativeStartY = startPosRef.current.y / screenHeight;
    let baseSeverity;
    if (relativeStartY < 0.25) {
      baseSeverity = 5;
    } else if (relativeStartY > 0.75) {
      baseSeverity = 0;
    } else {
      baseSeverity = 2;
    }

    let severityIndex = baseSeverity + severityDelta;
    severityIndex = Math.max(0, Math.min(5, severityIndex));

    setDragPosition({ x: timeIndex, y: severityIndex });
  };

  const handleEnd = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    pendingSymptomRef.current = null;

    if (isDragging && activeSymptom) {
      haptic('success');

      const dateKey = getDateKey(selectedDate);
      const timeId = timePeriods[dragPosition.x].id;
      const severity = dragPosition.y;
      const key = `${dateKey}-${activeSymptom}-${timeId}`;

      setEntries(prev => ({
        ...prev,
        [key]: { time: timeId, severity, date: dateKey, symptomId: activeSymptom }
      }));

      const symptom = symptoms.find(s => s.id === activeSymptom);
      setLastAction(`${symptom?.name}: ${timePeriods[dragPosition.x].label}, ${severity}`);
    }
    isDraggingRef.current = false;
    setIsDragging(false);
    setActiveSymptom(null);
  };

  // Create history entry for symptom
  const createSymptomHistoryEntry = (symptom) => {
    return {
      timestamp: new Date().toISOString(),
      type: 'created',
      snapshot: {
        name: symptom.name,
        description: symptom.description || '',
        active: symptom.active
      }
    };
  };

  // Record symptom history change
  const recordSymptomHistoryChange = (symptom, newValues) => {
    const changes = {};
    const fields = ['name', 'description', 'active'];

    for (const field of fields) {
      if (JSON.stringify(symptom[field]) !== JSON.stringify(newValues[field])) {
        changes[field] = { from: symptom[field], to: newValues[field] };
      }
    }

    if (Object.keys(changes).length === 0) return null;

    return {
      timestamp: new Date().toISOString(),
      type: 'updated',
      changes
    };
  };

  // Symptom management
  const addSymptom = () => {
    const name = newSymptomName.trim();
    if (!name) return;

    const existing = symptoms.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!existing.active) {
        setSymptoms(prev => prev.map(s => {
          if (s.id !== existing.id) return s;
          const newValues = { ...s, active: true, description: newSymptomDescription.trim() || s.description };
          const historyEntry = recordSymptomHistoryChange(s, newValues);
          const history = s.history || [];
          return {
            ...newValues,
            history: historyEntry ? [...history, historyEntry] : history
          };
        }));
        setLastAction('Symptom restored');
      } else {
        setLastAction('Symptom already exists');
        return;
      }
    } else {
      const id = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now() + Math.random();
      const minOrder = Math.min(0, ...symptoms.map(s => s.order || 0));
      const newSymptom = {
        id,
        name,
        description: newSymptomDescription.trim() || undefined,
        active: true,
        order: minOrder - 1,
      };
      newSymptom.history = [createSymptomHistoryEntry(newSymptom)];
      setSymptoms(prev => [...prev, newSymptom]);
      setLastAction('Symptom added');
    }

    setNewSymptomName('');
    setNewSymptomDescription('');
  };

  const removeSymptom = (symptomId) => {
    setSymptoms(prev => prev.map(s => {
      if (s.id !== symptomId) return s;
      const newValues = { ...s, active: false };
      const historyEntry = recordSymptomHistoryChange(s, newValues);
      const history = s.history || [];
      return {
        ...newValues,
        history: historyEntry ? [...history, historyEntry] : history
      };
    }));
    setLastAction('Symptom hidden (history preserved)');
  };

  const reactivateSymptom = (symptomId) => {
    setSymptoms(prev => prev.map(s => {
      if (s.id !== symptomId) return s;
      const newValues = { ...s, active: true };
      const historyEntry = recordSymptomHistoryChange(s, newValues);
      const history = s.history || [];
      return {
        ...newValues,
        history: historyEntry ? [...history, historyEntry] : history
      };
    }));
    setLastAction('Symptom restored');
  };

  const handleSymptomSave = (updatedData) => {
    if (updatedData.name.trim() && editingSymptomFullId) {
      setSymptoms(prev => prev.map(s => {
        if (s.id !== editingSymptomFullId) return s;

        const newValues = {
          name: updatedData.name.trim(),
          description: updatedData.description.trim() || undefined,
          active: s.active
        };

        const historyEntry = recordSymptomHistoryChange(s, newValues);
        const history = s.history || [];

        const updated = {
          ...s,
          ...newValues,
          history: historyEntry ? [...history, historyEntry] : history
        };

        // Handle applicablePeriods
        if (updatedData.applicablePeriods) {
          updated.applicablePeriods = updatedData.applicablePeriods;
        } else {
          delete updated.applicablePeriods;
        }

        return updated;
      }));
      setLastAction('Symptom updated');
    }
    setEditingSymptomFullId(null);
  };

  const inactiveSymptoms = symptoms.filter(s => !s.active);

  // Autocomplete suggestions from hidden symptoms
  const suggestions = inactiveSymptoms.filter(s =>
    newSymptomName.trim() &&
    s.name.toLowerCase().includes(newSymptomName.toLowerCase())
  );

  // Drag reorder handlers
  const handleDragStart = (e, symptomId, itemRects) => {
    e.stopPropagation();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragReorderStartY.current = clientY;
    dragReorderItemRects.current = itemRects;
    setDragReorderId(symptomId);
    setDragReorderY(0);
    haptic('light');
  };

  const handleDragMove = (e) => {
    if (!dragReorderId) return;
    e.preventDefault();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    setDragReorderY(clientY - dragReorderStartY.current);
  };

  const handleDragEnd = () => {
    if (!dragReorderId) return;

    const activeList = symptoms.filter(s => s.active).sort((a, b) => (a.order || 0) - (b.order || 0));
    const currentIndex = activeList.findIndex(s => s.id === dragReorderId);

    // Calculate new position based on drag distance
    const itemHeight = 52; // approximate row height
    const moveBy = Math.round(dragReorderY / itemHeight);
    const newIndex = Math.max(0, Math.min(activeList.length - 1, currentIndex + moveBy));

    if (newIndex !== currentIndex) {
      // Reorder the list
      const newList = [...activeList];
      const [moved] = newList.splice(currentIndex, 1);
      newList.splice(newIndex, 0, moved);

      // Update order values
      setSymptoms(prev => prev.map(s => {
        const newOrderIndex = newList.findIndex(item => item.id === s.id);
        if (newOrderIndex !== -1) {
          return { ...s, order: newOrderIndex };
        }
        return s;
      }));
      haptic('medium');
    }

    setDragReorderId(null);
    setDragReorderY(0);
  };

  const { score, loggedCount, totalActive, rollingAvg, delta } = useHealthScore(selectedDate, { symptoms, entries, trackingMode });

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
      }}
    >
      {/* Desktop: Search + inline actions bar */}
      {isDesktop && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '16px',
        }}>
          {/* Search — ~25% width */}
          <div style={{ position: 'relative', width: '25%', minWidth: '180px', flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={symptomSearch}
              onChange={(e) => setSymptomSearch(e.target.value)}
              placeholder="Search..."
              style={{
                width: '100%',
                padding: '8px 32px 8px 34px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                color: '#f8fafc',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {symptomSearch && (
              <button
                onClick={() => setSymptomSearch('')}
                style={{
                  position: 'absolute',
                  right: '6px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: '14px',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}
              >
                ×
              </button>
            )}
          </div>

          {/* Actions — fill remaining space, right-aligned */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
            {/* AM/PM pill toggle + Rapid Entry attached */}
            {(() => {
              const current = trackingMode === 'ampm' ? (quickLogTime || getCurrentTimePeriod()) : null;
              const hasAmPm = trackingMode === 'ampm';
              return (
                <div style={{
                  position: 'relative', flexShrink: 0,
                }}>
                  {/* Rapid Entry — the full-width background layer */}
                  <button
                    onClick={onRapidEntry}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: hasAmPm ? '6px 12px 6px 100px' : '6px 12px',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      borderRadius: '20px',
                      color: '#9ca3af', fontSize: '12px', fontWeight: '500',
                      cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease',
                      height: '32px',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.color = '#e5e7eb'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.color = '#9ca3af'; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#facc15" stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    Rapid Entry
                  </button>
                  {/* AM/PM pill — positioned on top, covering the left portion */}
                  {hasAmPm && (
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      position: 'absolute', left: 0, top: 0, bottom: 0,
                      border: '1px solid rgba(139, 92, 246, 0.3)',
                      borderRadius: '20px',
                      overflow: 'hidden',
                      background: 'rgba(17, 18, 22, 0.98)',
                    }}>
                      <button
                        onClick={() => setQuickLogTime('morning')}
                        style={{
                          padding: '0 14px', border: 'none', height: '100%',
                          background: current === 'morning' ? 'rgba(139, 92, 246, 0.25)' : 'transparent',
                          color: current === 'morning' ? '#c4b5fd' : '#6b7280',
                          fontSize: '12px', fontWeight: '700', letterSpacing: '0.03em',
                          cursor: 'pointer', transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => { if (current !== 'morning') { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#9ca3af'; } }}
                        onMouseLeave={(e) => { if (current !== 'morning') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b7280'; } }}
                      >
                        AM
                      </button>
                      <div style={{ width: '1px', alignSelf: 'stretch', margin: '6px 0', background: 'rgba(139, 92, 246, 0.2)' }} />
                      <button
                        onClick={() => setQuickLogTime('evening')}
                        style={{
                          padding: '0 14px', border: 'none', height: '100%',
                          background: current === 'evening' ? 'rgba(139, 92, 246, 0.25)' : 'transparent',
                          color: current === 'evening' ? '#c4b5fd' : '#6b7280',
                          fontSize: '12px', fontWeight: '700', letterSpacing: '0.03em',
                          cursor: 'pointer', transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => { if (current !== 'evening') { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#9ca3af'; } }}
                        onMouseLeave={(e) => { if (current !== 'evening') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6b7280'; } }}
                      >
                        PM
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Edit Note */}
            <button
              onClick={onEditNote}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '6px 10px', background: 'transparent',
                border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px',
                color: '#9ca3af', fontSize: '12px', fontWeight: '500',
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#e5e7eb'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#9ca3af'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              Today's Notes
            </button>

            {/* Edit Symptoms */}
            <button
              onClick={onEditSymptoms}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '6px 10px', background: 'transparent',
                border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px',
                color: '#9ca3af', fontSize: '12px', fontWeight: '500',
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#e5e7eb'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#9ca3af'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              Edit Symptoms
            </button>

            {/* Copy — with adjustable days dropdown */}
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={onCopyData}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '6px 6px 6px 10px', background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px 0 0 6px',
                    borderRight: 'none',
                    color: '#9ca3af', fontSize: '12px', fontWeight: '500',
                    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#e5e7eb'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  Copy tracking data for {copyDays} days
                </button>
                <button
                  onClick={() => setShowCopyDropdown(prev => !prev)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '6px 6px', background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0 6px 6px 0',
                    color: '#9ca3af', cursor: 'pointer', transition: 'all 0.15s ease',
                    minWidth: '24px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#e5e7eb'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              </div>
              {showCopyDropdown && (
                <>
                  <div onClick={() => setShowCopyDropdown(false)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                    background: 'rgba(15,17,21,0.98)', borderRadius: '8px',
                    border: '1px solid rgba(99,102,241,0.3)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                    zIndex: 601, overflow: 'hidden', minWidth: '100px',
                  }}>
                    {[7, 14, 30, 60, 90].map(d => (
                      <button
                        key={d}
                        onClick={() => {
                          setCopyDays(d);
                          setShowCopyDropdown(false);
                        }}
                        style={{
                          display: 'block', width: '100%', padding: '8px 14px',
                          background: d === copyDays ? 'rgba(99,102,241,0.15)' : 'transparent',
                          border: 'none', color: d === copyDays ? '#a5b4fc' : '#e5e7eb',
                          fontSize: '13px', fontWeight: d === copyDays ? '600' : '400',
                          cursor: 'pointer', textAlign: 'left',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                        }}
                        onMouseEnter={(e) => { if (d !== copyDays) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                        onMouseLeave={(e) => { if (d !== copyDays) e.currentTarget.style.background = 'transparent'; }}
                      >
                        {d} days
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile: Search Input - pull-to-search */}
      {!isDesktop && searchVisible && (
        <div style={{
          position: 'relative',
          marginBottom: '8px',
          padding: '0 20px',
        }}>
          <input
            type="text"
            value={symptomSearch}
            onChange={(e) => setSymptomSearch(e.target.value)}
            placeholder="Search symptoms..."
            autoFocus
            style={{
              width: '100%',
              padding: '12px 40px 12px 16px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              color: '#f8fafc',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => { setSymptomSearch(''); setSearchVisible(false); }}
            style={{
              position: 'absolute',
              right: '28px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              fontSize: '12px',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* No results */}
      {activeSymptoms.length === 0 && symptomSearch && (
        <div style={{
          padding: '24px 20px',
          textAlign: 'center',
          color: '#6b7280',
          fontSize: '14px',
        }}>
          No symptoms match "{symptomSearch}"
        </div>
      )}

      {/* AM/PM Column Headers - only show in ampm mode, mobile only */}
      {!isDesktop && trackingMode === 'ampm' && activeSymptoms.length > 0 && (() => {
        const currentHour = new Date().getHours();
        const defaultPeriod = currentHour < 12 ? 'morning' : 'evening';
        const activePeriod = quickLogTime || defaultPeriod;
        return (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            padding: '8px 20px',
            position: 'sticky',
            top: 0,
            background: '#08090A',
            zIndex: 10,
          }}>
            <span style={{
              width: '32px',
              textAlign: 'center',
              fontSize: '11px',
              color: '#6b7280',
              opacity: activePeriod === 'morning' ? 1 : 0.25,
            }}>AM</span>
            <span style={{
              width: '32px',
              textAlign: 'center',
              fontSize: '11px',
              color: '#6b7280',
              opacity: activePeriod === 'evening' ? 1 : 0.25,
            }}>PM</span>
          </div>
        );
      })()}

      {/* Desktop: Card grid layout */}
      {isDesktop ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '12px',
        }}>
          {activeSymptoms.map((symptom) => {
            const symptomEntries = getSymptomEntries(symptom.id);
            const isPinned = pinnedSymptoms.has(symptom.id);
            const trend = getSymptomTrend(symptom.id, entries, trendWindow);

            const amEntry = trackingMode === 'ampm' ? symptomEntries.find(e => e.time === 'morning') : null;
            const pmEntry = trackingMode === 'ampm' ? symptomEntries.find(e => e.time === 'evening') : null;
            const maxEntry = trackingMode !== 'ampm' && symptomEntries.length > 0
              ? symptomEntries.reduce((max, e) => e.severity > max.severity ? e : max, symptomEntries[0])
              : null;

            const currentHour = new Date().getHours();
            const defaultPeriod = currentHour < 12 ? 'morning' : 'evening';
            const activePeriod = quickLogTime || defaultPeriod;

            const hasAnyEntry = trackingMode === 'ampm' ? (amEntry || pmEntry) : maxEntry;

            // Sparkline data
            const days = 7;
            const today = new Date();
            const vals = [];
            for (let d = days - 1; d >= 0; d--) {
              const dt = new Date(today);
              dt.setDate(dt.getDate() - d);
              const dk = getDateKey(dt);
              const am = entries[`${dk}-${symptom.id}-morning`];
              const pm = entries[`${dk}-${symptom.id}-evening`];
              const daily = entries[`${dk}-${symptom.id}-daily`];
              const sevs = [];
              if (am && am.severity !== NA_SEVERITY) sevs.push(am.severity);
              if (pm && pm.severity !== NA_SEVERITY) sevs.push(pm.severity);
              if (sevs.length === 0 && daily && daily.severity !== NA_SEVERITY) sevs.push(daily.severity);
              vals.push(sevs.length > 0 ? sevs.reduce((a, b) => a + b, 0) / sevs.length : null);
            }
            const hasSparkData = vals.some(v => v !== null);
            const sparkW = 200, sparkH = 40;
            const nonNullPts = [];
            vals.forEach((v, i) => {
              if (v !== null) nonNullPts.push({ x: (i / (vals.length - 1)) * sparkW, y: sparkH - (v / 5) * sparkH });
            });
            const pathD = nonNullPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('');

            return (
              <div
                key={symptom.id}
                data-symptom-row
                onClick={(e) => {
                  if (quickLogSymptom !== null) {
                    setQuickLogSymptom(null);
                    setPopupPosition(null);
                  } else {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPopupPosition({ top: rect.top, left: rect.left, width: rect.width });
                    setQuickLogSymptom(symptom.id);
                    if (!quickLogTime) setQuickLogTime(getCurrentTimePeriod());
                  }
                }}
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '10px',
                  padding: '18px 16px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '14px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                }}
              >
                {/* Card header: name + badges */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isPinned && <span style={{ color: '#fbbf24', fontSize: '10px' }}>⊙</span>}
                      <span style={{
                        width: '16px',
                        fontSize: '14px',
                        opacity: 0.7,
                        color: trend === 'improving' ? '#4ade80' : '#fbbf24',
                        flexShrink: 0,
                      }}>
                        {trend === 'improving' ? '↓' : trend === 'worsening' ? '↑' : ''}
                      </span>
                      <span style={{
                        color: hasAnyEntry ? '#e5e7eb' : '#9ca3af',
                        fontSize: '15px',
                        fontWeight: '500',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {symptom.name}
                      </span>
                    </div>
                    {symptom.description && (
                      <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '3px', marginLeft: '22px' }}>
                        {symptom.description}
                      </div>
                    )}
                  </div>
                  {/* AM/PM badges — clickable to toggle period */}
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    {trackingMode === 'ampm' ? (
                      <>
                        {/* AM badge */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuickLogTime('morning');
                            const tile = e.currentTarget.closest('[data-symptom-row]');
                            if (tile) {
                              const rect = tile.getBoundingClientRect();
                              setPopupPosition({ top: rect.top, left: rect.left, width: rect.width });
                            }
                            setQuickLogSymptom(symptom.id);
                          }}
                          style={{
                            minWidth: '32px', height: '32px',
                            borderRadius: amEntry ? '6px' : '16px',
                            border: activePeriod === 'morning'
                              ? '1px solid rgba(99, 102, 241, 0.5)'
                              : '1px solid rgba(255,255,255,0.08)',
                            background: activePeriod === 'morning'
                              ? 'rgba(99, 102, 241, 0.12)'
                              : 'rgba(255,255,255,0.02)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '0 6px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {amEntry ? (
                            <span style={{
                              color: amEntry.severity === NA_SEVERITY ? '#64748b' : '#e5e7eb',
                              fontSize: amEntry.severity === NA_SEVERITY ? '10px' : '14px',
                              fontWeight: '600',
                            }}>
                              {amEntry.severity === NA_SEVERITY ? 'N/A' : amEntry.severity}
                            </span>
                          ) : (
                            <span style={{
                              color: activePeriod === 'morning' ? '#a5b4fc' : '#4b5563',
                              fontSize: '11px',
                              fontWeight: '600',
                              letterSpacing: '0.5px',
                            }}>
                              AM
                            </span>
                          )}
                        </div>
                        {/* PM badge */}
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuickLogTime('evening');
                            const tile = e.currentTarget.closest('[data-symptom-row]');
                            if (tile) {
                              const rect = tile.getBoundingClientRect();
                              setPopupPosition({ top: rect.top, left: rect.left, width: rect.width });
                            }
                            setQuickLogSymptom(symptom.id);
                          }}
                          style={{
                            minWidth: '32px', height: '32px',
                            borderRadius: pmEntry ? '6px' : '16px',
                            border: activePeriod === 'evening'
                              ? '1px solid rgba(99, 102, 241, 0.5)'
                              : '1px solid rgba(255,255,255,0.08)',
                            background: activePeriod === 'evening'
                              ? 'rgba(99, 102, 241, 0.12)'
                              : 'rgba(255,255,255,0.02)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '0 6px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {pmEntry ? (
                            <span style={{
                              color: pmEntry.severity === NA_SEVERITY ? '#64748b' : '#e5e7eb',
                              fontSize: pmEntry.severity === NA_SEVERITY ? '10px' : '14px',
                              fontWeight: '600',
                            }}>
                              {pmEntry.severity === NA_SEVERITY ? 'N/A' : pmEntry.severity}
                            </span>
                          ) : (
                            <span style={{
                              color: activePeriod === 'evening' ? '#a5b4fc' : '#4b5563',
                              fontSize: '11px',
                              fontWeight: '600',
                              letterSpacing: '0.5px',
                            }}>
                              PM
                            </span>
                          )}
                        </div>
                      </>
                    ) : maxEntry ? (
                      <div style={{
                        width: '32px', height: '32px', borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.05)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ color: maxEntry.severity === NA_SEVERITY ? '#64748b' : '#e5e7eb', fontSize: maxEntry.severity === NA_SEVERITY ? '10px' : '14px', fontWeight: '600' }}>
                          {maxEntry.severity === NA_SEVERITY ? 'N/A' : maxEntry.severity}
                        </span>
                      </div>
                    ) : (
                      <div style={{
                        width: '32px', height: '32px', borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sparkline — full tile width */}
                {hasSparkData && (
                  <div
                    style={{ cursor: 'pointer', margin: '0 -10px -6px 0' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onOpenGraph) onOpenGraph(symptom.id);
                    }}
                  >
                    <svg width="100%" height={sparkH} viewBox={`0 0 ${sparkW} ${sparkH}`} preserveAspectRatio="none" style={{ display: 'block' }}>
                      <path d={pathD} fill="none" stroke="rgba(139, 92, 246, 0.5)" strokeWidth="1.5" />
                    </svg>
                  </div>
                )}

                {/* Quick log popup for this card */}
                {quickLogSymptom === symptom.id && popupPosition && (() => {
                  const popupHeight = 120;
                  const bottomSafeZone = 200;
                  const windowHeight = window.innerHeight;
                  const wouldOverlap = popupPosition.top + popupHeight > windowHeight - bottomSafeZone;
                  const adjustedTop = wouldOverlap ? Math.max(100, popupPosition.top - popupHeight - 10) : popupPosition.top;

                  return (
                    <>
                      <div
                        onClick={(e) => { e.stopPropagation(); setQuickLogSymptom(null); setPopupPosition(null); }}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500 }}
                      />
                      <div onClick={(e) => e.stopPropagation()} style={{
                        position: 'fixed', top: adjustedTop, left: popupPosition.left, width: popupPosition.width,
                        background: 'rgba(15,17,21,0.98)', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.3)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 501, overflow: 'hidden',
                      }}>
                        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e5e7eb', fontSize: '14px', fontWeight: '500', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{symptom.name}</span>
                          {trackingMode === 'ampm' && <span style={{ fontSize: '11px', color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'rgba(99,102,241,0.15)', padding: '2px 8px', borderRadius: '4px' }}>{(quickLogTime || getCurrentTimePeriod()) === 'morning' ? 'AM' : 'PM'}</span>}
                        </div>
                        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                          {[0,1,2,3,4,5].map(severity => {
                            const logTime = quickLogTime || getCurrentTimePeriod();
                            const recentEntry = getMostRecentEntry(symptom.id, logTime);
                            const isRecentSeverity = recentEntry?.severity === severity;
                            const subtleColors = ['#6b7280','#9ca3af','#b0b7c0','#c9cdd3','#dfe2e6','#f1f3f5'];
                            return (
                              <button key={severity} onClick={(e) => { e.stopPropagation(); quickLog(symptom.id, severity, logTime); setPopupPosition(null); }}
                                style={{ flex: 1, padding: '14px 0', background: `rgba(255,255,255,${0.03+severity*0.01})`, border: isRecentSeverity ? '1px solid rgba(255,255,255,0.25)' : '1px solid transparent', borderRadius: '3px', color: subtleColors[severity], fontSize: '18px', fontWeight: '700', cursor: 'pointer' }}>
                                {severity}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ padding: '0 16px 12px', display: 'flex', gap: '6px' }}>
                          {onOpenGraph && (
                            <button onClick={(e) => { e.stopPropagation(); setQuickLogSymptom(null); setPopupPosition(null); onOpenGraph(symptom.id); }}
                              style={{ flex: 1, padding: '10px 0', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '3px', color: '#8b5cf6', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                              History
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); quickLog(symptom.id, NA_SEVERITY, quickLogTime || getCurrentTimePeriod()); setPopupPosition(null); }}
                            style={{ flex: 1, padding: '10px 0', background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)', borderRadius: '3px', color: '#64748b', fontSize: '13px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                            N/A
                          </button>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            );
          })}
        </div>
      ) : (
      <>

      {/* Health Score Summary Card (mobile only) */}
      <HealthScoreCard score={score} loggedCount={loggedCount} totalActive={totalActive} rollingAvg={rollingAvg} delta={delta} />

      {/* Symptom rows - flat design (mobile) */}
      {activeSymptoms.map((symptom, index) => {
        const symptomEntries = getSymptomEntries(symptom.id);
        const isQuickLog = quickLogSymptom === symptom.id;
        const isPinned = pinnedSymptoms.has(symptom.id);
        const trend = getSymptomTrend(symptom.id, entries, trendWindow);

        // Uniform badge color (no severity-based variation)
        const getBadgeColor = () => ({
          bg: 'rgba(255,255,255,0.05)',
          border: 'rgba(255,255,255,0.12)',
          text: '#e5e7eb'
        });

        // For AM/PM mode, get both entries
        const amEntry = trackingMode === 'ampm' ? symptomEntries.find(e => e.time === 'morning') : null;
        const pmEntry = trackingMode === 'ampm' ? symptomEntries.find(e => e.time === 'evening') : null;

        // Determine active time period for dimming (use toggle selection if set, else time of day)
        const currentHour = new Date().getHours();
        const defaultPeriod = currentHour < 12 ? 'morning' : 'evening';
        const activePeriod = quickLogTime || defaultPeriod;

        // For simple mode, get max entry
        const maxEntry = trackingMode !== 'ampm' && symptomEntries.length > 0
          ? symptomEntries.reduce((max, e) => e.severity > max.severity ? e : max, symptomEntries[0])
          : null;

        // Check if any entry exists for dimming the name
        const hasAnyEntry = trackingMode === 'ampm'
          ? (amEntry || pmEntry)
          : maxEntry;
        const isDimmed = !hasAnyEntry || (trackingMode !== 'ampm' && maxEntry?.severity === 0);

        return (
          <div
            key={symptom.id}
            data-symptom-row
            onTouchStart={(e) => handleTouchStart(e, symptom.id)}
            onTouchMove={(e) => handleMove(e.touches[0].clientX, e.touches[0].clientY)}
            onTouchEnd={handleEnd}
            onClick={(e) => {
              if (quickLogSymptom !== null) {
                setQuickLogSymptom(null);
                setPopupPosition(null);
              } else {
                // Get the row's position for popup placement
                const rect = e.currentTarget.getBoundingClientRect();
                setPopupPosition({ top: rect.top, left: rect.left, width: rect.width });
                setQuickLogSymptom(symptom.id);
                // Use the user's AM/PM selection if set, otherwise default to current time
                if (!quickLogTime) {
                  setQuickLogTime(getCurrentTimePeriod());
                }
              }
            }}
            style={{
              background: 'transparent',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              overflow: 'hidden',
              cursor: 'pointer',
            }}
          >
            {/* Main row */}
            <div style={{
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                {isPinned && (
                  <span style={{ color: '#fbbf24', fontSize: '12px' }}>⊙</span>
                )}
                <span style={{
                  width: '21px',
                  display: 'inline-block',
                  fontSize: '16px',
                  opacity: 0.7,
                  color: trend === 'improving' ? '#4ade80' : '#fbbf24',
                  flexShrink: 0,
                }}>
                  {trend === 'improving' ? '↓' : trend === 'worsening' ? '↑' : ''}
                </span>
                <div style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  <span style={{
                    color: isDimmed ? '#9ca3af' : '#e5e7eb',
                    fontSize: '17px',
                    fontWeight: '400',
                    display: 'block',
                    whiteSpace: 'nowrap',
                  }}>{symptom.name}</span>
                  {symptom.description && (
                    <span style={{
                      color: '#6b7280',
                      fontSize: '13px',
                      fontWeight: '400',
                      display: 'block',
                      marginTop: '2px',
                      whiteSpace: 'nowrap',
                    }}>{symptom.description}</span>
                  )}
                </div>
              </div>

              {/* Desktop: mini sparkline + recent avg */}
              {isDesktop && (() => {
                const days = 7;
                const today = new Date();
                const vals = [];
                for (let d = days - 1; d >= 0; d--) {
                  const dt = new Date(today);
                  dt.setDate(dt.getDate() - d);
                  const dk = getDateKey(dt);
                  // Get daily value
                  const am = entries[`${dk}-${symptom.id}-morning`];
                  const pm = entries[`${dk}-${symptom.id}-evening`];
                  const daily = entries[`${dk}-${symptom.id}-daily`];
                  const sevs = [];
                  if (am && am.severity !== NA_SEVERITY) sevs.push(am.severity);
                  if (pm && pm.severity !== NA_SEVERITY) sevs.push(pm.severity);
                  if (sevs.length === 0 && daily && daily.severity !== NA_SEVERITY) sevs.push(daily.severity);
                  vals.push(sevs.length > 0 ? sevs.reduce((a, b) => a + b, 0) / sevs.length : null);
                }
                const hasData = vals.some(v => v !== null);
                if (!hasData) return null;
                const validVals = vals.filter(v => v !== null);
                const avg = validVals.length > 0 ? (validVals.reduce((a, b) => a + b, 0) / validVals.length).toFixed(1) : '--';
                // Mini sparkline as inline SVG
                const w = 50, h = 20;
                const nonNullPts = [];
                vals.forEach((v, i) => {
                  if (v !== null) nonNullPts.push({ x: (i / (vals.length - 1)) * w, y: h - (v / 5) * h });
                });
                const pathD = nonNullPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('');
                return (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginRight: '4px', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onOpenGraph) onOpenGraph(symptom.id);
                    }}
                  >
                    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
                      <path d={pathD} fill="none" stroke="rgba(139, 92, 246, 0.5)" strokeWidth="1.5" />
                    </svg>
                    <span style={{ color: '#6b7280', fontSize: '12px', fontWeight: '500', minWidth: '24px', textAlign: 'right' }}>
                      {avg}
                    </span>
                  </div>
                );
              })()}

              {/* Right side: AM/PM badges - minus circle for unentered */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                {trackingMode === 'ampm' ? (
                  /* AM/PM mode - two fixed positions */
                  <>
                    {/* AM Position */}
                    {amEntry ? (
                      /* Has entry - show severity badge */
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          const dateKey = getDateKey(selectedDate);
                          const entryKey = `${dateKey}-${symptom.id}-morning`;
                          setEntries(prev => {
                            const newEntries = { ...prev };
                            delete newEntries[entryKey];
                            return newEntries;
                          });
                          setLastAction(`Removed ${symptom.name} AM`);
                          haptic('light');
                        }}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '6px',
                          border: flashColumn === 'morning'
                            ? '1px solid rgba(99, 102, 241, 0.7)'
                            : activePeriod === 'morning'
                              ? '1px solid rgba(255, 255, 255, 0.42)'
                              : `1px solid ${getBadgeColor().border}`,
                          background: amEntry.severity === NA_SEVERITY ? 'rgba(100, 116, 139, 0.1)' : getBadgeColor().bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: flashColumn === 'morning' ? 'none' : 'border-color 0.5s ease-out',
                          opacity: activePeriod === 'morning' ? 1 : 0.25,
                        }}
                      >
                        <span style={{
                          color: amEntry.severity === NA_SEVERITY ? '#64748b' : getBadgeColor().text,
                          fontSize: amEntry.severity === NA_SEVERITY ? '10px' : '14px',
                          fontWeight: '600',
                        }}>
                          {amEntry.severity === NA_SEVERITY ? 'N/A' : amEntry.severity}
                        </span>
                      </div>
                    ) : (
                      /* No entry */
                      symptom.applicablePeriods && !symptom.applicablePeriods.includes('morning') ? (
                        /* Auto-N/A: symptom doesn't apply to morning */
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: activePeriod === 'morning' ? 0.5 : 0.15,
                        }}>
                          <span style={{ color: '#64748b', fontSize: '10px', fontWeight: '600' }}>N/A</span>
                        </div>
                      ) : (
                      /* No entry - show minus circle */
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          const rowRect = e.currentTarget.closest('[data-symptom-row]').getBoundingClientRect();
                          setPopupPosition({ top: rowRect.top, left: rowRect.left, width: rowRect.width });
                          setQuickLogSymptom(symptom.id);
                          setQuickLogTime('morning');
                        }}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          border: flashColumn === 'morning'
                            ? '1px solid rgba(99, 102, 241, 0.7)'
                            : activePeriod === 'morning'
                              ? '1px solid rgba(255, 255, 255, 0.40)'
                              : '1px solid rgba(255, 255, 255, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: flashColumn === 'morning' ? 'none' : 'border-color 0.5s ease-out',
                          opacity: activePeriod === 'morning' ? 1 : 0.25,
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </div>
                      )
                    )}
                    {/* PM Position */}
                    {pmEntry ? (
                      /* Has entry - show severity badge */
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          const dateKey = getDateKey(selectedDate);
                          const entryKey = `${dateKey}-${symptom.id}-evening`;
                          setEntries(prev => {
                            const newEntries = { ...prev };
                            delete newEntries[entryKey];
                            return newEntries;
                          });
                          setLastAction(`Removed ${symptom.name} PM`);
                          haptic('light');
                        }}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '6px',
                          border: flashColumn === 'evening'
                            ? '1px solid rgba(99, 102, 241, 0.7)'
                            : activePeriod === 'evening'
                              ? '1px solid rgba(255, 255, 255, 0.42)'
                              : `1px solid ${getBadgeColor().border}`,
                          background: pmEntry.severity === NA_SEVERITY ? 'rgba(100, 116, 139, 0.1)' : getBadgeColor().bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: flashColumn === 'evening' ? 'none' : 'border-color 0.5s ease-out',
                          opacity: activePeriod === 'evening' ? 1 : 0.25,
                        }}
                      >
                        <span style={{
                          color: pmEntry.severity === NA_SEVERITY ? '#64748b' : getBadgeColor().text,
                          fontSize: pmEntry.severity === NA_SEVERITY ? '10px' : '14px',
                          fontWeight: '600',
                        }}>
                          {pmEntry.severity === NA_SEVERITY ? 'N/A' : pmEntry.severity}
                        </span>
                      </div>
                    ) : (
                      /* No entry */
                      symptom.applicablePeriods && !symptom.applicablePeriods.includes('evening') ? (
                        /* Auto-N/A: symptom doesn't apply to evening */
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: activePeriod === 'evening' ? 0.5 : 0.15,
                        }}>
                          <span style={{ color: '#64748b', fontSize: '10px', fontWeight: '600' }}>N/A</span>
                        </div>
                      ) : (
                      /* No entry - show minus circle */
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          const rowRect = e.currentTarget.closest('[data-symptom-row]').getBoundingClientRect();
                          setPopupPosition({ top: rowRect.top, left: rowRect.left, width: rowRect.width });
                          setQuickLogSymptom(symptom.id);
                          setQuickLogTime('evening');
                        }}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          border: flashColumn === 'evening'
                            ? '1px solid rgba(99, 102, 241, 0.7)'
                            : activePeriod === 'evening'
                              ? '1px solid rgba(255, 255, 255, 0.40)'
                              : '1px solid rgba(255, 255, 255, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: flashColumn === 'evening' ? 'none' : 'border-color 0.5s ease-out',
                          opacity: activePeriod === 'evening' ? 1 : 0.25,
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </div>
                      )
                    )}
                  </>
                ) : (
                  /* Simple mode - single position */
                  maxEntry ? (
                    /* Has entry - show severity badge */
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        const dateKey = getDateKey(selectedDate);
                        const entryKey = `${dateKey}-${symptom.id}-${maxEntry.time}`;
                        setEntries(prev => {
                          const newEntries = { ...prev };
                          delete newEntries[entryKey];
                          return newEntries;
                        });
                        setLastAction(`Removed ${symptom.name}`);
                        haptic('light');
                      }}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        border: `1px solid ${getBadgeColor().border}`,
                        background: maxEntry.severity === NA_SEVERITY ? 'rgba(100, 116, 139, 0.1)' : getBadgeColor().bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{
                        color: maxEntry.severity === NA_SEVERITY ? '#64748b' : getBadgeColor().text,
                        fontSize: maxEntry.severity === NA_SEVERITY ? '10px' : '14px',
                        fontWeight: '600',
                      }}>
                        {maxEntry.severity === NA_SEVERITY ? 'N/A' : maxEntry.severity}
                      </span>
                    </div>
                  ) : (
                    /* No entry - show minus circle */
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        const rowRect = e.currentTarget.closest('[data-symptom-row]').getBoundingClientRect();
                        setPopupPosition({ top: rowRect.top, left: rowRect.left, width: rowRect.width });
                        setQuickLogSymptom(symptom.id);
                        setQuickLogTime(getCurrentTimePeriod());
                      }}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Quick log popup - positioned over the symptom */}
            {isQuickLog && popupPosition && (() => {
              // Calculate if popup would overlap with bottom controls
              // Popup height is ~120px, pill menu is at ~160px from bottom, tab bar ~80px
              const popupHeight = 120;
              const bottomSafeZone = 200; // Space for pill menu + tab bar
              const windowHeight = window.innerHeight;
              const wouldOverlap = popupPosition.top + popupHeight > windowHeight - bottomSafeZone;
              // If would overlap, position popup above the row (move up by popup height + row height)
              const adjustedTop = wouldOverlap
                ? Math.max(100, popupPosition.top - popupHeight - 10)
                : popupPosition.top;

              return (
              <>
                {/* Backdrop */}
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuickLogSymptom(null);
                    setPopupPosition(null);
                  }}
                  style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 500,
                  }}
                />
                {/* Popup */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'fixed',
                    top: adjustedTop,
                    left: popupPosition.left,
                    width: popupPosition.width,
                    background: 'rgba(15, 17, 21, 0.98)',
                    borderRadius: '8px',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
                    zIndex: 501,
                    overflow: 'hidden',
                  }}
                >
                  {/* Symptom name header */}
                  <div style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    color: '#e5e7eb',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <span>{symptom.name}</span>
                    {trackingMode === 'ampm' && (
                      <span style={{
                        fontSize: '11px',
                        color: '#6b7280',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>
                        {(quickLogTime || getCurrentTimePeriod()) === 'morning' ? 'am' : 'pm'}
                      </span>
                    )}
                  </div>
                  {/* Severity buttons */}
                  <div style={{
                    padding: '12px 16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '6px',
                  }}>
                    {[0, 1, 2, 3, 4, 5].map(severity => {
                      const logTime = quickLogTime || getCurrentTimePeriod();
                      const recentEntry = getMostRecentEntry(symptom.id, logTime);
                      const isRecentSeverity = recentEntry?.severity === severity;
                      const subtleColors = ['#6b7280', '#9ca3af', '#b0b7c0', '#c9cdd3', '#dfe2e6', '#f1f3f5'];
                      const color = subtleColors[severity];

                      return (
                        <button
                          key={severity}
                          onClick={(e) => {
                            e.stopPropagation();
                            quickLog(symptom.id, severity, logTime);
                            setPopupPosition(null);
                          }}
                          style={{
                            flex: 1,
                            padding: '14px 0',
                            background: `rgba(255,255,255,${0.03 + severity * 0.01})`,
                            border: isRecentSeverity ? `1px solid rgba(255,255,255,0.25)` : '1px solid transparent',
                            borderRadius: '3px',
                            color: color,
                            fontSize: '18px',
                            fontWeight: '700',
                            cursor: 'pointer',
                          }}
                        >
                          {severity}
                        </button>
                      );
                    })}
                  </div>
                  {/* N/A + History button row */}
                  <div style={{ padding: '0 16px 12px', display: 'flex', gap: '6px' }}>
                    {onOpenGraph && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setQuickLogSymptom(null);
                          setPopupPosition(null);
                          onOpenGraph(symptom.id);
                        }}
                        style={{
                          flex: 1,
                          padding: '10px 0',
                          background: 'rgba(139, 92, 246, 0.06)',
                          border: '1px solid rgba(139, 92, 246, 0.2)',
                          borderRadius: '3px',
                          color: '#8b5cf6',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                        History
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const logTime = quickLogTime || getCurrentTimePeriod();
                        quickLog(symptom.id, NA_SEVERITY, logTime);
                        setPopupPosition(null);
                      }}
                      style={{
                        flex: 1,
                        padding: '10px 0',
                        background: 'rgba(100, 116, 139, 0.1)',
                        border: '1px solid rgba(100, 116, 139, 0.2)',
                        borderRadius: '3px',
                        color: '#64748b',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                      N/A
                    </button>
                  </div>
                </div>
              </>
              );
            })()}
          </div>
        );
      })}
      </>
      )}


      {/* Add Symptom Button - at bottom of list (mobile only, desktop uses toolbar) */}
      {!showAddSymptom && !isDesktop && (
        <button
          onClick={() => setShowAddSymptom(true)}
          style={{
            width: '100%',
            padding: '16px 20px',
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            color: '#6b7280',
            fontSize: '14px',
            fontWeight: '400',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '14px' }}>+</span>
          Manage symptoms
        </button>
      )}

      {/* Manage Symptoms Modal */}
      {showAddSymptom && (
        <div
          style={isDesktop ? {
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
          } : {
            position: 'fixed',
            inset: 0,
            background: '#08090A',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={isDesktop ? () => setShowAddSymptom(false) : undefined}
        >
          <div
            onClick={isDesktop ? (e) => e.stopPropagation() : undefined}
            style={isDesktop ? {
              width: '100%',
              maxWidth: '900px',
              maxHeight: '80vh',
              background: '#08090A',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            } : {
              display: 'contents',
            }}
          >
          {/* Scrollable Content */}
          <div
            ref={manageScrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              padding: isDesktop ? '24px 32px' : '12px 16px',
              paddingBottom: '180px',
            }}
          >
            <div style={{ maxWidth: isDesktop ? '100%' : '500px', margin: '0 auto' }}>

            {/* Add Symptom Form (at top, when expanded) */}
            {showAddForm && (
              <div style={{
                background: 'rgba(15, 17, 21, 0.6)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                animation: 'slideDown 0.2s ease-out',
              }}>
                <div style={{ position: 'relative' }}>
                  <input
                    value={newSymptomName}
                    onChange={(e) => setNewSymptomName(e.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newSymptomName.trim()) addSymptom();
                    }}
                    placeholder="Symptom name"
                    autoFocus
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '2px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: '5px',
                      padding: '12px 14px',
                      color: '#f8fafc',
                      fontSize: '15px',
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                  {/* Autocomplete dropdown for hidden symptoms */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: 'rgba(15, 17, 21, 0.98)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: '5px',
                      marginTop: '4px',
                      maxHeight: '150px',
                      overflowY: 'auto',
                      zIndex: 10,
                    }}>
                      {suggestions.map((symptom) => (
                        <button
                          key={symptom.id}
                          onClick={() => {
                            reactivateSymptom(symptom.id);
                            setNewSymptomName('');
                            setShowSuggestions(false);
                            setShowAddForm(false);
                          }}
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                            color: '#e5e7eb',
                            fontSize: '14px',
                            textAlign: 'left',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>{symptom.name}</span>
                          <span style={{ color: '#6b7280', fontSize: '12px' }}>Restore</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  value={newSymptomDescription}
                  onChange={(e) => setNewSymptomDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newSymptomName.trim()) addSymptom();
                  }}
                  placeholder="Description (optional)"
                  style={{
                    width: '100%',
                    background: 'rgba(15, 23, 42, 0.5)',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    borderRadius: '5px',
                    padding: '10px 14px',
                    marginTop: '8px',
                    color: '#9ca3af',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={() => {
                    addSymptom();
                    setShowAddForm(false);
                  }}
                  disabled={!newSymptomName.trim()}
                  style={{
                    marginTop: '10px',
                    width: '100%',
                    background: newSymptomName.trim() ? '#6366f1' : 'rgba(99, 102, 241, 0.3)',
                    border: 'none',
                    borderRadius: '5px',
                    padding: '12px',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: newSymptomName.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  Add Symptom
                </button>
              </div>
            )}

            {/* Active symptoms list */}
            {symptoms.filter(s => s.active).length > 0 && (() => {
              const activeList = symptoms.filter(s => s.active).sort((a, b) => (a.order || 0) - (b.order || 0));
              const dragCurrentIndex = dragReorderId ? activeList.findIndex(s => s.id === dragReorderId) : -1;
              const itemHeight = 52;
              const dragTargetIndex = dragReorderId ? Math.max(0, Math.min(activeList.length - 1, dragCurrentIndex + Math.round(dragReorderY / itemHeight))) : -1;

              return (
              <div
                style={{ marginBottom: '20px' }}
                onTouchMove={handleDragMove}
                onTouchEnd={handleDragEnd}
                onTouchCancel={handleDragEnd}
                onMouseMove={handleDragMove}
                onMouseUp={handleDragEnd}
                onMouseLeave={handleDragEnd}
              >
                <label style={{
                  color: '#94a3b8',
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '12px',
                  display: 'block',
                }}>Active Symptoms ({activeList.length})</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {activeList.map((symptom, index) => {
                    const isDraggingThis = dragReorderId === symptom.id;
                    // Calculate offset for non-dragged items to show drop position
                    let offsetY = 0;
                    if (dragReorderId && !isDraggingThis) {
                      if (index > dragCurrentIndex && index <= dragTargetIndex) {
                        offsetY = -itemHeight - 6; // Move up
                      } else if (index < dragCurrentIndex && index >= dragTargetIndex) {
                        offsetY = itemHeight + 6; // Move down
                      }
                    }
                    return (
                    <div
                      key={symptom.id}
                      style={{
                        background: isDraggingThis ? 'rgba(99, 102, 241, 0.3)' : 'rgba(15, 17, 21, 0.6)',
                        borderRadius: '3px',
                        padding: '10px 12px 10px 0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        transform: isDraggingThis ? `translateY(${dragReorderY}px)` : `translateY(${offsetY}px)`,
                        zIndex: isDraggingThis ? 10 : 1,
                        position: 'relative',
                        transition: isDraggingThis ? 'none' : 'transform 0.15s ease',
                        boxShadow: isDraggingThis ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
                      }}
                    >
                      {/* Drag handle (hamburger) */}
                      <div
                        onTouchStart={(e) => handleDragStart(e, symptom.id, [])}
                        onMouseDown={(e) => handleDragStart(e, symptom.id, [])}
                        style={{
                          padding: '8px 4px',
                          cursor: dragReorderId ? 'grabbing' : 'grab',
                          touchAction: 'none',
                          userSelect: 'none',
                          color: '#64748b',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '3px',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ width: '16px', height: '2px', background: '#64748b', borderRadius: '1px' }} />
                        <div style={{ width: '16px', height: '2px', background: '#64748b', borderRadius: '1px' }} />
                        <div style={{ width: '16px', height: '2px', background: '#64748b', borderRadius: '1px' }} />
                      </div>

                      <div
                        onClick={() => setEditingSymptomFullId(symptom.id)}
                        style={{
                          cursor: 'pointer',
                          flex: 1,
                        }}
                      >
                        <span style={{ color: '#e2e8f0', fontSize: '15px' }}>
                          {symptom.name}
                        </span>
                        {symptom.description && (
                          <span style={{ color: '#6b7280', fontSize: '13px', marginLeft: '6px' }}>
                            {symptom.description}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => removeSymptom(symptom.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '3px',
                          padding: '6px 12px',
                          color: '#f87171',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Hide
                      </button>
                    </div>
                  );
                  })}
                </div>
              </div>
              );
            })()}

            {/* Inactive symptoms - Collapsible */}
            {inactiveSymptoms.length > 0 && (
              <div>
                <button
                  onClick={() => setShowHiddenSymptoms(!showHiddenSymptoms)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: '0',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: showHiddenSymptoms ? '12px' : '0',
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transition: 'transform 0.2s ease',
                      transform: showHiddenSymptoms ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                  <label style={{
                    color: '#94a3b8',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    cursor: 'pointer',
                  }}>Hidden Symptoms ({inactiveSymptoms.length})</label>
                </button>
                {showHiddenSymptoms && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    animation: 'slideDown 0.2s ease-out',
                  }}>
                    {inactiveSymptoms.map((symptom) => (
                      <div
                        key={symptom.id}
                        style={{
                          background: 'rgba(15, 17, 21, 0.3)',
                          borderRadius: '3px',
                          padding: '12px 16px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '12px',
                        }}
                      >
                        <span style={{
                          color: '#64748b',
                          fontSize: '15px',
                          flex: 1,
                        }}>
                          {symptom.name}
                        </span>
                        <button
                          onClick={() => reactivateSymptom(symptom.id)}
                          style={{
                            background: 'rgba(34, 197, 94, 0.15)',
                            border: '1px solid rgba(34, 197, 94, 0.3)',
                            borderRadius: '3px',
                            padding: '6px 12px',
                            color: '#4ade80',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            </div>
          </div>

          {/* Fixed Bottom Bar */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '16px 16px 30px',
            background: 'linear-gradient(transparent, #08090A 25%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            zIndex: 10,
          }}>
            {!showAddForm && (
              <button
                onClick={() => {
                  setShowAddForm(true);
                  if (manageScrollRef.current) {
                    manageScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                style={{
                  width: '100%',
                  maxWidth: '500px',
                  padding: '14px',
                  background: 'rgba(139, 92, 246, 0.06)',
                  border: '2px dashed rgba(139, 92, 246, 0.3)',
                  borderRadius: '12px',
                  color: '#a78bfa',
                  fontSize: '15px',
                  fontWeight: '500',
                  cursor: 'pointer',
                }}
              >
                + Add Symptom
              </button>
            )}
            <button
              onClick={() => setShowAddSymptom(false)}
              style={{
                background: '#8b5cf6',
                border: 'none',
                borderRadius: '25px',
                color: '#fff',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                padding: '14px 40px',
                boxShadow: '0 4px 20px rgba(139, 92, 246, 0.4)',
              }}
            >
              Done
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Full-screen Symptom Edit */}
      {editingSymptomFullId && (
        <SymptomEdit
          symptom={symptoms.find(s => s.id === editingSymptomFullId)}
          onSave={handleSymptomSave}
          onCancel={() => setEditingSymptomFullId(null)}
          trackingMode={trackingMode}
        />
      )}

    </div>
  );
}
