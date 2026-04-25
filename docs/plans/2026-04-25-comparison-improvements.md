# Comparison Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Three independent improvements to the Insights → Comparison view and the Export panel: (1) supplement series rendered as a stepped line with rounded corners instead of smoothed curve, (2) sleep metrics selectable on the comparison chart, (3) Health Score included in both export paths with a short explainer.

**Architecture:** All work is client-only. New utilities live in `src/utils/` with vitest tests. Component changes are in `src/components/ComparisonStudio.jsx` and `src/components/Insights.jsx`. Export changes are in `src/utils/helpers.js`.

**Tech Stack:** React 18, Vite, Vitest, custom SVG charting (no recharts in ComparisonStudio).

**Design doc:** `docs/plans/2026-04-25-comparison-improvements-design.md`

**Commit + deploy strategy:** small commits during the work without version bumps. One final commit bumps version (`package.json`, `src/components/Settings.jsx`, `src/components/QuickActionsMenu.jsx`) and runs `npm run build && npm run deploy` per CLAUDE.md.

---

## Feature 1: Supplement step-path

### Task 1.1: Add `buildStepPath` test scaffolding

**Files:**
- Create: `src/utils/__tests__/chartHelpers.test.js`

**Step 1: Write the failing tests**

```javascript
import { describe, it, expect } from 'vitest';
import { buildStepPath } from '../chartHelpers';

describe('buildStepPath', () => {
  it('returns empty string for empty input', () => {
    expect(buildStepPath([], 5)).toBe('');
  });

  it('returns single moveto for one point', () => {
    expect(buildStepPath([{ x: 10, y: 20 }], 5)).toBe('M10,20');
  });

  it('draws horizontal line for two equal-y points (no corner needed)', () => {
    const d = buildStepPath([{ x: 0, y: 50 }, { x: 100, y: 50 }], 5);
    expect(d).toBe('M0,50L100,50');
  });

  it('produces step-before path with rounded corners on dose change', () => {
    // Two points with different y — should hold first y until second x, then jump.
    // With radius 10, expect: M0,50 L90,50 Q100,50 100,60 L100,80 (no second corner since path ends)
    const d = buildStepPath([{ x: 0, y: 50 }, { x: 100, y: 80 }], 10);
    expect(d).toBe('M0,50L90,50Q100,50,100,60L100,80');
  });

  it('rounds both elbows when there is a horizontal continuation after the step', () => {
    // Three points: hold at 50, jump to 80 at x=100, hold at 80 to x=200
    // Expect two rounded corners at the elbow (both before-step and after-step)
    const d = buildStepPath([
      { x: 0, y: 50 }, { x: 100, y: 80 }, { x: 200, y: 80 },
    ], 10);
    expect(d).toBe('M0,50L90,50Q100,50,100,60L100,70Q100,80,110,80L200,80');
  });

  it('clamps radius to half the shorter adjacent segment', () => {
    // Adjacent x-spacing is 10 — radius 20 would overshoot. Should clamp to 5.
    const d = buildStepPath([
      { x: 0, y: 50 }, { x: 10, y: 80 }, { x: 20, y: 80 },
    ], 20);
    // Effective radius: min(20, 10/2, 30/2) = 5 for x-axis side; vertical span 30 / 2 = 15 (fine)
    // Pre-corner: x = 10 - 5 = 5; y after corner = 50 + 5 = 55
    // Post-corner: x after corner = 10 + 5 = 15; y before corner = 80 - 5 = 75
    expect(d).toBe('M0,50L5,50Q10,50,10,55L10,75Q10,80,15,80L20,80');
  });

  it('handles downward step (negative y direction)', () => {
    const d = buildStepPath([{ x: 0, y: 80 }, { x: 100, y: 50 }], 10);
    expect(d).toBe('M0,80L90,80Q100,80,100,70L100,50');
  });

  it('breaks path on null y (no segment connection across gaps)', () => {
    const d = buildStepPath([
      { x: 0, y: 50 }, { x: 50, y: null }, { x: 100, y: 80 },
    ], 10);
    expect(d).toBe('M0,50M100,80');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/chartHelpers.test.js`
Expected: FAIL — `buildStepPath` is not exported.

