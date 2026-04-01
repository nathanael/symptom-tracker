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
  getHealthScoreSeries,
} from '../utils/correlationHelpers';
import { computeLevels, computeInsight, getLevelColor } from '../utils/insightHelpers';
import HealthScoreCard from './HealthScoreCard';
import { useHealthScore } from '../hooks/useHealthScore';

const SYMPTOM_STYLES = [
  { color: '#ff8a9e', chipBg: 'rgba(255,138,158,0.12)', chipBorder: 'rgba(255,138,158,0.35)' },
  { color: '#5ccbff', chipBg: 'rgba(92,203,255,0.12)', chipBorder: 'rgba(92,203,255,0.35)' },
  { color: '#ffb830', chipBg: 'rgba(255,184,48,0.12)', chipBorder: 'rgba(255,184,48,0.35)' },
];

const SUPP_COLOR = '#8b5cf6';
const HEALTH_SCORE_COLOR = '#10b981';

export default function ComparisonStudio({
  entries,
  symptoms,
  stackItems,
  stackEntries,
  trackingMode,
  isDesktop,
  setStackItems,
}) {
  const healthScore = useHealthScore(new Date(), { symptoms, entries, trackingMode });

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
          primarySeriesId: saved.primarySeriesId || '',
        };
      }
    } catch {}
    return { supplement: '', symptoms: [], primarySeriesId: '' };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only

  const [selectedSupplement, setSelectedSupplement] = useState(initialSelections.supplement);
  const [selectedSymptoms, setSelectedSymptoms] = useState(initialSelections.symptoms);
  const [primarySeriesId, setPrimarySeriesId] = useState(initialSelections.primarySeriesId || '');
  const [showSupplementPicker, setShowSupplementPicker] = useState(false);
  const [showSymptomPicker, setShowSymptomPicker] = useState(false);
  const [suppSearch, setSuppSearch] = useState('');
  const [symSearch, setSymSearch] = useState('');
  const suppSearchRef = useRef(null);
  const symSearchRef = useRef(null);
  const [timeframe, setTimeframe] = useState(30);
  const [startOffset, setStartOffset] = useState(0);
  const [touchX, setTouchX] = useState(null);
  const svgRef = useRef(null);
  const [showHealthScore, setShowHealthScore] = useState(false);


  // Auto-focus search inputs when pickers open
  useEffect(() => { if (showSupplementPicker) { setSuppSearch(''); setTimeout(() => suppSearchRef.current?.focus(), 50); } }, [showSupplementPicker]);
  useEffect(() => { if (showSymptomPicker) { setSymSearch(''); setTimeout(() => symSearchRef.current?.focus(), 50); } }, [showSymptomPicker]);

  // Persist selections to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        supplement: selectedSupplement,
        symptoms: selectedSymptoms,
        primarySeriesId,
      }));
    } catch {}
  }, [selectedSupplement, selectedSymptoms, primarySeriesId]);

  // Auto-set primary to first available series when current primary is removed
  useEffect(() => {
    const allIds = [selectedSupplement, ...selectedSymptoms].filter(Boolean);
    if (!allIds.includes(primarySeriesId) && allIds.length > 0) {
      setPrimarySeriesId(allIds[0]);
    }
  }, [selectedSupplement, selectedSymptoms, primarySeriesId]);

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

  const makePrimary = (id) => {
    setPrimarySeriesId(id);
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
  const H_MOBILE = 380;
  const chartContainerRef = useRef(null);
  const [desktopChartDims, setDesktopChartDims] = useState({ w: 500, h: 420 });
  useEffect(() => {
    if (!isDesktop) return;
    const el = chartContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDesktopChartDims({ w: Math.round(width), h: Math.round(height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isDesktop]);
  const W = isDesktop ? desktopChartDims.w : 500;
  const H = isDesktop ? desktopChartDims.h : H_MOBILE;
  // Scale factor for fonts/strokes — designed for 500-unit base
  const s = W / 500;
  const padLeft = (isDesktop ? 36 : 32) * s, padRight = (isDesktop ? 20 : 28) * s, padTop = (isDesktop ? 14 : 10) * s, padBottom = (isDesktop ? 22 : 30) * s;
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
    return capped.map(v => v === null ? 0 : v);
  }, [selectedSupplement, stackEntries, stackItems, dates]);

  // Transformed supplement data (smoothed for display, raw kept for level computation)
  const suppTransformed = useMemo(() => {
    if (!suppDoseDaily) return null;
    const smoothed = windowSize > 1 ? smooth(suppDoseDaily, windowSize) : [...suppDoseDaily];
    return { values: smoothed, dates: [...dates], labels: [...dates] };
  }, [suppDoseDaily, dates, windowSize]);

  // Y-axis range (from transformed data)
  const suppYMax = useMemo(() => {
    if (!suppTransformed) return 100;
    const max = Math.max(...suppTransformed.values.filter(v => v !== null && v !== undefined));
    if (!isFinite(max) || max <= 0) return suppItem?.defaultDose || 100;
    const ceiling = Math.ceil(max * 1.1);
    return Math.max(ceiling, suppItem?.defaultDose || 100);
  }, [suppTransformed, suppItem]);

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
      return { raw: filled, smoothed, transformed: { values: smoothed, dates, labels: dates } };
    }),
    [selectedSymptoms, entries, dates, trackingMode, windowSize]
  );

  const healthScoreTransformed = useMemo(() => {
    if (!showHealthScore) return null;
    const raw = getHealthScoreSeries(symptoms, entries, dates, trackingMode);
    const filled = interpolateSmallGaps(raw);
    const smoothed = windowSize > 1 ? smooth(filled, windowSize) : [...filled];
    return { values: smoothed, dates: [...dates], labels: [...dates] };
  }, [showHealthScore, symptoms, entries, dates, trackingMode, windowSize]);

  // ── Level segments & insight data ──

  const primaryIsSymptom = selectedSymptoms.includes(primarySeriesId);
  const primaryIsSupplement = primarySeriesId === selectedSupplement;

  const primaryDailyValues = useMemo(() => {
    if (primaryIsSupplement && suppDoseDaily) return suppDoseDaily;
    const symIdx = selectedSymptoms.indexOf(primarySeriesId);
    if (symIdx >= 0 && symptomTransformed[symIdx]) return symptomTransformed[symIdx].smoothed;
    return null;
  }, [primarySeriesId, primaryIsSupplement, suppDoseDaily, selectedSymptoms, symptomTransformed]);

  const levels = useMemo(() => {
    if (!primaryDailyValues) return [];
    return computeLevels(primaryDailyValues, dates, timeframe);
  }, [primaryDailyValues, dates, timeframe]);

  const extendedDates = useMemo(() => {
    const result = [];
    const end = new Date();
    end.setDate(end.getDate() - startOffset);
    for (let i = (timeframe * 2) - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(d.getDate() - i);
      result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return result;
  }, [timeframe, startOffset]);

  const insightData = useMemo(() => {
    if (!primarySeriesId) return null;

    const buildStats = (id, isSymptom) => {
      let extSeries;
      if (id === selectedSupplement) {
        extSeries = getSupplementDoseSeries(stackEntries, stackItems, id, extendedDates).map(v => v === null ? 0 : v);
      } else {
        extSeries = interpolateSmallGaps(getSymptomDailySeries(entries, id, extendedDates, trackingMode));
        extSeries = smooth(extSeries, windowSize);
      }
      const mid = extSeries.length / 2;
      const prior = extSeries.slice(0, mid).filter(v => v !== null && v !== undefined);
      const current = extSeries.slice(mid).filter(v => v !== null && v !== undefined);
      const priorAvg = prior.length > 0 ? prior.reduce((s, v) => s + v, 0) / prior.length : 0;
      const currentAvg = current.length > 0 ? current.reduce((s, v) => s + v, 0) / current.length : 0;
      const item = isSymptom ? symptoms.find(s => s.id === id) : stackItems.find(i => i.id === id);
      const unit = isSymptom ? '/5' : (item?.unit || 'mg');
      return { name: item?.name || '', average: currentAvg, priorAverage: priorAvg, unit, isSymptom };
    };

    const primaryStats = buildStats(primarySeriesId, primaryIsSymptom);
    const secondaryIds = [selectedSupplement, ...selectedSymptoms].filter(id => id && id !== primarySeriesId);
    const secondaryStats = secondaryIds.map(id => buildStats(id, selectedSymptoms.includes(id)));

    const tfLabel = timeframe <= 7 ? 'week' : timeframe <= 30 ? 'month' : '6 months';
    const insight = computeInsight(primaryStats, secondaryStats, { timeframeLabel: tfLabel });
    return insight ? { ...insight, secondaryStats } : null;
  }, [primarySeriesId, primaryIsSymptom, selectedSupplement, selectedSymptoms,
      stackEntries, stackItems, entries, symptoms, trackingMode,
      extendedDates, timeframe, windowSize]);

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

  const healthScorePoints = useMemo(() => {
    if (!healthScoreTransformed) return null;
    return healthScoreTransformed.values.map((val, i) => ({
      x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
      y: val !== null ? padTop + chartH - (val / 5) * chartH : null,
    }));
  }, [healthScoreTransformed, padLeft, chartW, chartH, padTop, dates.length]);

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

  const getSnappedIndex = useCallback((clientX) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const xPx = (clientX - rect.left) / rect.width * W;
    const idx = Math.round((xPx - padLeft) / chartW * (dates.length - 1));
    return Math.max(0, Math.min(dates.length - 1, idx));
  }, [chartW, dates.length]);

  // Desktop: crosshair + tooltip on hover
  const [mouseY, setMouseY] = useState(null);
  const handleMouseMove = (e) => {
    setTouchX(getSnappedIndex(e.clientX));
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      setMouseY((e.clientY - rect.top) / rect.height * H);
    }
  };
  const handleMouseLeave = () => { setTouchX(null); setMouseY(null); };



  const crosshairData = useMemo(() => {
    if (touchX === null) return null;

    const dateLabel = formatXLabel(dates[touchX], timeframe);
    const suppVal = suppDoseDaily ? suppDoseDaily[touchX] : null;
    const suppX = suppPoints ? suppPoints[touchX]?.x : null;
    const symptomVals = symptomTransformed.map((sd, idx) => ({
      val: sd.smoothed[touchX],
      color: SYMPTOM_STYLES[idx].color,
      name: (() => { const s = symptoms.find(s => s.id === selectedSymptoms[idx]); return s ? s.name + (s.description ? ` (${s.description})` : '') : undefined; })(),
    }));

    const items = [];
    if (suppPoints) {
      items.push({ name: suppItem?.name, color: SUPP_COLOR, val: suppVal, unit: suppUnit });
    }
    selectedSymptoms.forEach((symId, idx) => {
      const sym = symptoms.find(s => s.id === symId);
      items.push({
        name: sym ? sym.name + (sym.description ? ` (${sym.description})` : '') : undefined,
        color: SYMPTOM_STYLES[idx].color,
        val: symptomVals[idx]?.val ?? null,
        unit: '/5',
      });
    });
    if (showHealthScore && healthScoreTransformed) {
      const hsVal = healthScoreTransformed.values[touchX];
      if (hsVal !== null && hsVal !== undefined) {
        items.push({
          name: 'Health Score',
          color: HEALTH_SCORE_COLOR,
          val: Math.round(hsVal * 20),
          unit: '%',
        });
      }
    }
    const x = suppX || (suppPoints ? null : padLeft + (touchX / Math.max(1, dates.length - 1)) * chartW);
    return { dateLabel, items, x };
  }, [touchX, dates, suppDoseDaily, suppPoints, symptomTransformed, symptoms, selectedSymptoms, timeframe, chartW, suppItem, suppUnit, showHealthScore, healthScoreTransformed]);

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
        const sym = symptoms.find(s => s.id === symId);
        items.push({
          name: sym ? sym.name + (sym.description ? ` (${sym.description})` : '') : undefined,
          color: SYMPTOM_STYLES[idx].color,
          val: avg(sd.smoothed),
          unit: '/5',
        });
      }
    });
    if (showHealthScore && healthScoreTransformed) {
      const vals = healthScoreTransformed.values.filter(v => v !== null);
      const hsAvg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      items.push({
        name: 'Health Score',
        color: HEALTH_SCORE_COLOR,
        val: hsAvg !== null ? Math.round(hsAvg * 20) : null,
        unit: '%',
      });
    }
    return { dateLabel: 'Average', items, x: null };
  }, [crosshairData, suppTransformed, symptomTransformed, suppItem, suppUnit, symptoms, selectedSymptoms, showHealthScore, healthScoreTransformed]);

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

  const showDots = timeframe <= 7;

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
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: isDesktop ? '20px' : '0',
        paddingTop: isDesktop ? 'calc(60px + env(safe-area-inset-top))' : 'env(safe-area-inset-top)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: isDesktop ? '820px' : 'none',
          background: 'rgba(15,17,21,0.95)',
          borderRadius: isDesktop ? '12px' : '0 0 16px 16px',
          border: '1px solid rgba(139,92,246,0.3)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          maxHeight: isDesktop ? 'calc(100vh - 120px)' : 'calc(100dvh - env(safe-area-inset-top))',
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
        <div style={{ overflowY: 'auto', padding: '12px 16px', paddingBottom: isDesktop ? '12px' : '80px' }}>
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
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: isDesktop ? '20px' : '0',
        paddingTop: isDesktop ? 'calc(60px + env(safe-area-inset-top))' : 'env(safe-area-inset-top)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: isDesktop ? '820px' : 'none',
          background: 'rgba(15,17,21,0.95)',
          borderRadius: isDesktop ? '12px' : '0 0 16px 16px',
          border: '1px solid rgba(99,102,241,0.3)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          maxHeight: isDesktop ? 'calc(100vh - 120px)' : 'calc(100dvh - env(safe-area-inset-top))',
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
        <div style={{ overflowY: 'auto', padding: '12px 16px', paddingBottom: isDesktop ? '12px' : '80px' }}>
          <input
            ref={symSearchRef}
            value={symSearch}
            onChange={(e) => setSymSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); if (symSearch) setSymSearch(''); else setShowSymptomPicker(false); }
              if (e.key === 'Enter') {
                const filtered = activeSymptoms.filter(s => s.name.toLowerCase().includes(symSearch.toLowerCase()) || (s.description || '').toLowerCase().includes(symSearch.toLowerCase()));
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
            const filtered = activeSymptoms.filter(s => !symSearch || s.name.toLowerCase().includes(symSearch.toLowerCase()) || (s.description || '').toLowerCase().includes(symSearch.toLowerCase()));
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
                  flex: 1, minWidth: 0,
                  display: 'flex', flexDirection: 'column',
                }}>
                  <span style={{
                    color: highlighted ? '#e5e7eb' : '#9ca3af',
                    fontSize: '13px', fontWeight: highlighted ? '500' : '400',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {sym.name}
                  </span>
                  {sym.description && (
                    <span style={{
                      color: highlighted ? '#9ca3af' : '#6b7280',
                      fontSize: '11px', fontWeight: '400',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {sym.description}
                    </span>
                  )}
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
      {/* Grid lines — follow primary series scale */}
      {primaryIsSupplement && selectedSupplement ? (
        suppYLabels.map(val => {
          const y = padTop + chartH - (val / suppYMax) * chartH;
          return <line key={val} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke={isDesktop ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.15)"} strokeWidth={(isDesktop ? 0.5 : 0.8) * s} />;
        })
      ) : (
        [0, 1, 2, 3, 4, 5].map(sev => {
          const y = padTop + chartH - (sev / 5) * chartH;
          return <line key={sev} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke={isDesktop ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.15)"} strokeWidth={(isDesktop ? 0.5 : 0.8) * s} />;
        })
      )}

      {/* Axis lines — left and bottom edges (desktop only) */}
      {isDesktop && <>
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + chartH} stroke="rgba(255,255,255,0.2)" strokeWidth={0.7 * s} />
        <line x1={padLeft} y1={padTop + chartH} x2={W - padRight} y2={padTop + chartH} stroke="rgba(255,255,255,0.2)" strokeWidth={0.7 * s} />
      </>}

      {/* Left Y-axis — primary series scale */}
      {primaryIsSupplement && selectedSupplement ? (
        suppYLabels.map(val => {
          const y = padTop + chartH - (val / suppYMax) * chartH;
          return (
            <text key={`l-${val}`} x={padLeft - 6 * s} y={y + 3.5 * s} textAnchor="end"
              fill={isDesktop ? '#6b7280' : '#d1d5db'} fontSize={(isDesktop ? 7 : 12) * s} fontFamily="system-ui" fontWeight={isDesktop ? 'normal' : '600'}>{val}</text>
          );
        })
      ) : (
        [0, 1, 2, 3, 4, 5].map(sev => {
          const y = padTop + chartH - (sev / 5) * chartH;
          return (
            <text key={`l-${sev}`} x={padLeft - 6 * s} y={y + 3.5 * s} textAnchor="end"
              fill={isDesktop ? '#6b7280' : '#d1d5db'} fontSize={(isDesktop ? 7 : 12) * s} fontFamily="system-ui" fontWeight={isDesktop ? 'normal' : '600'}>{sev}</text>
          );
        })
      )}

      {/* Right Y-axis: secondary scale (only when dual-axis mode) */}
      {selectedSupplement && selectedSymptoms.length > 0 && (
        primaryIsSupplement ? (
          [0, 2.5, 5].map(sev => {
            const y = padTop + chartH - (sev / 5) * chartH;
            return (
              <text key={`r-${sev}`} x={W - padRight + 6 * s} y={y + 3.5 * s} textAnchor="start"
                fill={isDesktop ? '#6b7280' : '#9ca3af'} fontSize={(isDesktop ? 7 : 11) * s} fontFamily="system-ui" fontWeight={isDesktop ? 'normal' : '500'}>{sev}</text>
            );
          })
        ) : (
          suppYLabels.map(val => {
            const y = padTop + chartH - (val / suppYMax) * chartH;
            return (
              <text key={`r-${val}`} x={W - padRight + 6 * s} y={y + 3.5 * s} textAnchor="start"
                fill={isDesktop ? '#6b7280' : '#9ca3af'} fontSize={(isDesktop ? 7 : 11) * s} fontFamily="system-ui" fontWeight={isDesktop ? 'normal' : '500'}>{val}</text>
            );
          })
        )
      )}

      {/* X-axis */}
      {xLabels.map((lbl, i) => (
        <text key={i} x={lbl.x} y={H - 6 * s} textAnchor="middle"
          fill={isDesktop ? '#6b7280' : '#d1d5db'} fontSize={(isDesktop ? 7 : 12) * s} fontFamily="system-ui" fontWeight={isDesktop ? 'normal' : '600'}>{lbl.label}</text>
      ))}

      {/* Supplement line */}
      {suppPoints && (
        <g>
          <path d={buildPath(suppPoints)} fill="none" stroke={isDesktop ? SUPP_COLOR : '#a78bfa'} strokeWidth={(isDesktop ? 0.9 : 2.5) * s} strokeLinecap="round" strokeLinejoin="round" opacity={primaryIsSupplement ? (isDesktop ? 0.8 : 1.0) : (isDesktop ? 0.45 : 0.6)} />
          {showDots && primaryIsSupplement && suppPoints.map((pt, i) => (
            pt.y !== null && <circle key={`sd-${i}`} cx={pt.x} cy={pt.y} r={1.8 * s} fill="rgb(15,17,21)" stroke={SUPP_COLOR} strokeWidth={0.8 * s} />
          ))}
        </g>
      )}

      {/* Symptom lines */}
      {symptomPointSets.map((pts, idx) => (
        <g key={`sym-${idx}`}>
          <path d={buildPath(pts)} fill="none" stroke={SYMPTOM_STYLES[idx].color} strokeWidth={(isDesktop ? 1.0 : 2.5) * s} strokeLinecap="round" strokeLinejoin="round" opacity={selectedSymptoms[idx] === primarySeriesId ? (isDesktop ? 0.8 : 1.0) : (isDesktop ? 0.45 : 0.6)} />
          {showDots && selectedSymptoms[idx] === primarySeriesId && pts.map((pt, i) => (
            pt.y !== null && <circle key={`syd-${idx}-${i}`} cx={pt.x} cy={pt.y} r={1.2 * s} fill="rgb(15,17,21)" stroke={SYMPTOM_STYLES[idx].color} strokeWidth={0.7 * s} />
          ))}
        </g>
      ))}

      {/* Health Score line */}
      {healthScorePoints && (
        <path
          d={buildPath(healthScorePoints)}
          fill="none"
          stroke={HEALTH_SCORE_COLOR}
          strokeWidth={(isDesktop ? 1.0 : 2.5) * s}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.8}
        />
      )}

      {/* Level segments: 4 layers — bg boxes, then trend lines, then text */}
      {/* Layer 1: Dark background boxes (behind everything) */}
      {levels.map((level, i) => {
        if (level.average === null) return null;
        if (isDesktop) return null;
        const yMax = primaryIsSupplement ? suppYMax : 5;
        const y = padTop + chartH - (level.average / yMax) * chartH;
        const x1 = padLeft + (level.startIdx / Math.max(1, dates.length - 1)) * chartW;
        const x2 = padLeft + (level.endIdx / Math.max(1, dates.length - 1)) * chartW;
        const xMid = (x1 + x2) / 2;
        const avgLabel = primaryIsSymptom
          ? level.average.toFixed(1)
          : (Number.isInteger(level.average) ? level.average : Math.round(level.average));
        const avgFs = 11 * s;
        const pctFs = 10 * s;
        const hasPct = level.percentChange !== null && Math.abs(level.percentChange) >= 2;
        const pctText = hasPct ? `${level.percentChange > 0 ? '+' : ''}${Math.round(level.percentChange)}%` : null;
        const bgPadX = 5 * s;
        const bgPadY = 3 * s;
        const avgW = String(avgLabel).length * avgFs * 0.65 + bgPadX * 2;
        const avgH = avgFs + bgPadY * 2;
        return (
          <g key={`level-bg-${i}`}>
            <rect x={xMid - avgW / 2} y={y - 6 * s - avgFs - bgPadY} width={avgW} height={avgH} rx={3 * s} fill="rgba(0,0,0,0.50)" />
            {pctText && (() => {
              const pctW = pctText.length * pctFs * 0.6 + bgPadX * 2;
              const pctH = pctFs + bgPadY * 2;
              return <rect x={xMid - pctW / 2} y={y + 13 * s - pctFs - bgPadY} width={pctW} height={pctH} rx={3 * s} fill="rgba(0,0,0,0.50)" />;
            })()}
          </g>
        );
      })}

      {/* Layer 2: Trend lines (on top of bg boxes) */}
      {levels.map((level, i) => {
        if (level.average === null) return null;
        const yMax = primaryIsSupplement ? suppYMax : 5;
        const y = padTop + chartH - (level.average / yMax) * chartH;
        const x1 = padLeft + (level.startIdx / Math.max(1, dates.length - 1)) * chartW;
        const x2 = padLeft + (level.endIdx / Math.max(1, dates.length - 1)) * chartW;
        const color = getLevelColor(level.percentChange, primaryIsSymptom);
        return (
          <line key={`level-line-${i}`} x1={x1} y1={y} x2={x2} y2={y}
            stroke={color} strokeWidth={(isDesktop ? 1.6 : 3.0) * s} strokeLinecap="round" />
        );
      })}

      {/* Layer 3: Text labels only (on top of trend lines) */}
      {levels.map((level, i) => {
        if (level.average === null) return null;
        const yMax = primaryIsSupplement ? suppYMax : 5;
        const y = padTop + chartH - (level.average / yMax) * chartH;
        const x1 = padLeft + (level.startIdx / Math.max(1, dates.length - 1)) * chartW;
        const x2 = padLeft + (level.endIdx / Math.max(1, dates.length - 1)) * chartW;
        const xMid = (x1 + x2) / 2;
        const color = getLevelColor(level.percentChange, primaryIsSymptom);
        const avgLabel = primaryIsSymptom
          ? level.average.toFixed(1)
          : (Number.isInteger(level.average) ? level.average : Math.round(level.average));
        const avgFs = (isDesktop ? 8 : 11) * s;
        const pctFs = (isDesktop ? 7 : 10) * s;
        const hasPct = level.percentChange !== null && Math.abs(level.percentChange) >= 2;
        return (
          <g key={`level-text-${i}`}>
            <text x={xMid} y={y - 6 * s} textAnchor="middle"
              fill={isDesktop ? color : '#fff'} fontSize={avgFs} fontWeight={isDesktop ? '600' : '700'} fontFamily="system-ui">
              {avgLabel}
            </text>
            {hasPct && (
              <text x={xMid} y={y + 13 * s} textAnchor="middle"
                fill={color} fontSize={pctFs} fontWeight={isDesktop ? 'normal' : '600'} fontFamily="system-ui">
                {level.percentChange > 0 ? '+' : ''}{Math.round(level.percentChange)}%
              </text>
            )}
          </g>
        );
      })}

      {/* Crosshair + tooltip */}
      {crosshairData && (
        <>
          <line x1={crosshairData.x} y1={padTop} x2={crosshairData.x} y2={padTop + chartH} stroke="rgba(255,255,255,0.3)" strokeWidth={0.5 * s} />
          {isDesktop && mouseY !== null && (() => {
            const tooltipW = 140 * s;
            const tooltipH = (28 + crosshairData.items.length * 20) * s;
            const flipX = crosshairData.x + tooltipW + 15 * s > W - padRight;
            const tx = flipX ? crosshairData.x - tooltipW - 10 * s : crosshairData.x + 10 * s;
            const ty = Math.max(padTop, Math.min(mouseY - tooltipH / 2, padTop + chartH - tooltipH));
            return (
              <foreignObject x={tx} y={ty} width={tooltipW} height={tooltipH}>
                <div xmlns="http://www.w3.org/1999/xhtml" style={{
                  background: 'rgba(20,22,28,0.95)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: `${6 * s}px`,
                  padding: `${6 * s}px ${8 * s}px`,
                  fontFamily: 'system-ui',
                  pointerEvents: 'none',
                }}>
                  <div style={{ color: '#9ca3af', fontSize: `${7 * s}px`, marginBottom: `${4 * s}px`, fontWeight: '500' }}>
                    {(() => {
                      const d = new Date(dates[touchX] + 'T12:00:00');
                      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    })()}
                  </div>
                  {crosshairData.items.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: `${4 * s}px`, marginTop: `${2 * s}px` }}>
                      <span style={{ width: `${5 * s}px`, height: `${5 * s}px`, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                      <span style={{ color: '#d1d5db', fontSize: `${7 * s}px`, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </span>
                      <span style={{ color: '#f3f4f6', fontSize: `${7.5 * s}px`, fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>
                        {item.val !== null && item.val !== undefined && isFinite(item.val)
                          ? (item.unit === '/5' ? item.val.toFixed(1) : (Number.isInteger(item.val) ? item.val : item.val.toFixed(1)))
                          : '—'}
                      </span>
                      <span style={{ color: '#6b7280', fontSize: `${6 * s}px` }}>{item.unit}</span>
                    </div>
                  ))}
                </div>
              </foreignObject>
            );
          })()}
        </>
      )}
    </>
  );

  // ── Series chips with inline stats (shared between desktop/mobile) ──
  const chipPad = isDesktop ? '10px 12px' : '15px 16px';
  const chipText = isDesktop ? '13px' : '15px';
  const chipUnitText = isDesktop ? '11px' : '12px';
  const chipDot = isDesktop ? '6px' : '8px';
  const chipBorderW = isDesktop ? '1px' : '1.5px';
  const chipRadius = isDesktop ? '8px' : '10px';
  const chipCloseOpacity = isDesktop ? 0.5 : 0.85;
  const chipCloseSize = isDesktop ? '14px' : '18px';
  const chipCloseMargin = isDesktop ? '0' : '4px';
  const addBtnPad = isDesktop ? '10px 12px' : '15px 16px';
  const addBtnText = isDesktop ? '13px' : '14px';
  const addBtnBorderW = isDesktop ? '1px' : '1.5px';
  const seriesChips = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* Supplement chip or + button */}
      {selectedSupplement ? (() => {
        const supp = allSupplements.find(s => s.id === selectedSupplement);
        const isPrimary = selectedSupplement === primarySeriesId;
        const suppLegendItem = legendItems.items.find(it => it.color === SUPP_COLOR);
        const val = suppLegendItem?.val ?? null;
        const pctChange = isPrimary && insightData ? insightData.percentChange : null;
        return (
          <div
            onClick={() => makePrimary(selectedSupplement)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: chipPad, borderRadius: chipRadius,
              background: isPrimary ? 'rgba(139,92,246,0.28)' : 'rgba(139,92,246,0.08)',
              border: isPrimary ? '2px solid rgba(139,92,246,0.6)' : `${chipBorderW} solid rgba(139,92,246,0.35)`,
              cursor: 'pointer',
            }}
          >
            <span style={{ width: chipDot, height: chipDot, borderRadius: '50%', background: SUPP_COLOR, flexShrink: 0 }} />
            <span style={{
              color: isPrimary ? SUPP_COLOR : '#9ca3af',
              fontSize: chipText, fontWeight: isPrimary ? '600' : '400', flex: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {supp?.name}
            </span>
            <span style={{
              color: '#b0b5be', fontSize: chipText,
              fontWeight: '500', fontVariantNumeric: 'tabular-nums', flexShrink: 0,
            }}>
              {val !== null && val !== undefined && isFinite(val)
                ? (Number.isInteger(val) ? val : val.toFixed(1))
                : '--'}
            </span>
            <span style={{ color: '#6b7280', fontSize: chipUnitText, flexShrink: 0 }}>{suppUnit}</span>
            {pctChange !== null && Math.abs(pctChange) >= 2 && (
              <span style={{
                padding: '1px 5px', borderRadius: '4px', fontSize: '9px', fontWeight: '600', flexShrink: 0,
                background: getLevelColor(pctChange, false) === '#34d399' ? 'rgba(52,211,153,0.15)' : 'rgba(212,160,23,0.15)',
                color: getLevelColor(pctChange, false),
                border: `1px solid ${getLevelColor(pctChange, false)}40`,
              }}>
                {pctChange > 0 ? '\u25B2' : '\u25BC'} {Math.abs(Math.round(pctChange))}%
              </span>
            )}
            <span
              onClick={(e) => { e.stopPropagation(); setSelectedSupplement(''); haptic('light'); }}
              style={{ color: SUPP_COLOR, fontSize: chipCloseSize, lineHeight: 1, opacity: chipCloseOpacity, flexShrink: 0, cursor: 'pointer', marginLeft: chipCloseMargin, padding: '4px' }}
            >&times;</span>
          </div>
        );
      })() : (
        <div
          onClick={() => { setShowSupplementPicker(true); haptic('light'); }}
          style={{
            display: 'flex', alignItems: 'center',
            padding: addBtnPad, borderRadius: chipRadius,
            border: `${addBtnBorderW} dashed rgba(139,92,246,0.4)`,
            background: 'transparent',
            color: 'rgba(139,92,246,0.7)', fontSize: addBtnText, fontWeight: '500',
            cursor: 'pointer',
          }}
        >
          + Supplement
        </div>
      )}

      {/* Spacer between supplements and symptoms */}
      <div style={{ height: '4px' }} />

      {/* Symptom chips with stats */}
      {selectedSymptoms.map((symId, idx) => {
        const sym = activeSymptoms.find(s => s.id === symId);
        const st = SYMPTOM_STYLES[idx];
        const isPrimary = symId === primarySeriesId;
        const symLegendItem = legendItems.items.find(it => it.color === st.color);
        const val = symLegendItem?.val ?? null;
        const pctChange = isPrimary && insightData ? insightData.percentChange : null;
        return (
          <div
            key={symId}
            onClick={() => makePrimary(symId)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: chipPad, borderRadius: chipRadius,
              background: isPrimary ? `${st.color}45` : st.chipBg,
              border: isPrimary ? `2px solid ${st.color}90` : `${chipBorderW} solid ${st.chipBorder}`,
              cursor: 'pointer',
            }}
          >
            <span style={{ width: chipDot, height: chipDot, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
            <span style={{
              color: isPrimary ? st.color : '#9ca3af',
              fontSize: chipText, fontWeight: isPrimary ? '600' : '400', flex: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {sym?.name}{sym?.description ? ` (${sym.description})` : ''}
            </span>
            <span style={{
              color: '#b0b5be', fontSize: chipText,
              fontWeight: '500', fontVariantNumeric: 'tabular-nums', flexShrink: 0,
            }}>
              {val !== null && val !== undefined && isFinite(val) ? val.toFixed(1) : '--'}
            </span>
            <span style={{ color: '#6b7280', fontSize: chipUnitText, flexShrink: 0 }}>/5</span>
            {pctChange !== null && Math.abs(pctChange) >= 2 && (
              <span style={{
                padding: '1px 5px', borderRadius: '4px', fontSize: '9px', fontWeight: '600', flexShrink: 0,
                background: getLevelColor(pctChange, true) === '#34d399' ? 'rgba(52,211,153,0.15)' : 'rgba(212,160,23,0.15)',
                color: getLevelColor(pctChange, true),
                border: `1px solid ${getLevelColor(pctChange, true)}40`,
              }}>
                {pctChange > 0 ? '\u25B2' : '\u25BC'} {Math.abs(Math.round(pctChange))}%
              </span>
            )}
            <span
              onClick={(e) => { e.stopPropagation(); removeSymptom(symId); }}
              style={{ color: st.color, fontSize: chipCloseSize, lineHeight: 1, opacity: chipCloseOpacity, flexShrink: 0, cursor: 'pointer', marginLeft: chipCloseMargin, padding: '4px' }}
            >&times;</span>
          </div>
        );
      })}

      {/* + Symptom button (if room) */}
      {selectedSymptoms.length < 3 && (
        <div
          onClick={() => { setShowSymptomPicker(true); haptic('light'); }}
          style={{
            display: 'flex', alignItems: 'center',
            padding: addBtnPad, borderRadius: chipRadius,
            border: `${addBtnBorderW} dashed rgba(251,113,133,0.4)`,
            background: 'transparent',
            color: 'rgba(251,113,133,0.7)', fontSize: addBtnText, fontWeight: '500',
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

      {/* ── Mobile header (above chart card) ── */}
      {!isDesktop && (
        <div style={{ marginBottom: '12px' }}>
          {/* Centered timeframe pills */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
            <div style={{ display: 'flex', gap: '3px', borderRadius: '8px', background: 'rgba(255,255,255,0.06)', padding: '3px' }}>
              {TIMEFRAMES.map(tf => (
                <button key={tf.days} onClick={() => { setTimeframe(tf.days); haptic('light'); }}
                  style={{
                    padding: '8px 18px', fontSize: '18px', borderRadius: '6px',
                    border: 'none', cursor: 'pointer',
                    color: timeframe === tf.days ? '#fff' : '#9ca3af',
                    background: timeframe === tf.days ? 'rgba(255,255,255,0.15)' : 'transparent',
                    fontWeight: timeframe === tf.days ? '600' : '500',
                  }}>
                  {tf.label}
                </button>
              ))}
            </div>
          </div>

          {/* Bold date range navigator */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '14px' }}>
            <button onClick={() => { setStartOffset(prev => Math.min(prev + Math.round(timeframe / 2), maxOffset)); haptic('light'); }}
              disabled={startOffset >= maxOffset}
              style={{ background: 'none', border: 'none', color: startOffset >= maxOffset ? 'rgba(107,114,128,0.3)' : '#e5e7eb', fontSize: '28px', fontWeight: '300', cursor: startOffset >= maxOffset ? 'default' : 'pointer', padding: '4px 8px' }}>{'\u2039'}</button>
            <span style={{ flex: 1, textAlign: 'center', color: '#f3f4f6', fontSize: '17px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{dateWindowLabel}</span>
            <button onClick={() => { setStartOffset(prev => Math.max(prev - Math.round(timeframe / 2), 0)); haptic('light'); }}
              disabled={startOffset === 0}
              style={{ background: 'none', border: 'none', color: startOffset === 0 ? 'rgba(107,114,128,0.3)' : '#e5e7eb', fontSize: '28px', fontWeight: '300', cursor: startOffset === 0 ? 'default' : 'pointer', padding: '4px 8px' }}>{'\u203A'}</button>
          </div>

          {/* Health Score toggle (mobile only — desktop uses card) */}
          <div
            onClick={() => { setShowHealthScore(prev => !prev); haptic('light'); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: chipPad, borderRadius: chipRadius, marginBottom: '6px',
              border: showHealthScore ? `${chipBorderW} solid rgba(16,185,129,0.5)` : `${chipBorderW} dashed rgba(100,100,100,0.5)`,
              background: showHealthScore ? 'rgba(16,185,129,0.12)' : 'transparent',
              cursor: 'pointer',
            }}
          >
            <span style={{ width: chipDot, height: chipDot, borderRadius: '50%', background: showHealthScore ? HEALTH_SCORE_COLOR : '#555', flexShrink: 0 }} />
            <span style={{ color: showHealthScore ? HEALTH_SCORE_COLOR : '#888', fontSize: chipText, fontWeight: showHealthScore ? '600' : '400', flex: 1 }}>
              Health Score
            </span>
          </div>

          {/* Series chips */}
          {seriesChips}
        </div>
      )}

          {/* ── Chart card ── */}
          <div style={{
            ...(isDesktop ? {
              background: 'rgba(15,17,21,0.6)',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
              padding: '14px 14px 10px',
              height: 'calc(95vh - 180px)', minHeight: '300px',
            } : {
              padding: '0',
            }),
            marginBottom: '16px',
          }}>
            {isDesktop ? (
              /* ── Desktop: Legend (left) + Chart (right) ── */
              <div style={{ display: 'flex', gap: '0', height: '100%' }}>
                {/* Legend panel — left side */}
                <div style={{
                  width: '330px', flexShrink: 0,
                  paddingRight: '14px',
                  display: 'flex', flexDirection: 'column',
                  borderRight: '1px solid rgba(255,255,255,0.04)',
                }}>
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
                          padding: '7px 0',
                          flex: 1,
                          borderRadius: '5px', border: 'none',
                          background: timeframe === tf.days ? 'rgba(255,255,255,0.12)' : 'transparent',
                          color: timeframe === tf.days ? '#fff' : '#6b7280',
                          fontSize: '15px', fontWeight: '500', cursor: 'pointer',
                        }}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>

                  {/* Arrow nav row */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0', padding: '4px 0' }}>
                    <button
                      onClick={() => { setStartOffset(prev => Math.min(prev + Math.round(timeframe / 2), maxOffset)); haptic('light'); }}
                      disabled={startOffset >= maxOffset}
                      style={{
                        background: 'none', border: 'none',
                        color: startOffset >= maxOffset ? 'rgba(107,114,128,0.3)' : '#6b7280',
                        fontSize: '24px', cursor: startOffset >= maxOffset ? 'default' : 'pointer',
                        padding: '0 4px',
                      }}
                    >‹</button>
                    <span style={{ flex: 1, textAlign: 'center', color: '#9ca3af', fontSize: '15px', fontWeight: '500', whiteSpace: 'nowrap' }}>
                      {dateWindowLabel}
                    </span>
                    <button
                      onClick={() => { setStartOffset(prev => Math.max(prev - Math.round(timeframe / 2), 0)); haptic('light'); }}
                      disabled={startOffset === 0}
                      style={{
                        background: 'none', border: 'none',
                        color: startOffset === 0 ? 'rgba(107,114,128,0.3)' : '#6b7280',
                        fontSize: '24px', cursor: startOffset === 0 ? 'default' : 'pointer',
                        padding: '0 4px',
                      }}
                    >›</button>
                  </div>

                  {/* Health Score Card */}
                  <div style={{ marginTop: 16 }}>
                    <HealthScoreCard
                      score={healthScore.score}
                      rollingAvg={healthScore.rollingAvg}
                      delta={healthScore.delta}
                      showOnGraph={showHealthScore}
                      onToggleGraph={() => { setShowHealthScore(prev => !prev); haptic('light'); }}
                    />
                  </div>

                  {/* Series chips */}
                  <div style={{ marginTop: 12 }}>
                    {seriesChips}
                  </div>

                  {/* Divider + Insight text */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '20px 0' }} />
                  {insightData && (
                    <div style={{ fontSize: '11px', color: '#9ca3af', lineHeight: '1.6' }}>
                      {insightData.insightSegments.map((seg, i) => seg.color
                        ? <span key={i} style={{ color: seg.color, fontWeight: '600' }}>{seg.text}</span>
                        : seg.text
                      )}
                    </div>
                  )}
                </div>

                {/* SVG chart — right side */}
                <div ref={chartContainerRef} style={{ flex: 1, minWidth: 0, touchAction: 'none', paddingLeft: '6px', height: '100%' }}>
                  <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}
                    onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
                    style={{ display: 'block' }}
                  >
                    {chartSVGContent}
                  </svg>
                </div>
              </div>
            ) : (
              /* ── Mobile: vertical stack ── */
              <div>
                {/* Full-width SVG chart */}
                <div style={{ touchAction: 'none' }}>
                  <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
                    onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
                    onTouchStart={e => { e.preventDefault(); const t = e.touches[0]; setTouchX(getSnappedIndex(t.clientX)); }}
                    onTouchMove={e => { e.preventDefault(); const t = e.touches[0]; setTouchX(getSnappedIndex(t.clientX)); }}
                    onTouchEnd={() => setTouchX(null)}
                    style={{ display: 'block' }}
                  >
                    {chartSVGContent}
                  </svg>
                </div>

                {/* Insight text */}
                {insightData && (
                  <div style={{ marginTop: '14px', fontSize: '15px', color: '#9ca3af', lineHeight: '1.7', padding: '10px 4px' }}>
                    {insightData.insightSegments.map((seg, i) => seg.color
                      ? <span key={i} style={{ color: seg.color, fontWeight: '600' }}>{seg.text}</span>
                      : seg.text
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

    </div>
  );
}
