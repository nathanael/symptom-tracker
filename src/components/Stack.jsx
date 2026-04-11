import { useState, useRef, useEffect, Fragment } from 'react';
import { getDateKey, haptic, isScheduledForDate, createHistoryEntry, recordHistoryChange, reconstructStateAtDate, applyHistoricalState } from '../utils/helpers';
import SchedulePicker, { formatSchedule } from './SchedulePicker';
import SupplementEdit from './SupplementEdit';
import { matchSupplementCategory } from '../utils/supplementLookup';

export default function Stack({
  stackItems,
  setStackItems,
  stackEntries,
  setStackEntries,
  selectedDate,
  setLastAction,
  showManageStack,
  setShowManageStack,
  onOpenSupplementGraph,
  isDesktop,
  searchFilter,
}) {
  const [editingStackItem, setEditingStackItem] = useState(null);
  const [newStackItem, setNewStackItem] = useState({ name: '', unit: 'mg', defaultDose: '', description: '', schedule: { type: 'daily' } });
  const [editingSupplementId, setEditingSupplementId] = useState(null);
  const [showLogPicker, setShowLogPicker] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  const [showHiddenInPicker, setShowHiddenInPicker] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const manageScrollRef = useRef(null);

  // Prevent row click from toggling right after dose blur save
  const justSavedDose = useRef(false);

  // Long-press state for opening graph
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const pendingLogAfterAdd = useRef(false);

  // Drag reorder state
  const [dragReorderId, setDragReorderId] = useState(null);
  const [dragReorderY, setDragReorderY] = useState(0);
  const dragReorderStartY = useRef(0);

  const dateKey = getDateKey(selectedDate);
  const today = new Date();
  const isToday = selectedDate.toDateString() === today.toDateString();

  // Lock body scroll when modal is open
  useEffect(() => {
    if (showManageStack) {
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
  }, [showManageStack]);

  const toggleStackItem = (itemId) => {
    haptic('light');

    const entryKey = `${dateKey}-${itemId}`;
    const item = stackItems.find(i => i.id === itemId);

    setStackEntries(prev => {
      if (prev[entryKey]) {
        const newEntries = { ...prev };
        delete newEntries[entryKey];
        setLastAction(`Removed ${item?.name}`);
        return newEntries;
      } else {
        setLastAction(`Took ${item?.name}`);
        return {
          ...prev,
          [entryKey]: {
            date: dateKey,
            itemId: itemId,
            dose: item?.defaultDose || 0,
            taken: true
          }
        };
      }
    });
  };

  const updateStackDose = (itemId, newDose) => {
    const entryKey = `${dateKey}-${itemId}`;
    const item = stackItems.find(i => i.id === itemId);
    const existingEntry = stackEntries[entryKey];

    const dose = parseFloat(newDose) || item?.defaultDose || 0;
    if (existingEntry) {
      setStackEntries(prev => ({
        ...prev,
        [entryKey]: { ...prev[entryKey], dose }
      }));
      setLastAction(`Updated ${item?.name} to ${dose}${item?.unit}`);
    } else {
      // Not yet checked - create entry with the custom dose
      setStackEntries(prev => ({
        ...prev,
        [entryKey]: { date: dateKey, itemId, dose, taken: true }
      }));
      haptic('light');
      setLastAction(`Took ${item?.name} (${dose}${item?.unit})`);
    }
    setEditingStackItem(null);
    justSavedDose.current = true;
    setTimeout(() => { justSavedDose.current = false; }, 300);
  };

  const getStackEntry = (itemId) => {
    return stackEntries[`${dateKey}-${itemId}`];
  };

  const getStackProgress = () => {
    // Unified: reconstruct historical state, then filter to scheduled protocol
    const withHistory = stackItems.map(item => applyHistoricalState(item, selectedDate));
    const protocol = withHistory
      .filter(item => item.active !== false)
      .filter(item => isScheduledForDate(item.schedule, selectedDate));

    const takenCount = protocol.filter(item =>
      stackEntries[`${dateKey}-${item.id}`]
    ).length;
    return { taken: takenCount, total: protocol.length };
  };

  const addStackItem = () => {
    if (!newStackItem.name.trim() || !newStackItem.defaultDose) return;

    const id = newStackItem.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
    const maxOrder = Math.max(-1, ...stackItems.map(i => i.order || 0));

    // Ensure schedule has a startDate (default to today)
    const schedule = newStackItem.schedule?.startDate
      ? newStackItem.schedule
      : { ...newStackItem.schedule, startDate: new Date().toISOString().split('T')[0] };

    const autoCategory = matchSupplementCategory(newStackItem.name.trim());

    const newItem = {
      id: id,
      name: newStackItem.name.trim(),
      unit: newStackItem.unit,
      defaultDose: parseFloat(newStackItem.defaultDose),
      description: newStackItem.description.trim() || '',
      schedule: schedule,
      halfLifeCategory: autoCategory || null,
      active: true,
      order: maxOrder + 1
    };

    // Add history entry for creation
    newItem.history = [createHistoryEntry(newItem)];

    setStackItems(prev => [...prev, newItem]);

    // Auto-log if triggered from "Add new supplement" in picker
    if (pendingLogAfterAdd.current) {
      pendingLogAfterAdd.current = false;
      // Use setTimeout to let state update first
      setTimeout(() => toggleStackItem(id), 0);
    }

    setNewStackItem({ name: '', unit: 'mg', defaultDose: '', description: '', schedule: { type: 'daily' } });
    setShowAddForm(false);
    setLastAction(`Added ${newStackItem.name}`);
  };

  const toggleStackItemActive = (itemId) => {
    setStackItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;

      const newActive = !item.active;
      const historyEntry = recordHistoryChange(item, { ...item, active: newActive });
      const history = item.history || [];

      return {
        ...item,
        active: newActive,
        history: historyEntry ? [...history, historyEntry] : history
      };
    }));
  };

  const getEntryCountForItem = (itemId) => {
    return Object.keys(stackEntries).filter(key => key.endsWith(`-${itemId}`)).length;
  };

  const deleteStackItem = (itemId) => {
    const item = stackItems.find(i => i.id === itemId);
    setStackItems(prev => prev.filter(i => i.id !== itemId));
    setStackEntries(prev => {
      const filtered = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!key.endsWith(`-${itemId}`)) {
          filtered[key] = value;
        }
      }
      return filtered;
    });
    setConfirmingDeleteId(null);
    if (item) setLastAction(`Deleted ${item.name}`);
  };

  const handleSupplementSave = (updatedData) => {
    if (updatedData.name.trim() && editingSupplementId) {
      const newDefaultDose = parseFloat(updatedData.defaultDose);

      // Use functional updater to avoid stale closure issues with stackItems
      setStackItems(prev => prev.map(item => {
        if (item.id !== editingSupplementId) return item;

        const newValues = {
          name: updatedData.name.trim(),
          defaultDose: newDefaultDose || item.defaultDose,
          unit: updatedData.unit,
          description: updatedData.description.trim(),
          schedule: updatedData.schedule,
          halfLifeCategory: updatedData.halfLifeCategory ?? item.halfLifeCategory ?? null,
          active: item.active
        };

        // Record history change if values differ
        const historyEntry = recordHistoryChange(item, newValues);
        const history = item.history || [];

        return {
          ...item,
          ...newValues,
          history: historyEntry ? [...history, historyEntry] : history
        };
      }));

      // Update today's entry to the new dose (only if it still has the old default)
      if (newDefaultDose) {
        const entryKey = `${dateKey}-${editingSupplementId}`;
        // Capture old dose outside the updater to avoid stale closure over stackItems
        const oldItem = stackItems.find(i => i.id === editingSupplementId);
        const oldDose = oldItem?.defaultDose;
        setStackEntries(prev => {
          if (!prev[entryKey]) return prev;
          // Skip if user manually customized the dose to something other than the original default
          if (oldDose !== undefined && prev[entryKey].dose !== oldDose) return prev;
          return {
            ...prev,
            [entryKey]: { ...prev[entryKey], dose: newDefaultDose }
          };
        });
      }
    }
    setEditingSupplementId(null);
  };

  const activeItems = stackItems.filter(i => i.active).sort((a, b) => (a.order || 0) - (b.order || 0));
  const inactiveItems = stackItems.filter(i => !i.active);

  // Autocomplete suggestions from hidden supplements
  const suggestions = inactiveItems.filter(item =>
    newStackItem.name.trim() &&
    item.name.toLowerCase().includes(newStackItem.name.toLowerCase())
  );

  // Determine which items to display based on date
  const displayItems = (() => {
    // Unified path: reconstruct historical state first, then filter
    const withHistory = stackItems.map(item => applyHistoricalState(item, selectedDate));

    // Items active on this date AND scheduled for this date
    const scheduled = withHistory
      .filter(item => item.active !== false)
      .filter(item => isScheduledForDate(item.schedule, selectedDate));

    // On past dates, also show items that have logged entries
    const scheduledIds = new Set(scheduled.map(i => i.id));
    const withEntries = !isToday
      ? withHistory.filter(item => !scheduledIds.has(item.id) && stackEntries[`${dateKey}-${item.id}`])
      : [];

    return [...scheduled, ...withEntries]
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  })().filter(item => {
    if (!searchFilter) return true;
    const s = searchFilter.toLowerCase();
    return item.name.toLowerCase().includes(s) || (item.description || '').toLowerCase().includes(s);
  });

  const availableToLog = (() => {
    const displayedIds = new Set(displayItems.map(i => i.id));
    return stackItems.filter(i => {
      if (displayedIds.has(i.id)) return false;
      if (isToday && !i.active) return false;
      if (!isToday && !i.active && !showHiddenInPicker) return false;
      return true;
    }).sort((a, b) => (a.order || 0) - (b.order || 0));
  })();

  // Drag reorder handlers
  const handleDragStart = (e, itemId) => {
    e.stopPropagation();
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    dragReorderStartY.current = clientY;
    setDragReorderId(itemId);
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

    const currentIndex = activeItems.findIndex(i => i.id === dragReorderId);
    const itemHeight = 52;
    const moveBy = Math.round(dragReorderY / itemHeight);
    const newIndex = Math.max(0, Math.min(activeItems.length - 1, currentIndex + moveBy));

    if (newIndex !== currentIndex) {
      const newList = [...activeItems];
      const [moved] = newList.splice(currentIndex, 1);
      newList.splice(newIndex, 0, moved);

      setStackItems(prev => prev.map(i => {
        const newOrderIndex = newList.findIndex(item => item.id === i.id);
        if (newOrderIndex !== -1) {
          return { ...i, order: newOrderIndex };
        }
        return i;
      }));
      haptic('medium');
    }

    setDragReorderId(null);
    setDragReorderY(0);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {/* Desktop panel header */}
      {isDesktop && (
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{
            fontSize: '13px',
            fontWeight: '600',
            color: '#8b5cf6',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}>
            Supplements
          </span>
        </div>
      )}

      {/* Progress indicator */}
      {displayItems.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: (() => {
              const { taken, total } = getStackProgress();
              if (taken === 0) return '#4b5563';      // gray - none
              if (taken === total) return '#3b82f6';  // blue - all
              return '#f59e0b';                        // orange - some
            })(),
          }} />
          <span style={{ color: '#e5e7eb', fontSize: '14px', flex: 1 }}>
            {getStackProgress().taken} of {getStackProgress().total} completed
          </span>
          {isToday && (() => {
            const { taken, total } = getStackProgress();
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  onClick={() => {
                    if (taken === total) {
                      // Uncheck all
                      setStackEntries(prev => {
                        const newEntries = { ...prev };
                        Object.keys(newEntries).forEach(key => {
                          if (key.startsWith(dateKey)) delete newEntries[key];
                        });
                        return newEntries;
                      });
                      setLastAction('All cleared');
                    } else {
                      // Check all
                      setStackEntries(prev => {
                        const newEntries = { ...prev };
                        displayItems.forEach(item => {
                          const entryKey = `${dateKey}-${item.id}`;
                          if (!newEntries[entryKey]) {
                            newEntries[entryKey] = {
                              date: dateKey,
                              itemId: item.id,
                              dose: item.defaultDose,
                              taken: true,
                            };
                          }
                        });
                        return newEntries;
                      });
                      haptic('success');
                      setLastAction('All selected');
                    }
                  }}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '4px',
                    border: taken === total
                      ? '1px solid rgba(16,185,129,0.4)'
                      : '1px solid rgba(255,255,255,0.2)',
                    background: taken === total
                      ? 'rgba(16,185,129,0.15)'
                      : taken > 0
                        ? 'rgba(245,158,11,0.1)'
                        : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {taken === total && taken > 0 ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ) : taken > 0 ? (
                    <div style={{ width: '10px', height: '2px', background: '#f59e0b', borderRadius: '1px' }} />
                  ) : null}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Stack items - flat row design */}
      {displayItems.map((item, index) => {
        const entry = getStackEntry(item.id);
        const isTaken = !!entry;
        const isEditing = editingStackItem === item.id;

        return (
          <Fragment key={item.id}>
          <div
            style={{
              background: 'transparent',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              cursor: 'pointer',
              opacity: 1,
              transition: isDesktop ? 'background 0.15s ease' : 'none',
            }}
            onMouseEnter={isDesktop ? (e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; } : undefined}
            onMouseLeave={isDesktop ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined}
            onClick={() => !isEditing && !justSavedDose.current && !longPressTriggeredRef.current && toggleStackItem(item.id)}
            onTouchStart={() => {
              longPressTriggeredRef.current = false;
              longPressTimerRef.current = setTimeout(() => {
                longPressTriggeredRef.current = true;
                haptic('medium');
                if (onOpenSupplementGraph) onOpenSupplementGraph(item.id);
              }, 500);
            }}
            onTouchEnd={() => {
              clearTimeout(longPressTimerRef.current);
            }}
            onTouchMove={() => {
              clearTimeout(longPressTimerRef.current);
            }}
          >
            {/* Left side: name + description */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                color: '#e5e7eb',
                fontSize: '17px',
                fontWeight: '400',
                display: 'block',
              }}>
                {item.name}
                {isToday && formatSchedule(item.schedule) && (
                  <span style={{ color: '#9ca3af', fontSize: '13px', marginLeft: '6px' }}>{formatSchedule(item.schedule)}</span>
                )}
                {isToday && !item.active && (
                  <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '4px' }}>(hidden)</span>
                )}
              </span>
              {item.description && (
                <span style={{
                  color: '#6b7280',
                  fontSize: '13px',
                  fontWeight: '400',
                  display: 'block',
                  marginTop: '2px',
                }}>{item.description}</span>
              )}
            </div>

            {/* Desktop: chart icon */}
            {isDesktop && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onOpenSupplementGraph) onOpenSupplementGraph(item.id);
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '6px',
                      padding: '4px 6px',
                      cursor: 'pointer',
                      color: '#9ca3af',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="20" x2="18" y2="10"/>
                      <line x1="12" y1="20" x2="12" y2="4"/>
                      <line x1="6" y1="20" x2="6" y2="14"/>
                    </svg>
                  </button>
                </div>
            )}

            {/* Right side: dose + checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
              {isEditing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                     onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="done"
                    defaultValue={entry?.dose || item.defaultDose}
                    autoFocus
                    style={{
                      width: '60px',
                      background: 'rgba(99, 102, 241, 0.15)',
                      border: '1px solid rgba(99, 102, 241, 0.5)',
                      borderRadius: '4px',
                      padding: '8px 10px',
                      color: '#f8fafc',
                      fontSize: '14px',
                      fontWeight: '500',
                      textAlign: 'center',
                      outline: 'none',
                    }}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        updateStackDose(item.id, e.target.value);
                      } else if (e.key === 'Escape') {
                        setEditingStackItem(null);
                      }
                    }}
                    onBlur={(e) => updateStackDose(item.id, e.target.value)}
                  />
                  <span style={{ color: '#9ca3af', fontSize: '13px' }}>{item.unit}</span>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '4px',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingStackItem(item.id);
                  }}
                >
                  <span style={{
                    color: '#9ca3af',
                    fontSize: '14px',
                    fontWeight: '400',
                  }}>
                    {entry?.dose || item.defaultDose}
                  </span>
                  <span style={{
                    color: '#6b7280',
                    fontSize: '13px',
                  }}>
                    {item.unit}
                  </span>
                </div>
              )}

              {/* Checkbox */}
              <div
                onClick={(e) => {
                  if (isEditing) {
                    e.stopPropagation();
                    // Find the input and save its value
                    const input = e.currentTarget.parentElement.querySelector('input');
                    const newDose = input ? parseFloat(input.value) : null;
                    const entryKey = `${dateKey}-${item.id}`;
                    if (!stackEntries[entryKey]) {
                      // Not taken yet - create entry with the custom dose
                      setStackEntries(prev => ({
                        ...prev,
                        [entryKey]: {
                          date: dateKey,
                          itemId: item.id,
                          dose: newDose || item.defaultDose,
                          taken: true
                        }
                      }));
                      setLastAction(`Took ${item.name}`);
                    } else if (newDose != null) {
                      // Already taken - just save the dose
                      setStackEntries(prev => ({
                        ...prev,
                        [entryKey]: { ...prev[entryKey], dose: newDose || 0 }
                      }));
                      setLastAction(`Updated ${item.name} to ${newDose}${item.unit}`);
                    }
                    setEditingStackItem(null);
                    haptic('light');
                  }
                }}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '6px',
                  border: isTaken
                    ? '1px solid rgba(16,185,129,0.3)'
                    : '1px solid rgba(255,255,255,0.1)',
                  background: isTaken
                    ? 'rgba(16,185,129,0.15)'
                    : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {isTaken && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                )}
              </div>
            </div>
          </div>
          </Fragment>
        );
      })}

      {/* Manage/Log buttons at bottom of list */}
      {!showManageStack && isToday && (
        <button
          onClick={() => setShowManageStack(true)}
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
          Manage stack
        </button>
      )}
      {!showManageStack && !isToday && availableToLog.length > 0 && (
        <button
          onClick={() => { setShowHiddenInPicker(false); setShowLogPicker(true); }}
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
          Log supplement
        </button>
      )}


      {/* Manage Stack Modal */}
      {showManageStack && (
        isDesktop ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 1000,
              display: 'flex',
              justifyContent: 'flex-end',
            }}
            onClick={() => setShowManageStack(false)}
          >
            <div
              style={{
                width: '420px',
                height: '100%',
                background: '#1a1b1e',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                flexDirection: 'column',
                animation: 'slideInRight 0.2s ease-out',
                position: 'relative',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{
                padding: '24px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}>
                <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
                  Manage stack
                </h3>
                <button
                  onClick={() => setShowManageStack(false)}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#9ca3af',
                    fontSize: '14px',
                    cursor: 'pointer',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
          {/* Scrollable Content */}
          <div
            ref={manageScrollRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              padding: '12px 16px',
              paddingBottom: '20px',
            }}
          >
            <div style={{ maxWidth: '500px', margin: '0 auto' }}>

            {/* Add Form (at top, when expanded) */}
            {showAddForm && (
              <div style={{
                background: 'rgba(15, 17, 21, 0.6)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                animation: 'slideDown 0.2s ease-out',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Supplement name"
                      value={newStackItem.name}
                      onChange={(e) => setNewStackItem({...newStackItem, name: e.target.value})}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                      autoFocus
                      style={{
                        width: '100%',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '2px solid rgba(99, 102, 241, 0.3)',
                        borderRadius: '5px',
                        padding: '12px 14px',
                        color: '#f8fafc',
                        fontSize: '15px',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
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
                        {suggestions.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              toggleStackItemActive(item.id);
                              setNewStackItem({ name: '', unit: 'mg', defaultDose: '', description: '', schedule: { type: 'daily' } });
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
                            <span>{item.name}</span>
                            <span style={{ color: '#6b7280', fontSize: '12px' }}>Restore</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={newStackItem.description}
                    onChange={(e) => setNewStackItem({...newStackItem, description: e.target.value})}
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '2px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: '5px',
                      padding: '12px 14px',
                      color: '#f8fafc',
                      fontSize: '15px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Dose"
                      value={newStackItem.defaultDose}
                      onChange={(e) => setNewStackItem({...newStackItem, defaultDose: e.target.value})}
                      style={{
                        width: '80px',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '2px solid rgba(99, 102, 241, 0.3)',
                        borderRadius: '5px',
                        padding: '12px 14px',
                        color: '#f8fafc',
                        fontSize: '15px',
                        textAlign: 'center',
                        outline: 'none',
                      }}
                    />
                    <select
                      value={newStackItem.unit}
                      onChange={(e) => setNewStackItem({...newStackItem, unit: e.target.value})}
                      style={{
                        width: '80px',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '2px solid rgba(99, 102, 241, 0.3)',
                        borderRadius: '5px',
                        padding: '12px 10px',
                        color: '#f8fafc',
                        fontSize: '15px',
                      }}
                    >
                      <option value="mg">mg</option>
                      <option value="mcg">mcg</option>
                      <option value="g">g</option>
                      <option value="IU">IU</option>
                      <option value="ml">ml</option>
                      <option value="drops">drops</option>
                      <option value="caps">caps</option>
                    </select>
                  </div>
                  <div style={{ marginTop: '4px' }}>
                    <label style={{
                      color: '#64748b',
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '8px',
                      display: 'block',
                    }}>Schedule</label>
                    <SchedulePicker
                      schedule={newStackItem.schedule}
                      onChange={(schedule) => setNewStackItem({...newStackItem, schedule})}
                    />
                  </div>
                  <button
                    onClick={addStackItem}
                    disabled={!newStackItem.name.trim() || !newStackItem.defaultDose}
                    style={{
                      marginTop: '10px',
                      width: '100%',
                      background: (!newStackItem.name.trim() || !newStackItem.defaultDose)
                        ? 'rgba(99, 102, 241, 0.3)'
                        : '#6366f1',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '12px',
                      color: '#fff',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: (!newStackItem.name.trim() || !newStackItem.defaultDose) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Add Supplement
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewStackItem({ name: '', unit: 'mg', defaultDose: '', description: '', schedule: { type: 'daily' } });
                    }}
                    style={{
                      marginTop: '6px',
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: '10px',
                      color: '#6b7280',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Active Items */}
            {activeItems.length > 0 && (() => {
              const dragCurrentIndex = dragReorderId ? activeItems.findIndex(i => i.id === dragReorderId) : -1;
              const itemHeight = 52;
              const dragTargetIndex = dragReorderId ? Math.max(0, Math.min(activeItems.length - 1, dragCurrentIndex + Math.round(dragReorderY / itemHeight))) : -1;

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
                }}>Active ({activeItems.length})</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {activeItems.map((item, index) => {
                    const isDraggingThis = dragReorderId === item.id;
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
                      key={item.id}
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
                        onTouchStart={(e) => handleDragStart(e, item.id)}
                        onMouseDown={(e) => handleDragStart(e, item.id)}
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
                        onClick={() => setEditingSupplementId(item.id)}
                        style={{
                          cursor: 'pointer',
                          flex: 1,
                        }}
                      >
                        <span style={{ color: '#e2e8f0', fontSize: '15px' }}>
                          {item.name}
                          {formatSchedule(item.schedule) && (
                            <span style={{ color: '#9ca3af', fontSize: '13px', marginLeft: '6px' }}>{formatSchedule(item.schedule)}</span>
                          )}
                        </span>
                        <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '8px' }}>
                          {item.defaultDose}{item.unit}
                        </span>
                        {item.description && (
                          <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>
                            {item.description}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => toggleStackItemActive(item.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '3px',
                          padding: '6px 12px',
                          color: '#f87171',
                          fontSize: '12px',
                          cursor: 'pointer',
                          flexShrink: 0,
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

            {/* Inactive Items - Collapsible */}
            {inactiveItems.length > 0 && (
              <div>
                <button
                  onClick={() => setShowHiddenItems(!showHiddenItems)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: '0',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: showHiddenItems ? '12px' : '0',
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
                      transform: showHiddenItems ? 'rotate(90deg)' : 'rotate(0deg)',
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
                  }}>Hidden ({inactiveItems.length})</label>
                </button>
                {showHiddenItems && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    animation: 'slideDown 0.2s ease-out',
                  }}>
                    {inactiveItems.map((item) => {
                      const isConfirming = confirmingDeleteId === item.id;
                      const entryCount = isConfirming ? getEntryCountForItem(item.id) : 0;
                      return (
                      <div key={item.id}>
                        <div
                          style={{
                            background: 'rgba(15, 17, 21, 0.3)',
                            borderRadius: '3px',
                            padding: '12px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <span style={{ color: '#64748b', fontSize: '15px', flex: 1 }}>
                            {item.name}
                          </span>
                          <button
                            onClick={() => toggleStackItemActive(item.id)}
                            style={{
                              background: 'rgba(34, 197, 94, 0.15)',
                              border: '1px solid rgba(34, 197, 94, 0.3)',
                              borderRadius: '3px',
                              padding: '6px 12px',
                              color: '#4ade80',
                              fontSize: '12px',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => setConfirmingDeleteId(isConfirming ? null : item.id)}
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              borderRadius: '3px',
                              padding: '6px 10px',
                              color: '#f87171',
                              fontSize: '12px',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            Delete
                          </button>
                        </div>
                        {isConfirming && (
                          <div style={{
                            background: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            borderRadius: '3px',
                            padding: '12px 16px',
                            marginTop: '4px',
                            animation: 'slideDown 0.15s ease-out',
                          }}>
                            <div style={{ color: '#fca5a5', fontSize: '13px', marginBottom: '10px' }}>
                              {entryCount > 0
                                ? `Permanently delete "${item.name}" and ${entryCount} historical record${entryCount === 1 ? '' : 's'}?`
                                : `Permanently delete "${item.name}"?`}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => deleteStackItem(item.id)}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.3)',
                                  border: '1px solid rgba(239, 68, 68, 0.5)',
                                  borderRadius: '3px',
                                  padding: '8px 16px',
                                  color: '#fca5a5',
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                }}
                              >
                                Delete forever
                              </button>
                              <button
                                onClick={() => setConfirmingDeleteId(null)}
                                style={{
                                  background: 'rgba(255, 255, 255, 0.05)',
                                  border: '1px solid rgba(255, 255, 255, 0.1)',
                                  borderRadius: '3px',
                                  padding: '8px 16px',
                                  color: '#9ca3af',
                                  fontSize: '13px',
                                  cursor: 'pointer',
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
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
                  padding: '16px 20px',
                  background: 'transparent',
                  border: 'none',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#9ca3af',
                  fontSize: '14px',
                  fontWeight: '400',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '18px', color: '#6b7280' }}>+</span>
                Add new supplement
              </button>
            )}
            </div>
          </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: '#08090A',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              animation: 'modalIn 0.2s ease-out',
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
              padding: '12px 16px',
              paddingBottom: '20px',
            }}
          >
            <div style={{ maxWidth: '500px', margin: '0 auto' }}>

            {/* Add Form (at top, when expanded) */}
            {showAddForm && (
              <div style={{
                background: 'rgba(15, 17, 21, 0.6)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                animation: 'slideDown 0.2s ease-out',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="Supplement name"
                      value={newStackItem.name}
                      onChange={(e) => setNewStackItem({...newStackItem, name: e.target.value})}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                      autoFocus
                      style={{
                        width: '100%',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '2px solid rgba(99, 102, 241, 0.3)',
                        borderRadius: '5px',
                        padding: '12px 14px',
                        color: '#f8fafc',
                        fontSize: '15px',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
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
                        {suggestions.map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              toggleStackItemActive(item.id);
                              setNewStackItem({ name: '', unit: 'mg', defaultDose: '', description: '', schedule: { type: 'daily' } });
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
                            <span>{item.name}</span>
                            <span style={{ color: '#6b7280', fontSize: '12px' }}>Restore</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={newStackItem.description}
                    onChange={(e) => setNewStackItem({...newStackItem, description: e.target.value})}
                    style={{
                      width: '100%',
                      background: 'rgba(15, 23, 42, 0.8)',
                      border: '2px solid rgba(99, 102, 241, 0.3)',
                      borderRadius: '5px',
                      padding: '12px 14px',
                      color: '#f8fafc',
                      fontSize: '15px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Dose"
                      value={newStackItem.defaultDose}
                      onChange={(e) => setNewStackItem({...newStackItem, defaultDose: e.target.value})}
                      style={{
                        width: '80px',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '2px solid rgba(99, 102, 241, 0.3)',
                        borderRadius: '5px',
                        padding: '12px 14px',
                        color: '#f8fafc',
                        fontSize: '15px',
                        textAlign: 'center',
                        outline: 'none',
                      }}
                    />
                    <select
                      value={newStackItem.unit}
                      onChange={(e) => setNewStackItem({...newStackItem, unit: e.target.value})}
                      style={{
                        width: '80px',
                        background: 'rgba(15, 23, 42, 0.8)',
                        border: '2px solid rgba(99, 102, 241, 0.3)',
                        borderRadius: '5px',
                        padding: '12px 10px',
                        color: '#f8fafc',
                        fontSize: '15px',
                      }}
                    >
                      <option value="mg">mg</option>
                      <option value="mcg">mcg</option>
                      <option value="g">g</option>
                      <option value="IU">IU</option>
                      <option value="ml">ml</option>
                      <option value="drops">drops</option>
                      <option value="caps">caps</option>
                    </select>
                  </div>
                  <div style={{ marginTop: '4px' }}>
                    <label style={{
                      color: '#64748b',
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '8px',
                      display: 'block',
                    }}>Schedule</label>
                    <SchedulePicker
                      schedule={newStackItem.schedule}
                      onChange={(schedule) => setNewStackItem({...newStackItem, schedule})}
                    />
                  </div>
                  <button
                    onClick={addStackItem}
                    disabled={!newStackItem.name.trim() || !newStackItem.defaultDose}
                    style={{
                      marginTop: '10px',
                      width: '100%',
                      background: (!newStackItem.name.trim() || !newStackItem.defaultDose)
                        ? 'rgba(99, 102, 241, 0.3)'
                        : '#6366f1',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '12px',
                      color: '#fff',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: (!newStackItem.name.trim() || !newStackItem.defaultDose) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Add Supplement
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewStackItem({ name: '', unit: 'mg', defaultDose: '', description: '', schedule: { type: 'daily' } });
                    }}
                    style={{
                      marginTop: '6px',
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      padding: '10px',
                      color: '#6b7280',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Active Items */}
            {activeItems.length > 0 && (() => {
              const dragCurrentIndex = dragReorderId ? activeItems.findIndex(i => i.id === dragReorderId) : -1;
              const itemHeight = 52;
              const dragTargetIndex = dragReorderId ? Math.max(0, Math.min(activeItems.length - 1, dragCurrentIndex + Math.round(dragReorderY / itemHeight))) : -1;

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
                }}>Active ({activeItems.length})</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {activeItems.map((item, index) => {
                    const isDraggingThis = dragReorderId === item.id;
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
                      key={item.id}
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
                        onTouchStart={(e) => handleDragStart(e, item.id)}
                        onMouseDown={(e) => handleDragStart(e, item.id)}
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
                        onClick={() => setEditingSupplementId(item.id)}
                        style={{
                          cursor: 'pointer',
                          flex: 1,
                        }}
                      >
                        <span style={{ color: '#e2e8f0', fontSize: '15px' }}>
                          {item.name}
                          {formatSchedule(item.schedule) && (
                            <span style={{ color: '#9ca3af', fontSize: '13px', marginLeft: '6px' }}>{formatSchedule(item.schedule)}</span>
                          )}
                        </span>
                        <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '8px' }}>
                          {item.defaultDose}{item.unit}
                        </span>
                        {item.description && (
                          <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>
                            {item.description}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => toggleStackItemActive(item.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '3px',
                          padding: '6px 12px',
                          color: '#f87171',
                          fontSize: '12px',
                          cursor: 'pointer',
                          flexShrink: 0,
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

            {/* Inactive Items - Collapsible */}
            {inactiveItems.length > 0 && (
              <div>
                <button
                  onClick={() => setShowHiddenItems(!showHiddenItems)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: '0',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: showHiddenItems ? '12px' : '0',
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
                      transform: showHiddenItems ? 'rotate(90deg)' : 'rotate(0deg)',
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
                  }}>Hidden ({inactiveItems.length})</label>
                </button>
                {showHiddenItems && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    animation: 'slideDown 0.2s ease-out',
                  }}>
                    {inactiveItems.map((item) => {
                      const isConfirming = confirmingDeleteId === item.id;
                      const entryCount = isConfirming ? getEntryCountForItem(item.id) : 0;
                      return (
                      <div key={item.id}>
                        <div
                          style={{
                            background: 'rgba(15, 17, 21, 0.3)',
                            borderRadius: '3px',
                            padding: '12px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                          }}
                        >
                          <span style={{ color: '#64748b', fontSize: '15px', flex: 1 }}>
                            {item.name}
                          </span>
                          <button
                            onClick={() => toggleStackItemActive(item.id)}
                            style={{
                              background: 'rgba(34, 197, 94, 0.15)',
                              border: '1px solid rgba(34, 197, 94, 0.3)',
                              borderRadius: '3px',
                              padding: '6px 12px',
                              color: '#4ade80',
                              fontSize: '12px',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => setConfirmingDeleteId(isConfirming ? null : item.id)}
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              borderRadius: '3px',
                              padding: '6px 10px',
                              color: '#f87171',
                              fontSize: '12px',
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            Delete
                          </button>
                        </div>
                        {isConfirming && (
                          <div style={{
                            background: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            borderRadius: '3px',
                            padding: '12px 16px',
                            marginTop: '4px',
                            animation: 'slideDown 0.15s ease-out',
                          }}>
                            <div style={{ color: '#fca5a5', fontSize: '13px', marginBottom: '10px' }}>
                              {entryCount > 0
                                ? `Permanently delete "${item.name}" and ${entryCount} historical record${entryCount === 1 ? '' : 's'}?`
                                : `Permanently delete "${item.name}"?`}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => deleteStackItem(item.id)}
                                style={{
                                  background: 'rgba(239, 68, 68, 0.3)',
                                  border: '1px solid rgba(239, 68, 68, 0.5)',
                                  borderRadius: '3px',
                                  padding: '8px 16px',
                                  color: '#fca5a5',
                                  fontSize: '13px',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                }}
                              >
                                Delete forever
                              </button>
                              <button
                                onClick={() => setConfirmingDeleteId(null)}
                                style={{
                                  background: 'rgba(255, 255, 255, 0.05)',
                                  border: '1px solid rgba(255, 255, 255, 0.1)',
                                  borderRadius: '3px',
                                  padding: '8px 16px',
                                  color: '#9ca3af',
                                  fontSize: '13px',
                                  cursor: 'pointer',
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
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
                  padding: '16px 20px',
                  background: 'transparent',
                  border: 'none',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#9ca3af',
                  fontSize: '14px',
                  fontWeight: '400',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '18px', color: '#6b7280' }}>+</span>
                Add new supplement
              </button>
            )}
            </div>
          </div>
          </div>
        )
      )}

      {/* Log Picker */}
      {showLogPicker && (() => {
        const logPickerList = (
          <div style={{
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            flex: 1,
          }}>
            {availableToLog.length === 0 ? (
              <div style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#6b7280',
                fontSize: '14px',
              }}>
                All supplements have been logged for this day.
              </div>
            ) : availableToLog.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  haptic('light');
                  toggleStackItem(item.id);
                  setShowLogPicker(false);
                }}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  color: '#e5e7eb',
                  fontSize: '15px',
                  fontWeight: '400',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  textAlign: 'left',
                }}
              >
                <div>
                  <span>{item.name}</span>
                  {!item.active && (
                    <span style={{ color: '#6b7280', fontSize: '11px', marginLeft: '4px' }}>(hidden)</span>
                  )}
                  {item.description && (
                    <span style={{ color: '#6b7280', fontSize: '13px', marginLeft: '8px' }}>
                      {item.description}
                    </span>
                  )}
                </div>
                <span style={{ color: '#6b7280', fontSize: '14px' }}>
                  {item.defaultDose} {item.unit}
                </span>
              </button>
            ))}
            {/* Show hidden toggle */}
            <button
              onClick={() => setShowHiddenInPicker(prev => !prev)}
              style={{
                width: '100%',
                padding: '12px 20px',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                color: showHiddenInPicker ? '#a78bfa' : '#6b7280',
                fontSize: '13px',
                fontWeight: '400',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ fontSize: '14px' }}>{showHiddenInPicker ? '◉' : '○'}</span>
              Show hidden
            </button>
            {/* Add new supplement option */}
            <button
              onClick={() => {
                pendingLogAfterAdd.current = true;
                setShowLogPicker(false);
                setShowManageStack(true);
                setShowAddForm(true);
              }}
              style={{
                width: '100%',
                padding: '16px 20px',
                background: 'transparent',
                border: 'none',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#9ca3af',
                fontSize: '14px',
                fontWeight: '400',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span style={{ fontSize: '18px', color: '#6b7280' }}>+</span>
              Add new supplement
            </button>
          </div>
        );

        return isDesktop ? (
          /* Desktop: side panel */
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 1000,
              display: 'flex',
              justifyContent: 'flex-end',
            }}
            onClick={() => setShowLogPicker(false)}
          >
            <div
              style={{
                width: '380px',
                height: '100%',
                background: '#1a1b1e',
                borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                flexDirection: 'column',
                animation: 'slideInRight 0.2s ease-out',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{
                padding: '24px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0,
              }}>
                <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
                  Log supplement
                </h3>
                <button
                  onClick={() => setShowLogPicker(false)}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#9ca3af',
                    fontSize: '14px',
                    cursor: 'pointer',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
              {logPickerList}
            </div>
          </div>
        ) : (
          /* Mobile: bottom sheet */
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              zIndex: 1000,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              paddingBottom: '76px',
            }}
            onClick={() => setShowLogPicker(false)}
          >
            <div
              style={{
                background: '#1a1b1e',
                borderRadius: '16px',
                width: 'calc(100% - 32px)',
                maxWidth: '500px',
                maxHeight: '50vh',
                display: 'flex',
                flexDirection: 'column',
                animation: 'modalIn 0.2s ease-out',
                marginBottom: '8px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div style={{
                padding: '20px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
                  Log supplement
                </h3>
                <button
                  onClick={() => setShowLogPicker(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#6b7280',
                    fontSize: '14px',
                    cursor: 'pointer',
                    padding: '8px 12px',
                  }}
                >
                  Cancel
                </button>
              </div>
              {logPickerList}
            </div>
          </div>
        );
      })()}

      {/* Full-screen Supplement Edit */}
      {editingSupplementId && (
        <SupplementEdit
          item={stackItems.find(i => i.id === editingSupplementId)}
          onSave={handleSupplementSave}
          onCancel={() => setEditingSupplementId(null)}
        />
      )}
    </div>
  );
}
