# Whoop-Style Insights Redesign

## Overview

Replace the ComparisonStudio's view mode toggles and complex navigation with a Whoop-inspired insights view. The chart shows daily data with fixed sub-period level segments overlaid, alongside average stats, % change badges, and natural language insight text with correlation hints.

## What Changes

### Removed
- 4-way view mode toggle (daily / weekly / monthly / cumulative)
- Cumulative view and half-life category picker
- `matchSupplementCategory` import in ComparisonStudio (was only used for cumulative)
- Begin/end navigation buttons (`|<` and `>|`)
- 2 of 5 timeframe options (2W, 4W removed)
- Note: `computeCumulativeLevel` in `doseTransforms.js` and `supplementLookup.js` become dead code. Removal is optional — they may be useful later.

### Added
- Level segments overlaid on the daily chart (thin horizontal lines showing sub-period averages)
- Primary series selection (tap chip to choose which series gets levels)
- Hero stat section: average value + unit + % change badge vs prior period
- Natural language insight sentence with correlation hint between supplement and symptom trends
- New module: `src/utils/insightHelpers.js`

### Modified
- Timeframes: `W` (7 days), `M` (30 days), `6M` (180 days)
- Navigation: left/right arrows only, stepping by half the timeframe
- Chart height: H=400 (mobile), H=420 (desktop) — up from H=280
- Selector rows: stacked vertically — supplement on top, symptoms below (both layouts)
- Stats section: minimal list layout with background-highlight for primary series

## Architecture

### New module: `src/utils/insightHelpers.js`

Extracted from ComparisonStudio to keep computation testable and the component focused on rendering.

**`computeLevels(values, dates, timeframeDays)`**
- Takes a daily values array, corresponding date strings, and the timeframe
- Divides into fixed sub-periods: W→daily (7 segments), M→weekly (4-5 segments), 6M→monthly (6 segments)
- May reuse `aggregateWeekly` / `aggregateMonthly` from `doseTransforms.js` internally for consistent week/month boundary handling, or implement its own bucketing — implementer's choice
- Returns array of `{ startIdx, endIdx, average, percentChange }` where `percentChange` is relative to the previous segment
- Handles nulls/gaps by excluding them from the average calculation

**`computeInsight(primaryStats, secondaryStats[], options)`**
- `primaryStats`: `{ name, average, priorAverage, unit, isSymptom }`
- `secondaryStats[]`: same shape, one per secondary series
- `options`: `{ timeframeLabel }` (e.g., "6 months")
- Computes `percentChange` from `(average - priorAverage) / priorAverage * 100`
- Generates natural language insight string, e.g.: "Your average Fatigue (3.2) was 8% below your previous 6-month average of 3.5."
- **Correlation hint:** compares the primary's % change direction against each secondary's. For supplement-symptom pairs: if they move in opposite directions (supplement up, symptom down or vice versa), that's "favorable." If multiple secondaries, mention each. If directions are the same or changes are < 2%, omit the correlation sentence.
- Returns `{ average, unit, percentChange, priorAverage, insightText }`

