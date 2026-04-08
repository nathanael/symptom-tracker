# Multi-Supplement Charting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to select up to 3 supplements on the Insights chart, mirroring the existing multi-symptom selection pattern.

**Architecture:** Convert `selectedSupplement` (string) to `selectedSupplements` (array) in ComparisonStudio.jsx. Add `SUPPLEMENT_STYLES` color array. Update data pipeline, chart rendering, crosshair/tooltip, chips, picker, and persistence to work with multiple supplements. Secondary supplements are proportionally scaled to the primary's Y-axis range.

**Tech Stack:** React 18, inline styles, SVG chart rendering, localStorage persistence

**Spec:** `docs/superpowers/specs/2026-04-08-multi-supplement-charting-design.md`

---

### File Structure

All changes are in a single file:
- **Modify:** `src/components/ComparisonStudio.jsx` (lines 1-1442)

No new files needed. No test files (existing tests don't cover ComparisonStudio; manual verification per spec).

---

### Task 1: Add SUPPLEMENT_STYLES and convert state from string to array

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:18-24` (add SUPPLEMENT_STYLES after SYMPTOM_STYLES)
- Modify: `src/components/ComparisonStudio.jsx:52-71` (initialSelections + state)
- Modify: `src/components/ComparisonStudio.jsx:85` (showHealthScore)
- Modify: `src/components/ComparisonStudio.jsx:92-100` (persistence)
- Modify: `src/components/ComparisonStudio.jsx:102-108` (auto-set primary)

- [ ] **Step 1: Add SUPPLEMENT_STYLES constant**

After `SUPP_COLOR` on line 24, add:

```jsx
const SUPPLEMENT_STYLES = [
  { color: '#8b5cf6', chipBg: 'rgba(139,92,246,0.12)', chipBorder: 'rgba(139,92,246,0.35)' },
  { color: '#7c3aed', chipBg: 'rgba(124,58,237,0.12)', chipBorder: 'rgba(124,58,237,0.35)' },
  { color: '#a78bfa', chipBg: 'rgba(167,139,250,0.12)', chipBorder: 'rgba(167,139,250,0.35)' },
];
```

- [ ] **Step 2: Update initialSelections to migrate from string to array**

In `initialSelections` (line 52-69), change the supplement handling:

```jsx
const initialSelections = useMemo(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      // Migration: old format stored `supplement` as string, new format uses `supplements` array
      let supplements = [];
      if (Array.isArray(saved.supplements)) {
        supplements = saved.supplements.filter(id => id && (stackItems || []).some(i => i.id === id));
      } else if (saved.supplement && (stackItems || []).some(i => i.id === saved.supplement)) {
        supplements = [saved.supplement];
      }
      const validSymptoms = (saved.symptoms || []).filter(
        id => (symptoms || []).some(s => s.id === id && s.active)
      );
      return {
        supplements,
        symptoms: validSymptoms,
        primarySeriesId: saved.primarySeriesId || '',
      };
    }
  } catch {}
  return { supplements: [], symptoms: [], primarySeriesId: '' };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // Run once on mount only
```

- [ ] **Step 3: Convert state declaration**

Replace line 71:

```jsx
// Before:
const [selectedSupplement, setSelectedSupplement] = useState(initialSelections.supplement);

// After:
const [selectedSupplements, setSelectedSupplements] = useState(initialSelections.supplements);
```

- [ ] **Step 4: Add toggleSupplement and removeSupplement functions**

After the `removeSymptom` function (line 122), add:

```jsx
const toggleSupplement = (suppId) => {
  setSelectedSupplements(prev => {
    if (prev.includes(suppId)) return prev.filter(id => id !== suppId);
    if (prev.length >= 3) return prev;
    return [...prev, suppId];
  });
  haptic('light');
};
const removeSupplement = (suppId) => {
  setSelectedSupplements(prev => prev.filter(id => id !== suppId));
  haptic('light');
};
```

- [ ] **Step 5: Update showHealthScore**

Replace line 85:

```jsx
// Before:
const showHealthScore = !selectedSupplement && selectedSymptoms.length === 0;

