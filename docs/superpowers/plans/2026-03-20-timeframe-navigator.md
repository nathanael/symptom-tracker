# Timeframe Navigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slider-based time window control in ComparisonStudio with arrow-based navigation buttons.

**Architecture:** Modify ComparisonStudio.jsx only. Remove the `<input type="range">` slider, mobile pan gesture handlers, desktop touch handlers, and associated refs. Add an arrow nav row (`|<`, `<`, `>`, `>|`) flanking the date label, placed below the timeframe pills in both mobile and desktop layouts. Reuse existing `startOffset`/`maxOffset` state.

**Tech Stack:** React (existing component), inline styles (matching existing patterns)

**Spec:** `docs/superpowers/specs/2026-03-20-timeframe-navigator-design.md`

---

### Task 1: Remove slider, pan handlers, and associated dead code

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

This task removes everything the new navigator replaces. After this task, the time window is locked (no way to change offset) — Task 2 restores navigation.

- [ ] **Step 1: Remove the slider CSS `<style>` block**

Remove lines ~1148-1153 — the `.cs-slider` CSS-in-JS `<style>` tag:

```jsx
// DELETE this entire block:
{/* Shared slider CSS */}
<style>{`
  .cs-slider { ... }
  ...
`}</style>
```

- [ ] **Step 2: Remove the desktop slider UI**

Remove lines ~1203-1212 — the `<div>` containing the `<input type="range">`:

```jsx
// DELETE this entire block:
{/* Date window slider */}
<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '22px' }}>
  <span style={{ color: '#9ca3af', fontSize: '8px', whiteSpace: 'nowrap' }}>{dateWindowLabel}</span>
  <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
    <input type="range" className="cs-slider" min="0" max={maxOffset} step="1" value={startOffset}
      onChange={(e) => setStartOffset(parseInt(e.target.value))}
      style={{ width: '120px' }}
    />
  </div>
</div>
```

- [ ] **Step 3: Remove mobile pan gesture handlers**

Remove these three handler functions (~lines 334-364):

```jsx
// DELETE: handleMobileTouchStart (useCallback, ~lines 334-339)
// DELETE: handleMobileTouchMove (useCallback, ~lines 341-359)
// DELETE: handleMobileTouchEnd (useCallback, ~lines 361-364)
```

- [ ] **Step 4: Remove desktop touch handlers**

Remove these three one-line handlers (~lines 329-331):

```jsx
// DELETE:
const handleDesktopTouchStart = (e) => { e.preventDefault(); setTouchX(getSnappedIndex(e.touches[0].clientX)); };
const handleDesktopTouchMove = (e) => { e.preventDefault(); setTouchX(getSnappedIndex(e.touches[0].clientX)); };
const handleDesktopTouchEnd = () => setTouchX(null);
```

- [ ] **Step 5: Remove `panRef` and `maxOffsetRef`**

Remove lines ~105-106:

```jsx
// DELETE:
const panRef = useRef({ startX: 0, startOffset: 0, isPanning: false, startTime: 0 });
const maxOffsetRef = useRef(0);
```

Also remove the `maxOffsetRef.current = maxOffset;` assignment at line ~468.

- [ ] **Step 6: Remove touch handler props from SVG elements**

In the **desktop** SVG (~line 1255), remove touch props but keep mouse props:

```jsx
// BEFORE:
<svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
  onTouchStart={handleDesktopTouchStart} onTouchMove={handleDesktopTouchMove} onTouchEnd={handleDesktopTouchEnd}
  onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
  style={{ display: 'block' }}
>

// AFTER:
<svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
  onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
  style={{ display: 'block' }}
>
```

In the **mobile** SVG (~line 1303), remove touch props but keep mouse props:

```jsx
// BEFORE:
<svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
  onTouchStart={handleMobileTouchStart} onTouchMove={handleMobileTouchMove} onTouchEnd={handleMobileTouchEnd}
  onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
  style={{ display: 'block' }}
>

// AFTER:
<svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`}
  onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
  style={{ display: 'block' }}
>
```

- [ ] **Step 7: Remove the mobile date range label (will be part of arrow nav in Task 2)**

Remove the standalone mobile date label block (~lines 1297-1299):

```jsx
// DELETE:
{/* Date range label */}
<div style={{ textAlign: 'center', marginBottom: '6px' }}>
  <span style={{ color: '#9ca3af', fontSize: '10px' }}>{dateWindowLabel}</span>
</div>
```

- [ ] **Step 8: Verify the app builds and renders**

Run: `npm run build`
Expected: Builds without errors. ComparisonStudio renders with timeframe pills but no slider or date label. The chart is locked to today (offset 0).

- [ ] **Step 9: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "refactor: remove slider, pan handlers, and touch handlers from ComparisonStudio"
```

---

### Task 2: Add arrow navigation row

**Files:**
- Modify: `src/components/ComparisonStudio.jsx`

This task adds the arrow nav row to both desktop and mobile layouts.

- [ ] **Step 1: Add the arrow nav row to the desktop layout**

Insert after the desktop timeframe pills `</div>` (after line ~1201), replacing where the slider was:

