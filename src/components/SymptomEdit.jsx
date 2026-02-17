import { useState, useEffect, useRef, useCallback } from 'react';
import { formatRelativeTime } from '../utils/helpers';

// Reconstruct symptom state at a history point (simpler than supplements)
const reconstructSymptomStateAtEntry = (historyArray, targetIndex) => {
  const createdEntry = historyArray.find(h => h.type === 'created');
  if (!createdEntry) return null;

  let state = { ...createdEntry.snapshot };

  for (let i = 0; i <= targetIndex; i++) {
    const entry = historyArray[i];
    if (entry.type === 'updated' && entry.changes) {
      Object.entries(entry.changes).forEach(([field, change]) => {
        state[field] = change.to;
      });
    }
  }
  return state;
};

export default function SymptomEdit({ symptom, onSave, onCancel, trackingMode }) {
  const modalRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    applicablePeriods: null,
  });
  const [revertedIndex, setRevertedIndex] = useState(null);

  // Initialize form data from symptom
  useEffect(() => {
    if (symptom) {
      setFormData({
        name: symptom.name || '',
        description: symptom.description || '',
        applicablePeriods: symptom.applicablePeriods || null,
      });
    }
  }, [symptom]);

  if (!symptom) return null;

  const history = symptom.history || [];
  // Reverse to show newest first
  const sortedHistory = [...history].sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  );

  const handleRevert = (entry, index) => {
    // Find the original index in the non-reversed array
    const originalIndex = history.length - 1 - index;
    const restoredState = reconstructSymptomStateAtEntry(history, originalIndex);

    if (restoredState) {
      setFormData({
        name: restoredState.name || '',
        description: restoredState.description || '',
      });
      setRevertedIndex(index);
      // Clear the flash after animation
      setTimeout(() => setRevertedIndex(null), 600);
    }
  };

  const handleSave = useCallback(() => {
    if (!formData.name.trim()) return;
    onSave({
      name: formData.name.trim(),
      description: formData.description.trim(),
      applicablePeriods: formData.applicablePeriods,
    });
  }, [formData, onSave]);

  // Auto-save when iOS keyboard Done button dismisses keyboard (blur leaves modal)
  const handleFieldBlur = useCallback(() => {
    setTimeout(() => {
      if (modalRef.current && !modalRef.current.contains(document.activeElement)) {
        handleSave();
      }
    }, 100);
  }, [handleSave]);

  const formatChangeText = (entry) => {
    if (entry.type === 'created') {
      return 'Created';
    }
    if (entry.type === 'updated' && entry.changes) {
      const parts = [];
      Object.entries(entry.changes).forEach(([field, change]) => {
        if (field === 'active') {
          parts.push(change.to ? 'Restored' : 'Hidden');
        } else if (field === 'name') {
          if (change.from !== change.to) {
            parts.push(`Name: ${change.from} → ${change.to}`);
          }
        } else if (field === 'description') {
          if (change.from !== change.to) {
            parts.push(`Description changed`);
          }
        }
      });
      return parts.join(', ') || null;
    }
    return 'Updated';
  };

  return (
    <div
      ref={modalRef}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#08090A',
        zIndex: 1001,
        display: 'flex',
        flexDirection: 'column',
        animation: 'modalIn 0.2s ease-out',
      }}
    >
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
          Edit Symptom
        </h2>
        <button
          onClick={onCancel}
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
        padding: '24px 20px',
        paddingBottom: '100px',
      }}>
        <div style={{ maxWidth: '500px', margin: '0 auto' }}>
          {/* Name Field */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: '500',
              marginBottom: '8px',
              display: 'block',
            }}>
              Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              onBlur={handleFieldBlur}
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '2px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '8px',
                padding: '14px 16px',
                color: '#f8fafc',
                fontSize: '16px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Description Field */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: '500',
              marginBottom: '8px',
              display: 'block',
            }}>
              Description
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              onBlur={handleFieldBlur}
              placeholder="Optional"
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '2px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '8px',
                padding: '14px 16px',
                color: '#f8fafc',
                fontSize: '16px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Applies to Section - only in AM/PM mode */}
          {trackingMode === 'ampm' && (
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                color: '#94a3b8',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '8px',
                display: 'block',
              }}>
                Applies to
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[
                  { id: 'morning', label: 'Morning' },
                  { id: 'evening', label: 'Evening' },
                ].map(period => {
                  const isActive = !formData.applicablePeriods || formData.applicablePeriods.includes(period.id);
                  return (
                    <button
                      key={period.id}
                      onClick={() => {
                        setFormData(prev => {
                          const current = prev.applicablePeriods || ['morning', 'evening'];
                          if (isActive) {
                            // Don't allow unchecking both
                            const filtered = current.filter(p => p !== period.id);
                            if (filtered.length === 0) return prev;
                            return { ...prev, applicablePeriods: filtered };
                          } else {
                            const added = [...current, period.id];
                            // If both are checked, clear the field (default behavior)
                            if (added.includes('morning') && added.includes('evening')) {
                              return { ...prev, applicablePeriods: null };
                            }
                            return { ...prev, applicablePeriods: added };
                          }
                        });
                      }}
                      style={{
                        flex: 1,
                        padding: '12px 16px',
                        background: isActive ? 'rgba(139, 92, 246, 0.2)' : 'rgba(100, 116, 139, 0.1)',
                        border: isActive ? '2px solid rgba(139, 92, 246, 0.4)' : '2px solid rgba(100, 116, 139, 0.2)',
                        borderRadius: '8px',
                        color: isActive ? '#c4b5fd' : '#64748b',
                        fontSize: '15px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      {period.label}
                    </button>
                  );
                })}
              </div>
              {formData.applicablePeriods && (
                <div style={{
                  color: '#64748b',
                  fontSize: '12px',
                  marginTop: '6px',
                }}>
                  Auto-N/A in {formData.applicablePeriods.includes('morning') ? 'PM' : 'AM'} during rapid entry
                </div>
              )}
            </div>
          )}

          {/* History Section */}
          {sortedHistory.length > 0 && (
            <div style={{ marginTop: '32px' }}>
              <div style={{
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                paddingTop: '24px',
              }}>
                <label style={{
                  color: '#64748b',
                  fontSize: '12px',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  marginBottom: '16px',
                  display: 'block',
                }}>
                  History
                </label>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {sortedHistory.map((entry, index) => {
                    const changeText = formatChangeText(entry);
                    // Skip entries with no meaningful changes to display
                    if (!changeText) return null;

                    return (
                      <div
                        key={index}
                        style={{
                          padding: '12px 0',
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: '12px',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{
                            color: '#94a3b8',
                            fontSize: '12px',
                            marginBottom: '4px',
                          }}>
                            {formatRelativeTime(entry.timestamp)}
                          </div>
                          <div style={{
                            color: '#e2e8f0',
                            fontSize: '14px',
                          }}>
                            {changeText}
                          </div>
                        </div>

                        {/* Revert button */}
                        <button
                          onClick={() => handleRevert(entry, index)}
                          title="Revert to this state"
                          style={{
                            background: 'rgba(139, 92, 246, 0.15)',
                            border: '1px solid rgba(139, 92, 246, 0.3)',
                            borderRadius: '6px',
                            padding: '8px 10px',
                            color: '#a78bfa',
                            fontSize: '14px',
                            cursor: 'pointer',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="1 4 1 10 7 10"></polyline>
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed Bottom Buttons */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '16px 20px',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
        background: 'linear-gradient(transparent, #08090A 20%)',
        display: 'flex',
        gap: '12px',
        justifyContent: 'center',
      }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            maxWidth: '150px',
            padding: '14px 24px',
            background: 'rgba(100, 116, 139, 0.2)',
            border: '1px solid rgba(100, 116, 139, 0.3)',
            borderRadius: '25px',
            color: '#94a3b8',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!formData.name.trim()}
          style={{
            flex: 1,
            maxWidth: '150px',
            padding: '14px 24px',
            background: formData.name.trim() ? '#8b5cf6' : 'rgba(139, 92, 246, 0.3)',
            border: 'none',
            borderRadius: '25px',
            color: '#fff',
            fontSize: '16px',
            fontWeight: '600',
            cursor: formData.name.trim() ? 'pointer' : 'not-allowed',
            boxShadow: formData.name.trim() ? '0 4px 20px rgba(139, 92, 246, 0.4)' : 'none',
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
