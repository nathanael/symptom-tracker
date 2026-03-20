# ComparisonStudio Controls Redesign

## Problem

The ComparisonStudio chart controls are cluttered and confusing. Four control groups (view mode, aggregation mode, timeframe range, date navigator) are stacked vertically with no visual hierarchy or labeling. The aggregation mode toggle (Avg/Day vs Total) adds complexity with minimal value.

## Changes

### 1. Remove aggregation mode toggle

Delete the `aggMode` state, the `aggModeToggle` function, and all references. Hard-code `'average'` wherever `aggMode` was used. Remove from localStorage persistence.

**Files:** `src/components/ComparisonStudio.jsx`

**What to delete:**
- `aggMode` state (line ~101)
- `aggMode` in localStorage save/load (lines ~74-76, ~112-118)
- `aggModeToggle` function (lines ~541-567)
- `aggModeToggle(false)` call in desktop render (line ~1128)
- `aggModeToggle(true)` call in mobile render (line ~1258)

**What to change:**
- `transformDose` callback: replace `aggMode` reference with literal `'average'` (line ~191-192)
- Remove `aggMode` from `transformDose` dependency array (line ~200)

### 2. Desktop layout — labeled sections with divider

Reorder and label the controls in the left panel. Current order: view mode → agg toggle → timeframe → navigator. New order with labels:

```
[RANGE label]
[2W] [4W] [2M] [4M] [6M]       ← timeframe pills
|< < Jan 20 — Mar 20 > >|      ← navigator row (8px gap from pills)

────────────────────────────    ← divider (16px margin above/below)

[VIEW label]
[Daily] [Weekly] [Monthly] [Cumul.]  ← view mode pills

Average                         ← legend continues below
● B2
  663.3 mg
```

**Specifics:**
- Section labels: `color: #6b7280`, `fontSize: 11px`, `textTransform: uppercase`, `letterSpacing: 0.05em`, `marginBottom: 6px`
- Gap between range pills and navigator: `8px` (tightly coupled)
- Divider: `borderTop: 1px solid rgba(255,255,255,0.06)`, `margin: 16px 0`
- Gap between view label and view pills: `6px`
- Gap between view pills and legend: `20px` (existing `marginBottom` on current view mode selector)

### 3. Mobile layout — view type below chart

Move view mode selector from above the chart to below it. Only range + navigator sit above the chart.

**Above chart:**
```
[2W] [4W] [2M] [4M] [6M]       ← timeframe pills
|< < Jan 20 — Mar 20 > >|      ← navigator row
```

**Chart area**

**Below chart:**
```
[Daily] [Weekly] [Monthly] [Cumul.]  ← view mode pills
● B2  663.3 mg  |  ● Depression  0.7/5  ← stats row
```

**Specifics:**
- Range pills `marginBottom: 8px`
- Navigator `marginBottom: 10px`
- Chart renders next (no change to SVG)
- View mode pills: `marginTop: 10px`, `marginBottom: 8px`
- Stats row stays in its current position below

## Scope

- Single file: `src/components/ComparisonStudio.jsx`
- No data model changes, no new dependencies
- Cumulative category picker behavior unchanged
- Supplement/symptom selectors unchanged
