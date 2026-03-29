# Unified Series Selector Design

**Date:** 2026-03-29
**Status:** Approved

## Summary

Move supplement and symptom selectors from a dedicated top-level row into the chart card's left panel (desktop) or above the chart (mobile), positioned below the date/range navigation. Selected series appear as vertically stacked chips with `×` dismiss buttons. Empty slots show dashed-outline `+ Supplement` / `+ Symptom` buttons that open existing picker modals.

## Current State

- **Desktop:** Two labeled input boxes ("Supplement" / "Symptoms") sit in a row above the chart card. Clicking opens full-screen picker modals.
- **Mobile:** Horizontal chip row at top with inline `+ Supplement` / `+ Symptom` dashed pills.
- Smart defaults auto-select a supplement and symptom on first load.

## Design

### Removal

- Delete the entire top-level selector row (desktop: labeled boxes, mobile: horizontal chip row).
- Delete the `inputBoxStyle` constant (only used by removed selectors).
- Change defaults to empty — no supplement, no symptoms selected on first load.
- Keep localStorage persistence — returning users restore their previous selections.
- **Remove the `hasAnySeries` empty-state gate.** The chart card always renders. When no series are selected, the chart area shows the existing placeholder message, but the range/date nav and `+` buttons above it remain visible so users can add series.

### Chip Placement

Chips are inserted between the date navigation and the view mode selector (daily/weekly/monthly/cumulative), separated by dividers above and below.

### Chip Rendering

Each selected series renders as a full-width row:
- **Supplement chip:** Purple color (`#8b5cf6`), background `rgba(139,92,246,0.12)`, dashed border when empty
- **Symptom chips:** Use existing `SYMPTOM_STYLES` colors (pink, blue, amber) based on selection order
- Each chip shows the series name and a `×` dismiss button on the right
- Tapping anywhere on the chip dismisses it (existing behavior — whole chip is tap target)

### Empty Slots

- If no supplement selected: show a dashed-outline `+ Supplement` button (purple tint)
- If fewer than 3 symptoms selected: show a dashed-outline `+ Symptom` button (pink tint) below any existing symptom chips
- When all slots filled (1 supplement + 3 symptoms): no add buttons shown
- Both `+` buttons open the existing picker modals

### Layout Order

**Desktop left panel:**
1. Range tabs (W/M/3M/6M)
2. Date nav (arrows + date label)
3. Divider
4. Supplement chip or `+ Supplement` slot
5. Symptom chips + `+ Symptom` slot (if room)
6. Divider
7. View mode selector
8. Stats/legend items

**Mobile (above chart):**
1. Range tabs (W/M/3M/6M)
2. Date nav (arrows + date label)
3. Divider
4. Supplement chip or `+ Supplement` slot (full-width)
5. Symptom chips + `+ Symptom` slot (full-width)
6. Divider
7. View mode selector (moved from below chart to above chart, matching desktop order)
8. Chart
9. Stats panel below chart

### No Labels

No "Supplement" / "Symptoms" section headers for the chip area. Color coding and `+` button text provide sufficient affordance. Existing "Range" and "View" section headers in the desktop left panel remain unchanged.

### Interaction

- `+` buttons open existing picker modals (no changes to picker UI)
- `×` on chips removes the series (existing behavior)
- Haptic feedback on all interactions (existing behavior)

## Files Modified

- `src/components/ComparisonStudio.jsx` — only file changed

## Out of Scope

- Picker modal redesign
- Changes to data flow, persistence, or chart rendering
- View mode selector changes
