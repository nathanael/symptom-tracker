# Supplement Merge Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a merge tool in Settings that combines two duplicate supplements into one, reassigning all historical dose entries.

**Architecture:** Pure merge function in a utility module, UI in Settings.jsx as an inline modal. The merge function takes stackItems, stackEntries, targetId, sourceId, and strategy, returns new state. Settings calls it and updates state via existing setters (which auto-trigger sync).

**Tech Stack:** React 18, inline styles, vitest for testing

**Spec:** `docs/superpowers/specs/2026-04-08-supplement-merge-design.md`

---

### File Structure

- **Create:** `src/utils/supplementMerge.js` — pure merge function
- **Create:** `src/utils/__tests__/supplementMerge.test.js` — unit tests
- **Modify:** `src/components/Settings.jsx` — merge UI section + modal

---

### Task 1: Merge function with tests

**Files:**
- Create: `src/utils/supplementMerge.js`
- Create: `src/utils/__tests__/supplementMerge.test.js`

- [ ] **Step 1: Write failing tests**

```js
// src/utils/__tests__/supplementMerge.test.js
import { describe, it, expect } from 'vitest';
import { mergeSupplements, previewMerge } from '../supplementMerge';

describe('previewMerge', () => {
  it('counts source entries and conflicts', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 100, taken: true },
      '2026-03-02-src-123': { date: '2026-03-02', itemId: 'src-123', dose: 200, taken: true },
      '2026-03-02-tgt-456': { date: '2026-03-02', itemId: 'tgt-456', dose: 150, taken: true },
      '2026-03-03-tgt-456': { date: '2026-03-03', itemId: 'tgt-456', dose: 300, taken: true },
    };
    const result = previewMerge(stackEntries, 'tgt-456', 'src-123');
    expect(result.sourceEntryCount).toBe(2);
    expect(result.targetEntryCount).toBe(2);
    expect(result.conflictCount).toBe(1); // March 2nd
  });

  it('returns zero counts for items with no entries', () => {
    const result = previewMerge({}, 'tgt-456', 'src-123');
    expect(result.sourceEntryCount).toBe(0);
    expect(result.targetEntryCount).toBe(0);
    expect(result.conflictCount).toBe(0);
  });
});

describe('mergeSupplements', () => {
  const stackItems = [
    { id: 'tgt-456', name: 'B1', unit: 'mg', defaultDose: 100, active: true, order: 0 },
    { id: 'src-123', name: 'Vitamin B1', unit: 'mg', defaultDose: 200, active: true, order: 1 },
    { id: 'other-789', name: 'Magnesium', unit: 'mg', defaultDose: 400, active: true, order: 2 },
  ];

  it('moves entries with no conflicts', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 100, taken: true },
      '2026-03-02-tgt-456': { date: '2026-03-02', itemId: 'tgt-456', dose: 150, taken: true },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'sum');
    // Source item removed
    expect(result.stackItems).toHaveLength(2);
    expect(result.stackItems.find(i => i.id === 'src-123')).toBeUndefined();
    // Source entry moved to target key
    expect(result.stackEntries['2026-03-01-tgt-456']).toEqual({
      date: '2026-03-01', itemId: 'tgt-456', dose: 100, taken: true,
    });
    // Target entry unchanged
    expect(result.stackEntries['2026-03-02-tgt-456']).toEqual({
      date: '2026-03-02', itemId: 'tgt-456', dose: 150, taken: true,
    });
    // Old source key removed
    expect(result.stackEntries['2026-03-01-src-123']).toBeUndefined();
    // Unrelated entries untouched
    expect(Object.keys(result.stackEntries)).toHaveLength(2);
  });

  it('sums doses on conflict with strategy "sum"', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 100, taken: true },
      '2026-03-01-tgt-456': { date: '2026-03-01', itemId: 'tgt-456', dose: 150, taken: false },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'sum');
    expect(result.stackEntries['2026-03-01-tgt-456']).toEqual({
      date: '2026-03-01', itemId: 'tgt-456', dose: 250, taken: true, // sum, either taken = true
    });
    expect(result.stackEntries['2026-03-01-src-123']).toBeUndefined();
  });

  it('keeps higher dose on conflict with strategy "higher"', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 300, taken: false },
      '2026-03-01-tgt-456': { date: '2026-03-01', itemId: 'tgt-456', dose: 150, taken: true },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'higher');
    expect(result.stackEntries['2026-03-01-tgt-456']).toEqual({
      date: '2026-03-01', itemId: 'tgt-456', dose: 300, taken: true, // higher dose, either taken = true
    });
  });

  it('handles source with zero entries', () => {
    const stackEntries = {
      '2026-03-01-tgt-456': { date: '2026-03-01', itemId: 'tgt-456', dose: 150, taken: true },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'sum');
    expect(result.stackItems).toHaveLength(2);
    expect(result.stackItems.find(i => i.id === 'src-123')).toBeUndefined();
    expect(result.stackEntries['2026-03-01-tgt-456'].dose).toBe(150);
  });

  it('preserves unrelated entries', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 100, taken: true },
      '2026-03-01-other-789': { date: '2026-03-01', itemId: 'other-789', dose: 400, taken: true },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'sum');
    expect(result.stackEntries['2026-03-01-other-789']).toEqual({
      date: '2026-03-01', itemId: 'other-789', dose: 400, taken: true,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/supplementMerge.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement merge functions**

```js
// src/utils/supplementMerge.js

