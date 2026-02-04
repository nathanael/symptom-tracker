const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function SchedulePicker({ schedule, onChange }) {
  const currentSchedule = schedule || { type: 'daily' };

  const handleTypeChange = (type) => {
    if (type === 'daily') {
      onChange({ type: 'daily' });
    } else if (type === 'days') {
      onChange({ type: 'days', days: currentSchedule.days || [1, 3, 5] }); // Default Mon/Wed/Fri
    } else if (type === 'interval') {
      onChange({
        type: 'interval',
        interval: currentSchedule.interval || 2,
        startDate: currentSchedule.startDate || new Date().toISOString().split('T')[0]
      });
    }
  };

  const toggleDay = (dayIndex) => {
    const currentDays = currentSchedule.days || [];
    const newDays = currentDays.includes(dayIndex)
      ? currentDays.filter(d => d !== dayIndex)
      : [...currentDays, dayIndex].sort((a, b) => a - b);

    // Don't allow empty days
    if (newDays.length === 0) return;

    onChange({ ...currentSchedule, days: newDays });
  };

  const handleIntervalChange = (value) => {
    const interval = Math.max(2, Math.min(30, parseInt(value) || 2));
    onChange({ ...currentSchedule, interval });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Type selector */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {[
          { type: 'daily', label: 'Daily' },
          { type: 'days', label: 'Days of Week' },
          { type: 'interval', label: 'Every X Days' },
        ].map(({ type, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => handleTypeChange(type)}
            style={{
              flex: 1,
              padding: '8px 10px',
              background: currentSchedule.type === type
                ? 'rgba(99, 102, 241, 0.3)'
                : 'rgba(15, 23, 42, 0.5)',
              border: currentSchedule.type === type
                ? '1px solid rgba(99, 102, 241, 0.5)'
                : '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              color: currentSchedule.type === type ? '#a5b4fc' : '#9ca3af',
              fontSize: '12px',
              fontWeight: '500',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Days of week selector */}
      {currentSchedule.type === 'days' && (
        <div style={{ display: 'flex', gap: '4px', justifyContent: 'space-between' }}>
          {DAY_LABELS.map((label, index) => {
            const isSelected = currentSchedule.days?.includes(index);
            return (
              <button
                key={index}
                type="button"
                onClick={() => toggleDay(index)}
                title={DAY_NAMES[index]}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: isSelected
                    ? 'rgba(99, 102, 241, 0.4)'
                    : 'rgba(15, 23, 42, 0.5)',
                  border: isSelected
                    ? '1px solid rgba(99, 102, 241, 0.6)'
                    : '1px solid rgba(255, 255, 255, 0.1)',
                  color: isSelected ? '#c7d2fe' : '#6b7280',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Interval selector */}
      {currentSchedule.type === 'interval' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: '#9ca3af', fontSize: '14px' }}>Every</span>
          <input
            type="number"
            min="2"
            max="30"
            value={currentSchedule.interval || 2}
            onChange={(e) => handleIntervalChange(e.target.value)}
            style={{
              width: '60px',
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '4px',
              padding: '8px 10px',
              color: '#f8fafc',
              fontSize: '14px',
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <span style={{ color: '#9ca3af', fontSize: '14px' }}>days</span>
        </div>
      )}
    </div>
  );
}

// Helper to format schedule for display
export const formatSchedule = (schedule) => {
  if (!schedule || schedule.type === 'daily') return null;

  if (schedule.type === 'days') {
    const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    return schedule.days?.map(d => dayLetters[d]).join('') || null;
  }

  if (schedule.type === 'interval') {
    return `Every ${schedule.interval}d`;
  }

  return null;
};