```jsx
{/* Arrow nav row */}
<div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '22px' }}>
  <div style={{ display: 'flex', gap: '2px' }}>
    <button
      onClick={() => { setStartOffset(maxOffset); haptic('light'); }}
      disabled={startOffset >= maxOffset}
      style={{
        padding: '3px 6px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '10px',
        cursor: startOffset >= maxOffset ? 'default' : 'pointer',
        opacity: startOffset >= maxOffset ? 0.3 : 1,
      }}
    >|&lt;</button>
    <button
      onClick={() => { setStartOffset(prev => Math.min(prev + Math.round(timeframe / 2), maxOffset)); haptic('light'); }}
      disabled={startOffset >= maxOffset}
      style={{
        padding: '3px 6px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '10px',
        cursor: startOffset >= maxOffset ? 'default' : 'pointer',
        opacity: startOffset >= maxOffset ? 0.3 : 1,
      }}
    >&lt;</button>
  </div>
  <span style={{ flex: 1, textAlign: 'center', color: '#9ca3af', fontSize: '10px', whiteSpace: 'nowrap' }}>
    {dateWindowLabel}
  </span>
  <div style={{ display: 'flex', gap: '2px' }}>
    <button
      onClick={() => { setStartOffset(prev => Math.max(prev - Math.round(timeframe / 2), 0)); haptic('light'); }}
      disabled={startOffset === 0}
      style={{
        padding: '3px 6px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '10px',
        cursor: startOffset === 0 ? 'default' : 'pointer',
        opacity: startOffset === 0 ? 0.3 : 1,
      }}
    >&gt;</button>
    <button
      onClick={() => { setStartOffset(0); haptic('light'); }}
      disabled={startOffset === 0}
      style={{
        padding: '3px 6px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '10px',
        cursor: startOffset === 0 ? 'default' : 'pointer',
        opacity: startOffset === 0 ? 0.3 : 1,
      }}
    >&gt;|</button>
  </div>
</div>
```

- [ ] **Step 2: Add the arrow nav row to the mobile layout**

Insert after the mobile timeframe pills `</div>` (after line ~1294), where the date label and slider used to be:

```jsx
{/* Arrow nav row */}
<div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '10px' }}>
  <div style={{ display: 'flex', gap: '2px' }}>
    <button
      onClick={() => { setStartOffset(maxOffset); haptic('light'); }}
      disabled={startOffset >= maxOffset}
      style={{
        padding: '4px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '11px',
        cursor: startOffset >= maxOffset ? 'default' : 'pointer',
        opacity: startOffset >= maxOffset ? 0.3 : 1,
      }}
    >|&lt;</button>
    <button
      onClick={() => { setStartOffset(prev => Math.min(prev + Math.round(timeframe / 2), maxOffset)); haptic('light'); }}
      disabled={startOffset >= maxOffset}
      style={{
        padding: '4px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '11px',
        cursor: startOffset >= maxOffset ? 'default' : 'pointer',
        opacity: startOffset >= maxOffset ? 0.3 : 1,
      }}
    >&lt;</button>
  </div>
  <span style={{ flex: 1, textAlign: 'center', color: '#9ca3af', fontSize: '10px', whiteSpace: 'nowrap' }}>
    {dateWindowLabel}
  </span>
  <div style={{ display: 'flex', gap: '2px' }}>
    <button
      onClick={() => { setStartOffset(prev => Math.max(prev - Math.round(timeframe / 2), 0)); haptic('light'); }}
      disabled={startOffset === 0}
      style={{
        padding: '4px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '11px',
        cursor: startOffset === 0 ? 'default' : 'pointer',
        opacity: startOffset === 0 ? 0.3 : 1,
      }}
    >&gt;</button>
    <button
      onClick={() => { setStartOffset(0); haptic('light'); }}
      disabled={startOffset === 0}
      style={{
        padding: '4px 7px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.08)', color: '#9ca3af', fontSize: '11px',
        cursor: startOffset === 0 ? 'default' : 'pointer',
        opacity: startOffset === 0 ? 0.3 : 1,
      }}
    >&gt;|</button>
  </div>
</div>
```

- [ ] **Step 3: Verify the app builds and renders**

Run: `npm run build`
Expected: Builds without errors. Arrow nav visible below timeframe pills in both layouts. Buttons navigate through time correctly.

- [ ] **Step 4: Manual verification checklist**

Test in the browser:
1. `>|` is disabled when at today (offset 0) — should be disabled on load
2. `|<` jumps to earliest data — date label updates, chart shows oldest data
3. `<` shifts 50% of timeframe (e.g., 30 days for 2M) — date label updates correctly
4. `>` shifts back toward today — date label updates
5. `>|` snaps to today — date label shows current window
6. Changing timeframe pill resets to today
7. Near the beginning, `<` clamps to maxOffset (partial shift)
8. Disabled buttons have reduced opacity and don't fire on click
9. Test both mobile and desktop layouts

- [ ] **Step 5: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat: add arrow-based timeframe navigator to ComparisonStudio"
```