/**
 * Preview a merge: count source entries, target entries, and date conflicts.
 */
export function previewMerge(stackEntries, targetId, sourceId) {
  let sourceEntryCount = 0;
  let targetEntryCount = 0;
  const sourceDates = new Set();
  const targetDates = new Set();

  for (const [key, entry] of Object.entries(stackEntries)) {
    if (key.endsWith(`-${sourceId}`)) {
      sourceEntryCount++;
      sourceDates.add(entry.date);
    } else if (key.endsWith(`-${targetId}`)) {
      targetEntryCount++;
      targetDates.add(entry.date);
    }
  }

  let conflictCount = 0;
  for (const date of sourceDates) {
    if (targetDates.has(date)) conflictCount++;
  }

  return { sourceEntryCount, targetEntryCount, conflictCount };
}

/**
 * Merge source supplement into target. Returns new { stackItems, stackEntries }.
 * strategy: "sum" | "higher"
 */
export function mergeSupplements(stackItems, stackEntries, targetId, sourceId, strategy) {
  // Two-pass approach to avoid iteration-order bugs:
  // Pass 1: collect source and target entries separately
  const sourceEntries = {}; // date -> entry
  const otherEntries = {};  // key -> entry (target + unrelated)

  for (const [key, entry] of Object.entries(stackEntries)) {
    if (key.endsWith(`-${sourceId}`)) {
      sourceEntries[entry.date] = entry;
    } else {
      otherEntries[key] = entry;
    }
  }

  // Pass 2: merge source entries into target slot
  for (const [date, srcEntry] of Object.entries(sourceEntries)) {
    const targetKey = date + '-' + targetId;
    const existing = otherEntries[targetKey];
    if (existing) {
      // Conflict: apply strategy
      otherEntries[targetKey] = {
        date,
        itemId: targetId,
        dose: strategy === 'sum' ? existing.dose + srcEntry.dose : Math.max(existing.dose, srcEntry.dose),
        taken: existing.taken || srcEntry.taken,
      };
    } else {
      // No conflict: place remapped entry
      otherEntries[targetKey] = { date, itemId: targetId, dose: srcEntry.dose, taken: srcEntry.taken };
    }
  }

  const newStackItems = stackItems.filter(i => i.id !== sourceId);

  return { stackItems: newStackItems, stackEntries: otherEntries };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/supplementMerge.test.js`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/supplementMerge.js src/utils/__tests__/supplementMerge.test.js
git commit -m "feat: add supplement merge utility with tests"
```

---

### Task 2: Merge UI in Settings

**Files:**
- Modify: `src/components/Settings.jsx:1-53` (add state), `src/components/Settings.jsx:833` (add UI before Danger Zone)

- [ ] **Step 1: Add imports and state**

At the top of Settings.jsx, add import:

```jsx
import { mergeSupplements, previewMerge } from '../utils/supplementMerge';
```

Inside the component, after the existing `useState` declarations (around line 53), add:

```jsx
const [showMergeModal, setShowMergeModal] = useState(false);
const [mergeTarget, setMergeTarget] = useState('');
const [mergeSource, setMergeSource] = useState('');
const [mergeStrategy, setMergeStrategy] = useState('sum');
const [confirmMerge, setConfirmMerge] = useState(false);
```

- [ ] **Step 2: Add computed preview**

After the merge state declarations, add:

```jsx
const mergePreview = (mergeTarget && mergeSource && mergeTarget !== mergeSource)
  ? previewMerge(stackEntries, mergeTarget, mergeSource)
  : null;
```

- [ ] **Step 3: Add Merge Supplements section before Danger Zone**

Before the `{/* Danger Zone */}` comment (line 835), add:

```jsx
{/* Merge Supplements */}
<div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
  DATA TOOLS
</div>
<div style={{
  background: 'rgba(15, 17, 21, 0.5)',
  borderRadius: '12px',
  marginBottom: '12px',
  overflow: 'hidden',
}}>
  <button
    onClick={() => { setShowMergeModal(true); setMergeTarget(''); setMergeSource(''); setMergeStrategy('sum'); setConfirmMerge(false); haptic('light'); }}
    style={{
      width: '100%',
      background: 'transparent',
      border: 'none',
      padding: '14px 16px',
      color: '#a5b4fc',
      fontSize: '15px',
      cursor: 'pointer',
      textAlign: 'left',
    }}
  >
    <div>Merge Supplements</div>
    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Combine duplicate supplements into one</div>
  </button>
</div>
```

- [ ] **Step 4: Add merge modal**

After the merge button section (and before the Danger Zone comment), add the modal:

```jsx
{showMergeModal && (
  <div
    onClick={() => setShowMergeModal(false)}
    style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.85)',
      zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', maxWidth: '400px',
        background: 'rgba(15,17,21,0.95)',
        borderRadius: '12px',
        border: '1px solid rgba(139,92,246,0.3)',
        padding: '20px',
      }}
    >
      <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: '0 0 16px' }}>
        Merge Supplements
      </h3>

      {/* Target dropdown */}
      <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
        Keep (target)
      </label>
      <select
        value={mergeTarget}
        onChange={(e) => { setMergeTarget(e.target.value); if (e.target.value === mergeSource) setMergeSource(''); setConfirmMerge(false); }}
        style={{
          width: '100%', padding: '10px 12px', marginBottom: '12px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px', color: '#e5e7eb', fontSize: '14px',
        }}
      >
        <option value="">Select supplement to keep...</option>
        {(stackItems || []).sort((a, b) => a.name.localeCompare(b.name)).map(item => (
          <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (hidden)'}</option>
        ))}
      </select>

      {/* Source dropdown */}
      <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
        Merge & delete (source)
      </label>
      <select
        value={mergeSource}
        onChange={(e) => { setMergeSource(e.target.value); setConfirmMerge(false); }}
        style={{
          width: '100%', padding: '10px 12px', marginBottom: '12px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px', color: '#e5e7eb', fontSize: '14px',
        }}
      >
        <option value="">Select supplement to merge...</option>
        {(stackItems || []).sort((a, b) => a.name.localeCompare(b.name)).filter(i => i.id !== mergeTarget).map(item => (
          <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (hidden)'}</option>
        ))}
      </select>

      {/* Strategy toggle */}
      <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '6px' }}>
        When both have entries on the same day
      </label>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {['sum', 'higher'].map(s => (
          <button
            key={s}
            onClick={() => setMergeStrategy(s)}
            style={{
              flex: 1, padding: '8px',
              borderRadius: '6px', border: 'none',
              background: mergeStrategy === s ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.04)',
              color: mergeStrategy === s ? '#c4b5fd' : '#6b7280',
              fontSize: '13px', fontWeight: '500', cursor: 'pointer',
            }}
          >
            {s === 'sum' ? 'Sum doses' : 'Keep higher'}
          </button>
        ))}
      </div>

      {/* Preview */}
      {mergePreview && (() => {
        const targetItem = (stackItems || []).find(i => i.id === mergeTarget);
        const sourceItem = (stackItems || []).find(i => i.id === mergeSource);
        const unitMismatch = targetItem && sourceItem && (targetItem.unit || 'mg') !== (sourceItem.unit || 'mg');
        return (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#9ca3af',
            lineHeight: '1.6',
          }}>
            <div>{mergePreview.sourceEntryCount} entries will be moved</div>
            {mergePreview.conflictCount > 0 && (
              <div style={{ color: '#fbbf24' }}>
                {mergePreview.conflictCount} date conflict{mergePreview.conflictCount > 1 ? 's' : ''} ({mergeStrategy === 'sum' ? 'doses will be summed' : 'higher dose kept'})
              </div>
            )}
            {unitMismatch && (
              <div style={{ color: '#fb923c' }}>
                Warning: different units ({targetItem.unit || 'mg'} vs {sourceItem.unit || 'mg'})
              </div>
            )}
            <div style={{ color: '#fca5a5', marginTop: '4px' }}>
              "{sourceItem?.name}" will be permanently deleted
            </div>
          </div>
        );
      })()}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={() => setShowMergeModal(false)}
          style={{
            flex: 1, padding: '10px',
            background: 'rgba(99,102,241,0.2)', border: 'none', borderRadius: '8px',
            color: '#a5b4fc', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (!mergeTarget || !mergeSource || mergeTarget === mergeSource) return;
            if (!confirmMerge) { setConfirmMerge(true); return; }
            const sourceName = (stackItems || []).find(i => i.id === mergeSource)?.name;
            const targetName = (stackItems || []).find(i => i.id === mergeTarget)?.name;
            const result = mergeSupplements(stackItems, stackEntries, mergeTarget, mergeSource, mergeStrategy);
            setStackItems(result.stackItems);
            setStackEntries(result.stackEntries);
            setShowMergeModal(false);
            setLastAction(`Merged "${sourceName}" into "${targetName}" (${mergePreview?.sourceEntryCount || 0} entries moved)`);
            haptic('success');
          }}
          disabled={!mergeTarget || !mergeSource || mergeTarget === mergeSource}
          style={{
            flex: 1, padding: '10px',
            background: (!mergeTarget || !mergeSource || mergeTarget === mergeSource) ? 'rgba(139,92,246,0.1)' : confirmMerge ? 'rgba(239,68,68,0.4)' : 'rgba(139,92,246,0.4)',
            border: 'none', borderRadius: '8px',
            color: (!mergeTarget || !mergeSource || mergeTarget === mergeSource) ? '#6b7280' : confirmMerge ? '#fca5a5' : '#e9d5ff',
            fontSize: '14px', fontWeight: '600', cursor: (!mergeTarget || !mergeSource || mergeTarget === mergeSource) ? 'default' : 'pointer',
            opacity: (!mergeTarget || !mergeSource || mergeTarget === mergeSource) ? 0.5 : 1,
          }}
        >
          {confirmMerge ? 'Confirm Merge' : 'Merge'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings.jsx
git commit -m "feat: add supplement merge UI to Settings"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass including new supplementMerge tests

- [ ] **Step 2: Manual testing in browser**

Run: `npm run dev`

Test in browser at Settings:
- [ ] Open merge modal via "Merge Supplements" button
- [ ] Select target and source — preview appears with entry counts
- [ ] Merge two supplements with no date conflicts — entries reassigned, source deleted
- [ ] Merge two supplements with date conflicts using "sum" — doses added
- [ ] Merge two supplements with date conflicts using "higher" — max dose kept
- [ ] Merge source with zero entries — source deleted cleanly
- [ ] After merge, check Insights chart shows combined data under target
- [ ] Close modal via Cancel or click-outside

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: supplement merge adjustments from manual testing"
```
