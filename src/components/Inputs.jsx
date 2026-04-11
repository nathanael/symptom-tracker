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
  isDesktop,
  searchFilter,
}) {
  const [editingInputId, setEditingInputId] = useState(null);
  const [newInput, setNewInput] = useState({ name: '', description: '', category: 'food' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [showHiddenItems, setShowHiddenItems] = useState(false);
  const [showLogPicker, setShowLogPicker] = useState(false);

  const manageScrollRef = useRef(null);

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

    setInputItems(prev => [...prev, newItem]);
    setNewInput({ name: '', description: '', category: 'food' });
    setShowAddForm(false);
    setLastAction(`Added ${newInput.name}`);
  };

  const toggleInputActive = (itemId) => {
    setInputItems(prev => prev.map(item => {
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
      setInputItems(prev => prev.map(item => {
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

  // Inputs available to log retroactively (active items without entries for this date)
  const availableToLog = activeItems.filter(i => !inputEntries[`${dateKey}-${i.id}`]);

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
  })().filter(item => {
    if (!searchFilter) return true;
    const s = searchFilter.toLowerCase();
    return item.name.toLowerCase().includes(s) || (item.description || '').toLowerCase().includes(s);
  });

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

      setInputItems(prev => prev.map(i => {
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
    const manageScrollContent = (
        <div
          ref={manageScrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
            padding: '12px 16px',
            paddingBottom: isDesktop ? '20px' : '80px',
          }}
        >
          <div style={{ maxWidth: isDesktop ? '100%' : '500px', margin: '0 auto' }}>

            {/* Add Input Form (at top, when expanded) */}
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
                    value={newInput.description}
                    onChange={(e) => setNewInput({ ...newInput, description: e.target.value })}
                    placeholder="Description (optional)"
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

                  {/* Category selector */}
                  <div style={{ display: 'flex', gap: '6px' }}>
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

                  <button
                    onClick={addInputItem}
                    disabled={!newInput.name.trim()}
                    style={{
                      marginTop: '10px',
                      width: '100%',
                      background: !newInput.name.trim()
                        ? 'rgba(99, 102, 241, 0.3)'
                        : '#6366f1',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '12px',
                      color: '#fff',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: !newInput.name.trim() ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Add Input
                  </button>
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setNewInput({ name: '', description: '', category: 'food' });
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                          background: isDragging ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          transform: isDragging ? `translateY(${dragReorderY}px)` : `translateY(${offsetY}px)`,
                          zIndex: isDragging ? 10 : 1,
                          position: 'relative',
                          transition: isDragging ? 'none' : 'transform 0.15s ease',
                          boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
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
                          onClick={() => setEditingInputId(item.id)}
                          style={{
                            cursor: 'pointer',
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          {/* Category dot */}
                          <div style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: catInfo.color,
                            flexShrink: 0,
                          }} />
                          <span style={{ color: '#e2e8f0', fontSize: '15px' }}>
                            {item.name}
                          </span>
                          {item.verdict && (
                            <span style={{
                              display: 'inline-block',
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: VERDICT_COLORS[item.verdict],
                            }} />
                          )}
                        </div>
                        <button
                          onClick={() => toggleInputActive(item.id)}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '8px',
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
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
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
                          onClick={() => toggleInputActive(item.id)}
                          style={{
                            background: 'rgba(34, 197, 94, 0.15)',
                            border: '1px solid rgba(34, 197, 94, 0.3)',
                            borderRadius: '8px',
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
                Add new input
              </button>
            )}
          </div>
        </div>
    );

    return isDesktop ? (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'flex-end',
        }}
        onClick={() => setShowManageInputs(false)}
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
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
          }}>
            <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
              Manage inputs
            </h3>
            <button
              onClick={() => setShowManageInputs(false)}
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
          {manageScrollContent}
        </div>
      </div>
    ) : (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 'env(safe-area-inset-top)',
      }}>
        <div style={{
          width: '100%',
          background: 'rgba(15, 17, 21, 0.95)',
          borderRadius: '0 0 16px 16px',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top))',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(100, 116, 139, 0.2)',
            flexShrink: 0,
          }}>
            <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
              Manage inputs
            </h3>
            <button
              onClick={() => setShowManageInputs(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#8b5cf6',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              Done
            </button>
          </div>
          {manageScrollContent}
        </div>
      </div>
    );
  }

  // Daily view
  const progress = getInputProgress();

  // Empty state: show add prompt on today
  if (displayItems.length === 0) {
    if (!isToday) {
      // Past date with no entries — show "Log input" button if items are available
      if (availableToLog.length === 0) return null;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
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
            Log input
          </button>

          {/* Log Picker Modal */}
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
                <div style={{
                  padding: '20px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
                    Log input
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
                <div style={{
                  overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  flex: 1,
                }}>
                  {availableToLog.map((item) => {
                    const catInfo = getCategoryInfo(item.category);
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          incrementInput(item.id);
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
                          gap: '10px',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: catInfo.color,
                          flexShrink: 0,
                        }} />
                        <span>{item.name}</span>
                        {item.description && (
                          <span style={{ color: '#6b7280', fontSize: '13px' }}>
                            {item.description}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }
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
            Other Factors
          </span>
        </div>
      )}

      {/* Input items */}
      {displayItems.map(item => {
        const catInfo = getCategoryInfo(item.category);
        const entry = inputEntries[`${dateKey}-${item.id}`];
        const isLogged = !!entry;
        const count = entry?.count || 1;

        return (
          <button
            key={item.id}
            onClick={() => incrementInput(item.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              cursor: 'pointer',
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

            {/* Name + description */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{
                color: isLogged ? '#e5e7eb' : '#9ca3af',
                fontSize: '17px',
                fontWeight: '400',
                display: 'block',
              }}>
                {item.name}
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
              onClick={isLogged ? (e) => clearInput(item.id, e) : undefined}
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

      {/* Log input button - past dates only */}
      {!isToday && availableToLog.length > 0 && (
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
          Log input
        </button>
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
            <div style={{
              padding: '20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
                Log input
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
            <div style={{
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              flex: 1,
            }}>
              {availableToLog.map((item) => {
                const catInfo = getCategoryInfo(item.category);
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      incrementInput(item.id);
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
                      gap: '10px',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: catInfo.color,
                      flexShrink: 0,
                    }} />
                    <span>{item.name}</span>
                    {item.description && (
                      <span style={{ color: '#6b7280', fontSize: '13px' }}>
                        {item.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Manage inputs link - only on today */}
      {isToday && !showManageInputs && (
        <button
          onClick={() => setShowManageInputs(true)}
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
          Manage inputs
        </button>
      )}
    </div>
  );
}
