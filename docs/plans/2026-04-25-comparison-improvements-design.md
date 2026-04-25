# Comparison view improvements — design

Date: 2026-04-25
Status: approved

Three independent improvements to the Insights → Comparison view and the Export panel.

## 1. Supplement series: stepped line with rounded corners

The supplement series in Comparison currently goes through rolling-average smoothing and a monotone cubic Hermite spline (`buildPath`). Doses are inherently stepped — a 100mg → 150mg change is a discrete jump, not a curve — so the visualization misrepresents the data.

**Change**

- Drop the `smooth(daily, windowSize)` call for supplement series in `ComparisonStudio.jsx`. Symptom and health-score series keep smoothing.
- Add `buildStepPath(points, radius)` to `src/utils/chartHelpers.js`. It draws a step-before path: hold the previous y until reaching the new x, then jump to the new y. Both elbow corners at every transition are rounded with quadratic Béziers. Default radius is 12px (mid of the 10–15 range requested), scaled by the chart `s` factor like other strokes.
- Radius is clamped to half the shorter adjacent segment so consecutive-day dose changes don't overshoot.
- The supplement `<path>` block in `ComparisonStudio.jsx` swaps `buildPath(pts)` → `buildStepPath(pts, 12 * s)`.

**Unchanged**

- Symptom and health-score lines keep `buildPath` (smoothed cubic).
- Tooltip / crosshair / level segments index by date, not path geometry — no impact.
- Outlier capping (95th-percentile × 3) on the daily series stays as today.

**Edge cases**

- Consecutive identical doses → flat horizontal segment, no corner.
- Null gaps still break the path (handled by segment splitting in `buildStepPath`, mirroring `buildPath`).

## 2. Sleep section in Comparison

Garmin sleep metrics live in `SleepAnalyzer` today (`src/components/SleepAnalyzer.jsx`, `METRICS` array). Bring them into `ComparisonStudio` so users can overlay sleep against supplements/symptoms.

**Data wiring**

- Pass `user` from `Insights.jsx` → `ComparisonStudio`.
- Inside the studio, call `useGarminSleep(user)` to get `days`.
- Add `getSleepDailySeries(days, metricKey, dates)` to `src/utils/correlationHelpers.js`. Returns a daily array aligned to the comparison `dates` window, using `valueForRow` from `SleepAnalyzer.jsx`.
- Re-export `METRICS` and `valueForRow` from `SleepAnalyzer.jsx` so the metric definitions stay in one place.

**Selection state**

- New `selectedSleepMetrics` array (max 3), persisted in the existing `comparisonStudioSelections` localStorage key. Migration: missing key → empty array.
- New `showSleepPicker` panel mirroring the symptom picker (search, grid, "Max 3 selected" notice).
- Picker is driven by `METRICS` (all 7: Score, Time, REM, Deep, Resp, SpO2, Stress, HRV).

**Chips & layout**

- Third chip section below symptoms with a `+ Sleep` add-button.
- New `SLEEP_STYLES` palette of 3 colors (cyan/teal family, distinct from supplements' purple and symptoms' pink).
- Each sleep chip behaves like the others: click to make primary, × to remove, shows the period average and unit (`min`, `ms`, `%`, `brpm`, or empty for score/stress).

**Chart scaling — primary-axis pattern, identical to supplements today**

- Primary is a sleep metric → Y-axis uses nice-number labels driven by that metric's max (same logic as `suppYLabels`); secondary supplements/symptoms/sleep scale proportionally to fit.
- Primary is a supplement → secondary sleep metrics scale to the supplement's range (their own max → `suppYMax`).
- Primary is a symptom → secondary sleep metrics scale to the 0–5 axis.
- Sleep lines use `buildPath` (smoothed cubic) — same as symptoms; only supplements get the step path.

**Insight panel**

- Existing `buildStats` / `computeInsight` already consume any series. Sleep series feed in the same way with `unit` from the metric def. No structural change.

**Health Score auto-show**

- `showHealthScore` becomes true only when supplements + symptoms + sleep are all empty.

**No-data state**

- If `days` is empty (Garmin not connected), the Sleep section still renders. The picker shows an empty-state message ("No Garmin sleep data connected"). The `+ Sleep` button is disabled with a hint.

## 3. Health Score in exports

Both export paths in `Export.jsx` need the health score with a short explainer.

**Markdown export (`generateAIDataExport` in `src/utils/helpers.js`)**

New section near the top of the output, after the date-range header and before symptoms:

```
## Health Score

Daily score (0-100, higher is better) computed as 100 − (avg severity / 5 × 100) across logged active symptoms. Days with no logged symptoms are blank.

| Date       | Score |
| ---------- | ----- |
| 2026-04-25 | 84    |
| 2026-04-24 | 71    |
…
```

The score column also gets appended to the per-day symptom table that already exists, so the AI can correlate without cross-referencing.

Computation uses the existing `computeHealthScore(symptoms, entries, dateStr, trackingMode)` from `src/utils/healthScore.js`.

**CSV export (`exportCSV` in `src/utils/helpers.js`)**

- Append a `health_score` column after the symptom severity columns.
- Prepend a comment line with the explainer:

```
# health_score: 0-100, higher is better. Computed as 100 - (avg severity / 5 * 100) across logged active symptoms; blank if no symptoms logged that day.
date,symptom_a,symptom_b,...,health_score
2026-04-25,3,2,...,84
```

Excel/Numbers ignore lines starting with `#`. If a downstream parser is strict, we can switch to a separate header-row convention later.

## Out of scope

- No new aggregations (weekly/monthly) for sleep in the comparison view; daily resolution only.
- No backfill of pre-existing exports.
- No deploy of the design doc itself; deploy happens once the implementation lands per CLAUDE.md.
