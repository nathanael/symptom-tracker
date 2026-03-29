# Unified Series Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move supplement/symptom selectors from a top-level row into the chart card (between date nav and view mode), with empty defaults and always-visible chart card.

**Architecture:** Single-file refactor of ComparisonStudio.jsx. Delete top-level selector row and empty-state gate, extract a shared `seriesChips` JSX block, insert it into both desktop left-panel and mobile layout between date nav and view mode selector.

**Tech Stack:** React (JSX, inline styles), localStorage persistence

**Spec:** `docs/superpowers/specs/2026-03-29-unified-series-selector-design.md`

---

### Task 1: Remove smart defaults and simplify initial selections

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:46-84`

- [ ] **Step 1: Delete the `smartDefaults` useMemo block (lines 46-60)**

Remove the entire block. It computes `bestSupp` and `defaultSymptom` which we no longer need.

- [ ] **Step 2: Simplify `initialSelections` to use empty defaults**

Replace the `initialSelections` useMemo (lines 62-84) with:

```jsx
const initialSelections = useMemo(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      const suppValid = saved.supplement && (stackItems || []).some(i => i.id === saved.supplement);
      const validSymptoms = (saved.symptoms || []).filter(
        id => (symptoms || []).some(s => s.id === id && s.active)
      );
      return {
        supplement: suppValid ? saved.supplement : '',
        symptoms: validSymptoms,
        viewMode: saved.viewMode && ['daily', 'weekly', 'monthly', 'cumulative'].includes(saved.viewMode) ? saved.viewMode : 'daily',
      };
    }
  } catch {}
  return { supplement: '', symptoms: [], viewMode: 'daily' };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // Run once on mount only
```

Key change: when localStorage has no saved symptoms or they're invalid, return `[]` instead of falling back to smart defaults.

- [ ] **Step 3: Verify build compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Compiled successfully (with possible warnings)

- [ ] **Step 4: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "refactor: remove smart defaults, use empty initial selections"
```

---

### Task 2: Delete top-level selector row and inputBoxStyle

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Delete `inputBoxStyle` constant (lines ~439-446)**

Remove the entire `inputBoxStyle` object. It's only used by the selector boxes we're removing.

- [ ] **Step 2: Delete the desktop selector row (the `isDesktop ?` branch, lines ~910-997)**

This is the `{isDesktop ? (` block containing the "Supplement" and "Symptoms" labeled input boxes. Delete from the opening `{isDesktop ? (` through the closing of the desktop branch (the `</div>` before `) : (`).

- [ ] **Step 3: Delete the mobile selector row (the `: (` branch, lines ~998-1060)**

This is the mobile chip row with `+ Supplement` / `+ Symptom` inline pills. Delete from `/* Mobile: compact chip row */` through the closing `)}` of the ternary.

The entire `{isDesktop ? (...) : (...)}` selector block should now be gone.

- [ ] **Step 4: Verify build compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Compiled successfully

