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
import { computeLevels, computeInsight, getLevelColor } from '../utils/insightHelpers';
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

  // When timeframe changes, keep the window centered on the same date
  const prevTimeframeRef = useRef(timeframe);
  useEffect(() => {
    const prev = prevTimeframeRef.current;
    prevTimeframeRef.current = timeframe;
    if (prev === timeframe) return;
    setStartOffset(old => {
      // Center of old window was at: old + prev/2 days back from today
      // New offset to keep same center: centerOffset - timeframe/2
      const centerOffset = old + prev / 2;
      return Math.max(0, Math.round(centerOffset - timeframe / 2));
    });
  }, [timeframe]);

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
  const padLeft = (isDesktop ? 36 : 32) * s, padRight = 28 * s, padTop = (isDesktop ? 14 : 28) * s, padBottom = (isDesktop ? 22 : 30) * s;
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
  const primarySleepMetric = primaryIsSleep ? SLEEP_METRICS.find(m => m.key === primarySeriesId) : null;
  // higherIsBetter semantics for primary series: symptom→false, supplement→true, sleep→metric.higherIsBetter
  const primaryHigherIsBetter = primaryIsSymptom
    ? false
    : primaryIsSleep
      ? (primarySleepMetric?.higherIsBetter ?? true)
      : true;

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

  // Y-axis max for the primary series (used by level-segment overlays)
  const primaryYMax = primaryIsSleep ? sleepYMax : (primaryIsSupplement ? suppYMax : 5);

  const primaryDailyValues = useMemo(() => {
    const suppIdx = selectedSupplements.indexOf(primarySeriesId);
    if (suppIdx >= 0 && suppDoseSeries[suppIdx]) return suppDoseSeries[suppIdx];
    const symIdx = selectedSymptoms.indexOf(primarySeriesId);
    if (symIdx >= 0 && symptomTransformed[symIdx]) return symptomTransformed[symIdx].smoothed;
    const sleepIdx = selectedSleepMetrics.indexOf(primarySeriesId);
    if (sleepIdx >= 0 && sleepTransformed[sleepIdx]) return sleepTransformed[sleepIdx].smoothed;
    return null;
  }, [primarySeriesId, selectedSupplements, suppDoseSeries, selectedSymptoms, symptomTransformed, selectedSleepMetrics, sleepTransformed]);

  const levels = useMemo(() => {
    if (!primaryDailyValues || primaryIsSupplement) return [];
    return computeLevels(primaryDailyValues, dates, timeframe);
  }, [primaryDailyValues, primaryIsSupplement, dates, timeframe]);

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
    if (!primarySeriesId || (!hasAnySeries && healthScoreVisible)) return null;

    const buildStats = (id, isSymptom) => {
      const isSleep = selectedSleepMetrics.includes(id);
      const sleepMetric = isSleep ? SLEEP_METRICS.find(m => m.key === id) : null;
      let extSeries;
      if (selectedSupplements.includes(id)) {
        extSeries = getSupplementDoseSeries(stackEntries, stackItems, id, extendedDates).map(v => v === null ? 0 : v);
      } else if (isSleep) {
        extSeries = interpolateSmallGaps(getSleepDailySeries(sleepDays, id, extendedDates));
        extSeries = smooth(extSeries, windowSize);
      } else {
        extSeries = interpolateSmallGaps(getSymptomDailySeries(entries, id, extendedDates, trackingMode));
        extSeries = smooth(extSeries, windowSize);
      }
      const mid = extSeries.length / 2;
      const prior = extSeries.slice(0, mid).filter(v => v !== null && v !== undefined);
      const current = extSeries.slice(mid).filter(v => v !== null && v !== undefined);
      const priorAvg = prior.length > 0 ? prior.reduce((s, v) => s + v, 0) / prior.length : 0;
      const currentAvg = current.length > 0 ? current.reduce((s, v) => s + v, 0) / current.length : 0;
      const item = isSymptom
        ? symptoms.find(s => s.id === id)
        : (isSleep ? sleepMetric : stackItems.find(i => i.id === id));
      const unit = isSymptom
        ? '/5'
        : (isSleep ? (sleepMetric?.unit || '') : (item?.unit || 'mg'));
      const name = isSleep ? (sleepMetric?.label || '') : (item?.name || '');
      // higherIsBetter semantics: symptom→false, sleep→metric.higherIsBetter, supplement→true
      const higherIsBetter = isSymptom ? false : (isSleep ? (sleepMetric?.higherIsBetter ?? true) : true);
      return { name, average: currentAvg, priorAverage: priorAvg, unit, higherIsBetter };
    };

    const primaryStats = buildStats(primarySeriesId, primaryIsSymptom);
    const secondaryIds = [...selectedSupplements, ...selectedSymptoms, ...selectedSleepMetrics].filter(id => id && id !== primarySeriesId);
    const secondaryStats = secondaryIds.map(id => buildStats(id, selectedSymptoms.includes(id)));

    const tfLabel = timeframe <= 7 ? 'week' : timeframe <= 30 ? 'month' : '6 months';
    const insight = computeInsight(primaryStats, secondaryStats, { timeframeLabel: tfLabel });
    return insight ? { ...insight, secondaryStats } : null;
  }, [primarySeriesId, primaryIsSymptom, selectedSupplements, selectedSymptoms, selectedSleepMetrics,
      stackEntries, stackItems, entries, symptoms, trackingMode, sleepDays,
      extendedDates, timeframe, windowSize, hasAnySeries, healthScoreVisible]);

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

      {/* Left Y-axis — primary series scale */}
      {healthScoreVisible && (!hasAnySeries || primarySeriesId === '__healthScore__') && hsYRange ? (
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
      {selectedSupplements.length > 0 && selectedSymptoms.length > 0 && (
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
        <text key={i} x={lbl.x} y={H - 6 * s} textAnchor="middle"
          fill={isDesktop ? '#6b7280' : '#9ca3af'} fontSize={(isDesktop ? 7 : 11) * s} fontFamily="inherit" fontWeight={isDesktop ? 'normal' : '500'}>{lbl.label}</text>
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

      {/* Level segments: 4 layers — bg boxes, then trend lines, then text */}
      {/* Layer 1: Dark background boxes (behind everything) */}
      {levels.map((level, i) => {
        if (level.average === null) return null;
        if (isDesktop) return null;
        const y = padTop + chartH - (level.average / primaryYMax) * chartH;
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
        const y = padTop + chartH - (level.average / primaryYMax) * chartH;
        const x1 = padLeft + (level.startIdx / Math.max(1, dates.length - 1)) * chartW;
        const x2 = padLeft + (level.endIdx / Math.max(1, dates.length - 1)) * chartW;
        const color = getLevelColor(level.percentChange, primaryHigherIsBetter);
        return (
          <line key={`level-line-${i}`} x1={x1} y1={y} x2={x2} y2={y}
            stroke={color} strokeWidth={(isDesktop ? 1.6 : 3.0) * s} strokeLinecap="round" />
        );
      })}

      {/* Layer 3: Text labels only (on top of trend lines) */}
      {levels.map((level, i) => {
        if (level.average === null) return null;
        const y = padTop + chartH - (level.average / primaryYMax) * chartH;
        const x1 = padLeft + (level.startIdx / Math.max(1, dates.length - 1)) * chartW;
        const x2 = padLeft + (level.endIdx / Math.max(1, dates.length - 1)) * chartW;
        const xMid = (x1 + x2) / 2;
        const color = getLevelColor(level.percentChange, primaryHigherIsBetter);
        const avgLabel = primaryIsSymptom
          ? level.average.toFixed(1)
          : (Number.isInteger(level.average) ? level.average : Math.round(level.average));
        const avgFs = (isDesktop ? 8 : 11) * s;
        const pctFs = (isDesktop ? 7 : 10) * s;
        const hasPct = level.percentChange !== null && Math.abs(level.percentChange) >= 2;
        return (
          <g key={`level-text-${i}`}>
            <text x={xMid} y={y - 6 * s} textAnchor="middle"
              fill={isDesktop ? color : '#fff'} fontSize={avgFs} fontWeight={isDesktop ? '600' : '700'} fontFamily="inherit">
              {avgLabel}
            </text>
            {hasPct && (
              <text x={xMid} y={y + 13 * s} textAnchor="middle"
                fill={color} fontSize={pctFs} fontWeight={isDesktop ? 'normal' : '600'} fontFamily="inherit">
                {level.percentChange > 0 ? '+' : ''}{Math.round(level.percentChange)}%
              </text>
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
  const seriesRow = ({ id, color, name, val, unit, onRemove }) => (
    <div key={id} className={`is-row${id === primarySeriesId ? ' on' : ''}`} onClick={() => makePrimary(id)}>
      <span className="dot" style={{ background: color }} />
      <span className="name">{name}</span>
      <span className="val">{val}{unit && val !== '--' && <small> {unit}</small>}</span>
      <button className="x" aria-label={`Remove ${name}`} onClick={(e) => { e.stopPropagation(); onRemove(); }}>&times;</button>
    </div>
  );
  const legendVal = (id) => legendItems.items.find(it => it.id === id)?.val ?? null;
  const seriesChips = (
    <div className="is-rows">
      {selectedSupplements.map((suppId, idx) => seriesRow({
        id: suppId,
        color: SUPPLEMENT_STYLES[idx].color,
        name: allSupplements.find(s => s.id === suppId)?.name,
        val: fmtVal(legendVal(suppId)),
        unit: suppItems[idx]?.unit || 'mg',
        onRemove: () => removeSupplement(suppId),
      }))}
      {selectedSupplements.length < 3 && (
        <button className="dn-btn is-add" onClick={() => { setShowSupplementPicker(true); haptic('light'); }}>+ Supplement</button>
      )}

      <div className="is-gap" />

      {selectedSymptoms.map((symId, idx) => {
        const sym = activeSymptoms.find(s => s.id === symId);
        return seriesRow({
          id: symId,
          color: SYMPTOM_STYLES[idx].color,
          name: `${sym?.name ?? ''}${sym?.description ? ` (${sym.description})` : ''}`,
          val: fmtVal(legendVal(symId), true),
          onRemove: () => removeSymptom(symId),
        });
      })}
      {selectedSymptoms.length < 3 && (
        <button className="dn-btn is-add" onClick={() => { setShowSymptomPicker(true); haptic('light'); }}>+ Symptom</button>
      )}

      {SLEEP_ENABLED && (
        <>
          <div className="is-gap" />
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
          {selectedSleepMetrics.length < 3 && (
            <button className="dn-btn is-add" onClick={() => { setShowSleepPicker(true); haptic('light'); }}>+ Sleep</button>
          )}
        </>
      )}
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
    <div className={`is-cap${scrubDate ? ' on' : ''}`}>{scrubDate || `${timeframe}-day average`}</div>
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

  const insightNote = insightData && (
    <div className="is-note">
      {insightData.insightSegments.map((seg, i) => seg.color
        ? <b key={i} style={{ color: seg.color }}>{seg.text}</b>
        : seg.text
      )}
    </div>
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
        <div style={{ display: 'flex', height: 'calc(95vh - 180px)', minHeight: '300px', marginBottom: '16px' }}>
          <div style={{ width: '300px', flexShrink: 0, paddingRight: '20px', borderRight: '1px solid rgba(255,255,255,0.07)', overflowY: 'auto' }}>
            {valuesCaption}
            {healthScoreTile}
            <div className="is-gap" />
            {seriesChips}
            {insightNote}
          </div>
          <div ref={chartContainerRef} style={{ flex: 1, minWidth: 0, touchAction: 'none', paddingLeft: '12px', height: '100%' }}>
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
        <div style={{ marginBottom: '16px' }}>
          <div className="is-mhead">{rangeControls}</div>
          {valuesCaption}
          {healthScoreTile}
          <div className="is-gap" />
          {seriesChips}
          {scrubReadout}
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
          {insightNote}
        </div>
      )}
    </div>
  );
}
