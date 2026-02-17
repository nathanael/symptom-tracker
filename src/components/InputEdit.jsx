import { useState, useEffect, useRef, useCallback } from 'react';
import { INPUT_CATEGORIES, VERDICT_COLORS } from '../utils/constants';
import { formatRelativeTime } from '../utils/helpers';

export default function InputEdit({ item, onSave, onCancel }) {
  const modalRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'food',
    verdict: null,
  });

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        description: item.description || '',
        category: item.category || 'food',
        verdict: item.verdict || null,
      });
    }
  }, [item]);

  if (!item) return null;

  const history = item.history || [];
  const sortedHistory = [...history].sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  );

  const handleSave = useCallback(() => {
    if (!formData.name.trim()) return;
    const verdictChanged = formData.verdict !== (item.verdict || null);
    onSave({
      name: formData.name.trim(),
      description: formData.description.trim(),
      category: formData.category,
      verdict: formData.verdict,
      verdictDate: verdictChanged ? new Date().toISOString() : item.verdictDate,
    });
  }, [formData, item, onSave]);

  const handleFieldBlur = useCallback(() => {
    setTimeout(() => {
      if (modalRef.current && !modalRef.current.contains(document.activeElement)) {
        handleSave();
      }
    }, 100);
  }, [handleSave]);

  const formatChangeText = (entry) => {
    if (entry.type === 'created') return 'Created';
    if (entry.type === 'updated' && entry.changes) {
      const parts = [];
      Object.entries(entry.changes).forEach(([field, change]) => {
        if (field === 'active') {
          parts.push(change.to ? 'Restored' : 'Hidden');
        } else if (field === 'name' && change.from !== change.to) {
          parts.push(`Name: ${change.from} → ${change.to}`);
        } else if (field === 'category' && change.from !== change.to) {
          const fromCat = INPUT_CATEGORIES.find(c => c.id === change.from)?.label || change.from;
          const toCat = INPUT_CATEGORIES.find(c => c.id === change.to)?.label || change.to;
          parts.push(`Category: ${fromCat} → ${toCat}`);
        } else if (field === 'description' && change.from !== change.to) {
          parts.push('Description changed');
        } else if (field === 'verdict') {
          const from = change.from || 'none';
          const to = change.to || 'none';
          if (from !== to) parts.push(`Verdict: ${from} → ${to}`);
        }
      });
      return parts.join(', ') || null;
    }
    return 'Updated';
  };

  const verdictOptions = [
    { value: null, label: 'None', color: '#64748b' },
    { value: 'testing', label: 'Testing', color: VERDICT_COLORS.testing },
    { value: 'bad', label: 'Bad', color: VERDICT_COLORS.bad },
    { value: 'good', label: 'Good', color: VERDICT_COLORS.good },
  ];

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
          Edit Input
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
              placeholder="Optional (e.g., 20 min 2x daily)"
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

          {/* Category Selector */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: '500',
              marginBottom: '8px',
              display: 'block',
            }}>
              Category
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {INPUT_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setFormData({ ...formData, category: cat.id })}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: formData.category === cat.id
                      ? `${cat.color}25`
                      : 'rgba(15, 23, 42, 0.8)',
                    border: formData.category === cat.id
                      ? `2px solid ${cat.color}80`
                      : '2px solid rgba(99, 102, 241, 0.15)',
                    borderRadius: '8px',
                    color: formData.category === cat.id ? cat.color : '#94a3b8',
                    fontSize: '14px',
                    fontWeight: formData.category === cat.id ? '600' : '400',
                    cursor: 'pointer',
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Verdict Selector */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: '500',
              marginBottom: '8px',
              display: 'block',
            }}>
              Verdict
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {verdictOptions.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => setFormData({ ...formData, verdict: opt.value })}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: formData.verdict === opt.value
                      ? `${opt.color}25`
                      : 'rgba(15, 23, 42, 0.8)',
                    border: formData.verdict === opt.value
                      ? `2px solid ${opt.color}80`
                      : '2px solid rgba(99, 102, 241, 0.15)',
                    borderRadius: '8px',
                    color: formData.verdict === opt.value ? opt.color : '#94a3b8',
                    fontSize: '13px',
                    fontWeight: formData.verdict === opt.value ? '600' : '400',
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {item.verdictDate && (
              <div style={{ color: '#64748b', fontSize: '12px', marginTop: '6px' }}>
                Last changed: {formatRelativeTime(item.verdictDate)}
              </div>
            )}
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

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {sortedHistory.map((entry, index) => {
                    const changeText = formatChangeText(entry);
                    if (!changeText) return null;

                    return (
                      <div
                        key={index}
                        style={{
                          padding: '12px 0',
                          display: 'flex',
                          alignItems: 'flex-start',
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
