import { useState, useRef, useEffect } from 'react';
import { severityColors, trackingModes, HOLD_DELAY, DRAG_SENSITIVITY } from '../utils/constants';
import { getDateKey, haptic, getSymptomTrend } from '../utils/helpers';

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
}) {
  // Drag state for hold-to-edit
  const [activeSymptom, setActiveSymptom] = useState(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [fingerPosition, setFingerPosition] = useState({ x: 0, y: 0 });

  // Edit symptom state
  const [editingSymptomId, setEditingSymptomId] = useState(null);
  const [editingSymptomName, setEditingSymptomName] = useState('');
  const [editingSymptomDescription, setEditingSymptomDescription] = useState('');
  const [newSymptomName, setNewSymptomName] = useState('');
  const [newSymptomDescription, setNewSymptomDescription] = useState('');
  const [showHiddenSymptoms, setShowHiddenSymptoms] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Drag reorder state
  const [dragReorderId, setDragReorderId] = useState(null);
  const [dragReorderY, setDragReorderY] = useState(0);
  const dragReorderStartY = useRef(0);
  const dragReorderItemRects = useRef([]);

  // Popup position state
  const [popupPosition, setPopupPosition] = useState(null);

  // Refs
  const containerRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const holdTimerRef = useRef(null);
  const pendingSymptomRef = useRef(null);
  const isDraggingRef = useRef(false);

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

    holdTimerRef.current = setTimeout(() => {
      if (pendingSymptomRef.current === symptomId) {
        enterEditMode(symptomId, touch.clientX, touch.clientY);
      }
    }, HOLD_DELAY);
  };


  const handleMove = (clientX, clientY) => {
    if (pendingSymptomRef.current && !isDragging) {
      const deltaX = Math.abs(clientX - startPosRef.current.x);
      const deltaY = Math.abs(clientY - startPosRef.current.y);

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

  // Symptom management
  const addSymptom = () => {
    const name = newSymptomName.trim();
    if (!name) return;

    const existing = symptoms.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!existing.active) {
        setSymptoms(symptoms.map(s =>
          s.id === existing.id ? { ...s, active: true, description: newSymptomDescription.trim() || s.description } : s
        ));
        setLastAction('Symptom restored');
      } else {
        setLastAction('Symptom already exists');
        return;
      }
    } else {
      const id = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now() + Math.random();
      setSymptoms([...symptoms, {
        id,
        name,
        description: newSymptomDescription.trim() || undefined,
        active: true
      }]);
      setLastAction('Symptom added');
    }

    setNewSymptomName('');
    setNewSymptomDescription('');
  };

  const removeSymptom = (symptomId) => {
    setSymptoms(symptoms.map(s =>
      s.id === symptomId ? { ...s, active: false } : s
    ));
    setLastAction('Symptom hidden (history preserved)');
  };

  const reactivateSymptom = (symptomId) => {
    setSymptoms(symptoms.map(s =>
      s.id === symptomId ? { ...s, active: true } : s
    ));
    setLastAction('Symptom restored');
  };

  const startEditingSymptom = (symptom) => {
    setEditingSymptomId(symptom.id);
    setEditingSymptomName(symptom.name);
    setEditingSymptomDescription(symptom.description || '');
  };

  const saveSymptomEdit = () => {
    if (editingSymptomName.trim() && editingSymptomId) {
      setSymptoms(symptoms.map(s =>
        s.id === editingSymptomId ? {
          ...s,
          name: editingSymptomName.trim(),
          description: editingSymptomDescription.trim() || undefined
        } : s
      ));
      setLastAction('Symptom updated');
    }
    setEditingSymptomId(null);
    setEditingSymptomName('');
    setEditingSymptomDescription('');
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
    const touch = e.touches[0];
    dragReorderStartY.current = touch.clientY;
    dragReorderItemRects.current = itemRects;
    setDragReorderId(symptomId);
    setDragReorderY(0);
    haptic('light');
  };

  const handleDragMove = (e) => {
    if (!dragReorderId) return;
    e.preventDefault();
    const touch = e.touches[0];
    setDragReorderY(touch.clientY - dragReorderStartY.current);
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
      setSymptoms(symptoms.map(s => {
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

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
      }}
    >
      {/* Search Input - only show when searchVisible (pull to search) */}
      {searchVisible && (
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

      {/* Symptom rows - flat design */}
      {activeSymptoms.map((symptom, index) => {
        const symptomEntries = getSymptomEntries(symptom.id);
        const isQuickLog = quickLogSymptom === symptom.id;
        const isPinned = pinnedSymptoms.has(symptom.id);
        const trend = getSymptomTrend(symptom.id, entries, trendWindow);

        // Color based on severity - subtle off-white scale
        const getBadgeColor = (sev) => {
          if (sev === null) return { bg: 'transparent', border: 'rgba(255,255,255,0.1)', text: '#6b7280' };
          if (sev === 0) return { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', text: '#6b7280' };
          if (sev === 1) return { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.10)', text: '#9ca3af' };
          if (sev === 2) return { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.12)', text: '#b0b7c0' };
          if (sev === 3) return { bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.14)', text: '#c9cdd3' };
          if (sev === 4) return { bg: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.16)', text: '#dfe2e6' };
          return { bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.18)', text: '#f1f3f5' };
        };

        // For AM/PM mode, get both entries
        const amEntry = trackingMode === 'ampm' ? symptomEntries.find(e => e.time === 'morning') : null;
        const pmEntry = trackingMode === 'ampm' ? symptomEntries.find(e => e.time === 'evening') : null;

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
            onClick={(e) => {
              if (quickLogSymptom !== null) {
                setQuickLogSymptom(null);
                setPopupPosition(null);
              } else {
                // Get the row's position for popup placement
                const rect = e.currentTarget.getBoundingClientRect();
                setPopupPosition({ top: rect.top, left: rect.left, width: rect.width });
                setQuickLogSymptom(symptom.id);
                // Always set to current time of day when clicking on row
                setQuickLogTime(getCurrentTimePeriod());
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
                  whiteSpace: 'nowrap',
                }}>
                  <span style={{
                    color: isDimmed ? '#9ca3af' : '#e5e7eb',
                    fontSize: '17px',
                    fontWeight: '400',
                  }}>{symptom.name}</span>
                  {symptom.description && (
                    <span style={{
                      color: '#6b7280',
                      fontSize: '13px',
                      marginLeft: '6px',
                    }}>{symptom.description}</span>
                  )}
                </div>
              </div>

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
                            : `1px solid ${getBadgeColor(amEntry.severity).border}`,
                          background: getBadgeColor(amEntry.severity).bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: flashColumn === 'morning' ? 'none' : 'border-color 0.5s ease-out',
                        }}
                      >
                        <span style={{ color: getBadgeColor(amEntry.severity).text, fontSize: '14px', fontWeight: '600' }}>
                          {amEntry.severity}
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
                          setQuickLogTime('morning');
                        }}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          border: flashColumn === 'morning'
                            ? '1px solid rgba(99, 102, 241, 0.7)'
                            : '1px solid rgba(255, 255, 255, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: flashColumn === 'morning' ? 'none' : 'border-color 0.5s ease-out',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </div>
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
                            : `1px solid ${getBadgeColor(pmEntry.severity).border}`,
                          background: getBadgeColor(pmEntry.severity).bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: flashColumn === 'evening' ? 'none' : 'border-color 0.5s ease-out',
                        }}
                      >
                        <span style={{ color: getBadgeColor(pmEntry.severity).text, fontSize: '14px', fontWeight: '600' }}>
                          {pmEntry.severity}
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
                          setQuickLogTime('evening');
                        }}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          border: flashColumn === 'evening'
                            ? '1px solid rgba(99, 102, 241, 0.7)'
                            : '1px solid rgba(255, 255, 255, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          transition: flashColumn === 'evening' ? 'none' : 'border-color 0.5s ease-out',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </div>
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
                        border: `1px solid ${getBadgeColor(maxEntry.severity).border}`,
                        background: getBadgeColor(maxEntry.severity).bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ color: getBadgeColor(maxEntry.severity).text, fontSize: '14px', fontWeight: '600' }}>
                        {maxEntry.severity}
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
            {isQuickLog && popupPosition && (
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
                    top: popupPosition.top,
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
                  }}>
                    {symptom.name}
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
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* Add Symptom Button - at bottom of list */}
      {!showAddSymptom && (
        <button
          onClick={() => setShowAddSymptom(true)}
          style={{
            width: '100%',
            padding: '16px 20px',
            marginBottom: '12px',
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
          + Manage symptoms
        </button>
      )}

      {/* Manage Symptoms Modal */}
      {showAddSymptom && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#08090A',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Collapsible Add Section */}
          <div style={{
            flexShrink: 0,
            background: '#08090A',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '16px 20px',
          }}>
            <div style={{ maxWidth: '500px', margin: '0 auto' }}>
              {/* Toggle button */}
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                style={{
                  width: '100%',
                  background: showAddForm ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.1)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  color: showAddForm ? '#a5b4fc' : '#818cf8',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{
                  fontSize: '16px',
                  fontWeight: '300',
                  transition: 'transform 0.2s ease',
                  transform: showAddForm ? 'rotate(45deg)' : 'none',
                }}>+</span>
                Add symptom
              </button>

              {/* Expandable form */}
              {showAddForm && (
                <div style={{
                  marginTop: '12px',
                  background: 'rgba(15, 17, 21, 0.6)',
                  borderRadius: '8px',
                  padding: '16px',
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
            </div>
          </div>

          {/* Scrollable Content */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              padding: '12px 16px',
              paddingBottom: '120px',
            }}
          >

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
                        style={{
                          padding: '8px 4px',
                          cursor: 'grab',
                          touchAction: 'none',
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

                      {editingSymptomId === symptom.id ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <input
                            value={editingSymptomName}
                            onChange={(e) => setEditingSymptomName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveSymptomEdit();
                              if (e.key === 'Escape') {
                                setEditingSymptomId(null);
                                setEditingSymptomName('');
                                setEditingSymptomDescription('');
                              }
                            }}
                            autoFocus
                            placeholder="Name"
                            style={{
                              background: 'rgba(99, 102, 241, 0.15)',
                              border: '2px solid rgba(99, 102, 241, 0.5)',
                              borderRadius: '3px',
                              padding: '8px 12px',
                              color: '#f8fafc',
                              fontSize: '15px',
                            }}
                          />
                          <input
                            value={editingSymptomDescription}
                            onChange={(e) => setEditingSymptomDescription(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveSymptomEdit();
                              if (e.key === 'Escape') {
                                setEditingSymptomId(null);
                                setEditingSymptomName('');
                                setEditingSymptomDescription('');
                              }
                            }}
                            placeholder="Description (optional)"
                            style={{
                              background: 'rgba(99, 102, 241, 0.1)',
                              border: '1px solid rgba(99, 102, 241, 0.3)',
                              borderRadius: '3px',
                              padding: '6px 12px',
                              color: '#9ca3af',
                              fontSize: '13px',
                            }}
                          />
                          <button
                            onClick={saveSymptomEdit}
                            style={{
                              background: 'rgba(99, 102, 241, 0.3)',
                              border: '1px solid rgba(99, 102, 241, 0.5)',
                              borderRadius: '3px',
                              padding: '6px 12px',
                              color: '#a5b4fc',
                              fontSize: '12px',
                              cursor: 'pointer',
                              alignSelf: 'flex-start',
                            }}
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <div
                          onClick={() => startEditingSymptom(symptom)}
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
                      )}
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

          {/* Floating Done Button */}
          <button
            onClick={() => setShowAddSymptom(false)}
            style={{
              position: 'absolute',
              bottom: '30px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#8b5cf6',
              border: 'none',
              borderRadius: '25px',
              color: '#fff',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              padding: '14px 40px',
              boxShadow: '0 4px 20px rgba(139, 92, 246, 0.4)',
              zIndex: 100,
            }}
          >
            Done
          </button>
        </div>
      )}

    </div>
  );
}
