# Whoop-Style Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ComparisonStudio's view mode toggles with Whoop-style level segments, insight stats, and simplified navigation.

**Architecture:** New `insightHelpers.js` module handles level computation and insight text generation. `chartHelpers.js` gets updated timeframes and formatting. ComparisonStudio is refactored to remove cumulative/view-mode code and render the new layout with primary series selection.

**Tech Stack:** React, vitest, inline styles (existing pattern)

**Spec:** `docs/superpowers/specs/2026-03-29-whoop-style-insights-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/insightHelpers.js` | Create | `computeLevels`, `computeInsight`, `getLevelColor` |
| `src/utils/__tests__/insightHelpers.test.js` | Create | Unit tests for all three functions |
| `src/utils/chartHelpers.js` | Modify | Update `TIMEFRAMES`, `SMOOTH_WINDOWS`, `formatXLabel`, `getXLabelInterval` |
| `src/components/ComparisonStudio.jsx` | Modify | Remove view modes/cumulative, add levels/insights/primary selection, new layouts |

---

### Task 1: Update chartHelpers.js constants and formatting

**Files:**
- Modify: `src/utils/chartHelpers.js:1-7` (TIMEFRAMES)
- Modify: `src/utils/chartHelpers.js:49` (SMOOTH_WINDOWS)
- Modify: `src/utils/chartHelpers.js:104-119` (formatXLabel, getXLabelInterval)

- [ ] **Step 1: Update TIMEFRAMES**

```js
export const TIMEFRAMES = [
  { label: 'W', days: 7 },
  { label: 'M', days: 30 },
  { label: '6M', days: 180 },
];
```

- [ ] **Step 2: Update SMOOTH_WINDOWS**

```js
export const SMOOTH_WINDOWS = { 7: 1, 30: 3, 180: 10 };
```

- [ ] **Step 3: Update formatXLabel**

```js
export function formatXLabel(dateStr, timeframe) {
  const d = new Date(dateStr + 'T12:00:00');
  if (timeframe <= 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  } else if (timeframe <= 30) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    return d.toLocaleDateString('en-US', { month: 'short' });
  }
}
```

- [ ] **Step 4: Update getXLabelInterval**

```js
export function getXLabelInterval(timeframe) {
  if (timeframe <= 7) return 1;
  if (timeframe <= 30) return 7;
  return 30;
}
```

- [ ] **Step 5: Run existing tests to ensure nothing breaks**

