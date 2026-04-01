# Historical Protocol View Design

## Problem

On past dates, the supplement stack only shows supplements that were actually logged/checked off. Supplements that were part of the protocol but weren't taken are invisible. This makes it impossible to:
- See what you missed on a given day
- Retroactively log supplements you forgot to record
- Get an accurate picture of adherence (progress shows "8 of 8" instead of "8 of 12")

## Solution: Unified Display Path

Remove the today-vs-past branching in `displayItems`. All dates use the same logic: show the full scheduled protocol with checkboxes reflecting actual entries.

### Display Logic

All dates compute display items as:

```
displayItems = stackItems
  .map(item => applyHistoricalState(item, selectedDate))
  .filter(item => item.active !== false)
  .filter(item => isScheduledForDate(item.schedule, selectedDate))
```

**Pipeline ordering matters:** Historical state must be reconstructed BEFORE filtering by active/schedule, so that filtering uses the schedule and active status as they were on that date, not their current values.

- **`applyHistoricalState(item, selectedDate)`** — new helper in `src/utils/helpers.js`. Wraps existing `reconstructStateAtDate()`. For past dates, overlays historical name, dose, unit, description, schedule, and active status onto the item. For today, returns the item unchanged. If `item.history` is undefined/empty (legacy supplements predating the history feature), returns the item unchanged — legacy supplements are treated as active on all dates.
- **`isScheduledForDate(item.schedule, selectedDate)`** — existing helper, unchanged. Takes a Date object (not a dateKey string). Enforces `startDate`, schedule type (daily/days/interval).

Checkbox state: filled if `stackEntries[dateKey-itemId]` exists, empty otherwise. Tapping toggles the entry immediately — same behavior as today's view, no confirmation step.

### Ad-Hoc Entries

After computing the scheduled protocol items above, append any additional items that have entries for that date but weren't in the scheduled set:

```
adHocItems = stackItems.filter(item =>
  stackEntries[dateKey + '-' + item.id] exists
  AND item.id not in scheduledItemIds
)
```

These appear at the bottom of the list, visually separated from protocol items (e.g., a subtle divider or dimmed styling). They are checked (since they have entries) and can be unchecked to remove the entry.

### Progress Indicator

`getStackProgress` uses the same unified pipeline. The denominator is the count of scheduled protocol items (from the main pipeline). The numerator is the count of scheduled protocol items that have entries. Ad-hoc entries are excluded from both numerator and denominator.

### "+" Button (Replaces "Log Supplement")

The current "Log supplement" button is replaced with a "+" button at the bottom of the stack list, visible on all dates (hidden when the manage/edit view is active).

Tapping "+" opens a list with two sections:
1. **Existing supplements not scheduled for that day** — active supplements in the library that weren't part of the protocol for that date (e.g., a Mon/Wed/Fri supplement viewed on Tuesday).
2. **"Add new supplement"** — at the bottom. Opens the standard add supplement dialogue. After creation, the supplement is immediately logged for that date.

Selecting an existing unscheduled supplement creates a `stackEntries` key for that date and the supplement appears in the ad-hoc section as checked.

### Edge Cases

**Deactivated supplements:** A supplement deactivated on March 15 still appears with an empty checkbox when viewing March 10. On March 16+ it does not appear. Determined by `applyHistoricalState` reconstructing the `active` field, then filtered by `item.active !== false`.

**Supplements added later:** A supplement with `startDate: 2026-03-20` does not appear on March 19 or earlier. `isScheduledForDate` already enforces this.

**Legacy supplements without history:** Supplements predating the history feature (`history` is undefined or empty) are treated as active on all dates with their current properties. `applyHistoricalState` returns them unchanged.

**Deleted supplements:** Supplements removed from `stackItems` entirely cannot appear in historical views (the item data is gone). Their orphaned `stackEntries` are harmless but invisible. This is acceptable — deletion is a destructive action.

**Schedule changes:** If a supplement was daily on March 10 but changed to Mon/Wed/Fri on March 15, viewing March 10 uses the historical daily schedule (because `applyHistoricalState` runs before `isScheduledForDate`).

**No migration required:** `stackEntries` data structure is unchanged. This is purely a display/filtering change.

**Sync safety:** No changes to the sync engine or data structures.

## Files Changed

- **`src/components/Stack.jsx`** — main changes: unified `displayItems`, unified `getStackProgress`, replace "Log supplement" button with "+" button, add ad-hoc supplement flow
- **`src/utils/helpers.js`** — add `applyHistoricalState()` helper (thin wrapper around `reconstructStateAtDate`)
- **No changes to:** App.jsx, SyncEngine.js, useSyncEngine.js, useLocalStorage.js

## Scope

- Supplements/stack only. Does not change behavior for symptoms or other inputs.
- No new data structures or storage changes.
- No sync engine changes.