// After:
const showHealthScore = selectedSupplements.length === 0 && selectedSymptoms.length === 0;
```

- [ ] **Step 6: Update persistence**

Replace the localStorage effect (lines 92-100):

```jsx
useEffect(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      supplements: selectedSupplements,
      symptoms: selectedSymptoms,
      primarySeriesId,
    }));
  } catch {}
}, [selectedSupplements, selectedSymptoms, primarySeriesId]);
```

- [ ] **Step 7: Update auto-set primary effect**

Replace lines 102-108:

```jsx
useEffect(() => {
  const allIds = [...selectedSupplements, ...selectedSymptoms].filter(Boolean);
  if (!allIds.includes(primarySeriesId) && allIds.length > 0) {
    setPrimarySeriesId(allIds[0]);
  }
}, [selectedSupplements, selectedSymptoms, primarySeriesId]);
```

- [ ] **Step 8: Verify app compiles**

Run: `npm run build 2>&1 | head -30`

The build will have errors because downstream code still references `selectedSupplement`. That's expected — we'll fix those in subsequent tasks. But there should be no syntax errors in the code we just wrote.

- [ ] **Step 9: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat(insights): convert supplement state from string to array, add SUPPLEMENT_STYLES"
```

---

### Task 2: Update data pipeline for multiple supplements

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:151-226` (suppItem, suppDoseDaily, suppTransformed, suppYMax, suppYLabels)

- [ ] **Step 1: Replace suppItem with suppItems lookup**

Replace lines 151-155:

```jsx
// Before:
const suppItem = useMemo(
  () => stackItems.find(i => i.id === selectedSupplement),
  [stackItems, selectedSupplement]
);
const suppUnit = suppItem?.unit || 'mg';

// After:
const suppItems = useMemo(
  () => selectedSupplements.map(id => stackItems.find(i => i.id === id)),
  [stackItems, selectedSupplements]
);
```

- [ ] **Step 2: Replace suppDoseDaily with suppDoseSeries (array of series)**

Replace lines 187-198:

```jsx
// Before: single suppDoseDaily memo
// After: array of series, one per selected supplement
const suppDoseSeries = useMemo(() =>
  selectedSupplements.map(suppId => {
    const raw = getSupplementDoseSeries(stackEntries, stackItems, suppId, dates);
    const valid = raw.filter(v => v !== null && v > 0).sort((a, b) => a - b);
    let capped = raw;
    if (valid.length > 2) {
      const p95 = valid[Math.floor(valid.length * 0.95)];
      const cap = p95 * 3;
      capped = raw.map(v => (v !== null && v > cap) ? cap : v);
    }
    return capped.map(v => v === null ? 0 : v);
  }),
  [selectedSupplements, stackEntries, stackItems, dates]
);
```

- [ ] **Step 3: Replace suppTransformed with suppTransformedSeries**

Replace lines 201-205:

```jsx
const suppTransformedSeries = useMemo(() =>
  suppDoseSeries.map(daily => {
    const smoothed = windowSize > 1 ? smooth(daily, windowSize) : [...daily];
    return { values: smoothed, dates: [...dates], labels: [...dates] };
  }),
  [suppDoseSeries, dates, windowSize]
);
```

- [ ] **Step 4: Update suppYMax to derive from primary supplement only**

Replace lines 208-214. The primary supplement's index determines the Y-max:

```jsx
const primarySuppIdx = selectedSupplements.indexOf(primarySeriesId);
const primarySuppTransformed = primarySuppIdx >= 0 ? suppTransformedSeries[primarySuppIdx] : (suppTransformedSeries[0] || null);
const primarySuppItem = primarySuppIdx >= 0 ? suppItems[primarySuppIdx] : (suppItems[0] || null);

