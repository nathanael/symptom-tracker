# Mobile ComparisonStudio Redesign

**Date:** 2026-03-29
**Component:** `src/components/ComparisonStudio.jsx`
**Scope:** Mobile layout only (< 1024px)

## Summary

Redesign the mobile view of ComparisonStudio for better readability and usability. The current layout has small touch targets, hard-to-read graph lines, and cluttered information hierarchy.

## Changes

### 1. Remove Average Display and Percent Badge (Top-Left)

**Current:** "AVERAGE 0.7 /5" block at top-left (10px label, 24px value), plus a percent change badge below it ("▲ 12% vs. prior month").
**New:** Remove both entirely. The average value is already shown in the series chips and insight text.

### 2. Center and Enlarge Timeframe Pills

**Current:** W/M/3M/6M pills at top-right (16px text, 6px/12px padding, font-weight 500).
**New:** Centered row, larger (18px text, 8px/18px padding, font-weight 500, active pill font-weight 600). Border-radius 8px on container, 6px on individual pills.

### 3. Bolder Date Range Navigator

**Current:** 16px grey (#9ca3af) text with font-weight 500, 27px grey (#6b7280) arrows.
**New:**
- Date text: 17px, font-weight 700, near-white (#f3f4f6), letter-spacing 0.06em
- Arrows: 28px, bright (#e5e7eb), font-weight 300, with 4px/8px padding for larger tap target

### 4. Larger Series Chips and Add Buttons

**Current:** 10px/12px padding, 13px text, 6px dots, 1px borders (supplement border opacity 0.25, symptom border opacity 0.35).
**New:**
- Padding: 12px/16px
- Text: 15px (name and value), 12px (unit)
- Dots: 8px diameter
- Borders: 1.5px solid, opacity 0.35 for all
- Border-radius: 10px
- Close button (✕): 14px, opacity 0.7
- Add buttons: same 12px/16px padding, 1.5px dashed border, 14px text

### 5. Bolder Graph Lines (Mobile Only)

**Current:** Supplement stroke-width 0.9s, symptom 1.0s, opacity 0.8 (primary) / 0.45 (secondary). strokeLinejoin="round" already set.
**New:**
- All data lines: stroke-width ~2.0s (roughly double current)
- Opacity: 1.0 for primary, 0.6 for secondary
- Add stroke-linecap="round" for smoother line ends
- Use slightly brighter color variants on mobile only: supplement `#a78bfa` (vs shared constant `#8b5cf6`), symptom colors stay as-is (already bright enough)

**Implementation note:** The `chartSVGContent` variable is shared between desktop and mobile. These stroke/opacity changes must be conditioned on `!isDesktop` — either by parameterizing the values or by splitting the relevant SVG lines into mobile/desktop variants. Do NOT modify the shared color constants (`SUPP_COLOR`, `SYMPTOM_STYLES`).

### 6. Taller Chart with Reduced Padding (Mobile Only)

**Current:** H_MOBILE = 400 units, padLeft 36, padRight 20. Grid line opacity 0.12, axis line opacity 0.2.
**New:**
- H_MOBILE: 500 units (25% taller)
- Reduce padLeft to ~22 units and padRight to ~12 units so data lines extend closer to chart edges
- Y-axis labels stay within the reduced padding area
- Grid line opacity: increase to 0.18 for better visibility
- Axis line opacity: increase from 0.2 to 0.25

**Implementation note:** `padLeft` and `padRight` are computed before the desktop/mobile layout split but use `W` which differs by platform. The reduced values should be applied conditionally: `padLeft = isDesktop ? 36 * s : 22 * s`, etc.

### 7. Remove Mini-Insight Bars Below Graph

**Current:** Non-primary series shown as mini rows below the chart (color dot + "B2 avg 160.4 mg" text).
**New:** Remove entirely on mobile. This data is already visible in the series chips above.

### 8. Move Insight Text Below Graph

**Current:** Insight text ("Your average Depression was 0.7/5 over this period.") appears between series chips and chart.
**New:** Moves below the chart. Same styling: 12px, #9ca3af color with colored segments, line-height 1.5. Padding 8px/4px.

## Shared Code Considerations

The `seriesChips` variable and `chartSVGContent` are shared between desktop and mobile rendering. Changes to chip sizing and chart line styling must be mobile-conditional:

- **seriesChips:** Use `isDesktop` to apply different padding, font sizes, dot sizes, and border widths. The simplest approach is to define a sizing object (`const chipSize = isDesktop ? { ... } : { ... }`) and reference it in the chip styles.
- **chartSVGContent:** Parameterize stroke-width and opacity values based on `isDesktop`. The brighter supplement color on mobile should be applied inline in the SVG, not by changing the `SUPP_COLOR` constant.
- **Padding constants:** Conditionally set `padLeft`/`padRight` based on `isDesktop`.

## Layout Order (Top to Bottom)

1. Timeframe pills (centered)
2. Date range navigator (centered, bold)
3. Series chips (supplement, symptoms, add buttons)
4. Chart (taller, edge-to-edge data)
5. Insight text

## Out of Scope

- Desktop layout (unchanged)
- Chart interaction behavior (touch crosshair stays the same)
- Level segment annotations on the chart (stay as-is)
- Supplement/symptom picker modals
- Data computation logic

## Files Modified

- `src/components/ComparisonStudio.jsx` — all changes are in the mobile rendering path
