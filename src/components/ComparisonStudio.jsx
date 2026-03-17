import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { haptic } from '../utils/helpers';
import {
  TIMEFRAMES, SMOOTH_WINDOWS,
  interpolateSmallGaps, smooth,
  formatXLabel, getXLabelInterval, buildPath,
} from '../utils/chartHelpers';
import {
  getSymptomDailySeries,
  getSupplementDoseSeries,
} from '../utils/correlationHelpers';

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

  // Compute smart defaults: supplement with most history, one random active symptom
  const smartDefaults = useMemo(() => {
    // Find supplement with most entries in stackEntries
    let bestSupp = '';
    let bestCount = 0;
    for (const item of (stackItems || [])) {
      let count = 0;
      const keys = Object.keys(stackEntries || {});
      for (const key of keys) {
        if (key.endsWith(`-${item.id}`) && stackEntries[key]?.taken) count++;
      }
      if (count > bestCount) { bestCount = count; bestSupp = item.id; }
    }
    // Pick first active symptom as fallback "random" pick
    const defaultSymptom = activeSymptoms.length > 0 ? activeSymptoms[0].id : '';
    return { supplement: bestSupp, symptom: defaultSymptom };
  }, [stackItems, stackEntries, activeSymptoms]);

  // Load saved or compute initial selections
  const initialSelections = useMemo(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        // Validate saved supplement still exists
        const suppValid = saved.supplement && (stackItems || []).some(i => i.id === saved.supplement);
        // Validate saved symptoms still exist as active
        const validSymptoms = (saved.symptoms || []).filter(
          id => (symptoms || []).some(s => s.id === id && s.active)
        );
        return {
          supplement: suppValid ? saved.supplement : '',
          symptoms: validSymptoms.length > 0 ? validSymptoms : (smartDefaults.symptom ? [smartDefaults.symptom] : []),
        };
      }
    } catch {}
    return {
      supplement: '',
      symptoms: smartDefaults.symptom ? [smartDefaults.symptom] : [],
    };
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
  const [startOffset, setStartOffset] = useState(0); // days back from today for the end of the window
  const [touchX, setTouchX] = useState(null);
  const svgRef = useRef(null);

  // Mobile pan gesture state
  const panRef = useRef({ startX: 0, startOffset: 0, isPanning: false, startTime: 0 });

  // Auto-focus search inputs when pickers open
  useEffect(() => { if (showSupplementPicker) { setSuppSearch(''); setTimeout(() => suppSearchRef.current?.focus(), 50); } }, [showSupplementPicker]);
  useEffect(() => { if (showSymptomPicker) { setSymSearch(''); setTimeout(() => symSearchRef.current?.focus(), 50); } }, [showSymptomPicker]);

  // Persist selections to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        supplement: selectedSupplement,
        symptoms: selectedSymptoms,
      }));
    } catch {}
  }, [selectedSupplement, selectedSymptoms]);

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

  // SVG — narrower chart, 40% taller, legend goes to the right
  const W = 500, H = 280;
  const padLeft = 36, padRight = 20, padTop = 14, padBottom = 22;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // ── Data pipeline ──

  const windowSize = SMOOTH_WINDOWS[timeframe] || 5;

  // Supplement: dose series — 0 on untaken days so the line is continuous
  const suppDoseRaw = useMemo(() => {
    if (!selectedSupplement) return null;
    const raw = getSupplementDoseSeries(stackEntries, stackItems, selectedSupplement, dates);
    // Cap outlier doses: use 95th percentile × 3 to ignore bogus spikes
    const valid = raw.filter(v => v !== null && v > 0).sort((a, b) => a - b);
    let capped = raw;
    if (valid.length > 2) {
      const p95 = valid[Math.floor(valid.length * 0.95)];
      const cap = p95 * 3;
      capped = raw.map(v => (v !== null && v > cap) ? cap : v);
    }
    // Fill nulls with 0 so the line drops to 0 on untaken days
    return capped.map(v => v === null ? 0 : v);
  }, [selectedSupplement, stackEntries, stackItems, dates]);

  // Dose Y-axis range
  const suppYMax = useMemo(() => {
    if (!suppDoseRaw) return 100;
    let max = 0;
    suppDoseRaw.forEach(v => { if (v !== null && v > max) max = v; });
    const ceiling = max > 0 ? Math.ceil(max * 1.1) : (suppItem?.defaultDose || 100);
    return Math.max(ceiling, suppItem?.defaultDose || 100);
  }, [suppDoseRaw, suppItem]);

  // Nice-number Y-axis labels: always ~4-6 labels regardless of range
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

  const symptomData = useMemo(() =>
    selectedSymptoms.map(symId => {
      const filled = interpolateSmallGaps(getSymptomDailySeries(entries, symId, dates, trackingMode));
      return { raw: filled, smoothed: smooth(filled, windowSize) };
    }),
    [selectedSymptoms, entries, dates, trackingMode, windowSize]
  );

  // ── Chart points ──

  const suppPoints = useMemo(() => {
    if (!suppDoseRaw) return null;
    return suppDoseRaw.map((val, i) => ({
      x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
      y: val === null ? null : padTop + chartH - (val / suppYMax) * chartH,
      val,
    }));
  }, [suppDoseRaw, dates.length, chartW, chartH, suppYMax]);

  const symptomPointSets = useMemo(() =>
    symptomData.map(sd =>
      sd.smoothed.map((val, i) => ({
        x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
        y: val === null ? null : padTop + chartH - (val / 5) * chartH,
        val,
      }))
    ),
    [symptomData, dates.length, chartW, chartH]
  );

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

  // Touch/mouse
  const getSnappedIndex = useCallback((clientX) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const idx = Math.round(((clientX - rect.left) / rect.width * W - padLeft) / chartW * (dates.length - 1));
    return Math.max(0, Math.min(dates.length - 1, idx));
  }, [chartW, dates.length]);

  // Desktop: simple crosshair on hover
  const handleMouseMove = (e) => setTouchX(getSnappedIndex(e.clientX));
  const handleMouseLeave = () => setTouchX(null);

  // Desktop touch: crosshair only
  const handleDesktopTouchStart = (e) => { e.preventDefault(); setTouchX(getSnappedIndex(e.touches[0].clientX)); };
  const handleDesktopTouchMove = (e) => { e.preventDefault(); setTouchX(getSnappedIndex(e.touches[0].clientX)); };
  const handleDesktopTouchEnd = () => setTouchX(null);

  // Mobile touch: pan to scroll date window, with crosshair on long-press / slow drag
  const handleMobileTouchStart = useCallback((e) => {
    e.preventDefault();
    const x = e.touches[0].clientX;
    panRef.current = { startX: x, startOffset: startOffset, isPanning: false, startTime: Date.now() };
    setTouchX(getSnappedIndex(x));
  }, [startOffset, getSnappedIndex]);

  const handleMobileTouchMove = useCallback((e) => {
    e.preventDefault();
    const x = e.touches[0].clientX;
    const dx = x - panRef.current.startX;
    const absDx = Math.abs(dx);

    // If moved more than 15px horizontally, treat as pan gesture
    if (absDx > 15) {
      panRef.current.isPanning = true;
      setTouchX(null); // hide crosshair during pan
      // Convert pixel distance to days: full chart width = timeframe days
      if (!svgRef.current) return;
      const chartPxWidth = svgRef.current.getBoundingClientRect().width;
      const daysPer_px = timeframe / chartPxWidth;
      // Dragging right = going back in time (increase offset), left = forward (decrease)
      const daysDelta = Math.round(dx * daysPer_px);
      const newOffset = Math.max(0, Math.min(maxOffset, panRef.current.startOffset + daysDelta));
      setStartOffset(newOffset);
    } else {
      // Small movement — show crosshair
      setTouchX(getSnappedIndex(x));
    }
  }, [timeframe, maxOffset, getSnappedIndex]);

  const handleMobileTouchEnd = useCallback(() => {
    panRef.current.isPanning = false;
    setTouchX(null);
  }, []);

  const crosshairData = useMemo(() => {
    if (touchX === null) return null;
    const d = new Date(dates[touchX] + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const items = [];
    if (suppPoints) {
      items.push({
        name: suppItem?.name,
        color: SUPP_COLOR,
        val: suppPoints[touchX]?.val,
        unit: suppUnit,
      });
    }
    selectedSymptoms.forEach((symId, idx) => {
      if (symptomPointSets[idx]) {
        items.push({
          name: symptoms.find(s => s.id === symId)?.name,
          color: SYMPTOM_STYLES[idx].color,
          val: symptomPointSets[idx][touchX]?.val,
          unit: '/5',
        });
      }
    });
    return { dateLabel, items, x: padLeft + (touchX / Math.max(1, dates.length - 1)) * chartW };
  }, [touchX, dates, suppPoints, symptomPointSets, suppItem, suppUnit, symptoms, selectedSymptoms, chartW]);

  // Legend: show crosshair values when hovering, averages otherwise
  const legendItems = useMemo(() => {
    if (crosshairData) return crosshairData;
    const avg = (arr) => {
      const valid = arr.filter(v => v !== null);
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };
    const items = [];
    if (suppDoseRaw) {
      const takenOnly = suppDoseRaw.filter(v => v > 0);
      const suppAvg = takenOnly.length > 0 ? takenOnly.reduce((a, b) => a + b, 0) / takenOnly.length : null;
      items.push({ name: suppItem?.name, color: SUPP_COLOR, val: suppAvg, unit: suppUnit });
    }
    selectedSymptoms.forEach((symId, idx) => {
      const sd = symptomData[idx];
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
  }, [crosshairData, suppDoseRaw, symptomData, suppItem, suppUnit, symptoms, selectedSymptoms]);

  // Max offset: based on earliest data point across selected symptoms/supplement
  const maxOffset = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    let earliest = null;

    // Check selected symptoms
    for (const symId of selectedSymptoms) {
      for (const key of Object.keys(entries || {})) {
        if (key.includes(`-${symId}-`)) {
          const e = entries[key];
          if (e?.date && (!earliest || e.date < earliest)) earliest = e.date;
        }
      }
    }

    // Check selected supplement
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

  // Date window label for the slider
  const dateWindowLabel = useMemo(() => {
    if (dates.length === 0) return '';
    const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(dates[0])} — ${fmt(dates[dates.length - 1])}`;
  }, [dates]);

  const hasAnySeries = selectedSupplement || selectedSymptoms.length > 0;
  const showDots = timeframe <= 28;

  // Shared input box style for all three selectors
  const inputBoxStyle = {
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    height: '38px',
    boxSizing: 'border-box',
  };

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
                const filtered = allSupplements.filter(s => s.name.toLowerCase().includes(suppSearch.toLowerCase()));
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
              const filtered = allSupplements.filter(s => !suppSearch || s.name.toLowerCase().includes(suppSearch.toLowerCase()));
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
                    flex: 1, color: highlighted ? '#e5e7eb' : '#9ca3af',
                    fontSize: '13px', fontWeight: highlighted ? '500' : '400',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {supp.name}
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
                  {sym.name}
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

  // ── Render ──

  return (
    <div>
      {supplementPickerPanel}
      {symptomPickerPanel}

      {/* ── Selectors ── */}
      {isDesktop ? (
        <div style={{
          display: 'flex', flexDirection: 'row',
          gap: '12px',
          marginBottom: '20px',
          alignItems: 'flex-end',
        }}>
          {/* Supplement selector */}
          <div style={{ width: '180px', flexShrink: 0 }}>
            <div style={{ marginBottom: '6px' }}>
              <span style={{ color: '#9ca3af', fontSize: '13px' }}>Supplement</span>
            </div>
            <div
              onClick={() => { setShowSupplementPicker(true); haptic('light'); }}
              style={{
                ...inputBoxStyle,
                display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
                padding: '0 10px',
                height: selectedSupplement ? undefined : '38px',
                minHeight: '38px',
                cursor: 'pointer',
              }}
            >
              {selectedSupplement && (() => {
                const supp = allSupplements.find(s => s.id === selectedSupplement);
                return (
                  <span onClick={(e) => { e.stopPropagation(); setSelectedSupplement(''); haptic('light'); }} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '3px 8px', borderRadius: '6px',
                    background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.35)',
                    color: SUPP_COLOR, fontSize: '13px', fontWeight: '500', lineHeight: '1.3',
                    cursor: 'pointer',
                  }}>
                    {supp?.name}
                    <span style={{
                      color: SUPP_COLOR, fontSize: '14px', lineHeight: 1, opacity: 0.7,
                    }}>×</span>
                  </span>
                );
              })()}
              {!selectedSupplement && (
                <span style={{ color: '#6b7280', fontSize: '13px', pointerEvents: 'none' }}>Select supplement...</span>
              )}
            </div>
          </div>

          {/* Symptom selector */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ color: '#9ca3af', fontSize: '13px' }}>Symptoms</span>
              <span style={{ color: '#4b5563', fontSize: '12px' }}>{selectedSymptoms.length}/3</span>
            </div>
            <div
              onClick={() => { setShowSymptomPicker(true); haptic('light'); }}
              style={{
                ...inputBoxStyle,
                display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
                padding: '0 10px',
                height: selectedSymptoms.length > 0 ? undefined : '38px',
                minHeight: '38px',
                cursor: 'pointer',
              }}
            >
              {selectedSymptoms.map((symId, idx) => {
                const sym = activeSymptoms.find(s => s.id === symId);
                const st = SYMPTOM_STYLES[idx];
                return (
                  <span key={symId} onClick={(e) => { e.stopPropagation(); removeSymptom(symId); }} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '3px 8px', borderRadius: '6px',
                    background: st.chipBg, border: `1px solid ${st.chipBorder}`,
                    color: st.color, fontSize: '13px', fontWeight: '500', lineHeight: '1.3',
                    cursor: 'pointer',
                  }}>
                    {sym?.name}
                    <span style={{
                      color: st.color, fontSize: '14px', lineHeight: 1, opacity: 0.7,
                    }}>×</span>
                  </span>
                );
              })}
              {selectedSymptoms.length === 0 && (
                <span style={{ color: '#6b7280', fontSize: '13px', pointerEvents: 'none' }}>Select symptoms...</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Mobile: compact chip row */
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
          marginBottom: '12px',
        }}>
          {selectedSupplement && (() => {
            const supp = allSupplements.find(s => s.id === selectedSupplement);
            return (
              <span onClick={() => { setSelectedSupplement(''); haptic('light'); }} style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '14px',
                background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.35)',
                color: SUPP_COLOR, fontSize: '13px', fontWeight: '500',
                cursor: 'pointer',
              }}>
                {supp?.name}
                <span style={{ fontSize: '14px', lineHeight: 1, opacity: 0.7 }}>×</span>
              </span>
            );
          })()}
          {selectedSymptoms.map((symId, idx) => {
            const sym = activeSymptoms.find(s => s.id === symId);
            const st = SYMPTOM_STYLES[idx];
            return (
              <span key={symId} onClick={() => { removeSymptom(symId); }} style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '4px 10px', borderRadius: '14px',
                background: st.chipBg, border: `1px solid ${st.chipBorder}`,
                color: st.color, fontSize: '13px', fontWeight: '500',
                cursor: 'pointer',
              }}>
                {sym?.name}
                <span style={{ fontSize: '14px', lineHeight: 1, opacity: 0.7 }}>×</span>
              </span>
            );
          })}
          {!selectedSupplement && (
            <span onClick={() => { setShowSupplementPicker(true); haptic('light'); }} style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '4px 10px', borderRadius: '14px',
              border: '1px dashed rgba(139,92,246,0.4)',
              background: 'transparent',
              color: 'rgba(139,92,246,0.7)', fontSize: '13px', fontWeight: '500',
              cursor: 'pointer',
            }}>
              + Supplement
            </span>
          )}
          {selectedSymptoms.length < 3 && (
            <span onClick={() => { setShowSymptomPicker(true); haptic('light'); }} style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '4px 10px', borderRadius: '14px',
              border: '1px dashed rgba(251,113,133,0.4)',
              background: 'transparent',
              color: 'rgba(251,113,133,0.7)', fontSize: '13px', fontWeight: '500',
              cursor: 'pointer',
            }}>
              + Symptom
            </span>
          )}
        </div>
      )}

      {!hasAnySeries ? (
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '12px',
          padding: '48px 20px', textAlign: 'center',
        }}>
          <div style={{ color: '#6b7280', fontSize: '13px', lineHeight: '1.6' }}>
            Select at least one supplement or symptom<br />to visualize trends over time
          </div>
        </div>
      ) : (
        <>
          {/* Shared slider CSS */}
          <style>{`
            .cs-slider { -webkit-appearance: none; appearance: none; height: 6px; border-radius: 3px; background: #f59e0b; outline: none; direction: rtl; }
            .cs-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #f59e0b; cursor: pointer; border: 2px solid #1a1a2e; }
            .cs-slider::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #f59e0b; cursor: pointer; border: 2px solid #1a1a2e; }
            .cs-slider::-moz-range-track { background: #f59e0b; height: 6px; border-radius: 3px; }
          `}</style>

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
                  {/* Timeframe pills */}
                  <div style={{
                    display: 'flex', gap: '0',
                    borderRadius: '7px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.04)',
                    padding: '2px',
                    marginBottom: '20px',
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

                  {/* Date window slider */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '22px' }}>
                    <span style={{ color: '#9ca3af', fontSize: '8px', whiteSpace: 'nowrap' }}>{dateWindowLabel}</span>
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                      <input type="range" className="cs-slider" min="0" max={maxOffset} step="1" value={startOffset}
                        onChange={(e) => setStartOffset(parseInt(e.target.value))}
                        style={{ width: '120px' }}
                      />
                    </div>
                  </div>

                  {/* Date / Average header */}
                  <div style={{
                    color: crosshairData ? '#e5e7eb' : '#9ca3af',
                    fontSize: '10px', fontWeight: '500',
                    marginBottom: '14px',
                    letterSpacing: '0.03em',
                  }}>
                    {legendItems.dateLabel}
                  </div>

                  {/* Series items */}
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
                </div>

                {/* SVG chart — right side */}
                <div style={{ flex: 1, minWidth: 0, touchAction: 'none', paddingLeft: '6px' }}>
                  <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
                    onTouchStart={handleDesktopTouchStart} onTouchMove={handleDesktopTouchMove} onTouchEnd={handleDesktopTouchEnd}
                    onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
                    style={{ display: 'block' }}
                  >
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
                  </svg>
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
                  marginBottom: '10px',
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

                {/* Date range label — swipe chart to scroll */}
                <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                  <span style={{ color: '#9ca3af', fontSize: '10px' }}>{dateWindowLabel}</span>
                </div>

                {/* Full-width SVG chart */}
                <div style={{ touchAction: 'none' }}>
                  <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
                    onTouchStart={handleMobileTouchStart} onTouchMove={handleMobileTouchMove} onTouchEnd={handleMobileTouchEnd}
                    onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
                    style={{ display: 'block' }}
                  >
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
                  </svg>
                </div>

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

        </>
      )}
    </div>
  );
}
