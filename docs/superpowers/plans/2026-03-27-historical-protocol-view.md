# Historical Protocol View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the full supplement protocol on past dates with empty checkboxes for untaken supplements, enabling historical data correction.

**Architecture:** Unify the today/past display path in Stack.jsx so all dates show scheduled protocol items via `isScheduledForDate`, with historical state reconstruction applied first. Replace the "Log supplement" button with a "+" button for ad-hoc supplement logging.

**Tech Stack:** React, vitest

**Spec:** `docs/superpowers/specs/2026-03-27-historical-protocol-view-design.md`

---

### Task 1: Add `applyHistoricalState` helper

**Files:**
- Modify: `src/utils/helpers.js:117-139` (near `reconstructStateAtDate`)
- Test: `src/utils/__tests__/helpers.test.js` (create)

- [ ] **Step 1: Write failing tests for `applyHistoricalState`**

Create `src/utils/__tests__/helpers.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { applyHistoricalState } from '../helpers';

describe('applyHistoricalState', () => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const baseItem = {
    id: 'mag-1',
    name: 'Magnesium',
    defaultDose: 400,
    unit: 'mg',
    description: 'Glycinate',
    schedule: { type: 'daily', startDate: '2026-01-01' },
    active: true,
    history: [
      {
        timestamp: '2026-01-01T10:00:00.000Z',
        type: 'created',
        snapshot: {
          name: 'Magnesium',
          defaultDose: 400,
          unit: 'mg',
          description: 'Glycinate',
          schedule: { type: 'daily', startDate: '2026-01-01' },
          active: true
        }
      }
    ]
  };

  it('returns item unchanged for today', () => {
    const result = applyHistoricalState(baseItem, today);
    expect(result).toEqual(baseItem);
  });

  it('overlays historical properties for past dates', () => {
    const itemWithUpdate = {
      ...baseItem,
      name: 'Mag Glycinate',  // current name
      defaultDose: 600,        // current dose
      history: [
        ...baseItem.history,
        {
          timestamp: '2026-03-15T10:00:00.000Z',
          type: 'updated',
          changes: {
            name: { from: 'Magnesium', to: 'Mag Glycinate' },
            defaultDose: { from: 400, to: 600 }
          }
        }
      ]
    };

    const result = applyHistoricalState(itemWithUpdate, new Date('2026-03-10'));
    expect(result.name).toBe('Magnesium');
    expect(result.defaultDose).toBe(400);
    expect(result.unit).toBe('mg');
  });

  it('overlays historical active status', () => {
    const deactivated = {
      ...baseItem,
      active: false,
      history: [
        ...baseItem.history,
        {
          timestamp: '2026-03-15T10:00:00.000Z',
          type: 'updated',
          changes: { active: { from: true, to: false } }
        }
      ]
    };

    const result = applyHistoricalState(deactivated, new Date('2026-03-10'));
    expect(result.active).toBe(true);
  });

  it('overlays historical schedule', () => {
    const rescheduled = {
      ...baseItem,
      schedule: { type: 'days', days: [1, 3, 5], startDate: '2026-01-01' },
      history: [
        ...baseItem.history,
        {
          timestamp: '2026-03-15T10:00:00.000Z',
          type: 'updated',
          changes: {
            schedule: {
              from: { type: 'daily', startDate: '2026-01-01' },
              to: { type: 'days', days: [1, 3, 5], startDate: '2026-01-01' }
            }
          }
        }
      ]
    };

    const result = applyHistoricalState(rescheduled, new Date('2026-03-10'));
    expect(result.schedule.type).toBe('daily');
  });

  it('returns item unchanged when history is empty/missing', () => {
    const noHistory = { ...baseItem, history: [] };
    const result = applyHistoricalState(noHistory, new Date('2026-03-10'));
    expect(result).toEqual(noHistory);
  });

  it('returns item unchanged when history is undefined (legacy)', () => {
    const legacy = { ...baseItem, history: undefined };
    const result = applyHistoricalState(legacy, new Date('2026-03-10'));
    expect(result).toEqual(legacy);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/helpers.test.js`
Expected: FAIL — `applyHistoricalState` is not exported

- [ ] **Step 3: Implement `applyHistoricalState`**

Add to `src/utils/helpers.js` after `reconstructStateAtDate` (after line 139):

