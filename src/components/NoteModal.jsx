import { useRef, useEffect, useState } from 'react';
import { getDateKey } from '../utils/helpers';

export default function NoteModal({
  selectedDate,
  dailyNotes,
  setDailyNotes,
  onClose,
}) {
  const textareaRef = useRef(null);
  const dateKey = getDateKey(selectedDate);

  // Local state for immediate input response
  const [localNote, setLocalNote] = useState(dailyNotes[dateKey] || '');

  useEffect(() => {
    // Focus textarea on mount
    if (textareaRef.current) {
      textareaRef.current.focus();
      // Move cursor to end
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, []);

  // Track the latest note value for saving on unmount
  const localNoteRef = useRef(localNote);
  localNoteRef.current = localNote;

  // Debounced sync to parent state
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localNote !== (dailyNotes[dateKey] || '')) {
        setDailyNotes(prev => ({ ...prev, [dateKey]: localNote }));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localNote, dateKey, dailyNotes, setDailyNotes]);

  // Save immediately on unmount (in case debounce hasn't fired yet)
  useEffect(() => {
    return () => {
      setDailyNotes(prev => ({ ...prev, [dateKey]: localNoteRef.current }));
    };
  }, [dateKey, setDailyNotes]);

  const handleNoteChange = (value) => {
    setLocalNote(value);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '20px',
        paddingTop: 'calc(60px + env(safe-area-inset-top))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '500px',
          background: 'rgba(15, 17, 21, 0.95)',
          borderRadius: '12px',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(100, 116, 139, 0.2)',
        }}>
          <h3 style={{
            color: '#f8fafc',
            fontSize: '18px',
            fontWeight: '600',
            margin: 0,
          }}>
            Notes for {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </h3>
          <button
            onClick={onClose}
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

        {/* Textarea */}
        <div style={{ padding: '16px 20px 20px' }}>
          <textarea
            ref={textareaRef}
            value={localNote}
            onChange={(e) => handleNoteChange(e.target.value)}
            onBlur={onClose}
            placeholder="Add notes about today... (diet, sleep, stress, activities, etc.)"
            enterKeyHint="done"
            style={{
              width: '100%',
              minHeight: '300px',
              background: 'rgba(15, 10, 46, 0.5)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: '8px',
              padding: '14px',
              color: '#e2e8f0',
              fontSize: '15px',
              lineHeight: '1.6',
              resize: 'vertical',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <p style={{
            color: '#64748b',
            fontSize: '12px',
            margin: '12px 0 0 0',
            textAlign: 'center',
          }}>
            Notes are saved automatically
          </p>
        </div>
      </div>
    </div>
  );
}