### Task 1.2: Implement `buildStepPath`

**Files:**
- Modify: `src/utils/chartHelpers.js` (append new function after `buildPath`)

**Step 1: Implement**

```javascript
// Build a step-before SVG path with rounded corners at every dose change.
// Holds the previous y until reaching the new x, then jumps to the new y.
// Corners are rounded with quadratic Béziers; radius is clamped per-segment so
// it never overshoots when adjacent segments are short.
export function buildStepPath(points, radius) {
  // Split into contiguous segments (break on null y) — same convention as buildPath.
  const segments = [];
  let seg = [];
  for (const pt of points) {
    if (pt.y === null) {
      if (seg.length) { segments.push(seg); seg = []; }
    } else {
      seg.push(pt);
    }
  }
  if (seg.length) segments.push(seg);

  let d = '';
  for (const pts of segments) {
    if (pts.length === 0) continue;
    d += `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      if (cur.y === prev.y) {
        d += `L${cur.x},${cur.y}`;
        continue;
      }
      // Vertical step at cur.x. Round both corners with radius r, clamped per side.
      const dx = cur.x - prev.x;
      const dyAbs = Math.abs(cur.y - prev.y);
      const next = pts[i + 1];
      const dxNext = next ? next.x - cur.x : Infinity;
      const rPre = Math.min(radius, dx / 2, dyAbs / 2);
      const rPost = Math.min(radius, dxNext / 2, dyAbs / 2);
      const dir = cur.y > prev.y ? 1 : -1;

      // Horizontal segment up to the pre-corner
      d += `L${cur.x - rPre},${prev.y}`;
      // Pre-corner: curve into vertical
      d += `Q${cur.x},${prev.y},${cur.x},${prev.y + dir * rPre}`;
      // Vertical segment up to the post-corner (or all the way to cur.y if no next point)
      if (next && next.y === cur.y) {
        d += `L${cur.x},${cur.y - dir * rPost}`;
        d += `Q${cur.x},${cur.y},${cur.x + rPost},${cur.y}`;
      } else {
        d += `L${cur.x},${cur.y}`;
      }
    }
  }
  return d;
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/chartHelpers.test.js`
Expected: PASS — all 8 tests green.

### Task 1.3: Wire step path into ComparisonStudio

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

**Changes:**

1. Add `buildStepPath` to the existing import from `../utils/chartHelpers`:
   ```javascript
   import {
     TIMEFRAMES, SMOOTH_WINDOWS,
     interpolateSmallGaps, smooth,
     formatXLabel, getXLabelInterval, buildPath, buildStepPath,
   } from '../utils/chartHelpers';
   ```

2. In `suppTransformedSeries` (around line 228), drop the smoothing call:
   ```javascript
   const suppTransformedSeries = useMemo(() =>
     suppDoseSeries.map(daily => ({
       values: [...daily], dates: [...dates], labels: [...dates],
     })),
     [suppDoseSeries, dates]
   );
   ```

3. In the supplement `<path>` block (around line 1002), swap `buildPath(pts)` → `buildStepPath(pts, 12 * s)`:
   ```jsx
   <path d={buildStepPath(pts, 12 * s)} fill="none"
     stroke={SUPPLEMENT_STYLES[idx].color}
     strokeWidth={(isDesktop ? 0.9 : 2.5) * s} strokeLinecap="round" strokeLinejoin="round"
     opacity={selectedSupplements[idx] === primarySeriesId ? (isDesktop ? 0.8 : 1.0) : (isDesktop ? 0.45 : 0.6)} />
   ```

**Verify:**

Run: `npm run dev` and open Comparison view. Pick a supplement with dose history. Confirm: dose plateaus are flat horizontal lines, transitions are vertical with rounded corners, smoothing is gone. Cross-check that symptoms still render as smoothed curves.

### Task 1.4: Commit step-path work

```bash
git add src/utils/chartHelpers.js src/utils/__tests__/chartHelpers.test.js src/components/ComparisonStudio.jsx
git commit -m "$(cat <<'EOF'
feat: render supplements as stepped line with rounded corners

