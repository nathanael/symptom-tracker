# Mobile ComparisonStudio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the mobile view of ComparisonStudio for better readability — larger controls, bolder graph, cleaner layout.

**Architecture:** All changes are in `src/components/ComparisonStudio.jsx`, mobile rendering path only. Shared variables (`seriesChips`, `chartSVGContent`, padding constants) need `isDesktop` conditionals to avoid affecting desktop. No new files.

**Tech Stack:** React, inline styles, SVG

**Spec:** `docs/superpowers/specs/2026-03-29-mobile-comparison-studio-redesign.md`

**Note:** All line numbers reference the original unmodified file. After each task, line numbers for subsequent tasks will have shifted — search for the code patterns rather than relying on exact line numbers.

---

### Task 1: Make Chart Padding and Height Mobile-Conditional

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:142-165`

- [ ] **Step 1: Change H_MOBILE from 400 to 500**

At line 143, change:
```jsx
const H_MOBILE = 400;
```
to:
```jsx
const H_MOBILE = 500;
```

- [ ] **Step 2: Make padLeft and padRight conditional on isDesktop**

At line 163, change:
```jsx
const padLeft = 36 * s, padRight = 20 * s, padTop = 14 * s, padBottom = 22 * s;
```
to:
```jsx
const padLeft = (isDesktop ? 36 : 22) * s, padRight = (isDesktop ? 20 : 12) * s, padTop = 14 * s, padBottom = 22 * s;
```

- [ ] **Step 3: Verify in browser**

Open the app on mobile viewport. The chart should be taller and data lines should extend closer to the edges. Desktop should look unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "refactor: mobile-conditional chart height and padding"
```

---

### Task 2: Make Graph Lines Bolder on Mobile

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:790-808`

- [ ] **Step 1: Update supplement line stroke and opacity**

At line 793, change:
```jsx
<path d={buildPath(suppPoints)} fill="none" stroke={SUPP_COLOR} strokeWidth={0.9 * s} strokeLinejoin="round" opacity={primaryIsSupplement ? 0.8 : 0.45} />
```
to:
```jsx
<path d={buildPath(suppPoints)} fill="none" stroke={isDesktop ? SUPP_COLOR : '#a78bfa'} strokeWidth={(isDesktop ? 0.9 : 2.0) * s} strokeLinecap="round" strokeLinejoin="round" opacity={primaryIsSupplement ? (isDesktop ? 0.8 : 1.0) : (isDesktop ? 0.45 : 0.6)} />
```

- [ ] **Step 2: Update symptom line stroke and opacity**

At line 803, change:
```jsx
<path d={buildPath(pts)} fill="none" stroke={SYMPTOM_STYLES[idx].color} strokeWidth={1.0 * s} strokeLinejoin="round" opacity={selectedSymptoms[idx] === primarySeriesId ? 0.8 : 0.45} />
```
to:
```jsx
<path d={buildPath(pts)} fill="none" stroke={SYMPTOM_STYLES[idx].color} strokeWidth={(isDesktop ? 1.0 : 2.0) * s} strokeLinecap="round" strokeLinejoin="round" opacity={selectedSymptoms[idx] === primarySeriesId ? (isDesktop ? 0.8 : 1.0) : (isDesktop ? 0.45 : 0.6)} />
```

- [ ] **Step 3: Increase grid line opacity on mobile**

At lines 731 and 736, change both occurrences of:
```jsx
stroke="rgba(255,255,255,0.12)" strokeWidth={0.5 * s}
```
to:
```jsx
stroke={isDesktop ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.18)"} strokeWidth={0.5 * s}
```

- [ ] **Step 4: Increase axis line opacity on mobile**

At lines 741-742, change both occurrences of:
```jsx
stroke="rgba(255,255,255,0.2)"
```
to:
```jsx
stroke={isDesktop ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.25)"}
```

- [ ] **Step 5: Verify in browser**

Mobile: lines should be noticeably thicker and brighter. Desktop: unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "ui: bolder graph lines on mobile"
```

---

