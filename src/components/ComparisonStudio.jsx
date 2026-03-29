import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { haptic } from '../utils/helpers';
import {
  TIMEFRAMES, SMOOTH_WINDOWS,
  interpolateSmallGaps, smooth,
  formatXLabel, formatXLabelWeekly, getXLabelInterval, buildPath,
} from '../utils/chartHelpers';
import {
  getSymptomDailySeries,
  getSupplementDoseSeries,
} from '../utils/correlationHelpers';
import {
  aggregateDaily, aggregateWeekly, aggregateMonthly,
  computeCumulativeLevel, aggregateSymptoms,
} from '../utils/doseTransforms';
import { matchSupplementCategory } from '../utils/supplementLookup';

const SYMPTOM_STYLES = [
  { color: '#fb7185', chipBg: 'rgba(251,113,133,0.12)', chipBorder: 'rgba(251,113,133,0.35)' },
  { color: '#38bdf8', chipBg: 'rgba(56,189,248,0.12)', chipBorder: 'rgba(56,189,248,0.35)' },
  { color: '#f59e0b', chipBg: 'rgba(245,158,11,0.12)', chipBorder: 'rgba(245,158,11,0.35)' },
];

const SUPP_COLOR = '#8b5cf6';

export default function ComparisonStudio({
  entries,
  symptoms,
  stackItems,
  stackEntries,
  trackingMode,
  isDesktop,
  setStackItems,
}) {
  const STORAGE_KEY = 'comparisonStudioSelections';

  const allSupplements = useMemo(
    () => (stackItems || []).sort((a, b) => a.name.localeCompare(b.name)),
    [stackItems]
  );
  const activeSymptoms = useMemo(
    () => (symptoms || []).filter(s => s.active).sort((a, b) => a.name.localeCompare(b.name)),
    [symptoms]
  );

  const initialSelections = useMemo(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        const suppValid = saved.supplement && (stackItems || []).some(i => i.id === saved.supplement);
        const validSymptoms = (saved.symptoms || []).filter(
          id => (symptoms || []).some(s => s.id === id && s.active)
        );
        return {
          supplement: suppValid ? saved.supplement : '',
          symptoms: validSymptoms,
          viewMode: saved.viewMode && ['daily', 'weekly', 'monthly', 'cumulative'].includes(saved.viewMode) ? saved.viewMode : 'daily',
        };
      }
    } catch {}
    return { supplement: '', symptoms: [], viewMode: 'daily' };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only

  const [selectedSupplement, setSelectedSupplement] = useState(initialSelections.supplement);
  const [selectedSymptoms, setSelectedSymptoms] = useState(initialSelections.symptoms);
  const [showSupplementPicker, setShowSupplementPicker] = useState(false);
  const [showSymptomPicker, setShowSymptomPicker] = useState(false);
  const [suppSearch, setSuppSearch] = useState('');
  const [symSearch, setSymSearch] = useState('');
  const suppSearchRef = useRef(null);
  const symSearchRef = useRef(null);
  const [timeframe, setTimeframe] = useState(60);
  const [startOffset, setStartOffset] = useState(0);
  const [touchX, setTouchX] = useState(null);
  const svgRef = useRef(null);
  const [viewMode, setViewMode] = useState(initialSelections.viewMode);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);


  // Auto-focus search inputs when pickers open
  useEffect(() => { if (showSupplementPicker) { setSuppSearch(''); setTimeout(() => suppSearchRef.current?.focus(), 50); } }, [showSupplementPicker]);
  useEffect(() => { if (showSymptomPicker) { setSymSearch(''); setTimeout(() => symSearchRef.current?.focus(), 50); } }, [showSymptomPicker]);

  // Persist selections to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        supplement: selectedSupplement,
        symptoms: selectedSymptoms,
        viewMode,
      }));
    } catch {}
  }, [selectedSupplement, selectedSymptoms, viewMode]);

  // Close category picker when view/supplement changes
  useEffect(() => { setShowCategoryPicker(false); }, [viewMode, selectedSupplement]);

  // Symptom selection
  const toggleSymptom = (symId) => {
    setSelectedSymptoms(prev => {
      if (prev.includes(symId)) return prev.filter(id => id !== symId);
      if (prev.length >= 3) return prev;
      return [...prev, symId];
    });
    haptic('light');
  };
  const removeSymptom = (symId) => {
    setSelectedSymptoms(prev => prev.filter(id => id !== symId));
    haptic('light');
  };

  // Reset startOffset when timeframe changes
  useEffect(() => { setStartOffset(0); }, [timeframe]);

  const dates = useMemo(() => {
    const result = [];
    const end = new Date();
    end.setDate(end.getDate() - startOffset);
    for (let i = timeframe - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      result.push(`${y}-${m}-${day}`);
    }
    return result;
  }, [timeframe, startOffset]);

  const suppItem = useMemo(
    () => stackItems.find(i => i.id === selectedSupplement),
    [stackItems, selectedSupplement]
  );
  const suppUnit = suppItem?.unit || 'mg';

  // SVG dimensions
  const W = 500, H = 280;
  const padLeft = 36, padRight = 20, padTop = 14, padBottom = 22;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // ── Data pipeline ──

  const windowSize = SMOOTH_WINDOWS[timeframe] || 5;

  // Supplement: raw dose series with outlier capping
  const suppDoseDaily = useMemo(() => {
    if (!selectedSupplement) return null;
    const raw = getSupplementDoseSeries(stackEntries, stackItems, selectedSupplement, dates);
    const valid = raw.filter(v => v !== null && v > 0).sort((a, b) => a - b);
    let capped = raw;
    if (valid.length > 2) {
      const p95 = valid[Math.floor(valid.length * 0.95)];
      const cap = p95 * 3;
      capped = raw.map(v => (v !== null && v > cap) ? cap : v);
    }
    // For cumulative view, keep nulls (computeCumulativeLevel handles them internally)
    if (viewMode === 'cumulative') return capped;
    return capped.map(v => v === null ? 0 : v);
  }, [selectedSupplement, stackEntries, stackItems, dates, viewMode]);

  // Transform helper
  const transformDose = useCallback((series, dts) => {
    switch (viewMode) {
      case 'weekly': return aggregateWeekly(series, dts, 'average');
      case 'monthly': return aggregateMonthly(series, dts, 'average');
      case 'cumulative': {
        const item = (stackItems || []).find(i => i.id === selectedSupplement);
        const category = item?.halfLifeCategory || null;
        return computeCumulativeLevel(series, dts, category);
      }
      default: return aggregateDaily(series, dts);
    }
  }, [viewMode, stackItems, selectedSupplement]);

  // Transformed supplement data
  const suppTransformed = useMemo(() => {
    if (!suppDoseDaily) return null;
    return transformDose(suppDoseDaily, dates);
  }, [suppDoseDaily, dates, transformDose]);

  // Y-axis range (from transformed data)
  const suppYMax = useMemo(() => {
    if (!suppTransformed) return 100;
    const max = Math.max(...suppTransformed.values.filter(v => v !== null && v !== undefined));
    if (!isFinite(max) || max <= 0) return suppItem?.defaultDose || 100;
    const ceiling = Math.ceil(max * 1.1);
    return viewMode === 'cumulative' ? ceiling : Math.max(ceiling, suppItem?.defaultDose || 100);
  }, [suppTransformed, suppItem, viewMode]);

  // Nice-number Y-axis labels
  const suppYLabels = useMemo(() => {
    const range = suppYMax;
    const roughStep = range / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
    const residual = roughStep / mag;
    const niceStep = residual <= 1.5 ? mag : residual <= 3 ? 2 * mag : residual <= 7 ? 5 * mag : 10 * mag;
    const labels = [];
    for (let v = 0; v <= suppYMax; v += niceStep) labels.push(Math.round(v));
    return labels;
  }, [suppYMax]);

  // Symptom data with transforms
  const symptomTransformed = useMemo(() =>
    selectedSymptoms.map(symId => {
      const filled = interpolateSmallGaps(getSymptomDailySeries(entries, symId, dates, trackingMode));
      const smoothed = smooth(filled, windowSize);
      const transformed = aggregateSymptoms(smoothed, dates, viewMode);
      return { raw: filled, smoothed, transformed };
    }),
    [selectedSymptoms, entries, dates, trackingMode, windowSize, viewMode]
  );

  // ── Chart points ──

  const suppPoints = useMemo(() => {
    if (!suppTransformed) return null;
    const { values, dates: txDates } = suppTransformed;
    const maxIdx = Math.max(1, txDates.length - 1);
    return values.map((val, i) => {
      const dateIdx = dates.indexOf(txDates[i]);
      const x = dateIdx >= 0
        ? padLeft + (dateIdx / Math.max(1, dates.length - 1)) * chartW
        : padLeft + (i / maxIdx) * chartW;
      return {
        x,
        y: val === null ? null : padTop + chartH - (val / suppYMax) * chartH,
        val,
      };
    });
  }, [suppTransformed, dates, chartW, chartH, suppYMax]);

  const symptomPointSets = useMemo(() =>
    symptomTransformed.map(sd => {
      const { values, dates: txDates } = sd.transformed;
      const maxIdx = Math.max(1, txDates.length - 1);
      return values.map((val, i) => {
        const dateIdx = dates.indexOf(txDates[i]);
        const x = dateIdx >= 0
          ? padLeft + (dateIdx / Math.max(1, dates.length - 1)) * chartW
          : padLeft + (i / maxIdx) * chartW;
        return {
          x,
          y: val === null ? null : padTop + chartH - (val / 5) * chartH,
          val,
        };
      });
    }),
    [symptomTransformed, dates, chartW, chartH]
  );

  const interval = getXLabelInterval(timeframe);
  const xLabels = useMemo(() => {
    if (viewMode === 'weekly' || viewMode === 'monthly') {
      if (!suppTransformed) return [];
      return suppTransformed.dates.map((dateStr, i) => {
        const dateIdx = dates.indexOf(dateStr);
        const x = dateIdx >= 0
          ? padLeft + (dateIdx / Math.max(1, dates.length - 1)) * chartW
          : padLeft + (i / Math.max(1, suppTransformed.dates.length - 1)) * chartW;
        const label = viewMode === 'weekly'
          ? formatXLabelWeekly(suppTransformed.labels[i])
          : suppTransformed.labels[i];
        return { x, label };
      });
    }
    const labels = [];
    for (let i = 0; i < dates.length; i += interval) {
      labels.push({
        x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
        label: formatXLabel(dates[i], timeframe),
      });
    }
    return labels;
  }, [viewMode, suppTransformed, dates, interval, chartW, timeframe]);

  // Touch/mouse — adapted for aggregated views
  const getSnappedIndex = useCallback((clientX) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const xPx = (clientX - rect.left) / rect.width * W;

    if ((viewMode === 'weekly' || viewMode === 'monthly') && suppPoints) {
      let minDist = Infinity, bestIdx = 0;
      for (let i = 0; i < suppPoints.length; i++) {
        const dist = Math.abs(suppPoints[i].x - xPx);
        if (dist < minDist) { minDist = dist; bestIdx = i; }
      }
      return bestIdx;
    }
    const idx = Math.round((xPx - padLeft) / chartW * (dates.length - 1));
    return Math.max(0, Math.min(dates.length - 1, idx));
  }, [chartW, dates.length, viewMode, suppPoints]);

  // Desktop: simple crosshair on hover
  const handleMouseMove = (e) => setTouchX(getSnappedIndex(e.clientX));
  const handleMouseLeave = () => setTouchX(null);



  const crosshairData = useMemo(() => {
    if (touchX === null) return null;

    let dateLabel, suppVal, suppX, symptomVals;

    if (viewMode === 'weekly' || viewMode === 'monthly') {
      const txLabel = suppTransformed?.labels?.[touchX];
      dateLabel = viewMode === 'weekly'
        ? formatXLabelWeekly(txLabel)
        : txLabel;
      suppVal = suppPoints?.[touchX]?.val;
      suppX = suppPoints?.[touchX]?.x;
      symptomVals = selectedSymptoms.map((_, idx) => {
        const symTx = symptomTransformed[idx]?.transformed;
        return symTx?.values?.[touchX] ?? null;
      });
    } else {
      const d = new Date(dates[touchX] + 'T12:00:00');
      dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      suppVal = suppPoints?.[touchX]?.val;
      suppX = padLeft + (touchX / Math.max(1, dates.length - 1)) * chartW;
      symptomVals = selectedSymptoms.map((_, idx) => {
        const pts = symptomPointSets[idx];
        return pts?.[touchX]?.val ?? null;
      });
    }

    const items = [];
    if (suppPoints) {
      items.push({ name: suppItem?.name, color: SUPP_COLOR, val: suppVal, unit: suppUnit });
    }
    selectedSymptoms.forEach((symId, idx) => {
      items.push({
        name: symptoms.find(s => s.id === symId)?.name,
        color: SYMPTOM_STYLES[idx].color,
        val: symptomVals[idx],
        unit: '/5',
      });
    });
    return { dateLabel, items, x: suppX };
  }, [touchX, viewMode, dates, suppPoints, suppTransformed, symptomTransformed,
    symptomPointSets, suppItem, suppUnit, symptoms, selectedSymptoms, chartW]);

  // Legend: show crosshair values when hovering, averages otherwise
  const legendItems = useMemo(() => {
    if (crosshairData) return crosshairData;
    const avg = (arr) => {
      const valid = arr.filter(v => v !== null);
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };
    const items = [];
    if (suppTransformed) {
      const vals = suppTransformed.values.filter(v => v !== null && v > 0);
      const suppAvg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      items.push({ name: suppItem?.name, color: SUPP_COLOR, val: suppAvg, unit: suppUnit });
    }
    selectedSymptoms.forEach((symId, idx) => {
      const sd = symptomTransformed[idx];
      if (sd) {
        items.push({
          name: symptoms.find(s => s.id === symId)?.name,
          color: SYMPTOM_STYLES[idx].color,
          val: avg(sd.smoothed),
          unit: '/5',
        });
      }
    });
    return { dateLabel: 'Average', items, x: null };
  }, [crosshairData, suppTransformed, symptomTransformed, suppItem, suppUnit, symptoms, selectedSymptoms]);

  // Max offset: based on earliest data point across selected symptoms/supplement
  const maxOffset = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    let earliest = null;

    for (const symId of selectedSymptoms) {
      for (const key of Object.keys(entries || {})) {
        if (key.includes(`-${symId}-`)) {
          const e = entries[key];
          if (e?.date && (!earliest || e.date < earliest)) earliest = e.date;
        }
      }
    }

    if (selectedSupplement) {
      for (const key of Object.keys(stackEntries || {})) {
        if (key.endsWith(`-${selectedSupplement}`)) {
          const e = stackEntries[key];
          if (e?.taken) {
            const dateStr = key.slice(0, 10);
            if (!earliest || dateStr < earliest) earliest = dateStr;
          }
        }
      }
    }

    if (!earliest) return 0;
    const earliestDate = new Date(earliest + 'T12:00:00');
    const totalDays = Math.round((today - earliestDate) / (1000 * 60 * 60 * 24));
    return Math.max(0, totalDays - timeframe);
  }, [selectedSymptoms, selectedSupplement, entries, stackEntries, timeframe]);

  // Clamp startOffset when maxOffset shrinks
  useEffect(() => { setStartOffset(prev => Math.min(prev, maxOffset)); }, [maxOffset]);

  // Date window label
  const dateWindowLabel = useMemo(() => {
    if (dates.length === 0) return '';
    const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(dates[0])} — ${fmt(dates[dates.length - 1])}`;
  }, [dates]);

  const showDots = timeframe <= 28 && (viewMode === 'daily' || viewMode === 'cumulative');

  // ── View mode selector (shared between desktop/mobile) ──
  // Resolve current decay category for cumulative view
  const cumulativeCategory = (() => {
    if (!selectedSupplement) return 'moderate';
    const item = (stackItems || []).find(i => i.id === selectedSupplement);
    return item?.halfLifeCategory || matchSupplementCategory(item?.name) || 'moderate';
  })();

  const viewModeSelector = (mobile) => (
    <div style={{
      display: 'flex', gap: '0',
      borderRadius: '7px',
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'rgba(255,255,255,0.04)',
      padding: '2px',
      marginBottom: mobile ? '6px' : '8px',
      position: 'relative',
    }}>
      {['daily', 'weekly', 'monthly', 'cumulative'].map(mode => (
        <button key={mode}
          onClick={() => { setViewMode(mode); haptic('light'); }}
          style={{
            padding: mobile ? '5px 0' : '3px 0',
            flex: 1,
            borderRadius: '5px', border: 'none',
            background: viewMode === mode ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: viewMode === mode ? '#fff' : '#6b7280',
            fontSize: mobile ? '11px' : '10px', fontWeight: '500', cursor: 'pointer',
            textTransform: 'capitalize',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
          }}
        >
          {mode}
          {mode === 'cumulative' && viewMode === 'cumulative' && selectedSupplement && (
            <span
              onClick={(e) => { e.stopPropagation(); setShowCategoryPicker(prev => !prev); }}
              style={{
                fontSize: mobile ? '8px' : '7px',
                padding: '1px 4px',
                borderRadius: '6px',
                background: 'rgba(139,92,246,0.25)',
                color: '#a78bfa',
                cursor: 'pointer',
                lineHeight: '1.3',
                textTransform: 'lowercase',
              }}
            >
              {cumulativeCategory === 'moderate' ? 'mod' : cumulativeCategory}
            </span>
          )}
        </button>
      ))}
      {showCategoryPicker && viewMode === 'cumulative' && (
        <div style={{
          position: 'absolute', top: '100%', right: '0',
          marginTop: '4px', zIndex: 10,
          background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '8px', padding: '4px', minWidth: '120px',
        }}>
          {['fast', 'moderate', 'slow'].map(cat => (
            <button key={cat}
              onClick={() => {
                if (setStackItems) {
                  setStackItems(prev => prev.map(i =>
                    i.id === selectedSupplement ? { ...i, halfLifeCategory: cat } : i
                  ));
                }
                setShowCategoryPicker(false);
                haptic('light');
              }}
              style={{
                display: 'block', width: '100%', padding: '6px 10px',
                border: 'none', borderRadius: '4px',
                background: cat === cumulativeCategory ? 'rgba(139,92,246,0.2)' : 'transparent',
                color: '#e2e8f0', fontSize: '12px', cursor: 'pointer',
                textAlign: 'left', textTransform: 'capitalize',
              }}
            >
              {cat}
              <span style={{ color: '#6b7280', fontSize: '10px', marginLeft: '6px' }}>
                {cat === 'fast' ? '~12h' : cat === 'moderate' ? '~3d' : '~21d'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );


  // Area fill path for cumulative view
  const areaFillPath = useMemo(() => {
    if (viewMode !== 'cumulative' || !suppPoints) return '';
    const validPoints = suppPoints.filter(pt => pt.y !== null);
    if (validPoints.length === 0) return '';
    let d = `M${validPoints[0].x},${padTop + chartH}`;
    d += `L${validPoints[0].x},${validPoints[0].y}`;
    for (let i = 1; i < validPoints.length; i++) {
      d += `L${validPoints[i].x},${validPoints[i].y}`;
    }
    d += `L${validPoints[validPoints.length - 1].x},${padTop + chartH}Z`;
    return d;
  }, [viewMode, suppPoints, chartH]);

  // ── Supplement picker panel ──
  const selectSupplement = (suppId) => {
    setSelectedSupplement(prev => prev === suppId ? '' : suppId);
    haptic('light');
  };

  const supplementPickerPanel = showSupplementPicker ? (
    <div
      onClick={() => setShowSupplementPicker(false)}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: isDesktop ? 'flex-start' : 'flex-end',
        justifyContent: 'center',
        padding: isDesktop ? '20px' : '0',
        paddingTop: isDesktop ? 'calc(60px + env(safe-area-inset-top))' : '0',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: isDesktop ? '820px' : 'none',
          background: 'rgba(15,17,21,0.95)',
          borderRadius: isDesktop ? '12px' : '16px 16px 0 0',
          border: '1px solid rgba(139,92,246,0.3)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          maxHeight: isDesktop ? 'calc(100vh - 120px)' : '65vh',
          display: 'flex', flexDirection: 'column',
          ...(isDesktop ? {} : { paddingBottom: 'env(safe-area-inset-bottom)' }),
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(100,116,139,0.2)',
          flexShrink: 0,
        }}>
          <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
            Select Supplement
          </h3>
          <button
            onClick={() => setShowSupplementPicker(false)}
            style={{
              background: 'none', border: 'none', color: '#8b5cf6',
              fontSize: '16px', fontWeight: '600', cursor: 'pointer', padding: '4px 8px',
            }}
          >
            Done
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '12px 16px' }}>
          <input
            ref={suppSearchRef}
            value={suppSearch}
            onChange={(e) => setSuppSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); if (suppSearch) setSuppSearch(''); else setShowSupplementPicker(false); }
              if (e.key === 'Enter') {
                const filtered = allSupplements.filter(s => s.name.toLowerCase().includes(suppSearch.toLowerCase()) || (s.description || '').toLowerCase().includes(suppSearch.toLowerCase()));
                if (filtered.length === 1) { selectSupplement(filtered[0].id); setShowSupplementPicker(false); }
              }
            }}
            placeholder="Search supplements..."
            style={{
              width: '100%', padding: '8px 12px', marginBottom: '10px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{
            display: 'grid',
            gridTemplateColumns: isDesktop ? 'repeat(3, 1fr)' : '1fr',
            gap: '8px',
          }}>
            {(() => {
              const filtered = allSupplements.filter(s => !suppSearch || s.name.toLowerCase().includes(suppSearch.toLowerCase()) || (s.description || '').toLowerCase().includes(suppSearch.toLowerCase()));
              const autoSelected = filtered.length === 1;
              return filtered.map(supp => {
              const isSelected = selectedSupplement === supp.id;
              const highlighted = isSelected || autoSelected;
              return (
                <button
                  key={supp.id}
                  onClick={() => { selectSupplement(supp.id); setShowSupplementPicker(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 12px', minWidth: 0,
                    borderRadius: '8px',
                    background: highlighted ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                    border: highlighted ? '1px solid rgba(139,92,246,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                    background: highlighted ? SUPP_COLOR : '#4b5563',
                  }} />
                  <span style={{
                    flex: 1, minWidth: 0,
                    display: 'flex', flexDirection: 'column',
                  }}>
                    <span style={{
                      color: highlighted ? '#e5e7eb' : '#9ca3af',
                      fontSize: '13px', fontWeight: highlighted ? '500' : '400',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {supp.name}
                    </span>
                    {supp.description && (
                      <span style={{
                        color: highlighted ? '#9ca3af' : '#6b7280',
                        fontSize: '11px', fontWeight: '400',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {supp.description}
                      </span>
                    )}
                  </span>
                  {highlighted && (
                    <span style={{ color: SUPP_COLOR, fontSize: '14px', flexShrink: 0 }}>✓</span>
                  )}
                </button>
              );
            });
            })()}
          </div>
        </div>
      </div>
    </div>
  ) : null;

  // ── Symptom picker panel ──
  const symptomPickerPanel = showSymptomPicker ? (
    <div
      onClick={() => setShowSymptomPicker(false)}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.92)',
        zIndex: 1000,
        display: 'flex',
        alignItems: isDesktop ? 'flex-start' : 'flex-end',
        justifyContent: 'center',
        padding: isDesktop ? '20px' : '0',
        paddingTop: isDesktop ? 'calc(60px + env(safe-area-inset-top))' : '0',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: isDesktop ? '820px' : 'none',
          background: 'rgba(15,17,21,0.95)',
          borderRadius: isDesktop ? '12px' : '16px 16px 0 0',
          border: '1px solid rgba(99,102,241,0.3)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          maxHeight: isDesktop ? 'calc(100vh - 120px)' : '65vh',
          display: 'flex', flexDirection: 'column',
          ...(isDesktop ? {} : { paddingBottom: 'env(safe-area-inset-bottom)' }),
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(100,116,139,0.2)',
          flexShrink: 0,
        }}>
          <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: 0 }}>
            Select Symptoms
          </h3>
          <button
            onClick={() => setShowSymptomPicker(false)}
            style={{
              background: 'none', border: 'none', color: '#8b5cf6',
              fontSize: '16px', fontWeight: '600', cursor: 'pointer', padding: '4px 8px',
            }}
          >
            Done
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '12px 16px' }}>
          <input
            ref={symSearchRef}
            value={symSearch}
            onChange={(e) => setSymSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); if (symSearch) setSymSearch(''); else setShowSymptomPicker(false); }
              if (e.key === 'Enter') {
                const filtered = activeSymptoms.filter(s => s.name.toLowerCase().includes(symSearch.toLowerCase()));
                if (filtered.length === 1) { toggleSymptom(filtered[0].id); setShowSymptomPicker(false); }
              }
            }}
            placeholder="Search symptoms..."
            style={{
              width: '100%', padding: '8px 12px', marginBottom: '10px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {selectedSymptoms.length >= 3 && (
            <div style={{
              padding: '0 0 10px', color: '#6b7280', fontSize: '12px', textAlign: 'center',
            }}>
              Max 3 symptoms selected
            </div>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isDesktop ? 'repeat(3, 1fr)' : '1fr',
            gap: '8px',
          }}>
          {(() => {
            const filtered = activeSymptoms.filter(s => !symSearch || s.name.toLowerCase().includes(symSearch.toLowerCase()));
            const autoSelected = filtered.length === 1;
            const autoColor = '#8b5cf6';
            return filtered.map(sym => {
            const isSelected = selectedSymptoms.includes(sym.id);
            const styleIdx = selectedSymptoms.indexOf(sym.id);
            const atMax = selectedSymptoms.length >= 3 && !isSelected;
            const highlighted = isSelected || autoSelected;
            const dotColor = isSelected ? SYMPTOM_STYLES[styleIdx].color : autoSelected ? autoColor : '#4b5563';
            const borderColor = isSelected ? SYMPTOM_STYLES[styleIdx].chipBorder : autoSelected ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.06)';
            return (
              <button
                key={sym.id}
                onClick={() => toggleSymptom(sym.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 12px', minWidth: 0,
                  borderRadius: '8px',
                  background: highlighted ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${borderColor}`,
                  cursor: atMax ? 'default' : 'pointer',
                  opacity: atMax ? 0.35 : 1,
                  textAlign: 'left',
                }}
              >
                <span style={{
                  width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                  background: dotColor,
                }} />
                <span style={{
                  flex: 1, color: highlighted ? '#e5e7eb' : '#9ca3af',
                  fontSize: '13px', fontWeight: highlighted ? '500' : '400',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {sym.name}{sym.description ? <span style={{ opacity: 0.6, fontWeight: '400' }}> — {sym.description}</span> : null}
                </span>
                {highlighted && (
                  <span style={{ color: isSelected ? SYMPTOM_STYLES[styleIdx].color : autoColor, fontSize: '14px', flexShrink: 0 }}>✓</span>
                )}
              </button>
            );
            });
          })()}
          </div>
        </div>
      </div>
    </div>
  ) : null;

  // ── SVG chart content (shared between desktop/mobile) ──
  const chartSVGContent = (
    <>
      {/* Grid lines */}
      {selectedSupplement ? (
        suppYLabels.map(val => {
          const y = padTop + chartH - (val / suppYMax) * chartH;
          return <line key={val} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />;
        })
      ) : (
        [0, 1, 2, 3, 4, 5].map(sev => {
          const y = padTop + chartH - (sev / 5) * chartH;
          return <line key={sev} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />;
        })
      )}

      {/* Left Y-axis */}
      {selectedSupplement ? (
        suppYLabels.map(val => {
          const y = padTop + chartH - (val / suppYMax) * chartH;
          return (
            <text key={`l-${val}`} x={padLeft - 5} y={y + 2.5} textAnchor="end"
              fill="#6b7280" fontSize="7" fontFamily="system-ui">{val}</text>
          );
        })
      ) : (
        [0, 1, 2, 3, 4, 5].map(sev => {
          const y = padTop + chartH - (sev / 5) * chartH;
          return (
            <text key={`l-${sev}`} x={padLeft - 5} y={y + 2.5} textAnchor="end"
              fill="#6b7280" fontSize="7" fontFamily="system-ui">{sev}</text>
          );
        })
      )}

      {/* Right Y-axis: severity (only when dual-axis mode) */}
      {selectedSupplement && selectedSymptoms.length > 0 && [0, 2.5, 5].map(sev => {
        const y = padTop + chartH - (sev / 5) * chartH;
        return (
          <text key={`r-${sev}`} x={W - padRight + 5} y={y + 2.5} textAnchor="start"
            fill="#6b7280" fontSize="7" fontFamily="system-ui">{sev}</text>
        );
      })}

      {/* X-axis */}
      {xLabels.map((lbl, i) => (
        <text key={i} x={lbl.x} y={H - 5} textAnchor="middle"
          fill="#6b7280" fontSize="7" fontFamily="system-ui">{lbl.label}</text>
      ))}

      {/* Cumulative area fill */}
      {areaFillPath && (
        <path d={areaFillPath} fill={SUPP_COLOR} fillOpacity="0.12" stroke="none" />
      )}

      {/* Supplement line */}
      {suppPoints && (
        <g>
          <path d={buildPath(suppPoints)} fill="none" stroke={SUPP_COLOR} strokeWidth="1.2" strokeLinejoin="round" />
          {showDots && suppPoints.map((pt, i) => (
            pt.y !== null && <circle key={`sd-${i}`} cx={pt.x} cy={pt.y} r="1.8" fill="rgb(15,17,21)" stroke={SUPP_COLOR} strokeWidth="0.8" />
          ))}
        </g>
      )}

      {/* Symptom lines */}
      {symptomPointSets.map((pts, idx) => (
        <g key={`sym-${idx}`}>
          <path d={buildPath(pts)} fill="none" stroke={SYMPTOM_STYLES[idx].color} strokeWidth="1" strokeLinejoin="round" />
          {showDots && pts.map((pt, i) => (
            pt.y !== null && <circle key={`syd-${idx}-${i}`} cx={pt.x} cy={pt.y} r="1.2" fill="rgb(15,17,21)" stroke={SYMPTOM_STYLES[idx].color} strokeWidth="0.7" />
          ))}
        </g>
      ))}

      {/* Crosshair */}
      {crosshairData && (
        <line x1={crosshairData.x} y1={padTop} x2={crosshairData.x} y2={padTop + chartH} stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
      )}
    </>
  );

  // ── Series chips (shared between desktop/mobile) ──
  const seriesChips = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Supplement chip or + button */}
      {selectedSupplement ? (() => {
        const supp = allSupplements.find(s => s.id === selectedSupplement);
        return (
          <div
            onClick={() => { setShowSupplementPicker(true); haptic('light'); }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 10px', borderRadius: '8px',
              background: 'rgba(139,92,246,0.12)',
              border: '1px solid rgba(139,92,246,0.35)',
              color: SUPP_COLOR, fontSize: '13px', fontWeight: '500',
              cursor: 'pointer',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {supp?.name}
            </span>
            <span style={{ fontSize: '14px', lineHeight: 1, opacity: 0.7, flexShrink: 0, marginLeft: '8px' }}>&times;</span>
          </div>
        );
      })() : (
        <div
          onClick={() => { setShowSupplementPicker(true); haptic('light'); }}
          style={{
            display: 'flex', alignItems: 'center',
            padding: '6px 10px', borderRadius: '8px',
            border: '1px dashed rgba(139,92,246,0.4)',
            background: 'transparent',
            color: 'rgba(139,92,246,0.7)', fontSize: '13px', fontWeight: '500',
            cursor: 'pointer',
          }}
        >
          + Supplement
        </div>
      )}

      {/* Symptom chips */}
      {selectedSymptoms.map((symId, idx) => {
        const sym = activeSymptoms.find(s => s.id === symId);
        const st = SYMPTOM_STYLES[idx];
        return (
          <div
            key={symId}
            onClick={() => { removeSymptom(symId); }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 10px', borderRadius: '8px',
              background: st.chipBg,
              border: `1px solid ${st.chipBorder}`,
              color: st.color, fontSize: '13px', fontWeight: '500',
              cursor: 'pointer',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sym?.name}{sym?.description ? <span style={{ opacity: 0.6, fontWeight: '400' }}> — {sym?.description}</span> : null}
            </span>
            <span style={{ fontSize: '14px', lineHeight: 1, opacity: 0.7, flexShrink: 0, marginLeft: '8px' }}>&times;</span>
          </div>
        );
      })}

      {/* + Symptom button (if room) */}
      {selectedSymptoms.length < 3 && (
        <div
          onClick={() => { setShowSymptomPicker(true); haptic('light'); }}
          style={{
            display: 'flex', alignItems: 'center',
            padding: '6px 10px', borderRadius: '8px',
            border: '1px dashed rgba(251,113,133,0.4)',
            background: 'transparent',
            color: 'rgba(251,113,133,0.7)', fontSize: '13px', fontWeight: '500',
            cursor: 'pointer',
          }}
        >
          + Symptom
        </div>
      )}
    </div>
  );

  // ── Render ──

  return (
    <div>
      {supplementPickerPanel}
      {symptomPickerPanel}

      {/* ── Chart card ── */}
      <div style={{
            background: 'rgba(15,17,21,0.6)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.06)',
            padding: '14px 14px 10px',
            marginBottom: '16px',
          }}>
            {isDesktop ? (
              /* ── Desktop: Legend (left) + Chart (right) ── */
              <div style={{ display: 'flex', gap: '0' }}>
                {/* Legend panel — left side */}
                <div style={{
                  width: '255px', flexShrink: 0,
                  paddingRight: '14px',
                  display: 'flex', flexDirection: 'column',
                  borderRight: '1px solid rgba(255,255,255,0.04)',
                }}>
                  {/* Range section */}
                  <div style={{ color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                    Range
                  </div>
                  <div style={{
                    display: 'flex', gap: '0',
                    borderRadius: '7px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.04)',
                    padding: '2px',
                    marginBottom: '8px',
                  }}>
                    {TIMEFRAMES.map(tf => (
                      <button key={tf.days}
                        onClick={() => { setTimeframe(tf.days); haptic('light'); }}
                        style={{
                          padding: '3px 0',
                          flex: 1,
                          borderRadius: '5px', border: 'none',
                          background: timeframe === tf.days ? 'rgba(255,255,255,0.12)' : 'transparent',
                          color: timeframe === tf.days ? '#fff' : '#6b7280',
                          fontSize: '10px', fontWeight: '500', cursor: 'pointer',
                        }}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>

                  {/* Arrow nav row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '0' }}>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <button
                        onClick={() => { setStartOffset(maxOffset); haptic('light'); }}
                        disabled={startOffset >= maxOffset}
                        style={{
                          padding: '3px 6px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
                          background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '10px',
                          cursor: startOffset >= maxOffset ? 'default' : 'pointer',
                          opacity: startOffset >= maxOffset ? 0.3 : 1,
                        }}
                      >|&lt;</button>
                      <button
                        onClick={() => { setStartOffset(prev => Math.min(prev + Math.round(timeframe / 2), maxOffset)); haptic('light'); }}
                        disabled={startOffset >= maxOffset}
                        style={{
                          padding: '3px 6px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
                          background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '10px',
                          cursor: startOffset >= maxOffset ? 'default' : 'pointer',
                          opacity: startOffset >= maxOffset ? 0.3 : 1,
                        }}
                      >&lt;</button>
                    </div>
                    <span style={{ flex: 1, textAlign: 'center', color: '#9ca3af', fontSize: '10px', whiteSpace: 'nowrap' }}>
                      {dateWindowLabel}
                    </span>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <button
                        onClick={() => { setStartOffset(prev => Math.max(prev - Math.round(timeframe / 2), 0)); haptic('light'); }}
                        disabled={startOffset === 0}
                        style={{
                          padding: '3px 6px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
                          background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '10px',
                          cursor: startOffset === 0 ? 'default' : 'pointer',
                          opacity: startOffset === 0 ? 0.3 : 1,
                        }}
                      >&gt;</button>
                      <button
                        onClick={() => { setStartOffset(0); haptic('light'); }}
                        disabled={startOffset === 0}
                        style={{
                          padding: '3px 6px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
                          background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '10px',
                          cursor: startOffset === 0 ? 'default' : 'pointer',
                          opacity: startOffset === 0 ? 0.3 : 1,
                        }}
                      >&gt;|</button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '16px 0' }} />

                  {/* Series chips */}
                  {seriesChips}

                  {/* Divider */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '16px 0' }} />

                  {/* View section */}
                  <div style={{ color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                    View
                  </div>
                  {viewModeSelector(false)}

                  {/* Date / Average header + Series items (only when series selected) */}
                  {(selectedSupplement || selectedSymptoms.length > 0) && (
                    <>
                      <div style={{
                        color: crosshairData ? '#e5e7eb' : '#9ca3af',
                        fontSize: '10px', fontWeight: '500',
                        marginBottom: '14px',
                        letterSpacing: '0.03em',
                      }}>
                        {legendItems.dateLabel}
                      </div>

                      {legendItems.items.map((item, i) => (
                        <div key={i} style={{ marginBottom: '14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                            <span style={{
                              color: '#9ca3af', fontSize: '11px',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {item.name}
                            </span>
                          </div>
                          <div style={{
                            color: '#e5e7eb', fontSize: '16px', fontWeight: '600',
                            fontVariantNumeric: 'tabular-nums', paddingLeft: '12px',
                          }}>
                            {item.val !== null && item.val !== undefined && isFinite(item.val)
                              ? item.unit === '/5'
                                ? `${item.val.toFixed(1)}${item.unit}`
                                : `${Number.isInteger(item.val) ? item.val : item.val.toFixed(1)} ${item.unit}`
                              : '--'}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* SVG chart — right side */}
                <div style={{ flex: 1, minWidth: 0, touchAction: 'none', paddingLeft: '6px' }}>
                  {(selectedSupplement || selectedSymptoms.length > 0) ? (
                    <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
                      onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
                      style={{ display: 'block' }}
                    >
                      {chartSVGContent}
                    </svg>
                  ) : (
                    <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                      <div style={{ color: '#6b7280', fontSize: '13px', lineHeight: '1.6' }}>
                        Select at least one supplement or symptom<br />to visualize trends over time
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* ── Mobile: vertical stack ── */
              <div>
                {/* Timeframe pills — full width */}
                <div style={{
                  display: 'flex', gap: '0',
                  borderRadius: '7px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.04)',
                  padding: '2px',
                  marginBottom: '8px',
                }}>
                  {TIMEFRAMES.map(tf => (
                    <button key={tf.days}
                      onClick={() => { setTimeframe(tf.days); haptic('light'); }}
                      style={{
                        padding: '5px 0',
                        flex: 1,
                        borderRadius: '5px', border: 'none',
                        background: timeframe === tf.days ? 'rgba(255,255,255,0.12)' : 'transparent',
                        color: timeframe === tf.days ? '#fff' : '#6b7280',
                        fontSize: '11px', fontWeight: '500', cursor: 'pointer',
                      }}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>

                {/* Arrow nav row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <button
                      onClick={() => { setStartOffset(maxOffset); haptic('light'); }}
                      disabled={startOffset >= maxOffset}
                      style={{
                        padding: '4px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '11px',
                        cursor: startOffset >= maxOffset ? 'default' : 'pointer',
                        opacity: startOffset >= maxOffset ? 0.3 : 1,
                      }}
                    >|&lt;</button>
                    <button
                      onClick={() => { setStartOffset(prev => Math.min(prev + Math.round(timeframe / 2), maxOffset)); haptic('light'); }}
                      disabled={startOffset >= maxOffset}
                      style={{
                        padding: '4px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '11px',
                        cursor: startOffset >= maxOffset ? 'default' : 'pointer',
                        opacity: startOffset >= maxOffset ? 0.3 : 1,
                      }}
                    >&lt;</button>
                  </div>
                  <span style={{ flex: 1, textAlign: 'center', color: '#9ca3af', fontSize: '10px', whiteSpace: 'nowrap' }}>
                    {dateWindowLabel}
                  </span>
                  <div style={{ display: 'flex', gap: '2px' }}>
                    <button
                      onClick={() => { setStartOffset(prev => Math.max(prev - Math.round(timeframe / 2), 0)); haptic('light'); }}
                      disabled={startOffset === 0}
                      style={{
                        padding: '4px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '11px',
                        cursor: startOffset === 0 ? 'default' : 'pointer',
                        opacity: startOffset === 0 ? 0.3 : 1,
                      }}
                    >&gt;</button>
                    <button
                      onClick={() => { setStartOffset(0); haptic('light'); }}
                      disabled={startOffset === 0}
                      style={{
                        padding: '4px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '11px',
                        cursor: startOffset === 0 ? 'default' : 'pointer',
                        opacity: startOffset === 0 ? 0.3 : 1,
                      }}
                    >&gt;|</button>
                  </div>
                </div>

                {/* Divider */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '10px 0' }} />

                {/* Series chips */}
                {seriesChips}

                {/* Divider */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '10px 0' }} />

                {/* View Mode Selector — moved above chart */}
                <div style={{ marginBottom: '10px' }}>
                  {viewModeSelector(true)}
                </div>

                {/* Full-width SVG chart */}
                {(selectedSupplement || selectedSymptoms.length > 0) ? (
                  <div>
                    <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
                      onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
                      style={{ display: 'block' }}
                    >
                      {chartSVGContent}
                    </svg>
                  </div>
                ) : (
                  <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                    <div style={{ color: '#6b7280', fontSize: '13px', lineHeight: '1.6' }}>
                      Select at least one supplement or symptom<br />to visualize trends over time
                    </div>
                  </div>
                )}

                {/* Stats row below chart */}
                {legendItems.items.length > 0 && (
                  <div style={{
                    display: 'flex',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    marginTop: '8px',
                    paddingTop: '10px',
                  }}>
                    {legendItems.items.map((item, i) => (
                      <div key={i} style={{
                        flex: 1,
                        textAlign: 'center',
                        ...(i > 0 ? { borderLeft: '1px solid rgba(255,255,255,0.06)' } : {}),
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginBottom: '2px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                          <span style={{
                            color: '#9ca3af', fontSize: '10px',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            maxWidth: '80px',
                          }}>
                            {item.name}
                          </span>
                        </div>
                        <div style={{
                          color: '#e5e7eb', fontSize: '15px', fontWeight: '600',
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {item.val !== null && item.val !== undefined && isFinite(item.val)
                            ? item.unit === '/5'
                              ? `${item.val.toFixed(1)}${item.unit}`
                              : `${Number.isInteger(item.val) ? item.val : item.val.toFixed(1)} ${item.unit}`
                            : '--'}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: '9px' }}>
                          {crosshairData ? legendItems.dateLabel : 'avg'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

    </div>
  );
}
