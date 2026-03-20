# Dose Analysis Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Daily/Weekly/Monthly/Cumulative view modes to ComparisonStudio for analyzing supplement dosing patterns and estimated body levels.

**Architecture:** Two new pure utility modules (`doseTransforms.js`, `supplementLookup.js`) handle all data transformation and half-life lookup logic. ComparisonStudio gains a view mode selector that routes data through the appropriate transform before passing to the existing SVG renderer. Supplement settings get an optional "Advanced" section for decay rate. No test framework exists — Task 1 sets up vitest.

**Tech Stack:** React, custom SVG charts, vitest for testing, localStorage for persistence

**Spec:** `docs/superpowers/specs/2026-03-20-dose-analysis-views-design.md`

---

### File Structure

**New files:**
- `src/utils/supplementLookup.js` — half-life category table, fuzzy matching, category constants
- `src/utils/doseTransforms.js` — aggregation and cumulative level transforms
- `src/utils/__tests__/supplementLookup.test.js` — tests for lookup/matching
- `src/utils/__tests__/doseTransforms.test.js` — tests for all transforms
- `vite.config.js` — update with test configuration

**Modified files:**
- `src/components/ComparisonStudio.jsx` — view mode selector, avg/total toggle, inline half-life editor, area fill, adapted data pipeline, crosshair adaptation
- `src/components/Insights.jsx:128-135` — thread `setStackItems` prop to ComparisonStudio
- `src/App.jsx:758,1215` — pass `setStackItems` to Insights (both desktop inline and mobile overlay)
- `src/components/SupplementEdit.jsx:318` — advanced section with decay rate dropdown (after Schedule section)
- `src/components/Stack.jsx:911` — advanced section in add form (after Schedule section)
- `src/utils/chartHelpers.js` — add `formatXLabelWeekly` helper
- `package.json` — add vitest dev dependency

---

### Task 1: Set Up Test Framework

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`

- [ ] **Step 1: Install vitest**

Run: `npm install -D vitest`

- [ ] **Step 2: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Configure vitest in vite.config.js**

Add test config to the existing `defineConfig`:
```js
test: {
  environment: 'node',
}
```

- [ ] **Step 4: Verify setup with a trivial test**

Create `src/utils/__tests__/setup.test.js`:
```js
import { describe, it, expect } from 'vitest';

