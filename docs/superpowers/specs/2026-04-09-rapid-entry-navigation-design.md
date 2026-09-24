# Rapid Entry Navigation Redesign

## Summary

Replace the current two-button (Back/Next) navigation in RapidEntry with a four-button navigation bar: `<< < > >>`. The new bar is full-width, uses icon-only buttons in an even grid, and provides taller tap targets for mobile usability.

## Current State

- Two small text buttons ("Back" and "Next/Done") in a centered flex row with `gap: 12px`
- "Back" steps back 1 (wraps around)
- "Next" jumps to next unmarked symptom; shows "Done" when all marked
- Keyboard: ArrowLeft = back, ArrowRight = next unmarked

## Design

### Layout

- 4-column grid: `grid-template-columns: repeat(4, 1fr)`
- Full width matching severity grid: `maxWidth: 400px`, `width: 100%`
- Gap: `12px` (matches severity grid)
- Replaces the existing navigation div at lines 626-668 of `RapidEntry.jsx`

### Button Sizing

- Padding: `16px 0` — taller than current `12px 24px` for easier mobile finger targets
- Border radius: `5px` (matches existing)

### Icons

- Inline SVG double/single chevrons
- `<<` — double chevron left (prev unfilled)
- `<` — single chevron left (back 1)
- `>` — single chevron right (forward 1)
- `>>` — double chevron right (next unmarked)

### Styling

- Background: `rgba(100, 116, 139, 0.1)`
- Border: `1px solid rgba(100, 116, 139, 0.3)`
- Icon color: `#94a3b8`
- Consistent with existing button styling in the component

## Button Behaviors

| Button | Action | Edge Case |
|--------|--------|-----------|
| `<<` | Jump to previous unfilled symptom, searching backward toward index 0 only | No wrap. Subtle opacity pulse if none found |
| `<` | Step back 1 through all symptoms (marked and unmarked) | Wraps to end of list |
| `>` | Step forward 1 through all symptoms (marked and unmarked) | Wraps to start of list |
| `>>` | Jump to next unmarked symptom, searching forward with wrap | If all marked, trigger close/complete (existing confetti + toast behavior) |

## Keyboard Mapping

| Key | Action | Change from current |
|-----|--------|-------------------|
| ArrowLeft | Step back 1 (all symptoms, wraps) | Unchanged |
| ArrowRight | Step forward 1 (all symptoms, wraps) | Changed — was "next unmarked", now steps through all |
| Escape | Close | Unchanged |
| 0-5, N | Log severity | Unchanged |

## `findPrevUnfilledIndex` Behavior

Searches strictly before the current index (from `currentIndex - 1` down to 0). Does not check the current index, does not wrap. Returns -1 if no unfilled symptom exists before the current position.

## "No Unfilled" Feedback (`<<` button)

When `<<` is pressed and no unfilled symptom exists before the current index:
- Brief opacity/border-color pulse on the `<<` button via CSS transition
- No toast, modal, or haptic — purely visual

## Auto-Advance After Severity/N/A Tap

Unchanged. Tapping a severity or N/A button on an unmarked symptom still auto-advances to the next unmarked symptom (existing behavior). This means `>>` is primarily useful when the user has navigated back to a marked symptom and wants to jump forward to the next unfilled one, or when they want to skip ahead without logging.

## `>>` Completion Paths

When all symptoms are marked and `>>` is pressed, it follows the existing branching logic:
1. **AM/PM mode with incomplete opposite period:** shows confirmation screen (`setRapidEntryConfirm(true)`) offering to switch periods
2. **Otherwise:** fires confetti, closes rapid entry, shows "All symptoms logged!" toast

## Scope

### In Scope
- Replace navigation buttons in main rapid entry view (lines 626-668)
- Update keyboard handler (lines 73-113) to match new ArrowRight behavior
- Add `findPrevUnfilledIndex()` helper function

### Out of Scope
- Confirmation screen navigation (unchanged)
- Severity button auto-advance behavior (unchanged)
- N/A button auto-advance behavior (unchanged)
- Desktop vs mobile styling differences for the nav bar (uses same layout)

## File Changes

- `src/components/RapidEntry.jsx` — only file modified
