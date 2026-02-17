import { useState, useRef, useEffect } from 'react';
import { getDateKey, haptic, isScheduledForDate, createHistoryEntry, recordHistoryChange, reconstructStateAtDate } from '../utils/helpers';
import SchedulePicker, { formatSchedule } from './SchedulePicker';
import SupplementEdit from './SupplementEdit';

export default function Stack({
  stackItems,
  setStackItems,
  stackEntries,
  setStackEntries,
  selectedDate,
  setLastAction,
  showManageStack,
  setShowManageStack,
}) {
  const [editingStackItem, setEditingStackItem] = useState(null);
  const [newStackItem, setNewStackItem] = useState({ name: '', unit: 'mg', defaultDose: '', description: '', schedule: { type: 'daily' } });
  const [editingSupplementId, setEditingSupplementId] = useState(null);
  const [showLogPicker, setShowLogPicker] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Prevent row click from toggling right after dose blur save
  const justSavedDose = useRef(false);

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
    // Use same logic as displayItems to count what's actually shown
    const active = stackItems.filter(i => i.active);

    let itemsToCount;
    if (isToday) {
      // Only count items scheduled for today
      itemsToCount = active.filter(item => isScheduledForDate(item.schedule, selectedDate));
    } else {
      // Past dates: ONLY show items that have entries for this date
      const itemIdsWithEntries = new Set(
        Object.keys(stackEntries)
          .filter(key => key.startsWith(dateKey))
          .map(key => key.substring(dateKey.length + 1))
      );
      itemsToCount = stackItems.filter(i => itemIdsWithEntries.has(i.id));
    }

    const takenCount = itemsToCount.filter(item =>
      stackEntries[`${dateKey}-${item.id}`]
    ).length;
    return { taken: takenCount, total: itemsToCount.length };
  };

  const addStackItem = () => {
    if (!newStackItem.name.trim() || !newStackItem.defaultDose) return;

    const id = newStackItem.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
    const maxOrder = Math.max(-1, ...stackItems.map(i => i.order || 0));

    // Ensure schedule has a startDate (default to today)
    const schedule = newStackItem.schedule?.startDate
      ? newStackItem.schedule
      : { ...newStackItem.schedule, startDate: new Date().toISOString().split('T')[0] };

    const newItem = {
      id: id,
      name: newStackItem.name.trim(),
      unit: newStackItem.unit,
      defaultDose: parseFloat(newStackItem.defaultDose),
      description: newStackItem.description.trim() || '',
      schedule: schedule,
      active: true,
      order: maxOrder + 1
    };

    // Add history entry for creation
    newItem.history = [createHistoryEntry(newItem)];

    setStackItems([...stackItems, newItem]);

    setNewStackItem({ name: '', unit: 'mg', defaultDose: '', description: '', schedule: { type: 'daily' } });
    setShowAddForm(false);
    setLastAction(`Added ${newStackItem.name}`);
  };

  const toggleStackItemActive = (itemId) => {
    setStackItems(stackItems.map(item => {
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

  const handleSupplementSave = (updatedData) => {
    if (updatedData.name.trim() && editingSupplementId) {
      const newDefaultDose = parseFloat(updatedData.defaultDose);

      setStackItems(stackItems.map(item => {
        if (item.id !== editingSupplementId) return item;

        const newValues = {
          name: updatedData.name.trim(),
          defaultDose: newDefaultDose || item.defaultDose,
          unit: updatedData.unit,
          description: updatedData.description.trim(),
          schedule: updatedData.schedule,
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

      // Also update today's entry if it exists, so display updates immediately
      const entryKey = `${dateKey}-${editingSupplementId}`;
      if (newDefaultDose) {
        setStackEntries(prev => {
          if (!prev[entryKey]) return prev;
          return {
            ...prev,
            [entryKey]: {
              ...prev[entryKey],
              dose: newDefaultDose
            }
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

  // Supplements available to log retroactively (active items without entries for this date, respecting schedule)
  const availableToLog = stackItems.filter(i => {
    if (!i.active || stackEntries[`${dateKey}-${i.id}`]) return false;
    // Don't offer to log items that didn't exist on this date
    if (i.schedule?.startDate) {
      const start = new Date(i.schedule.startDate);
      start.setHours(0, 0, 0, 0);
      const target = new Date(selectedDate);
      target.setHours(0, 0, 0, 0);
      if (target < start) return false;
    }
    return true;
  }).sort((a, b) => (a.order || 0) - (b.order || 0));

  // Determine which items to display based on date
  const displayItems = (() => {
    const active = stackItems.filter(i => i.active);

    // Today: show active items that are scheduled for today
    if (isToday) {
      return active.filter(item => isScheduledForDate(item.schedule, selectedDate));
    }

    // Past dates: ONLY show items that have entries for this date
    // Use historical state so properties reflect what they were at that time
    const itemIdsWithEntries = new Set(
      Object.keys(stackEntries)
        .filter(key => key.startsWith(dateKey))
        .map(key => key.substring(dateKey.length + 1))
    );

    return stackItems.filter(i => itemIdsWithEntries.has(i.id)).map(i => {
      const historical = reconstructStateAtDate(i.history, dateKey);
      if (!historical) return i;
      return { ...i, name: historical.name, description: historical.description, unit: historical.unit, defaultDose: historical.defaultDose, schedule: historical.schedule };
    });
  })().sort((a, b) => (a.order || 0) - (b.order || 0));

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

      setStackItems(stackItems.map(i => {
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
                      const newEntries = { ...stackEntries };
                      Object.keys(newEntries).forEach(key => {
                        if (key.startsWith(dateKey)) delete newEntries[key];
                      });
                      setStackEntries(newEntries);
                      setLastAction('All cleared');
                    } else {
                      // Check all
                      const newEntries = { ...stackEntries };
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
                      setStackEntries(newEntries);
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
          <div
            key={item.id}
            style={{
              background: 'transparent',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              cursor: 'pointer',
            }}
            onClick={() => !isEditing && !justSavedDose.current && toggleStackItem(item.id)}
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
        );
      })}

      {/* Add/Log Supplement Button - at bottom of list */}
      {!showManageStack && (
        isToday ? (
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
        ) : availableToLog.length > 0 && (
          <button
            onClick={() => setShowLogPicker(true)}
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
        )
      )}


      {/* Manage Stack Modal */}
      {showManageStack && (
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
            style={{
              flex: 1,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              padding: '12px 16px',
              paddingBottom: '120px',
            }}
          >
            <div style={{ maxWidth: '500px', margin: '0 auto' }}>

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

            {/* Add Supplement Button/Form */}
            {!showAddForm ? (
              <button
                onClick={() => setShowAddForm(true)}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: 'rgba(139, 92, 246, 0.06)',
                  border: '2px dashed rgba(139, 92, 246, 0.3)',
                  borderRadius: '12px',
                  color: '#a78bfa',
                  fontSize: '15px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  marginBottom: '20px',
                }}
              >
                + Add Supplement
              </button>
            ) : (
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
                    {/* Autocomplete dropdown for hidden supplements */}
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
                </div>
              </div>
            )}

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
                    {inactiveItems.map((item) => (
                      <div
                        key={item.id}
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

          {/* Floating Done Button */}
          <button
            onClick={() => {
              setShowManageStack(false);
            }}
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
              zIndex: 10,
            }}
          >
            Done
          </button>
        </div>
      )}

      {/* Log Picker Modal (for past dates) */}
      {showLogPicker && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingBottom: '76px', // Account for bottom nav height
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

            {/* Supplement list */}
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
            </div>
          </div>
        </div>
      )}

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