describe('test setup', () => {
  it('works', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npx vitest run`
Expected: 1 test passes

- [ ] **Step 5: Remove trivial test and commit**

Delete `src/utils/__tests__/setup.test.js`.

```bash
git add package.json package-lock.json vite.config.js
git commit -m "chore: add vitest test framework"
```

---

### Task 2: Supplement Lookup Module

**Files:**
- Create: `src/utils/supplementLookup.js`
- Create: `src/utils/__tests__/supplementLookup.test.js`

- [ ] **Step 1: Write failing tests for category constants**

Create `src/utils/__tests__/supplementLookup.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { CATEGORY_HALF_LIVES } from '../supplementLookup';

describe('CATEGORY_HALF_LIVES', () => {
  it('has fast, moderate, slow categories with correct half-lives in days', () => {
    expect(CATEGORY_HALF_LIVES.fast).toBe(0.5);
    expect(CATEGORY_HALF_LIVES.moderate).toBe(3);
    expect(CATEGORY_HALF_LIVES.slow).toBe(21);
  });
});
```

Run: `npx vitest run src/utils/__tests__/supplementLookup.test.js`
Expected: FAIL — module not found

- [ ] **Step 2: Write failing tests for matchSupplementCategory**

Add to the test file:
```js
import { matchSupplementCategory } from '../supplementLookup';

describe('matchSupplementCategory', () => {
  it('matches exact supplement names (case-insensitive)', () => {
    expect(matchSupplementCategory('Vitamin D')).toBe('slow');
    expect(matchSupplementCategory('vitamin d')).toBe('slow');
    expect(matchSupplementCategory('MAGNESIUM')).toBe('moderate');
  });

  it('matches partial/abbreviated names via token overlap', () => {
    expect(matchSupplementCategory('Vit D3 5000IU')).toBe('slow');
    expect(matchSupplementCategory('Mag Glycinate 400mg')).toBe('moderate');
  });

  it('matches common supplement variations', () => {
    expect(matchSupplementCategory('Vitamin C')).toBe('fast');
    expect(matchSupplementCategory('Vitamin K2')).toBe('slow');
    expect(matchSupplementCategory('Zinc')).toBe('moderate');
    expect(matchSupplementCategory('Fish Oil')).toBe('slow');
    expect(matchSupplementCategory('Caffeine')).toBe('fast');
    expect(matchSupplementCategory('B12')).toBe('fast');
  });

  it('returns null for unknown supplements', () => {
    expect(matchSupplementCategory('Mystery Powder')).toBeNull();
    expect(matchSupplementCategory('XYZ-1234')).toBeNull();
  });

  it('handles empty/null input gracefully', () => {
    expect(matchSupplementCategory('')).toBeNull();
    expect(matchSupplementCategory(null)).toBeNull();
    expect(matchSupplementCategory(undefined)).toBeNull();
  });
});
```

- [ ] **Step 3: Implement supplementLookup.js**

Create `src/utils/supplementLookup.js`:
```js
export const CATEGORY_HALF_LIVES = { fast: 0.5, moderate: 3, slow: 21 };

// Each entry: [tokens to match, category]
// Tokens are lowercase. A supplement matches if it contains any token set.
const LOOKUP_TABLE = [
  // Fast (~12 hours) — water-soluble vitamins, amino acids
  [['vitamin', 'c'], 'fast'],
  [['vitamin', 'b'], 'fast'],
  [['b1'], 'fast'],
  [['b2'], 'fast'],
  [['b3'], 'fast'],
  [['b5'], 'fast'],
  [['b6'], 'fast'],
  [['b12'], 'fast'],
  [['thiamine'], 'fast'],
  [['riboflavin'], 'fast'],
  [['niacin'], 'fast'],
  [['biotin'], 'fast'],
  [['folate'], 'fast'],
  [['folic', 'acid'], 'fast'],
  [['caffeine'], 'fast'],
  [['l-theanine'], 'fast'],
  [['theanine'], 'fast'],
  [['creatine'], 'fast'],
  [['glutamine'], 'fast'],
  [['taurine'], 'fast'],
  [['glycine'], 'fast'],
  [['melatonin'], 'fast'],
  [['ashwagandha'], 'fast'],

  // Moderate (~3 days) — minerals, some compounds
  [['magnesium'], 'moderate'],
  [['mag'], 'moderate'],
  [['zinc'], 'moderate'],
  [['iron'], 'moderate'],
  [['selenium'], 'moderate'],
  [['calcium'], 'moderate'],
  [['potassium'], 'moderate'],
  [['chromium'], 'moderate'],
  [['copper'], 'moderate'],
  [['manganese'], 'moderate'],
  [['iodine'], 'moderate'],
  [['coq10'], 'moderate'],
  [['probiotics'], 'moderate'],
  [['turmeric'], 'moderate'],
  [['curcumin'], 'moderate'],
  [['berberine'], 'moderate'],
  [['nac'], 'moderate'],
  [['alpha', 'lipoic'], 'moderate'],

  // Slow (~21 days) — fat-soluble vitamins, accumulated compounds
  [['vitamin', 'd'], 'slow'],
  [['vitamin', 'k'], 'slow'],
  [['vitamin', 'a'], 'slow'],
  [['vitamin', 'e'], 'slow'],
  [['fish', 'oil'], 'slow'],
  [['omega'], 'slow'],
  [['dha'], 'slow'],
  [['epa'], 'slow'],
  [['retinol'], 'slow'],
  [['cholecalciferol'], 'slow'],
  [['tocopherol'], 'slow'],
];

/**
 * Case-insensitive token matching against the lookup table.
 * Returns category string ('fast'|'moderate'|'slow') or null.
 */
export function matchSupplementCategory(name) {
  if (!name || typeof name !== 'string') return null;
  const nameTokens = name.toLowerCase().split(/[\s\-\/,]+/).filter(Boolean);
  if (nameTokens.length === 0) return null;

  for (const [matchTokens, category] of LOOKUP_TABLE) {
    if (matchTokens.every(token =>
      nameTokens.some(nt => nt.includes(token) || token.includes(nt))
    )) {
      return category;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/supplementLookup.test.js`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/utils/supplementLookup.js src/utils/__tests__/supplementLookup.test.js
git commit -m "feat: add supplement half-life lookup module"
```

---

### Task 3: Dose Transforms Module — Weekly & Monthly Aggregation

**Files:**
- Create: `src/utils/doseTransforms.js`
- Create: `src/utils/__tests__/doseTransforms.test.js`

- [ ] **Step 1: Write failing tests for aggregateWeekly**

Create `src/utils/__tests__/doseTransforms.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { aggregateWeekly } from '../doseTransforms';

describe('aggregateWeekly', () => {
  // Mon Mar 2 to Sun Mar 15, 2026 = two full weeks
  const dates = [];
  for (let d = 2; d <= 15; d++) {
    dates.push(`2026-03-${String(d).padStart(2, '0')}`);
  }
  // 14 values: 100mg daily
  const series = Array(14).fill(100);

  it('returns average daily dose per week by default', () => {
    const result = aggregateWeekly(series, dates, 'average');
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toBe(100); // avg of 100*7
    expect(result.values[1]).toBe(100);
    expect(result.dates).toHaveLength(2);
    expect(result.labels).toHaveLength(2);
  });

  it('returns total dose per week', () => {
    const result = aggregateWeekly(series, dates, 'total');
    expect(result.values[0]).toBe(700);
    expect(result.values[1]).toBe(700);
  });

  it('labels are Monday dates', () => {
    const result = aggregateWeekly(series, dates, 'average');
    expect(result.labels[0]).toBe('2026-03-02');
    expect(result.labels[1]).toBe('2026-03-09');
  });

  it('handles partial weeks', () => {
    // Wed Mar 4 to Tue Mar 10 = partial first week (5 days) + partial second (2 days)
    const partialDates = dates.slice(2, 9); // Mar 4-10
    const partialSeries = Array(7).fill(100);
    const result = aggregateWeekly(partialSeries, partialDates, 'total');
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toBe(500); // Wed-Sun = 5 days (week of Mar 2)
    expect(result.values[1]).toBe(200); // Mon-Tue = 2 days (week of Mar 9)
  });

  it('handles null values by excluding from average', () => {
    const withNulls = [100, null, 100, null, 100, null, 100, ...Array(7).fill(200)];
    const result = aggregateWeekly(withNulls, dates, 'average');
    expect(result.values[0]).toBe(100); // avg of non-null: 4*100/4
    expect(result.values[1]).toBe(200);
  });

  it('returns empty arrays for all-null input', () => {
    const result = aggregateWeekly(Array(14).fill(null), dates, 'average');
    expect(result.values).toEqual([]);
    expect(result.dates).toEqual([]);
    expect(result.labels).toEqual([]);
  });
});
```

Run: `npx vitest run src/utils/__tests__/doseTransforms.test.js`
Expected: FAIL — module not found

- [ ] **Step 2: Write failing tests for aggregateMonthly**

Add to the test file:
```js
import { aggregateMonthly } from '../doseTransforms';

describe('aggregateMonthly', () => {
  // Jan 1 to Feb 28, 2026 = two months
  const dates = [];
  for (let m = 1; m <= 2; m++) {
    const daysInMonth = m === 1 ? 31 : 28;
    for (let d = 1; d <= daysInMonth; d++) {
      dates.push(`2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }
  const series = Array(59).fill(100);

  it('returns average daily dose per month', () => {
    const result = aggregateMonthly(series, dates, 'average');
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toBe(100);
    expect(result.values[1]).toBe(100);
  });

  it('returns total dose per month', () => {
    const result = aggregateMonthly(series, dates, 'total');
    expect(result.values[0]).toBe(3100); // 31 days * 100
    expect(result.values[1]).toBe(2800); // 28 days * 100
  });

  it('labels are month names', () => {
    const result = aggregateMonthly(series, dates, 'average');
    expect(result.labels[0]).toBe('Jan');
    expect(result.labels[1]).toBe('Feb');
  });

  it('returns empty arrays for all-null input', () => {
    const result = aggregateMonthly(Array(59).fill(null), dates, 'average');
    expect(result.values).toEqual([]);
  });
});
```

- [ ] **Step 3: Write failing test for aggregateDaily (passthrough)**

Add to the test file:
```js
import { aggregateDaily } from '../doseTransforms';

describe('aggregateDaily', () => {
  it('returns input unchanged', () => {
    const dates = ['2026-03-01', '2026-03-02', '2026-03-03'];
    const series = [100, null, 200];
    const result = aggregateDaily(series, dates);
    expect(result.values).toEqual([100, null, 200]);
    expect(result.dates).toEqual(dates);
    expect(result.labels).toEqual(dates);
  });
});
```

- [ ] **Step 4: Implement aggregation functions in doseTransforms.js**

Create `src/utils/doseTransforms.js`:
```js
/**
 * Passthrough — returns data as-is.
 */
export function aggregateDaily(series, dates) {
  return { values: [...series], dates: [...dates], labels: [...dates] };
}

/**
 * Get ISO week start (Monday) for a given date string.
 */
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Get month key (YYYY-MM) for a given date string.
 */
function getMonthKey(dateStr) {
  return dateStr.slice(0, 7);
}

/**
 * Get midpoint date from an array of date strings.
 */
function getMidpointDate(dates) {
  const midIdx = Math.floor((dates.length - 1) / 2);
  return dates[midIdx];
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Group series by period, compute avg or total.
 * Returns { values, dates, labels } — empty arrays if all null.
 */
function aggregateByPeriod(series, dates, mode, getKey, getLabel) {
  // Group into periods
  const periods = [];
  let currentKey = null;
  let currentGroup = null;

  for (let i = 0; i < dates.length; i++) {
    const key = getKey(dates[i]);
    if (key !== currentKey) {
      if (currentGroup) periods.push(currentGroup);
      currentKey = key;
      currentGroup = { key, values: [], dates: [] };
    }
    currentGroup.values.push(series[i]);
    currentGroup.dates.push(dates[i]);
  }
  if (currentGroup) periods.push(currentGroup);

  // Compute aggregates, skip all-null periods
  const result = { values: [], dates: [], labels: [] };
  for (const period of periods) {
    const nonNull = period.values.filter(v => v !== null && v !== undefined);
    if (nonNull.length === 0) continue;

    const total = nonNull.reduce((s, v) => s + v, 0);
    result.values.push(mode === 'total' ? total : total / nonNull.length);
    result.dates.push(getMidpointDate(period.dates));
    result.labels.push(getLabel(period));
  }
  return result;
}

/**
 * Aggregate by ISO calendar week (Monday start).
 */
export function aggregateWeekly(series, dates, mode) {
  return aggregateByPeriod(series, dates, mode, getWeekStart,
    (period) => getWeekStart(period.dates[0])
  );
}

/**
 * Aggregate by calendar month.
 */
export function aggregateMonthly(series, dates, mode) {
  return aggregateByPeriod(series, dates, mode, getMonthKey,
    (period) => {
      const monthIdx = parseInt(period.key.slice(5, 7), 10) - 1;
      return MONTH_NAMES[monthIdx];
    }
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/doseTransforms.test.js`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/utils/doseTransforms.js src/utils/__tests__/doseTransforms.test.js
git commit -m "feat: add weekly/monthly dose aggregation transforms"
```

---

### Task 4: Dose Transforms — Cumulative Body Level

**Files:**
- Modify: `src/utils/doseTransforms.js`
- Modify: `src/utils/__tests__/doseTransforms.test.js`

- [ ] **Step 1: Write failing tests for computeCumulativeLevel**

Add to `src/utils/__tests__/doseTransforms.test.js`:
```js
import { computeCumulativeLevel } from '../doseTransforms';

describe('computeCumulativeLevel', () => {
  const dates = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];

  it('accumulates with decay for moderate category', () => {
    const series = [100, 100, 100, 100, 100];
    const result = computeCumulativeLevel(series, dates, 'moderate');
    expect(result.values).toHaveLength(5);
    expect(result.dates).toEqual(dates);
    // Day 1: 0 * decay + 100 = 100
    expect(result.values[0]).toBeCloseTo(100);
    // Day 2: 100 * decay + 100 > 100 (accumulating)
    expect(result.values[1]).toBeGreaterThan(100);
    // Each day should be higher than the last (accumulating)
    for (let i = 1; i < 5; i++) {
      expect(result.values[i]).toBeGreaterThan(result.values[i - 1]);
    }
  });

  it('decays when doses are missed', () => {
    const series = [100, 100, null, null, null];
    const result = computeCumulativeLevel(series, dates, 'moderate');
    // After two doses, level should decrease on null days
    expect(result.values[2]).toBeLessThan(result.values[1]);
    expect(result.values[3]).toBeLessThan(result.values[2]);
    expect(result.values[4]).toBeLessThan(result.values[3]);
    // But never negative
    expect(result.values[4]).toBeGreaterThan(0);
  });

  it('fast decay clears faster than slow', () => {
    const series = [1000, null, null, null, null];
    const fast = computeCumulativeLevel(series, dates, 'fast');
    const slow = computeCumulativeLevel(series, dates, 'slow');
    // After 4 days of no dosing, fast should be much lower
    expect(fast.values[4]).toBeLessThan(slow.values[4]);
  });

  it('defaults to moderate when category is null', () => {
    const series = [100, 100, 100, 100, 100];
    const withNull = computeCumulativeLevel(series, dates, null);
    const withModerate = computeCumulativeLevel(series, dates, 'moderate');
    expect(withNull.values).toEqual(withModerate.values);
  });

  it('returns continuous array with no nulls', () => {
    const series = [100, null, 100, null, 100];
    const result = computeCumulativeLevel(series, dates, 'moderate');
    result.values.forEach(v => {
      expect(v).not.toBeNull();
      expect(typeof v).toBe('number');
    });
  });

  it('starts from zero (no prior supplementation)', () => {
    const series = [0, 0, 0, 0, 100];
    const result = computeCumulativeLevel(series, dates, 'moderate');
    expect(result.values[0]).toBe(0);
    expect(result.values[3]).toBe(0);
    expect(result.values[4]).toBe(100);
  });
});
```

Run: `npx vitest run src/utils/__tests__/doseTransforms.test.js`
Expected: FAIL — computeCumulativeLevel not found

- [ ] **Step 2: Implement computeCumulativeLevel**

Add to `src/utils/doseTransforms.js`:
```js
import { CATEGORY_HALF_LIVES } from './supplementLookup';

/**
 * Compute estimated body level using exponential decay model.
 * Receives raw series (with nulls). Nulls treated as dose=0.
 * Returns continuous array with no nulls.
 */
export function computeCumulativeLevel(series, dates, halfLifeCategory) {
  const halfLife = CATEGORY_HALF_LIVES[halfLifeCategory] || CATEGORY_HALF_LIVES.moderate;
  const decayFactor = Math.pow(0.5, 1 / halfLife);

  const values = [];
  let bodyLevel = 0;

  for (let i = 0; i < series.length; i++) {
    const dose = (series[i] !== null && series[i] !== undefined) ? series[i] : 0;
    bodyLevel = bodyLevel * decayFactor + dose;
    values.push(bodyLevel);
  }

  return { values, dates: [...dates], labels: [...dates] };
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/doseTransforms.test.js`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/utils/doseTransforms.js src/utils/__tests__/doseTransforms.test.js
git commit -m "feat: add cumulative body level transform with exponential decay"
```

---

### Task 5: Dose Transforms — Symptom Aggregation

**Files:**
- Modify: `src/utils/doseTransforms.js`
- Modify: `src/utils/__tests__/doseTransforms.test.js`

- [ ] **Step 1: Write failing tests for aggregateSymptoms**

Add to the test file:
```js
import { aggregateSymptoms } from '../doseTransforms';

describe('aggregateSymptoms', () => {
  // Two full ISO weeks: Mon Mar 2 - Sun Mar 15
  const dates = [];
  for (let d = 2; d <= 15; d++) {
    dates.push(`2026-03-${String(d).padStart(2, '0')}`);
  }

  it('passes through for daily view', () => {
    const series = [3, null, 4, 2, 5, null, 1, 3, 4, 2, 5, 3, 1, 4];
    const result = aggregateSymptoms(series, dates, 'daily');
    expect(result.values).toEqual(series);
    expect(result.dates).toEqual(dates);
  });

  it('passes through for cumulative view', () => {
    const series = [3, null, 4, 2, 5, null, 1, 3, 4, 2, 5, 3, 1, 4];
    const result = aggregateSymptoms(series, dates, 'cumulative');
    expect(result.values).toEqual(series);
  });

  it('averages non-null values per week for weekly view', () => {
    // Week 1: [3, null, 4, 2, 5, null, 1] → avg of non-null = (3+4+2+5+1)/5 = 3
    // Week 2: [3, 4, 2, 5, 3, 1, 4] → avg = (3+4+2+5+3+1+4)/7 = 22/7 ≈ 3.14
    const series = [3, null, 4, 2, 5, null, 1, 3, 4, 2, 5, 3, 1, 4];
    const result = aggregateSymptoms(series, dates, 'weekly');
    expect(result.values).toHaveLength(2);
    expect(result.values[0]).toBe(3);
    expect(result.values[1]).toBeCloseTo(22 / 7);
  });

  it('averages per month for monthly view', () => {
    const monthDates = [];
    for (let d = 1; d <= 28; d++) {
      monthDates.push(`2026-02-${String(d).padStart(2, '0')}`);
    }
    const series = Array(28).fill(4);
    const result = aggregateSymptoms(series, monthDates, 'monthly');
    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toBe(4);
  });

  it('skips all-null periods', () => {
    const series = Array(14).fill(null);
    const result = aggregateSymptoms(series, dates, 'weekly');
    expect(result.values).toEqual([]);
  });
});
```

Run: `npx vitest run src/utils/__tests__/doseTransforms.test.js`
Expected: FAIL — aggregateSymptoms not found

- [ ] **Step 2: Implement aggregateSymptoms**

Add to `src/utils/doseTransforms.js`:
```js
/**
 * Aggregate symptom data by view mode.
 * Receives already-smoothed data from ComparisonStudio.
 * Weekly/Monthly: averages non-null values per period.
 * Daily/Cumulative: passthrough.
 */
export function aggregateSymptoms(series, dates, viewMode) {
  if (viewMode === 'daily' || viewMode === 'cumulative') {
    return { values: [...series], dates: [...dates], labels: [...dates] };
  }
  const getKey = viewMode === 'weekly' ? getWeekStart : getMonthKey;
  const getLabel = viewMode === 'weekly'
    ? (period) => getWeekStart(period.dates[0])
    : (period) => {
        const monthIdx = parseInt(period.key.slice(5, 7), 10) - 1;
        return MONTH_NAMES[monthIdx];
      };
  return aggregateByPeriod(series, dates, 'average', getKey, getLabel);
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/doseTransforms.test.js`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/utils/doseTransforms.js src/utils/__tests__/doseTransforms.test.js
git commit -m "feat: add symptom aggregation for weekly/monthly views"
```

---

### Task 6: ComparisonStudio — View Mode Selector UI

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

This task adds the view mode buttons and state management only. No data transformation yet — the chart still shows daily data regardless of selection.

- [ ] **Step 1: Add viewMode and aggMode state**

In `ComparisonStudio.jsx`, near the existing state declarations (around line 35), add:
```js
const [viewMode, setViewMode] = useState('daily');
const [aggMode, setAggMode] = useState('average');
```

- [ ] **Step 2: Persist viewMode and aggMode in localStorage**

Update the existing `localStorage.setItem` call (around line 106-109) to include the new fields:
```js
localStorage.setItem(STORAGE_KEY, JSON.stringify({
  supplement: selectedSupplement,
  symptoms: selectedSymptoms,
  viewMode,
  aggMode,
}));
```

Update the loading logic (around line 58-80) to restore these values:
```js
// After existing loading code, add:
if (saved.viewMode && ['daily', 'weekly', 'monthly', 'cumulative'].includes(saved.viewMode)) {
  setViewMode(saved.viewMode);
}
if (saved.aggMode && ['average', 'total'].includes(saved.aggMode)) {
  setAggMode(saved.aggMode);
}
```

- [ ] **Step 3: Add view mode selector UI (desktop)**

In the desktop chart section, just above the existing timeframe selector (around line 872), add the view mode pill group:
```jsx
{/* View Mode Selector */}
<div style={{
  display: 'flex', gap: '0',
  borderRadius: '7px',
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  padding: '2px',
  marginBottom: '8px',
}}>
  {['daily', 'weekly', 'monthly', 'cumulative'].map(mode => (
    <button key={mode}
      onClick={() => { setViewMode(mode); haptic('light'); }}
      style={{
        padding: '3px 0',
        flex: 1,
        borderRadius: '5px', border: 'none',
        background: viewMode === mode ? 'rgba(255,255,255,0.12)' : 'transparent',
        color: viewMode === mode ? '#fff' : '#6b7280',
        fontSize: '10px', fontWeight: '500', cursor: 'pointer',
        textTransform: 'capitalize',
      }}
    >
      {mode}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Add avg/total toggle (desktop)**

Below the view mode selector, conditionally show the avg/total toggle:
```jsx
{(viewMode === 'weekly' || viewMode === 'monthly') && (
  <div style={{
    display: 'flex', gap: '0',
    borderRadius: '7px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    padding: '2px',
    marginBottom: '8px',
    maxWidth: '160px',
  }}>
    {['average', 'total'].map(mode => (
      <button key={mode}
        onClick={() => { setAggMode(mode); haptic('light'); }}
        style={{
          padding: '3px 0',
          flex: 1,
          borderRadius: '5px', border: 'none',
          background: aggMode === mode ? 'rgba(255,255,255,0.12)' : 'transparent',
          color: aggMode === mode ? '#fff' : '#6b7280',
          fontSize: '10px', fontWeight: '500', cursor: 'pointer',
          textTransform: 'capitalize',
        }}
      >
        {mode === 'average' ? 'Avg/Day' : 'Total'}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 5: Replicate view mode selector in mobile section**

Add the same two controls in the mobile chart section (around line 1029), just above the existing mobile timeframe selector. Use the same code but with mobile styling (`padding: '5px 0'`, `fontSize: '11px'`, `marginBottom: '6px'`).

- [ ] **Step 6: Verify in browser**

Run: `npm run dev`
Check: View mode buttons appear above timeframe selector. Avg/Total toggle appears only for Weekly/Monthly. Selection persists on page reload. Daily view shows existing chart unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: add view mode selector UI to ComparisonStudio"
```

---

### Task 7: ComparisonStudio — Wire Up Data Transforms

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

This task connects the view mode selection to actual data transformation.

- [ ] **Step 1: Import transform functions**

At the top of `ComparisonStudio.jsx`, add:
```js
import { aggregateDaily, aggregateWeekly, aggregateMonthly, computeCumulativeLevel, aggregateSymptoms } from '../utils/doseTransforms';
```

- [ ] **Step 2: Add a helper to pick the right supplement transform**

Inside the component, add a helper:
```js
const transformDose = useCallback((series, dates) => {
  switch (viewMode) {
    case 'weekly': return aggregateWeekly(series, dates, aggMode);
    case 'monthly': return aggregateMonthly(series, dates, aggMode);
    case 'cumulative': {
      const item = (stackItems || []).find(i => i.id === selectedSupplement);
      const category = item?.halfLifeCategory || null;
      return computeCumulativeLevel(series, dates, category);
    }
    default: return aggregateDaily(series, dates);
  }
}, [viewMode, aggMode, stackItems, selectedSupplement]);
```

- [ ] **Step 3: Apply transform to supplement dose data**

Find the existing `suppDoseRaw` useMemo (around line 162). Replace it with a two-stage pipeline:

```js
// Stage 1: raw dose series (existing logic)
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
  // For cumulative view, keep nulls (computeCumulativeLevel handles them)
  // For other views, fill nulls with 0
  if (viewMode === 'cumulative') return capped;
  return capped.map(v => v === null ? 0 : v);
}, [selectedSupplement, stackEntries, stackItems, dates, viewMode]);

// Stage 2: apply view transform
const suppTransformed = useMemo(() => {
  if (!suppDoseDaily) return null;
  return transformDose(suppDoseDaily, dates);
}, [suppDoseDaily, dates, transformDose]);
```

- [ ] **Step 4: Apply transform to symptom data**

Update the existing `symptomData` useMemo to also produce transformed data:

```js
const symptomTransformed = useMemo(() =>
  selectedSymptoms.map(symId => {
    const filled = interpolateSmallGaps(getSymptomDailySeries(entries, symId, dates, trackingMode));
    const smoothed = smooth(filled, windowSize);
    const transformed = aggregateSymptoms(smoothed, dates, viewMode);
    return { raw: filled, smoothed, transformed };
  }),
  [selectedSymptoms, entries, dates, trackingMode, windowSize, viewMode]
);
```

- [ ] **Step 5: Update point generation to use transformed data**

Replace the existing `suppPoints` useMemo with one that uses transformed data:

```js
const suppPoints = useMemo(() => {
  if (!suppTransformed) return null;
  const { values, dates: txDates } = suppTransformed;
  const maxIdx = Math.max(1, txDates.length - 1);
  // Map transformed dates to x positions relative to the full date range
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
```

Update `suppYMax` to use the transformed values. **Important: `suppYMax` must remain declared before `suppPoints`** (maintaining current code order) since `suppPoints` depends on it:
```js
const suppYMax = useMemo(() => {
  if (!suppTransformed) return 1;
  const max = Math.max(...suppTransformed.values.filter(v => v !== null));
  return max > 0 ? max : 1;
}, [suppTransformed]);
```

Do the same for symptom points — update them to use `symptomTransformed[idx].transformed` instead of `symptomData[idx].smoothed`.

- [ ] **Step 6: Update X-axis labels for aggregated views**

Update the `xLabels` useMemo to use transformed labels when in weekly/monthly view:

```js
const xLabels = useMemo(() => {
  if (viewMode === 'weekly' || viewMode === 'monthly') {
    if (!suppTransformed) return [];
    return suppTransformed.dates.map((dateStr, i) => {
      const dateIdx = dates.indexOf(dateStr);
      const x = dateIdx >= 0
        ? padLeft + (dateIdx / Math.max(1, dates.length - 1)) * chartW
        : padLeft + (i / Math.max(1, suppTransformed.dates.length - 1)) * chartW;
      return { x, label: suppTransformed.labels[i] };
    });
  }
  // Daily/Cumulative: existing label logic
  const labels = [];
  for (let i = 0; i < dates.length; i += interval) {
    labels.push({
      x: padLeft + (i / Math.max(1, dates.length - 1)) * chartW,
      label: formatXLabel(dates[i], timeframe),
    });
  }
  return labels;
}, [viewMode, suppTransformed, dates, interval, chartW, timeframe]);
```

- [ ] **Step 7: Adapt crosshair and touch interactions for aggregated views**

The existing crosshair logic (`getSnappedIndex`, `crosshairData`) indexes into the daily `dates` array and uses `suppPoints[touchX]` to look up values. In weekly/monthly views, `suppPoints` has far fewer entries than `dates.length`, so direct index lookup would break.

Update `getSnappedIndex` to snap to the nearest **transformed data point** when in weekly/monthly view:

```js
const getSnappedIndex = useCallback((clientX) => {
  if (!svgRef.current) return null;
  const rect = svgRef.current.getBoundingClientRect();
  const xPx = (clientX - rect.left) / rect.width * W;

  if ((viewMode === 'weekly' || viewMode === 'monthly') && suppPoints) {
    // Snap to nearest transformed point
    let minDist = Infinity, bestIdx = 0;
    for (let i = 0; i < suppPoints.length; i++) {
      const dist = Math.abs(suppPoints[i].x - xPx);
      if (dist < minDist) { minDist = dist; bestIdx = i; }
    }
    return bestIdx;
  }
  // Daily/Cumulative: snap to daily index as before
  const idx = Math.round((xPx - padLeft) / chartW * (dates.length - 1));
  return Math.max(0, Math.min(dates.length - 1, idx));
}, [chartW, dates.length, viewMode, suppPoints]);
```

Update `crosshairData` to use the right data source:

```js
const crosshairData = useMemo(() => {
  if (touchX === null) return null;

  let dateLabel, suppVal, suppX, symptomVals;

  if (viewMode === 'weekly' || viewMode === 'monthly') {
    // touchX is an index into the transformed arrays
    const txDate = suppTransformed?.labels?.[touchX];
    dateLabel = viewMode === 'weekly'
      ? formatXLabelWeekly(txDate)
      : txDate;
    suppVal = suppPoints?.[touchX]?.val;
    suppX = suppPoints?.[touchX]?.x;
    symptomVals = selectedSymptoms.map((_, idx) => {
      const symTx = symptomTransformed[idx]?.transformed;
      return symTx?.values?.[touchX] ?? null;
    });
  } else {
    // Daily/Cumulative: touchX is daily index
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
```

Also update `legendItems` to reference `suppTransformed` instead of `suppDoseRaw` for the average calculation when not hovering.

- [ ] **Step 8: Verify in browser**

Run: `npm run dev`
Check:
- Daily view: unchanged from before
- Weekly view: fewer data points, line connects weekly averages/totals, crosshair snaps to weekly points
- Monthly view: even fewer points, monthly aggregation, crosshair snaps to monthly points
- Cumulative view: rising curve that decays on missed days, crosshair shows daily values
- Symptom overlays adapt to weekly/monthly grouping
- X-axis labels change appropriately
- Mobile swipe-to-pan still works in all views

- [ ] **Step 9: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: wire up dose/symptom transforms to ComparisonStudio chart"
```

---

### Task 8: Cumulative View — Area Fill

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Add area fill path for cumulative view**

In the SVG section where the supplement line is rendered (around line 1000-1007 for desktop, around line 1115-1122 for mobile), add an area fill path just before the existing line `<path>`:

```jsx
{viewMode === 'cumulative' && suppPoints && (
  <path
    d={(() => {
      const validPoints = suppPoints.filter(pt => pt.y !== null);
      if (validPoints.length === 0) return '';
      let d = `M${validPoints[0].x},${padTop + chartH}`;
      d += `L${validPoints[0].x},${validPoints[0].y}`;
      for (let i = 1; i < validPoints.length; i++) {
        d += `L${validPoints[i].x},${validPoints[i].y}`;
      }
      d += `L${validPoints[validPoints.length - 1].x},${padTop + chartH}Z`;
      return d;
    })()}
    fill={SUPP_COLOR}
    fillOpacity="0.12"
    stroke="none"
  />
)}
```

- [ ] **Step 2: Verify in browser**

Run: `npm run dev`
Check: Cumulative view shows translucent fill under the dose curve. Other views have no fill. Fill extends from the line down to the chart bottom.

- [ ] **Step 3: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: add area fill under cumulative dose curve"
```

---

### Task 9: Inline Half-Life Category Editor

**Files:**
- Modify: `src/App.jsx:758,1215` — pass `setStackItems` to Insights
- Modify: `src/components/Insights.jsx:42-55,128-135` — accept and forward `setStackItems` to ComparisonStudio
- Modify: `src/components/ComparisonStudio.jsx:21-28` — accept `setStackItems` prop

- [ ] **Step 1: Thread `setStackItems` prop through to ComparisonStudio**

`setStackItems` is defined in `App.jsx` but not currently passed to Insights or ComparisonStudio. Thread it through:

In `App.jsx`, add `setStackItems={setStackItems}` to both Insights invocations:
- Desktop inline (around line 758): `<Insights ... setStackItems={setStackItems} />`
- Mobile overlay (around line 1215): `<Insights ... setStackItems={setStackItems} />`

In `Insights.jsx`, add `setStackItems` to the destructured props (line 42-55) and pass it to ComparisonStudio (line 128-135):
```jsx
<ComparisonStudio
  entries={entries}
  symptoms={symptoms}
  stackItems={stackItems}
  stackEntries={stackEntries}
  trackingMode={trackingMode}
  isDesktop={isDesktop}
  setStackItems={setStackItems}
/>
```

In `ComparisonStudio.jsx`, add `setStackItems` to the destructured props (line 21-28):
```js
export default function ComparisonStudio({
  entries, symptoms, stackItems, stackEntries, trackingMode, isDesktop, setStackItems,
}) {
```

- [ ] **Step 2: Add inline category badge and picker state**

Add state for the picker:
```js
const [showCategoryPicker, setShowCategoryPicker] = useState(false);
```

Find where the selected supplement name is displayed near the top of the chart area. Add the category badge right after it, only when cumulative view is active:

```jsx
{viewMode === 'cumulative' && selectedSupplement && (() => {
  const item = (stackItems || []).find(i => i.id === selectedSupplement);
  const category = item?.halfLifeCategory
    || matchSupplementCategory(item?.name)
    || 'moderate';
  const isDefault = !item?.halfLifeCategory;
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setShowCategoryPicker(prev => !prev)}
        style={{
          padding: '2px 8px',
          borderRadius: '10px',
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(139,92,246,0.15)',
          color: '#a78bfa',
          fontSize: '10px',
          cursor: 'pointer',
          marginLeft: '8px',
        }}
      >
        {category.charAt(0).toUpperCase() + category.slice(1)}
        {isDefault ? ' (default)' : ''} decay
      </button>
      {showCategoryPicker && (
        <div style={{
          position: 'absolute', top: '100%', left: '8px',
          marginTop: '4px', zIndex: 10,
          background: '#1e293b', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '8px', padding: '4px', minWidth: '120px',
        }}>
          {['fast', 'moderate', 'slow'].map(cat => (
            <button key={cat}
              onClick={() => {
                // Update the supplement's halfLifeCategory (functional updater required)
                setStackItems(prev => prev.map(i =>
                  i.id === selectedSupplement ? { ...i, halfLifeCategory: cat } : i
                ));
                setShowCategoryPicker(false);
                haptic('light');
              }}
              style={{
                display: 'block', width: '100%', padding: '6px 10px',
                border: 'none', borderRadius: '4px',
                background: cat === category ? 'rgba(139,92,246,0.2)' : 'transparent',
                color: '#e2e8f0', fontSize: '12px', cursor: 'pointer',
                textAlign: 'left', textTransform: 'capitalize',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
    </div>
  );
})()}
```

- [ ] **Step 3: Import matchSupplementCategory**

Add at the top:
```js
import { matchSupplementCategory } from '../utils/supplementLookup';
```

- [ ] **Step 4: Close picker when clicking outside or changing view mode**

Add effect to close picker:
```js
useEffect(() => {
  setShowCategoryPicker(false);
}, [viewMode, selectedSupplement]);
```

- [ ] **Step 5: Verify in browser**

Run: `npm run dev`
Check: Badge appears next to supplement name only in cumulative view. Shows "Moderate (default)" for supplements without a set category. Tapping opens picker. Selecting a category updates the chart immediately.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/Insights.jsx src/components/ComparisonStudio.jsx
git commit -m "feat: add inline half-life category editor in cumulative view"
```

---

### Task 10: Supplement Settings — Advanced Decay Rate

**Files:**
- Modify: `src/components/SupplementEdit.jsx:318`
- Modify: `src/components/Stack.jsx:911`

- [ ] **Step 1: Add decay rate to SupplementEdit.jsx**

After the Schedule section (line 318), before the History section (line 320), add a collapsible Advanced section:

```jsx
{/* Advanced Settings */}
<div style={{ marginBottom: '24px' }}>
  <button
    onClick={() => setShowAdvanced(prev => !prev)}
    style={{
      background: 'none', border: 'none', cursor: 'pointer',
      color: '#64748b', fontSize: '12px', fontWeight: '500',
      padding: '0', display: 'flex', alignItems: 'center', gap: '4px',
    }}
  >
    <span style={{
      transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s', display: 'inline-block', fontSize: '10px',
    }}>▶</span>
    Advanced
  </button>
  {showAdvanced && (
    <div style={{ marginTop: '12px' }}>
      <label style={{
        color: '#94a3b8', fontSize: '13px', fontWeight: '500',
        marginBottom: '6px', display: 'block',
      }}>
        Decay Rate
      </label>
      <select
        value={formData.halfLifeCategory || ''}
        onChange={(e) => setFormData({ ...formData, halfLifeCategory: e.target.value || null })}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(255,255,255,0.06)', color: '#e2e8f0',
          fontSize: '14px',
        }}
      >
        <option value="">Auto / Default (Moderate)</option>
        <option value="fast">Fast (~12 hours)</option>
        <option value="moderate">Moderate (~3 days)</option>
        <option value="slow">Slow (~21 days)</option>
      </select>
      <div style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>
        Controls how the cumulative body level chart models this supplement's clearance rate.
      </div>
    </div>
  )}
</div>
```

Add state for the collapsible:
```js
const [showAdvanced, setShowAdvanced] = useState(false);
```

Update `formData` initialization (around line 7-13) to include `halfLifeCategory`:
```js
const [formData, setFormData] = useState({
  name: item.name || '',
  description: item.description || '',
  defaultDose: item.defaultDose || '',
  unit: item.unit || 'mg',
  schedule: item.schedule || { type: 'daily' },
  halfLifeCategory: item.halfLifeCategory || null,
});
```

Update `handleSave` (around line 60-68) to include `halfLifeCategory` in the saved data:
```js
onSave({
  name: formData.name,
  description: formData.description,
  defaultDose: formData.defaultDose,
  unit: formData.unit,
  schedule: formData.schedule,
  halfLifeCategory: formData.halfLifeCategory,
});
```

In `Stack.jsx`, update `handleSupplementSave` (around line 220-226) to extract `halfLifeCategory` into `newValues`:
```js
halfLifeCategory: updatedData.halfLifeCategory ?? item.halfLifeCategory ?? null,
```

- [ ] **Step 2: Add decay rate to Stack.jsx add form**

After the Schedule section in the add form (around line 911), add the same collapsible Advanced section with the same pattern. In the `addStackItem` function (around line 155-164), include `halfLifeCategory` in the new item:

```js
const newItem = {
  // ...existing fields...
  halfLifeCategory: newStackItem.halfLifeCategory || null,
};
```

Also run auto-detection when creating:
```js
import { matchSupplementCategory } from '../utils/supplementLookup';

// In addStackItem, before creating newItem:
const autoCategory = matchSupplementCategory(newStackItem.name.trim());
const newItem = {
  // ...existing fields...
  halfLifeCategory: newStackItem.halfLifeCategory || autoCategory || null,
};
```

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`
Check: Advanced section is collapsed by default in both edit and add forms. Expanding shows decay rate dropdown. Saving persists the value. Auto-detection works on new supplement creation.

- [ ] **Step 4: Commit**

```bash
git add src/components/SupplementEdit.jsx src/components/Stack.jsx
git commit -m "feat: add optional decay rate setting in supplement advanced settings"
```

---

### Task 11: X-Axis Label Formatting for Aggregated Views

**Files:**
- Modify: `src/utils/chartHelpers.js`

- [ ] **Step 1: Add weekly/monthly label formatters**

Add to `chartHelpers.js`:

```js
export function formatXLabelWeekly(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
```

Note: Monthly labels come pre-formatted as month names ("Jan", "Feb") from the transform, so no formatter is needed.

- [ ] **Step 2: Update ComparisonStudio x-axis label formatting**

In ComparisonStudio, update the weekly/monthly label rendering to use `formatXLabelWeekly` for the weekly labels (which are Monday date strings):

```js
// In the xLabels useMemo, for weekly view:
return { x, label: formatXLabelWeekly(suppTransformed.labels[i]) };
```

This formats "2026-03-02" as "Mar 2" which is clean and consistent.

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`
Check: Weekly view shows "Mar 2", "Mar 9" etc. Monthly view shows "Jan", "Feb" etc.

- [ ] **Step 4: Commit**

```bash
git add src/utils/chartHelpers.js src/components/ComparisonStudio.jsx
git commit -m "feat: add x-axis label formatting for weekly/monthly views"
```

---

### Task 12: Final Polish & Version Bump

**Files:**
- Modify: `package.json`
- Modify: `src/components/Settings.jsx`
- Modify: `src/components/QuickActionsMenu.jsx`

- [ ] **Step 1: Verify all tests pass**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Full browser test of all features**

Run: `npm run dev`
Check all scenarios:
- [ ] Daily view: same as before, no regression
- [ ] Weekly view: avg and total modes work, x-axis shows week dates
- [ ] Monthly view: avg and total modes work, x-axis shows month names
- [ ] Cumulative view: rising curve, area fill, decays on missed days
- [ ] Inline category editor: badge shows, picker works, updates chart
- [ ] Supplement settings: advanced section with decay rate
- [ ] New supplement creation: auto-detection via lookup
- [ ] Symptom overlays adapt to all view modes
- [ ] View mode persists in localStorage
- [ ] Avg/total toggle persists in localStorage
- [ ] Desktop and mobile layouts both work

- [ ] **Step 3: Bump version in all 4 locations**

Update version to the next version (check current version first) in:
1. `package.json`
2. `src/components/Settings.jsx` — backup object (~line 79)
3. `src/components/Settings.jsx` — display string (~line 723)
4. `src/components/QuickActionsMenu.jsx`

- [ ] **Step 4: Commit**

```bash
git add package.json src/components/Settings.jsx src/components/QuickActionsMenu.jsx
git commit -m "v<NEW_VERSION>: Add dose analysis views to ComparisonStudio"
```

- [ ] **Step 5: Deploy**

```bash
npm run build && npm run deploy
```
