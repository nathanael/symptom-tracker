import { useState, useRef, useEffect } from 'react';
import { getDateKey, haptic } from '../utils/helpers';

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
  const [newStackItem, setNewStackItem] = useState({ name: '', unit: 'mg', defaultDose: '', description: '' });
  const [editingStackItemId, setEditingStackItemId] = useState(null);
  const [editingStackItemData, setEditingStackItemData] = useState({ name: '', defaultDose: '', unit: 'mg', description: '' });

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

    if (stackEntries[entryKey]) {
      const newEntries = { ...stackEntries };
      delete newEntries[entryKey];
      setStackEntries(newEntries);
      setLastAction(`Removed ${item?.name}`);
    } else {
      setStackEntries({
        ...stackEntries,
        [entryKey]: {
          date: dateKey,
          itemId: itemId,
          dose: item?.defaultDose || 0,
          taken: true
        }
      });
      setLastAction(`Took ${item?.name}`);
    }
  };

  const updateStackDose = (itemId, newDose) => {
    const entryKey = `${dateKey}-${itemId}`;
    const item = stackItems.find(i => i.id === itemId);

    setStackEntries({
      ...stackEntries,
      [entryKey]: {
        date: dateKey,
        itemId: itemId,
        dose: parseFloat(newDose) || 0,
        taken: true
      }
    });
    setEditingStackItem(null);
    setLastAction(`Updated ${item?.name} to ${newDose}${item?.unit}`);
  };

  const getStackEntry = (itemId) => {
    return stackEntries[`${dateKey}-${itemId}`];
  };

  const getStackProgress = () => {
    // Use same logic as displayItems to count what's actually shown
    const active = stackItems.filter(i => i.active);

    let itemsToCount;
    if (isToday) {
      itemsToCount = active;
    } else {
      // Past date: include hidden items with entries
      const itemIdsWithEntries = new Set(
        Object.keys(stackEntries)
          .filter(key => key.startsWith(dateKey))
          .map(key => key.substring(dateKey.length + 1))
      );
      const hiddenWithEntries = stackItems.filter(
        i => !i.active && itemIdsWithEntries.has(i.id)
      );
      itemsToCount = [...active, ...hiddenWithEntries];
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

    setStackItems([...stackItems, {
      id: id,
      name: newStackItem.name.trim(),
      unit: newStackItem.unit,
      defaultDose: parseFloat(newStackItem.defaultDose),
      description: newStackItem.description.trim() || '',
      active: true,
      order: maxOrder + 1
    }]);

    setNewStackItem({ name: '', unit: 'mg', defaultDose: '', description: '' });
    setLastAction(`Added ${newStackItem.name}`);
  };

  const toggleStackItemActive = (itemId) => {
    setStackItems(stackItems.map(item =>
      item.id === itemId ? { ...item, active: !item.active } : item
    ));
  };

  const startEditingStackItem = (item) => {
    setEditingStackItemId(item.id);
    setEditingStackItemData({ name: item.name, defaultDose: item.defaultDose, unit: item.unit, description: item.description || '' });
  };

  const saveStackItemEdit = () => {
    if (editingStackItemData.name.trim() && editingStackItemId) {
      setStackItems(stackItems.map(item =>
        item.id === editingStackItemId
          ? { ...item, name: editingStackItemData.name.trim(), defaultDose: editingStackItemData.defaultDose, unit: editingStackItemData.unit, description: editingStackItemData.description.trim() }
          : item
      ));
    }
    setEditingStackItemId(null);
    setEditingStackItemData({ name: '', defaultDose: '', unit: 'mg', description: '' });
  };

  const handleEditBlur = (e) => {
    // Check if focus is moving to another element within the same edit form
    const container = e.currentTarget.closest('[data-edit-form]');
    if (container && container.contains(e.relatedTarget)) {
      return; // Don't save yet, user is moving to another field in the form
    }
    saveStackItemEdit();
  };

  const deleteStackItem = (itemId) => {
    setStackItems(stackItems.filter(item => item.id !== itemId));
  };

  const activeItems = stackItems.filter(i => i.active).sort((a, b) => (a.order || 0) - (b.order || 0));
  const inactiveItems = stackItems.filter(i => !i.active);

  // Determine which items to display based on date
  const displayItems = (() => {
    const active = stackItems.filter(i => i.active);

    // Today: only show active items
    if (isToday) {
      return active;
    }

    // Past date: show active + any hidden items with entries for this date
    const itemIdsWithEntries = new Set(
      Object.keys(stackEntries)
        .filter(key => key.startsWith(dateKey))
        .map(key => key.substring(dateKey.length + 1))
    );

    const hiddenWithEntries = stackItems.filter(
      i => !i.active && itemIdsWithEntries.has(i.id)
    );

    return [...active, ...hiddenWithEntries];
  })().sort((a, b) => (a.order || 0) - (b.order || 0));

  // Drag reorder handlers
  const handleDragStart = (e, itemId) => {
    e.stopPropagation();
    const touch = e.touches[0];
    dragReorderStartY.current = touch.clientY;
    setDragReorderId(itemId);
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
      {/* Progress indicator - sticky */}
      {displayItems.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          position: 'sticky',
          top: 0,
          background: '#08090A',
          zIndex: 10,
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
          <span style={{ color: '#e5e7eb', fontSize: '14px' }}>
            {getStackProgress().taken} of {getStackProgress().total} completed
          </span>
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
              padding: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              cursor: 'pointer',
            }}
            onClick={() => !isEditing && toggleStackItem(item.id)}
          >
            {/* Left side: name + description */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                color: '#e5e7eb',
                fontSize: '15px',
                fontWeight: '400',
                display: 'block',
              }}>
                {item.name}
                {!item.active && (
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
                }}>({item.description})</span>
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

      {/* Add Supplement Button - at bottom of list */}
      {!showManageStack && (
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
          Add supplement
        </button>
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
          {/* Sticky Header + Add Section */}
          <div style={{
            flexShrink: 0,
            background: '#08090A',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '20px',
          }}>
            <div style={{ maxWidth: '500px', margin: '0 auto' }}>
              <h2 style={{ color: '#f8fafc', fontSize: '24px', fontWeight: '700', margin: '0 0 16px 0', letterSpacing: '-0.5px' }}>
                Supplements
              </h2>
              {/* Add new item */}
              <div style={{
                background: 'rgba(15, 17, 21, 0.6)',
                borderRadius: '3px',
                padding: '16px',
              }}>
                <label style={{
                  color: '#94a3b8',
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}>Add New Supplement</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                  <input
                    type="text"
                    placeholder="Supplement name"
                    value={newStackItem.name}
                    onChange={(e) => setNewStackItem({...newStackItem, name: e.target.value})}
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
                    <button
                      onClick={addStackItem}
                      disabled={!newStackItem.name.trim() || !newStackItem.defaultDose}
                      style={{
                        flex: 1,
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
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable Content */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
              padding: '20px',
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
                        padding: '10px 12px',
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

                      {editingStackItemId === item.id ? (
                        <div data-edit-form style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <input
                            value={editingStackItemData.name}
                            onChange={(e) => setEditingStackItemData({...editingStackItemData, name: e.target.value})}
                            placeholder="Name"
                            autoFocus
                            enterKeyHint="done"
                            onBlur={handleEditBlur}
                            style={{
                              width: '100%',
                              background: 'rgba(99, 102, 241, 0.15)',
                              border: '2px solid rgba(99, 102, 241, 0.5)',
                              borderRadius: '3px',
                              padding: '8px 12px',
                              color: '#f8fafc',
                              fontSize: '14px',
                              boxSizing: 'border-box',
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveStackItemEdit();
                              if (e.key === 'Escape') {
                                setEditingStackItemId(null);
                                setEditingStackItemData({ name: '', defaultDose: '', unit: 'mg', description: '' });
                              }
                            }}
                          />
                          <input
                            value={editingStackItemData.description}
                            onChange={(e) => setEditingStackItemData({...editingStackItemData, description: e.target.value})}
                            placeholder="Description (optional)"
                            enterKeyHint="done"
                            onBlur={handleEditBlur}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveStackItemEdit();
                            }}
                            style={{
                              width: '100%',
                              background: 'rgba(99, 102, 241, 0.15)',
                              border: '2px solid rgba(99, 102, 241, 0.5)',
                              borderRadius: '3px',
                              padding: '8px 12px',
                              color: '#f8fafc',
                              fontSize: '14px',
                              boxSizing: 'border-box',
                            }}
                          />
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              value={editingStackItemData.defaultDose}
                              onChange={(e) => setEditingStackItemData({...editingStackItemData, defaultDose: e.target.value})}
                              placeholder="Dose"
                              inputMode="decimal"
                              enterKeyHint="done"
                              onBlur={handleEditBlur}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveStackItemEdit();
                              }}
                              style={{
                                width: '70px',
                                background: 'rgba(99, 102, 241, 0.15)',
                                border: '2px solid rgba(99, 102, 241, 0.5)',
                                borderRadius: '3px',
                                padding: '8px 12px',
                                color: '#f8fafc',
                                fontSize: '14px',
                                textAlign: 'center',
                              }}
                            />
                            <select
                              value={editingStackItemData.unit}
                              onChange={(e) => setEditingStackItemData({...editingStackItemData, unit: e.target.value})}
                              style={{
                                width: '70px',
                                background: 'rgba(99, 102, 241, 0.15)',
                                border: '2px solid rgba(99, 102, 241, 0.5)',
                                borderRadius: '3px',
                                padding: '8px',
                                color: '#f8fafc',
                                fontSize: '14px',
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
                            <button
                              onClick={saveStackItemEdit}
                              style={{
                                background: '#6366f1',
                                border: 'none',
                                borderRadius: '3px',
                                padding: '8px 12px',
                                color: '#fff',
                                fontSize: '12px',
                                cursor: 'pointer',
                              }}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div
                            onClick={() => startEditingStackItem(item)}
                            style={{
                              cursor: 'pointer',
                              flex: 1,
                            }}
                          >
                            <span style={{ color: '#e2e8f0', fontSize: '15px' }}>
                              {item.name}
                            </span>
                            <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '8px' }}>
                              {item.defaultDose}{item.unit}
                            </span>
                            {item.description && (
                              <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>
                                ({item.description})
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
                        </>
                      )}
                    </div>
                  );
                  })}
                </div>
              </div>
              );
            })()}

            {/* Inactive Items */}
            {inactiveItems.length > 0 && (
              <div>
                <label style={{
                  color: '#94a3b8',
                  fontSize: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '12px',
                  display: 'block',
                }}>Hidden ({inactiveItems.length})</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                      <div style={{ display: 'flex', gap: '8px' }}>
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
                        <button
                          onClick={() => deleteStackItem(item.id)}
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
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          </div>

          {/* Floating Done Button */}
          <button
            onClick={() => setShowManageStack(false)}
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
    </div>
  );
}