### Task 3: Redesign Mobile Header Layout

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:1042-1111`

This task replaces the entire mobile header block (lines 1042-1111, including closing `)}`). The new layout removes the average display and percent badge, centers/enlarges timeframe pills, and makes the date nav bolder.

- [ ] **Step 1: Replace the mobile header block**

Replace lines 1042-1111 (the `{!isDesktop && (` block through its closing `)}`) with:

```jsx
{!isDesktop && (
  <div style={{ marginBottom: '12px' }}>
    {/* Centered timeframe pills */}
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
      <div style={{ display: 'flex', gap: '3px', borderRadius: '8px', background: 'rgba(255,255,255,0.06)', padding: '3px' }}>
        {TIMEFRAMES.map(tf => (
          <button key={tf.days} onClick={() => { setTimeframe(tf.days); haptic('light'); }}
            style={{
              padding: '8px 18px', fontSize: '18px', borderRadius: '6px',
              border: 'none', cursor: 'pointer',
              color: timeframe === tf.days ? '#fff' : '#9ca3af',
              background: timeframe === tf.days ? 'rgba(255,255,255,0.15)' : 'transparent',
              fontWeight: timeframe === tf.days ? '600' : '500',
            }}>
            {tf.label}
          </button>
        ))}
      </div>
    </div>

    {/* Bold date range navigator */}
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '14px' }}>
      <button onClick={() => { setStartOffset(prev => Math.min(prev + Math.round(timeframe / 2), maxOffset)); haptic('light'); }}
        disabled={startOffset >= maxOffset}
        style={{ background: 'none', border: 'none', color: startOffset >= maxOffset ? 'rgba(107,114,128,0.3)' : '#e5e7eb', fontSize: '28px', fontWeight: '300', cursor: startOffset >= maxOffset ? 'default' : 'pointer', padding: '4px 8px' }}>{'\u2039'}</button>
      <span style={{ flex: 1, textAlign: 'center', color: '#f3f4f6', fontSize: '17px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{dateWindowLabel}</span>
      <button onClick={() => { setStartOffset(prev => Math.max(prev - Math.round(timeframe / 2), 0)); haptic('light'); }}
        disabled={startOffset === 0}
        style={{ background: 'none', border: 'none', color: startOffset === 0 ? 'rgba(107,114,128,0.3)' : '#e5e7eb', fontSize: '28px', fontWeight: '300', cursor: startOffset === 0 ? 'default' : 'pointer', padding: '4px 8px' }}>{'\u203A'}</button>
    </div>

    {/* Series chips */}
    {seriesChips}
  </div>
)}
```

Note: The average display (lines 1045-1055), percent badge (lines 1072-1083), divider (lines 1095-1096), and insight text (lines 1101-1109) are all removed from here. Insight text moves below the chart in Task 5.

- [ ] **Step 2: Verify in browser**

Mobile: timeframe pills centered and large, date nav bold and white, no average number, no percent badge. Desktop: unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "ui: redesign mobile header - centered pills, bold date nav, remove average"
```

---

