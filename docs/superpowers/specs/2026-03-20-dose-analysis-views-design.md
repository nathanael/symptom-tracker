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
- Selection persists in localStorage: extend existing `comparisonStudioSelections` object to include `viewMode` ("daily" | "weekly" | "monthly" | "cumulative") and `aggMode` ("average" | "total"). `aggMode` is stored once and shared across Weekly/Monthly. Missing fields default to `viewMode: "daily"` and `aggMode: "average"` — no migration needed, just graceful fallback.
- Both supplement dose lines and symptom overlay lines adapt to the selected view mode

## Daily View

No change from current behavior. One data point per day, rendered as a line.

## Weekly & Monthly Aggregation

Raw daily data is grouped into weekly or monthly periods. Each period provides two metrics, toggled by a small sub-control that only appears when Weekly or Monthly is active:

- **Average daily dose** within the period (default)
- **Total dose** for the period

The avg/total toggle preference persists in localStorage. When switching between Daily/Cumulative and back to Weekly/Monthly, the last-used mode is restored.

Data points are plotted at the midpoint of each period. Rendered as a line chart (consistent with other views).

### Period Definitions

- **Weekly**: Calendar weeks starting Monday (ISO 8601). Partial weeks at the start/end of the date range are included.
- **Monthly**: Calendar months. Partial months at the start/end of the date range are included.
- **Midpoint calculation**: The middle day of the actual available days in the period, regardless of whether the period is complete. E.g., a partial week with 3 days (Mon-Wed) plots at Tuesday.

### Symptom Overlays

Symptoms in Weekly/Monthly views: non-null daily values are averaged within each period (null days are excluded from the average, not treated as 0). No smoothing step — smoothing is unnecessary when already aggregating. No avg/total toggle for symptoms — average is the only meaningful aggregation for severity scores. If a period has no non-null values, it produces null (gap in the line).

### X-Axis Labels

Daily shows dates. Weekly shows the Monday date of each week. Monthly shows month names (e.g., "Jan", "Feb").

## Cumulative View — Estimated Body Level

Models the estimated amount of a supplement "in the body" over time, accounting for daily doses stacking on top of decaying previous doses.

### Decay Model

Simple exponential decay, computed per day:

```
bodyLevel = (previousBodyLevel * decayFactor) + todaysDose
decayFactor = 0.5 ^ (1 / halfLifeInDays)
```

**Initial condition**: `previousBodyLevel = 0` for the first day in the date range. This assumes no prior supplementation. (Modeling pre-range buildup would require scanning all historical data, adding complexity for marginal accuracy gain.)

**Null/missing doses**: When a dose is null (supplement not taken that day), treat `todaysDose = 0`. The body level continues to decay — no gap in the line. This accurately models the body clearing the substance.

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

A built-in map of common supplement names to their half-life category. Uses case-insensitive token matching: the supplement name is split into tokens and compared against lookup table entries. A match occurs when tokens overlap meaningfully (e.g., "Vit D3 5000IU" matches "Vitamin D" because "D" and "Vit/Vitamin" overlap). Multi-ingredient or brand-name supplements that don't match default to Moderate.

**Auto-detection lifecycle**: Runs once when a supplement is first created. Subsequent name edits do not re-trigger detection. The user can manually change the category at any time via settings or the inline picker. If the user explicitly clears their override (sets back to null/auto), the lookup runs again against the current name.

### Visual Treatment

- Line chart with a **semi-transparent area fill** under the curve (~10-15% opacity of the line color) to visually communicate "level" / accumulation
- **Area fill construction**: Create a closed SVG `<path>` that traces the full line (which is always continuous — nulls are treated as 0 so there are no gaps), then draws straight down to the chart bottom (`padTop + chartH`), back along the bottom to the first point's x, and closes.
- Other views (Daily, Weekly, Monthly) remain line-only
- **Y-axis**: dynamic, scaled to the maximum cumulative body level in the visible date range, rounded up to a clean number using the existing nice-number logic. Labeled in the supplement's unit (mg, IU, etc.)

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

- A small pill/badge appears immediately after the supplement name chip/button at the top of the chart area, showing the current category (e.g., "Moderate")
- Tapping opens a simple three-option picker (Fast / Moderate / Slow) — no modal, just a small inline dropdown or popover
- Changing it updates the supplement's `halfLifeCategory` and the chart re-renders immediately
- If no category is set and no lookup match exists, shows "Moderate (default)" to make the implicit default visible

## Architecture

### New Module: `src/utils/doseTransforms.js`

Pure functions, no React dependencies:

- `aggregateDaily(series, dates)` — passthrough, returns `{ values, dates }` unchanged
- `aggregateWeekly(series, dates, mode)` — groups by ISO calendar week, returns `{ values: number[], dates: string[] }` where dates are midpoint YYYY-MM-DD strings and values are avg or total per period. All-null input returns empty arrays.
- `aggregateMonthly(series, dates, mode)` — groups by calendar month, returns `{ values: number[], dates: string[] }` same format as weekly. All-null input returns empty arrays.
- `computeCumulativeLevel(series, dates, halfLifeCategory)` — runs exponential decay model, returns `{ values: number[], dates: string[] }` with one point per day (same dates as input)
- `aggregateSymptoms(series, dates, viewMode)` — averages for weekly/monthly (matching period grouping), passthrough for daily/cumulative. Returns `{ values, dates }`.

### New Module: `src/utils/supplementLookup.js`

- `HALF_LIFE_TABLE` — map of supplement names/tokens to categories
- `CATEGORY_HALF_LIVES` — `{ fast: 0.5, moderate: 3, slow: 21 }` (days)
- `matchSupplementCategory(name)` — case-insensitive token match against table, returns category string or null

### Data Flow in ComparisonStudio

1. Raw series fetched via existing `getSupplementDoseSeries()` and symptom entries
2. New `viewMode` state determines which transform function is applied
3. Transformed data `{ values, dates }` (with potentially fewer X-axis points for weekly/monthly) passed to SVG renderer
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
