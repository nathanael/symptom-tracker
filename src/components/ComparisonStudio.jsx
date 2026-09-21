import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '../utils/helpers';
import {
  TIMEFRAMES, SMOOTH_WINDOWS,
  interpolateSmallGaps, smooth,
  formatXLabel, getXLabelInterval, buildPath, buildStepPath,
} from '../utils/chartHelpers';
import {
  getSymptomDailySeries,
  getSupplementDoseSeries,
  getHealthScoreSeries,
  getSleepDailySeries,
} from '../utils/correlationHelpers';
import { getProtocolEvents, normalRange, changeEffect, addDays } from '../utils/protocolEvents';
import HealthScoreCompact from './HealthScoreCompact';
import SeriesPicker from './SeriesPicker';
import { useHealthScore } from '../hooks/useHealthScore';
import { useGarminSleep } from '../hooks/useGarminSleep';
import { METRICS as SLEEP_METRICS } from '../utils/sleepMetrics';
import { SLEEP_ENABLED } from '../utils/constants';
import './desktopNav.css';
import './insights.css';

// One hue family per series type; shades tell the (max 3) series of a type apart
const SYMPTOM_STYLES = [{ color: '#ff8a9e' }, { color: '#f472b6' }, { color: '#fecdd3' }];
const SUPPLEMENT_STYLES = [{ color: '#8b5cf6' }, { color: '#a78bfa' }, { color: '#c4b5fd' }];
const SLEEP_STYLES = [{ color: '#22d3ee' }, { color: '#06b6d4' }, { color: '#0ea5e9' }];

const HEALTH_SCORE_COLOR = '#86efac';
const MARKER_COLOR = '#a78bfa'; // protocol changes share the supplements' hue: a marker, not a warning

