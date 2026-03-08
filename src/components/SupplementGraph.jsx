import { useState, useMemo, useRef, useCallback } from 'react';
import { haptic, isScheduledForDate, getDateKey, getSupplementAdherence, getSupplementStreak } from '../utils/helpers';
import {
  TIMEFRAMES, COLORS, SMOOTH_WINDOWS,
  generateDateRange, interpolateSmallGaps, smooth,
  formatXLabel, getXLabelInterval, buildPath, getDailyValue,
} from '../utils/chartHelpers';

export default function SupplementGraph({
  primaryItemId,
  stackItems,
  stackEntries,
  symptoms,
  entries,
  trackingMode,
  onClose,
  onChangeItem,
  isDesktop,
}) {
  const [timeframe, setTimeframe] = useState(28);
  const [viewMode, setViewMode] = useState('adherence'); // 'adherence' or 'dose'
  const [compareIds, setCompareIds] = useState([]);
  const [overlaySymptomId, setOverlaySymptomId] = useState(null);
  const [touchX, setTouchX] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showSymptomPicker, setShowSymptomPicker] = useState(false);
  const svgRef = useRef(null);

  const primaryItem = stackItems.find(i => i.id === primaryItemId);
  const activeItems = stackItems.filter(i => i.active).sort((a, b) => (a.order || 0) - (b.order || 0));

  // Chart dimensions
  const W = 340, H = 200;
  const padLeft = 32, padRight = overlaySymptomId ? 28 : 10, padTop = 18, padBottom = 28;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const dates = useMemo(() => generateDateRange(timeframe), [timeframe]);

  // Build adherence series: rolling 7-day adherence % for a supplement
  const buildAdherenceSeries = useCallback((itemId) => {
    const item = stackItems.find(i => i.id === itemId);
    if (!item) return dates.map(() => null);

    return dates.map((dateStr, idx) => {
      // Look back 7 days (or fewer if at start)
      const windowStart = Math.max(0, idx - 6);
      let taken = 0, scheduled = 0;
      for (let j = windowStart; j <= idx; j++) {
        const d = new Date(dates[j] + 'T12:00:00');
        if (!isScheduledForDate(item.schedule, d)) continue;
        scheduled++;
        const entryKey = `${dates[j]}-${itemId}`;
        if (stackEntries[entryKey]?.taken) taken++;
      }
      if (scheduled === 0) return null;
      return (taken / scheduled) * 100;
    });
  }, [dates, stackItems, stackEntries]);

  // Build dose series: actual dose taken per day
  const buildDoseSeries = useCallback((itemId) => {
    return dates.map(dateStr => {
      const entryKey = `${dateStr}-${itemId}`;
      const entry = stackEntries[entryKey];
      if (!entry?.taken) return null;
      return entry.dose || 0;
    });
  }, [dates, stackEntries]);

  // Build symptom overlay series
  const buildSymptomSeries = useCallback((symptomId) => {
    const raw = dates.map(d => getDailyValue(entries, d, symptomId, trackingMode));
    const filled = interpolateSmallGaps(raw);
    const windowSize = SMOOTH_WINDOWS[timeframe] || 5;
    return smooth(filled, windowSize);
  }, [dates, entries, trackingMode, timeframe]);

  const buildSeries = viewMode === 'adherence' ? buildAdherenceSeries : buildDoseSeries;

  const primaryData = useMemo(() => buildSeries(primaryItemId), [buildSeries, primaryItemId]);
  const compareDatas = useMemo(() => compareIds.map(id => buildSeries(id)), [buildSeries, compareIds]);
  const symptomData = useMemo(
    () => overlaySymptomId ? buildSymptomSeries(overlaySymptomId) : null,
    [overlaySymptomId, buildSymptomSeries]
  );

  // Y-axis range
  const yMax = useMemo(() => {
    if (viewMode === 'adherence') return 100;
    // For dose view, find max dose across all series
    let max = 0;
    [primaryData, ...compareDatas].forEach(data => {
      data.forEach(v => { if (v !== null && v > max) max = v; });
    });
    return max > 0 ? Math.ceil(max * 1.1) : 100;
  }, [viewMode, primaryData, compareDatas]);

  // Convert data to SVG points
  const toPoints = useCallback((data) => {
    return data.map((val, i) => ({
      x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
      y: val === null ? null : padTop + chartH - (val / yMax) * chartH,
      val,
    }));
  }, [dates.length, chartW, chartH, yMax]);

  // Symptom overlay uses right Y-axis (0-5)
  const toSymptomPoints = useCallback((data) => {
    return data.map((val, i) => ({
      x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
      y: val === null ? null : padTop + chartH - (val / 5) * chartH,
      val,
    }));
  }, [dates.length, chartW, chartH]);

  const primaryPoints = useMemo(() => toPoints(primaryData), [toPoints, primaryData]);
  const comparePoints = useMemo(() => compareDatas.map(d => toPoints(d)), [toPoints, compareDatas]);
  const symptomPoints = useMemo(
    () => symptomData ? toSymptomPoints(symptomData) : null,
    [symptomData, toSymptomPoints]
  );

  // X-axis labels
  const interval = getXLabelInterval(timeframe);
  const xLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < dates.length; i += interval) {
      labels.push({
        x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
        label: formatXLabel(dates[i], timeframe),
      });
    }
    return labels;
  }, [dates, interval, chartW, timeframe]);

  // Y-axis labels
  const yLabels = useMemo(() => {
    if (viewMode === 'adherence') {
      return [0, 25, 50, 75, 100];
    }
    const step = yMax > 200 ? 100 : yMax > 50 ? 25 : yMax > 10 ? 5 : 1;
    const labels = [];
    for (let v = 0; v <= yMax; v += step) labels.push(v);
    return labels;
  }, [viewMode, yMax]);

  // Touch crosshair
  const getSnappedIndex = useCallback((clientX) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = clientX - rect.left;
    const svgX = (relX / rect.width) * W;
    const dataX = svgX - padLeft;
    const idx = Math.round((dataX / chartW) * (dates.length - 1));
    return Math.max(0, Math.min(dates.length - 1, idx));
  }, [chartW, dates.length]);

  const handleTouchStart = (e) => { e.preventDefault(); setTouchX(getSnappedIndex(e.touches[0].clientX)); };
  const handleTouchMove = (e) => { e.preventDefault(); setTouchX(getSnappedIndex(e.touches[0].clientX)); };
  const handleTouchEnd = () => setTouchX(null);
  const handleMouseMove = (e) => setTouchX(getSnappedIndex(e.clientX));
  const handleMouseLeave = () => setTouchX(null);

  // Crosshair tooltip
  const crosshairData = useMemo(() => {
    if (touchX === null) return null;
    const date = dates[touchX];
    const d = new Date(date + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const unit = viewMode === 'adherence' ? '%' : (primaryItem?.unit || '');
    const items = [
      { name: primaryItem?.name, color: COLORS.primary, val: primaryData[touchX], unit },
    ];
    compareIds.forEach((id, i) => {
      const item = stackItems.find(s => s.id === id);
      const cUnit = viewMode === 'adherence' ? '%' : (item?.unit || '');
      items.push({
        name: item?.name,
        color: i === 0 ? COLORS.compare1 : COLORS.compare2,
        val: compareDatas[i]?.[touchX],
        unit: cUnit,
      });
    });
    if (symptomData && overlaySymptomId) {
      const sym = symptoms.find(s => s.id === overlaySymptomId);
      items.push({
        name: sym?.name,
        color: 'rgba(251, 113, 133, 0.8)',
        val: symptomData[touchX],
        unit: '/5',
      });
    }
    return { dateLabel, items, x: padLeft + (touchX / Math.max(1, dates.length - 1)) * chartW };
  }, [touchX, dates, primaryItem, primaryData, compareIds, compareDatas, stackItems, viewMode, symptomData, overlaySymptomId, symptoms, chartW]);

  // Summary stats
  const stats = useMemo(() => {
    const adherence = getSupplementAdherence(primaryItemId, stackEntries, stackItems, timeframe);
    const streak = getSupplementStreak(primaryItemId, stackEntries, stackItems);

    // Longest streak (look through all dates in timeframe)
    let longestStreak = 0;
    let currentStreak = 0;
    const item = stackItems.find(i => i.id === primaryItemId);
    if (item) {
      for (const dateStr of dates) {
        const d = new Date(dateStr + 'T12:00:00');
        if (!isScheduledForDate(item.schedule, d)) continue;
        const entryKey = `${dateStr}-${primaryItemId}`;
        if (stackEntries[entryKey]?.taken) {
          currentStreak++;
          if (currentStreak > longestStreak) longestStreak = currentStreak;
        } else {
          currentStreak = 0;
        }
      }
    }

    // Average dose (if dose varies)
    let doseSum = 0, doseCount = 0;
    dates.forEach(dateStr => {
      const entryKey = `${dateStr}-${primaryItemId}`;
      const entry = stackEntries[entryKey];
      if (entry?.taken) {
        doseSum += entry.dose || 0;
        doseCount++;
      }
    });

    return {
      adherenceRate: adherence.rate,
      taken: adherence.taken,
      scheduled: adherence.scheduled,
      currentStreak: streak,
      longestStreak,
      avgDose: doseCount > 0 ? (doseSum / doseCount).toFixed(1) : '--',
      doseUnit: item?.unit || '',
    };
  }, [primaryItemId, stackEntries, stackItems, timeframe, dates]);

  const showDots = timeframe <= 28;

  const toggleCompare = (id) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  return (
    <div
      style={isDesktop ? {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px',
      } : {
        position: 'fixed',
        inset: 0,
        background: '#08090A',
        zIndex: 100,
        overflowY: 'auto',
        padding: '20px 20px 120px 20px',
        paddingTop: 'calc(20px + env(safe-area-inset-top))',
      }}
      onClick={isDesktop ? onClose : undefined}
    >
      <div
        style={isDesktop ? {
          maxWidth: '800px',
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          background: '#08090A',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '24px',
        } : {
          maxWidth: '700px',
          margin: '0 auto',
        }}
        onClick={isDesktop ? (e) => e.stopPropagation() : undefined}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
            fontSize: '16px',
            cursor: 'pointer',
            padding: '8px 0',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        {/* Title with prev/next */}
        {(() => {
          const list = activeItems;
          const currentIdx = list.findIndex(i => i.id === primaryItemId);
          const hasPrev = currentIdx > 0;
          const hasNext = currentIdx >= 0 && currentIdx < list.length - 1;
          const go = (idx) => {
            if (onChangeItem && list[idx]) {
              setCompareIds([]);
              setShowPicker(false);
              setShowSymptomPicker(false);
              setTouchX(null);
              setOverlaySymptomId(null);
              onChangeItem(list[idx].id);
              haptic('light');
            }
          };
          return (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              margin: '0 0 20px 0',
            }}>
              <button
                onClick={() => hasPrev && go(currentIdx - 1)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: hasPrev ? '#9ca3af' : 'rgba(255,255,255,0.1)',
                  cursor: hasPrev ? 'pointer' : 'default',
                  padding: '8px 4px',
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <div style={{
                flex: 1,
                textAlign: 'center',
                overflow: 'hidden',
                minWidth: 0,
              }}>
                <div style={{
                  color: '#f8fafc',
                  fontSize: '22px',
                  fontWeight: '600',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {primaryItem?.name || 'Supplement'}
                </div>
                {primaryItem?.description && (
                  <div style={{
                    color: '#6b7280',
                    fontSize: '13px',
                    fontWeight: '400',
                    marginTop: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {primaryItem.description}
                  </div>
                )}
              </div>
              <button
                onClick={() => hasNext && go(currentIdx + 1)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: hasNext ? '#9ca3af' : 'rgba(255,255,255,0.1)',
                  cursor: hasNext ? 'pointer' : 'default',
                  padding: '8px 4px',
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
            </div>
          );
        })()}

        {/* View mode toggle */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px',
          padding: '4px',
          marginBottom: '16px',
          borderRadius: '12px',
          background: 'rgba(23, 23, 23, 0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          {[{ id: 'adherence', label: 'Adherence' }, { id: 'dose', label: 'Dose' }].map(mode => (
            <button
              key={mode.id}
              onClick={() => { setViewMode(mode.id); haptic('light'); }}
              style={{
                padding: '10px',
                borderRadius: '8px',
                border: 'none',
                background: viewMode === mode.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                boxShadow: viewMode === mode.id ? '0 1px 2px rgba(0,0,0,0.05), inset 0 0 0 1px rgba(255,255,255,0.05)' : 'none',
                color: viewMode === mode.id ? '#fff' : '#a3a3a3',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Timeframe selector */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${TIMEFRAMES.length}, 1fr)`,
          gap: '4px',
          padding: '4px',
          marginBottom: '24px',
          borderRadius: '12px',
          background: 'rgba(23, 23, 23, 0.5)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.days}
              onClick={() => { setTimeframe(tf.days); haptic('light'); }}
              style={{
                padding: '10px',
                borderRadius: '8px',
                border: 'none',
                background: timeframe === tf.days ? 'rgba(255,255,255,0.1)' : 'transparent',
                boxShadow: timeframe === tf.days ? '0 1px 2px rgba(0,0,0,0.05), inset 0 0 0 1px rgba(255,255,255,0.05)' : 'none',
                color: timeframe === tf.days ? '#fff' : '#a3a3a3',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* SVG Chart */}
        <div style={{
          background: 'rgba(15, 17, 21, 0.6)',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.06)',
          padding: '12px 8px',
          marginBottom: '20px',
          touchAction: 'none',
        }}>
          <svg
            ref={svgRef}
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ display: 'block' }}
          >
            {/* Grid lines */}
            {yLabels.map(val => {
              const y = padTop + chartH - (val / yMax) * chartH;
              return (
                <line key={val} x1={padLeft} y1={y} x2={W - padRight} y2={y}
                  stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              );
            })}

            {/* Y-axis labels (left) */}
            {yLabels.map(val => {
              const y = padTop + chartH - (val / yMax) * chartH;
              return (
                <text key={val} x={padLeft - 6} y={y + 4} textAnchor="end"
                  fill="#6b7280" fontSize="9" fontFamily="system-ui">
                  {viewMode === 'adherence' ? `${val}%` : val}
                </text>
              );
            })}

            {/* Right Y-axis for symptom overlay (0-5) */}
            {overlaySymptomId && [0, 1, 2, 3, 4, 5].map(sev => {
              const y = padTop + chartH - (sev / 5) * chartH;
              return (
                <text key={`r-${sev}`} x={W - padRight + 6} y={y + 4} textAnchor="start"
                  fill="rgba(251, 113, 133, 0.5)" fontSize="9" fontFamily="system-ui">
                  {sev}
                </text>
              );
            })}

            {/* X-axis labels */}
            {xLabels.map((lbl, i) => (
              <text key={i} x={lbl.x} y={H - 4} textAnchor="middle"
                fill="#6b7280" fontSize="9" fontFamily="system-ui">
                {lbl.label}
              </text>
            ))}

            {/* Symptom overlay line */}
            {symptomPoints && (
              <path d={buildPath(symptomPoints)}
                fill="none"
                stroke="rgba(251, 113, 133, 0.4)"
                strokeWidth="1.5"
                strokeDasharray="6 3"
              />
            )}

            {/* Comparison lines */}
            {comparePoints.map((pts, i) => (
              <path key={`cmp-${i}`} d={buildPath(pts)}
                fill="none"
                stroke={i === 0 ? COLORS.compare1 : COLORS.compare2}
                strokeWidth="1.5"
                strokeDasharray="4 2"
              />
            ))}

            {/* Primary line */}
            <path d={buildPath(primaryPoints)}
              fill="none"
              stroke={COLORS.primary}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />

            {/* Data dots */}
            {showDots && primaryPoints.map((pt, i) => (
              pt.y !== null && (
                <circle key={`pd-${i}`} cx={pt.x} cy={pt.y} r="2.5"
                  fill={COLORS.primary} />
              )
            ))}
            {showDots && comparePoints.map((pts, ci) =>
              pts.map((pt, i) => (
                pt.y !== null && (
                  <circle key={`cd-${ci}-${i}`} cx={pt.x} cy={pt.y} r="2"
                    fill={ci === 0 ? COLORS.compare1 : COLORS.compare2} />
                )
              ))
            )}

            {/* Crosshair */}
            {crosshairData && (
              <line x1={crosshairData.x} y1={padTop} x2={crosshairData.x} y2={padTop + chartH}
                stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
            )}
          </svg>

          {/* Crosshair tooltip */}
          {crosshairData && (
            <div style={{
              padding: '8px 12px',
              background: 'rgba(23, 23, 30, 0.95)',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              marginTop: '8px',
            }}>
              <div style={{ color: '#9ca3af', fontSize: '12px', marginBottom: '4px' }}>
                {crosshairData.dateLabel}
              </div>
              {crosshairData.items.map((item, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  color: '#e5e7eb',
                }}>
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: item.color, display: 'inline-block', flexShrink: 0,
                  }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name}
                  </span>
                  <span style={{ fontWeight: '600' }}>
                    {item.val !== null && item.val !== undefined ? `${item.val.toFixed(1)}${item.unit}` : '--'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Legend (when comparing or overlay) */}
        {(compareIds.length > 0 || overlaySymptomId) && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#e5e7eb' }}>
              <span style={{ width: '12px', height: '3px', background: COLORS.primary, borderRadius: '2px', display: 'inline-block' }} />
              {primaryItem?.name}
            </div>
            {compareIds.map((id, i) => {
              const item = stackItems.find(s => s.id === id);
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#e5e7eb' }}>
                  <span style={{
                    width: '12px', height: '3px', borderRadius: '2px', display: 'inline-block',
                    background: i === 0 ? COLORS.compare1 : COLORS.compare2,
                  }} />
                  {item?.name}
                </div>
              );
            })}
            {overlaySymptomId && (() => {
              const sym = symptoms.find(s => s.id === overlaySymptomId);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#e5e7eb' }}>
                  <span style={{
                    width: '12px', height: '3px', borderRadius: '2px', display: 'inline-block',
                    background: 'rgba(251, 113, 133, 0.8)',
                    borderTop: '1px dashed rgba(251, 113, 133, 0.8)',
                  }} />
                  {sym?.name} (severity)
                </div>
              );
            })()}
          </div>
        )}

        {/* Compare supplements button */}
        <button
          onClick={() => { setShowPicker(!showPicker); setShowSymptomPicker(false); haptic('light'); }}
          style={{
            width: '100%',
            padding: '12px',
            background: showPicker ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${showPicker ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: '10px',
            color: showPicker ? '#a78bfa' : '#9ca3af',
            fontSize: '14px',
            fontWeight: '500',
            cursor: 'pointer',
            marginBottom: '12px',
          }}
        >
          {showPicker ? 'Hide comparison' : `Compare supplements${compareIds.length > 0 ? ` (${compareIds.length})` : ''}`}
        </button>

        {/* Comparison picker */}
        {showPicker && (
          <div style={{
            background: 'rgba(15, 17, 21, 0.6)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            maxHeight: '200px',
            overflowY: 'auto',
            marginBottom: '12px',
          }}>
            {stackItems
              .filter(i => i.active && i.id !== primaryItemId)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(item => {
                const isSelected = compareIds.includes(item.id);
                const colorIdx = compareIds.indexOf(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleCompare(item.id)}
                    disabled={!isSelected && compareIds.length >= 2}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: isSelected ? 'rgba(139, 92, 246, 0.08)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      color: !isSelected && compareIds.length >= 2 ? '#4b5563' : '#e5e7eb',
                      fontSize: '14px',
                      cursor: !isSelected && compareIds.length >= 2 ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: '18px', height: '18px', borderRadius: '4px',
                      border: isSelected
                        ? `2px solid ${colorIdx === 0 ? COLORS.compare1 : COLORS.compare2}`
                        : '2px solid rgba(255,255,255,0.15)',
                      background: isSelected
                        ? (colorIdx === 0 ? COLORS.compare1 : COLORS.compare2)
                        : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, fontSize: '11px', color: '#000',
                    }}>
                      {isSelected && '\u2713'}
                    </span>
                    {item.name}
                  </button>
                );
              })}
          </div>
        )}

        {/* Overlay symptom button */}
        <button
          onClick={() => { setShowSymptomPicker(!showSymptomPicker); setShowPicker(false); haptic('light'); }}
          style={{
            width: '100%',
            padding: '12px',
            background: showSymptomPicker ? 'rgba(251, 113, 133, 0.1)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${showSymptomPicker ? 'rgba(251, 113, 133, 0.3)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: '10px',
            color: showSymptomPicker ? '#fb7185' : '#9ca3af',
            fontSize: '14px',
            fontWeight: '500',
            cursor: 'pointer',
            marginBottom: '12px',
          }}
        >
          {showSymptomPicker ? 'Hide symptom overlay' : `Overlay symptom${overlaySymptomId ? ' (1)' : ''}`}
        </button>

        {/* Symptom overlay picker */}
        {showSymptomPicker && (
          <div style={{
            background: 'rgba(15, 17, 21, 0.6)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            maxHeight: '200px',
            overflowY: 'auto',
            marginBottom: '20px',
          }}>
            {symptoms
              .filter(s => s.active)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(sym => {
                const isSelected = overlaySymptomId === sym.id;
                return (
                  <button
                    key={sym.id}
                    onClick={() => {
                      setOverlaySymptomId(prev => prev === sym.id ? null : sym.id);
                    }}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: isSelected ? 'rgba(251, 113, 133, 0.08)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      color: '#e5e7eb',
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: '18px', height: '18px', borderRadius: '4px',
                      border: isSelected
                        ? '2px solid rgba(251, 113, 133, 0.8)'
                        : '2px solid rgba(255,255,255,0.15)',
                      background: isSelected ? 'rgba(251, 113, 133, 0.8)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, fontSize: '11px', color: '#000',
                    }}>
                      {isSelected && '\u2713'}
                    </span>
                    {sym.name}
                  </button>
                );
              })}
          </div>
        )}

        {/* Summary stats */}
        <div style={{
          background: 'rgba(15, 17, 21, 0.6)',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.06)',
          padding: '16px',
          marginBottom: '20px',
        }}>
          <div style={{
            fontSize: '12px',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            color: '#6b7280',
            marginBottom: '12px',
          }}>
            {TIMEFRAMES.find(t => t.days === timeframe)?.label} Summary
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <div style={{ color: '#9ca3af', fontSize: '12px' }}>Adherence</div>
              <div style={{ color: '#e5e7eb', fontSize: '18px', fontWeight: '600' }}>{stats.adherenceRate}%</div>
              <div style={{ color: '#6b7280', fontSize: '11px' }}>{stats.taken}/{stats.scheduled} days</div>
            </div>
            <div>
              <div style={{ color: '#9ca3af', fontSize: '12px' }}>Avg Dose</div>
              <div style={{ color: '#e5e7eb', fontSize: '18px', fontWeight: '600' }}>{stats.avgDose}</div>
              <div style={{ color: '#6b7280', fontSize: '11px' }}>{stats.doseUnit}</div>
            </div>
            <div>
              <div style={{ color: '#34d399', fontSize: '12px' }}>Current streak</div>
              <div style={{ color: '#e5e7eb', fontSize: '14px' }}>
                {stats.currentStreak.days} day{stats.currentStreak.days !== 1 ? 's' : ''} {stats.currentStreak.type}
              </div>
            </div>
            <div>
              <div style={{ color: '#f59e0b', fontSize: '12px' }}>Longest streak</div>
              <div style={{ color: '#e5e7eb', fontSize: '14px' }}>{stats.longestStreak} days</div>
            </div>
          </div>
        </div>

        <p style={{
          color: '#4b5563',
          fontSize: '11px',
          margin: '8px 0 0',
          textAlign: 'center',
          lineHeight: '1.4',
        }}>
          {viewMode === 'adherence'
            ? 'Shows rolling 7-day adherence rate. Schedule-aware.'
            : 'Shows actual dose taken per day.'}
        </p>
      </div>
    </div>
  );
}