const suppYMax = useMemo(() => {
  if (!primarySuppTransformed) return 100;
  const max = Math.max(...primarySuppTransformed.values.filter(v => v !== null && v !== undefined));
  if (!isFinite(max) || max <= 0) return primarySuppItem?.defaultDose || 100;
  const ceiling = Math.ceil(max * 1.1);
  return Math.max(ceiling, primarySuppItem?.defaultDose || 100);
}, [primarySuppTransformed, primarySuppItem]);
```

- [ ] **Step 5: suppYLabels stays the same** (it depends on `suppYMax` which is unchanged in interface)

No change needed.

- [ ] **Step 6: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat(insights): multi-supplement data pipeline with per-supplement series"
```

---

### Task 3: Update primaryIsSupplement, primaryDailyValues, insightData, and maxOffset

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:277-534` (derived computations)

- [ ] **Step 1: Update primaryIsSupplement**

Replace line 278:

```jsx
// Before:
const primaryIsSupplement = primarySeriesId === selectedSupplement;

// After:
const primaryIsSupplement = selectedSupplements.includes(primarySeriesId);
```

- [ ] **Step 2: Update primaryDailyValues**

Replace lines 280-285:

```jsx
const primaryDailyValues = useMemo(() => {
  const suppIdx = selectedSupplements.indexOf(primarySeriesId);
  if (suppIdx >= 0 && suppDoseSeries[suppIdx]) return suppDoseSeries[suppIdx];
  const symIdx = selectedSymptoms.indexOf(primarySeriesId);
  if (symIdx >= 0 && symptomTransformed[symIdx]) return symptomTransformed[symIdx].smoothed;
  return null;
}, [primarySeriesId, selectedSupplements, suppDoseSeries, selectedSymptoms, symptomTransformed]);
```

- [ ] **Step 3: Update insightData buildStats and secondaryIds**

In `insightData` memo (line 304-334), update the `buildStats` function and `secondaryIds`:

Replace `id === selectedSupplement` check (line 309) with:

```jsx
if (selectedSupplements.includes(id)) {
```

Replace `secondaryIds` (line 326):

```jsx
// Before:
const secondaryIds = [selectedSupplement, ...selectedSymptoms].filter(id => id && id !== primarySeriesId);

// After:
const secondaryIds = [...selectedSupplements, ...selectedSymptoms].filter(id => id && id !== primarySeriesId);
```

Update the dependency array (lines 332-334) — replace `selectedSupplement` with `selectedSupplements`.

- [ ] **Step 4: Update maxOffset supplement loop**

Replace lines 510-519:

```jsx
// Before:
if (selectedSupplement) {
  for (const key of Object.keys(stackEntries || {})) {
    if (key.endsWith(`-${selectedSupplement}`)) {
      ...
    }
  }
}

// After:
for (const suppId of selectedSupplements) {
  for (const key of Object.keys(stackEntries || {})) {
    if (key.endsWith(`-${suppId}`)) {
      const e = stackEntries[key];
      if (e?.taken) {
        const dateStr = key.slice(0, 10);
        if (!earliest || dateStr < earliest) earliest = dateStr;
      }
    }
  }
}
```

Update maxOffset dependency array: replace `selectedSupplement` with `selectedSupplements`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat(insights): update derived computations for multi-supplement"
```

---

### Task 4: Update chart points and SVG rendering

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:338-353` (suppPoints → suppPointSets)
- Modify: `src/components/ComparisonStudio.jsx:924-932` (supplement line rendering)
- Modify: `src/components/ComparisonStudio.jsx:846-916` (grid/axis references)

- [ ] **Step 1: Replace suppPoints with suppPointSets**

Replace lines 338-353:

```jsx
const suppPointSets = useMemo(() =>
  suppTransformedSeries.map((st, sIdx) => {
    const { values, dates: txDates } = st;
    const maxIdx = Math.max(1, txDates.length - 1);
    // For the primary supplement, use suppYMax directly
    // For secondary supplements, scale proportionally to primary's range
    const isPrimary = selectedSupplements[sIdx] === primarySeriesId;
    const ownMax = (() => {
      const max = Math.max(...values.filter(v => v !== null && v !== undefined));
      if (!isFinite(max) || max <= 0) return suppItems[sIdx]?.defaultDose || 100;
      return Math.ceil(max * 1.1);
    })();
    const yMax = isPrimary ? suppYMax : (primarySuppTransformed ? suppYMax : ownMax);
    // Scale: map value into primary's Y range
    const scale = isPrimary ? 1 : (ownMax > 0 ? suppYMax / ownMax : 1);

    return values.map((val, i) => {
      const dateIdx = dates.indexOf(txDates[i]);
      const x = dateIdx >= 0
        ? padLeft + (dateIdx / Math.max(1, dates.length - 1)) * chartW
        : padLeft + (i / maxIdx) * chartW;
      const scaledVal = val !== null ? val * scale : null;
      return {
        x,
        y: scaledVal === null ? null : padTop + chartH - (scaledVal / suppYMax) * chartH,
        val, // Keep original value for tooltip
      };
    });
  }),
  [suppTransformedSeries, selectedSupplements, primarySeriesId, suppYMax, primarySuppTransformed, suppItems, dates, chartW, chartH, padLeft, padTop]
);
```

- [ ] **Step 2: Update supplement line rendering in SVG**

Replace lines 924-932:

```jsx
{/* Supplement lines */}
{suppPointSets.map((pts, idx) => (
  <g key={`supp-${idx}`}>
    <path d={buildPath(pts)} fill="none"
      stroke={isDesktop ? SUPPLEMENT_STYLES[idx].color : SUPPLEMENT_STYLES[idx].color}
      strokeWidth={(isDesktop ? 0.9 : 2.5) * s} strokeLinecap="round" strokeLinejoin="round"
      opacity={selectedSupplements[idx] === primarySeriesId ? (isDesktop ? 0.8 : 1.0) : (isDesktop ? 0.45 : 0.6)} />
    {showDots && selectedSupplements[idx] === primarySeriesId && pts.map((pt, i) => (
      pt.y !== null && <circle key={`sd-${idx}-${i}`} cx={pt.x} cy={pt.y} r={1.8 * s}
        fill="rgb(15,17,21)" stroke={SUPPLEMENT_STYLES[idx].color} strokeWidth={0.8 * s} />
    ))}
  </g>
))}
```

- [ ] **Step 3: Update grid/axis supplement references**

On line 846, replace:

```jsx
// Before:
) : primaryIsSupplement && selectedSupplement ? (

// After:
) : primaryIsSupplement && selectedSupplements.length > 0 ? (
```

Same pattern on line 879 for Y-axis labels:

```jsx
// Before:
) : primaryIsSupplement && selectedSupplement ? (

// After:
) : primaryIsSupplement && selectedSupplements.length > 0 ? (
```

- [ ] **Step 4: Update right Y-axis dual-axis condition**

Replace line 898:

```jsx
// Before:
{selectedSupplement && selectedSymptoms.length > 0 && (

// After:
{selectedSupplements.length > 0 && selectedSymptoms.length > 0 && (
```

- [ ] **Step 5: Update level segments yMax**

In the level segment rendering (lines 962, 993, 1007), each references:

```jsx
const yMax = primaryIsSupplement ? suppYMax : 5;
```

This is already correct — `primaryIsSupplement` and `suppYMax` now derive from multi-supplement state.

- [ ] **Step 6: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat(insights): multi-supplement chart point calculation and SVG rendering"
```

---

### Task 5: Update crosshair/tooltip and legend

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:417-493` (crosshairData and legendItems)

- [ ] **Step 1: Update crosshairData**

Replace lines 417-455:

```jsx
const crosshairData = useMemo(() => {
  if (touchX === null) return null;

  const dateLabel = formatXLabel(dates[touchX], timeframe);
  const symptomVals = symptomTransformed.map((sd, idx) => ({
    val: sd.smoothed[touchX],
    color: SYMPTOM_STYLES[idx].color,
    name: (() => { const s = symptoms.find(s => s.id === selectedSymptoms[idx]); return s ? s.name + (s.description ? ` (${s.description})` : '') : undefined; })(),
  }));

  const items = [];
  // Add all selected supplements
  selectedSupplements.forEach((suppId, idx) => {
    const item = suppItems[idx];
    const daily = suppDoseSeries[idx];
    const val = daily ? daily[touchX] : null;
    items.push({
      name: item?.name,
      color: SUPPLEMENT_STYLES[idx].color,
      val,
      unit: item?.unit || 'mg',
    });
  });
  // Add all selected symptoms
  selectedSymptoms.forEach((symId, idx) => {
    const sym = symptoms.find(s => s.id === symId);
    items.push({
      name: sym ? sym.name + (sym.description ? ` (${sym.description})` : '') : undefined,
      color: SYMPTOM_STYLES[idx].color,
      val: symptomVals[idx]?.val ?? null,
      unit: '/5',
    });
  });
  if (showHealthScore && hsInspectValues) {
    const hsVal = hsInspectValues[touchX];
    if (hsVal !== null && hsVal !== undefined) {
      items.push({
        name: 'Health Score',
        color: HEALTH_SCORE_COLOR,
        val: Math.round(hsVal),
        unit: '%',
      });
    }
  }
  const firstSuppPts = suppPointSets[0];
  const x = firstSuppPts ? firstSuppPts[touchX]?.x : padLeft + (touchX / Math.max(1, dates.length - 1)) * chartW;
  return { dateLabel, items, x };
}, [touchX, dates, suppDoseSeries, suppPointSets, suppItems, selectedSupplements, symptomTransformed, symptoms, selectedSymptoms, timeframe, chartW, showHealthScore, hsInspectValues, padLeft]);
```

- [ ] **Step 2: Update legendItems**

Replace lines 458-493:

```jsx
const legendItems = useMemo(() => {
  if (crosshairData) return crosshairData;
  const avg = (arr) => {
    const valid = arr.filter(v => v !== null);
    return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  };
  const items = [];
  // All selected supplements
  selectedSupplements.forEach((suppId, idx) => {
    const st = suppTransformedSeries[idx];
    const item = suppItems[idx];
    if (st) {
      const vals = st.values.filter(v => v !== null && v > 0);
      const suppAvg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      items.push({ name: item?.name, color: SUPPLEMENT_STYLES[idx].color, val: suppAvg, unit: item?.unit || 'mg' });
    }
  });
  // All selected symptoms
  selectedSymptoms.forEach((symId, idx) => {
    const sd = symptomTransformed[idx];
    if (sd) {
      const sym = symptoms.find(s => s.id === symId);
      items.push({
        name: sym ? sym.name + (sym.description ? ` (${sym.description})` : '') : undefined,
        color: SYMPTOM_STYLES[idx].color,
        val: avg(sd.smoothed),
        unit: '/5',
      });
    }
  });
  if (showHealthScore && healthScoreTransformed) {
    const vals = healthScoreTransformed.values.filter(v => v !== null);
    const hsAvg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    items.push({
      name: 'Health Score',
      color: HEALTH_SCORE_COLOR,
      val: hsAvg !== null ? Math.round(hsAvg) : null,
      unit: '%',
    });
  }
  return { dateLabel: 'Average', items, x: null };
}, [crosshairData, suppTransformedSeries, suppItems, selectedSupplements, symptomTransformed, symptoms, selectedSymptoms, showHealthScore, healthScoreTransformed]);
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat(insights): multi-supplement crosshair tooltip and legend"
```

---

### Task 6: Update supplement picker to multi-select

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:549-682` (supplement picker panel)

- [ ] **Step 1: Remove old selectSupplement function**

Delete lines 549-552 (`selectSupplement` function). We already added `toggleSupplement` and `removeSupplement` in Task 1.

- [ ] **Step 2: Update picker panel to multi-select behavior**

In the supplement picker panel (lines 554-682), make these changes:

Add max message before the grid (after the search input, around line 620):

```jsx
{selectedSupplements.length >= 3 && (
  <div style={{
    padding: '0 0 10px', color: '#6b7280', fontSize: '12px', textAlign: 'center',
  }}>
    Max 3 supplements selected
  </div>
)}
```

Update the button rendering (inside the `.map()` starting around line 629):

```jsx
{(() => {
  const filtered = allSupplements.filter(s => !suppSearch || s.name.toLowerCase().includes(suppSearch.toLowerCase()) || (s.description || '').toLowerCase().includes(suppSearch.toLowerCase()));
  const autoSelected = filtered.length === 1;
  return filtered.map(supp => {
    const isSelected = selectedSupplements.includes(supp.id);
    const styleIdx = selectedSupplements.indexOf(supp.id);
    const atMax = selectedSupplements.length >= 3 && !isSelected;
    const highlighted = isSelected || autoSelected;
    const dotColor = isSelected ? SUPPLEMENT_STYLES[styleIdx].color : autoSelected ? SUPP_COLOR : '#4b5563';
    const borderColor = isSelected ? SUPPLEMENT_STYLES[styleIdx].chipBorder : autoSelected ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.06)';
    return (
      <button
        key={supp.id}
        onClick={() => toggleSupplement(supp.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 12px', minWidth: 0,
          borderRadius: '8px',
          background: highlighted ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
          border: `1px solid ${borderColor}`,
          cursor: atMax ? 'default' : 'pointer',
          opacity: atMax ? 0.35 : 1,
          textAlign: 'left',
        }}
      >
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
          background: dotColor,
        }} />
        <span style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column',
        }}>
          <span style={{
            color: highlighted ? '#e5e7eb' : '#9ca3af',
            fontSize: '13px', fontWeight: highlighted ? '500' : '400',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {supp.name}
          </span>
          {supp.description && (
            <span style={{
              color: highlighted ? '#9ca3af' : '#6b7280',
              fontSize: '11px', fontWeight: '400',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {supp.description}
            </span>
          )}
        </span>
        {highlighted && (
          <span style={{ color: isSelected ? SUPPLEMENT_STYLES[styleIdx].color : SUPP_COLOR, fontSize: '14px', flexShrink: 0 }}>&#10003;</span>
        )}
      </button>
    );
  });
})()}
```

- [ ] **Step 3: Update search Enter behavior**

The Enter key in the search input (line 609-610) currently calls `selectSupplement` and closes the picker. Change to toggle behavior:

```jsx
if (e.key === 'Enter') {
  const filtered = allSupplements.filter(s => s.name.toLowerCase().includes(suppSearch.toLowerCase()) || (s.description || '').toLowerCase().includes(suppSearch.toLowerCase()));
  if (filtered.length === 1) { toggleSupplement(filtered[0].id); }
}
```

Note: Don't close the picker on Enter anymore since it's multi-select — user should click Done.

- [ ] **Step 4: Update picker title**

Change title from "Select Supplement" to "Select Supplements" (line 588-589).

- [ ] **Step 5: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat(insights): convert supplement picker to multi-select with max 3"
```

---

### Task 7: Update series chips for multiple supplements

**Files:**
- Modify: `src/components/ComparisonStudio.jsx:1097-1164` (supplement chip section)

- [ ] **Step 1: Replace single supplement chip with multi-supplement chips**

Replace the supplement chip section (lines 1100-1164) with:

```jsx
{/* Supplement chips */}
{selectedSupplements.map((suppId, idx) => {
  const supp = allSupplements.find(s => s.id === suppId);
  const st = SUPPLEMENT_STYLES[idx];
  const isPrimary = suppId === primarySeriesId;
  const suppLegendItem = legendItems.items.find(it => it.color === st.color);
  const val = suppLegendItem?.val ?? null;
  const suppUnit = suppItems[idx]?.unit || 'mg';
  const pctChange = isPrimary && insightData ? insightData.percentChange : null;
  return (
    <div
      key={suppId}
      onClick={() => makePrimary(suppId)}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: chipPad, borderRadius: chipRadius,
        background: isPrimary ? `${st.color}45` : st.chipBg,
        border: isPrimary ? `2px solid ${st.color}90` : `${chipBorderW} solid ${st.chipBorder}`,
        cursor: 'pointer',
      }}
    >
      <span style={{ width: chipDot, height: chipDot, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
      <span style={{
        color: isPrimary ? st.color : '#9ca3af',
        fontSize: chipText, fontWeight: isPrimary ? '600' : '400', flex: 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {supp?.name}
      </span>
      <span style={{
        color: '#b0b5be', fontSize: chipText,
        fontWeight: '500', fontVariantNumeric: 'tabular-nums', flexShrink: 0,
      }}>
        {val !== null && val !== undefined && isFinite(val)
          ? (Number.isInteger(val) ? val : val.toFixed(1))
          : '--'}
      </span>
      <span style={{ color: '#6b7280', fontSize: chipUnitText, flexShrink: 0 }}>{suppUnit}</span>
      {pctChange !== null && Math.abs(pctChange) >= 2 && (
        <span style={{
          padding: '1px 5px', borderRadius: '4px', fontSize: '9px', fontWeight: '600', flexShrink: 0,
          background: getLevelColor(pctChange, false) === '#34d399' ? 'rgba(52,211,153,0.15)' : 'rgba(212,160,23,0.15)',
          color: getLevelColor(pctChange, false),
          border: `1px solid ${getLevelColor(pctChange, false)}40`,
        }}>
          {pctChange > 0 ? '\u25B2' : '\u25BC'} {Math.abs(Math.round(pctChange))}%
        </span>
      )}
      <span
        onClick={(e) => { e.stopPropagation(); removeSupplement(suppId); }}
        style={{ color: st.color, fontSize: chipCloseSize, lineHeight: 1, opacity: chipCloseOpacity, flexShrink: 0, cursor: 'pointer', marginLeft: chipCloseMargin, padding: '4px' }}
      >&times;</span>
    </div>
  );
})}

{/* + Supplement button (if room) */}
{selectedSupplements.length < 3 ? (
  <div
    onClick={() => { setShowSupplementPicker(true); haptic('light'); }}
    style={{
      display: 'flex', alignItems: 'center',
      padding: addBtnPad, borderRadius: chipRadius,
      border: `${addBtnBorderW} dashed rgba(139,92,246,0.4)`,
      background: 'transparent',
      color: 'rgba(139,92,246,0.7)', fontSize: addBtnText, fontWeight: '500',
      cursor: 'pointer',
    }}
  >
    + Supplement
  </div>
) : null}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat(insights): multi-supplement series chips with color-coded styling"
```

---

### Task 8: Final cleanup and verification

**Files:**
- Modify: `src/components/ComparisonStudio.jsx` (any remaining references)

- [ ] **Step 1: Search for any remaining references to old variable names**

Search ComparisonStudio.jsx for: `selectedSupplement`, `setSelectedSupplement`, `suppDoseDaily`, `suppTransformed` (without `Series`), `suppPoints` (without `Sets`), `suppItem` (without `s`), `selectSupplement`, `suppUnit` (at module level — it's now only used inside chip `.map()`).

Each of these should be replaced with their plural/array equivalents. Fix any that remain.

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build`

Expected: Clean build with no errors.

- [ ] **Step 3: Manual verification checklist**

Run: `npm start`

Test in browser:
- [ ] Select 1 supplement — chart shows one purple line
- [ ] Select 2nd supplement — chart shows second line in violet (#7c3aed)
- [ ] Select 3rd supplement — chart shows third line in light purple (#a78bfa)
- [ ] Try selecting 4th — picker shows "Max 3 supplements selected", button is dimmed
- [ ] Click supplement chip to make it primary — Y-axis rescales to that supplement
- [ ] Click close (x) on a chip — removes that supplement
- [ ] Hover/touch chart — tooltip shows all selected supplements with correct values and colors
- [ ] Reload page — selections persist
- [ ] Start fresh (clear localStorage) — no errors, empty state works
- [ ] Test with old localStorage format (single `supplement` key) — migrates correctly
- [ ] Supplement chips appear in row above symptom chips
- [ ] Both supplements and symptoms can be selected simultaneously (up to 3 each)

- [ ] **Step 4: Commit final cleanup**

```bash
git add src/components/ComparisonStudio.jsx
git commit -m "feat(insights): complete multi-supplement charting — cleanup and verification"
```