```javascript
// Apply historical state to a supplement item for display on a given date.
// For today, returns the item unchanged. For past dates, overlays historical
// name, dose, unit, description, schedule, and active status.
// Items with no history (legacy) are returned unchanged.
export const applyHistoricalState = (item, selectedDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(selectedDate);
  target.setHours(0, 0, 0, 0);

  if (target >= today) return item;

  if (!item.history || item.history.length === 0) return item;

  const dateStr = target.toISOString().split('T')[0];
  const historical = reconstructStateAtDate(item.history, dateStr);
  if (!historical) return item;

  return {
    ...item,
    name: historical.name,
    description: historical.description,
    unit: historical.unit,
    defaultDose: historical.defaultDose,
    schedule: historical.schedule,
    active: historical.active
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/helpers.test.js`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/helpers.js src/utils/__tests__/helpers.test.js
git commit -m "feat: add applyHistoricalState helper for historical protocol view"
```

---

### Task 2: Unify `displayItems` in Stack.jsx

**Files:**
- Modify: `src/components/Stack.jsx:289-314` (displayItems computation)

- [ ] **Step 1: Replace the displayItems computation**

Replace the `displayItems` IIFE (lines 289-314, the part inside `(() => { ... })()`) with unified logic:

```javascript
const displayItems = (() => {
    // Unified path: reconstruct historical state first, then filter
    const withHistory = stackItems.map(item => applyHistoricalState(item, selectedDate));

    // Protocol items: active on this date AND scheduled for this date
    const protocol = withHistory
      .filter(item => item.active !== false)
      .filter(item => isScheduledForDate(item.schedule, selectedDate));

    // Ad-hoc items: not in protocol but have entries for this date
    const protocolIds = new Set(protocol.map(i => i.id));
    const adHoc = withHistory
      .filter(item => !protocolIds.has(item.id) && stackEntries[`${dateKey}-${item.id}`])
      .map(item => ({ ...item, _adHoc: true }));

    return [...protocol, ...adHoc];
  })().sort((a, b) => (a.order || 0) - (b.order || 0)).filter(item => {
    if (!searchFilter) return true;
    const s = searchFilter.toLowerCase();
    return item.name.toLowerCase().includes(s) || (item.description || '').toLowerCase().includes(s);
  });
```

- [ ] **Step 2: Add visual separation for ad-hoc items**

In the render loop where `displayItems` are mapped to rows, add a subtle divider before ad-hoc items and dimmed styling. Check for the `_adHoc` flag:

- Before the first ad-hoc item, render a thin divider with label "Ad-hoc" in muted text
- Ad-hoc item rows get reduced opacity (e.g., `opacity: 0.7`)

- [ ] **Step 3: Add `applyHistoricalState` to the import**

Update the import on line 1:

```javascript
import { getDateKey, haptic, isScheduledForDate, createHistoryEntry, recordHistoryChange, reconstructStateAtDate, applyHistoricalState } from '../utils/helpers';
```

- [ ] **Step 4: Run the app locally and verify**

Run: `npm run dev`
Verify:
- Today shows the same supplements as before
- A past date shows the full protocol with empty checkboxes for untaken supplements
- Tapping an empty checkbox on a past date logs the supplement
- Tapping a filled checkbox on a past date removes the entry

- [ ] **Step 5: Commit**

```bash
git add src/components/Stack.jsx
git commit -m "feat: unify displayItems to show full protocol on historical dates"
```

---

### Task 3: Unify `getStackProgress`

**Files:**
- Modify: `src/components/Stack.jsx:121-143` (getStackProgress function)

- [ ] **Step 1: Replace the getStackProgress function**

Replace lines 121-143 with unified logic that matches the new displayItems pipeline:

```javascript
const getStackProgress = () => {
    // Unified: reconstruct historical state, then filter to scheduled protocol
    const withHistory = stackItems.map(item => applyHistoricalState(item, selectedDate));
    const protocol = withHistory
      .filter(item => item.active !== false)
      .filter(item => isScheduledForDate(item.schedule, selectedDate));

    const takenCount = protocol.filter(item =>
      stackEntries[`${dateKey}-${item.id}`]
    ).length;
    return { taken: takenCount, total: protocol.length };
  };
```

Note: Ad-hoc entries are excluded from both numerator and denominator as specified.

- [ ] **Step 2: Run the app and verify progress indicator**

Run: `npm run dev`
Verify:
- Today: progress shows "X of Y" where Y = scheduled items (unchanged)
- Past date: progress shows "X of Y" where Y = full protocol count, X = items with entries
- Ad-hoc items (logged but not scheduled) don't affect the count

- [ ] **Step 3: Commit**

```bash
git add src/components/Stack.jsx
git commit -m "feat: unify getStackProgress to count full protocol on historical dates"
```

---

### Task 4: Replace "Log supplement" with "+" button

**Files:**
- Modify: `src/components/Stack.jsx:274-286` (availableToLog), `716-738` (Log supplement button), `1273-1383` (Log picker modal)

- [ ] **Step 1: Update `availableToLog` to exclude protocol items**

The "+" button should show supplements NOT already in the display list. Replace the `availableToLog` computation (lines 274-286) with:

```javascript
const availableToLog = (() => {
    // Items available for ad-hoc logging: active, not already displayed, existed on this date
    const displayedIds = new Set(displayItems.map(i => i.id));
    return stackItems.filter(i => {
      if (!i.active || displayedIds.has(i.id)) return false;
      if (i.schedule?.startDate) {
        const start = new Date(i.schedule.startDate + 'T00:00:00');
        start.setHours(0, 0, 0, 0);
        const target = new Date(selectedDate);
        target.setHours(0, 0, 0, 0);
        if (target < start) return false;
      }
      return true;
    }).sort((a, b) => (a.order || 0) - (b.order || 0));
  })();
