# Health Score Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a derived health score (0-100%) showing overall symptom burden, displayed in 6 UI locations and plottable in ComparisonStudio.

**Architecture:** A `useHealthScore` React hook computes the score on-the-fly from existing symptom entries — no new storage or sync changes. A `getHealthScoreSeries` function in correlationHelpers generates chart data. UI components consume the hook for badges/cards and the series function for chart rendering.

**Tech Stack:** React (hooks, useMemo), vitest for testing, inline styles (existing pattern)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/healthScore.js` | **New** — Pure calculation functions: `computeHealthScore`, `computeRollingAvg`, `getScoreColor` |
| `src/hooks/useHealthScore.js` | **New** — React hook wrapping calculations with `useMemo` |
| `src/utils/correlationHelpers.js` | **Modify** — Add `getHealthScoreSeries` |
| `src/components/HealthScoreBadge.jsx` | **New** — Shared compact pill component (toolbar + header) |
| `src/components/HealthScoreCard.jsx` | **New** — Shared summary card component (desktop sidebar + mobile) |
| `src/components/DesktopToolbar.jsx` | **Modify** — Render `HealthScoreBadge` |
| `src/components/Header.jsx` | **Modify** — Render `HealthScoreBadge` |
| `src/components/SymptomList.jsx` | **Modify** — Render `HealthScoreCard` at top |
| `src/components/BottomNav.jsx` | **Modify** — Render score badge on Symptoms tab |
| `src/components/ComparisonStudio.jsx` | **Modify** — Toggle + chart series rendering |
| `src/utils/__tests__/healthScore.test.js` | **New** — Tests for pure calculation functions |

---

### Task 1: Core Calculation Functions

**Files:**
- Create: `src/utils/healthScore.js`
- Create: `src/utils/__tests__/healthScore.test.js`

- [ ] **Step 1: Write failing tests for `computeHealthScore`**

```javascript
// src/utils/__tests__/healthScore.test.js
import { describe, it, expect } from 'vitest';
import { computeHealthScore } from '../healthScore';

