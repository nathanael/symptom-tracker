# Supplement Delete & Rename Data Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rename and permanent delete tools for supplements in the Settings DATA TOOLS section.

**Architecture:** Rename the existing `supplementMerge.js` to `supplementTools.js`, add `renameSupplement`, `deleteSupplement`, and `previewDelete` functions. Add two new modals to Settings.jsx alongside the existing merge modal. Use functional updaters on state setters for sync safety.

**Tech Stack:** React 18, inline styles, vitest

**Spec:** `docs/superpowers/specs/2026-04-08-supplement-delete-rename-design.md`

---

### File Structure

- **Rename:** `src/utils/supplementMerge.js` → `src/utils/supplementTools.js` (add new functions, keep existing)
- **Rename:** `src/utils/__tests__/supplementMerge.test.js` → `src/utils/__tests__/supplementTools.test.js` (add new tests, keep existing)
- **Modify:** `src/components/Settings.jsx` (update import, add rename/delete modals)

---

### Task 1: Rename files and add utility functions with tests

**Files:**
- Rename + modify: `src/utils/supplementMerge.js` → `src/utils/supplementTools.js`
- Rename + modify: `src/utils/__tests__/supplementMerge.test.js` → `src/utils/__tests__/supplementTools.test.js`
- Modify: `src/components/Settings.jsx:4` (update import path)

- [ ] **Step 1: Rename files**

```bash
git mv src/utils/supplementMerge.js src/utils/supplementTools.js
git mv src/utils/__tests__/supplementMerge.test.js src/utils/__tests__/supplementTools.test.js
```

- [ ] **Step 2: Update import in Settings.jsx**

Change:
```jsx
import { mergeSupplements, previewMerge } from '../utils/supplementMerge';
```
To:
```jsx
import { mergeSupplements, previewMerge, renameSupplement, deleteSupplement, previewDelete } from '../utils/supplementTools';
```

- [ ] **Step 3: Update import in test file**

In `src/utils/__tests__/supplementTools.test.js`, change:
```jsx
import { mergeSupplements, previewMerge } from '../supplementMerge';
```
To:
```jsx
import { mergeSupplements, previewMerge, renameSupplement, deleteSupplement, previewDelete } from '../supplementTools';
```

- [ ] **Step 4: Add tests for new functions**

Append to `src/utils/__tests__/supplementTools.test.js`:

```js
describe('previewDelete', () => {
  it('counts entries for the target', () => {
    const stackEntries = {
      '2026-03-01-item-1': { date: '2026-03-01', itemId: 'item-1', dose: 100, taken: true },
      '2026-03-02-item-1': { date: '2026-03-02', itemId: 'item-1', dose: 200, taken: true },
      '2026-03-01-item-2': { date: '2026-03-01', itemId: 'item-2', dose: 50, taken: true },
    };
    const result = previewDelete(stackEntries, 'item-1');
    expect(result.entryCount).toBe(2);
  });

  it('returns zero for item with no entries', () => {
    const result = previewDelete({}, 'item-1');
    expect(result.entryCount).toBe(0);
  });
});

describe('deleteSupplement', () => {
  const stackItems = [
    { id: 'item-1', name: 'B1', unit: 'mg', defaultDose: 100, active: true },
    { id: 'item-2', name: 'Magnesium', unit: 'mg', defaultDose: 400, active: true },
  ];

  it('removes item and all its entries', () => {
    const stackEntries = {
      '2026-03-01-item-1': { date: '2026-03-01', itemId: 'item-1', dose: 100, taken: true },
      '2026-03-02-item-1': { date: '2026-03-02', itemId: 'item-1', dose: 200, taken: true },
      '2026-03-01-item-2': { date: '2026-03-01', itemId: 'item-2', dose: 50, taken: true },
    };
    const result = deleteSupplement(stackItems, stackEntries, 'item-1');
    expect(result.stackItems).toHaveLength(1);
    expect(result.stackItems[0].id).toBe('item-2');
    expect(Object.keys(result.stackEntries)).toHaveLength(1);
    expect(result.stackEntries['2026-03-01-item-2']).toBeDefined();
    expect(result.deletedCount).toBe(2);
  });

  it('handles item with zero entries', () => {
    const result = deleteSupplement(stackItems, {}, 'item-1');
    expect(result.stackItems).toHaveLength(1);
    expect(result.deletedCount).toBe(0);
  });
});

describe('renameSupplement', () => {
  const stackItems = [
    { id: 'item-1', name: 'B1', unit: 'mg', defaultDose: 100, active: true, history: [] },
    { id: 'item-2', name: 'Magnesium', unit: 'mg', defaultDose: 400, active: true, history: [] },
  ];

  it('updates name and adds history entry', () => {
    const result = renameSupplement(stackItems, 'item-1', 'Vitamin B1');
    expect(result).toHaveLength(2);
    const renamed = result.find(i => i.id === 'item-1');
    expect(renamed.name).toBe('Vitamin B1');
    expect(renamed.history).toHaveLength(1);
    expect(renamed.history[0].type).toBe('updated');
    expect(renamed.history[0].changes.name).toEqual({ from: 'B1', to: 'Vitamin B1' });
  });

  it('does not modify other items', () => {
    const result = renameSupplement(stackItems, 'item-1', 'Vitamin B1');
    const other = result.find(i => i.id === 'item-2');
    expect(other.name).toBe('Magnesium');
    expect(other.history).toHaveLength(0);
  });
});
```

