# Rapid Entry Navigation Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2-button (Back/Next) navigation in RapidEntry with a 4-button icon bar (`<< < > >>`).

**Architecture:** Single-file change to `RapidEntry.jsx`. Add a `findPrevUnfilledIndex` helper, replace the navigation JSX with a 4-column grid of SVG chevron buttons, and update the keyboard handler to step through all symptoms on ArrowRight.

**Tech Stack:** React, inline styles (existing pattern)

**Spec:** `docs/superpowers/specs/2026-04-09-rapid-entry-navigation-design.md`

---

### Task 1: Add `findPrevUnfilledIndex` helper

**Files:**
- Modify: `src/components/RapidEntry.jsx:52-64` (add after `findNextUnmarkedIndex`)

- [ ] **Step 1: Add the helper function**

Add after the existing `findNextUnmarkedIndex` function (after line 64):

```javascript
// Search backward from fromIndex-1 down to 0 (no wrap)
const findPrevUnfilledIndex = (fromIndex) => {
  for (let i = fromIndex - 1; i >= 0; i--) {
    const sym = activeSymptomsList[i];
    const entryKey = `${dateKey}-${sym.id}-${timeKey}`;
    if (!entries[entryKey]) {
      return i;
    }
  }
  return -1; // No unfilled symptom before current position
};
```

- [ ] **Step 2: Verify app still renders**

Run: `npm run dev` — open rapid entry, confirm no errors in console.

- [ ] **Step 3: Commit**

```bash
git add src/components/RapidEntry.jsx
git commit -m "feat: add findPrevUnfilledIndex helper for rapid entry nav"
```

---

### Task 2: Update keyboard handler

**Files:**
- Modify: `src/components/RapidEntry.jsx:73-113` (keyboard useEffect)

- [ ] **Step 1: Change ArrowRight to step forward 1 (all symptoms, wrapping)**

In the `useEffect` keyboard handler, replace the `ArrowRight` branch (lines 79-85):

```javascript
// Current code:
} else if (e.key === 'ArrowRight') {
  const nextUnmarked = findNextUnmarkedIndex(rapidEntryIndex);
  if (nextUnmarked !== -1) {
    setRapidEntryIndex(nextUnmarked);
  } else {
    handleClose();
  }
}
```

With:

```javascript
} else if (e.key === 'ArrowRight') {
  // Forward: step to next symptom in full list (wraps around)
  setRapidEntryIndex(prev => prev < activeSymptomsList.length - 1 ? prev + 1 : 0);
}
```

- [ ] **Step 2: Verify keyboard navigation**

Run dev server. Open rapid entry. Press ArrowRight — should step through every symptom (marked and unmarked), wrapping from last to first. ArrowLeft unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/components/RapidEntry.jsx
git commit -m "feat: ArrowRight now steps through all symptoms in rapid entry"
```

---

### Task 3: Replace navigation buttons with 4-button icon bar

**Files:**
- Modify: `src/components/RapidEntry.jsx:625-668` (navigation buttons section)

- [ ] **Step 1: Add pulse state for `<<` feedback**

At the top of the component (after the existing state-derived variables, around line 49), add:

```javascript
const [pulsePrev, setPulsePrev] = useState(false);
```

Also add `useState` to the import on line 1 (currently only imports `useEffect`):

```javascript
import { useEffect, useState } from 'react';
```

- [ ] **Step 2: Replace the navigation buttons JSX**

Replace the entire navigation div (lines 625-668):

```javascript
{/* Navigation buttons */}
<div style={{ display: 'flex', gap: '12px' }}>
  ...existing Back and Next buttons...
