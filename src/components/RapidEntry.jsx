import { useEffect } from 'react';
import confetti from 'canvas-confetti';
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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft' && rapidEntryIndex > 0) {
        setRapidEntryIndex(prev => prev - 1);
      } else if (e.key === 'ArrowRight') {
        if (rapidEntryIndex < activeSymptomsList.length - 1) {
          setRapidEntryIndex(prev => prev + 1);
        } else {
          handleClose();
        }
      } else if (e.key === 'Escape') {
        handleClose();
      } else if (e.key >= '0' && e.key <= '5' && currentSymptom) {
        const severity = parseInt(e.key);
        quickLog(currentSymptom.id, severity, logTime);
        if (rapidEntryIndex < activeSymptomsList.length - 1) {
          setRapidEntryIndex(prev => prev + 1);
        } else {
          confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
          setRapidEntryMode(false);
          setRapidEntryIndex(0);
          setCopyToastMessage('✓ All symptoms logged!');
          setTimeout(() => setCopyToastMessage(''), 3000);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rapidEntryIndex, activeSymptomsList.length, currentSymptom, logTime]);

  // If all complete, show confirmation screen
  if (rapidEntryConfirm) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#08090A',
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
      background: '#08090A',
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
                      // At end - show completion with confetti
                      confetti({
                        particleCount: 100,
                        spread: 70,
                        origin: { y: 0.6 }
                      });
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
                {!isMobile() && (
                  <span style={{
                    position: 'absolute',
                    top: '4px',
                    left: '6px',
                    fontSize: '11px',
                    color: isCurrentSelection ? severityColors[severity] : '#64748b',
                    fontWeight: '600',
                    background: isCurrentSelection ? 'transparent' : 'rgba(0,0,0,0.3)',
                    padding: '2px 5px',
                    borderRadius: '3px',
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
            Back
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
            {rapidEntryIndex < activeSymptomsList.length - 1 ? 'Skip' : 'Done'}
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts bar - typeform style */}
      {!isMobile() && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          right: '20px',
          display: 'flex',
          justifyContent: 'center',
          gap: '24px',
          color: '#64748b',
          fontSize: '13px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              background: 'rgba(100, 116, 139, 0.2)',
              padding: '4px 8px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}>0-5</span>
            <span>select value</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              background: 'rgba(100, 116, 139, 0.2)',
              padding: '4px 8px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}>←</span>
            <span>back</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              background: 'rgba(100, 116, 139, 0.2)',
              padding: '4px 8px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}>→</span>
            <span>skip</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              background: 'rgba(100, 116, 139, 0.2)',
              padding: '4px 8px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}>esc</span>
            <span>close</span>
          </div>
        </div>
      )}
    </div>
  );
}
