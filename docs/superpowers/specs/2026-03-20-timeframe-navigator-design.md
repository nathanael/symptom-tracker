# Timeframe Navigator Design

## Summary

Replace the slider-based time window control in ComparisonStudio with an arrow-based navigator. Four buttons (`|<`, `<`, `>`, `>|`) flank a date range label, sitting directly below the timeframe pills. This provides more intuitive, discrete navigation through historical data.

## Scope

**ComparisonStudio.jsx only.** No changes to SymptomGraph, SupplementGraph, or chartHelpers.js.

## Navigation Controls

### Button Behavior

| Button | Action | Shift Amount | Disabled When |
|--------|--------|-------------|---------------|
| `\|<` | Jump to earliest data point across all selected series | N/A — sets offset to `maxOffset` | `startOffset >= maxOffset` |
| `<` | Shift window into the past | 50% of current timeframe (`Math.round(timeframe / 2)`) | `startOffset >= maxOffset` (clamped, not blocked — partial shifts allowed) |
| `>` | Shift window toward present | 50% of current timeframe (`Math.round(timeframe / 2)`) | `startOffset === 0` |
| `>\|` | Jump to today | N/A — sets offset to `0` | `startOffset === 0` |

### Clamping

When a 50% shift would exceed `maxOffset`, the offset clamps to `maxOffset` rather than disabling the button. The `<` button is only disabled when already at `maxOffset`. Similarly, `>` clamps to `0`.

### Date Label

The existing `dateWindowLabel` renders between the arrow groups as a passive (non-interactive) text display, e.g., "Jan 20 — Mar 20".

### Timeframe Change

Selecting a new timeframe pill resets `startOffset` to `0` (snaps to today). This matches current behavior.

### Haptic Feedback

Arrow buttons trigger `haptic('light')` on press, consistent with timeframe pills.

## Layout

### Mobile (< 1024px)

```
[  2W  |  4W  |  2M  |  4M  |  6M  ]     ← timeframe pills (unchanged)
[ |<  <    Jan 20 — Mar 20    >  >| ]     ← new arrow nav row
```

- Full width, same horizontal padding as pills
- `marginBottom: '10px'` on the arrow row

### Desktop (>= 1024px)

Both rows in the left sidebar, where the slider currently lives:

```
[  2W  |  4W  |  2M  |  4M  |  6M  ]     ← timeframe pills (unchanged)
[ |<  <    Jan 20 — Mar 20    >  >| ]     ← new arrow nav row
```

- Same width as pills row
- `marginBottom: '22px'` on the arrow row (matching old slider spacing)

## Removals

- `<input type="range">` slider (desktop, lines ~1204-1212)
- Mobile swipe pan gesture handlers: `handleMobileTouchStart`, `handleMobileTouchMove`, `handleMobileTouchEnd` and associated touch tracking refs
- Desktop touch pan handlers: `handleDesktopTouchStart`, `handleDesktopTouchMove`, `handleDesktopTouchEnd` (if used for panning)

## What Stays

- `startOffset` / `setStartOffset` state
- `maxOffset` calculation (earliest data point detection)
- `dateWindowLabel` computation
- `dates` useMemo (driven by `timeframe` + `startOffset`)
- All chart rendering, crosshair, legend logic downstream of `dates`

## Button Styling

- Background: `rgba(255,255,255,0.08)`
- Border: `1px solid rgba(255,255,255,0.12)`
- Border radius: `5px`
- Text color: `#9ca3af`
- Font size: `11px` mobile, `10px` desktop
- Disabled state: `opacity: 0.3`, `cursor: default`, no click handler
- Text characters for arrows — no icon dependencies

## State Changes

Existing state reused:
- `startOffset` (number of days offset from today)
- `maxOffset` (derived from earliest data point)
- `timeframe` (selected duration in days)

New derived value:
- `shiftAmount = Math.round(timeframe / 2)` — used by `<` and `>` buttons

No new state variables needed.
