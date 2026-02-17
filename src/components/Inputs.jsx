import { useState, useRef, useEffect } from 'react';
import { getDateKey, haptic } from '../utils/helpers';
import { INPUT_CATEGORIES, VERDICT_COLORS } from '../utils/constants';
import InputEdit from './InputEdit';

export default function Inputs({
  inputItems,
  setInputItems,
  inputEntries,
  setInputEntries,
  selectedDate,
  setLastAction,
  showManageInputs,
  setShowManageInputs,
}) {
  const [editingInputId, setEditingInputId] = useState(null);
  const [newInput, setNewInput] = useState({ name: '', description: '', category: 'food' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [showHiddenItems, setShowHiddenItems] = useState(false);

  // Drag reorder state
  const [dragReorderId, setDragReorderId] = useState(null);
  const [dragReorderY, setDragReorderY] = useState(0);
  const dragReorderStartY = useRef(0);

  const dateKey = getDateKey(selectedDate);
  const today = new Date();
  const isToday = selectedDate.toDateString() === today.toDateString();

  // Lock body scroll when modal is open
  useEffect(() => {
    if (showManageInputs) {
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
  }, [showManageInputs]);

  const incrementInput = (inputId) => {
    haptic('light');
    const entryKey = `${dateKey}-${inputId}`;
    const item = inputItems.find(i => i.id === inputId);

    setInputEntries(prev => {
      const existing = prev[entryKey];
      if (existing) {
        const newCount = (existing.count || 1) + 1;
        setLastAction(`${item?.name} x${newCount}`);
        return { ...prev, [entryKey]: { ...existing, count: newCount } };
      } else {
        setLastAction(`Logged ${item?.name}`);
        return {
          ...prev,
          [entryKey]: {
            date: dateKey,
            inputId: inputId,
            logged: true,
            count: 1,
          }
        };
      }
    });
  };

  const clearInput = (inputId, e) => {
    e.stopPropagation();
    haptic('light');
    const entryKey = `${dateKey}-${inputId}`;
    const item = inputItems.find(i => i.id === inputId);

    setInputEntries(prev => {
      const newEntries = { ...prev };
      delete newEntries[entryKey];
      setLastAction(`Removed ${item?.name}`);
      return newEntries;
    });
  };

  const addInputItem = () => {
    if (!newInput.name.trim()) return;

    const id = newInput.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
    const maxOrder = Math.max(-1, ...inputItems.map(i => i.order || 0));

    const newItem = {
      id,
      name: newInput.name.trim(),
      description: newInput.description.trim() || '',
      category: newInput.category,
      active: true,
      order: maxOrder + 1,
      verdict: null,
      verdictDate: null,
      history: [{
        timestamp: new Date().toISOString(),
        type: 'created',
        snapshot: {
          name: newInput.name.trim(),
          description: newInput.description.trim() || '',
          category: newInput.category,
          active: true,
          verdict: null,
        }
      }],
    };

    setInputItems([...inputItems, newItem]);
    setNewInput({ name: '', description: '', category: 'food' });
    setShowAddForm(false);
    setLastAction(`Added ${newInput.name}`);
  };

  const toggleInputActive = (itemId) => {
    setInputItems(inputItems.map(item => {
      if (item.id !== itemId) return item;
      const newActive = !item.active;
      const history = item.history || [];
      const historyEntry = {
        timestamp: new Date().toISOString(),
        type: 'updated',
        changes: { active: { from: item.active, to: newActive } },
      };
      return { ...item, active: newActive, history: [...history, historyEntry] };
    }));
  };

  const handleInputSave = (updatedData) => {
    if (updatedData.name.trim() && editingInputId) {
      setInputItems(inputItems.map(item => {
        if (item.id !== editingInputId) return item;

        const changes = {};
        if (item.name !== updatedData.name) changes.name = { from: item.name, to: updatedData.name };
        if (item.description !== updatedData.description) changes.description = { from: item.description, to: updatedData.description };
        if (item.category !== updatedData.category) changes.category = { from: item.category, to: updatedData.category };
        if ((item.verdict || null) !== (updatedData.verdict || null)) changes.verdict = { from: item.verdict, to: updatedData.verdict };

        const history = item.history || [];
        const historyEntry = Object.keys(changes).length > 0 ? {
          timestamp: new Date().toISOString(),
          type: 'updated',
          changes,
        } : null;

        return {
          ...item,
          name: updatedData.name,
          description: updatedData.description,
          category: updatedData.category,
          verdict: updatedData.verdict,
          verdictDate: updatedData.verdictDate,
          history: historyEntry ? [...history, historyEntry] : history,
        };
      }));
    }
    setEditingInputId(null);
  };

  const activeItems = inputItems.filter(i => i.active).sort((a, b) => (a.order || 0) - (b.order || 0));
  const inactiveItems = inputItems.filter(i => !i.active);

  // Determine which items to display
  const displayItems = (() => {
    if (isToday) {
      return activeItems;
    }
    // Past dates: only show items that have entries
    const itemIdsWithEntries = new Set(
      Object.keys(inputEntries)
        .filter(key => key.startsWith(dateKey))
        .map(key => key.substring(dateKey.length + 1))
    );
    return inputItems.filter(i => itemIdsWithEntries.has(i.id))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  })();

  const getInputProgress = () => {
    const loggedCount = displayItems.filter(item =>
      inputEntries[`${dateKey}-${item.id}`]
    ).length;
    return { logged: loggedCount, total: displayItems.length };
  };

  const getCategoryInfo = (categoryId) => {
    return INPUT_CATEGORIES.find(c => c.id === categoryId) || INPUT_CATEGORIES[0];
  };

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

      setInputItems(inputItems.map(i => {
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

  // Edit modal
  if (editingInputId) {
    const editItem = inputItems.find(i => i.id === editingInputId);
    return (
      <InputEdit
        item={editItem}
        onSave={handleInputSave}
        onCancel={() => setEditingInputId(null)}
      />
    );
  }

  // Manage modal
  if (showManageInputs) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: '#08090A',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        animation: 'modalIn 0.2s ease-out',
      }}>
        {/* Header */}
        <div style={{
          flexShrink: 0,
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#08090A',
        }}>
          <h2 style={{
            color: '#f8fafc',
            fontSize: '18px',
            fontWeight: '600',
            margin: 0,
          }}>
            Manage Inputs
          </h2>
          <button
            onClick={() => setShowManageInputs(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '4px 8px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable Content */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '16px 20px',
          paddingBottom: '100px',
        }}>
          <div style={{ maxWidth: '500px', margin: '0 auto' }}>
            {/* Add Input Button/Form */}
            {!showAddForm ? (
              <button
                onClick={() => setShowAddForm(true)}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: 'rgba(139, 92, 246, 0.1)',
                  border: '2px dashed rgba(139, 92, 246, 0.3)',
                  borderRadius: '12px',
                  color: '#a78bfa',
                  fontSize: '15px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  marginBottom: '20px',
                }}
              >
                + Add Input
              </button>
            ) : (
              <div style={{
                background: 'rgba(15, 17, 21, 0.8)',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
                border: '1px solid rgba(139, 92, 246, 0.2)',
              }}>
                <input
                  type="text"
                  value={newInput.name}
                  onChange={(e) => setNewInput({ ...newInput, name: e.target.value })}
                  placeholder="Input name (e.g., Dairy, Alcohol)"
                  autoFocus
                  style={{
                    width: '100%',
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '2px solid rgba(99, 102, 241, 0.3)',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    color: '#f8fafc',
                    fontSize: '16px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    marginBottom: '10px',
                  }}
                />
                <input
                  type="text"
                  value={newInput.description}
                  onChange={(e) => setNewInput({ ...newInput, description: e.target.value })}
                  placeholder="Description (optional)"
                  style={{
                    width: '100%',
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '2px solid rgba(99, 102, 241, 0.3)',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    color: '#f8fafc',
                    fontSize: '16px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    marginBottom: '10px',
                  }}
                />

                {/* Category selector */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
                  {INPUT_CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setNewInput({ ...newInput, category: cat.id })}
                      style={{
                        flex: 1,
                        padding: '8px',
                        background: newInput.category === cat.id
                          ? `${cat.color}25`
                          : 'rgba(15, 23, 42, 0.8)',
                        border: newInput.category === cat.id
                          ? `2px solid ${cat.color}80`
                          : '2px solid rgba(99, 102, 241, 0.15)',
                        borderRadius: '8px',
                        color: newInput.category === cat.id ? cat.color : '#94a3b8',
                        fontSize: '13px',
                        fontWeight: newInput.category === cat.id ? '600' : '400',
                        cursor: 'pointer',
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => {
                      setNewInput({ name: '', description: '', category: 'food' });
                      setShowAddForm(false);
                    }}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: 'rgba(100, 116, 139, 0.2)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#94a3b8',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addInputItem}
                    disabled={!newInput.name.trim()}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: newInput.name.trim() ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: newInput.name.trim() ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {/* Active Items List */}
            {activeItems.length > 0 && (() => {
              const dragCurrentIndex = dragReorderId ? activeItems.findIndex(i => i.id === dragReorderId) : -1;
              const itemHeight = 52;
              const dragTargetIndex = dragReorderId ? Math.max(0, Math.min(activeItems.length - 1, dragCurrentIndex + Math.round(dragReorderY / itemHeight))) : -1;

              return (
              <div
                onTouchMove={handleDragMove}
                onTouchEnd={handleDragEnd}
                onTouchCancel={handleDragEnd}
                onMouseMove={handleDragMove}
                onMouseUp={handleDragEnd}
                onMouseLeave={handleDragEnd}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {activeItems.map((item, index) => {
                    const catInfo = getCategoryInfo(item.category);
                    const isDragging = dragReorderId === item.id;
                    let offsetY = 0;
                    if (dragReorderId && !isDragging) {
                      if (index > dragCurrentIndex && index <= dragTargetIndex) {
                        offsetY = -itemHeight - 6;
                      } else if (index < dragCurrentIndex && index >= dragTargetIndex) {
                        offsetY = itemHeight + 6;
                      }
                    }

                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px 0',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                          background: isDragging ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                          borderRadius: isDragging ? '3px' : '0',
                          transform: isDragging ? `translateY(${dragReorderY}px)` : `translateY(${offsetY}px)`,
                          transition: isDragging ? 'none' : 'transform 0.15s ease',
                          boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
                          zIndex: isDragging ? 10 : 1,
                          position: 'relative',
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

                        {/* Category dot */}
                        <div style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: catInfo.color,
                          flexShrink: 0,
                        }} />

                        {/* Name - tap to edit */}
                        <button
                          onClick={() => setEditingInputId(item.id)}
                          style={{
                            flex: 1,
                            background: 'none',
                            border: 'none',
                            color: '#e2e8f0',
                            fontSize: '15px',
                            cursor: 'pointer',
                            textAlign: 'left',
                            padding: 0,
                          }}
                        >
                          {item.name}
                          {item.verdict && (
                            <span style={{
                              display: 'inline-block',
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: VERDICT_COLORS[item.verdict],
                              marginLeft: '6px',
                              verticalAlign: 'middle',
                            }} />
                          )}
                        </button>

                        {/* Hide button */}
                        <button
                          onClick={() => toggleInputActive(item.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#4b5563',
                            cursor: 'pointer',
                            padding: '4px',
                            fontSize: '12px',
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {activeItems.length === 0 && !showAddForm && (
              <div style={{
                color: '#64748b',
                fontSize: '14px',
                textAlign: 'center',
                padding: '32px 0',
              }}>
                No inputs yet. Add foods, substances, or activities to track.
              </div>
            )}

            {/* Hidden Items */}
            {inactiveItems.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <button
                  onClick={() => setShowHiddenItems(!showHiddenItems)}
                  style={{
                    width: '100%',
                    padding: '10px 0',
                    background: 'transparent',
                    border: 'none',
                    color: '#64748b',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform: showHiddenItems ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease',
                    }}
                  >
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                  Hidden ({inactiveItems.length})
                </button>

                {showHiddenItems && inactiveItems.map(item => {
                  const catInfo = getCategoryInfo(item.category);
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 0 10px 28px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                      }}
                    >
                      <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: catInfo.color,
                        opacity: 0.4,
                        flexShrink: 0,
                      }} />
                      <span style={{ flex: 1, color: '#64748b', fontSize: '14px' }}>
                        {item.name}
                      </span>
                      <button
                        onClick={() => toggleInputActive(item.id)}
                        style={{
                          background: 'rgba(139, 92, 246, 0.15)',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          color: '#a78bfa',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Daily view
  const progress = getInputProgress();

  // Empty state: show add prompt on today
  if (displayItems.length === 0) {
    if (!isToday) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
        <button
          onClick={() => setShowManageInputs(true)}
          style={{
            margin: '16px 20px 12px',
            padding: '14px',
            background: 'rgba(139, 92, 246, 0.06)',
            border: '1px dashed rgba(139, 92, 246, 0.25)',
            borderRadius: '12px',
            color: '#a78bfa',
            fontSize: '14px',
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          + Track foods, substances, or activities
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
      {/* Input items */}
      {displayItems.map(item => {
        const catInfo = getCategoryInfo(item.category);
        const entry = inputEntries[`${dateKey}-${item.id}`];
        const isLogged = !!entry;
        const count = entry?.count || 1;

        return (
          <button
            key={item.id}
            onClick={() => isToday && incrementInput(item.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              cursor: isToday ? 'pointer' : 'default',
              width: '100%',
              textAlign: 'left',
            }}
          >
            {/* Category dot */}
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: catInfo.color,
              flexShrink: 0,
              opacity: isLogged ? 1 : 0.4,
            }} />

            {/* Name */}
            <span style={{
              flex: 1,
              color: isLogged ? '#e5e7eb' : '#9ca3af',
              fontSize: '17px',
              fontWeight: '400',
            }}>
              {item.name}
            </span>

            {/* Verdict dot */}
            {item.verdict && (
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: VERDICT_COLORS[item.verdict],
                flexShrink: 0,
              }} />
            )}

            {/* Count badge / empty circle */}
            <div
              onClick={isLogged && isToday ? (e) => clearInput(item.id, e) : undefined}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: isLogged ? '6px' : '50%',
                border: isLogged ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
                background: isLogged ? '#8b5cf6' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.15s ease',
              }}
            >
              {isLogged && count === 1 && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {isLogged && count > 1 && (
                <span style={{
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: '600',
                  lineHeight: 1,
                }}>
                  {count}
                </span>
              )}
            </div>
          </button>
        );
      })}

      {/* Manage inputs link - only on today */}
      {isToday && (
        <button
          onClick={() => setShowManageInputs(true)}
          style={{
            padding: '10px 20px',
            background: 'transparent',
            border: 'none',
            color: '#8b5cf6',
            fontSize: '13px',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          Manage inputs
        </button>
      )}
    </div>
  );
}
