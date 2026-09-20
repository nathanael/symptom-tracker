# Symptoms + Protocol list redesign

Approved via interactive mockups on 2026-09-20 (symptom list v5, protocol v1).

## Principles
- One quiet, centered list (max 860px) per tab. Same component on desktop and mobile; a breakpoint changes density, not structure.
- The thing you tap is the thing you log. No global AM/PM toggle, no Rapid Entry modal, no floating action bar, no popovers that cover neighbouring rows.
- Colour only where there is signal. Severity colour on logged values; zeros and gaps stay near-invisible.
- Editing happens in place: the same list enters edit mode. No separate Manage drawer or full-page edit screens.
- Bulk actions never confirm; they act and offer Undo in a toast (8s).
- Hide is reversible and keeps the item in Insights. Delete is only offered on hidden items, is soft for 90 days, and is restorable from Settings.

## Symptoms tab
View mode
- Row: name + description · 14-day strip (desktop only; bar height/colour = max severity that day, zero = faint, gap = hairline) · one pill per tracking period (AM, PM in `ampm`; one in `simple`).
- Pill: dashed outline when empty, severity-coloured number when logged, `N/A` when -1, `–` when the period is not in `applicablePeriods`.
- Focus = (row, period). Clicking a pill or row focuses it and expands the key row inline (0–5, N/A; History on mobile). Rating writes the entry and advances to the next applicable row in the same period.
- Default period on load: morning before 12:00, else evening (existing `getCurrentTimePeriod`).
- Desktop keyboard: `0`–`5` rate + advance, `N` N/A, `←`/`→` period, `↑`/`↓` row, `⌫` clear entry, `E` edit mode. Ignored while an input is focused or a modal is open.
- Clicking the strip opens the existing SymptomGraph.
- Bar: search (desktop), counter `AM x/y · PM x/y`, Today's Notes, Clear day, Edit symptoms. On mobile the three actions live in a `⋯` menu.
- Clear day: deletes all symptom entries for the selected date; toast with Undo restores them.

Edit mode
- Same list. Desktop rows: drag handle, inline name + description inputs, AM/PM applicability toggles, `History` (expands change log with Revert), `Hide`.
- Mobile rows: drag handle, name/description text, applicability summary, chevron. Tap expands a panel with all fields, change log, Hide.
- `Add symptom` row at the end of the active list (re-activates a hidden symptom of the same name, as today).
- Hidden section below: `Restore` and `Delete`.
- All edits record history exactly as `recordSymptomHistoryChange` does today. Inline text edits commit on blur/Enter.

Removed: desktop card grid, quick-log popover, mobile hold-to-drag severity gesture, DayNightToggle/floating bar, RapidEntry, Manage symptoms drawer, SymptomEdit page. Pinned-symptom ordering is preserved if any are pinned.

## Protocol tab
View mode
- One list, two sections: Supplements (`n of m taken`) and Other factors (`n of m today`).
- Supplement row: name + description · 14-day taken strip · dose (click to edit for that day) · check pill. Items not scheduled for the selected date render muted with `due <day>` instead of a check.
- Factor row: category dot, name, verdict tag, description · strip · check pill.
- Keyboard: `Space`/`X` toggle + advance, `D` edit dose, arrows, `E` edit.
- Bar: search, counter, Match yesterday, Check all, Clear day, Edit protocol (mobile: `⋯`). All three bulk actions are undoable.
- Clicking the strip opens the existing SupplementGraph (replaces the per-row chart icon).

Edit mode
- Supplements inline: name, description, dose, unit; summary chip (schedule). `More` expands schedule (reuse SchedulePicker), decay rate, change log with Revert.
- Factors inline: name, description; chip `Category · Verdict`. `More` expands category, verdict, change log.
- Add supplement / Add factor rows. Hidden section collapsed past 3 items. Hide on active; Restore + Delete on hidden.

Removed: two-card layout, mobile Supplements/Other Factors switcher, Manage stack/inputs drawers, SupplementEdit/InputEdit pages.

## Soft delete
- Delete sets `deletedAt` (ISO) on the symptom / stack item / input item. Items with `deletedAt` are excluded everywhere (lists, Insights, export) via one helper `isDeleted`.
- Settings → Recently deleted: name, entry count, days until purge (amber ≤ 7), Restore (clears `deletedAt`, item returns hidden→active), Delete now (confirm).
- Purge on boot after hydrate: items with `deletedAt` older than 90 days are removed along with their entries. Runs only when signed-in state is settled so a stale cache cannot trigger it; goes through the normal state setters so the sync engine emits deletes.

## Phases
1. Symptoms tab (view, edit, clear day) on both breakpoints; remove replaced UI.
2. Protocol tab.
3. Soft delete, Settings section, purge.
Each phase: tests for new pure helpers, manual run-through in the browser, version bump, deploy.