Supplements are dose-stepped data, not continuous — the cubic spline
plus rolling-average smoothing was misleading. Now drawn as step-before
path with 12px rounded elbows on every dose change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Feature 2: Sleep section in Comparison

### Task 2.1: Add `getSleepDailySeries` test

**Files:**
- Modify: `src/utils/__tests__/healthScore.test.js` is the wrong file — create a new test file:
- Create: `src/utils/__tests__/correlationHelpers.test.js` (only if it doesn't already exist; check first with `ls src/utils/__tests__/`)

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { getSleepDailySeries } from '../correlationHelpers';

describe('getSleepDailySeries', () => {
  const days = [
    { date: '2026-04-23', sleepScore: 85, deepSleepSeconds: 3600, lightSleepSeconds: 7200, remSleepSeconds: 5400 },
    { date: '2026-04-24', sleepScore: 72, deepSleepSeconds: 1800, lightSleepSeconds: 9000, remSleepSeconds: 4200 },
    // 2026-04-25 missing on purpose
  ];

  it('returns null for missing dates', () => {
    expect(getSleepDailySeries(days, 'sleepScore', ['2026-04-25'])).toEqual([null]);
  });

  it('returns the metric value for present dates', () => {
    expect(getSleepDailySeries(days, 'sleepScore', ['2026-04-23', '2026-04-24', '2026-04-25']))
      .toEqual([85, 72, null]);
  });

  it('applies metric.transform (e.g., REM seconds → minutes)', () => {
    expect(getSleepDailySeries(days, 'remSleepSeconds', ['2026-04-23', '2026-04-24']))
      .toEqual([90, 70]);
  });

  it('applies metric.compute (e.g., total duration)', () => {
    // duration = (deep + light + rem) / 60
    // 2026-04-23: (3600 + 7200 + 5400)/60 = 270
    // 2026-04-24: (1800 + 9000 + 4200)/60 = 250
    expect(getSleepDailySeries(days, 'duration', ['2026-04-23', '2026-04-24']))
      .toEqual([270, 250]);
  });

  it('returns null array when days is empty', () => {
    expect(getSleepDailySeries([], 'sleepScore', ['2026-04-23', '2026-04-24']))
      .toEqual([null, null]);
  });

  it('returns null for unknown metric key', () => {
    expect(getSleepDailySeries(days, 'nope', ['2026-04-23'])).toEqual([null]);
  });
});
```

**Step 2: Verify it fails**

Run: `npx vitest run src/utils/__tests__/correlationHelpers.test.js`
Expected: FAIL — `getSleepDailySeries` not exported.

### Task 2.2: Move `METRICS` and `valueForRow` to a shared module

**Files:**
- Create: `src/utils/sleepMetrics.js` (extract from `SleepAnalyzer.jsx`)
- Modify: `src/components/SleepAnalyzer.jsx` (import from new module instead of defining inline)

**Reason:** `correlationHelpers.js` cannot import from a `.jsx` component file without dragging in React. Move the pure data shape into utils.

**Step 1: Create the shared module**

```javascript
// src/utils/sleepMetrics.js
export const METRICS = [
  { key: 'sleepScore',       label: 'Score',  unit: '', higherIsBetter: true },
  { key: 'duration',         label: 'Time',   unit: 'min', higherIsBetter: true,
    compute: d => {
      const total = (d.deepSleepSeconds || 0) + (d.lightSleepSeconds || 0) + (d.remSleepSeconds || 0);
      return total ? Math.round(total / 60) : null;
    } },
  { key: 'remSleepSeconds',  label: 'REM',    unit: 'min', higherIsBetter: true,
    transform: v => Math.round(v / 60),
    refs: [{ y: 60, color: '#ef4444' }, { y: 90, color: '#10b981' }] },
  { key: 'deepSleepSeconds', label: 'Deep',   unit: 'min', higherIsBetter: true,
    transform: v => Math.round(v / 60),
    refs: [{ y: 60, color: '#f59e0b' }] },
  { key: 'averageRespiration', label: 'Resp', unit: 'brpm', higherIsBetter: false },
  { key: 'lowestSpo2',       label: 'SpO2',   unit: '%', higherIsBetter: true },
  { key: 'avgSleepStress',   label: 'Stress', unit: '', higherIsBetter: false },
  { key: 'hrvOvernight',     label: 'HRV',    unit: 'ms', higherIsBetter: true },
];

export function valueForRow(metric, row) {
  if (!row) return null;
  if (metric.compute) return metric.compute(row);
  const raw = row[metric.key];
  if (raw == null) return null;
  return metric.transform ? metric.transform(raw) : raw;
}
```

**Step 2: Update `SleepAnalyzer.jsx`**

Replace the inline `METRICS` array and `valueForRow` function (lines 29–54) with:
```javascript
import { METRICS, valueForRow } from '../utils/sleepMetrics';
export { METRICS, valueForRow };  // keep existing import sites working
```

**Step 3: Verify tests still pass**

Run: `npx vitest run`
Expected: existing sleep-related tests still pass.

### Task 2.3: Implement `getSleepDailySeries`

**Files:**
- Modify: `src/utils/correlationHelpers.js`

**Step 1: Add at end of file**

```javascript
import { METRICS, valueForRow } from './sleepMetrics';

export function getSleepDailySeries(days, metricKey, dates) {
  const metric = METRICS.find(m => m.key === metricKey);
  if (!metric) return dates.map(() => null);
  const byDate = new Map();
  for (const d of days) byDate.set(d.date, d);
  return dates.map(date => {
    const row = byDate.get(date);
    if (!row) return null;
    const v = valueForRow(metric, row);
    return v == null ? null : v;
  });
}
```

**Step 2: Run tests**

Run: `npx vitest run src/utils/__tests__/correlationHelpers.test.js`
Expected: PASS.

### Task 2.4: Pass `user` from Insights to ComparisonStudio

**Files:**
- Modify: `src/components/Insights.jsx`

In the `<ComparisonStudio>` JSX (around line 51), add `user={user}`.

### Task 2.5: Add sleep state, palette, and chip section to ComparisonStudio

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

**Changes (apply in order):**

1. Add to imports:
   ```javascript
   import { useGarminSleep } from '../hooks/useGarminSleep';
   import { METRICS as SLEEP_METRICS } from '../utils/sleepMetrics';
   import { getSleepDailySeries } from '../utils/correlationHelpers';
   ```

2. Add `user` to props destructuring:
   ```javascript
   export default function ComparisonStudio({
     entries, symptoms, stackItems, stackEntries, trackingMode, isDesktop, setStackItems, user,
   }) {
   ```

3. Add a `SLEEP_STYLES` palette below the existing `SUPPLEMENT_STYLES`:
   ```javascript
   const SLEEP_STYLES = [
     { color: '#22d3ee', chipBg: 'rgba(34,211,238,0.12)', chipBorder: 'rgba(34,211,238,0.35)' },
     { color: '#06b6d4', chipBg: 'rgba(6,182,212,0.12)', chipBorder: 'rgba(6,182,212,0.35)' },
     { color: '#0ea5e9', chipBg: 'rgba(14,165,233,0.12)', chipBorder: 'rgba(14,165,233,0.35)' },
   ];
   const SLEEP_BORDER_RGBA = 'rgba(34,211,238,0.4)';
   ```

4. Below `useGarminSleep` is normally consumed via the hook — call it inside the component:
   ```javascript
   const { days: sleepDays } = useGarminSleep(user);
   ```

5. Update the `initialSelections` migration to include sleep:
   ```javascript
   const validSleep = (saved.sleepMetrics || []).filter(k => SLEEP_METRICS.some(m => m.key === k));
   return {
     supplements,
     symptoms: validSymptoms,
     sleepMetrics: validSleep,
     primarySeriesId: saved.primarySeriesId || '',
   };
   ```
   Default branch: `return { supplements: [], symptoms: [], sleepMetrics: [], primarySeriesId: '' };`

6. Add new state:
   ```javascript
   const [selectedSleepMetrics, setSelectedSleepMetrics] = useState(initialSelections.sleepMetrics);
   const [showSleepPicker, setShowSleepPicker] = useState(false);
   const [sleepSearch, setSleepSearch] = useState('');
   const sleepSearchRef = useRef(null);
   useEffect(() => { if (showSleepPicker) { setSleepSearch(''); setTimeout(() => sleepSearchRef.current?.focus(), 50); } }, [showSleepPicker]);
   ```

7. Update the localStorage `useEffect` to persist `sleepMetrics`:
   ```javascript
   localStorage.setItem(STORAGE_KEY, JSON.stringify({
     supplements: selectedSupplements,
     symptoms: selectedSymptoms,
     sleepMetrics: selectedSleepMetrics,
     primarySeriesId,
   }));
   ```
   Add `selectedSleepMetrics` to the dep array.

8. Update the auto-primary `useEffect` to include sleep:
   ```javascript
   const allIds = [...selectedSupplements, ...selectedSymptoms, ...selectedSleepMetrics].filter(Boolean);
   ```
   Add `selectedSleepMetrics` to the dep array.

9. Add toggle/remove handlers (mirror `toggleSymptom`):
   ```javascript
   const toggleSleep = (key) => {
     setSelectedSleepMetrics(prev => {
       if (prev.includes(key)) return prev.filter(k => k !== key);
       if (prev.length >= 3) return prev;
       return [...prev, key];
     });
     haptic('light');
   };
   const removeSleep = (key) => { setSelectedSleepMetrics(prev => prev.filter(k => k !== key)); haptic('light'); };
   ```

10. Update `showHealthScore` to include sleep:
    ```javascript
    const showHealthScore = selectedSupplements.length === 0 && selectedSymptoms.length === 0 && selectedSleepMetrics.length === 0;
    ```

11. Add sleep series data pipeline (after the symptom transformed series block, ~line 275):
    ```javascript
    const sleepDailySeries = useMemo(() =>
      selectedSleepMetrics.map(key => getSleepDailySeries(sleepDays, key, dates)),
      [selectedSleepMetrics, sleepDays, dates]
    );

    const sleepTransformed = useMemo(() =>
      sleepDailySeries.map((daily, i) => {
        const filled = interpolateSmallGaps(daily);
        const smoothed = smooth(filled, windowSize);
        return { raw: filled, smoothed, transformed: { values: smoothed, dates, labels: dates } };
      }),
      [sleepDailySeries, dates, windowSize]
    );
    ```

12. Add primary-sleep detection and Y-axis logic. Below the existing `primaryIsSymptom` / `primaryIsSupplement`:
    ```javascript
    const primaryIsSleep = selectedSleepMetrics.includes(primarySeriesId);
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
    ```

13. Add sleep point sets (mirror symptom/supplement):
    ```javascript
    const sleepPointSets = useMemo(() =>
      sleepTransformed.map((sd, sIdx) => {
        const { values, dates: txDates } = sd.transformed;
        const isPrimary = selectedSleepMetrics[sIdx] === primarySeriesId;
        // Determine the y-scale axis: if any series is primary, fit to its scale.
        // Sleep secondary scales to its own range proportionally (like supplements).
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
            : padLeft + (i / Math.max(1, txDates.length - 1)) * chartW;
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
    ```

14. Update `primaryDailyValues` to include sleep:
    ```javascript
    const sleepIdx = selectedSleepMetrics.indexOf(primarySeriesId);
    if (sleepIdx >= 0 && sleepTransformed[sleepIdx]) return sleepTransformed[sleepIdx].smoothed;
    ```
    (insert before the `return null;` at the end)

15. Update `insightData.buildStats` and `secondaryIds` to include sleep:
    ```javascript
    } else if (selectedSleepMetrics.includes(id)) {
      // Sleep
      extSeries = interpolateSmallGaps(getSleepDailySeries(sleepDays, id, extendedDates));
      extSeries = smooth(extSeries, windowSize);
    }
    ...
    const item = isSymptom
      ? symptoms.find(s => s.id === id)
      : (selectedSleepMetrics.includes(id)
        ? SLEEP_METRICS.find(m => m.key === id)
        : stackItems.find(i => i.id === id));
    const unit = isSymptom
      ? '/5'
      : (selectedSleepMetrics.includes(id)
        ? (SLEEP_METRICS.find(m => m.key === id)?.unit || '')
        : (item?.unit || 'mg'));
    ```
    And update `secondaryIds`:
    ```javascript
    const secondaryIds = [...selectedSupplements, ...selectedSymptoms, ...selectedSleepMetrics].filter(id => id && id !== primarySeriesId);
    ```

16. Update `crosshairData` items to include sleep (after the symptoms loop):
    ```javascript
    selectedSleepMetrics.forEach((key, idx) => {
      const m = SLEEP_METRICS.find(mm => mm.key === key);
      const sd = sleepTransformed[idx];
      const val = sd?.transformed.values[touchX];
      items.push({
        name: m?.label,
        color: SLEEP_STYLES[idx].color,
        val: val ?? null,
        unit: m?.unit || '',
      });
    });
    ```

17. Update `legendItems` averages (after the symptoms loop):
    ```javascript
    selectedSleepMetrics.forEach((key, idx) => {
      const m = SLEEP_METRICS.find(mm => mm.key === key);
      const sd = sleepTransformed[idx];
      if (sd) {
        items.push({
          name: m?.label,
          color: SLEEP_STYLES[idx].color,
          val: avg(sd.smoothed),
          unit: m?.unit || '',
        });
      }
    });
    ```

18. Update `maxOffset` to include sleep dates:
    ```javascript
    if (sleepDays.length > 0 && selectedSleepMetrics.length > 0) {
      for (const d of sleepDays) {
        if (d.date && (!earliest || d.date < earliest)) earliest = d.date;
      }
    }
    ```
    Add `sleepDays`, `selectedSleepMetrics` to the dep array.

19. Update grid lines / Y-axis labels: extend the `showHealthScore ? ... : primaryIsSupplement ? ...` chain to include `primaryIsSleep`. Three places — find each block (around lines 910, 940, 985) and add a sleep branch:
    ```jsx
    primaryIsSleep && selectedSleepMetrics.length > 0 ? (
      sleepYLabels.map(val => {
        const y = padTop + chartH - (val / sleepYMax) * chartH;
        return <line key={val} x1={padLeft} y1={y} x2={W - padRight} y2={y} stroke={isDesktop ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.15)"} strokeWidth={(isDesktop ? 0.5 : 0.8) * s} />;
      })
    ) :
    ```

20. Render sleep lines (after symptom lines block, ~line 1020):
    ```jsx
    {sleepPointSets.map((pts, idx) => (
      <g key={`sleep-${idx}`}>
        <path d={buildPath(pts)} fill="none" stroke={SLEEP_STYLES[idx].color} strokeWidth={(isDesktop ? 1.0 : 2.5) * s} strokeLinecap="round" strokeLinejoin="round" opacity={selectedSleepMetrics[idx] === primarySeriesId ? (isDesktop ? 0.8 : 1.0) : (isDesktop ? 0.45 : 0.6)} />
        {showDots && selectedSleepMetrics[idx] === primarySeriesId && pts.map((pt, i) => (
          pt.y !== null && <circle key={`sld-${idx}-${i}`} cx={pt.x} cy={pt.y} r={1.2 * s} fill="rgb(15,17,21)" stroke={SLEEP_STYLES[idx].color} strokeWidth={0.7 * s} />
        ))}
      </g>
    ))}
    ```

21. Add the sleep picker panel (mirror `symptomPickerPanel` but driven by `SLEEP_METRICS` and `sleepDays`). Show "No Garmin sleep data connected" if `sleepDays.length === 0`. Disable selection in that case.

22. In `seriesChips`, after the `+ Symptom` button block, add a spacer + sleep chips + `+ Sleep` button. Mirror the symptom chip block but using `SLEEP_STYLES`, `selectedSleepMetrics`, `removeSleep`, the metric `label` and `unit`.

23. Render `{sleepPickerPanel}` alongside the other two pickers near the top of the return.

**Verify:**

Run: `npm run dev`. Open Comparison. Try each combination:
- No selections → Health Score shows.
- Add a sleep metric → it appears as a chip with a teal/cyan color, its line renders, primary-axis defaults to it.
- Add a supplement + a sleep metric → both render; click between them to swap primary.
- Add a symptom too → all three render.
- Crosshair shows sleep value with its unit.
- Reload → selections persist.

### Task 2.6: Commit sleep section work

```bash
git add src/utils/sleepMetrics.js src/utils/correlationHelpers.js src/utils/__tests__/correlationHelpers.test.js src/components/SleepAnalyzer.jsx src/components/Insights.jsx src/components/ComparisonStudio.jsx
git commit -m "$(cat <<'EOF'
feat: add Sleep section to Comparison view

Garmin sleep metrics (Score, Time, REM, Deep, Resp, SpO2, Stress, HRV)
can now be selected as a third category alongside supplements and
symptoms in the comparison chart, with the same max-3 + primary-axis
behavior. Extracted METRICS/valueForRow into src/utils/sleepMetrics.js
so the studio can consume them without pulling in React.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Feature 3: Health Score in exports

### Task 3.1: Add markdown export tests

**Files:**
- Modify: `src/utils/__tests__/helpers.test.js`

**Step 1: Add test cases**

```javascript
import { generateAIDataExport, exportCSV } from '../helpers';

describe('generateAIDataExport — Health Score section', () => {
  const symptoms = [
    { id: 's1', name: 'Headache', active: true, applicablePeriods: ['daily'] },
  ];
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const entries = {
    [`${dateKey}-s1-daily`]: { severity: 2, date: dateKey, symptomId: 's1', time: 'daily' },
  };

  it('includes a Health Score section with explainer and per-day score', () => {
    const out = generateAIDataExport(7, entries, symptoms, [], {}, {}, 'simple');
    expect(out).toMatch(/## Health Score/);
    expect(out).toMatch(/0-100/);
    expect(out).toMatch(/100 . \(avg severity \/ 5/); // explainer line (handles ASCII or − minus)
    // 100 - (2/5)*100 = 60
    expect(out).toMatch(new RegExp(`\\| ${dateKey} \\| 60 \\|`));
  });

  it('shows blank when no symptoms logged that day', () => {
    const out = generateAIDataExport(2, {}, symptoms, [], {}, {}, 'simple');
    expect(out).toMatch(/## Health Score/);
    // Row exists with empty score
    expect(out).toMatch(/\|\s*\|\s*$/m);
  });
});
```

**Step 2: Verify failures**

Run: `npx vitest run src/utils/__tests__/helpers.test.js`
Expected: new tests FAIL.

### Task 3.2: Add Health Score section to `generateAIDataExport`

**Files:**
- Modify: `src/utils/helpers.js`

In `generateAIDataExport` (line 268+), after the header push (line 278) and before `output.push('### Symptoms');`, insert:

```javascript
// Health Score section
output.push('## Health Score');
output.push('Daily score (0-100, higher is better) computed as 100 − (avg severity / 5 × 100) across logged active symptoms. Days with no logged symptoms are blank.\n');
output.push('| Date | Score |');
output.push('| ---- | ----- |');
for (let i = 0; i < days; i++) {
  const date = new Date(today);
  date.setDate(date.getDate() - i);
  const dateKey = getDateKey(date);
  const { score } = computeHealthScore(symptoms, entries, dateKey, trackingMode);
  output.push(`| ${dateKey} | ${score == null ? '' : score} |`);
}
output.push('');
```

Add the import at the top of the file:
```javascript
import { computeHealthScore } from './healthScore';
```

(Verify there's no circular import — `healthScore.js` imports `getDailyValue` from `chartHelpers.js`, not `helpers.js`. Safe.)

**Step 3: Verify**

Run: `npx vitest run src/utils/__tests__/helpers.test.js`
Expected: PASS.

### Task 3.3: Add CSV export test

**Files:**
- Modify: `src/utils/__tests__/helpers.test.js`

**Step 1: Add test (CSV is normally side-effecty — `URL.createObjectURL`, DOM clicks. Refactor `exportCSV` to split pure-string generation from the DOM dance.)**

The simplest path: extract a helper `buildCSVText(days, entries, symptoms, trackingMode)` that returns the CSV string, and have `exportCSV` call it before doing the blob/download. Test the helper directly.

```javascript
import { buildCSVText } from '../helpers';

describe('buildCSVText — Health Score', () => {
  const symptoms = [{ id: 's1', name: 'Headache', active: true }];
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const entries = {
    [`${dateKey}-s1-daily`]: { severity: 4, date: dateKey, symptomId: 's1', time: 'daily' },
  };

  it('starts with a comment line explaining health_score', () => {
    const csv = buildCSVText(7, entries, symptoms, 'simple');
    expect(csv.split('\n')[0]).toMatch(/^# health_score:/);
  });

  it('appends Health Score rows per date', () => {
    const csv = buildCSVText(7, entries, symptoms, 'simple');
    // 100 - (4/5)*100 = 20
    expect(csv).toMatch(new RegExp(`${dateKey},"Health Score",daily,20`));
  });
});
```

### Task 3.4: Implement `buildCSVText` and refactor `exportCSV`

**Files:**
- Modify: `src/utils/helpers.js`

**Step 1: Replace the existing `exportCSV` body**

```javascript
export const buildCSVText = (days, entries, symptoms, trackingMode) => {
  const today = new Date();
  const timePeriods = trackingModes[trackingMode].periods;

  const lines = [];
  lines.push('# health_score: 0-100, higher is better. Computed as 100 - (avg severity / 5 * 100) across logged active symptoms; blank if no symptoms logged that day.');
  lines.push('Date,Symptom,Time Period,Severity');

  // Existing entries
  Object.values(entries)
    .filter(e => {
      const entryDate = new Date(e.date);
      const daysAgo = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
      return daysAgo <= days;
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach(entry => {
      const symptom = symptoms.find(s => s.id === entry.symptomId);
      const period = timePeriods.find(p => p.id === entry.time);
      const severityVal = entry.severity === NA_SEVERITY ? 'N/A' : entry.severity;
      lines.push(`${entry.date},"${symptom?.name || entry.symptomId}",${period?.label || entry.time},${severityVal}`);
    });

  // Health score rows
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = getDateKey(d);
    const { score } = computeHealthScore(symptoms, entries, dateKey, trackingMode);
    if (score != null) {
      lines.push(`${dateKey},"Health Score",daily,${score}`);
    }
  }

  return lines.join('\n') + '\n';
};

export const exportCSV = (days, entries, symptoms, trackingMode) => {
  const csv = buildCSVText(days, entries, symptoms, trackingMode);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `symptoms-${days}days-${getDateKey(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
```

**Step 2: Verify**

Run: `npx vitest run src/utils/__tests__/helpers.test.js`
Expected: PASS.

### Task 3.5: Manual verification of exports

Open the dev app, go to Export panel, copy a 7-day markdown export. Confirm it has a `## Health Score` section with the explainer and a per-day table at the top. Then download a 30-day CSV. Open it in a text editor, confirm the first line starts with `# health_score:` and Health Score rows appear at the bottom.

### Task 3.6: Commit export changes

```bash
git add src/utils/helpers.js src/utils/__tests__/helpers.test.js
git commit -m "$(cat <<'EOF'
feat: include Health Score in markdown and CSV exports

Markdown export gets a top-level Health Score section with an explainer
and a per-day score table. CSV gets a leading comment line explaining
health_score plus Health Score rows per date alongside the existing
symptom severity rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final task: Version bump and deploy

**Files:**
- Modify: `package.json` (bump from 5.0.0 → 5.1.0)
- Modify: `src/components/Settings.jsx` (find version constant, bump)
- Modify: `src/components/QuickActionsMenu.jsx` (find version constant, bump)

```bash
# Bump version in all three locations (use Edit tool, not sed)
git add package.json src/components/Settings.jsx src/components/QuickActionsMenu.jsx
git commit -m "$(cat <<'EOF'
chore: bump version to 5.1.0

Comparison view: stepped supplements + sleep section.
Exports: Health Score included.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push origin main
npm run build && npm run deploy
```

---

## Test commands summary

- All tests: `npx vitest run`
- Specific file: `npx vitest run src/utils/__tests__/<file>.test.js`
- Watch mode (during dev): `npm run test:watch`

## Out-of-scope reminders

- No backfill of pre-existing exports.
- No new sleep aggregations (weekly/monthly) for the comparison view; daily resolution only — `aggregate` is not used.
- Picker UI for sleep mirrors symptom picker styling — no new design language.