### Task 4: Enlarge Series Chips on Mobile

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:890-1032` (the `seriesChips` variable)

The `seriesChips` variable is shared between desktop and mobile. We need to use `isDesktop` to conditionally apply larger sizing on mobile.

- [ ] **Step 1: Add chip sizing constants before seriesChips**

Insert just before line 890 (`const seriesChips = (`):

```jsx
const chipPad = isDesktop ? '10px 12px' : '12px 16px';
const chipText = isDesktop ? '13px' : '15px';
const chipUnitText = isDesktop ? '11px' : '12px';
const chipDot = isDesktop ? '6px' : '8px';
const chipBorderW = isDesktop ? '1px' : '1.5px';
const chipRadius = isDesktop ? '8px' : '10px';
const chipCloseSize = isDesktop ? '14px' : '14px';
const chipCloseOpacity = isDesktop ? 0.5 : 0.7;
const addBtnPad = isDesktop ? '10px 12px' : '12px 16px';
const addBtnText = isDesktop ? '12px' : '14px';
const addBtnBorderW = isDesktop ? '1px' : '1.5px';
```

- [ ] **Step 2: Apply chipPad to supplement chip**

At line 904, change:
```jsx
padding: '10px 12px', borderRadius: '8px',
```
to:
```jsx
padding: chipPad, borderRadius: chipRadius,
```

- [ ] **Step 3: Apply chipBorderW to supplement chip border**

At line 906, update the border width. The current border expression uses a ternary for primary vs non-primary. Change the `2px` and `1px` references:
```jsx
border: isPrimary ? '2px solid rgba(139,92,246,0.6)' : '1px solid rgba(139,92,246,0.25)',
```
to:
```jsx
border: isPrimary ? '2px solid rgba(139,92,246,0.6)' : `${chipBorderW} solid rgba(139,92,246,0.35)`,
```

- [ ] **Step 4: Apply chipDot to supplement dot**

At line 910, change the dot width/height from `'6px'` to `chipDot`:
```jsx
width: '6px', height: '6px',
```
to:
```jsx
width: chipDot, height: chipDot,
```

- [ ] **Step 5: Apply chipText to supplement name and value**

Find the supplement name `fontSize: '13px'` (around line 913) and value `fontSize: '13px'` and change both to `chipText`. Find the unit text `fontSize: '11px'` and change to `chipUnitText`.

- [ ] **Step 6: Apply chipCloseOpacity to supplement close button**

Find the close button's `opacity: 0.5` and change to `chipCloseOpacity`.

- [ ] **Step 7: Apply sizing to symptom chips**

At line 976, change:
```jsx
padding: '10px 12px', borderRadius: '8px',
```
to:
```jsx
padding: chipPad, borderRadius: chipRadius,
```

At line 978, change:
```jsx
border: isPrimary ? `2px solid ${st.color}90` : `1px solid ${st.chipBorder}`,
```
to:
```jsx
border: isPrimary ? `2px solid ${st.color}90` : `${chipBorderW} solid ${st.chipBorder}`,
```

At line 982, change dot `width: '6px', height: '6px'` to `width: chipDot, height: chipDot`.

At line 985, change `fontSize: '13px'` to `chipText`.

At line 991, change `fontSize: '13px'` to `chipText`.

At line 996, change `fontSize: '11px'` to `chipUnitText`.

At line 1009, change `opacity: 0.5` to `chipCloseOpacity`.

- [ ] **Step 8: Apply addBtnPad, addBtnText, addBtnBorderW to add buttons**

Update the "+ Supplement" button (around line 946-954):

At line 948, change `padding: '10px 12px'` to `padding: addBtnPad`.
At line 949, change `border: '1px dashed rgba(139,92,246,0.4)'` to `` border: `${addBtnBorderW} dashed rgba(139,92,246,0.4)` ``.
At line 951, change `fontSize: '13px'` to `fontSize: addBtnText`.

Update the "+ Symptom" button (around line 1019-1027):

At line 1021, change `padding: '10px 12px'` to `padding: addBtnPad`.
At line 1022, change `border: '1px dashed rgba(251,113,133,0.4)'` to `` border: `${addBtnBorderW} dashed rgba(251,113,133,0.4)` ``.
At line 1024, change `fontSize: '13px'` to `fontSize: addBtnText`.

- [ ] **Step 9: Verify in browser**

Mobile: chips should be noticeably larger with bigger text, dots, and padding. Desktop: unchanged.

- [ ] **Step 10: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "ui: enlarge series chips and add buttons on mobile"
```

---

### Task 5: Remove Mini-Insight Bars and Move Insight Text Below Chart

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:1212-1268` (mobile chart section)

- [ ] **Step 1: Remove mini-insight bars**

Delete lines 1228-1267 (the `{[selectedSupplement, ...selectedSymptoms].filter(...)` block that renders mini-insight bars below the chart on mobile).

- [ ] **Step 2: Add insight text below the chart SVG**

After the closing `</div>` of the touch-action div (the one wrapping the SVG, around line 1226), add:

```jsx
{/* Insight text */}
{insightData && (
  <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af', lineHeight: '1.5', padding: '8px 4px' }}>
    {insightData.insightSegments.map((seg, i) => seg.color
      ? <span key={i} style={{ color: seg.color, fontWeight: '600' }}>{seg.text}</span>
      : seg.text
    )}
  </div>
)}
```

- [ ] **Step 3: Verify in browser**

Mobile: no mini-insight bars below chart, insight text appears below graph instead. Desktop: unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "ui: move insight text below chart, remove mini-insight bars on mobile"
```

---

### Task 6: Final Verification and Deploy

**Files:**
- Modify: `package.json` (version bump)
- Modify: `src/components/Settings.jsx` (version bump)
- Modify: `src/components/QuickActionsMenu.jsx` (version bump)

- [ ] **Step 1: Test desktop view is unchanged**

Open app at >= 1024px width. Verify: timeframe pills, date nav, chips, chart lines, insight text, mini-insight bars all render exactly as before.

- [ ] **Step 2: Test mobile view matches spec**

Open app at < 1024px width. Verify:
1. No average number or percent badge at top
2. Timeframe pills centered and large (18px)
3. Date range bold, white, centered with bright arrows
4. Series chips larger (15px text, 8px dots, more padding)
5. Chart taller with lines spanning near edges
6. Graph lines bold and bright
7. No mini-insight bars below chart
8. Insight text below chart

- [ ] **Step 3: Test touch interaction**

On mobile viewport, touch and drag on chart. Crosshair vertical line should still appear and follow finger.

- [ ] **Step 4: Bump version and deploy**

Update version in all 4 locations: `package.json`, `Settings.jsx` (backup object ~line 80 AND display string ~line 750), `QuickActionsMenu.jsx`. Then:
```bash
npm run build && npm run deploy
```

- [ ] **Step 5: Commit version bump**

```bash
git add package.json src/components/Settings.jsx src/components/QuickActionsMenu.jsx
git commit -m "chore: bump version for mobile chart redesign"
```
