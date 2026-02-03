import { useState, useRef } from 'react';
import { severityColors, trackingModes, HOLD_DELAY, DRAG_SENSITIVITY } from '../utils/constants';
import { getDateKey, haptic } from '../utils/helpers';

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
  setShowNoteModal,
}) {
  // Drag state for hold-to-edit
  const [activeSymptom, setActiveSymptom] = useState(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [fingerPosition, setFingerPosition] = useState({ x: 0, y: 0 });

  // Edit symptom state
  const [editingSymptomId, setEditingSymptomId] = useState(null);
  const [editingSymptomName, setEditingSymptomName] = useState('');
  const [bulkSymptomInput, setBulkSymptomInput] = useState('');

  // Drag reorder state
  const [dragReorderId, setDragReorderId] = useState(null);
  const [dragReorderY, setDragReorderY] = useState(0);
  const dragReorderStartY = useRef(0);
  const dragReorderItemRects = useRef([]);

  // Refs
  const containerRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const holdTimerRef = useRef(null);
  const pendingSymptomRef = useRef(null);
  const isDraggingRef = useRef(false);

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

  const handleTouchMove = (e) => {
    if (isDragging) {
      e.preventDefault();
    }
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
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
  const parseBulkSymptoms = (input) => {
    return input
      .split(/[,\t\n\r;]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };

  const addBulkSymptoms = () => {
    const names = parseBulkSymptoms(bulkSymptomInput);
    if (names.length === 0) return;

    const newSymptoms = [...symptoms];
    let addedCount = 0;

    names.forEach(name => {
      const existing = newSymptoms.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (!existing.active) {
          existing.active = true;
          addedCount++;
        }
      } else {
        const id = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now() + Math.random();
        newSymptoms.push({ id, name, active: true });
        addedCount++;
      }
    });

    setSymptoms(newSymptoms);
    setBulkSymptomInput('');
    setLastAction(`Added ${addedCount} symptom${addedCount !== 1 ? 's' : ''}`);
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
  };

  const saveSymptomName = () => {
    if (editingSymptomName.trim() && editingSymptomId) {
      setSymptoms(symptoms.map(s =>
        s.id === editingSymptomId ? { ...s, name: editingSymptomName.trim() } : s
      ));
      setLastAction('Symptom renamed');
    }
    setEditingSymptomId(null);
    setEditingSymptomName('');
  };

  const inactiveSymptoms = symptoms.filter(s => !s.active);

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
      style={{ display: 'flex', flexDirection: 'column', gap: '0' }}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleEnd}
      onTouchCancel={handleEnd}
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

        // Color based on severity
        const getBadgeColor = (sev) => {
          if (sev === null) return { bg: 'transparent', border: 'rgba(255,255,255,0.1)', text: '#6b7280' };
          if (sev === 0) return { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)', text: '#6b7280' };
          if (sev <= 1) return { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)', text: '#34d399' };
          if (sev === 2) return { bg: 'rgba(234,179,8,0.1)', border: 'rgba(234,179,8,0.2)', text: '#facc15' };
          return { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)', text: '#fbbf24' };
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
            onClick={() => {
              if (quickLogSymptom !== null) {
                setQuickLogSymptom(null);
              } else {
                setQuickLogSymptom(symptom.id);
                // Always set to current time of day when clicking on row
                setQuickLogTime(getCurrentTimePeriod());
              }
            }}
            onTouchStart={(e) => handleTouchStart(e, symptom.id)}
            style={{
              background: isQuickLog ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              overflow: 'hidden',
              cursor: 'pointer',
            }}
          >
            {/* Main row */}
            <div style={{
              padding: '16px 20px',
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
                  color: isDimmed ? '#9ca3af' : '#e5e7eb',
                  fontSize: '15px',
                  fontWeight: '400',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{symptom.name}</span>
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
                          border: `1px solid ${getBadgeColor(amEntry.severity).border}`,
                          background: getBadgeColor(amEntry.severity).bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
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
                          setQuickLogSymptom(symptom.id);
                          setQuickLogTime('morning');
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
                          border: `1px solid ${getBadgeColor(pmEntry.severity).border}`,
                          background: getBadgeColor(pmEntry.severity).bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
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
                          setQuickLogSymptom(symptom.id);
                          setQuickLogTime('evening');
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

            {/* Quick log overlay */}
            {isQuickLog && (
              <div onClick={(e) => e.stopPropagation()}>
                {/* Time period selector for AM/PM mode */}
                {timePeriods.length > 1 && (
                  <div style={{
                    padding: '8px 16px 0',
                    display: 'flex',
                    gap: '8px',
                  }}>
                    {timePeriods.map(period => {
                      const currentTime = quickLogTime || getCurrentTimePeriod();
                      const isSelected = currentTime === period.id;
                      return (
                        <button
                          key={period.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuickLogTime(period.id);
                          }}
                          style={{
                            flex: 1,
                            padding: '8px',
                            background: isSelected ? 'rgba(139, 92, 246, 0.2)' : 'rgba(100, 116, 139, 0.1)',
                            border: isSelected ? '1px solid rgba(139, 92, 246, 0.4)' : '1px solid transparent',
                            borderRadius: '3px',
                            color: isSelected ? '#c4b5fd' : '#94a3b8',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          {period.icon} {period.label}
                        </button>
                      );
                    })}
                  </div>
                )}

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

                    return (
                      <button
                        key={severity}
                        onClick={(e) => {
                          e.stopPropagation();
                          quickLog(symptom.id, severity, logTime);
                        }}
                        style={{
                          flex: 1,
                          padding: '12px 0',
                          background: `${severityColors[severity]}20`,
                          border: isRecentSeverity ? `1px solid ${severityColors[severity]}35` : '1px solid transparent',
                          borderRadius: '3px',
                          color: severityColors[severity],
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
          Add symptom
        </button>
      )}

      {/* Floating Add Note Button */}
      <button
        onClick={() => setShowNoteModal(true)}
        style={{
          position: 'fixed',
          bottom: 'calc(65px + env(safe-area-inset-bottom))',
          right: '12px',
          background: 'rgba(99, 102, 241, 0.15)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          borderRadius: '5px',
          padding: '12px 14px',
          color: '#a5b4fc',
          fontSize: '13px',
          fontWeight: '500',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          zIndex: 150,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        Note
      </button>


      {/* Manage Symptoms Modal */}
      {showAddSymptom && (
        <div
          onClick={() => setShowAddSymptom(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: '#08090A',
            zIndex: 1000,
            overflowY: 'auto',
            padding: '20px',
            paddingTop: 'calc(20px + env(safe-area-inset-top))',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '500px', margin: '0 auto' }}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
            }}>
              <h2 style={{ color: '#f8fafc', fontSize: '28px', fontWeight: '700', margin: 0, letterSpacing: '-0.5px' }}>
                Symptoms
              </h2>
              <button
                onClick={() => setShowAddSymptom(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#8b5cf6',
                  fontSize: '17px',
                  cursor: 'pointer',
                  padding: '8px',
                }}
              >
                Done
              </button>
            </div>

            {/* Add new symptom(s) */}
            <div style={{
              background: 'rgba(15, 17, 21, 0.6)',
              borderRadius: '3px',
              padding: '16px',
              marginBottom: '20px',
            }}>
              <label style={{
                color: '#94a3b8',
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>Add Symptoms</label>
              <textarea
                value={bulkSymptomInput}
                onChange={(e) => setBulkSymptomInput(e.target.value)}
                placeholder="Enter one or more symptoms (separate with commas or new lines)"
                style={{
                  width: '100%',
                  minHeight: '80px',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '2px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: '5px',
                  padding: '12px 14px',
                  marginTop: '10px',
                  color: '#f8fafc',
                  fontSize: '15px',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
              <button
                onClick={addBulkSymptoms}
                disabled={!bulkSymptomInput.trim()}
                style={{
                  marginTop: '10px',
                  width: '100%',
                  background: bulkSymptomInput.trim() ? '#6366f1' : 'rgba(99, 102, 241, 0.3)',
                  border: 'none',
                  borderRadius: '5px',
                  padding: '12px',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: bulkSymptomInput.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Add Symptoms
              </button>
            </div>

            {/* Active symptoms list */}
            {symptoms.filter(s => s.active).length > 0 && (() => {
              const activeList = symptoms.filter(s => s.active).sort((a, b) => (a.order || 0) - (b.order || 0));
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
                    return (
                    <div
                      key={symptom.id}
                      style={{
                        background: isDraggingThis ? 'rgba(99, 102, 241, 0.3)' : 'rgba(15, 17, 21, 0.6)',
                        borderRadius: '3px',
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        transform: isDraggingThis ? `translateY(${dragReorderY}px)` : 'none',
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
                        <input
                          value={editingSymptomName}
                          onChange={(e) => setEditingSymptomName(e.target.value)}
                          onBlur={saveSymptomName}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveSymptomName();
                            if (e.key === 'Escape') {
                              setEditingSymptomId(null);
                              setEditingSymptomName('');
                            }
                          }}
                          autoFocus
                          style={{
                            flex: 1,
                            background: 'rgba(99, 102, 241, 0.15)',
                            border: '2px solid rgba(99, 102, 241, 0.5)',
                            borderRadius: '3px',
                            padding: '8px 12px',
                            color: '#f8fafc',
                            fontSize: '15px',
                          }}
                        />
                      ) : (
                        <span
                          onClick={() => startEditingSymptom(symptom)}
                          style={{
                            color: '#e2e8f0',
                            fontSize: '15px',
                            cursor: 'pointer',
                            flex: 1,
                          }}
                        >
                          {symptom.name}
                        </span>
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

            {/* Inactive symptoms */}
            {inactiveSymptoms.length > 0 && (
              <div>
                <label style={{
                  color: '#94a3b8',
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '12px',
                  display: 'block',
                }}>Hidden Symptoms ({inactiveSymptoms.length})</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drag overlay */}
      {isDragging && activeSymptom && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(12, 10, 29, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '20px',
          }}
        >
          <div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: '600', marginBottom: '30px', textAlign: 'center' }}>
            {symptoms.find(s => s.id === activeSymptom)?.name}
          </div>

          {/* Time period indicator */}
          {timePeriods.length > 1 && (
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              {timePeriods.map((period, idx) => (
                <div
                  key={period.id}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '5px',
                    background: idx === dragPosition.x ? 'rgba(139, 92, 246, 0.3)' : 'rgba(100, 116, 139, 0.1)',
                    border: idx === dragPosition.x ? '2px solid rgba(139, 92, 246, 0.6)' : '2px solid transparent',
                    color: idx === dragPosition.x ? '#c4b5fd' : '#64748b',
                    fontSize: '14px',
                    fontWeight: '600',
                  }}
                >
                  {period.icon} {period.label}
                </div>
              ))}
            </div>
          )}

          {/* Severity display */}
          <div style={{
            fontSize: '80px',
            fontWeight: '800',
            color: severityColors[dragPosition.y],
            marginBottom: '10px',
          }}>
            {dragPosition.y}
          </div>
          <div style={{ color: '#94a3b8', fontSize: '14px' }}>
            Drag up/down to adjust
          </div>
        </div>
      )}
    </div>
  );
}
