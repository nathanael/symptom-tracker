# Dose Analysis Views — ComparisonStudio

## Summary

Add four view modes to ComparisonStudio for analyzing supplement dosing: Daily (current behavior), Weekly, Monthly, and Cumulative. Weekly/Monthly aggregate dose data by period. Cumulative models estimated body level using exponential decay with configurable half-life categories.

## View Mode Selector UI

A new tab-styled button group sits directly above the existing timeframe selector:

```
[ Daily | Weekly | Monthly | Cumulative ]
[ 2W | 4W | 2M | 4M | 6M ]
```

- Same visual style as the existing timeframe pill/tab buttons
- Default selection: Daily (preserves current behavior exactly)
- Selection persists in localStorage alongside existing ComparisonStudio preferences
- Both supplement dose lines and symptom overlay lines adapt to the selected view mode

## Daily View

No change from current behavior. One data point per day, rendered as a line.

## Weekly & Monthly Aggregation

Raw daily data is grouped into weekly or monthly periods. Each period provides two metrics, toggled by a small sub-control that only appears when Weekly or Monthly is active:

- **Average daily dose** within the period (default)
- **Total dose** for the period

Data points are plotted at the midpoint of each period. Rendered as a line chart (consistent with other views).

**Symptom overlays** in Weekly/Monthly: averaged severity per period. No avg/total toggle — average is the only meaningful aggregation for severity scores.

**Partial periods** at the edges of the date range use whatever days are available.

**X-axis labels** adapt: daily shows dates, weekly shows week-start dates, monthly shows month names.

## Cumulative View — Estimated Body Level

Models the estimated amount of a supplement "in the body" over time, accounting for daily doses stacking on top of decaying previous doses.

### Decay Model

Simple exponential decay, computed per day:

```
bodyLevel = (previousBodyLevel * decayFactor) + todaysDose
decayFactor = 0.5 ^ (1 / halfLifeInDays)
```

This naturally shows:
- Buildup to steady state with consistent dosing
- Drops when doses are missed
- Plateau when dosing is regular

### Half-Life Categories

Three simple presets instead of exact half-life values:

| Category | Half-life | Examples |
|----------|-----------|----------|
| Fast | ~12 hours (0.5 days) | Water-soluble vitamins, amino acids, caffeine |
| Moderate | ~3 days | Magnesium, zinc, most minerals |
| Slow | ~21 days | Fat-soluble vitamins (D, K, A, E) |

**Default:** Moderate, used when no category is set and no lookup match is found.

### Supplement Lookup Table

A built-in map of ~30-50 common supplement names to their half-life category. Uses fuzzy matching on the supplement name (e.g., "Vit D3" matches "Vitamin D"). Auto-assigns a category when a supplement is created or when names match. Always overridable by the user.

### Visual Treatment

- Line chart with a **semi-transparent area fill** under the curve (~10-15% opacity of the line color) to visually communicate "level" / accumulation
- Other views (Daily, Weekly, Monthly) remain line-only
- Y-axis: dynamic, labeled in the supplement's unit (mg, IU, etc.)

### Symptom Overlays in Cumulative View

Symptom lines show their smoothed daily line — no cumulative transform applied to symptoms.

## Half-Life Category Storage

New field on supplement items: `halfLifeCategory: "fast" | "moderate" | "slow" | null`

- `null` means use the lookup table auto-detection, falling back to "moderate" if no match

## Supplement Settings — Decay Rate

The decay rate setting is **optional and tucked away** to avoid cluttering the primary supplement settings. The main settings remain: name, dose, unit, schedule. Decay rate lives in a collapsible "Advanced" section or similar unobtrusive pattern — only visible if the user seeks it out.

Options: Fast, Moderate, Slow. If the lookup table matched the supplement name, shows the auto-detected value.

## Inline Editing in ComparisonStudio

When Cumulative view is active:

- A small pill/badge near the selected supplement name shows the current category (e.g., "Moderate")
- Tapping opens a simple three-option picker (Fast / Moderate / Slow) — no modal, just a small inline dropdown or popover
- Changing it updates the supplement's `halfLifeCategory` and the chart re-renders immediately
- If no category is set and no lookup match exists, shows "Moderate (default)" to make the implicit default visible

## Architecture

### New Module: `src/utils/doseTransforms.js`

Pure functions, no React dependencies:

- `aggregateDaily(series, dates)` — passthrough
- `aggregateWeekly(series, dates, mode)` — groups by week, returns avg or total with midpoint dates
- `aggregateMonthly(series, dates, mode)` — groups by month, returns avg or total with midpoint dates
- `computeCumulativeLevel(series, dates, halfLifeCategory)` — exponential decay model
- `aggregateSymptoms(series, dates, viewMode)` — averages for weekly/monthly, passthrough for daily/cumulative

### New Module: `src/utils/supplementLookup.js`

- `HALF_LIFE_TABLE` — map of supplement names to categories
- `CATEGORY_HALF_LIVES` — maps category strings to half-life in days
- `matchSupplementCategory(name)` — fuzzy matches supplement name against table, returns category or null

### Data Flow in ComparisonStudio

1. Raw series fetched via existing `getSupplementDoseSeries()` and symptom entries
2. New `viewMode` state determines which transform function is applied
3. Transformed data (with potentially different X-axis points for weekly/monthly) passed to SVG renderer
4. Cumulative view additionally renders an SVG `<path>` area fill under the dose curve

### Changes to Existing Code

- **ComparisonStudio.jsx**: New `viewMode` state, view mode selector UI, avg/total toggle for weekly/monthly, inline half-life category editor for cumulative view, area fill path for cumulative
- **Supplement settings** (in Stack.jsx or wherever supplement editing lives): Collapsible advanced section with decay rate dropdown
- **Supplement item schema**: New optional `halfLifeCategory` field
- **chartHelpers.js**: May need minor updates for adapted X-axis labels

### No Changes To

- `SyncEngine.js` / `useSyncEngine.js` — the new `halfLifeCategory` field syncs automatically as part of `stackItems`
- `SupplementGraph.jsx` — these features are scoped to ComparisonStudio only
- `correlationHelpers.js` — raw data extraction stays the same
