# Garmin Sleep Analysis in Insights Tab — Design

**Date:** 2026-04-19
**Status:** Approved for planning

## Summary

Add a Garmin sleep analysis view to the Insights tab. Data is synced from Garmin Connect on a local machine (existing pipeline), then pushed to Firestore by a new bridge script. The symptom-tracker app reads the data from Firestore, caches it locally, and renders a lean chart view with period-vs-period comparison. Ports roughly half of `~/Dev/garmin-sleep/garmin-sleep-upgrade/garmin_sleep_analyzer.jsx` into a new `SleepAnalyzer` component.

## Goals

- View Garmin sleep metrics (Sleep Score, Duration, REM, Deep, Respiration, SpO2, Stress, HRV) in the symptom-tracker app on any device.
- Compare any two date ranges side-by-side.
- No browser-side Garmin auth, no Python server dependency for reads, no changes to the existing `sync.py` pipeline.

## Non-goals

- Multi-user Garmin sync (solo-use for now).
- Cloud Functions / scheduled cloud sync (path B — deferred; the design preserves the option).
- Feeding sleep metrics into `ComparisonStudio` alongside symptoms (separate future brainstorm).
- Real-time Firestore listeners; poll-on-open is enough for daily data.
- Drag-select chart statistics popup from the source analyzer.

## Architecture

```
Garmin Connect
    │
    ▼
sync.py (garmy, existing)      ──writes──▶  health.db (SQLite, local)
                                                │
                                                │ reads rows changed since last push
                                                ▼
                              push_to_firestore.py (new)
                                                │
                                                │ Admin SDK upsert
                                                ▼
                              Firestore: users/{uid}/garminSleep/{YYYY-MM-DD}
                                                │
                                                │ range query on Insights open
                                                ▼
                              symptom-tracker → Insights → SleepAnalyzer
                              (React + Recharts, localStorage cache)
```

Two existing pipelines, one new bridge script, one new UI component. Garmin auth stays with `garmy`; the bridge script uses a Firebase Admin service account; the web app uses its existing Google Auth session to read its own user's docs.

## Firestore schema

**Path:** `users/{uid}/garminSleep/{YYYY-MM-DD}`

**Fields (flat; only set when non-null in `health.db`):**

```js
{
  date: "2026-04-18",              // duplicated from doc ID for ordering
  deepSleepSeconds: 4200,
  lightSleepSeconds: 14400,
  remSleepSeconds: 3900,
  awakeSleepSeconds: 1800,
  sleepScore: 82,
  averageRespiration: 14.2,
  lowestRespiration: 11.5,
  avgSleepStress: 18.3,
  averageSpo2: 95,
  lowestSpo2: 89,
  hrvOvernight: 48,
  hrvWeeklyAvg: 45,
  hrvStatus: "BALANCED",
  restingHr: 52,
  syncedAt: <Firestore Timestamp>  // server timestamp at write
}
```

**Metadata:** `users/{uid}/garminSleepMeta/state` — `{ lastPushedDate, lastPushedAt, totalDocs }`. Used by the push script to know the cutoff and by the app to do delta queries.

**Why flat:** the ported analyzer and its reducers expect flat-ish access. The original `server.py` nests `spo2SleepSummary` and `sleepScores` to match Garmin's JSON export format; since we're building fresh, flat is simpler and we adapt the ported component to match.

**Storage cost:** ~2000 docs over 5 years; well under free-tier limits. Reads dominate. A session flipping through all presets stays under a few hundred reads.

**Security rules (new):**

```
match /users/{uid}/garminSleep/{day} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;   // only Admin SDK writes
}
match /users/{uid}/garminSleepMeta/{doc} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;
}
```

## Push script (`push_to_firestore.py`, new, in garmin-sleep repo)

**One-time setup:**

1. Firebase console → Project Settings → Service Accounts → generate new private key. Save to `~/Dev/garmin-sleep/firebase-admin.json`. Gitignore.
2. Write `~/Dev/garmin-sleep/.config.json`: `{ "firebase_uid": "<uid>" }`. Gitignore. UID comes from `auth.currentUser.uid` in symptom-tracker (already surfaced in Settings, or expose if not).
3. `pip install firebase-admin` into the existing `.venv`.

**Behavior:**

- Query `daily_health_metrics` with the same SELECT shape as `server.py`'s `SLEEP_QUERY`.
- Read `lastPushedDate` from the `garminSleepMeta/state` doc.
- Upsert one doc per day via `batch.set(..., merge=True)`; batch commits every 400 docs (limit is 500).
- **Always re-push the last 7 days** regardless of `lastPushedDate`, because Garmin back-fills things like HRV status and final sleep score after partial initial data. Beyond 7 days, skip already-pushed dates.
- Update `garminSleepMeta/state` at end: `lastPushedDate`, `lastPushedAt` (server timestamp), `totalDocs` increment.

