# Supplement Merge Tool

## Summary

Add a merge tool in Settings that lets the user combine two duplicate supplements into one, reassigning all historical dose entries from the source to the target and deleting the source.

## Location

New "Merge Supplements" section in Settings.jsx, below the existing sync/data management area. A button opens an inline modal (same pattern as existing sync modals).

## Merge Modal Flow

1. **Select target** — dropdown of all supplements (the survivor)
2. **Select source** — dropdown of remaining supplements (gets absorbed)
3. **Conflict strategy** — radio toggle:
   - "Sum doses" — combines doses on same-date conflicts (e.g., 100mg + 200mg = 300mg)
   - "Keep higher dose" — takes the larger dose on same-date conflicts
4. **Preview** — shows:
   - Source name and entry count
   - Target name and entry count
   - Number of date conflicts found
   - "Source will be permanently deleted"
5. **Confirm** — "Merge" button with confirmation step

## Data Operations

### Merge Logic (pure function)

Inputs: `stackItems`, `stackEntries`, `targetId`, `sourceId`, `strategy` ("sum" | "higher")

1. Find all `stackEntries` keys ending with `-{sourceId}`
2. For each source entry:
   - Compute new key: replace `-{sourceId}` suffix with `-{targetId}`
   - If new key does NOT exist in entries: create it with `{ ...sourceEntry, itemId: targetId }`
   - If new key DOES exist (same-date conflict):
     - `strategy === "sum"`: new dose = target dose + source dose
     - `strategy === "higher"`: new dose = max(target dose, source dose)
     - `taken`: true if either entry has `taken: true`
   - Delete the old source key
3. Remove source item from `stackItems` array
4. Return new `{ stackItems, stackEntries }`

### Sync Integration

After merge:
- Call `setStackItems(newStackItems)` and `setStackEntries(newStackEntries)` via the existing state setters passed as props to Settings
- The `useLocalStorage` onChange callbacks automatically trigger `sync.notifyChange()` for both domains
- No special sync handling needed — this is equivalent to editing entries + deleting an item

## Edge Cases

- Source has entries on dates where target has none — straightforward move, no conflict
- Source entry `taken: false` + target entry `taken: true` — merged entry is `taken: true`
- Source entry `taken: true` + target entry `taken: false` — merged entry is `taken: true`
- Source has zero entries — just deletes the source item
- Target and source have different units — show warning in preview but allow merge (user's choice)

## Props Required

Settings.jsx already receives `stackItems` and `setStackItems`. It also needs `stackEntries` and `setStackEntries` to perform the merge. Check whether these are already passed; if not, add them from App.jsx.

## UI Details

### Merge Button
Styled like existing Settings action buttons. Placed after the sync section.

### Modal
- Fixed overlay (same z-index pattern as supplement picker modals)
- Dark background matching app theme
- Two dropdowns (target, source), radio toggle, preview section, merge button
- Close button / click-outside to dismiss
- After successful merge: show toast/last-action message "Merged {sourceName} into {targetName} ({N} entries moved)", close modal

## Scope Exclusions

- No auto-detection of similar names
- No undo (standard for destructive operations in this app — same as delete)
- No batch merge (one pair at a time)
- No changes to supplement creation flow
- No changes to sync engine

## Testing

Manual verification:
- Merge two supplements with no date conflicts — all entries reassigned
- Merge two supplements with date conflicts using "sum" — doses added correctly
- Merge two supplements with date conflicts using "higher" — max dose kept
- Merge source with zero entries — source deleted, nothing else changes
- Preview shows correct counts
- After merge, chart (ComparisonStudio) shows combined data under target
- Sync pushes merged data to cloud
