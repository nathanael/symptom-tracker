import { useState, useMemo, useRef, useCallback } from 'react';
import { haptic } from '../utils/helpers';

const TIMEFRAMES = [
  { label: '1W', days: 7 },
  { label: '2W', days: 14 },
  { label: '4W', days: 28 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
];

const COLORS = {
  primary: '#8b5cf6',
  compare1: '#f59e0b',
  compare2: '#06b6d4',
};

const SMOOTH_WINDOWS = { 7: 2, 14: 3, 28: 5, 90: 7, 180: 10 };

function getDailyValue(entries, dateKey, symptomId, trackingMode) {
  if (trackingMode === 'ampm') {
    const am = entries[`${dateKey}-${symptomId}-morning`];
    const pm = entries[`${dateKey}-${symptomId}-evening`];
    const vals = [];
    if (am && am.severity !== -1) vals.push(am.severity);
    if (pm && pm.severity !== -1) vals.push(pm.severity);
    if (vals.length === 0) {
      // Check for daily entry (legacy/mode switch)
      const daily = entries[`${dateKey}-${symptomId}-daily`];
      if (daily && daily.severity !== -1) return daily.severity;
      return null;
    }
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  } else {
    const daily = entries[`${dateKey}-${symptomId}-daily`];
    if (daily && daily.severity !== -1) return daily.severity;
    // Check for ampm entries (legacy/mode switch)
    const am = entries[`${dateKey}-${symptomId}-morning`];
    const pm = entries[`${dateKey}-${symptomId}-evening`];
    const vals = [];
    if (am && am.severity !== -1) vals.push(am.severity);
    if (pm && pm.severity !== -1) vals.push(pm.severity);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
}

function generateDateRange(days) {
  const dates = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

function smooth(values, windowSize) {
  return values.map((val, i) => {
    if (val === null) return null;
    const half = Math.floor(windowSize / 2);
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    let sum = 0, count = 0;
    for (let j = start; j < end; j++) {
      if (values[j] !== null) { sum += values[j]; count++; }
    }
    return count > 0 ? sum / count : null;
  });
}

function formatXLabel(dateStr, timeframe) {
  const d = new Date(dateStr + 'T12:00:00');
  if (timeframe <= 14) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else if (timeframe <= 28) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return d.toLocaleDateString('en-US', { month: 'short' });
  }
}

function getXLabelInterval(timeframe) {
  if (timeframe <= 7) return 1;
  if (timeframe <= 14) return 2;
  if (timeframe <= 28) return 7;
  if (timeframe <= 90) return 14;
  return 30;
}

// Build SVG path that breaks on null gaps
function buildPath(points) {
  let d = '';
  let drawing = false;
  for (const pt of points) {
    if (pt.y === null) { drawing = false; continue; }
    if (!drawing) { d += `M${pt.x},${pt.y}`; drawing = true; }
    else { d += `L${pt.x},${pt.y}`; }
  }
  return d;
}

export default function SymptomGraph({
  primarySymptomId,
  symptoms,
  entries,
  trackingMode,
  onClose,
}) {
  const [timeframe, setTimeframe] = useState(28);
  const [compareIds, setCompareIds] = useState([]);
  const [touchX, setTouchX] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const svgRef = useRef(null);

  const primarySymptom = symptoms.find(s => s.id === primarySymptomId);

  // Chart dimensions
  const W = 340, H = 200;
  const padLeft = 28, padRight = 10, padTop = 10, padBottom = 28;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const dates = useMemo(() => generateDateRange(timeframe), [timeframe]);

  // Build data series for a symptom
  const buildSeries = useCallback((symptomId) => {
    const raw = dates.map(d => getDailyValue(entries, d, symptomId, trackingMode));
    const windowSize = SMOOTH_WINDOWS[timeframe] || 5;
    return smooth(raw, windowSize);
  }, [dates, entries, trackingMode, timeframe]);

  const primaryData = useMemo(() => buildSeries(primarySymptomId), [buildSeries, primarySymptomId]);
  const compareDatas = useMemo(() => compareIds.map(id => buildSeries(id)), [buildSeries, compareIds]);

  // Convert data to SVG points
  const toPoints = useCallback((data) => {
    return data.map((val, i) => ({
      x: padLeft + (i / (dates.length - 1)) * chartW,
      y: val === null ? null : padTop + chartH - (val / 5) * chartH,
      val,
    }));
  }, [dates.length, chartW, chartH]);

  const primaryPoints = useMemo(() => toPoints(primaryData), [toPoints, primaryData]);
  const comparePoints = useMemo(() => compareDatas.map(d => toPoints(d)), [toPoints, compareDatas]);

  // X-axis labels
  const interval = getXLabelInterval(timeframe);
  const xLabels = useMemo(() => {
    const labels = [];
    for (let i = 0; i < dates.length; i += interval) {
      labels.push({
        x: padLeft + (i / (dates.length - 1)) * chartW,
        label: formatXLabel(dates[i], timeframe),
      });
    }
    return labels;
  }, [dates, interval, chartW, timeframe]);

  // Touch crosshair logic
  const getSnappedIndex = useCallback((clientX) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = clientX - rect.left;
    const svgX = (relX / rect.width) * W;
    const dataX = svgX - padLeft;
    const idx = Math.round((dataX / chartW) * (dates.length - 1));
    return Math.max(0, Math.min(dates.length - 1, idx));
  }, [chartW, dates.length]);

  const handleTouchStart = (e) => {
    e.preventDefault();
    const idx = getSnappedIndex(e.touches[0].clientX);
    setTouchX(idx);
  };
  const handleTouchMove = (e) => {
    e.preventDefault();
    const idx = getSnappedIndex(e.touches[0].clientX);
    setTouchX(idx);
  };
  const handleTouchEnd = () => setTouchX(null);
  const handleMouseMove = (e) => {
    const idx = getSnappedIndex(e.clientX);
    setTouchX(idx);
  };
  const handleMouseLeave = () => setTouchX(null);

  // Crosshair tooltip data
  const crosshairData = useMemo(() => {
    if (touchX === null) return null;
    const date = dates[touchX];
    const d = new Date(date + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const items = [
      { name: primarySymptom?.name, color: COLORS.primary, val: primaryData[touchX] },
    ];
    compareIds.forEach((id, i) => {
      const sym = symptoms.find(s => s.id === id);
      items.push({
        name: sym?.name,
        color: i === 0 ? COLORS.compare1 : COLORS.compare2,
        val: compareDatas[i]?.[touchX],
      });
    });
    return { dateLabel, items, x: padLeft + (touchX / (dates.length - 1)) * chartW };
  }, [touchX, dates, primarySymptom, primaryData, compareIds, compareDatas, symptoms, chartW]);

  // Summary stats
  const stats = useMemo(() => {
    let sum = 0, count = 0, best = null, worst = null;
    primaryData.forEach((val, i) => {
      if (val === null) return;
      // Use raw (unsmoothed) for stats
      const raw = getDailyValue(entries, dates[i], primarySymptomId, trackingMode);
      if (raw === null) return;
      sum += raw;
      count++;
      if (best === null || raw < best.val) best = { val: raw, date: dates[i] };
      if (worst === null || raw > worst.val) worst = { val: raw, date: dates[i] };
    });
    const formatDate = (d) => {
      if (!d) return '';
      const dt = new Date(d + 'T12:00:00');
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    return {
      avg: count > 0 ? (sum / count).toFixed(1) : '--',
      best: best ? `${best.val.toFixed(1)} (${formatDate(best.date)})` : '--',
      worst: worst ? `${worst.val.toFixed(1)} (${formatDate(worst.date)})` : '--',
      coverage: `${count} / ${dates.length}`,
    };
  }, [primaryData, entries, dates, primarySymptomId, trackingMode]);

  const showDots = timeframe <= 28;

  // Comparison toggle
  const toggleCompare = (id) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#08090A',
      zIndex: 100,
      overflowY: 'auto',
      padding: '20px 20px 120px 20px',
      paddingTop: 'calc(20px + env(safe-area-inset-top))',
    }}>
      <div style={{ maxWidth: '500px', margin: '0 auto' }}>
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

        {/* Title */}
        <h2 style={{
          color: '#f8fafc',
          fontSize: '22px',
          fontWeight: '600',
          margin: '0 0 20px 0',
        }}>
          {primarySymptom?.name || 'Symptom'}
        </h2>

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
            {[0, 1, 2, 3, 4, 5].map(sev => {
              const y = padTop + chartH - (sev / 5) * chartH;
              return (
                <line key={sev} x1={padLeft} y1={y} x2={W - padRight} y2={y}
                  stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              );
            })}

            {/* Y-axis labels */}
            {[0, 1, 2, 3, 4, 5].map(sev => {
              const y = padTop + chartH - (sev / 5) * chartH;
              return (
                <text key={sev} x={padLeft - 6} y={y + 4} textAnchor="end"
                  fill="#6b7280" fontSize="10" fontFamily="system-ui">
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

            {/* Data dots for short timeframes */}
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

          {/* Crosshair tooltip (rendered outside SVG for better text rendering) */}
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
                    {item.val !== null && item.val !== undefined ? item.val.toFixed(1) : '--'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Legend (when comparing) */}
        {compareIds.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            marginBottom: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#e5e7eb' }}>
              <span style={{ width: '12px', height: '3px', background: COLORS.primary, borderRadius: '2px', display: 'inline-block' }} />
              {primarySymptom?.name}
            </div>
            {compareIds.map((id, i) => {
              const sym = symptoms.find(s => s.id === id);
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#e5e7eb' }}>
                  <span style={{
                    width: '12px', height: '3px', borderRadius: '2px', display: 'inline-block',
                    background: i === 0 ? COLORS.compare1 : COLORS.compare2,
                  }} />
                  {sym?.name}
                </div>
              );
            })}
          </div>
        )}

        {/* Compare button */}
        <button
          onClick={() => { setShowPicker(!showPicker); haptic('light'); }}
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
          {showPicker ? 'Hide comparison' : `Compare${compareIds.length > 0 ? ` (${compareIds.length})` : ''}`}
        </button>

        {/* Comparison picker */}
        {showPicker && (
          <div style={{
            background: 'rgba(15, 17, 21, 0.6)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            maxHeight: '240px',
            overflowY: 'auto',
            marginBottom: '20px',
          }}>
            {symptoms
              .filter(s => s.active && s.id !== primarySymptomId)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(sym => {
                const isSelected = compareIds.includes(sym.id);
                const colorIdx = compareIds.indexOf(sym.id);
                return (
                  <button
                    key={sym.id}
                    onClick={() => toggleCompare(sym.id)}
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
              <div style={{ color: '#9ca3af', fontSize: '12px' }}>Average</div>
              <div style={{ color: '#e5e7eb', fontSize: '18px', fontWeight: '600' }}>{stats.avg}</div>
            </div>
            <div>
              <div style={{ color: '#9ca3af', fontSize: '12px' }}>Coverage</div>
              <div style={{ color: '#e5e7eb', fontSize: '18px', fontWeight: '600' }}>{stats.coverage}</div>
            </div>
            <div>
              <div style={{ color: '#34d399', fontSize: '12px' }}>Best day</div>
              <div style={{ color: '#e5e7eb', fontSize: '14px' }}>{stats.best}</div>
            </div>
            <div>
              <div style={{ color: '#fb7185', fontSize: '12px' }}>Worst day</div>
              <div style={{ color: '#e5e7eb', fontSize: '14px' }}>{stats.worst}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