Run: `npx vitest run src/utils/__tests__/doseTransforms.test.js`
Expected: All 22 tests pass (these don't depend on TIMEFRAMES/SMOOTH_WINDOWS)

- [ ] **Step 6: Commit**

```bash
git add src/utils/chartHelpers.js
git commit -m "feat: update chartHelpers for Whoop-style timeframes (W/M/6M)"
```

---

### Task 2: Write failing tests for computeLevels

**Files:**
- Create: `src/utils/__tests__/insightHelpers.test.js`

- [ ] **Step 1: Write tests for computeLevels**

```js
import { describe, it, expect } from 'vitest';
import { computeLevels } from '../insightHelpers';

describe('computeLevels', () => {
  // 7 days of data: Mon Mar 23 to Sun Mar 29, 2026
  const weekDates = [
    '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26',
    '2026-03-27', '2026-03-28', '2026-03-29',
  ];

  it('returns 7 daily segments for W (7-day) timeframe', () => {
    const values = [100, 200, 150, 300, 250, 200, 100];
    const levels = computeLevels(values, weekDates, 7);
    expect(levels).toHaveLength(7);
    expect(levels[0].average).toBe(100);
    expect(levels[1].average).toBe(200);
    expect(levels[0].percentChange).toBeNull();
    expect(levels[1].percentChange).toBeCloseTo(100); // 100 -> 200 = +100%
  });

  it('returns ~4 weekly segments for M (30-day) timeframe', () => {
    // 30 days of constant 500
    const dates = [];
    for (let d = 1; d <= 30; d++) {
      dates.push(`2026-03-${String(d).padStart(2, '0')}`);
    }
    const values = Array(30).fill(500);
    const levels = computeLevels(values, dates, 30);
    expect(levels.length).toBeGreaterThanOrEqual(4);
    expect(levels.length).toBeLessThanOrEqual(5);
    levels.forEach(l => expect(l.average).toBe(500));
  });

  it('returns 6 monthly segments for 6M (180-day) timeframe', () => {
    // 180 days starting Oct 2, 2025
    const dates = [];
    const start = new Date('2025-10-02T12:00:00');
    for (let i = 0; i < 180; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    // Increasing values: month 1 = 100, month 2 = 200, etc.
    const values = dates.map(ds => {
      const monthIdx = parseInt(ds.slice(5, 7)) - 10; // 0-based from Oct
      const adjustedIdx = monthIdx < 0 ? monthIdx + 12 : monthIdx;
      return (adjustedIdx + 1) * 100;
    });
    const levels = computeLevels(values, dates, 180);
    expect(levels).toHaveLength(6);
    expect(levels[0].percentChange).toBeNull();
    expect(levels[1].percentChange).not.toBeNull();
  });

  it('excludes nulls from average calculation', () => {
    const values = [100, null, null, 200, 150, null, 300];
    const levels = computeLevels(values, weekDates, 7);
    expect(levels).toHaveLength(7);
    expect(levels[0].average).toBe(100);
    expect(levels[1].average).toBeNull(); // all-null segment
    expect(levels[3].average).toBe(200);
  });

  it('omits segments with fewer than 2 data points for M/6M', () => {
    // Mon Mar 2 to Tue Mar 31, 2026 = 30 days
    // Week of Mar 30 (Mon) has only 2 days: Mar 30, 31
    // Make those all null except 1 value
    const dates = [];
    for (let d = 2; d <= 31; d++) {
      dates.push(`2026-03-${String(d).padStart(2, '0')}`);
    }
    const values = dates.map((ds) => {
      // Mar 30 = null, Mar 31 = 100 (only 1 non-null in last week)
      if (ds === '2026-03-30') return null;
      if (ds === '2026-03-31') return 100;
      return 500;
    });
    const levels = computeLevels(values, dates, 30);
    // Last week segment (Mar 30-31) should be omitted — only 1 data point
    const lastLevel = levels[levels.length - 1];
    expect(lastLevel.endIdx).toBeLessThan(dates.length - 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/insightHelpers.test.js`
Expected: FAIL — module not found

---

### Task 3: Implement computeLevels

**Files:**
- Create: `src/utils/insightHelpers.js`

- [ ] **Step 1: Implement computeLevels**

```js
/**
 * Divide a daily values series into fixed sub-period levels.
 * W (7) → daily segments, M (30) → weekly, 6M (180) → monthly.
 * Returns array of { startIdx, endIdx, average, percentChange }.
 */
export function computeLevels(values, dates, timeframeDays) {
  const segments = buildSegments(values, dates, timeframeDays);

  let prevAvg = null;
  return segments.map(seg => {
    const nonNull = seg.values.filter(v => v !== null && v !== undefined);

    // For M/6M, omit segments with < 2 data points
    if (timeframeDays > 7 && nonNull.length < 2) {
      return null;
    }

    const average = nonNull.length > 0
      ? nonNull.reduce((s, v) => s + v, 0) / nonNull.length
      : null;

    let percentChange = null;
    if (average !== null && prevAvg !== null && prevAvg !== 0) {
      percentChange = ((average - prevAvg) / Math.abs(prevAvg)) * 100;
    }

    if (average !== null) prevAvg = average;

    return { startIdx: seg.startIdx, endIdx: seg.endIdx, average, percentChange };
  }).filter(Boolean);
}

function buildSegments(values, dates, timeframeDays) {
  if (timeframeDays <= 7) {
    // Daily: one segment per day
    return values.map((v, i) => ({
      startIdx: i,
      endIdx: i,
      values: [v],
    }));
  }

  // Weekly or monthly grouping
  const getKey = timeframeDays <= 30 ? getWeekKey : getMonthKey;
  const segments = [];
  let currentKey = null;
  let currentSeg = null;

  for (let i = 0; i < dates.length; i++) {
    const key = getKey(dates[i]);
    if (key !== currentKey) {
      if (currentSeg) segments.push(currentSeg);
      currentKey = key;
      currentSeg = { startIdx: i, endIdx: i, values: [] };
    }
    currentSeg.endIdx = i;
    currentSeg.values.push(values[i]);
  }
  if (currentSeg) segments.push(currentSeg);

  return segments;
}

function getWeekKey(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/utils/__tests__/insightHelpers.test.js`
Expected: All computeLevels tests pass

- [ ] **Step 3: Commit**

```bash
git add src/utils/insightHelpers.js src/utils/__tests__/insightHelpers.test.js
git commit -m "feat: add computeLevels for Whoop-style level segments"
```

---

### Task 4: Write failing tests for computeInsight and getLevelColor

**Files:**
- Modify: `src/utils/__tests__/insightHelpers.test.js`

- [ ] **Step 1: Add getLevelColor tests**

```js
import { computeLevels, getLevelColor, computeInsight } from '../insightHelpers';

describe('getLevelColor', () => {
  it('returns green for favorable supplement increase', () => {
    expect(getLevelColor(10, false)).toBe('#34d399');
  });

  it('returns yellow for unfavorable supplement decrease', () => {
    expect(getLevelColor(-10, false)).toBe('#d4a017');
  });

  it('returns green for favorable symptom decrease', () => {
    expect(getLevelColor(-10, true)).toBe('#34d399');
  });

  it('returns yellow for unfavorable symptom increase', () => {
    expect(getLevelColor(10, true)).toBe('#d4a017');
  });

  it('returns grey for near-zero change (< 2%)', () => {
    expect(getLevelColor(1.5, false)).toBe('#9ca3af');
    expect(getLevelColor(-0.5, true)).toBe('#9ca3af');
  });

  it('returns grey for null', () => {
    expect(getLevelColor(null, false)).toBe('#9ca3af');
  });
});
```

- [ ] **Step 2: Add computeInsight tests**

```js
describe('computeInsight', () => {
  it('generates insight text for supplement primary', () => {
    const result = computeInsight(
      { name: 'Vitamin D', average: 2000, priorAverage: 1800, unit: 'IU', isSymptom: false },
      [{ name: 'Fatigue', average: 3.2, priorAverage: 3.5, unit: '/5', isSymptom: true }],
      { timeframeLabel: '6 months' }
    );
    expect(result.percentChange).toBeCloseTo(11.1, 0);
    expect(result.insightText).toContain('Vitamin D');
    expect(result.insightText).toContain('2000');
    expect(result.insightText).toContain('above');
    // Should mention favorable correlation
    expect(result.insightText).toContain('favorable');
  });

  it('generates insight text for symptom primary', () => {
    const result = computeInsight(
      { name: 'Fatigue', average: 3.2, priorAverage: 3.5, unit: '/5', isSymptom: true },
      [{ name: 'Vitamin D', average: 2000, priorAverage: 1800, unit: 'IU', isSymptom: false }],
      { timeframeLabel: '6 months' }
    );
    expect(result.percentChange).toBeCloseTo(-8.6, 0);
    expect(result.insightText).toContain('Fatigue');
    expect(result.insightText).toContain('below');
  });

  it('omits correlation when change is < 2%', () => {
    const result = computeInsight(
      { name: 'Vitamin D', average: 2000, priorAverage: 1990, unit: 'IU', isSymptom: false },
      [{ name: 'Fatigue', average: 3.2, priorAverage: 3.19, unit: '/5', isSymptom: true }],
      { timeframeLabel: '6 months' }
    );
    expect(result.insightText).not.toContain('favorable');
  });

  it('handles no secondary series', () => {
    const result = computeInsight(
      { name: 'Vitamin D', average: 2000, priorAverage: 1800, unit: 'IU', isSymptom: false },
      [],
      { timeframeLabel: '6 months' }
    );
    expect(result.insightText).toContain('Vitamin D');
    expect(result.insightText).not.toContain('favorable');
  });

  it('does not mark two symptoms both increasing as favorable', () => {
    const result = computeInsight(
      { name: 'Fatigue', average: 4.0, priorAverage: 3.0, unit: '/5', isSymptom: true },
      [{ name: 'Brain Fog', average: 3.5, priorAverage: 2.5, unit: '/5', isSymptom: true }],
      { timeframeLabel: '6 months' }
    );
    // Both symptoms increasing = unfavorable, should NOT say "favorable"
    expect(result.insightText).not.toContain('favorable');
  });

  it('handles zero priorAverage gracefully', () => {
    const result = computeInsight(
      { name: 'Vitamin D', average: 2000, priorAverage: 0, unit: 'IU', isSymptom: false },
      [],
      { timeframeLabel: '6 months' }
    );
    expect(result.percentChange).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/insightHelpers.test.js`
Expected: FAIL — getLevelColor and computeInsight not exported

---

### Task 5: Implement getLevelColor and computeInsight

**Files:**
- Modify: `src/utils/insightHelpers.js`

- [ ] **Step 1: Implement getLevelColor**

Add to `insightHelpers.js`:

```js
/**
 * Color for a level segment based on whether the change is favorable.
 * Supplements: up = green, down = yellow.
 * Symptoms: down = green, up = yellow.
 * < 2% or null = grey.
 */
export function getLevelColor(percentChange, isSymptom) {
  if (percentChange === null || percentChange === undefined || Math.abs(percentChange) < 2) {
    return '#9ca3af';
  }
  const favorable = isSymptom ? percentChange < 0 : percentChange > 0;
  return favorable ? '#34d399' : '#d4a017';
}
```

- [ ] **Step 2: Implement computeInsight**

Add to `insightHelpers.js`:

```js
/**
 * Generate insight stats and natural language text.
 * primaryStats: { name, average, priorAverage, unit, isSymptom }
 * secondaryStats: array of same shape
 * options: { timeframeLabel }
 * Returns { average, unit, percentChange, priorAverage, insightText }
 */
export function computeInsight(primaryStats, secondaryStats, options) {
  const { name, average, priorAverage, unit, isSymptom } = primaryStats;
  const { timeframeLabel } = options;

  let percentChange = null;
  if (priorAverage && priorAverage !== 0) {
    percentChange = ((average - priorAverage) / Math.abs(priorAverage)) * 100;
  }

  // Build primary sentence
  let insightText = '';
  if (percentChange !== null && Math.abs(percentChange) >= 2) {
    const direction = percentChange > 0 ? 'above' : 'below';
    const pct = Math.abs(Math.round(percentChange));
    const formattedAvg = Number.isInteger(average) ? average : average.toFixed(1);
    const formattedPrior = Number.isInteger(priorAverage) ? priorAverage : priorAverage.toFixed(1);
    insightText = `Your average ${name} (${formattedAvg}${unit === '/5' ? '/5' : ' ' + unit}) was ${pct}% ${direction} your previous ${timeframeLabel} average of ${formattedPrior}.`;
  } else {
    const formattedAvg = Number.isInteger(average) ? average : average.toFixed(1);
    insightText = `Your average ${name} was ${formattedAvg}${unit === '/5' ? '/5' : ' ' + unit} over this period.`;
  }

  // Correlation hints
  const significantSecondaries = secondaryStats.filter(s => {
    if (!s.priorAverage || s.priorAverage === 0) return false;
    const pct = ((s.average - s.priorAverage) / Math.abs(s.priorAverage)) * 100;
    return Math.abs(pct) >= 2;
  });

  if (percentChange !== null && Math.abs(percentChange) >= 2 && significantSecondaries.length > 0) {
    const primaryUp = percentChange > 0;
    const favorablePairs = significantSecondaries.filter(s => {
      const secPct = ((s.average - s.priorAverage) / Math.abs(s.priorAverage)) * 100;
      const secUp = secPct > 0;
      // For supplement-symptom pairs: opposite directions = favorable
      if (isSymptom !== s.isSymptom) {
        return primaryUp !== secUp;
      }
      // Same type: both must be moving in the "good" direction
      // Symptoms: down is good. Supplements: up is good.
      const primaryGood = isSymptom ? !primaryUp : primaryUp;
      const secGood = s.isSymptom ? !secUp : secUp;
      return primaryGood && secGood;
    });

    if (favorablePairs.length > 0) {
      const names = favorablePairs.map(s => {
        const pct = Math.abs(Math.round(((s.average - s.priorAverage) / Math.abs(s.priorAverage)) * 100));
        const dir = s.isSymptom
          ? (s.average < s.priorAverage ? 'down' : 'up')
          : (s.average > s.priorAverage ? 'up' : 'down');
        return `${s.name} ${dir} ${pct}%`;
      });
      insightText += ` ${names.join(', ')} — these trends moved in a favorable direction together.`;
    }
  }

  return { average, unit, percentChange, priorAverage, insightText };
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/utils/__tests__/insightHelpers.test.js`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/utils/insightHelpers.js src/utils/__tests__/insightHelpers.test.js
git commit -m "feat: add computeInsight and getLevelColor helpers"
```

---

### Task 6: Refactor ComparisonStudio — remove view modes and cumulative

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

This task removes dead code. No new features yet.

- [ ] **Step 1: Remove imports and state for cumulative/view modes**

Remove entire import lines:
- `import { aggregateDaily, aggregateWeekly, aggregateMonthly, computeCumulativeLevel, aggregateSymptoms } from '../utils/doseTransforms';` — delete this whole line (none of these are used anymore)
- `import { matchSupplementCategory } from '../utils/supplementLookup';` — delete this whole line
- `formatXLabelWeekly` from the `chartHelpers` import (keep `TIMEFRAMES, SMOOTH_WINDOWS, interpolateSmallGaps, smooth, formatXLabel, getXLabelInterval, buildPath`)

Remove state:
- `viewMode` / `setViewMode`
- `showCategoryPicker` / `setShowCategoryPicker`

Remove:
- `initialSelections` logic for `viewMode`
- `localStorage` persistence of `viewMode`
- `useEffect` that closes category picker on viewMode change
- The `viewModeSelector` function and its entire `cumulativeCategory` block (~lines 448-540)
- All `viewMode` branching in `transformDose`, `suppDoseDaily`, `suppYMax`, `xLabels`, `getSnappedIndex`, `crosshairData`
- The `areaFillPath` computation and its SVG rendering
- The `showDots` logic that references viewMode
- The cumulative category picker JSX in the chart

- [ ] **Step 2: Simplify suppDoseDaily (remove viewMode reference)**

Remove the `viewMode === 'cumulative'` branch. Always map nulls to 0:
```js
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
```

- [ ] **Step 3: Simplify data pipeline to always use daily**

Replace `transformDose` callback with direct daily passthrough:
```js
const suppTransformed = useMemo(() => {
  if (!suppDoseDaily) return null;
  return { values: [...suppDoseDaily], dates: [...dates], labels: [...dates] };
}, [suppDoseDaily, dates]);
```

Replace symptom transform:
```js
const symptomTransformed = useMemo(() =>
  selectedSymptoms.map(symId => {
    const filled = interpolateSmallGaps(getSymptomDailySeries(entries, symId, dates, trackingMode));
    const smoothed = smooth(filled, windowSize);
    return { raw: filled, smoothed, transformed: { values: smoothed, dates, labels: dates } };
  }),
  [selectedSymptoms, entries, dates, trackingMode, windowSize]
);
```

- [ ] **Step 4: Update showDots (no viewMode reference)**

```js
const showDots = timeframe <= 7;
```

- [ ] **Step 5: Simplify xLabels (no weekly/monthly branching)**

```js
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
```

- [ ] **Step 6: Simplify getSnappedIndex and crosshairData (no viewMode branching)**

`getSnappedIndex` — remove the weekly/monthly branch, keep only the daily snap logic.

`crosshairData` — remove the weekly/monthly branch. Always use date index directly.

- [ ] **Step 7: Remove view mode selector JSX from both mobile and desktop layouts**

Desktop: remove the "View" section label and `{viewModeSelector(false)}` from the left panel.
Mobile: remove `{viewModeSelector(true)}` from below the chart.

- [ ] **Step 8: Verify the app still builds**

Run: `npx vite build`
Expected: Build succeeds (may have lint warnings about unused imports, that's fine)

- [ ] **Step 9: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "refactor: remove view modes and cumulative from ComparisonStudio"
```

---

### Task 7: Refactor ComparisonStudio — update timeframes and navigation

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Update default timeframe**

Change initial `timeframe` state from `60` to `180`:
```js
const [timeframe, setTimeframe] = useState(180);
```

- [ ] **Step 2: Update chart dimensions**

```js
const W = 500, H_MOBILE = 400, H_DESKTOP = 420;
// Use in SVG viewBox: isDesktop ? H_DESKTOP : H_MOBILE
```

Update padding/chart area calculations to use the appropriate H.

- [ ] **Step 3: Remove begin/end nav buttons**

In both desktop and mobile layouts, remove the `|<` and `>|` buttons. Keep only the `<` and `>` buttons. Style them as simple chevrons:

```jsx
<button
  onClick={() => { setStartOffset(prev => Math.min(prev + Math.round(timeframe / 2), maxOffset)); haptic('light'); }}
  disabled={startOffset >= maxOffset}
  style={{
    background: 'none', border: 'none',
    color: startOffset >= maxOffset ? 'rgba(107,114,128,0.3)' : '#6b7280',
    fontSize: '18px', cursor: startOffset >= maxOffset ? 'default' : 'pointer',
    padding: '0 4px',
  }}
>‹</button>
```

Same pattern for the `>` button with `setStartOffset(prev => Math.max(prev - Math.round(timeframe / 2), 0))`.

- [ ] **Step 4: Verify build**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "refactor: update timeframes to W/M/6M, simplify navigation"
```

---

### Task 8: Add primary series selection state and localStorage

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Add primarySeriesId state**

```js
const [primarySeriesId, setPrimarySeriesId] = useState(initialSelections.primarySeriesId || '');
```

- [ ] **Step 2: Update initialSelections to load/ignore primarySeriesId**

```js
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
        symptoms: validSymptoms.length > 0 ? validSymptoms : (smartDefaults.symptom ? [smartDefaults.symptom] : []),
        primarySeriesId: saved.primarySeriesId || '',
      };
    }
  } catch {}
  return {
    supplement: '',
    symptoms: smartDefaults.symptom ? [smartDefaults.symptom] : [],
    primarySeriesId: '',
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

- [ ] **Step 3: Update localStorage persistence**

```js
useEffect(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      supplement: selectedSupplement,
      symptoms: selectedSymptoms,
      primarySeriesId,
    }));
  } catch {}
}, [selectedSupplement, selectedSymptoms, primarySeriesId]);
```

- [ ] **Step 4: Auto-set primary when it becomes invalid**

```js
// Default primary to first supplement, fall back to first symptom
useEffect(() => {
  const allIds = [selectedSupplement, ...selectedSymptoms].filter(Boolean);
  if (!allIds.includes(primarySeriesId) && allIds.length > 0) {
    setPrimarySeriesId(allIds[0]);
  }
}, [selectedSupplement, selectedSymptoms, primarySeriesId]);
```

- [ ] **Step 5: Make chips tappable to set primary**

Add a handler:
```js
const makePrimary = (id) => {
  setPrimarySeriesId(id);
  haptic('light');
};
```

Update chip `onClick` — tapping a chip makes it primary, not removes it. The `×` button still removes. Split the click targets:
- Chip body tap → `makePrimary(id)`
- `×` span tap → remove (existing behavior, with `e.stopPropagation()`)

- [ ] **Step 6: Style primary chip differently**

For the primary chip, apply:
```js
const isPrimary = id === primarySeriesId;
// ...
border: isPrimary ? `2px solid ${color}60` : `1px solid ${color}35`,
background: isPrimary ? `${color}20` : `${color}12`,
fontWeight: isPrimary ? '600' : '500',
```

Prefix with `◆ ` when primary.

- [ ] **Step 7: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: add primary series selection with chip interaction"
```

---

### Task 9: Add level segments and insight header to chart

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Import insightHelpers**

```js
import { computeLevels, computeInsight, getLevelColor } from '../utils/insightHelpers';
```

- [ ] **Step 2: Compute levels for primary series**

```js
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
```

- [ ] **Step 3: Compute insight stats**

Generate `2 * timeframe` dates for prior period comparison:

```js
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
    // Get extended series for prior + current
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
  return computeInsight(primaryStats, secondaryStats, { timeframeLabel: tfLabel });
}, [primarySeriesId, primaryIsSymptom, selectedSupplement, selectedSymptoms,
    stackEntries, stackItems, entries, symptoms, trackingMode,
    extendedDates, timeframe, windowSize]);