- [ ] **Step 5: Run tests to verify new ones fail**

Run: `npx vitest run src/utils/__tests__/supplementTools.test.js`
Expected: Existing merge tests PASS, new tests FAIL (functions not exported)

- [ ] **Step 6: Implement new functions**

Append to `src/utils/supplementTools.js`:

```js
/**
 * Preview a delete: count entries that will be removed.
 */
export function previewDelete(stackEntries, targetId) {
  let entryCount = 0;
  for (const key of Object.keys(stackEntries)) {
    if (key.endsWith(`-${targetId}`)) entryCount++;
  }
  return { entryCount };
}

/**
 * Delete a supplement and all its entries.
 * Returns { stackItems, stackEntries, deletedCount }.
 */
export function deleteSupplement(stackItems, stackEntries, targetId) {
  const newEntries = {};
  let deletedCount = 0;
  for (const [key, entry] of Object.entries(stackEntries)) {
    if (key.endsWith(`-${targetId}`)) {
      deletedCount++;
    } else {
      newEntries[key] = entry;
    }
  }
  const newStackItems = stackItems.filter(i => i.id !== targetId);
  return { stackItems: newStackItems, stackEntries: newEntries, deletedCount };
}

/**
 * Rename a supplement. Returns new stackItems array.
 * Appends a history entry tracking the name change.
 */
export function renameSupplement(stackItems, targetId, newName) {
  return stackItems.map(item => {
    if (item.id !== targetId) return item;
    const historyEntry = {
      timestamp: new Date().toISOString(),
      type: 'updated',
      changes: { name: { from: item.name, to: newName } },
    };
    return {
      ...item,
      name: newName,
      history: [...(item.history || []), historyEntry],
    };
  });
}
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run src/utils/__tests__/supplementTools.test.js`
Expected: All tests PASS (existing merge + new delete/rename)

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 9: Commit**

```bash
git add src/utils/supplementTools.js src/utils/__tests__/supplementTools.test.js src/components/Settings.jsx
git commit -m "feat: add renameSupplement, deleteSupplement utilities; rename supplementMerge to supplementTools"
```

---

### Task 2: Add rename and delete modals to Settings

**Files:**
- Modify: `src/components/Settings.jsx` (add state, add UI)

- [ ] **Step 1: Add state declarations**

After the existing merge state declarations (around line 58, after `confirmMerge`), add:

```jsx
const [showRenameModal, setShowRenameModal] = useState(false);
const [renameTarget, setRenameTarget] = useState('');
const [renameValue, setRenameValue] = useState('');

const [showDeleteModal, setShowDeleteModal] = useState(false);
const [deleteTarget, setDeleteTarget] = useState('');
const [confirmDelete, setConfirmDelete] = useState(false);
```

- [ ] **Step 2: Add computed previews**

After the existing `mergePreview` (around line 62), add:

```jsx
const deletePreview = deleteTarget ? previewDelete(stackEntries, deleteTarget) : null;
```

- [ ] **Step 3: Add rename and delete buttons to DATA TOOLS section**

Find the closing `</div>` of the merge button's container (the one right before `{showMergeModal && (`). After that container div but before the merge modal, add:

```jsx
<div style={{
  background: 'rgba(15, 17, 21, 0.5)',
  borderRadius: '12px',
  marginBottom: '12px',
  overflow: 'hidden',
}}>
  <button
    onClick={() => { setShowRenameModal(true); setRenameTarget(''); setRenameValue(''); haptic('light'); }}
    style={{
      width: '100%',
      background: 'transparent',
      border: 'none',
      borderBottom: '1px solid rgba(100, 116, 139, 0.15)',
      padding: '14px 16px',
      color: '#a5b4fc',
      fontSize: '15px',
      cursor: 'pointer',
      textAlign: 'left',
    }}
  >
    <div>Rename Supplement</div>
    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Change a supplement's display name</div>
  </button>
  <button
    onClick={() => { setShowDeleteModal(true); setDeleteTarget(''); setConfirmDelete(false); haptic('light'); }}
    style={{
      width: '100%',
      background: 'transparent',
      border: 'none',
      padding: '14px 16px',
      color: '#fca5a5',
      fontSize: '15px',
      cursor: 'pointer',
      textAlign: 'left',
    }}
  >
    <div>Delete Supplement</div>
    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>Permanently remove a supplement and all its entries</div>
  </button>
</div>
```

- [ ] **Step 4: Add rename modal**

After the merge modal's closing `)}` (around line 1030) and before the `{/* Danger Zone */}` comment, add:

