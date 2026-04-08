# Supplement Delete & Rename Data Tools

## Summary

Add two new data tools to the DATA TOOLS section in Settings: permanent supplement deletion (with all entries) and supplement renaming. Both follow the same modal pattern as the existing merge tool.

## Location

New buttons in the existing DATA TOOLS section of Settings.jsx, alongside "Merge Supplements."

## Rename Supplement

### Modal Flow
1. Select supplement from dropdown
2. Text input pre-filled with current name
3. "Rename" button — updates `name` field on the stackItem
4. Toast: `Renamed "X" to "Y"`

### Data Operation

`renameSupplement(stackItems, targetId, newName)` — returns new stackItems array with the target item's `name` updated. No entry changes needed since entries reference by `id`, not `name`.

Also appends a history entry: `{ timestamp, type: 'updated', changes: { name: { from: oldName, to: newName } } }` to match existing history tracking in the app.

## Permanently Delete Supplement

### Modal Flow
1. Select supplement from dropdown
2. Preview: shows entry count that will be deleted
3. Two-click confirm (button turns red on first click, same pattern as merge)
4. Deletes item from `stackItems` and all matching entries from `stackEntries`
5. Toast: `Deleted "X" (N entries removed)`

### Data Operation

`deleteSupplement(stackItems, stackEntries, targetId)` — returns `{ stackItems, stackEntries, deletedCount }`. Filters the item from stackItems and removes all stackEntries keys ending with `-{targetId}`.

## Utility Functions

Add to existing `src/utils/supplementMerge.js` (rename file to `supplementTools.js` and update the import in Settings.jsx):

- `renameSupplement(stackItems, targetId, newName)` → new stackItems
- `deleteSupplement(stackItems, stackEntries, targetId)` → `{ stackItems, stackEntries, deletedCount }`
- `previewDelete(stackEntries, targetId)` → `{ entryCount }`

Existing `mergeSupplements` and `previewMerge` stay in the same file.

## Props

Settings.jsx already receives all needed props: `stackItems`, `setStackItems`, `stackEntries`, `setStackEntries`, `setLastAction`.

## Edge Cases

- Rename to empty string: disabled (button disabled when input is empty or unchanged)
- Rename to same name: disabled
- Delete supplement with zero entries: just removes the item
- Dropdown shows both active and hidden supplements (with "(hidden)" label, same as merge)

## Scope Exclusions

- No changes to the existing delete flow in Manage Stack modal (it stays as-is)
- No changes to SupplementEdit rename (it stays as-is)
- No batch operations

## Testing

Unit tests for `renameSupplement`, `deleteSupplement`, and `previewDelete` in the existing test file (renamed to `supplementTools.test.js`).

Manual verification:
- Rename a supplement — name updates everywhere (charts, stack, history)
- Delete a supplement with entries — item and all entries removed
- Delete a supplement with zero entries — item removed cleanly
- Confirm step works (button turns red, second click executes)
- Toast messages show correct info
