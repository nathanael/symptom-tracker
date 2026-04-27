# Garmin Sync Settings — Design Spec

## Problem

The symptom tracker has a SleepAnalyzer that reads Garmin sleep data from Firestore, but there's no mechanism to get data into Firestore. The garmy project (`/dev/garmy`) has a local Python server that handles Garmin authentication and syncs data to a local SQLite DB. We need to bridge these — the React app should talk to the garmy server, fetch sleep data, and write it to Firestore.

## Constraint

The garmy server runs on `localhost:8484`. This integration only works when the user has the server running locally — whether viewing the app via `localhost:5173` (dev) or the GitHub Pages deployment. When the server is unavailable, the app silently skips sync and continues reading cached data from Firestore.

## Solution

Two additions:

1. **`src/hooks/useGarminSync.js`** — hook that manages server detection, auth proxying, and data bridging (garmy server → Firestore)
2. **Settings.jsx** — new "GARMIN" section with connection status, login/MFA forms, and manual sync button

## Data Flow

```
Garmin Connect → garmy server (SQLite) → React app → Firestore
                  localhost:8484            useGarminSync
```

### Sync Algorithm (Firestore-first, no overwrites)

1. Fetch recent records from garmy server `GET /api/sleep?days=14` (auto-sync) or all data (first sync)
2. Query Firestore `/users/{uid}/garminSleep` using `select('date')` to get existing dates (projection query — only reads the `date` field, not full documents)
3. Filter server records to only dates NOT already in Firestore
4. Transform garmy server format → Firestore format (flatten nested fields, add `syncedAt`)
5. Batch write new records to Firestore (max 500 per batch; chunk if needed)
6. Trigger `useGarminSleep.refetch()` so the UI updates

### Data Format Transformation

The garmy server returns a mix of flat and nested fields. Transform function:

```js
function transformGarmyRecord(record) {
  return {
    date: record.calendarDate,
    sleepScore: record.sleepScores?.overallScore ?? null,
    averageSpo2: record.spo2SleepSummary?.averageSPO2 ?? null,
    lowestSpo2: record.spo2SleepSummary?.lowestSPO2 ?? null,
    deepSleepSeconds: record.deepSleepSeconds ?? null,
    lightSleepSeconds: record.lightSleepSeconds ?? null,
    remSleepSeconds: record.remSleepSeconds ?? null,
    awakeSleepSeconds: record.awakeSleepSeconds ?? null,
    averageRespiration: record.averageRespiration ?? null,
    lowestRespiration: record.lowestRespiration ?? null,
    avgSleepStress: record.avgSleepStress ?? null,
    hrvOvernight: record.hrvOvernight ?? null,
    hrvWeeklyAvg: record.hrvWeeklyAvg ?? null,
    hrvStatus: record.hrvStatus ?? null,
    restingHr: record.restingHr ?? null,
    syncedAt: new Date().toISOString(),
  };
}
```

## `useGarminSync` Hook

### Where it's mounted

In `App.jsx` (top level), so auto-sync runs regardless of which view is active. Settings.jsx receives the hook's state/methods as props.

### Input
- `user` — Firebase auth user object (from existing auth)
- `refetchSleep` — callback from `useGarminSleep` to refresh after sync

### State
```js
{
  serverAvailable: bool,   // garmy server reachable?
  authenticated: bool,     // Garmin auth status from server
  syncing: bool,           // sync in progress?
  lastSync: string|null,   // ISO timestamp — persisted in localStorage('garminLastSync')
  error: string|null,      // latest error message
  mfaRequired: bool,       // waiting for MFA code?
}
```

`lastSync` is persisted to `localStorage` key `'garminLastSync'` so it survives page refreshes.

### Behavior
- **On mount:** ping `localhost:8484/api/auth/status` (fetch timeout: 2s)
- **Every 10 minutes:** if `serverAvailable && authenticated && user`, run sync. Also re-check server availability.
- **Cleanup:** clear interval on unmount

### Exposed Methods
- `login(email, password)` → POST `/api/auth/login`
- `submitMfa(code)` → POST `/api/auth/mfa`
- `logout()` → POST `/api/auth/logout`, sets `authenticated: false`, clears `lastSync`
- `syncNow()` → triggers full sync immediately

### syncNow Flow
1. POST `/api/sync` with `{days: 7}` to garmy server (pulls latest from Garmin → SQLite). Fetch timeout: 120s. If this fails, continue to step 2 anyway (SQLite may still have data to bridge).
2. GET `/api/sleep` from garmy server (reads SQLite data)
3. Query Firestore for existing dates (projection query)
4. Filter to new dates only
5. Batch write to Firestore (chunk into batches of 500)
6. Persist `lastSync` to localStorage
7. Call `refetchSleep()` to update UI

### Auto-sync Flow
Same as syncNow but uses `GET /api/sleep?days=14` (only recent data) and skips the `/api/sync` step (assumes garmy's launchd schedule handles Garmin pulls).

## Settings UI — GARMIN Section

Placed between "Cloud Sync" and "TRACKING MODE" sections. Follows existing Settings styling conventions.

### States

**Server not detected:**
```
GARMIN
┌──────────────────────────────────┐
│ ⚫ Garmin server not detected    │
│                                  │
│ Start the garmy server on this   │
│ machine to sync sleep data.      │
└──────────────────────────────────┘
```

**Server online, not authenticated:**
```
GARMIN
┌──────────────────────────────────┐
│ 🟡 Server detected              │
│                                  │
│ Email:    [________________]     │
│ Password: [________________]     │
│                                  │
│         [ Log In ]               │
└──────────────────────────────────┘
```

**MFA required:**
```
GARMIN
┌──────────────────────────────────┐
│ 🟡 MFA code required            │
│                                  │
│ Code: [________________]        │
│                                  │
│      [ Submit ]  [ Cancel ]      │
└──────────────────────────────────┘
```

**Connected:**
```
GARMIN
┌──────────────────────────────────┐
│ 🟢 Connected                    │
│ Last synced: 3 min ago           │
│                                  │
│ [ Sync Now ]       [ Disconnect ]│
└──────────────────────────────────┘
```

**Syncing:**
```
GARMIN
┌──────────────────────────────────┐
│ 🟢 Connected                    │
│ Syncing...                       │
│                                  │
│ [ Sync Now (disabled) ]          │
└──────────────────────────────────┘
```

## Garmy Server Change

Add CORS headers to `server.py` so the React app can reach it from any origin:

```python
def end_headers(self):
    self.send_header('Access-Control-Allow-Origin', '*')
    self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    super().end_headers()

def do_OPTIONS(self):
    self.send_response(204)
    self.end_headers()
```

## Files Changed

| File | Change |
|---|---|
| `src/hooks/useGarminSync.js` | New — sync hook |
| `src/components/Settings.jsx` | Add GARMIN section |
| `src/App.jsx` | Mount `useGarminSync`, pass state to Settings |
| `/dev/garmy/garmin-sleep-upgrade/server.py` | Add CORS headers + OPTIONS handler |

## Non-Goals

- No Garmin OAuth in the browser (garmy server handles this)
- No changes to `useGarminSleep` or `garminSleepCache` (they keep reading from Firestore as-is)
- No changes to `SleepAnalyzer` (it consumes `useGarminSleep` output unchanged)