```

Note: `availableToLog` is currently defined before `displayItems` (line 274 vs 289). Since it now depends on `displayItems`, move this computation to after `displayItems` (after line ~314).

- [ ] **Step 2: Replace the "Log supplement" button with "+" button**

Replace the Log supplement button (lines 716-738) with a "+" button visible on all dates:

```javascript
{!showManageStack && availableToLog.length > 0 && (
  <button
    onClick={() => setShowLogPicker(true)}
    style={{
      width: '100%',
      padding: '16px 20px',
      background: 'transparent',
      border: 'none',
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
      color: '#6b7280',
      fontSize: '14px',
      fontWeight: '400',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
    }}
  >
    <span style={{ fontSize: '14px' }}>+</span>
    Add supplement
  </button>
)}
```

Key change: removed `!isToday &&` condition so it appears on all dates.

- [ ] **Step 3: Add "Add new supplement" option to the log picker modal**

In the log picker modal (around line 1328), after the `availableToLog` list, add an "Add new supplement" option. When clicked, it opens the manage stack view with add form. After the new supplement is created via `addStackItem`, it should also be immediately logged for the current date by calling `toggleStackItem(newItemId)`.

To support this, add a `pendingLogAfterAdd` ref. When "Add new supplement" is clicked from the picker, set `pendingLogAfterAdd.current = true`. In the `addStackItem` function, after the item is added to state, check the ref — if true, call `toggleStackItem(newItem.id)` and reset the ref.

```javascript
{/* Add new supplement option */}
<button
  onClick={() => {
    pendingLogAfterAdd.current = true;
    setShowLogPicker(false);
    setShowManageStack(true);
    setShowAddForm(true);
  }}
  style={{
    width: '100%',
    padding: '16px 20px',
    background: 'transparent',
    border: 'none',
    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
    color: '#9ca3af',
    fontSize: '14px',
    fontWeight: '400',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  }}
>
  <span style={{ fontSize: '18px', color: '#6b7280' }}>+</span>
  Add new supplement
</button>
```

- [ ] **Step 4: Update modal header text**

In the log picker modal header (around line 1303-1326), change "Log supplement" to "Add supplement".

- [ ] **Step 5: Run the app and verify the "+" flow**

Run: `npm run dev`
Verify:
- "+" button appears on both today and past dates when there are unscheduled supplements
- "+" button is hidden when manage stack modal is open
- Tapping "+" shows the picker with unscheduled supplements
- "Add new supplement" option at bottom opens the add form
- Selecting an existing supplement logs it and it appears checked in the ad-hoc section

- [ ] **Step 6: Commit**

```bash
git add src/components/Stack.jsx
git commit -m "feat: replace Log supplement with + button for ad-hoc supplement logging"
```

---

**Out of scope (intentional):**
- The "Manage stack" button remains `isToday`-gated — managing the protocol (reordering, editing, hiding) is a today-only operation.
- The "Check all / Uncheck all" toggle remains `isToday`-gated — bulk historical corrections are not needed for this feature.

---

### Task 5: Run full test suite and manual verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (existing 63 + new helper tests)

- [ ] **Step 2: Manual verification checklist**

Run: `npm run dev`

Test each scenario:
- [ ] Today: full protocol visible with checkboxes (unchanged behavior)
- [ ] Today: progress indicator shows correct count
- [ ] Past date with all supplements taken: all checked, correct count
- [ ] Past date with some supplements taken: taken ones checked, missed ones have empty checkboxes
- [ ] Past date: tap empty checkbox to log a missed supplement
- [ ] Past date: tap filled checkbox to remove an entry
- [ ] Past date: "+" button shows unscheduled supplements
- [ ] Past date: "Add new supplement" opens add form
- [ ] Deactivated supplement appears on dates before deactivation
- [ ] Supplement with changed schedule uses historical schedule on past dates
- [ ] Legacy supplement (no history) appears normally on all dates

- [ ] **Step 3: Build for production**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