describe('computeHealthScore', () => {
  const symptoms = [
    { id: 's1', name: 'Headache', active: true },
    { id: 's2', name: 'Fatigue', active: true },
    { id: 's3', name: 'Nausea', active: false },
  ];

  it('returns null when no symptoms are logged', () => {
    const result = computeHealthScore(symptoms, {}, '2026-03-30', 'simple');
    expect(result).toEqual({ score: null, loggedCount: 0, totalActive: 2 });
  });

  it('computes score from logged severities', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: 2, date: '2026-03-30', symptomId: 's1', time: 'daily' },
      '2026-03-30-s2-daily': { severity: 3, date: '2026-03-30', symptomId: 's2', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    // (2 + 3) / (2 * 5) * 100 = 50
    expect(result).toEqual({ score: 50, loggedCount: 2, totalActive: 2 });
  });

  it('excludes N/A entries (severity -1)', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: -1, date: '2026-03-30', symptomId: 's1', time: 'daily' },
      '2026-03-30-s2-daily': { severity: 4, date: '2026-03-30', symptomId: 's2', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    // Only s2 counts: 4 / (1 * 5) * 100 = 80
    expect(result).toEqual({ score: 80, loggedCount: 1, totalActive: 2 });
  });

  it('only considers active symptoms', () => {
    const entries = {
      '2026-03-30-s3-daily': { severity: 5, date: '2026-03-30', symptomId: 's3', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    expect(result).toEqual({ score: null, loggedCount: 0, totalActive: 2 });
  });

  it('handles AM/PM mode by averaging', () => {
    const entries = {
      '2026-03-30-s1-morning': { severity: 2, date: '2026-03-30', symptomId: 's1', time: 'morning' },
      '2026-03-30-s1-evening': { severity: 4, date: '2026-03-30', symptomId: 's1', time: 'evening' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'ampm');
    // AM/PM avg for s1: (2+4)/2 = 3, score: 3 / (1*5) * 100 = 60
    expect(result).toEqual({ score: 60, loggedCount: 1, totalActive: 2 });
  });

  it('returns score of 0 when all logged symptoms are severity 0', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: 0, date: '2026-03-30', symptomId: 's1', time: 'daily' },
    };
    const result = computeHealthScore(symptoms, entries, '2026-03-30', 'simple');
    expect(result).toEqual({ score: 0, loggedCount: 1, totalActive: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/healthScore.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `computeHealthScore`**

```javascript
// src/utils/healthScore.js
import { getDailyValue } from './chartHelpers';

/**
 * Compute health score for a single date.
 * Returns { score, loggedCount, totalActive }
 */
export function computeHealthScore(symptoms, entries, dateStr, trackingMode) {
  const active = symptoms.filter(s => s.active);
  const totalActive = active.length;

  let sum = 0;
  let loggedCount = 0;

  for (const sym of active) {
    const val = getDailyValue(entries, dateStr, sym.id, trackingMode);
    if (val === null || val === -1) continue;
    sum += val;
    loggedCount++;
  }

  if (loggedCount === 0) return { score: null, loggedCount: 0, totalActive };

  const score = Math.round((sum / (loggedCount * 5)) * 100);
  return { score, loggedCount, totalActive };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/healthScore.test.js`
Expected: All 6 tests PASS

- [ ] **Step 5: Write failing tests for `computeRollingAvg`**

Add to `healthScore.test.js`:

```javascript
import { computeRollingAvg } from '../healthScore';

describe('computeRollingAvg', () => {
  const symptoms = [
    { id: 's1', name: 'Headache', active: true },
  ];

  it('averages scores over available days', () => {
    const entries = {
      '2026-03-29-s1-daily': { severity: 2, date: '2026-03-29', symptomId: 's1', time: 'daily' },
      '2026-03-30-s1-daily': { severity: 4, date: '2026-03-30', symptomId: 's1', time: 'daily' },
    };
    // Day 1: 2/5*100=40, Day 2: 4/5*100=80, avg = 60
    const result = computeRollingAvg(symptoms, entries, '2026-03-30', 'simple', 7);
    expect(result).toBe(60);
  });

  it('returns null when no prior days have data', () => {
    const result = computeRollingAvg(symptoms, {}, '2026-03-30', 'simple', 7);
    expect(result).toBeNull();
  });

  it('excludes current date from rolling average', () => {
    const entries = {
      '2026-03-30-s1-daily': { severity: 4, date: '2026-03-30', symptomId: 's1', time: 'daily' },
    };
    // Only today has data, rolling avg of prior 7 days = null
    const result = computeRollingAvg(symptoms, entries, '2026-03-30', 'simple', 7);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 6: Implement `computeRollingAvg`**

Add to `src/utils/healthScore.js`:

```javascript
/**
 * Compute rolling average of health score over past N days (excludes current date).
 * Returns number or null.
 */
export function computeRollingAvg(symptoms, entries, dateStr, trackingMode, days = 7) {
  const scores = [];
  const d = new Date(dateStr + 'T00:00:00');

  for (let i = 1; i <= days; i++) {
    const past = new Date(d);
    past.setDate(past.getDate() - i);
    const y = past.getFullYear();
    const m = String(past.getMonth() + 1).padStart(2, '0');
    const day = String(past.getDate()).padStart(2, '0');
    const pastStr = `${y}-${m}-${day}`;

    const { score } = computeHealthScore(symptoms, entries, pastStr, trackingMode);
    if (score !== null) scores.push(score);
  }

  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/healthScore.test.js`
Expected: All 9 tests PASS

- [ ] **Step 8: Write failing test for `getScoreColor`**

Add to `healthScore.test.js`:

```javascript
import { getScoreColor } from '../healthScore';

describe('getScoreColor', () => {
  it('returns green for 0-20%', () => {
    expect(getScoreColor(0)).toBe('#22c55e');
    expect(getScoreColor(20)).toBe('#22c55e');
  });

  it('returns amber for 21-50%', () => {
    expect(getScoreColor(21)).toBe('#f59e0b');
    expect(getScoreColor(50)).toBe('#f59e0b');
  });

  it('returns red for 51-100%', () => {
    expect(getScoreColor(51)).toBe('#ef4444');
    expect(getScoreColor(100)).toBe('#ef4444');
  });

  it('returns gray for null', () => {
    expect(getScoreColor(null)).toBe('#64748b');
  });
});
```

- [ ] **Step 9: Implement `getScoreColor`**

Add to `src/utils/healthScore.js`:

```javascript
export function getScoreColor(score) {
  if (score === null) return '#64748b';
  if (score <= 20) return '#22c55e';
  if (score <= 50) return '#f59e0b';
  return '#ef4444';
}
```

- [ ] **Step 10: Run all tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/healthScore.test.js`
Expected: All 13 tests PASS

- [ ] **Step 11: Commit**

```bash
git add src/utils/healthScore.js src/utils/__tests__/healthScore.test.js
git commit -m "feat: add health score calculation functions with tests"
```

---

### Task 2: useHealthScore Hook

**Files:**
- Create: `src/hooks/useHealthScore.js`

- [ ] **Step 1: Create the hook**

```javascript
// src/hooks/useHealthScore.js
import { useMemo } from 'react';
import { computeHealthScore, computeRollingAvg } from '../utils/healthScore';

export function useHealthScore(date, { symptoms, entries, trackingMode }) {
  return useMemo(() => {
    const dateStr = typeof date === 'string' ? date
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    const { score, loggedCount, totalActive } = computeHealthScore(symptoms, entries, dateStr, trackingMode);
    const rollingAvg = computeRollingAvg(symptoms, entries, dateStr, trackingMode, 7);
    const delta = (score !== null && rollingAvg !== null) ? score - rollingAvg : null;

    return { score, loggedCount, totalActive, rollingAvg, delta };
  }, [date, symptoms, entries, trackingMode]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useHealthScore.js
git commit -m "feat: add useHealthScore React hook"
```

---

### Task 3: Chart Series Generator

**Files:**
- Modify: `src/utils/correlationHelpers.js`
- Modify: `src/utils/__tests__/healthScore.test.js`

- [ ] **Step 1: Write failing test for `getHealthScoreSeries`**

Add to `healthScore.test.js`:

```javascript
import { getHealthScoreSeries } from '../correlationHelpers';

describe('getHealthScoreSeries', () => {
  const symptoms = [
    { id: 's1', name: 'Headache', active: true },
    { id: 's2', name: 'Fatigue', active: true },
  ];

  it('returns array of scores aligned to dates', () => {
    const entries = {
      '2026-03-29-s1-daily': { severity: 2, date: '2026-03-29', symptomId: 's1', time: 'daily' },
      '2026-03-29-s2-daily': { severity: 4, date: '2026-03-29', symptomId: 's2', time: 'daily' },
      '2026-03-30-s1-daily': { severity: 1, date: '2026-03-30', symptomId: 's1', time: 'daily' },
    };
    const dates = ['2026-03-28', '2026-03-29', '2026-03-30'];
    const result = getHealthScoreSeries(symptoms, entries, dates, 'simple');
    // Day 1: no data = null
    // Day 2: (2+4)/(2*5)*100 = 60, normalized to 0-5: 60/20 = 3
    // Day 3: 1/(1*5)*100 = 20, normalized: 20/20 = 1
    expect(result).toEqual([null, 3, 1]);
  });

  it('returns all nulls when no entries exist', () => {
    const dates = ['2026-03-28', '2026-03-29'];
    const result = getHealthScoreSeries(symptoms, {}, dates, 'simple');
    expect(result).toEqual([null, null]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/healthScore.test.js`
Expected: FAIL — getHealthScoreSeries not exported

- [ ] **Step 3: Implement `getHealthScoreSeries`**

Add to `src/utils/correlationHelpers.js` after existing imports:

```javascript
import { computeHealthScore } from './healthScore';
```

Add at the end of the file:

```javascript
/**
 * Generate health score series for chart plotting.
 * Returns array of numbers (normalized to 0-5 scale) or nulls, aligned to dates array.
 */
export function getHealthScoreSeries(symptoms, entries, dates, trackingMode) {
  return dates.map(dateStr => {
    const { score } = computeHealthScore(symptoms, entries, dateStr, trackingMode);
    if (score === null) return null;
    return score / 20; // Normalize 0-100% to 0-5 scale
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/healthScore.test.js`
Expected: All 17 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/correlationHelpers.js src/utils/__tests__/healthScore.test.js
git commit -m "feat: add getHealthScoreSeries chart data generator"
```

---

### Task 4: HealthScoreBadge Component (Compact Pill)

**Files:**
- Create: `src/components/HealthScoreBadge.jsx`

- [ ] **Step 1: Create the badge component**

Shared by DesktopToolbar and Header. Renders a compact pill with score percentage, delta arrow, and color coding.

```jsx
// src/components/HealthScoreBadge.jsx
import React from 'react';
import { getScoreColor } from '../utils/healthScore';

export default function HealthScoreBadge({ score, delta }) {
  const color = getScoreColor(score);
  const displayScore = score !== null ? `${score}%` : '—';

  let arrow = null;
  if (delta !== null && delta !== 0) {
    arrow = delta < 0
      ? <span style={{ color: '#22c55e', fontSize: '10px', marginLeft: 3 }}>▼{Math.abs(delta)}</span>
      : <span style={{ color: '#ef4444', fontSize: '10px', marginLeft: 3 }}>▲{Math.abs(delta)}</span>;
  }

  return (
    <div style={{
      background: `${color}18`,
      border: `1px solid ${color}55`,
      borderRadius: 16,
      padding: '3px 10px',
      fontSize: 12,
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
    }}>
      <span style={{ color }}>{displayScore}</span>
      {arrow}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HealthScoreBadge.jsx
git commit -m "feat: add HealthScoreBadge compact pill component"
```

---

### Task 5: HealthScoreCard Component (Summary Card)

**Files:**
- Create: `src/components/HealthScoreCard.jsx`

- [ ] **Step 1: Create the card component**

Shared by desktop sidebar and mobile symptom list. Renders large score, delta, progress bar, and logged count.

```jsx
// src/components/HealthScoreCard.jsx
import React from 'react';
import { getScoreColor } from '../utils/healthScore';

export default function HealthScoreCard({ score, loggedCount, totalActive, rollingAvg, delta }) {
  const color = getScoreColor(score);
  const displayScore = score !== null ? `${score}%` : '—';
  const displayAvg = rollingAvg !== null ? `${rollingAvg}%` : '—';

  let deltaText = null;
  if (delta !== null && delta !== 0) {
    const improving = delta < 0;
    deltaText = (
      <span style={{ fontSize: 12, color: improving ? '#22c55e' : '#ef4444' }}>
        {improving ? '▼' : '▲'} {Math.abs(delta)}%
      </span>
    );
  }

  return (
    <div style={{
      background: '#111827',
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#888' }}>
            Health Score
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color }}>{displayScore}</span>
            {deltaText}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#888' }}>7-day avg</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#94a3b8', marginTop: 2 }}>
            {displayAvg}
          </div>
        </div>
      </div>
      {score !== null && (
        <div style={{ background: '#1f2937', borderRadius: 4, height: 6, marginTop: 10, overflow: 'hidden' }}>
          <div style={{
            background: `linear-gradient(90deg, ${color}, ${color}cc)`,
            width: `${score}%`,
            height: '100%',
            borderRadius: 4,
          }} />
        </div>
      )}
      <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
        {loggedCount} of {totalActive} symptoms logged
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HealthScoreCard.jsx
git commit -m "feat: add HealthScoreCard summary component"
```

---

### Task 6: Desktop Toolbar Badge

**Files:**
- Modify: `src/components/DesktopToolbar.jsx`

- [ ] **Step 1: Add imports and hook**

At top of `DesktopToolbar.jsx`, add:

```javascript
import HealthScoreBadge from './HealthScoreBadge';
import { useHealthScore } from '../hooks/useHealthScore';
```

The component needs `symptoms`, `entries`, `trackingMode`, and `selectedDate` props. Check if these are already passed — if not, add them to the props destructuring.

- [ ] **Step 2: Add hook call inside the component**

After existing state/hooks, add:

```javascript
const { score, delta } = useHealthScore(selectedDate, { symptoms, entries, trackingMode });
```

- [ ] **Step 3: Render badge in the right section of the toolbar**

Insert `<HealthScoreBadge score={score} delta={delta} />` in the right section of the toolbar, before the settings gear icon. The exact insertion point is near line 198 in the right-side div.

- [ ] **Step 4: Verify in browser**

Run: `npm start`
Check: Desktop view shows health score pill in toolbar across all views (Symptoms, Protocol, Insights).

- [ ] **Step 5: Commit**

```bash
git add src/components/DesktopToolbar.jsx
git commit -m "feat: add health score badge to desktop toolbar"
```

---

### Task 7: Mobile Header Badge

**Files:**
- Modify: `src/components/Header.jsx`

- [ ] **Step 1: Add imports and hook**

```javascript
import HealthScoreBadge from './HealthScoreBadge';
import { useHealthScore } from '../hooks/useHealthScore';
```

The component needs `symptoms`, `entries`, `trackingMode`, and `selectedDate` props. Check existing props and add any missing ones.

- [ ] **Step 2: Add hook call and render badge**

Add hook call, then render `<HealthScoreBadge score={score} delta={delta} />` after the date display (near line 61), in the right portion of the header.

- [ ] **Step 3: Verify in browser**

Run: `npm start`
Check: Mobile view shows health score pill in header next to date.

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.jsx
git commit -m "feat: add health score badge to mobile header"
```

---

### Task 8: Summary Card in SymptomList

**Files:**
- Modify: `src/components/SymptomList.jsx`

- [ ] **Step 1: Add imports and hook**

```javascript
import HealthScoreCard from './HealthScoreCard';
import { useHealthScore } from '../hooks/useHealthScore';
```

`SymptomList` already receives `symptoms`, `entries`, `selectedDate`, and `trackingMode` as props.

- [ ] **Step 2: Add hook call**

```javascript
const { score, loggedCount, totalActive, rollingAvg, delta } = useHealthScore(selectedDate, { symptoms, entries, trackingMode });
```

- [ ] **Step 3: Render card at top of symptom list**

Insert `<HealthScoreCard score={score} loggedCount={loggedCount} totalActive={totalActive} rollingAvg={rollingAvg} delta={delta} />` at the top of the list content, just before the symptom entries begin rendering. This applies to both desktop and mobile render paths.

- [ ] **Step 4: Verify in browser**

Run: `npm start`
Check: Both desktop and mobile Symptoms view show the summary card above the symptom list.

- [ ] **Step 5: Commit**

```bash
git add src/components/SymptomList.jsx
git commit -m "feat: add health score summary card to symptom list"
```

---

### Task 9: Bottom Nav Badge

**Files:**
- Modify: `src/components/BottomNav.jsx`

- [ ] **Step 1: Add imports and hook**

```javascript
import { useHealthScore } from '../hooks/useHealthScore';
import { getScoreColor } from '../utils/healthScore';
```

The component needs `symptoms`, `entries`, `trackingMode`, and `selectedDate` props. Check existing props and add any missing ones.

- [ ] **Step 2: Add hook call and render badge**

```javascript
const { score } = useHealthScore(selectedDate, { symptoms, entries, trackingMode });
```

Render a small badge on the Symptoms tab icon (near line 174). The badge is a small absolutely-positioned element:

```jsx
{score !== null && (
  <div style={{
    position: 'absolute',
    top: -4,
    right: -8,
    background: getScoreColor(score),
    color: '#000',
    fontSize: 8,
    fontWeight: 700,
    borderRadius: 8,
    padding: '1px 4px',
  }}>
    {score}%
  </div>
)}
```

The parent tab div needs `position: 'relative'` if it doesn't already have it.

- [ ] **Step 3: Verify in browser**

Run: `npm start`
Check: Mobile bottom nav shows small score badge on Symptoms tab.

- [ ] **Step 4: Commit**

```bash
git add src/components/BottomNav.jsx
git commit -m "feat: add health score badge to mobile bottom nav"
```

---

### Task 10: ComparisonStudio Toggle & Chart Series

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

This is the most complex task. It adds a toggle button for the health score and renders the series line on the chart.

- [ ] **Step 1: Add imports**

At top of `ComparisonStudio.jsx`:

```javascript
import { getHealthScoreSeries } from '../utils/correlationHelpers';
import { getScoreColor } from '../utils/healthScore';
```

- [ ] **Step 2: Add state for health score toggle**

Near existing state declarations (around line 60-88), add:

```javascript
const [showHealthScore, setShowHealthScore] = useState(false);
```

Persist to localStorage alongside existing `comparisonStudioSelections` if desired, but not required for v1.

- [ ] **Step 3: Add health score data pipeline**

After the existing `symptomTransformed` useMemo (around line 220), add:

```javascript
const healthScoreTransformed = useMemo(() => {
  if (!showHealthScore) return null;
  const raw = getHealthScoreSeries(symptoms, entries, dates, trackingMode);
  const smoothed = windowSize > 1 ? smooth(raw, windowSize) : [...raw];
  return { values: smoothed, dates: [...dates], labels: [...dates] };
}, [showHealthScore, symptoms, entries, dates, trackingMode, windowSize]);
```

`smooth` is already imported from `chartHelpers`. `symptoms` (the full array) is already available in the component.

- [ ] **Step 4: Add health score points for SVG rendering**

After existing point mapping (where `suppPoints` and symptom points are computed), add:

```javascript
const healthScorePoints = useMemo(() => {
  if (!healthScoreTransformed) return null;
  return healthScoreTransformed.values.map((v, i) => ({
    x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
    y: v !== null ? (chartH - padBottom - ((v / 5) * (chartH - padTop - padBottom)) + padTop) : null,
  }));
}, [healthScoreTransformed, padLeft, chartW, chartH, padBottom, padTop, dates.length]);
```

Note: The y-coordinate calculation maps 0-5 to the symptom axis. The `v` values are already in 0-5 scale from `getHealthScoreSeries`.

- [ ] **Step 5: Render the health score toggle button**

In the series chips area (around line 955-1110), add a dedicated toggle before the existing supplement/symptom chips:

```jsx
<div
  onClick={() => { setShowHealthScore(prev => !prev); haptic('light'); }}
  style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: isDesktop ? 12 : 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: showHealthScore ? '1px solid #10b98155' : '1px dashed #555',
    background: showHealthScore ? '#10b98120' : 'transparent',
    color: showHealthScore ? '#10b981' : '#888',
  }}
>
  {showHealthScore ? '✓ ' : ''}Health Score
</div>
```

- [ ] **Step 6: Render the chart line**

In the SVG rendering section (around line 809-826, after symptom lines), add:

```jsx
{healthScorePoints && (
  <path
    d={buildPath(healthScorePoints)}
    fill="none"
    stroke="#10b981"
    strokeWidth={(isDesktop ? 0.9 : 2.5) * s}
    opacity={0.8}
  />
)}
```

`buildPath` is already imported from `chartHelpers`.

- [ ] **Step 7: Add health score to crosshair/legend**

In the crosshair data computation (around line 354-381), add health score value to the items array when the toggle is active:

```javascript
if (showHealthScore && healthScoreTransformed) {
  const hsVal = healthScoreTransformed.values[touchX];
  if (hsVal !== null) {
    items.push({
      val: Math.round(hsVal * 20), // Convert back to percentage for display
      color: '#10b981',
      name: 'Health Score',
      unit: '%',
    });
  }
}
```

In the legend items computation (around line 384-410), add similar entry when `showHealthScore` is true.

- [ ] **Step 8: Verify in browser**

Run: `npm start`
Check:
1. Toggle button appears near series chips
2. Clicking toggle adds/removes green line on chart
3. Line follows symptom axis scale (0-5)
4. Crosshair shows percentage value on hover
5. Works across all timeframes (7, 30, 90, 180 days)

- [ ] **Step 9: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: add health score toggle and chart series to ComparisonStudio"
```

---

### Task 11: Run Full Test Suite & Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing 69 + new ~17 health score tests)

- [ ] **Step 2: Manual verification checklist**

Run: `npm start`

- Desktop toolbar: badge shows on all views
- Desktop symptoms view: summary card at top of list
- Mobile header: badge next to date
- Mobile symptoms view: summary card at top
- Mobile bottom nav: badge on Symptoms tab
- ComparisonStudio: toggle works, line renders, crosshair shows %
- Score updates when logging/changing symptom severities
- Score shows "—" on days with no data
- Delta arrow shows green ▼ or red ▲ correctly

- [ ] **Step 3: Version bump and commit**

Update version in all 4 locations per CLAUDE.md:
- `package.json`
- `src/components/Settings.jsx` (backup object ~line 80 AND display string ~line 750)
- `src/components/QuickActionsMenu.jsx`

```bash
git add package.json src/components/Settings.jsx src/components/QuickActionsMenu.jsx
git commit -m "bump version to 4.3.3"
```
