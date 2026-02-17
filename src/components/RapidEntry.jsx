import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { severityColors, NA_SEVERITY } from '../utils/constants';
import { isMobile, getDateKey, haptic } from '../utils/helpers';

export default function RapidEntry({
  symptoms,
  entries,
  selectedDate,
  trackingMode,
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
  const getCurrentTimePeriod = () => {
    if (trackingMode !== 'ampm') return 'daily';
    const hour = new Date().getHours();
    return hour < 12 ? 'morning' : 'evening';
  };

  const logTime = quickLogTime || getCurrentTimePeriod();
  const dateKey = getDateKey(selectedDate);
  const timeKey = trackingMode === 'ampm' ? logTime : 'daily';

  const activeSymptomsList = symptoms.filter(s => s.active).filter(s => {
    if (!s.applicablePeriods || trackingMode !== 'ampm') return true;
    return s.applicablePeriods.includes(logTime);
  });

  // Filter to only show unmarked symptoms (for counting remaining)
  const unmarkedSymptoms = activeSymptomsList.filter(symptom => {
    const entryKey = `${dateKey}-${symptom.id}-${timeKey}`;
    return !entries[entryKey];
  });

  // Current symptom comes from full list (allows navigating back to tracked items)
  const currentSymptom = activeSymptomsList[rapidEntryIndex];

  // Check if current symptom is marked
  const isCurrentMarked = currentSymptom ? !!entries[`${dateKey}-${currentSymptom.id}-${timeKey}`] : false;

  // Find next unmarked symptom index (for forward navigation, wraps around)
  const findNextUnmarkedIndex = (fromIndex) => {
    const len = activeSymptomsList.length;
    // Search forward from fromIndex+1, wrapping around
    for (let offset = 1; offset < len; offset++) {
      const i = (fromIndex + offset) % len;
      const sym = activeSymptomsList[i];
      const entryKey = `${dateKey}-${sym.id}-${timeKey}`;
      if (!entries[entryKey]) {
        return i;
      }
    }
    return -1; // All symptoms are marked
  };

  const handleClose = () => {
    setRapidEntryMode(false);
    setRapidEntryConfirm(false);
    setRapidEntryIndex(0);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') {
        // Back: go to previous symptom in full list (wraps around)
        setRapidEntryIndex(prev => prev > 0 ? prev - 1 : activeSymptomsList.length - 1);
      } else if (e.key === 'ArrowRight') {
        // Forward: skip to next unmarked symptom
        const nextUnmarked = findNextUnmarkedIndex(rapidEntryIndex);
        if (nextUnmarked !== -1) {
          setRapidEntryIndex(nextUnmarked);
        } else {
          handleClose();
        }
      } else if (e.key === 'Escape') {
        handleClose();
      } else if ((e.key >= '0' && e.key <= '5' || e.key === 'n' || e.key === 'N') && currentSymptom) {
        const severity = (e.key === 'n' || e.key === 'N') ? NA_SEVERITY : parseInt(e.key);
        quickLog(currentSymptom.id, severity, logTime);
        // After logging, move to next unmarked symptom
        // Check if this was the last unmarked symptom (or only one remaining which is current)
        const remainingUnmarked = unmarkedSymptoms.filter(s => s.id !== currentSymptom.id);
        if (remainingUnmarked.length === 0) {
          confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
          setRapidEntryMode(false);
          setRapidEntryIndex(0);
          setCopyToastMessage('✓ All symptoms logged!');
          setTimeout(() => setCopyToastMessage(''), 3000);
        } else {
          // Move to next unmarked symptom
          const nextUnmarked = findNextUnmarkedIndex(rapidEntryIndex);
          if (nextUnmarked !== -1) {
            setRapidEntryIndex(nextUnmarked);
          }
          // If no next unmarked, stay on current (user can press right to close)
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rapidEntryIndex, unmarkedSymptoms.length, currentSymptom, logTime, activeSymptomsList]);

  // Trigger confetti when entering confirmation screen
  useEffect(() => {
    if (rapidEntryConfirm) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }
  }, [rapidEntryConfirm]);

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

            const oppositeApplicable = symptoms.filter(s => s.active).filter(s => {
              if (!s.applicablePeriods) return true;
              return s.applicablePeriods.includes(oppositePeriod);
            });
            const oppositeIncomplete = oppositeApplicable.filter(symptom => {
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

          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
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

  // If no current symptom or no unmarked symptoms left, show completion or close
  if (!currentSymptom || (unmarkedSymptoms.length === 0 && rapidEntryIndex === 0)) {
    // Check if opposite period has incomplete symptoms (for AM/PM mode)
    if (trackingMode === 'ampm') {
      const oppositePeriod = logTime === 'morning' ? 'evening' : 'morning';
      const oppositeApplicable = symptoms.filter(s => s.active).filter(s => {
        if (!s.applicablePeriods) return true;
        return s.applicablePeriods.includes(oppositePeriod);
      });
      const oppositeIncomplete = oppositeApplicable.filter(symptom => {
        const entryKey = `${dateKey}-${symptom.id}-${oppositePeriod}`;
        return !entries[entryKey];
      });
      if (oppositeIncomplete.length > 0) {
        setRapidEntryConfirm(true);
        return null;
      }
    }
    // All done
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    setRapidEntryMode(false);
    setRapidEntryIndex(0);
    setCopyToastMessage('✓ All symptoms logged!');
    setTimeout(() => setCopyToastMessage(''), 3000);
    return null;
  }

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

      {/* Progress indicator - shows all symptoms */}
      <div style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '20px',
      }}>
        {activeSymptomsList.map((symptom) => {
          const symptomEntryKey = `${dateKey}-${symptom.id}-${timeKey}`;
          const entry = entries[symptomEntryKey];
          const hasEntry = !!entry;
          const isNA = entry?.severity === NA_SEVERITY;
          const isCurrent = currentSymptom && symptom.id === currentSymptom.id;

          return (
            <div
              key={symptom.id}
              style={{
                flex: 1,
                height: '4px',
                borderRadius: '2px',
                background: isCurrent
                  ? '#8b5cf6'
                  : hasEntry
                    ? isNA ? '#64748b' : '#10b981'
                    : 'rgba(100, 116, 139, 0.3)',
              }}
            />
          );
        })}
      </div>

      {/* Symptom name area - top section */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '12px',
      }}>
        {/* Counter */}
        <div style={{ color: '#64748b', fontSize: '14px' }}>
          {isCurrentMarked ? (
            <span style={{ color: '#10b981' }}>✓ Already logged</span>
          ) : (
            `${unmarkedSymptoms.findIndex(s => s.id === currentSymptom?.id) + 1} of ${unmarkedSymptoms.length} remaining`
          )}
        </div>

        {/* Symptom name + description */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            color: '#f8fafc',
            fontSize: '28px',
            fontWeight: '700',
          }}>
            {currentSymptom.name}
          </div>
          {currentSymptom.description && (
            <div style={{
              color: '#6b7280',
              fontSize: '15px',
              marginTop: '8px',
            }}>
              {currentSymptom.description}
            </div>
          )}
        </div>
      </div>

      {/* Value selectors - pinned to bottom */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        paddingBottom: isMobile() ? '20px' : '60px',
      }}>
        {/* Large severity buttons */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          width: '100%',
          maxWidth: '400px',
        }}>
          {[0, 1, 2, 3, 4, 5].map(severity => {
            const recentEntry = getMostRecentEntry(currentSymptom.id, logTime);
            const isRecentSeverity = recentEntry?.severity === severity;

            // Check if this severity is the currently selected value for this symptom
            const currentEntryKey = `${dateKey}-${currentSymptom.id}-${timeKey}`;
            const currentEntry = entries[currentEntryKey];
            const isCurrentValue = currentEntry?.severity === severity;

            return (
              <button
                key={severity}
                onClick={() => {
                  // Set value
                  quickLog(currentSymptom.id, severity, logTime);

                  // Check if this was the last unmarked symptom (or only remaining is current)
                  // Note: if we're editing an existing entry, we're not adding to unmarked count
                  const remainingUnmarked = unmarkedSymptoms.filter(s => s.id !== currentSymptom.id);
                  if (remainingUnmarked.length === 0 && !isCurrentMarked) {
                    // Check for opposite period in AM/PM mode
                    if (trackingMode === 'ampm') {
                      const oppositePeriod = logTime === 'morning' ? 'evening' : 'morning';
                      const oppApplicable = symptoms.filter(s => s.active).filter(s => {
                        if (!s.applicablePeriods) return true;
                        return s.applicablePeriods.includes(oppositePeriod);
                      });
                      const oppositeIncomplete = oppApplicable.filter(symptom => {
                        const ek = `${dateKey}-${symptom.id}-${oppositePeriod}`;
                        return !entries[ek];
                      });
                      if (oppositeIncomplete.length > 0) {
                        setRapidEntryConfirm(true);
                        return;
                      }
                    }
                    // All done
                    confetti({
                      particleCount: 100,
                      spread: 70,
                      origin: { y: 0.6 }
                    });
                    setRapidEntryMode(false);
                    setRapidEntryIndex(0);
                    setCopyToastMessage('✓ All symptoms logged!');
                    setTimeout(() => setCopyToastMessage(''), 3000);
                  } else if (!isCurrentMarked) {
                    // Move to next unmarked symptom
                    const nextUnmarked = findNextUnmarkedIndex(rapidEntryIndex);
                    if (nextUnmarked !== -1) {
                      setRapidEntryIndex(nextUnmarked);
                    }
                    // If no next unmarked after current, stay (user navigated back)
                  }
                  // If isCurrentMarked, stay on this symptom (user is editing)
                }}
                style={{
                  padding: '24px',
                  background: isCurrentValue
                    ? `${severityColors[severity]}40`
                    : isRecentSeverity
                      ? `${severityColors[severity]}30`
                      : `${severityColors[severity]}20`,
                  border: isCurrentValue
                    ? `3px solid ${severityColors[severity]}`
                    : '2px solid transparent',
                  borderRadius: '3px',
                  color: severityColors[severity],
                  fontSize: '32px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                {severity}
                {isCurrentValue && (
                  <span style={{
                    position: 'absolute',
                    top: '6px',
                    right: '6px',
                    fontSize: '16px',
                    color: severityColors[severity],
                  }}>✓</span>
                )}
                {!isMobile() && (
                  <span style={{
                    position: 'absolute',
                    top: '4px',
                    left: '6px',
                    fontSize: '11px',
                    color: '#64748b',
                    fontWeight: '600',
                    background: 'rgba(0,0,0,0.3)',
                    padding: '2px 5px',
                    borderRadius: '3px',
                  }}>{severity}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* N/A Button */}
        <button
          onClick={() => {
            quickLog(currentSymptom.id, NA_SEVERITY, logTime);

            const remainingUnmarked = unmarkedSymptoms.filter(s => s.id !== currentSymptom.id);
            if (remainingUnmarked.length === 0 && !isCurrentMarked) {
              if (trackingMode === 'ampm') {
                const oppositePeriod = logTime === 'morning' ? 'evening' : 'morning';
                const oppApplicable = symptoms.filter(s => s.active).filter(s => {
                  if (!s.applicablePeriods) return true;
                  return s.applicablePeriods.includes(oppositePeriod);
                });
                const oppositeIncomplete = oppApplicable.filter(symptom => {
                  const ek = `${dateKey}-${symptom.id}-${oppositePeriod}`;
                  return !entries[ek];
                });
                if (oppositeIncomplete.length > 0) {
                  setRapidEntryConfirm(true);
                  return;
                }
              }
              confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
              setRapidEntryMode(false);
              setRapidEntryIndex(0);
              setCopyToastMessage('✓ All symptoms logged!');
              setTimeout(() => setCopyToastMessage(''), 3000);
            } else if (!isCurrentMarked) {
              const nextUnmarked = findNextUnmarkedIndex(rapidEntryIndex);
              if (nextUnmarked !== -1) {
                setRapidEntryIndex(nextUnmarked);
              }
            }
          }}
          style={{
            width: '100%',
            maxWidth: '400px',
            padding: '14px',
            background: entries[`${dateKey}-${currentSymptom.id}-${timeKey}`]?.severity === NA_SEVERITY
              ? 'rgba(100, 116, 139, 0.3)'
              : 'rgba(100, 116, 139, 0.1)',
            border: entries[`${dateKey}-${currentSymptom.id}-${timeKey}`]?.severity === NA_SEVERITY
              ? '2px solid #64748b'
              : '2px solid transparent',
            borderRadius: '3px',
            color: '#94a3b8',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          N/A
          {!isMobile() && (
            <span style={{
              background: 'rgba(100, 116, 139, 0.3)',
              padding: '2px 6px',
              borderRadius: '3px',
              marginLeft: '8px',
              fontSize: '12px',
            }}>n</span>
          )}
        </button>

        {/* Navigation buttons */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => {
              setRapidEntryIndex(prev => prev > 0 ? prev - 1 : activeSymptomsList.length - 1);
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
            {!isMobile() && (
              <span style={{
                background: 'rgba(100, 116, 139, 0.3)',
                padding: '2px 6px',
                borderRadius: '3px',
                marginRight: '8px',
                fontSize: '12px',
              }}>←</span>
            )}
            Back
          </button>

          <button
            onClick={() => {
              // Forward: skip to next unmarked symptom
              const nextUnmarked = findNextUnmarkedIndex(rapidEntryIndex);
              if (nextUnmarked !== -1) {
                setRapidEntryIndex(nextUnmarked);
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
            {findNextUnmarkedIndex(rapidEntryIndex) !== -1 ? 'Skip' : 'Done'}
            {!isMobile() && (
              <span style={{
                background: 'rgba(100, 116, 139, 0.3)',
                padding: '2px 6px',
                borderRadius: '3px',
                marginLeft: '8px',
                fontSize: '12px',
              }}>→</span>
            )}
          </button>
        </div>
      </div>

      {/* Keyboard shortcuts bar - typeform style (desktop only) */}
      {!isMobile() && (
      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '20px',
        right: '20px',
        display: 'flex',
        justifyContent: 'center',
        gap: '16px',
        color: '#64748b',
        fontSize: '12px',
        flexWrap: 'wrap',
      }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              background: 'rgba(100, 116, 139, 0.2)',
              padding: '4px 8px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}>0-5</span>
            <span>severity</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              background: 'rgba(100, 116, 139, 0.2)',
              padding: '4px 8px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '12px',
            }}>n</span>
            <span>N/A</span>
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
