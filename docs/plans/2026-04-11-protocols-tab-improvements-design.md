# Protocols Tab Improvements

## Summary

Three changes to the protocols (supplements) tab: simplify today's buttons, improve the supplement picker for past dates, and replace the mobile-style bottom sheet with a proper side panel on desktop.

## 1. Button Logic Changes

**Today's view:**
- Remove the "Add supplement" button. Keep only "Manage stack".
- Manage stack already provides full supplement management including adding new ones.

**Past dates:**
- Rename "Add supplement" to "Log supplement".
- "Manage stack" does not appear on past dates (unchanged).

## 2. Hidden Supplements Toggle

In the log supplement picker (both mobile bottom sheet and desktop side panel):

- A "Show hidden" toggle sits above the "Add new supplement" option at the bottom of the list.
- When toggled on, hidden/inactive supplements appear in the same list with a "(hidden)" badge next to their name (matches existing badge style).
- Toggle state resets to off each time the picker opens.
- Logging a hidden supplement on a past date is a one-off entry. It does not restore the supplement to active status.

## 3. Desktop Side Panel

Replaces the mobile-style bottom sheet when on desktop. Mobile keeps the bottom sheet (renamed, with hidden toggle added).

**Behavior:**
- Slides in from the right edge of the content area.
- Semi-transparent backdrop behind it; clicking backdrop dismisses.
- Panel width: ~350-400px, full height of the content area.
- Smooth slide-in/slide-out animation.

**Panel contents (top to bottom):**
- Header: "Log supplement" title + close (X) button.
- Scrollable list of available supplements (active, plus hidden when toggled).
- "Show hidden" toggle.
- "Add new supplement" option at the bottom (opens Manage Stack with add form, same as current behavior).