**Schedule:** modify `install-schedule.sh` so the launchd job runs `sync.py && push_to_firestore.py`. If sync fails, push is skipped — no stale push against incomplete local data.

**Gitignore additions (garmin-sleep repo):** `firebase-admin.json`, `.config.json`.

## `SleepAnalyzer.jsx` (new, in symptom-tracker)

**Location:** `src/components/SleepAnalyzer.jsx` plus helpers as needed.

**Dependency:** add `recharts` to `package.json` (~200kb gzipped, loaded only when Insights is opened).

### Data hook: `useGarminSleep(user)`

1. On mount, hydrate from `localStorage.garminSleepCache` → `{ days, lastPushedAt }`. No flicker if cache exists.
2. If `user` (Firebase) present: query Firestore. First-ever load pulls everything. Subsequent loads do a delta query `where('syncedAt', '>', cache.lastPushedAt)` and merge by `date`.
3. Write merged result back to localStorage.
4. On Firestore error, show cached data + a small stale/offline indicator. Never block the UI.

Mirrors the app's existing localStorage-first pattern and sidesteps Firestore's IndexedDB persistence (already deliberately disabled in `firebase.js` for iOS Safari reasons).

### Ported features (from `garmin_sleep_analyzer.jsx`)

- Chart switcher across: Sleep Score, Duration, REM, Deep, Respiration, SpO2 (lowest), Stress, HRV.
- Date-range presets: 7d / 14d / 30d / 3mo / 6mo / 1y / All.
- Aggregation toggle: Days / Weeks / Months.
- Period-vs-period comparison mode (previous period / prior year / custom range).
- Reference lines (e.g., REM 60/90 min, Deep 60 min) and red/green/yellow coloring for out-of-range values — the source component already implements these.

### Dropped (standalone-only concerns)

- JSON drag-drop upload zone.
- `savedFiles` list + `localStorage.garmin_saved_files` file management UI.
- Upload section collapse logic.

### Deferred (MVP punt)

- Drag-select chart statistics popup (`selectionStats`). Useful but adds complexity. Add later if missed.

### Styling

Match existing symptom-tracker aesthetic (`#08090A` background, card panels used by `ComparisonStudio`) rather than the source analyzer's Tailwind utility classes. Strip Tailwind, apply inline styles or existing project CSS conventions. Tedious but mechanical.

## Insights tab integration

Extend `Insights.jsx` with a top-of-panel segmented toggle:

```
┌──────────────────────────────────────┐
│  [ Comparison ]  [ Sleep ]           │
├──────────────────────────────────────┤
│  <ComparisonStudio />  OR            │
│  <SleepAnalyzer />                   │
└──────────────────────────────────────┘
```

- Local state `insightsView: 'comparison' | 'sleep'`, default `'comparison'` (existing behavior preserved on first open).
- Persist selection in `localStorage.insightsView` so reopens remember.
- Styling matches existing `DayNightToggle` / tab conventions.
- `user` prop is threaded from App → Insights → SleepAnalyzer.

### Empty states

- Not signed in → "Sign in with Google in Settings to view Garmin sleep data."
- Signed in, zero docs → "No sleep data synced yet. Run `sync.py && push_to_firestore.py` on your Mac." (Dev-facing copy is fine; solo-user feature.)
- Firestore fetch failed, no cache → error message + retry button.

## Testing

- **`push_to_firestore.py`:** unit-test the `to_firestore_shape()` mapper and the "last 7 days re-push" window logic against a fake SQLite fixture. Manual end-to-end against the real Firestore project.
- **`useGarminSleep` hook:** vitest. Seed localStorage, mock Firestore response, verify merge + cache write.
- **`SleepAnalyzer`:** smoke render test with synthetic data. No need to test Recharts internals.
- **Manual:** desktop + mobile Safari; verify localStorage cache survives refresh; verify comparison-mode math.

## Rollout

1. Land `push_to_firestore.py` + one-time backfill (~1 year of history).
2. Update Firestore security rules.
3. Land `SleepAnalyzer` component (not yet wired into Insights).
4. Wire the Insights view switcher. Bump version per `CLAUDE.md`. Build. Deploy.

## Open questions / follow-ups (not blocking)

- Whether the Settings panel should surface a "last synced at" timestamp from `garminSleepMeta/state`.
- Whether HRV needs its own reference-line thresholds (deferred — raw chart first).
- Eventual D-path: expose sleep metrics as pseudo-symptoms inside `ComparisonStudio` for cross-correlation with real symptoms and protocols. Separate brainstorm.
