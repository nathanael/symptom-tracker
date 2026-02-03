import { useState, useRef } from 'react';
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
  const [newStackItem, setNewStackItem] = useState({ name: '', unit: 'mg', defaultDose: '' });
  const [editingStackItemId, setEditingStackItemId] = useState(null);
  const [editingStackItemData, setEditingStackItemData] = useState({ name: '', defaultDose: '', unit: 'mg' });

  // Drag reorder state
  const [dragReorderId, setDragReorderId] = useState(null);
  const [dragReorderY, setDragReorderY] = useState(0);
  const dragReorderStartY = useRef(0);

  const dateKey = getDateKey(selectedDate);

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
    const activeItems = stackItems.filter(i => i.active);
    const takenCount = activeItems.filter(item =>
      stackEntries[`${dateKey}-${item.id}`]
    ).length;
    return { taken: takenCount, total: activeItems.length };
  };

  const addStackItem = () => {
    if (!newStackItem.name.trim() || !newStackItem.defaultDose) return;

    const id = newStackItem.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const maxOrder = Math.max(-1, ...stackItems.map(i => i.order || 0));

    setStackItems([...stackItems, {
      id: id,
      name: newStackItem.name.trim(),
      unit: newStackItem.unit,
      defaultDose: parseFloat(newStackItem.defaultDose),
      active: true,
      order: maxOrder + 1
    }]);

    setNewStackItem({ name: '', unit: 'mg', defaultDose: '' });
    setLastAction(`Added ${newStackItem.name}`);
  };

  const toggleStackItemActive = (itemId) => {
    setStackItems(stackItems.map(item =>
      item.id === itemId ? { ...item, active: !item.active } : item
    ));
  };

  const startEditingStackItem = (item) => {
    setEditingStackItemId(item.id);
    setEditingStackItemData({ name: item.name, defaultDose: item.defaultDose, unit: item.unit });
  };

  const saveStackItemEdit = () => {
    if (editingStackItemData.name.trim() && editingStackItemId) {
      setStackItems(stackItems.map(item =>
        item.id === editingStackItemId
          ? { ...item, name: editingStackItemData.name.trim(), defaultDose: editingStackItemData.defaultDose, unit: editingStackItemData.unit }
          : item
      ));
    }
    setEditingStackItemId(null);
    setEditingStackItemData({ name: '', defaultDose: '', unit: 'mg' });
  };

  const deleteStackItem = (itemId) => {
    setStackItems(stackItems.filter(item => item.id !== itemId));
  };

  const activeItems = stackItems.filter(i => i.active).sort((a, b) => (a.order || 0) - (b.order || 0));
  const inactiveItems = stackItems.filter(i => !i.active);

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
      {/* Progress indicator and actions */}
      {activeItems.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          padding: '0 4px',
          gap: '8px',
        }}>
          <button
            onClick={() => {
              const newEntries = { ...stackEntries };
              activeItems.forEach(item => {
                const entryKey = `${dateKey}-${item.id}`;
                newEntries[entryKey] = {
                  date: dateKey,
                  itemId: item.id,
                  dose: item.defaultDose,
                  taken: true
                };
              });
              setStackEntries(newEntries);
              haptic('success');
              setLastAction('All selected');
            }}
            style={{
              background: 'rgba(74, 222, 128, 0.1)',
              border: '1px solid rgba(74, 222, 128, 0.3)',
              borderRadius: '3px',
              color: '#4ade80',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer',
              padding: '6px 10px',
            }}
          >
            All
          </button>
          <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: '600' }}>
            {getStackProgress().taken}/{getStackProgress().total}
          </span>
          <button
            onClick={() => {
              const newEntries = { ...stackEntries };
              Object.keys(newEntries).forEach(key => {
                if (key.startsWith(dateKey)) {
                  delete newEntries[key];
                }
              });
              setStackEntries(newEntries);
              setLastAction('All cleared');
            }}
            style={{
              background: 'rgba(248, 113, 113, 0.1)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              borderRadius: '3px',
              color: '#f87171',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer',
              padding: '6px 10px',
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Stack items - flat row design */}
      {activeItems.map((item, index) => {
        const entry = getStackEntry(item.id);
        const isTaken = !!entry;
        const isEditing = editingStackItem === item.id;
        const multiplier = entry?.multiplier || 1;

        return (
          <div
            key={item.id}
            style={{
              background: 'transparent',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              cursor: 'pointer',
            }}
            onClick={() => !isEditing && toggleStackItem(item.id)}
          >
            {/* Left side: name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
              <span style={{
                color: isTaken ? '#e5e7eb' : '#9ca3af',
                fontSize: '15px',
                fontWeight: '400',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{item.name}</span>
            </div>

            {/* Right side: dose + checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              {isEditing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                     onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    inputMode="decimal"
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
                  <span style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500' }}>{item.unit}</span>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '3px',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingStackItem(item.id);
                  }}
                >
                  <span style={{
                    color: isTaken ? '#e5e7eb' : '#6b7280',
                    fontSize: '13px',
                    fontWeight: '500',
                  }}>
                    {entry?.dose || item.defaultDose}
                  </span>
                  <span style={{
                    color: '#6b7280',
                    fontSize: '11px',
                  }}>
                    {item.unit}
                  </span>
                </div>
              )}

              {/* Checkbox badge */}
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  border: isTaken
                    ? '1px solid rgba(16,185,129,0.2)'
                    : '1px solid rgba(255,255,255,0.05)',
                  background: isTaken
                    ? 'rgba(16,185,129,0.1)'
                    : 'rgba(255,255,255,0.05)',
                  boxShadow: isTaken ? '0 0 10px -3px rgba(16,185,129,0.3)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isTaken ? '#34d399' : '#6b7280',
                  fontSize: '12px',
                  fontWeight: '500',
                  flexShrink: 0,
                }}
              >
                {isTaken ? '✓' : ''}
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
          onClick={() => setShowManageStack(false)}
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
                Supplements
              </h2>
              <button
                onClick={() => setShowManageStack(false)}
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

            {/* Add new item */}
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
              }}>Add New Supplement</label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px', marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Supplement name"
                  value={newStackItem.name}
                  onChange={(e) => setNewStackItem({...newStackItem, name: e.target.value})}
                  style={{
                    flex: 1,
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '2px solid rgba(99, 102, 241, 0.3)',
                    borderRadius: '5px',
                    padding: '12px 14px',
                    color: '#f8fafc',
                    fontSize: '15px',
                    outline: 'none',
                  }}
                />
              </div>
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

            {/* Active Items */}
            {activeItems.length > 0 && (
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
                        transform: isDraggingThis ? `translateY(${dragReorderY}px)` : 'none',
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
                        <div style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <input
                            value={editingStackItemData.name}
                            onChange={(e) => setEditingStackItemData({...editingStackItemData, name: e.target.value})}
                            autoFocus
                            style={{
                              flex: 1,
                              background: 'rgba(99, 102, 241, 0.15)',
                              border: '2px solid rgba(99, 102, 241, 0.5)',
                              borderRadius: '3px',
                              padding: '8px 12px',
                              color: '#f8fafc',
                              fontSize: '14px',
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveStackItemEdit();
                              if (e.key === 'Escape') {
                                setEditingStackItemId(null);
                                setEditingStackItemData({ name: '', defaultDose: '', unit: 'mg' });
                              }
                            }}
                          />
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
                      ) : (
                        <>
                          <span
                            onClick={() => startEditingStackItem(item)}
                            style={{
                              color: '#e2e8f0',
                              fontSize: '15px',
                              cursor: 'pointer',
                              flex: 1,
                            }}
                          >
                            {item.name}
                            <span style={{ color: '#64748b', fontSize: '12px', marginLeft: '8px' }}>
                              {item.defaultDose}{item.unit}
                            </span>
                          </span>
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
            )}

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
      )}
    </div>
  );
}