</div>
```

With this 4-button grid:

```jsx
{/* Navigation buttons */}
<div style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: '12px',
  width: '100%',
  maxWidth: '400px',
}}>
  {/* << Prev unfilled */}
  <button
    onClick={() => {
      const prevUnfilled = findPrevUnfilledIndex(rapidEntryIndex);
      if (prevUnfilled !== -1) {
        setRapidEntryIndex(prevUnfilled);
      } else {
        setPulsePrev(true);
        setTimeout(() => setPulsePrev(false), 400);
      }
    }}
    style={{
      padding: '16px 0',
      background: 'rgba(100, 116, 139, 0.1)',
      border: pulsePrev
        ? '1px solid rgba(239, 68, 68, 0.5)'
        : '1px solid rgba(100, 116, 139, 0.3)',
      borderRadius: '5px',
      color: pulsePrev ? '#f87171' : '#94a3b8',
      cursor: 'pointer',
      transition: 'border-color 0.3s ease, color 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  </button>

  {/* < Back one */}
  <button
    onClick={() => {
      setRapidEntryIndex(prev => prev > 0 ? prev - 1 : activeSymptomsList.length - 1);
    }}
    style={{
      padding: '16px 0',
      background: 'rgba(100, 116, 139, 0.1)',
      border: '1px solid rgba(100, 116, 139, 0.3)',
      borderRadius: '5px',
      color: '#94a3b8',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  </button>

  {/* > Forward one */}
  <button
    onClick={() => {
      setRapidEntryIndex(prev => prev < activeSymptomsList.length - 1 ? prev + 1 : 0);
    }}
    style={{
      padding: '16px 0',
      background: 'rgba(100, 116, 139, 0.1)',
      border: '1px solid rgba(100, 116, 139, 0.3)',
      borderRadius: '5px',
      color: '#94a3b8',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  </button>

  {/* >> Next unmarked */}
  <button
    onClick={() => {
      const nextUnmarked = findNextUnmarkedIndex(rapidEntryIndex);
      if (nextUnmarked !== -1) {
        setRapidEntryIndex(nextUnmarked);
      } else {
        // All marked — trigger completion (existing logic)
        if (trackingMode === 'ampm') {
          const oppositePeriod = logTime === 'morning' ? 'evening' : 'morning';
          const oppApplicable = symptoms.filter(s => s.active).filter(s => {
            if (!s.applicablePeriods) return true;
            return s.applicablePeriods.includes(oppositePeriod);
          });
          const oppositeIncomplete = oppApplicable.filter(symptom => {
            const ek = `${dateKey}-${symptom.id}-${oppositePeriod}`;
            return !entries[ek];
          });
          if (oppositeIncomplete.length > 0) {
            setRapidEntryConfirm(true);
            return;
          }
        }
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        setRapidEntryMode(false);
        setRapidEntryIndex(0);
        setCopyToastMessage('✓ All symptoms logged!');
        setTimeout(() => setCopyToastMessage(''), 3000);
      }
    }}
    style={{
      padding: '16px 0',
      background: 'rgba(100, 116, 139, 0.1)',
      border: '1px solid rgba(100, 116, 139, 0.3)',
      borderRadius: '5px',
      color: '#94a3b8',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  </button>
</div>
```

- [ ] **Step 3: Verify all 4 buttons render and work**

Run dev server. Open rapid entry:
- `<<` — jumps to prev unfilled backward. At first symptom or no unfilled before: button briefly flashes red border.
- `<` — steps back 1, wraps from first to last.
- `>` — steps forward 1, wraps from last to first.
- `>>` — jumps to next unmarked. If all marked: fires confetti and closes (or shows AM/PM confirmation).

- [ ] **Step 4: Commit**

```bash
git add src/components/RapidEntry.jsx
git commit -m "feat: replace rapid entry nav with 4-button chevron icon bar"
```

---

### Task 4: Version bump and final verification

**Files:**
- Modify: `package.json` (version)
- Modify: `src/components/Settings.jsx` (version x2)
- Modify: `src/components/QuickActionsMenu.jsx` (version)

- [ ] **Step 1: Bump version in all 4 locations**

Current version: 4.7.1. Bump to 4.7.2.

Update in:
1. `package.json` — `"version": "4.7.2"`
2. `src/components/Settings.jsx` — backup object version (~line 80)
3. `src/components/Settings.jsx` — display string (~line 750)
4. `src/components/QuickActionsMenu.jsx` — version string

- [ ] **Step 2: Full manual test**

1. Open rapid entry on mobile (or narrow viewport)
2. Verify 4-button grid is full-width, buttons are easy to tap
3. Test all 4 navigation buttons including edge cases
4. Test keyboard shortcuts (ArrowLeft, ArrowRight, Escape, 0-5, N)
5. Test completion flow (all symptoms marked → confetti)
6. Test AM/PM mode completion (opposite period prompt)

- [ ] **Step 3: Commit and deploy**

```bash
git add -A
git commit -m "bump version to 4.7.2"
npm run build && npm run deploy
```
