# Multi-Supplement Charting on Insights

## Summary

Allow users to select up to 3 supplements on the Insights chart (ComparisonStudio), mirroring the existing multi-symptom selection pattern. Currently only one supplement can be displayed at a time.

## Decisions

- **Y-axis:** Primary supplement owns the axis scale; secondary/tertiary overlay as relative trend lines normalized to the primary's scale
- **Colors:** Purple family palette so supplements are visually distinct from symptom lines (pink/cyan/orange)
- **Chip layout:** Grouped rows — supplements on one row, symptoms on another

## Changes

All changes are in `src/components/ComparisonStudio.jsx` unless noted otherwise.

### 1. State

**Before:**
```js
const [selectedSupplement, setSelectedSupplement] = useState(initialSelections.supplement);  // string
```

**After:**
```js
const [selectedSupplements, setSelectedSupplements] = useState(initialSelections.supplements);  // string[]
```

Max 3 items, same as symptoms.

### 2. Color Palette

Add `SUPPLEMENT_STYLES` array mirroring `SYMPTOM_STYLES`:

```js
const SUPPLEMENT_STYLES = [
  { color: '#8b5cf6', chipBg: 'rgba(139,92,246,0.15)', chipBorder: '#8b5cf6' },  // purple (current)
  { color: '#7c3aed', chipBg: 'rgba(124,58,237,0.15)', chipBorder: '#7c3aed' },  // violet
  { color: '#a78bfa', chipBg: 'rgba(167,139,250,0.15)', chipBorder: '#a78bfa' },  // light purple
];
```

### 3. Selection Functions

Replace `selectSupplement()` with:

- `toggleSupplement(suppId)` — add/remove from array, cap at 3
- `removeSupplement(suppId)` — remove single item (for chip close button)

Same pattern as `toggleSymptom()` / `removeSymptom()`.

### 4. Data Pipeline

**Before:** `suppDoseDaily` — single memoized series for one supplement.

**After:** `suppTransformed` — memoized array of series, one per selected supplement. Each goes through the same outlier capping and smoothing pipeline.

`suppPoints` (single point set) becomes `suppPointSets` (array of point sets), mirroring `symptomPointSets`.

**Crosshair/tooltip** (`crosshairData` memo): Currently reads singular `suppDoseDaily`, `suppPoints`, and `suppItem`. Must iterate over all selected supplements to display each one's value, color, and name. The `legendItems` memo depends on this and needs the same treatment.

**`maxOffset` calculation**: Currently iterates over singular `selectedSupplement` to find earliest data point for the timeframe navigator. Must loop over all `selectedSupplements`.

**`showHealthScore` condition**: Changes from `!selectedSupplement && ...` to `selectedSupplements.length === 0 && ...`.

### 5. Y-Axis Scaling

When a supplement is primary:
- Its dose scale determines the Y-axis labels and range
- Other selected supplements are scaled proportionally: map each supplement's value range [0, itsMax] into the primary's range [0, primaryMax] so the lines overlay meaningfully. This is simple proportional scaling (value * primaryMax / itsMax).
- This is consistent with how symptoms overlay against the supplement axis today

### 6. Chart Rendering

Replace the single supplement `<path>` with a `.map()` over `suppPointSets`:

```jsx
{suppPointSets.map((pts, idx) => (
  <g key={`supp-${idx}`}>
    <path d={buildPath(pts)} fill="none"
      stroke={SUPPLEMENT_STYLES[idx].color}
      opacity={selectedSupplements[idx] === primarySeriesId ? 1.0 : 0.6} />
    {showDots && selectedSupplements[idx] === primarySeriesId && pts.map(...)}
  </g>
))}
```

### 7. Chip Layout (Below Chart)

Two grouped rows:

**Row 1 — Supplements:**
- One chip per selected supplement, colored from `SUPPLEMENT_STYLES`
- Click chip to make primary, close button to remove
- "+ Supplement" button when < 3 selected; "Max 3" message when full

**Row 2 — Symptoms:**
- Existing symptom chips (unchanged)

### 8. Picker Modal

Existing supplement picker changes from radio-style (click replaces selection) to toggle-style (click adds/removes, like symptom picker). Selected supplements show a checkmark or highlight. "Max 3 supplements selected" message when limit reached.

### 9. Persistence

localStorage key `comparisonStudioSelections` changes:
- `supplement` (string) → `supplements` (string array)
- Migration: if old `supplement` key found on load, convert to `[supplement]`
- Validation on load filters out supplements that no longer exist in `stackItems`

### 10. Primary Series

`makePrimary()` already accepts any series ID — no change needed. Clicking any supplement or symptom chip calls it.

`primaryIsSupplement` check changes from `primarySeriesId === selectedSupplement` to `selectedSupplements.includes(primarySeriesId)`.

## Scope Exclusions

- No changes to the supplement picker modal UI layout (just behavior change from single to multi-select)
- No changes to symptom selection logic
- No new components — all changes within ComparisonStudio.jsx
- No changes to dose analysis or correlation features

## Testing

Manual verification:
- Select 1, 2, 3 supplements — chart renders correct number of colored lines
- Primary supplement owns Y-axis; others overlay correctly
- Chips render in grouped rows with correct colors
- Close button removes individual supplements
- Persistence survives page reload
- Migration from old single-supplement format works
- Max 3 limit enforced in picker
