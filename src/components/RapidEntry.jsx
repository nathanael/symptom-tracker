import { severityColors } from '../utils/constants';
import { isMobile, getDateKey, haptic } from '../utils/helpers';

export default function RapidEntry({
  symptoms,
  entries,
  selectedDate,
  trackingMode,
  timePeriods,
  quickLogTime,
  setQuickLogTime,
  rapidEntryIndex,
  setRapidEntryIndex,
  rapidEntryConfirm,
  setRapidEntryConfirm,
  setRapidEntryMode,
  quickLog,
  setEntries,
  getMostRecentEntry,
  setCopyToastMessage,
}) {
  const activeSymptomsList = symptoms.filter(s => s.active);
  const currentSymptom = activeSymptomsList[rapidEntryIndex];

  const getCurrentTimePeriod = () => {
    if (trackingMode !== 'ampm') return 'daily';
    const hour = new Date().getHours();
    return hour < 12 ? 'morning' : 'evening';
  };

  const logTime = quickLogTime || getCurrentTimePeriod();
  const dateKey = getDateKey(selectedDate);
  const timeKey = trackingMode === 'ampm' ? logTime : 'daily';

  const handleClose = () => {
    setRapidEntryMode(false);
    setRapidEntryConfirm(false);
    setRapidEntryIndex(0);
  };

  // If all complete, show confirmation screen
  if (rapidEntryConfirm) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(180deg, #0c0a1d 0%, #1a1333 100%)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        padding: '20px',
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}>
          <div style={{ color: '#34d399', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#34d399" stroke="none">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Rapid Entry
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '3px',
              padding: '8px 16px',
              color: '#f87171',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {/* Completion content */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '24px',
        }}>
          <div style={{ color: '#10b981', fontSize: '48px' }}>✓</div>
          <div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: '600', textAlign: 'center' }}>
            All {trackingMode === 'ampm' ? (logTime === 'morning' ? 'AM' : 'PM') : ''} symptoms logged
          </div>

          {/* Check if opposite period has incomplete symptoms */}
          {trackingMode === 'ampm' && (() => {
            const oppositePeriod = logTime === 'morning' ? 'evening' : 'morning';
            const oppositeLabel = oppositePeriod === 'morning' ? 'AM' : 'PM';

            const oppositeIncomplete = activeSymptomsList.filter(symptom => {
              const entryKey = `${dateKey}-${symptom.id}-${oppositePeriod}`;
              return !entries[entryKey];
            });

            if (oppositeIncomplete.length > 0) {
              return (
                <button
                  onClick={() => {
                    setQuickLogTime(oppositePeriod);
                    setRapidEntryConfirm(false);
                    setRapidEntryIndex(0);
                  }}
                  style={{
                    padding: '14px 28px',
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    borderRadius: '5px',
                    color: '#34d399',
                    fontSize: '15px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  Switch to {oppositeLabel} ({oppositeIncomplete.length} incomplete)
                </button>
              );
            }
            return null;
          })()}

          <div style={{ color: '#94a3b8', fontSize: '14px', textAlign: 'center', marginTop: '8px' }}>
            Or start over to re-enter this period?
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleClose}
              style={{
                padding: '12px 24px',
                background: 'rgba(100, 116, 139, 0.1)',
                border: '1px solid rgba(100, 116, 139, 0.3)',
                borderRadius: '5px',
                color: '#94a3b8',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
            <button
              onClick={() => {
                // Clear entries for this period and start over
                const newEntries = { ...entries };
                activeSymptomsList.forEach(symptom => {
                  const entryKey = `${dateKey}-${symptom.id}-${timeKey}`;
                  delete newEntries[entryKey];
                });
                setEntries(newEntries);
                setRapidEntryConfirm(false);
                setRapidEntryIndex(0);
              }}
              style={{
                padding: '12px 24px',
                background: 'rgba(139, 92, 246, 0.2)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
                borderRadius: '5px',
                color: '#c4b5fd',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Start Over
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentSymptom) {
    handleClose();
    return null;
  }

  const entryKey = `${dateKey}-${currentSymptom.id}-${timeKey}`;
  const currentEntry = entries[entryKey];

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'linear-gradient(180deg, #0c0a1d 0%, #1a1333 100%)',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      padding: '20px',
      paddingTop: 'calc(20px + env(safe-area-inset-top))',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <div style={{ color: '#34d399', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#34d399" stroke="none">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Rapid Entry
        </div>
        <button
          onClick={handleClose}
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '3px',
            padding: '8px 16px',
            color: '#f87171',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Close
          {!isMobile() && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#94635a', fontWeight: '400' }}>Esc</span>}
        </button>
      </div>

      {/* Progress indicator */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '20px',
      }}>
        {activeSymptomsList.map((symptom, idx) => {
          const symptomEntryKey = `${dateKey}-${symptom.id}-${timeKey}`;
          const hasEntry = !!entries[symptomEntryKey];

          return (
            <div
              key={symptom.id}
              style={{
                flex: 1,
                height: '4px',
                borderRadius: '2px',
                background: idx === rapidEntryIndex
                  ? '#8b5cf6'
                  : hasEntry
                    ? '#10b981'
                    : 'rgba(100, 116, 139, 0.3)',
              }}
            />
          );
        })}
      </div>

      {/* Current symptom */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '30px',
      }}>
        {/* Counter */}
        <div style={{ color: '#64748b', fontSize: '14px' }}>
          {rapidEntryIndex + 1} of {activeSymptomsList.length}
        </div>

        {/* Symptom name */}
        <div style={{
          color: '#f8fafc',
          fontSize: '28px',
          fontWeight: '700',
          textAlign: 'center',
        }}>
          {currentSymptom.name}
        </div>

        {/* Time period indicator */}
        {timePeriods.length > 1 && (
          <div style={{ display: 'flex', gap: '12px' }}>
            {timePeriods.map(period => {
              const isSelected = logTime === period.id;
              return (
                <button
                  key={period.id}
                  onClick={() => setQuickLogTime(period.id)}
                  style={{
                    padding: '10px 20px',
                    background: isSelected ? 'rgba(139, 92, 246, 0.3)' : 'rgba(100, 116, 139, 0.1)',
                    border: isSelected ? '2px solid rgba(139, 92, 246, 0.6)' : '2px solid transparent',
                    borderRadius: '5px',
                    color: isSelected ? '#c4b5fd' : '#94a3b8',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  {period.icon} {period.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Most recent value hint */}
        {(() => {
          const recentEntry = getMostRecentEntry(currentSymptom.id, logTime);
          if (recentEntry) {
            return (
              <div style={{ color: '#64748b', fontSize: '14px' }}>
                Last recorded: <span style={{ color: severityColors[recentEntry.severity], fontWeight: '600' }}>{recentEntry.severity}</span>
              </div>
            );
          }
          return null;
        })()}

        {/* Large severity buttons */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          width: '100%',
          maxWidth: '400px',
        }}>
          {[0, 1, 2, 3, 4, 5].map(severity => {
            const isCurrentSelection = currentEntry?.severity === severity;
            const recentEntry = getMostRecentEntry(currentSymptom.id, logTime);
            const isRecentSeverity = recentEntry?.severity === severity && !currentEntry;

            return (
              <button
                key={severity}
                onClick={() => {
                  if (isCurrentSelection) {
                    // Clear selection
                    setEntries(prev => {
                      const newEntries = { ...prev };
                      delete newEntries[entryKey];
                      return newEntries;
                    });
                  } else {
                    // Set/change value and advance
                    quickLog(currentSymptom.id, severity, logTime);

                    if (rapidEntryIndex < activeSymptomsList.length - 1) {
                      setRapidEntryIndex(prev => prev + 1);
                    } else {
                      // At end - show completion
                      setRapidEntryMode(false);
                      setRapidEntryIndex(0);
                      setCopyToastMessage('✓ All symptoms logged!');
                      setTimeout(() => setCopyToastMessage(''), 3000);
                    }
                  }
                }}
                style={{
                  padding: '24px',
                  background: isCurrentSelection
                    ? `${severityColors[severity]}40`
                    : `${severityColors[severity]}20`,
                  border: isCurrentSelection
                    ? `3px solid ${severityColors[severity]}`
                    : isRecentSeverity
                      ? `2px solid ${severityColors[severity]}40`
                      : '2px solid transparent',
                  borderRadius: '3px',
                  color: severityColors[severity],
                  fontSize: '32px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  position: 'relative',
                  boxShadow: isCurrentSelection ? `0 0 12px ${severityColors[severity]}50` : 'none',
                }}
              >
                {severity}
                {isCurrentSelection && (
                  <span style={{
                    position: 'absolute',
                    top: '4px',
                    right: '6px',
                    fontSize: '12px',
                    color: severityColors[severity],
                  }}>✓</span>
                )}
                {!isMobile() && !isCurrentSelection && (
                  <span style={{
                    position: 'absolute',
                    bottom: '4px',
                    right: '6px',
                    fontSize: '10px',
                    color: '#475569',
                    fontWeight: '500',
                  }}>{severity}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Navigation buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => {
              if (rapidEntryIndex > 0) {
                setRapidEntryIndex(prev => prev - 1);
              }
            }}
            disabled={rapidEntryIndex === 0}
            style={{
              padding: '12px 24px',
              background: rapidEntryIndex > 0 ? 'rgba(100, 116, 139, 0.1)' : 'rgba(50, 50, 70, 0.2)',
              border: '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: '5px',
              color: rapidEntryIndex > 0 ? '#94a3b8' : '#475569',
              fontSize: '14px',
              fontWeight: '600',
              cursor: rapidEntryIndex > 0 ? 'pointer' : 'default',
              opacity: rapidEntryIndex > 0 ? 1 : 0.5,
            }}
          >
            ← Back
            {!isMobile() && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#475569', fontWeight: '400' }}>Z</span>}
          </button>

          <button
            onClick={() => {
              if (rapidEntryIndex < activeSymptomsList.length - 1) {
                setRapidEntryIndex(prev => prev + 1);
              } else {
                handleClose();
              }
            }}
            style={{
              padding: '12px 24px',
              background: 'rgba(100, 116, 139, 0.1)',
              border: '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: '5px',
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            {rapidEntryIndex < activeSymptomsList.length - 1 ? 'Skip →' : 'Done'}
            {!isMobile() && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#475569', fontWeight: '400' }}>Space</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
