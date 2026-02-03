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
      padding: '12px 16px',
      paddingTop: 'calc(12px + env(safe-area-inset-top))',
      zIndex: 100,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
      }}>
        {/* Left side: date navigation - fixed width container */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '158px', flexShrink: 0 }}>
          <button
            onClick={() => changeDate(-1)}
            style={{
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '5px',
              width: '32px',
              height: '32px',
              color: '#a5b4fc',
              fontSize: '16px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ‹
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
              padding: '4px 2px',
              flex: 1,
              minWidth: 0,
            }}
          >
            <span style={{
              color: '#f8fafc',
              fontSize: '14px',
              fontWeight: '600',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'block',
            }}>
              {formatDate(selectedDate)}
            </span>
          </button>

          <button
            onClick={() => changeDate(1)}
            disabled={!canGoForward}
            style={{
              background: canGoForward ? 'rgba(99, 102, 241, 0.15)' : 'rgba(50, 50, 70, 0.3)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '5px',
              width: '32px',
              height: '32px',
              color: canGoForward ? '#a5b4fc' : '#475569',
              fontSize: '16px',
              cursor: canGoForward ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: canGoForward ? 1 : 0.5,
              flexShrink: 0,
            }}
          >
            ›
          </button>
        </div>

        {/* Right side: action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {/* Quick Copy Button */}
          {appMode === 'symptoms' && (
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
                  background: 'rgba(34, 197, 94, 0.15)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: '5px',
                  height: '32px',
                  padding: '0 8px',
                  color: '#4ade80',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                }}
                title={`Copy last ${copyDays} days to clipboard (hold for options)`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span style={{ fontSize: '11px', fontWeight: '600' }}>{copyDays}</span>
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
                    background: 'rgba(30, 27, 75, 0.98)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
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
                          background: days === copyDays ? 'rgba(34, 197, 94, 0.2)' : 'transparent',
                          border: 'none',
                          borderBottom: index < arr.length - 1 ? '1px solid rgba(100, 116, 139, 0.15)' : 'none',
                          color: days === copyDays ? '#4ade80' : '#e2e8f0',
                          fontSize: '14px',
                          fontWeight: days === copyDays ? '600' : '400',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>{days} day{days > 1 ? 's' : ''}</span>
                        {days === copyDays && <span style={{ color: '#4ade80' }}>✓</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Rapid Entry Button */}
          {appMode === 'symptoms' && (
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
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '5px',
                height: '32px',
                padding: '0 8px',
                color: '#34d399',
                fontSize: '10px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '3px',
              }}
              title="Rapid Entry Mode"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#34d399" stroke="none">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              Rapid
            </button>
          )}

          {/* Edit Button (pencil icon) - extra margin to separate from action buttons */}
          <button
            onClick={() => appMode === 'symptoms' ? setShowAddSymptom(true) : setShowManageStack(true)}
            style={{
              marginLeft: '10px',
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '5px',
              width: '32px',
              height: '32px',
              color: '#a5b4fc',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={appMode === 'symptoms' ? 'Manage Symptoms' : 'Manage Stack'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