**`getLevelColor(percentChange, isSymptom)`**
- Returns the color for a level segment based on whether the change is favorable
- For symptoms: decrease is green (#34d399), increase is yellow (#d4a017)
- For supplements: increase is green, decrease is yellow
- Near-zero change (< 2%) returns neutral (#9ca3af)

### ComparisonStudio changes

**State changes:**
- Remove: `viewMode` state and setter
- Remove: `showCategoryPicker` state
- Add: `primarySeriesId` state (string — id of the series whose levels are shown), persisted to localStorage
- Change: `timeframe` initial value from 60 to 180 (default to 6M)
- Change: `TIMEFRAMES` import updated to new 3-option set

**localStorage migration:**
- Read: ignore unknown `viewMode` values gracefully (already happens via fallback)
- Persist: `{ supplement, symptoms, primarySeriesId }` — drop `viewMode` from the stored object
- On load: if `primarySeriesId` is missing or invalid, fall back to the default (first supplement)

**Data pipeline:**
- Remove: `transformDose` callback and all view-mode branching
- Remove: cumulative area fill path computation
- Always compute daily series (current `suppDoseDaily` and symptom daily paths)
- Add: `useMemo` call to `computeLevels()` for the primary series
- Add: `useMemo` call to `computeInsight()` for the insight header

**Y-axis behavior:**
- When primary is a supplement: left Y-axis shows dose scale (dynamic), right Y-axis shows severity 0-5 (if symptoms selected)
- When primary is a symptom: left Y-axis shows severity 0-5 scale, right Y-axis shows dose scale (if supplement selected)
- Level segments use the primary's Y-axis for positioning
- This is the same dual-axis approach as current, just with the primary determining which axis is "left" (dominant)

**Chart rendering:**
- Daily line always rendered at reduced opacity (0.4) for the primary series
- Level segments rendered as thin (strokeWidth ~2) horizontal `<line>` elements, spanning the full sub-period width with no gaps between segments
- No text labels on level segments (averages shown in stats panel instead)
- Non-primary series lines rendered at lower opacity (0.2)
- At segment boundaries where data is sparse (< 2 data points in a sub-period), that segment is omitted

**Layout — Desktop:**
- Selector rows: two stacked rows with inline labels ("Supplement" / "Symptoms"), supplement on top
- Main card: left panel (250px) + chart (flex)
- Left panel top section: timeframe pills (W/M/6M) → date nav (‹ date range ›)
- Left panel stats section: minimal list — one row per series, supplement first then symptoms
  - Primary row: tinted background band in series color, larger text (18px), series name in its color
  - Secondary rows: no background, smaller text (13px), grey name
  - Each row: dot · name · value · unit · % change badge
- Left panel bottom: natural language insight text (11px, #9ca3af)

**Layout — Mobile:**
- Selector rows: supplement chips row, then symptom chips row below
- Insight header above chart: hero stat (24px average + unit), W/M/6M pills (top right), % change badge, ‹ date range › nav, insight text
- Chart card with level overlays
- Mini-insight bar below chart for each non-primary series: `[dot] {name} avg {value} {unit} · {arrow} {%} vs prior` — one bar per secondary series, stacked vertically with 4px gap

**Primary series selection:**
- Tap/click a chip to make it primary
- Primary chip gets: thicker border (2px), increased background opacity, ◆ prefix, subtle glow
- Default: first supplement selected
- If primary series is removed, falls back to next available series

## Timeframe and Level Mapping

| Timeframe | Days | Sub-period | Segments | Step (nav) | Smoothing window |
|-----------|------|------------|----------|------------|-----------------|
| W         | 7    | Daily      | 7        | 4 days     | 1 (none)        |
| M         | 30   | Weekly     | 4-5      | 15 days    | 3               |
| 6M        | 180  | Monthly    | 6        | 90 days    | 10              |

Update `SMOOTH_WINDOWS` in `chartHelpers.js` to include entries for `7` and `30`: `{ 7: 1, 30: 3, 180: 10 }`. Old keys (14, 28, 60, 120) can be removed.

## % Change Calculation

- **Level-to-level:** `(currentAvg - prevAvg) / prevAvg * 100`
- **Vs prior period:** `computeInsight` receives two date ranges worth of daily data — the visible period and the equivalent prior period. The caller (ComparisonStudio) generates a `2 * timeframe` date range using the existing date generation logic, then splits it: first half = prior, second half = current. The overall average of each half is compared to produce the % change badge. When `startOffset > 0`, the "prior" period is simply the timeframe-length window immediately before the visible window.
- **Badge color:** green for favorable (symptom down or supplement up), yellow/amber for unfavorable, grey for < 2% change

## Chart Dimensions

| Property | Mobile | Desktop |
|----------|--------|---------|
| SVG viewBox height | 400 | 420 |
| Chart area height | ~300px | ~340px |
| SVG viewBox width | 500 (unchanged) | 500 (unchanged) |

## X-Axis Label Formatting

Update `formatXLabel` and `getXLabelInterval` for the new timeframes:

| Timeframe | Label format | Interval |
|-----------|-------------|----------|
| W (7)     | "Mon", "Tue", ... (day name) | every day |
| M (30)    | "Mar 5", "Mar 12", ... (month + day) | every 7 days |
| 6M (180)  | "Oct", "Nov", ... (month only) | every 30 days |

## Crosshair Behavior

Preserved from current implementation. On hover/touch:
- Vertical crosshair line appears
- Stats in left panel (desktop) or header (mobile) temporarily show that day's specific values instead of period averages
- Level segments remain visible during crosshair interaction

## Files Touched

- `src/utils/insightHelpers.js` — **new** (computeLevels, computeInsight, getLevelColor)
- `src/utils/__tests__/insightHelpers.test.js` — **new** (unit tests)
- `src/utils/chartHelpers.js` — update `TIMEFRAMES` constant, `SMOOTH_WINDOWS`, `formatXLabel` (add day number for 30-day view), `getXLabelInterval` (update breakpoints for new timeframes)
- `src/components/ComparisonStudio.jsx` — major refactor (remove view modes, add levels/insights, layout changes)
- `src/utils/doseTransforms.js` — `computeCumulativeLevel` can be left in place (dead code removal optional)

## Testing

- Unit tests for `computeLevels`: correct segment count per timeframe, average calculation, % change math, null handling
- Unit tests for `computeInsight`: insight text generation, correlation detection, edge cases (single series, no data)
- Unit tests for `getLevelColor`: favorable/unfavorable/neutral for both supplement and symptom types
- Existing ComparisonStudio manual testing: verify chart renders, primary selection works, crosshair interaction, all three timeframes