```jsx
{showRenameModal && (
  <div
    onClick={() => setShowRenameModal(false)}
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
        Rename Supplement
      </h3>

      <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
        Supplement
      </label>
      <select
        value={renameTarget}
        onChange={(e) => {
          setRenameTarget(e.target.value);
          const item = (stackItems || []).find(i => i.id === e.target.value);
          setRenameValue(item ? item.name : '');
        }}
        style={{
          width: '100%', padding: '10px 12px', marginBottom: '12px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px', color: '#e5e7eb', fontSize: '14px',
        }}
      >
        <option value="">Select supplement...</option>
        {(stackItems || []).sort((a, b) => a.name.localeCompare(b.name)).map(item => (
          <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (hidden)'}</option>
        ))}
      </select>

      {renameTarget && (
        <>
          <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
            New name
          </label>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', marginBottom: '16px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </>
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={() => setShowRenameModal(false)}
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
            if (!renameTarget || !renameValue.trim()) return;
            const oldName = (stackItems || []).find(i => i.id === renameTarget)?.name;
            const newItems = renameSupplement(stackItems, renameTarget, renameValue.trim());
            setStackItems(() => newItems);
            setShowRenameModal(false);
            setLastAction(`Renamed "${oldName}" to "${renameValue.trim()}"`);
            haptic('success');
          }}
          disabled={!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name}
          style={{
            flex: 1, padding: '10px',
            background: (!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name) ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.4)',
            border: 'none', borderRadius: '8px',
            color: (!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name) ? '#6b7280' : '#e9d5ff',
            fontSize: '14px', fontWeight: '600',
            cursor: (!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name) ? 'default' : 'pointer',
            opacity: (!renameTarget || !renameValue.trim() || renameValue.trim() === (stackItems || []).find(i => i.id === renameTarget)?.name) ? 0.5 : 1,
          }}
        >
          Rename
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: Add delete modal**

After the rename modal, add:

```jsx
{showDeleteModal && (
  <div
    onClick={() => setShowDeleteModal(false)}
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
        border: '1px solid rgba(239,68,68,0.3)',
        padding: '20px',
      }}
    >
      <h3 style={{ color: '#f8fafc', fontSize: '18px', fontWeight: '600', margin: '0 0 16px' }}>
        Delete Supplement
      </h3>

      <label style={{ color: '#9ca3af', fontSize: '12px', fontWeight: '500', display: 'block', marginBottom: '4px' }}>
        Supplement
      </label>
      <select
        value={deleteTarget}
        onChange={(e) => { setDeleteTarget(e.target.value); setConfirmDelete(false); }}
        style={{
          width: '100%', padding: '10px 12px', marginBottom: '12px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px', color: '#e5e7eb', fontSize: '14px',
        }}
      >
        <option value="">Select supplement...</option>
        {(stackItems || []).sort((a, b) => a.name.localeCompare(b.name)).map(item => (
          <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (hidden)'}</option>
        ))}
      </select>

      {deleteTarget && deletePreview && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '16px',
          fontSize: '13px',
          color: '#fca5a5',
          lineHeight: '1.6',
        }}>
          <div>{deletePreview.entryCount} historical entries will be permanently deleted</div>
          <div style={{ marginTop: '4px' }}>
            &quot;{(stackItems || []).find(i => i.id === deleteTarget)?.name}&quot; cannot be recovered
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={() => setShowDeleteModal(false)}
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
            if (!deleteTarget) return;
            if (!confirmDelete) { setConfirmDelete(true); return; }
            const itemName = (stackItems || []).find(i => i.id === deleteTarget)?.name;
            const result = deleteSupplement(stackItems, stackEntries, deleteTarget);
            setStackItems(() => result.stackItems);
            setStackEntries(() => result.stackEntries);
            setShowDeleteModal(false);
            setLastAction(`Deleted "${itemName}" (${result.deletedCount} entries removed)`);
            haptic('success');
          }}
          disabled={!deleteTarget}
          style={{
            flex: 1, padding: '10px',
            background: !deleteTarget ? 'rgba(239,68,68,0.1)' : confirmDelete ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.3)',
            border: 'none', borderRadius: '8px',
            color: !deleteTarget ? '#6b7280' : '#fca5a5',
            fontSize: '14px', fontWeight: '600',
            cursor: !deleteTarget ? 'default' : 'pointer',
            opacity: !deleteTarget ? 0.5 : 1,
          }}
        >
          {confirmDelete ? 'Confirm Delete' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Also update merge modal to use functional updaters**

In the merge modal's onClick handler, find:
```jsx
setStackItems(result.stackItems);
setStackEntries(result.stackEntries);
```
Replace with:
```jsx
setStackItems(() => result.stackItems);
setStackEntries(() => result.stackEntries);
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 8: Commit**

```bash
git add src/components/Settings.jsx
git commit -m "feat: add rename and delete supplement modals to Settings"
```

---

### Task 3: Verification

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Manual testing**

Run: `npm run dev`

Test in browser at Settings → DATA TOOLS:
- [ ] Rename: select supplement, change name, click Rename — name updates everywhere
- [ ] Rename: button disabled when name is empty or unchanged
- [ ] Delete: select supplement, preview shows entry count, first click turns red, second click deletes
- [ ] Delete: item and all entries removed, toast shows count
- [ ] Merge: still works (regression check after file rename)
- [ ] Close modals via Cancel or click-outside