```

- [ ] **Step 4: Render level segments in SVG**

Add to `chartSVGContent`, after the daily lines and before the crosshair:

```jsx
{/* Level segments */}
{levels.map((level, i) => {
  const yMax = primaryIsSupplement ? suppYMax : 5;
  const y = padTop + chartH - (level.average / yMax) * chartH;
  const x1 = padLeft + (level.startIdx / Math.max(1, dates.length - 1)) * chartW;
  const x2 = padLeft + (level.endIdx / Math.max(1, dates.length - 1)) * chartW;
  const color = getLevelColor(level.percentChange, primaryIsSymptom);
  return (
    <line key={`level-${i}`} x1={x1} y1={y} x2={x2} y2={y}
      stroke={color} strokeWidth="2" />
  );
})}
```

- [ ] **Step 5: Update line opacities**

Primary daily line: opacity 0.4. Non-primary lines: opacity 0.2.

```jsx
{/* Supplement line */}
{suppPoints && (
  <path d={buildPath(suppPoints)} fill="none" stroke={SUPP_COLOR}
    strokeWidth="1.2" strokeLinejoin="round"
    opacity={primaryIsSupplement ? 0.4 : 0.2} />
)}

{/* Symptom lines */}
{symptomPointSets.map((pts, idx) => (
  <path key={`sym-${idx}`} d={buildPath(pts)} fill="none"
    stroke={SYMPTOM_STYLES[idx].color} strokeWidth="1" strokeLinejoin="round"
    opacity={selectedSymptoms[idx] === primarySeriesId ? 0.4 : 0.2} />
))}
```

- [ ] **Step 6: Swap Y-axes based on primary**

When primary is a symptom: left Y-axis = 0-5 severity, right = dose.
When primary is a supplement (or default): left Y-axis = dose, right = 0-5 severity.

This affects three areas:

**a) Grid lines:** Use `primaryIsSymptom` to decide which scale drives the grid:
```jsx
{primaryIsSymptom ? (
  [0, 1, 2, 3, 4, 5].map(sev => {
    const y = padTop + chartH - (sev / 5) * chartH;
    return <line key={sev} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />;
  })
) : (
  suppYLabels.map(val => {
    const y = padTop + chartH - (val / suppYMax) * chartH;
    return <line key={val} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="0.4" />;
  })
)}
```

**b) Left Y-axis labels:** Same logic — primary scale on left:
```jsx
{primaryIsSymptom ? (
  [0, 1, 2, 3, 4, 5].map(sev => /* left-side text at padLeft - 5 */)
) : (
  suppYLabels.map(val => /* left-side text at padLeft - 5 */)
)}
```

**c) Right Y-axis labels (dual-axis only):** Show secondary scale on right when both supplement and symptoms are selected:
```jsx
{selectedSupplement && selectedSymptoms.length > 0 && (
  primaryIsSymptom
    ? suppYLabels.filter((_, i) => i % 2 === 0).map(val => /* right-side text at W - padRight + 5 */)
    : [0, 2.5, 5].map(sev => /* right-side text at W - padRight + 5 */)
)}
```

**d) Point Y calculations:** The existing `suppPoints` and `symptomPointSets` memos already compute Y correctly for their own scales — supplements use `val / suppYMax`, symptoms use `val / 5`. These do NOT need to change. The level segment Y in Step 4 already handles this with `const yMax = primaryIsSupplement ? suppYMax : 5;`.

**e) Crosshair data values:** Update `crosshairData` to display values from both axes correctly regardless of which is primary. The values themselves don't change — only the visual positioning of axis labels changes.

- [ ] **Step 7: Verify build**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: add level segments and insight computation to chart"
```

