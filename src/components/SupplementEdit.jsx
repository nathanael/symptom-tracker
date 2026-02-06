import { useState, useEffect } from 'react';
import SchedulePicker, { formatSchedule } from './SchedulePicker';
import { formatRelativeTime, reconstructStateAtEntry } from '../utils/helpers';

export default function SupplementEdit({ item, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    defaultDose: '',
    unit: 'mg',
    schedule: { type: 'daily' },
  });
  const [revertedIndex, setRevertedIndex] = useState(null);

  // Initialize form data from item
  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        description: item.description || '',
        defaultDose: item.defaultDose || '',
        unit: item.unit || 'mg',
        schedule: item.schedule || { type: 'daily' },
      });
    }
  }, [item]);

  if (!item) return null;

  const history = item.history || [];
  // Reverse to show newest first
  const sortedHistory = [...history].sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  );

  const handleRevert = (entry, index) => {
    // Find the original index in the non-reversed array
    const originalIndex = history.length - 1 - index;
    const restoredState = reconstructStateAtEntry(history, originalIndex);

    if (restoredState) {
      setFormData({
        name: restoredState.name || '',
        description: restoredState.description || '',
        defaultDose: restoredState.defaultDose || '',
        unit: restoredState.unit || 'mg',
        schedule: restoredState.schedule || { type: 'daily' },
      });
      setRevertedIndex(index);
      // Clear the flash after animation
      setTimeout(() => setRevertedIndex(null), 600);
    }
  };

  const handleSave = () => {
    if (!formData.name.trim()) return;
    onSave({
      name: formData.name.trim(),
      description: formData.description.trim(),
      defaultDose: parseFloat(formData.defaultDose) || item.defaultDose,
      unit: formData.unit,
      schedule: formData.schedule,
    });
  };

  const formatChangeText = (entry) => {
    if (entry.type === 'created') {
      return 'Created';
    }
    if (entry.type === 'updated' && entry.changes) {
      const parts = [];
      Object.entries(entry.changes).forEach(([field, change]) => {
        if (field === 'active') {
          parts.push(change.to ? 'Restored' : 'Hidden');
        } else if (field === 'defaultDose') {
          parts.push(`Dose: ${change.from}${item.unit} → ${change.to}${item.unit}`);
        } else if (field === 'name') {
          parts.push(`Name: ${change.from} → ${change.to}`);
        } else if (field === 'unit') {
          parts.push(`Unit: ${change.from} → ${change.to}`);
        } else if (field === 'description') {
          const fromText = change.from || '(none)';
          const toText = change.to || '(none)';
          parts.push(`Description changed`);
        } else if (field === 'schedule') {
          const fromSchedule = formatSchedule(change.from) || 'Daily';
          const toSchedule = formatSchedule(change.to) || 'Daily';
          parts.push(`Schedule: ${fromSchedule} → ${toSchedule}`);
        }
      });
      return parts.join(', ') || 'Updated';
    }
    return 'Updated';
  };

  return (
    <div
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
          Edit Supplement
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

          {/* Dose and Unit Row */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
            <div style={{ flex: 1 }}>
              <label style={{
                color: '#94a3b8',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '8px',
                display: 'block',
              }}>
                Dose
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={formData.defaultDose}
                onChange={(e) => setFormData({ ...formData, defaultDose: e.target.value })}
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
            <div style={{ width: '120px' }}>
              <label style={{
                color: '#94a3b8',
                fontSize: '14px',
                fontWeight: '500',
                marginBottom: '8px',
                display: 'block',
              }}>
                Unit
              </label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                style={{
                  width: '100%',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '2px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: '8px',
                  padding: '14px 12px',
                  color: '#f8fafc',
                  fontSize: '16px',
                  outline: 'none',
                  boxSizing: 'border-box',
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
          </div>

          {/* Schedule */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: '500',
              marginBottom: '8px',
              display: 'block',
            }}>
              Schedule
            </label>
            <SchedulePicker
              schedule={formData.schedule}
              onChange={(schedule) => setFormData({ ...formData, schedule })}
            />
          </div>

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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sortedHistory.map((entry, index) => (
                    <div
                      key={index}
                      style={{
                        background: revertedIndex === index
                          ? 'rgba(139, 92, 246, 0.3)'
                          : 'rgba(15, 17, 21, 0.6)',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '12px',
                        transition: 'background 0.4s ease',
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
                          {formatChangeText(entry)}
                        </div>
                      </div>

                      {/* Revert button - don't show for the first entry (creation) unless there are changes */}
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
                  ))}
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