export default function ComparisonStudio({
  entries,
  symptoms,
  stackItems,
  stackEntries,
  trackingMode,
  isDesktop,
  setStackItems,
  user,
  barSlot,
  focusSymptomId,
}) {
  const { days: sleepDays } = useGarminSleep(SLEEP_ENABLED ? user : null);
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

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
        // Migration: old format stored `supplement` as string, new format uses `supplements` array
        let supplements = [];
        if (Array.isArray(saved.supplements)) {
          supplements = saved.supplements.filter(id => id && (stackItems || []).some(i => i.id === id));
        } else if (saved.supplement && (stackItems || []).some(i => i.id === saved.supplement)) {
          supplements = [saved.supplement];
        }
        const validSymptoms = (saved.symptoms || []).filter(
          id => (symptoms || []).some(s => s.id === id && s.active)
        );
        const validSleep = SLEEP_ENABLED ? (saved.sleepMetrics || []).filter(k => SLEEP_METRICS.some(m => m.key === k)) : [];
        return {
          supplements,
          symptoms: validSymptoms,
          sleepMetrics: validSleep,
          primarySeriesId: saved.primarySeriesId || '',
          showHealthScore: saved.showHealthScore || false,
        };
      }
    } catch {}
    return { supplements: [], symptoms: [], sleepMetrics: [], primarySeriesId: '', showHealthScore: false };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only

  const [selectedSupplements, setSelectedSupplements] = useState(initialSelections.supplements);
  const [selectedSymptoms, setSelectedSymptoms] = useState(initialSelections.symptoms);
  const [selectedSleepMetrics, setSelectedSleepMetrics] = useState(initialSelections.sleepMetrics);
  const [primarySeriesId, setPrimarySeriesId] = useState(initialSelections.primarySeriesId || '');
  const [showSupplementPicker, setShowSupplementPicker] = useState(false);
  const [showSymptomPicker, setShowSymptomPicker] = useState(false);
  const [showSleepPicker, setShowSleepPicker] = useState(false);
  const [showHealthScore, setShowHealthScore] = useState(initialSelections.showHealthScore);
  const [timeframe, setTimeframe] = useState(30);
  const [startOffset, setStartOffset] = useState(0);
  const [touchX, setTouchX] = useState(null);
  const svgRef = useRef(null);
  // Health score shows when user toggles it on, or when no other series are selected
  const hasAnySeries = selectedSupplements.length > 0 || selectedSymptoms.length > 0 || selectedSleepMetrics.length > 0;
  const healthScoreVisible = showHealthScore || !hasAnySeries;

  // Auto-focus search inputs when pickers open

  // Persist selections to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        supplements: selectedSupplements,
        symptoms: selectedSymptoms,
        sleepMetrics: selectedSleepMetrics,
        primarySeriesId,
        showHealthScore,
      }));
    } catch {}
  }, [selectedSupplements, selectedSymptoms, selectedSleepMetrics, primarySeriesId, showHealthScore]);

  // Auto-set primary to first available series when current primary is removed
  useEffect(() => {
    const allIds = [
      ...selectedSupplements, ...selectedSymptoms, ...selectedSleepMetrics,
      ...(showHealthScore ? ['__healthScore__'] : []),
    ].filter(Boolean);
    if (!allIds.includes(primarySeriesId) && allIds.length > 0) {
      setPrimarySeriesId(allIds[0]);
    }
  }, [selectedSupplements, selectedSymptoms, selectedSleepMetrics, primarySeriesId]);

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

  const toggleSupplement = (suppId) => {
    setSelectedSupplements(prev => {
      if (prev.includes(suppId)) return prev.filter(id => id !== suppId);
      if (prev.length >= 3) return prev;
      return [...prev, suppId];
    });
    haptic('light');
  };
  const removeSupplement = (suppId) => {
    setSelectedSupplements(prev => prev.filter(id => id !== suppId));
    haptic('light');
  };

  const toggleSleep = (key) => {
    setSelectedSleepMetrics(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      if (prev.length >= 3) return prev;
      return [...prev, key];
    });
    haptic('light');
  };
  const removeSleep = (key) => {
    setSelectedSleepMetrics(prev => prev.filter(k => k !== key));
    haptic('light');
  };

  const makePrimary = (id) => {
    setPrimarySeriesId(id);
    haptic('light');
  };

  // Opened from a symptom's History button: select that symptom and make it primary
  useEffect(() => {
    if (!focusSymptomId || !activeSymptoms.some(s => s.id === focusSymptomId)) return;
    setSelectedSymptoms(prev => {
      if (prev.includes(focusSymptomId)) return prev;
      return prev.length >= 3 ? [...prev.slice(0, 2), focusSymptomId] : [...prev, focusSymptomId];
    });
    setPrimarySeriesId(focusSymptomId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSymptomId]);

  // startOffset counts back from today to the window's END date, so changing the timeframe
  // keeps the right-hand date anchored and only moves the start.
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

  // Use the end date of the visible window so score updates when navigating
  const windowEndDate = dates.length > 0 ? dates[dates.length - 1] : todayStr;
  const healthScore = useHealthScore(windowEndDate, { symptoms, entries, trackingMode, rollingDays: timeframe });

  const suppItems = useMemo(
    () => selectedSupplements.map(id => stackItems.find(i => i.id === id)),
    [stackItems, selectedSupplements]
  );

  // SVG dimensions
  const H_MOBILE = 418;
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
  // Mobile drops the axis numbers (the scrub readout gives the values), so the plot runs nearly edge to edge
  const padLeft = (isDesktop ? 36 : 6) * s, padRight = (isDesktop ? 28 : 6) * s, padTop = (isDesktop ? 14 : 30) * s, padBottom = (isDesktop ? 22 : 36) * s;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // ── Data pipeline ──

  const windowSize = SMOOTH_WINDOWS[timeframe] || 5;

  // Supplement: raw dose series with outlier capping (one per selected supplement)
  const suppDoseSeries = useMemo(() =>
    selectedSupplements.map(suppId => {
      const raw = getSupplementDoseSeries(stackEntries, stackItems, suppId, dates);
      const valid = raw.filter(v => v !== null && v > 0).sort((a, b) => a - b);
      let capped = raw;
      if (valid.length > 2) {
        const p95 = valid[Math.floor(valid.length * 0.95)];
        const cap = p95 * 3;
        capped = raw.map(v => (v !== null && v > cap) ? cap : v);
      }
      return capped.map(v => v === null ? 0 : v);
    }),
    [selectedSupplements, stackEntries, stackItems, dates]
  );

  // Transformed supplement data (stepped doses, no smoothing — one series per selected supplement)
  const suppTransformedSeries = useMemo(() =>
    suppDoseSeries.map(daily => ({
      values: [...daily], dates: [...dates], labels: [...dates],
    })),
    [suppDoseSeries, dates]
  );

  // Primary supplement index and derived data (used for Y-axis scaling)
  const primarySuppTransformed = useMemo(() => {
    const idx = selectedSupplements.indexOf(primarySeriesId);
    return idx >= 0 ? suppTransformedSeries[idx] : (suppTransformedSeries[0] || null);
  }, [selectedSupplements, primarySeriesId, suppTransformedSeries]);
  const primarySuppItem = useMemo(() => {
    const idx = selectedSupplements.indexOf(primarySeriesId);
    return idx >= 0 ? suppItems[idx] : (suppItems[0] || null);
  }, [selectedSupplements, primarySeriesId, suppItems]);

  // Y-axis range (from primary supplement only)
  const suppYMax = useMemo(() => {
    if (!primarySuppTransformed) return 100;
    const max = Math.max(...primarySuppTransformed.values.filter(v => v !== null && v !== undefined));
    if (!isFinite(max) || max <= 0) return primarySuppItem?.defaultDose || 100;
    const ceiling = Math.ceil(max * 1.1);
    return Math.max(ceiling, primarySuppItem?.defaultDose || 100);
  }, [primarySuppTransformed, primarySuppItem]);

  // Nice-number Y-axis labels
  const suppYLabels = useMemo(() => {
    const range = suppYMax;
    const roughStep = range / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
    const residual = roughStep / mag;
    const niceStep = residual <= 1.5 ? mag : residual <= 3 ? 2 * mag : residual <= 7 ? 5 * mag : 10 * mag;
    const labels = [];
    for (let v = 0; v <= suppYMax; v += niceStep) labels.push(+v.toFixed(2)); // keep fractional steps (0.5, 1, 1.5…) distinct
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

  // Sleep series — daily values for each selected metric
  const sleepDailySeries = useMemo(() =>
    selectedSleepMetrics.map(key => getSleepDailySeries(sleepDays, key, dates)),
    [selectedSleepMetrics, sleepDays, dates]
  );

  const sleepTransformed = useMemo(() =>
    sleepDailySeries.map(daily => {
      const filled = interpolateSmallGaps(daily);
      const smoothed = smooth(filled, windowSize);
      return { raw: filled, smoothed, transformed: { values: smoothed, dates, labels: dates } };
    }),
    [sleepDailySeries, dates, windowSize]
  );

  const healthScoreTransformed = useMemo(() => {
    if (!healthScoreVisible) return null;
    const raw = getHealthScoreSeries(symptoms, entries, dates, trackingMode);
    const filled = interpolateSmallGaps(raw);
    return { values: filled, dates: [...dates], labels: [...dates] };
  }, [healthScoreVisible, symptoms, entries, dates, trackingMode]);

  // Raw (unsmoothed) health score values for touch-inspect — actual day's score
  const hsInspectValues = useMemo(() => {
    if (!healthScoreVisible) return null;
    return getHealthScoreSeries(symptoms, entries, dates, trackingMode);
  }, [healthScoreVisible, symptoms, entries, dates, trackingMode]);

  const hsInspectValue = useMemo(() => {
    if (touchX === null || !hsInspectValues) return null;
    const v = hsInspectValues[touchX];
    return v !== null && v !== undefined ? Math.round(v) : null;
  }, [touchX, hsInspectValues]);

  // Dynamic Y-axis range for health score (rounded to nearest 10)
  const hsYRange = useMemo(() => {
    if (!healthScoreTransformed) return null;
    const valid = healthScoreTransformed.values.filter(v => v !== null);
    if (valid.length === 0) return { min: 0, max: 100 };
    const dataMin = Math.min(...valid);
    const dataMax = Math.max(...valid);
    const yMin = Math.floor(dataMin / 10) * 10;
    const yMax = Math.ceil(dataMax / 10) * 10;
    // Ensure at least 10% range so the chart isn't a flat line
    return { min: yMin, max: Math.max(yMax, yMin + 10) };
  }, [healthScoreTransformed]);

  // ── Level segments & insight data ──

  const primaryIsSymptom = selectedSymptoms.includes(primarySeriesId);
  const primaryIsSupplement = selectedSupplements.includes(primarySeriesId);
  const primaryIsSleep = selectedSleepMetrics.includes(primarySeriesId);
  // Sleep primary Y-axis range
  const primarySleepIdx = selectedSleepMetrics.indexOf(primarySeriesId);
  const primarySleepValues = primarySleepIdx >= 0 ? sleepTransformed[primarySleepIdx]?.transformed.values : null;
  const sleepYMax = useMemo(() => {
    if (!primaryIsSleep || !primarySleepValues) return 100;
    const valid = primarySleepValues.filter(v => v !== null && v !== undefined);
    if (valid.length === 0) return 100;
    const max = Math.max(...valid);
    return Math.ceil(max * 1.1) || 100;
  }, [primaryIsSleep, primarySleepValues]);
  const sleepYLabels = useMemo(() => {
    if (!primaryIsSleep) return [];
    const range = sleepYMax;
    const roughStep = range / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
    const residual = roughStep / mag;
    const niceStep = residual <= 1.5 ? mag : residual <= 3 ? 2 * mag : residual <= 7 ? 5 * mag : 10 * mag;
    const labels = [];
    for (let v = 0; v <= sleepYMax; v += niceStep) labels.push(Math.round(v));
    return labels;
  }, [primaryIsSleep, sleepYMax]);

  // ── The primary symptom's own normal, change vs the previous window, and protocol changes ──

  // Usual range of the primary symptom over the last 90 days, whatever window is on screen
  const normalBand = useMemo(() => {
    if (!primaryIsSymptom) return null;
    const last90 = Array.from({ length: 90 }, (_, i) => addDays(todayStr, i - 89));
    return normalRange(getSymptomDailySeries(entries, primarySeriesId, last90, trackingMode));
  }, [primaryIsSymptom, primarySeriesId, entries, trackingMode, todayStr]);

  const primarySymptomColor = primaryIsSymptom ? SYMPTOM_STYLES[selectedSymptoms.indexOf(primarySeriesId)].color : null;
  const primaryDailyLogged = useMemo(
    () => (primaryIsSymptom ? getSymptomDailySeries(entries, primarySeriesId, dates, trackingMode) : null),
    [primaryIsSymptom, primarySeriesId, entries, dates, trackingMode]
  );

  // Each symptom's change in points against the window before this one (null until both have a few logged days)
  const symptomDeltas = useMemo(() => {
    const prior = Array.from({ length: timeframe }, (_, i) => addDays(dates[0], i - timeframe));
    const avgOf = (symId, ds) => {
      const logged = getSymptomDailySeries(entries, symId, ds, trackingMode).filter(v => v !== null && v !== undefined && v >= 0);
      return logged.length >= 3 ? logged.reduce((a, b) => a + b, 0) / logged.length : null;
    };
    const out = {};
    selectedSymptoms.forEach((symId) => {
      const now = avgOf(symId, dates);
      const before = avgOf(symId, prior);
      out[symId] = now !== null && before !== null ? now - before : null;
    });
    return out;
  }, [selectedSymptoms, entries, dates, timeframe, trackingMode]);

  // Starts, stops and dose changes, one marker per day; the chart shows the ones inside the window
  const allMarkers = useMemo(() => {
    const byDate = new Map();
    getProtocolEvents(stackItems, stackEntries, todayStr).forEach((ev) => {
      if (!byDate.has(ev.date)) byDate.set(ev.date, { date: ev.date, events: [] });
      byDate.get(ev.date).events.push(ev);
    });
    return [...byDate.values()].map(m => ({ ...m, label: m.events.length === 1 ? m.events[0].label : `${m.events.length} changes` }));
  }, [stackItems, stackEntries, todayStr]);
  const protocolMarkers = useMemo(
    () => allMarkers.map(m => ({ ...m, idx: dates.indexOf(m.date) })).filter(m => m.idx >= 0),
    [allMarkers, dates]
  );

  const [pickedMarkerDate, setPickedMarkerDate] = useState(null);
  const activeMarker = protocolMarkers.find(m => m.date === pickedMarkerDate) || protocolMarkers[protocolMarkers.length - 1] || null;

  // Which symptoms clearly moved after the picked change, biggest first. Every active symptom is
  // checked, not just the ones on the chart, and only against stretches free of other changes.
  const markerEffect = useMemo(() => {
    if (!activeMarker) return null;
    const i = allMarkers.findIndex(m => m.date === activeMarker.date);
    const bounds = { prevChange: allMarkers[i - 1]?.date || null, nextChange: allMarkers[i + 1]?.date || null };
    const effects = activeSymptoms.map(sym => ({
      sym,
      ...changeEffect((ds) => getSymptomDailySeries(entries, sym.id, ds, trackingMode), activeMarker.date, todayStr, bounds),
    }));
    const judged = effects.filter(e => e.status === 'ok');
    const movers = judged.filter(e => e.meaningful)
      .sort((a, b) => Math.abs(b.delta) / Math.max(b.noise, 0.5) - Math.abs(a.delta) / Math.max(a.noise, 0.5));
    const status = judged.length > 0 ? 'ok' : effects.some(e => e.status === 'crowded') ? 'crowded' : 'early';
    return { status, movers };
  }, [activeMarker, allMarkers, activeSymptoms, entries, trackingMode, todayStr]);

  // ── Chart points ──

  const suppPointSets = useMemo(() =>
    suppTransformedSeries.map((st, sIdx) => {
      const { values, dates: txDates } = st;
      const maxIdx = Math.max(1, txDates.length - 1);
      // For the primary supplement, use suppYMax directly
      // For secondary supplements, scale proportionally to primary's range
      const isPrimary = selectedSupplements[sIdx] === primarySeriesId;
      const ownMax = (() => {
        const max = Math.max(...values.filter(v => v !== null && v !== undefined));
        if (!isFinite(max) || max <= 0) return suppItems[sIdx]?.defaultDose || 100;
        return Math.ceil(max * 1.1);
      })();
      const scale = isPrimary ? 1 : (ownMax > 0 ? suppYMax / ownMax : 1);

      return values.map((val, i) => {
        const dateIdx = dates.indexOf(txDates[i]);
        const x = dateIdx >= 0
          ? padLeft + (dateIdx / Math.max(1, dates.length - 1)) * chartW
          : padLeft + (i / maxIdx) * chartW;
        const scaledVal = val !== null ? val * scale : null;
        return {
          x,
          y: scaledVal === null ? null : padTop + chartH - (scaledVal / suppYMax) * chartH,
          val, // Keep original value for tooltip
        };
      });
    }),
    [suppTransformedSeries, selectedSupplements, primarySeriesId, suppYMax, suppItems, dates, chartW, chartH, padLeft, padTop]
  );

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

  const sleepPointSets = useMemo(() =>
    sleepTransformed.map((sd, sIdx) => {
      const { values, dates: txDates } = sd.transformed;
      const maxIdx = Math.max(1, txDates.length - 1);
      const isPrimary = selectedSleepMetrics[sIdx] === primarySeriesId;
      const ownMax = (() => {
        const valid = values.filter(v => v !== null && v !== undefined);
        if (valid.length === 0) return 1;
        const max = Math.max(...valid);
        return max > 0 ? Math.ceil(max * 1.1) : 1;
      })();
      const targetMax = primaryIsSleep ? sleepYMax : (primaryIsSupplement ? suppYMax : 5);
      const scale = isPrimary ? 1 : (ownMax > 0 ? targetMax / ownMax : 1);
      return values.map((val, i) => {
        const dateIdx = dates.indexOf(txDates[i]);
        const x = dateIdx >= 0
          ? padLeft + (dateIdx / Math.max(1, dates.length - 1)) * chartW
          : padLeft + (i / maxIdx) * chartW;
        const scaledVal = val !== null ? val * scale : null;
        return {
          x,
          y: scaledVal === null ? null : padTop + chartH - (scaledVal / targetMax) * chartH,
          val,
        };
      });
    }),
    [sleepTransformed, selectedSleepMetrics, primarySeriesId, primaryIsSleep, primaryIsSupplement, sleepYMax, suppYMax, dates, chartW, chartH, padLeft, padTop]
  );

  const healthScorePoints = useMemo(() => {
    if (!healthScoreTransformed || !hsYRange) return null;
    const { min: yMin, max: yMax } = hsYRange;
    const range = yMax - yMin;
    return healthScoreTransformed.values.map((val, i) => ({
      x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
      y: val !== null ? padTop + chartH - ((val - yMin) / range) * chartH : null,
    }));
  }, [healthScoreTransformed, hsYRange, padLeft, chartW, chartH, padTop, dates.length]);

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
    const symptomVals = symptomTransformed.map((sd, idx) => ({
      val: sd.smoothed[touchX],
      color: SYMPTOM_STYLES[idx].color,
      name: (() => { const s = symptoms.find(s => s.id === selectedSymptoms[idx]); return s ? s.name + (s.description ? ` (${s.description})` : '') : undefined; })(),
    }));

    const items = [];
    // Add all selected supplements
    selectedSupplements.forEach((suppId, idx) => {
      const item = suppItems[idx];
      const daily = suppDoseSeries[idx];
      const val = daily ? daily[touchX] : null;
      items.push({
        id: suppId,
        name: item?.name,
        color: SUPPLEMENT_STYLES[idx].color,
        val,
        unit: item?.unit || 'mg',
      });
    });
    // Add all selected symptoms
    selectedSymptoms.forEach((symId, idx) => {
      const sym = symptoms.find(s => s.id === symId);
      items.push({
        id: symId,
        name: sym ? sym.name + (sym.description ? ` (${sym.description})` : '') : undefined,
        color: SYMPTOM_STYLES[idx].color,
        val: symptomVals[idx]?.val ?? null,
        unit: '/5',
      });
    });
    // Add all selected sleep metrics
    selectedSleepMetrics.forEach((key, idx) => {
      const m = SLEEP_METRICS.find(mm => mm.key === key);
      const sd = sleepTransformed[idx];
      const val = sd?.transformed.values[touchX];
      items.push({
        id: key,
        name: m?.label,
        color: SLEEP_STYLES[idx].color,
        val: val ?? null,
        unit: m?.unit || '',
      });
    });
    if (healthScoreVisible && hsInspectValues) {
      const hsVal = hsInspectValues[touchX];
      if (hsVal !== null && hsVal !== undefined) {
        items.push({
          name: 'Health Score',
          color: HEALTH_SCORE_COLOR,
          val: Math.round(hsVal),
          unit: '%',
        });
      }
    }
    const firstSuppPts = suppPointSets[0];
    const x = firstSuppPts ? firstSuppPts[touchX]?.x : padLeft + (touchX / Math.max(1, dates.length - 1)) * chartW;
    return { dateLabel, items, x };
  }, [touchX, dates, suppDoseSeries, suppPointSets, suppItems, selectedSupplements, symptomTransformed, symptoms, selectedSymptoms, selectedSleepMetrics, sleepTransformed, timeframe, chartW, healthScoreVisible, hsInspectValues, padLeft]);

  // Legend: show crosshair values when hovering, averages otherwise
  const legendItems = useMemo(() => {
    if (crosshairData) return crosshairData;
    const avg = (arr) => {
      const valid = arr.filter(v => v !== null);
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };
    const items = [];
    // All selected supplements
    selectedSupplements.forEach((suppId, idx) => {
      const st = suppTransformedSeries[idx];
      const item = suppItems[idx];
      if (st) {
        const vals = st.values.filter(v => v !== null && v > 0);
        const suppAvg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        items.push({ id: suppId, name: item?.name, color: SUPPLEMENT_STYLES[idx].color, val: suppAvg, unit: item?.unit || 'mg' });
      }
    });
    // All selected symptoms
    selectedSymptoms.forEach((symId, idx) => {
      const sd = symptomTransformed[idx];
      if (sd) {
        const sym = symptoms.find(s => s.id === symId);
        items.push({
          id: symId,
          name: sym ? sym.name + (sym.description ? ` (${sym.description})` : '') : undefined,
          color: SYMPTOM_STYLES[idx].color,
          val: avg(sd.smoothed),
          unit: '/5',
        });
      }
    });
    // All selected sleep metrics
    selectedSleepMetrics.forEach((key, idx) => {
      const m = SLEEP_METRICS.find(mm => mm.key === key);
      const sd = sleepTransformed[idx];
      if (sd) {
        items.push({
          id: key,
          name: m?.label,
          color: SLEEP_STYLES[idx].color,
          val: avg(sd.smoothed),
          unit: m?.unit || '',
        });
      }
    });
    if (healthScoreVisible && healthScoreTransformed) {
      const vals = healthScoreTransformed.values.filter(v => v !== null);
      const hsAvg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      items.push({
        name: 'Health Score',
        color: HEALTH_SCORE_COLOR,
        val: hsAvg !== null ? Math.round(hsAvg) : null,
        unit: '%',
      });
    }
    return { dateLabel: 'Average', items, x: null };
  }, [crosshairData, suppTransformedSeries, suppItems, selectedSupplements, symptomTransformed, symptoms, selectedSymptoms, selectedSleepMetrics, sleepTransformed, healthScoreVisible, healthScoreTransformed]);

  // Max offset: based on earliest data point across selected symptoms/supplement/health score
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

    for (const suppId of selectedSupplements) {
      for (const key of Object.keys(stackEntries || {})) {
        if (key.endsWith(`-${suppId}`)) {
          const e = stackEntries[key];
          if (e?.taken) {
            const dateStr = key.slice(0, 10);
            if (!earliest || dateStr < earliest) earliest = dateStr;
          }
        }
      }
    }

    if (sleepDays.length > 0 && selectedSleepMetrics.length > 0) {
      for (const d of sleepDays) {
        if (d.date && (!earliest || d.date < earliest)) earliest = d.date;
      }
    }

    // When health score is visible, use all entry dates for navigation range
    if (healthScoreVisible) {
      for (const key of Object.keys(entries || {})) {
        const e = entries[key];
        if (e?.date && (!earliest || e.date < earliest)) earliest = e.date;
      }
    }

    if (!earliest) return 0;
    const earliestDate = new Date(earliest + 'T12:00:00');
    const totalDays = Math.round((today - earliestDate) / (1000 * 60 * 60 * 24));
    return Math.max(0, totalDays - timeframe);
  }, [selectedSymptoms, selectedSupplements, selectedSleepMetrics, sleepDays, healthScoreVisible, entries, stackEntries, timeframe]);

  // Clamp startOffset when maxOffset shrinks
  useEffect(() => { setStartOffset(prev => Math.min(prev, maxOffset)); }, [maxOffset]);

  // Date window label
  const dateWindowLabel = useMemo(() => {
    if (dates.length === 0) return '';
    const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fmt(dates[0])} — ${fmt(dates[dates.length - 1])}`;
  }, [dates]);

  const showDots = timeframe <= 7;

  // ── Series pickers ──
  const supplementPickerPanel = showSupplementPicker && (
    <SeriesPicker
      title="Supplements" noun="supplements" isDesktop={isDesktop}
      items={allSupplements}
      selectedIds={selectedSupplements}
      colors={SUPPLEMENT_STYLES.map(st => st.color)}
      onToggle={toggleSupplement}
      onClose={() => setShowSupplementPicker(false)}
    />
  );
  const symptomPickerPanel = showSymptomPicker && (
    <SeriesPicker
      title="Symptoms" noun="symptoms" isDesktop={isDesktop}
      items={activeSymptoms}
      selectedIds={selectedSymptoms}
      colors={SYMPTOM_STYLES.map(st => st.color)}
      onToggle={toggleSymptom}
      onClose={() => setShowSymptomPicker(false)}
    />
  );
  const sleepPickerPanel = showSleepPicker && (
    <SeriesPicker
      title="Sleep metrics" noun="sleep metrics" isDesktop={isDesktop}
      items={SLEEP_METRICS.map(m => ({ id: m.key, name: m.label }))}
      selectedIds={selectedSleepMetrics}
      colors={SLEEP_STYLES.map(st => st.color)}
      onToggle={toggleSleep}
      onClose={() => setShowSleepPicker(false)}
      emptyState={sleepDays.length === 0 && (
        <div className="is-pick-empty">No Garmin sleep data connected.<br />Connect Garmin in Settings to see sleep metrics here.</div>
      )}
    />
  );

  // Day under the crosshair, e.g. "Fri, Sep 11"
  const scrubDate = touchX !== null && dates[touchX]
    ? new Date(dates[touchX] + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : null;

  // ── SVG chart content (shared between desktop/mobile) ──
  // Primary series is a solid, full-strength line; everything else is dashed and recedes (dose steps most of all)
  const axisNum = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : v); // keeps 4-digit doses inside the gutter
  const lineProps = (isPrimary, isStep = false) => isPrimary
    ? { strokeWidth: (isDesktop ? 1.3 : 2.5) * s, opacity: 1 }
    : {
        strokeWidth: (isDesktop ? (isStep ? 0.7 : 0.9) : (isStep ? 1.4 : 1.8)) * s,
        strokeDasharray: isStep ? `${3 * s},${3 * s}` : `${6 * s},${4 * s}`,
        opacity: isStep ? 0.4 : 0.55,
      };
  const chartSVGContent = (
    <>
      {/* Grid lines — follow primary series scale */}
      {healthScoreVisible && (!hasAnySeries || primarySeriesId === '__healthScore__') && hsYRange ? (
        (() => {
          const { min: yMin, max: yMax } = hsYRange;
          const step = (yMax - yMin) <= 30 ? 5 : 10;
          const labels = [];
          for (let v = yMin; v <= yMax; v += step) labels.push(v);
          return labels.map(val => {
            const y = padTop + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
            return <line key={val} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth={(isDesktop ? 0.5 : 0.8) * s} />;
          });
        })()
      ) : primaryIsSleep && selectedSleepMetrics.length > 0 ? (
        sleepYLabels.map(val => {
          const y = padTop + chartH - (val / sleepYMax) * chartH;
          return <line key={val} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth={(isDesktop ? 0.5 : 0.8) * s} />;
        })
      ) : primaryIsSupplement && selectedSupplements.length > 0 ? (
        suppYLabels.map(val => {
          const y = padTop + chartH - (val / suppYMax) * chartH;
          return <line key={val} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth={(isDesktop ? 0.5 : 0.8) * s} />;
        })
      ) : (
        [0, 1, 2, 3, 4, 5].map(sev => {
          const y = padTop + chartH - (sev / 5) * chartH;
          return <line key={sev} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="rgba(255,255,255,0.07)" strokeWidth={(isDesktop ? 0.5 : 0.8) * s} />;
        })
      )}

      {/* Axis lines — left and bottom edges (desktop only) */}
      {isDesktop && <>
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + chartH} stroke="rgba(255,255,255,0.12)" strokeWidth={0.5 * s} />
        <line x1={padLeft} y1={padTop + chartH} x2={W - padRight} y2={padTop + chartH} stroke="rgba(255,255,255,0.12)" strokeWidth={0.5 * s} />
      </>}

      {/* Left Y-axis — primary series scale (desktop; mobile keeps just the lines) */}
      {!isDesktop ? null : healthScoreVisible && (!hasAnySeries || primarySeriesId === '__healthScore__') && hsYRange ? (
        (() => {
          const { min: yMin, max: yMax } = hsYRange;
          const step = (yMax - yMin) <= 30 ? 5 : 10;
          const labels = [];
          for (let v = yMin; v <= yMax; v += step) labels.push(v);
          return labels.map(val => {
            const y = padTop + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
            return (
              <text key={`l-${val}`} x={padLeft - 6 * s} y={y + 3.5 * s} textAnchor="end"
                fill={isDesktop ? '#6b7280' : '#9ca3af'} fontSize={(isDesktop ? 7 : 11) * s} fontFamily="inherit" fontWeight={isDesktop ? 'normal' : '500'}>{val}%</text>
            );
          });
        })()
      ) : primaryIsSleep && selectedSleepMetrics.length > 0 ? (
        sleepYLabels.map(val => {
          const y = padTop + chartH - (val / sleepYMax) * chartH;
          return (
            <text key={`l-${val}`} x={padLeft - 6 * s} y={y + 3.5 * s} textAnchor="end"
              fill={isDesktop ? '#6b7280' : '#9ca3af'} fontSize={(isDesktop ? 7 : 11) * s} fontFamily="inherit" fontWeight={isDesktop ? 'normal' : '500'}>{axisNum(val)}</text>
          );
        })
      ) : primaryIsSupplement && selectedSupplements.length > 0 ? (
        suppYLabels.map(val => {
          const y = padTop + chartH - (val / suppYMax) * chartH;
          return (
            <text key={`l-${val}`} x={padLeft - 6 * s} y={y + 3.5 * s} textAnchor="end"
              fill={isDesktop ? '#6b7280' : '#9ca3af'} fontSize={(isDesktop ? 7 : 11) * s} fontFamily="inherit" fontWeight={isDesktop ? 'normal' : '500'}>{axisNum(val)}</text>
          );
        })
      ) : (
        [0, 1, 2, 3, 4, 5].map(sev => {
          const y = padTop + chartH - (sev / 5) * chartH;
          return (
            <text key={`l-${sev}`} x={padLeft - 6 * s} y={y + 3.5 * s} textAnchor="end"
              fill={isDesktop ? '#6b7280' : '#9ca3af'} fontSize={(isDesktop ? 7 : 11) * s} fontFamily="inherit" fontWeight={isDesktop ? 'normal' : '500'}>{sev}</text>
          );
        })
      )}

      {/* Right Y-axis: secondary scale (only when dual-axis mode) */}
      {isDesktop && selectedSupplements.length > 0 && selectedSymptoms.length > 0 && (
        primaryIsSupplement ? (
          [0, 2.5, 5].map((sev, i) => {
            const y = padTop + chartH - (sev / 5) * chartH;
            return (
              <text key={`r-${i}`} x={W - padRight + 6 * s} y={y + 3.5 * s} textAnchor="start"
                fill="#6b7280" fontSize={(isDesktop ? 7 : 11) * s} fontFamily="inherit" fontWeight={isDesktop ? 'normal' : '500'}>{sev}</text>
            );
          })
        ) : (
          suppYLabels.map((val, i) => {
            const y = padTop + chartH - (val / suppYMax) * chartH;
            return (
              <text key={`r-${i}`} x={W - padRight + 6 * s} y={y + 3.5 * s} textAnchor="start"
                fill="#6b7280" fontSize={(isDesktop ? 7 : 11) * s} fontFamily="inherit" fontWeight={isDesktop ? 'normal' : '500'}>{axisNum(val)}</text>
            );
          })
        )
      )}

      {/* X-axis */}
      {xLabels.map((lbl, i) => (
        <text key={i} x={lbl.x} y={H - (isDesktop ? 6 : 10) * s}
          textAnchor={isDesktop ? 'middle' : i === 0 ? 'start' : lbl.x > W - padRight - 20 * s ? 'end' : 'middle'}
          fill={isDesktop ? '#6b7280' : '#9ca3af'} fontSize={(isDesktop ? 7 : 16) * s} fontFamily="inherit" fontWeight={isDesktop ? 'normal' : '500'}>{lbl.label}</text>
      ))}

      {/* The primary symptom's usual range, and what was actually logged each day */}
      {normalBand && (() => {
        const yHi = padTop + chartH - (normalBand.hi / 5) * chartH;
        const yLo = padTop + chartH - (normalBand.lo / 5) * chartH;
        return (
          <g>
            <rect x={padLeft} y={yHi} width={chartW} height={Math.max(0, yLo - yHi)} fill={primarySymptomColor} opacity={0.1} />
            <text x={W - padRight - 4 * s} y={yHi + (isDesktop ? 9 : 19) * s} textAnchor="end" fill="#9ca3af" opacity={0.8}
              fontSize={(isDesktop ? 7 : 15) * s} fontFamily="inherit">your normal</text>
          </g>
        );
      })()}
      {!showDots && primaryDailyLogged && timeframe <= 90 && primaryDailyLogged.map((val, i) => (
        val !== null && val !== undefined && val >= 0 && (
          <circle key={`raw-${i}`} cx={padLeft + (i / Math.max(1, dates.length - 1)) * chartW} cy={padTop + chartH - (val / 5) * chartH}
            r={(isDesktop ? 1.5 : 2.2) * s} fill={primarySymptomColor} opacity={0.45} />
        )
      ))}

      {/* Supplement lines */}
      {suppPointSets.map((pts, idx) => (
        <g key={`supp-${idx}`}>
          <path d={buildStepPath(pts, 4 * s)} fill="none"
            stroke={SUPPLEMENT_STYLES[idx].color}
            strokeLinecap="round" strokeLinejoin="round" {...lineProps(selectedSupplements[idx] === primarySeriesId, true)} />
          {showDots && selectedSupplements[idx] === primarySeriesId && pts.map((pt, i) => (
            pt.y !== null && <circle key={`sd-${idx}-${i}`} cx={pt.x} cy={pt.y} r={1.8 * s}
              fill="rgb(15,17,21)" stroke={SUPPLEMENT_STYLES[idx].color} strokeWidth={0.8 * s} />
          ))}
        </g>
      ))}

      {/* Symptom lines */}
      {symptomPointSets.map((pts, idx) => (
        <g key={`sym-${idx}`}>
          <path d={buildPath(pts)} fill="none" stroke={SYMPTOM_STYLES[idx].color} strokeLinecap="round" strokeLinejoin="round" {...lineProps(selectedSymptoms[idx] === primarySeriesId)} />
          {showDots && selectedSymptoms[idx] === primarySeriesId && pts.map((pt, i) => (
            pt.y !== null && <circle key={`syd-${idx}-${i}`} cx={pt.x} cy={pt.y} r={1.2 * s} fill="rgb(15,17,21)" stroke={SYMPTOM_STYLES[idx].color} strokeWidth={0.7 * s} />
          ))}
        </g>
      ))}

      {/* Sleep lines */}
      {sleepPointSets.map((pts, idx) => (
        <g key={`sleep-${idx}`}>
          <path d={buildPath(pts)} fill="none" stroke={SLEEP_STYLES[idx].color} strokeLinecap="round" strokeLinejoin="round" {...lineProps(selectedSleepMetrics[idx] === primarySeriesId)} />
          {showDots && selectedSleepMetrics[idx] === primarySeriesId && pts.map((pt, i) => (
            pt.y !== null && <circle key={`sld-${idx}-${i}`} cx={pt.x} cy={pt.y} r={1.2 * s} fill="rgb(15,17,21)" stroke={SLEEP_STYLES[idx].color} strokeWidth={0.7 * s} />
          ))}
        </g>
      ))}

      {/* Health Score line */}
      {healthScorePoints && (
        <path
          d={buildPath(healthScorePoints)}
          fill="none"
          stroke={HEALTH_SCORE_COLOR}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...lineProps(primarySeriesId === '__healthScore__' || !hasAnySeries)}
        />
      )}

      {/* Protocol changes: a flag on the time axis; the picked one carries its label */}
      {protocolMarkers.map((m) => {
        const x = padLeft + (m.idx / Math.max(1, dates.length - 1)) * chartW;
        const active = activeMarker?.date === m.date;
        const base = padTop + chartH;
        const flag = (isDesktop ? 3 : 5) * s;
        const nearRight = x > W - padRight - (isDesktop ? 90 : 190) * s;
        return (
          <g key={`pm-${m.date}`} opacity={active ? 1 : 0.45} style={{ cursor: 'pointer' }} onClick={() => { setPickedMarkerDate(m.date); haptic('light'); }}>
            <title>{m.events.map(ev => ev.label).join(', ')}</title>
            <rect x={x - 8 * s} y={padTop} width={16 * s} height={chartH} fill="transparent" />
            <line x1={x} y1={padTop} x2={x} y2={base} stroke={MARKER_COLOR} strokeWidth={(isDesktop ? 0.6 : 1.2) * s} strokeDasharray={`${3 * s},${3 * s}`} />
            <path d={`M${x - flag} ${base} L${x} ${base - flag * 1.4} L${x + flag} ${base} Z`} fill={MARKER_COLOR} />
            {active && !(touchX !== null && !isDesktop) && (
              <text x={nearRight ? x - 4 * s : x + 4 * s} y={padTop - (isDesktop ? 4 : 9) * s} textAnchor={nearRight ? 'end' : 'start'}
                fill={MARKER_COLOR} fontSize={(isDesktop ? 7 : 16) * s} fontFamily="inherit" fontWeight="500">{m.label}</text>
            )}
          </g>
        );
      })}

      {/* Crosshair + tooltip */}
      {crosshairData && (
        <>
          <line x1={crosshairData.x} y1={padTop} x2={crosshairData.x} y2={padTop + chartH} stroke="rgba(255,255,255,0.3)" strokeWidth={(isDesktop ? 0.5 : 1) * s} />
          {!isDesktop && scrubDate && (() => {
            const w = (scrubDate.length * 6.6 + 16) * s, h = 20 * s;
            const x = Math.max(padLeft, Math.min(crosshairData.x - w / 2, W - padRight - w));
            return (
              <g pointerEvents="none">
                <rect x={x} y={padTop - h - 4 * s} width={w} height={h} rx={6 * s} fill="#f3f4f6" />
                <text x={x + w / 2} y={padTop - 4 * s - h / 2 + 4 * s} textAnchor="middle" fill="#08090a" fontSize={11.5 * s} fontWeight="600" fontFamily="inherit">{scrubDate}</text>
              </g>
            );
          })()}
          {isDesktop && mouseY !== null && (() => {
            const tooltipW = 140 * s;
            const tooltipH = (28 + crosshairData.items.length * 20) * s;
            const flipX = crosshairData.x + tooltipW + 15 * s > W - padRight;
            const tx = flipX ? crosshairData.x - tooltipW - 10 * s : crosshairData.x + 10 * s;
            const ty = Math.max(padTop, Math.min(mouseY - tooltipH / 2, padTop + chartH - tooltipH));
            return (
              <foreignObject x={tx} y={ty} width={tooltipW} height={tooltipH}>
                <div xmlns="http://www.w3.org/1999/xhtml" style={{
                  background: '#17191c',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: `${6 * s}px`,
                  padding: `${6 * s}px ${8 * s}px`,
                  fontFamily: 'inherit',
                  pointerEvents: 'none',
                }}>
                  <div style={{ color: '#9ca3af', fontSize: `${7 * s}px`, marginBottom: `${4 * s}px`, fontWeight: '500' }}>
                    {scrubDate}
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

  // ── Series rows with inline stats (shared between desktop/mobile) ──
  const fmtVal = (val, fixed) => (val === null || val === undefined || !isFinite(val))
    ? '--'
    : (fixed ? val.toFixed(1) : (Math.abs(val) >= 10 ? Math.round(val) : +val.toFixed(1))); // 1516 mg, not 1515.8
  // Symptoms: down is good. Under a tenth of a point is "no change".
  const deltaTag = (delta, title) => {
    if (delta === null || delta === undefined) return null;
    const flat = Math.abs(delta) < 0.1;
    return (
      <span className={`delta ${flat ? '' : delta < 0 ? 'good' : 'bad'}`} title={title}>
        {flat ? '–' : `${delta < 0 ? '▼' : '▲'}${Math.abs(delta).toFixed(1)}`}
      </span>
    );
  };
  const seriesRow = ({ id, color, name, val, unit, delta, onRemove }) => (
    <div key={id} className={`${isDesktop ? 'is-row' : 'is-pill'}${id === primarySeriesId ? ' on' : ''}`} onClick={() => makePrimary(id)}>
      <span className="dot" style={{ background: color }} />
      <span className="name">{name}</span>
      <span className="val">{val}{unit && val !== '--' && <small> {unit}</small>}</span>
      {!crosshairData && deltaTag(delta, `vs previous ${timeframe} days`)}
      <button className="x" aria-label={`Remove ${name}`} onClick={(e) => { e.stopPropagation(); onRemove(); }}>&times;</button>
    </div>
  );
  const legendVal = (id) => legendItems.items.find(it => it.id === id)?.val ?? null;
  const addSupplement = selectedSupplements.length < 3 && (
    <button className="dn-btn is-add" onClick={() => { setShowSupplementPicker(true); haptic('light'); }}>+ Supplement</button>
  );
  const addSymptom = selectedSymptoms.length < 3 && (
    <button className="dn-btn is-add" onClick={() => { setShowSymptomPicker(true); haptic('light'); }}>+ Symptom</button>
  );
  const addSleep = SLEEP_ENABLED && selectedSleepMetrics.length < 3 && (
    <button className="dn-btn is-add" onClick={() => { setShowSleepPicker(true); haptic('light'); }}>+ Sleep</button>
  );
  // Desktop: full-width rows with each add button under its own group. Mobile: one wrapping row of pills under the chart, add pills last.
  const seriesChips = (
    <div className={isDesktop ? 'is-rows' : 'is-pills'}>
      {selectedSupplements.map((suppId, idx) => seriesRow({
        id: suppId,
        color: SUPPLEMENT_STYLES[idx].color,
        name: allSupplements.find(s => s.id === suppId)?.name,
        val: fmtVal(legendVal(suppId)),
        unit: suppItems[idx]?.unit || 'mg',
        onRemove: () => removeSupplement(suppId),
      }))}
      {isDesktop && addSupplement}

      {selectedSymptoms.map((symId, idx) => {
        const sym = activeSymptoms.find(s => s.id === symId);
        return seriesRow({
          id: symId,
          color: SYMPTOM_STYLES[idx].color,
          name: `${sym?.name ?? ''}${sym?.description ? ` (${sym.description})` : ''}`,
          val: fmtVal(legendVal(symId), true),
          delta: symptomDeltas[symId],
          onRemove: () => removeSymptom(symId),
        });
      })}
      {isDesktop && addSymptom}

      {SLEEP_ENABLED && (
        <>
          {selectedSleepMetrics.map((metricKey, idx) => {
            const metric = SLEEP_METRICS.find(m => m.key === metricKey);
            return seriesRow({
              id: metricKey,
              color: SLEEP_STYLES[idx].color,
              name: metric?.label,
              val: fmtVal(legendVal(metricKey)),
              unit: metric?.unit || '',
              onRemove: () => removeSleep(metricKey),
            });
          })}
          {isDesktop && addSleep}
        </>
      )}
      {!isDesktop && <>{addSupplement}{addSymptom}{addSleep}</>}
    </div>
  );

  // ── Range controls: timeframe + date window (context bar on desktop, above the chart on mobile) ──
  const stepBack = () => { setStartOffset(prev => Math.min(prev + Math.round(timeframe / 2), maxOffset)); haptic('light'); };
  const stepForward = () => { setStartOffset(prev => Math.max(prev - Math.round(timeframe / 2), 0)); haptic('light'); };
  const rangeControls = (
    <>
      <div className="dn-step">
        <button onClick={stepBack} disabled={startOffset >= maxOffset} aria-label="Earlier"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
        <span className="dn-date">{dateWindowLabel}</span>
        <button onClick={stepForward} disabled={startOffset === 0} aria-label="Later"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg></button>
      </div>
      <div className="dn-seg">
        {TIMEFRAMES.map(tf => (
          <button key={tf.days} className={timeframe === tf.days ? 'on' : ''} onClick={() => { setTimeframe(tf.days); haptic('light'); }}>{tf.label}</button>
        ))}
      </div>
    </>
  );

  const valuesCaption = (
    <div className={`is-cap${scrubDate ? ' on' : ''}`}>{scrubDate || `${timeframe}-day average${selectedSymptoms.length > 0 ? ` · change vs previous ${timeframe}` : ''}`}</div>
  );

  // Mobile: the thumb hides the crosshair, so the day and its values read out above the chart
  const scrubReadout = (
    <div className="is-scrub">
      {scrubDate ? (
        <>
          <b>{scrubDate}</b>
          {crosshairData?.items.map((item, i) => (
            <span key={i}><i style={{ background: item.color }} />{fmtVal(item.val, item.unit === '/5')}{item.unit === '%' ? '%' : ''}</span>
          ))}
        </>
      ) : 'Drag across the chart to read a day'}
    </div>
  );

  // One line under the chart: which symptoms clearly moved after the picked protocol change. With several changes in the window, tapping it steps to the next one.
  const sinceText = activeMarker && (activeMarker.events.length === 1 ? activeMarker.events[0].since : `${activeMarker.events.length} protocol changes`);
  const nextMarker = () => {
    const i = protocolMarkers.findIndex(m => m.date === activeMarker.date);
    setPickedMarkerDate(protocolMarkers[(i + 1) % protocolMarkers.length].date);
    haptic('light');
  };
  const markerIndex = activeMarker ? protocolMarkers.findIndex(m => m.date === activeMarker.date) : -1;
  const markerDay = activeMarker && new Date(activeMarker.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const markerChip = activeMarker && markerEffect && (
    <button className="is-effect" disabled={protocolMarkers.length < 2} onClick={nextMarker}
      aria-label={protocolMarkers.length > 1 ? 'Insights, show the next protocol change' : undefined}
      title="Up to 30 days before the change against up to 30 days since, stopping at any other protocol change. Only clear changes are listed.">
      <span className="body">
        <span className="mark" />
        <span className="txt">
          <span className="head">Insights{protocolMarkers.length > 1 && <small>{markerIndex + 1} of {protocolMarkers.length}</small>}</span>
          <span className="movers">
            {markerEffect.status === 'early' ? <span>Too early to tell</span>
              : markerEffect.status === 'crowded' ? <span>Too close to another change to tell</span>
              : markerEffect.movers.length === 0 ? <span>No clear change in any symptom</span>
              : markerEffect.movers.slice(0, isDesktop ? 3 : 2).map(e => (
                <b key={e.sym.id}>{e.sym.name} {deltaTag(e.delta)}</b>
              ))}
          </span>
          <span className="since">since {sinceText} · {markerDay}</span>
        </span>
      </span>
      {protocolMarkers.length > 1 && <span className="next"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg></span>}
    </button>
  );

  const healthScoreTile = (
    <HealthScoreCompact
      score={null}
      rollingAvg={healthScore.rollingAvg}
      delta={null}
      inspectValue={hsInspectValue}
      showOnGraph={healthScoreVisible}
      onToggleGraph={() => {
        if (healthScoreVisible && primarySeriesId !== '__healthScore__') {
          setPrimarySeriesId('__healthScore__');
        } else if (healthScoreVisible && primarySeriesId === '__healthScore__') {
          setShowHealthScore(false);
        } else {
          setShowHealthScore(true);
          setPrimarySeriesId('__healthScore__');
        }
        haptic('light');
      }}
    />
  );

  // ── Render ──

  return (
    <div className={`is${isDesktop ? ' desktop' : ''}`}>
      {supplementPickerPanel}
      {symptomPickerPanel}
      {sleepPickerPanel}
      {isDesktop && barSlot && createPortal(rangeControls, barSlot)}

      {isDesktop ? (
        /* ── Desktop: series panel (left) + chart (right) ── */
        <div style={{ display: 'flex', height: 'calc(71vh - 135px)', minHeight: '260px', marginBottom: '16px' }}>
          <div style={{ width: '300px', flexShrink: 0, paddingRight: '20px', borderRight: '1px solid rgba(255,255,255,0.07)', overflowY: 'auto' }}>
            {valuesCaption}
            {healthScoreTile}
            <div className="is-gap" />
            {seriesChips}
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingLeft: '12px', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div ref={chartContainerRef} style={{ flex: 1, minHeight: 0, touchAction: 'none' }}>
              <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}
                onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
                style={{ display: 'block' }}
              >
                {chartSVGContent}
              </svg>
            </div>
            {markerChip}
          </div>
        </div>
      ) : (
        /* ── Mobile: vertical stack ── */
        <div style={{ marginBottom: '16px' }}>
          <div className="is-mhead">{rangeControls}</div>
          {valuesCaption}
          {healthScoreTile}
          {markerChip}
          {scrubReadout}
          <div style={{ touchAction: 'none' }}>
            <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
              onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
              onTouchStart={e => { e.preventDefault(); const t = e.touches[0]; setTouchX(getSnappedIndex(t.clientX)); }}
              onTouchMove={e => { e.preventDefault(); const t = e.touches[0]; setTouchX(getSnappedIndex(t.clientX)); }}
              onTouchEnd={() => {
                const near = protocolMarkers.find(m => Math.abs(m.idx - touchX) <= Math.max(1, Math.round(dates.length / 40)));
                if (near) { setPickedMarkerDate(near.date); haptic('light'); }
                setTouchX(null);
              }}
              style={{ display: 'block' }}
            >
              {chartSVGContent}
            </svg>
          </div>
          {seriesChips}
        </div>
      )}
    </div>
  );
}