- [ ] **Step 5: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "refactor: remove top-level supplement/symptom selector row"
```

---

### Task 3: Remove `hasAnySeries` empty-state gate

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Delete `hasAnySeries` variable (line ~436)**

Remove: `const hasAnySeries = selectedSupplement || selectedSymptoms.length > 0;`

- [ ] **Step 2: Remove the conditional wrapper around chart card**

Find the `{!hasAnySeries ? (` ternary (around line ~1062). This wraps:
- An empty-state placeholder div (lines ~1063-1072, shown when no series)
- A `<> ... </>` fragment (lines ~1074, ~1369) containing the chart card content

Restructure as follows:

1. Delete the ternary opening: `{!hasAnySeries ? (`
2. Delete the empty-state placeholder div entirely (lines ~1063-1072)
3. Delete the `) : (` between placeholder and chart content
4. Delete the fragment wrapper `<>` (line ~1074) and its closing `</>` (line ~1369)
5. Delete the closing `)}` of the ternary (line ~1370)

The chart card `<div>` with background/border/padding should now render unconditionally.

Then, inside both the desktop and mobile chart branches, wrap the SVG chart in a conditional so it only renders when series are selected. Where the SVG currently renders, add:

```jsx
{(selectedSupplement || selectedSymptoms.length > 0) ? (
  {/* existing SVG chart code */}
) : (
  <div style={{
    padding: '48px 20px', textAlign: 'center',
  }}>
    <div style={{ color: '#6b7280', fontSize: '13px', lineHeight: '1.6' }}>
      Select at least one supplement or symptom<br />to visualize trends over time
    </div>
  </div>
)}
```

**Note:** Tasks 2-6 should be applied in sequence within one session — intermediate states between tasks may leave the UI incomplete (e.g., no way to add series until Task 4-6 insert the chips).

- [ ] **Step 3: Verify build compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Compiled successfully

- [ ] **Step 4: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "refactor: always render chart card, move empty state inside"
```

---

### Task 4: Create shared seriesChips JSX block

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Create `seriesChips` as a JSX variable before the return statement**

Add this near the other pre-render variables (after `viewModeSelector`, before `return`):

```jsx
// ── Series chips (shared between desktop/mobile) ──
const seriesChips = (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
    {/* Supplement chip or + button */}
    {selectedSupplement ? (() => {
      const supp = allSupplements.find(s => s.id === selectedSupplement);
      return (
        <div
          onClick={() => { setSelectedSupplement(''); haptic('light'); }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', borderRadius: '8px',
            background: 'rgba(139,92,246,0.12)',
            border: '1px solid rgba(139,92,246,0.35)',
            color: SUPP_COLOR, fontSize: '13px', fontWeight: '500',
            cursor: 'pointer',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {supp?.name}
          </span>
          <span style={{ fontSize: '14px', lineHeight: 1, opacity: 0.7, flexShrink: 0, marginLeft: '8px' }}>×</span>
        </div>
      );
    })() : (
      <div
        onClick={() => { setShowSupplementPicker(true); haptic('light'); }}
        style={{
          display: 'flex', alignItems: 'center',
          padding: '6px 10px', borderRadius: '8px',
          border: '1px dashed rgba(139,92,246,0.4)',
          background: 'transparent',
          color: 'rgba(139,92,246,0.7)', fontSize: '13px', fontWeight: '500',
          cursor: 'pointer',
        }}
      >
        + Supplement
      </div>
    )}

    {/* Symptom chips */}
    {selectedSymptoms.map((symId, idx) => {
      const sym = activeSymptoms.find(s => s.id === symId);
      const st = SYMPTOM_STYLES[idx];
      return (
        <div
          key={symId}
          onClick={() => { removeSymptom(symId); }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', borderRadius: '8px',
            background: st.chipBg,
            border: `1px solid ${st.chipBorder}`,
            color: st.color, fontSize: '13px', fontWeight: '500',
            cursor: 'pointer',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sym?.name}{sym?.description ? <span style={{ opacity: 0.7, fontWeight: '400' }}> — {sym.description}</span> : null}
          </span>
          <span style={{ fontSize: '14px', lineHeight: 1, opacity: 0.7, flexShrink: 0, marginLeft: '8px' }}>×</span>
        </div>
      );
    })}

    {/* + Symptom button (if room) */}
    {selectedSymptoms.length < 3 && (
      <div
        onClick={() => { setShowSymptomPicker(true); haptic('light'); }}
        style={{
          display: 'flex', alignItems: 'center',
          padding: '6px 10px', borderRadius: '8px',
          border: '1px dashed rgba(251,113,133,0.4)',
          background: 'transparent',
          color: 'rgba(251,113,133,0.7)', fontSize: '13px', fontWeight: '500',
          cursor: 'pointer',
        }}
      >
        + Symptom
      </div>
    )}
  </div>
);
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Compiled successfully

- [ ] **Step 3: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: create shared seriesChips component for unified selector"
```

---

### Task 5: Insert seriesChips into desktop left panel

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Add seriesChips between date nav and View section in desktop left panel**

In the desktop left panel (inside the `isDesktop ?` chart layout branch), find the divider after the arrow nav row (line ~1175):

```jsx
{/* Divider */}
<div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '16px 0' }} />
```

After this divider, insert:

```jsx
{/* Series chips */}
{seriesChips}

{/* Divider */}
<div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '16px 0' }} />
```

The existing "View" section header and `{viewModeSelector(false)}` should come after this new divider.

- [ ] **Step 2: Verify build compiles and visually check desktop layout**

Run: `npm run build 2>&1 | tail -5`
Expected: Compiled successfully

- [ ] **Step 3: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: insert series chips into desktop left panel"
```

---

### Task 6: Insert seriesChips into mobile layout and move view mode selector

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Add seriesChips + view mode selector between date nav and chart in mobile**

In the mobile layout (the `else` branch of `isDesktop`), find the arrow nav row's closing `</div>` (after the date nav, around line ~1307). After it, insert:

```jsx
{/* Divider */}
<div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '10px 0' }} />

{/* Series chips */}
{seriesChips}

{/* Divider */}
<div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '10px 0' }} />

{/* View Mode Selector — moved above chart */}
<div style={{ marginBottom: '10px' }}>
  {viewModeSelector(true)}
</div>
```

- [ ] **Step 2: Remove old view mode selector from below chart**

Delete the block currently at lines ~1319-1322:

```jsx
{/* View Mode Selector — below chart */}
<div style={{ marginTop: '10px', marginBottom: '8px' }}>
  {viewModeSelector(true)}
</div>
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run build 2>&1 | tail -5`
Expected: Compiled successfully

- [ ] **Step 4: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: insert series chips into mobile layout, move view mode above chart"
```

---

### Task 7: Final verification and cleanup

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

- [ ] **Step 1: Run full build**

Run: `npm run build 2>&1 | tail -10`
Expected: Compiled successfully

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass

- [ ] **Step 3: Search for any remaining references to removed code**

Grep for `inputBoxStyle`, `smartDefaults`, `hasAnySeries` in the file to confirm they're fully removed.

- [ ] **Step 4: Clean up any unused state variables**

Check if `showSupplementPicker`, `showSymptomPicker`, `suppSearch`, `symSearch`, `suppSearchRef`, `symSearchRef` are still used (they should be — the picker panels are kept). Remove any that are now dead code.

- [ ] **Step 5: Commit any cleanup**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "chore: cleanup unused references after selector refactor"
```