---

### Task 10: Redesign desktop left panel layout

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Restructure selector rows (desktop)**

Replace the current side-by-side supplement/symptom selectors with stacked rows:

```jsx
{/* Supplement selector row */}
<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
  <span style={{ color: '#9ca3af', fontSize: '12px', width: '80px', flexShrink: 0 }}>Supplement</span>
  <div onClick={() => { setShowSupplementPicker(true); haptic('light'); }}
    style={{
      display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center',
      flex: 1, minHeight: '34px', padding: '4px 10px',
      borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)',
      background: 'rgba(255,255,255,0.04)', cursor: 'pointer',
    }}>
    {/* supplement chip or placeholder */}
  </div>
</div>
{/* Symptom selector row */}
<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
  <span style={{ color: '#9ca3af', fontSize: '12px', width: '80px', flexShrink: 0 }}>Symptoms</span>
  <div onClick={() => { setShowSymptomPicker(true); haptic('light'); }}
    style={{ /* same as above */ }}>
    {/* symptom chips or placeholder */}
  </div>
</div>
```

- [ ] **Step 2: Redesign left panel — stats section**

Replace the old Range/View/Legend sections with:

```jsx
{/* Timeframe pills */}
<div style={{ display: 'flex', borderRadius: '7px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '2px', marginBottom: '10px' }}>
  {TIMEFRAMES.map(tf => (
    <button key={tf.days} onClick={() => { setTimeframe(tf.days); haptic('light'); }}
      style={{
        flex: 1, textAlign: 'center', padding: '3px 0', fontSize: '10px',
        borderRadius: '5px', border: 'none', cursor: 'pointer',
        color: timeframe === tf.days ? '#fff' : '#6b7280',
        background: timeframe === tf.days ? 'rgba(255,255,255,0.12)' : 'transparent',
        fontWeight: timeframe === tf.days ? '500' : '400',
      }}>
      {tf.label}
    </button>
  ))}
</div>

{/* Date nav */}
<div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
  {/* ‹ button */}
  <span style={{ flex: 1, textAlign: 'center', color: '#9ca3af', fontSize: '10px', textTransform: 'uppercase' }}>{dateWindowLabel}</span>
  {/* › button */}
</div>

<div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: '12px' }} />

{/* Stats: minimal list */}
{/* Supplement row (always first) */}
{selectedSupplement && (() => {
  const isPrimary = primarySeriesId === selectedSupplement;
  const avg = /* compute from insightData or suppTransformed */;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px', padding: isPrimary ? '10px 8px' : '8px 0',
      background: isPrimary ? 'rgba(139,92,246,0.08)' : 'transparent',
      borderRadius: isPrimary ? '8px' : '0', margin: isPrimary ? '0 -8px' : '0',
      borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer',
    }} onClick={() => makePrimary(selectedSupplement)}>
      <span style={{ width: isPrimary ? '7px' : '6px', height: isPrimary ? '7px' : '6px', borderRadius: '50%', background: SUPP_COLOR, flexShrink: 0 }} />
      <span style={{ color: isPrimary ? SUPP_COLOR : '#9ca3af', fontSize: isPrimary ? '12px' : '11px', fontWeight: isPrimary ? '600' : '400', flex: 1 }}>{suppItem?.name}</span>
      <span style={{ color: '#e5e7eb', fontSize: isPrimary ? '18px' : '13px', fontWeight: isPrimary ? '700' : '600', fontVariantNumeric: 'tabular-nums' }}>{/* value */}</span>
      <span style={{ color: '#6b7280', fontSize: isPrimary ? '10px' : '9px', width: '20px' }}>{suppUnit}</span>
      {/* % badge */}
    </div>
  );
})()}

{/* Symptom rows */}
{selectedSymptoms.map((symId, idx) => {
  const isPrimary = primarySeriesId === symId;
  const sym = activeSymptoms.find(s => s.id === symId);
  const st = SYMPTOM_STYLES[idx];
  return (
    <div key={symId} style={{
      display: 'flex', alignItems: 'center', gap: '8px', padding: isPrimary ? '10px 8px' : '8px 0',
      background: isPrimary ? `${st.color}14` : 'transparent',
      borderRadius: isPrimary ? '8px' : '0', margin: isPrimary ? '0 -8px' : '0',
      borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer',
    }} onClick={() => makePrimary(symId)}>
      {/* dot, name, value, /5, % badge — same pattern */}
    </div>
  );
})}

<div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '12px 0' }} />

{/* Insight text */}
{insightData && (
  <div style={{ fontSize: '11px', color: '#9ca3af', lineHeight: '1.6' }}>
    {insightData.insightText}
  </div>
)}
```

