# Health Score Feature — Design Spec

**Date:** 2026-03-31
**Status:** Approved

## Overview

A derived "Health Score" percentage (0-100%) representing overall symptom burden. Lower is better — 0% means no symptoms, 100% means all tracked symptoms at maximum severity. Displayed across 6 UI locations on desktop and mobile, and plottable as a chart series in ComparisonStudio.

## Calculation

### Formula

```
score = (sum of logged severities) / (loggedCount × 5) × 100
```

- **Inputs:** Active symptoms list, symptom entries for a given date, tracking mode
- **Logged only:** Only symptoms with actual entries on the date count. Unlogged symptoms are excluded from both numerator and denominator.
- **N/A handling:** Entries with severity -1 (N/A) are excluded from both numerator and denominator.
- **Daily aggregate:** Uses the existing aggregation logic — AM/PM entries are averaged into a single daily value per symptom.
- **Null case:** If no symptoms are logged on a date, score is `null` (displayed as "—").

### Rolling Average

- 7-day rolling average: the score formula applied to each of the past 7 days, then averaged.
- Days with no logged data are excluded from the average (not treated as 0).
- **Early data:** If fewer than 7 days of data exist, the rolling average uses whatever days are available (e.g., 3-day average on day 3). Rolling average is `null` only if zero prior days have data.

### Delta

- `delta = score - rollingAvg` (negative = improving relative to recent trend)
- **Arrow display:** ▼ (green) when delta < 0 (improving), ▲ (red) when delta > 0 (worsening), no arrow when delta is exactly 0 or `null`.

### Color Thresholds

| Range | Color | Meaning |
|-------|-------|---------|
| 0-20% | Green | Low symptom burden |
| 21-50% | Yellow/Amber | Moderate symptom burden |
| 51-100% | Red | High symptom burden |

## Architecture

### Approach: Computed Score Hook (`useHealthScore`)

A React hook that derives the score from existing data. **No new storage, no sync changes.**

```js
useHealthScore(date, { symptoms, entries, trackingMode }) → {
  score: number | null,   // 0-100 percentage
  loggedCount: number,    // symptoms with entries on this date
  totalActive: number,    // count of symptoms with active: true
  rollingAvg: number | null, // 7-day rolling average
  delta: number | null,   // score minus rollingAvg
}
```

**Dependencies:** The hook receives `symptoms` (full array from `symptomTracker_symptoms`), `entries` (from `symptomTracker_entries`), and `trackingMode` as parameters from the calling component. These are already available in all components that will use the hook. Results are wrapped in `useMemo` keyed on `date`, `entries`, and `symptoms` to avoid recomputation.

**Rationale:** Avoids touching the sync engine (critical given prior sync data-loss incidents). The score is always consistent with source data since it's derived, not stored. Computation is trivial — iterating a handful of symptoms per date. Even the chart series generator (180 days × N symptoms) is negligible.

### Chart Series Generator

`getHealthScoreSeries(symptoms, entries, dates, trackingMode)` in `correlationHelpers.js`. Accepts a `dates` array (from `generateDateRange` in `chartHelpers.js`) and returns a plain array of numbers/nulls aligned to that array — matching the existing pattern used by `getSymptomDailySeries` and `getSupplementDoseSeries`. ComparisonStudio wraps it into `{ values, dates, labels }` at the consumer level, same as other series.

Unlike existing per-item functions (`getSymptomDailySeries` takes a single `symptomId`), this function takes the full `symptoms` array since it aggregates across all active symptoms.

**Smoothing/interpolation:** The health score series uses smoothing (moving average) consistent with the active timeframe window, but does **not** apply gap interpolation. Since the score is already a daily aggregate, interpolating between aggregate days would mask missing-data patterns. Days with no logged symptoms show as gaps (nulls) in the array.

## Display Locations

### Desktop

| Location | Visibility | Content |
|----------|-----------|---------|
| **Toolbar badge** | Always visible (all views) | Compact pill: `24%` + delta arrow. Color-coded by threshold. |
| **Sidebar card** (in `SymptomList.jsx`) | Symptoms view only | Large score, delta vs 7-day avg, progress bar, "4/6 logged" text. |
| **ComparisonStudio toggle** | Insights view | Dedicated toggle button near series chips. Adds green line to chart. |

### Mobile

| Location | Visibility | Content |
|----------|-----------|---------|
| **Header badge** | Always visible (all views) | Compact pill: `24%` + delta arrow next to date. Color-coded. |
| **Summary card** | Top of symptom list (scrolls) | Score, delta vs 7-day avg, progress bar, "4/6 logged". |
| **Bottom nav accent** | Always visible | Tiny badge on Symptoms tab icon. |

### ComparisonStudio Chart Integration

- **Toggle:** Pill/switch labeled "Health Score" near the existing series chips area.
- **Line:** Color `#10b981` (emerald-500, distinct from `#34d399` used for positive correlation). Smoothing applied per timeframe window; no gap interpolation.
- **Y-axis:** The health score shares the **left axis** (symptom side). The raw score (0-100%) is normalized to a 0-5 scale by dividing by 20 for plotting purposes. This maps naturally: a health score of 100% = severity 5 (all symptoms maxed), 0% = severity 0. The axis labels remain the standard 0-5 symptom scale. The crosshair legend and tooltip show the actual percentage value (not the normalized value) for clarity.
- **Crosshair:** Shows current value in legend on hover.
- **Independence:** Overlays on any active series. No primary/secondary designation.
- **Data:** Generated by `getHealthScoreSeries()` which computes the score formula per date across the active timeframe.

## Files Affected

| File | Change |
|------|--------|
| `src/hooks/useHealthScore.js` | **New** — hook implementation |
| `src/utils/correlationHelpers.js` | Add `getHealthScoreSeries()` |
| `src/components/DesktopToolbar.jsx` | Add toolbar badge |
| `src/components/Header.jsx` | Add mobile header badge |
| `src/components/SymptomList.jsx` | Add summary card at top |
| `src/components/ComparisonStudio.jsx` | Add toggle + chart series rendering |
| `src/components/BottomNav.jsx` | Add score badge accent |

## Out of Scope

- Symptom weighting (all symptoms treated equally)
- Category-based grouping
- Storing/syncing the computed score
- Configurable rolling average window (hardcoded to 7 days)
