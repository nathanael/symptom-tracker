import { formatDate, haptic } from '../utils/helpers';

export default function Header({
  selectedDate,
  changeDate,
  canGoForward,
  setShowCalendar,
  setCalendarMonth,
  appMode,
  copyDays,
  setCopyDays,
  showCopyDropdown,
  setShowCopyDropdown,
  quickCopyData,
  copyLongPressTimer,
  trackingMode,
  quickLogTime,
  setQuickLogTime,
  setRapidEntryMode,
  setRapidEntryConfirm,
  incompleteSymptoms,
  totalActiveSymptoms,
  getCurrentTimePeriod,
  setShowAddSymptom,
  setShowManageStack,
}) {
  return (
    <div style={{
      flexShrink: 0,
      padding: '12px 12px',
      paddingTop: 'calc(12px + env(safe-area-inset-top))',
      zIndex: 100,
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        {/* Left side: date navigation - FIXED WIDTH */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          padding: '4px',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          width: '160px',
          justifyContent: 'space-between',
        }}>
          <button
            onClick={() => changeDate(-1)}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              width: '28px',
              height: '28px',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>

          <button
            onClick={() => {
              setCalendarMonth(new Date(selectedDate));
              setShowCalendar(true);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'center',
              padding: '4px 0',
              flex: 1,
            }}
          >
            <span style={{
              color: '#f3f4f6',
              fontSize: '14px',
              fontWeight: '500',
              whiteSpace: 'nowrap',
            }}>
              {formatDate(selectedDate)}
            </span>
          </button>

          <button
            onClick={() => changeDate(1)}
            disabled={!canGoForward}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '6px',
              width: '28px',
              height: '28px',
              color: canGoForward ? '#9ca3af' : '#4b5563',
              cursor: canGoForward ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canGoForward ? 1 : 0.5,
              flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>

        {/* Right side: action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Quick Copy Button - grouped with rapid entry */}
          {appMode === 'symptoms' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ position: 'relative' }}>
                <button
                  onTouchStart={() => {
                    copyLongPressTimer.current = setTimeout(() => {
                      copyLongPressTimer.current = 'longpress';
                      setShowCopyDropdown(true);
                      haptic('medium');
                    }, 500);
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    if (copyLongPressTimer.current && copyLongPressTimer.current !== 'longpress') {
                      clearTimeout(copyLongPressTimer.current);
                      quickCopyData();
                      copyLongPressTimer.current = null;
                    } else if (copyLongPressTimer.current === 'longpress') {
                      copyLongPressTimer.current = 'justopened';
                      setTimeout(() => {
                        if (copyLongPressTimer.current === 'justopened') {
                          copyLongPressTimer.current = null;
                        }
                      }, 300);
                    }
                  }}
                  onTouchCancel={() => {
                    if (copyLongPressTimer.current && copyLongPressTimer.current !== 'longpress' && copyLongPressTimer.current !== 'justopened') {
                      clearTimeout(copyLongPressTimer.current);
                    }
                    copyLongPressTimer.current = null;
                  }}
                  onClick={(e) => {
                    if (e.nativeEvent.pointerType === 'mouse' || (!('ontouchstart' in window) && !showCopyDropdown)) {
                      quickCopyData();
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setShowCopyDropdown(true);
                  }}
                  style={{
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    borderRadius: '8px',
                    height: '36px',
                    padding: '0 12px',
                    color: '#34d399',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  title={`Copy last ${copyDays} days to clipboard (hold for options)`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <span style={{ fontSize: '12px', fontWeight: '500' }}>{copyDays}</span>
                </button>

                {/* Dropdown for selecting days */}
                {showCopyDropdown && (
                  <>
                    <div
                      onClick={() => {
                        if (copyLongPressTimer.current === 'justopened') return;
                        setShowCopyDropdown(false);
                      }}
                      onTouchEnd={(e) => {
                        if (copyLongPressTimer.current === 'justopened') {
                          e.preventDefault();
                          return;
                        }
                        setShowCopyDropdown(false);
                      }}
                      style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 199,
                      }}
                    />
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '4px',
                      background: '#1a1a1a',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                      zIndex: 200,
                      overflow: 'hidden',
                      minWidth: '100px',
                    }}>
                      {[1, 7, 14, 30].map((days, index, arr) => (
                        <button
                          key={days}
                          onClick={() => {
                            setCopyDays(days);
                            setShowCopyDropdown(false);
                            haptic('light');
                          }}
                          style={{
                            width: '100%',
                            padding: '12px 16px',
                            background: days === copyDays ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                            border: 'none',
                            borderBottom: index < arr.length - 1 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
                            color: days === copyDays ? '#34d399' : '#e5e7eb',
                            fontSize: '14px',
                            fontWeight: days === copyDays ? '500' : '400',
                            cursor: 'pointer',
                            textAlign: 'left',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>{days} day{days > 1 ? 's' : ''}</span>
                          {days === copyDays && <span style={{ color: '#34d399' }}>✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Rapid Entry Button - same group as copy */}
              <button
                onClick={() => {
                  if (trackingMode === 'ampm' && !quickLogTime) {
                    setQuickLogTime(getCurrentTimePeriod());
                  }
                  if (incompleteSymptoms.length === 0 && totalActiveSymptoms > 0) {
                    setRapidEntryConfirm(true);
                    setRapidEntryMode(true);
                  } else {
                    setRapidEntryMode(true);
                  }
                }}
                style={{
                  background: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  borderRadius: '8px',
                  height: '36px',
                  padding: '0 12px',
                  color: '#34d399',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
                title="Rapid Entry Mode"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
                <span style={{ fontSize: '12px', fontWeight: '500' }}>Rapid</span>
              </button>
            </div>
          )}

          {/* Edit Button (pencil icon) - separate from the group */}
          <button
            onClick={() => appMode === 'symptoms' ? setShowAddSymptom(true) : setShowManageStack(true)}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: '9999px',
              width: '36px',
              height: '36px',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={appMode === 'symptoms' ? 'Manage Symptoms' : 'Manage Stack'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