- [ ] **Step 3: Verify build and visual check**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: redesign desktop left panel with Whoop-style stats"
```

---

### Task 11: Redesign mobile layout

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Update mobile selector rows**

Split into two rows — supplement chips on top, symptom chips below:

```jsx
{/* Supplement row */}
<div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
  {selectedSupplement && /* chip with primary styling */}
  {!selectedSupplement && /* + Supplement dashed chip */}
</div>
{/* Symptom row */}
<div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
  {selectedSymptoms.map(/* chips with primary styling */)}
  {selectedSymptoms.length < 3 && /* + Symptom dashed chip */}
</div>
```

- [ ] **Step 2: Add insight header above chart (mobile)**

```jsx
{insightData && (
  <div style={{ marginBottom: '12px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div>
        <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Average</div>
        <div style={{ fontSize: '24px', fontWeight: '700', color: '#e5e7eb', lineHeight: 1 }}>
          {Number.isInteger(insightData.average) ? insightData.average : insightData.average.toFixed(1)}
          {' '}<span style={{ fontSize: '12px', fontWeight: '400', color: '#6b7280' }}>{insightData.unit === '/5' ? '/5' : insightData.unit}</span>
        </div>
      </div>
      {/* W/M/6M pills */}
    </div>
    {/* % badge */}
    {insightData.percentChange !== null && Math.abs(insightData.percentChange) >= 2 && (
      <div style={{ display: 'inline-flex', marginTop: '6px', padding: '3px 8px', borderRadius: '6px',
        background: getLevelColor(insightData.percentChange, primaryIsSymptom) === '#34d399' ? 'rgba(52,211,153,0.15)' : 'rgba(212,160,23,0.15)',
        border: `1px solid ${getLevelColor(insightData.percentChange, primaryIsSymptom)}40`,
      }}>
        <span style={{ color: getLevelColor(insightData.percentChange, primaryIsSymptom), fontSize: '11px', fontWeight: '600' }}>
          {insightData.percentChange > 0 ? '▲' : '▼'} {Math.abs(Math.round(insightData.percentChange))}% vs. prior {timeframe <= 7 ? 'week' : timeframe <= 30 ? 'month' : '6 months'}
        </span>
      </div>
    )}
    {/* Date nav */}
    {/* Insight text */}
    <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af', lineHeight: '1.5' }}>
      {insightData.insightText}
    </div>
  </div>
)}
```

- [ ] **Step 3: Add mini-insight bars below chart (mobile)**

For each non-primary series, render a compact bar:

```jsx
{[selectedSupplement, ...selectedSymptoms].filter(id => id && id !== primarySeriesId).map((id, i) => {
  const isSymptom = selectedSymptoms.includes(id);
  const item = isSymptom ? symptoms.find(s => s.id === id) : stackItems.find(s => s.id === id);
  const color = isSymptom ? SYMPTOM_STYLES[selectedSymptoms.indexOf(id)].color : SUPP_COLOR;
  // Compute avg and % from insightData secondaries
  return (
    <div key={id} style={{
      marginTop: i === 0 ? '8px' : '4px',
      display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
      background: `${color}0a`, border: `1px solid ${color}26`, borderRadius: '8px',
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: '11px', color: '#9ca3af' }}>
        {item?.name} avg <span style={{ color, fontWeight: '500' }}>{/* value */}</span> · <span style={{ color: '#34d399' }}>{/* arrow + % */}</span> vs prior
      </span>
    </div>
  );
})}
```

- [ ] **Step 4: Remove old mobile stats row and view mode selector**

Delete the `legendItems.items` stats row and `viewModeSelector(true)` from the mobile layout.

- [ ] **Step 5: Verify build**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: redesign mobile layout with insight header and mini-insight bars"
```

---

### Task 12: Run full test suite and manual verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (69 existing + new insightHelpers tests)

- [ ] **Step 2: Manual verification checklist**

Run: `npx vite` and test in browser:

1. W/M/6M timeframe pills work, chart updates
2. Left/right arrows navigate correctly, date range label updates
3. Selecting a supplement shows its data with levels
4. Selecting a symptom and tapping it as primary switches the levels
5. Primary chip shows ◆ prefix and highlighted styling
6. Level segments appear on chart at correct Y positions
7. Insight header shows correct average, % badge, and text
8. Desktop left panel stats show minimal list with background highlight on primary
9. Mobile shows insight header above chart and mini-insight bars below
10. Crosshair still works on hover/touch
11. Removing the primary series falls back to next available

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address manual testing issues"
```
