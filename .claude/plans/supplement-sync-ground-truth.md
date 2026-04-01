# Supplement Sync Ground Truth Fix

## Problem Statement

Supplements that were hidden on mobile appear in the browser, and when going back to mobile, they show up for the last several days despite not being taken for weeks. Items that were hidden on mobile become visible across devices. There is no reliable "ground truth" for supplement state.

## Root Cause Analysis

After thorough investigation, **three interacting issues** cause this:

### Issue 1: Union Merge Never Removes Items (useSyncEngine.js:58-64)

The `applyCloudData` function uses a **union merge by ID** for `stackItems`:
```js
const localMap = new Map(prev.map(s => [s.id, s]));
updates.stackItems.forEach(s => localMap.set(s.id, s));
return Array.from(localMap.values());
```

This means:
- Cloud items get **added** to local state (good)
- Cloud items **overwrite** matching local items (intended)
- But local-only items that don't exist in cloud **are never removed**

**The actual problem is the reverse:** When cloud has items that local doesn't, they get added. If Device A's cloud data has a supplement that Device B had hidden/never had, Device B now gets it. The merge **only grows**, never shrinks.

### Issue 2: Dirty Flag Expiry Creates Data Loss Window (SyncEngine.js:110-116)

`DIRTY_EXPIRY_MS = 30000` (30 seconds). When the app restarts:
- If dirty flags are >30s old, they're **expired and cleared**
- This means: mobile hides a supplement, closes app, 31+ seconds pass
- On reopen, dirty flags are gone → cloud data is accepted as authoritative
- If cloud still has the old state (supplement visible), it overwrites local

**The 30-second window is far too short for real-world multi-device usage.**

### Issue 3: Cloud Becomes Stale Ground Truth

The combination of Issues 1 and 2 means:
1. Mobile hides supplement X (active: false), dirty flag set
2. Flush succeeds OR fails — either way, mobile closes app
3. If flush failed: dirty flags expire after 30s, cloud has stale data
4. Browser opens, gets cloud data (supplement X still visible)
5. Browser's auto-prefill creates entries for supplement X (it's active in cloud)
6. Browser's data syncs back to cloud
7. Mobile reopens, expired dirty flags → accepts cloud data
8. Mobile now shows supplement X as active with entries for recent days

Even if the flush DID succeed: the union merge on the other device can re-add items from its own stale localStorage that weren't in the cloud version.

---

## Fix Plan

### Phase 1: Replace Union Merge with Cloud-Authoritative Merge for stackItems

**File:** `src/hooks/useSyncEngine.js`, lines 58-64

**Current behavior:** Union merge (only adds, never removes)

**New behavior:** When cloud data arrives for `stackItems`, **replace the full array** instead of union-merging. Cloud is authoritative for the item list. This matches how `entries`, `stackEntries`, etc. already work (spread merge where cloud keys overwrite local).

```js
// BEFORE (union merge - items accumulate):
if (updates.stackItems?.length > 0 && setters.stackItems) {
  setters.stackItems(prev => {
    const localMap = new Map(prev.map(s => [s.id, s]));
    updates.stackItems.forEach(s => localMap.set(s.id, s));
    return Array.from(localMap.values());
  });
}

// AFTER (cloud-authoritative replacement):
if (updates.stackItems && setters.stackItems) {
  setters.stackItems(() => updates.stackItems);
}
```

**Same change for `inputItems`** (lines 78-84) and **`symptoms`** (lines 42-48) — all array domains should use cloud-authoritative replacement, not union merge.

**Why this is safe:** The version vector system in SyncEngine already ensures:
- If local has pending/dirty changes, cloud data is **blocked entirely** (line 416)
- Cloud data only applies when local has NO pending changes for that domain
- So replacement won't destroy in-flight local edits

**Risk mitigation:** The dirty flag + version vector system protects local edits. The only scenario where replacement could lose data is if dirty flags expire prematurely — which is fixed in Phase 2.

### Phase 2: Extend Dirty Flag Expiry

**File:** `src/sync/SyncEngine.js`, line 30

**Current:** `DIRTY_EXPIRY_MS = 30000` (30 seconds)

**New:** `DIRTY_EXPIRY_MS = 300000` (5 minutes)

**Rationale:** 30 seconds is far too short. A user can easily:
- Make changes on mobile
- Lock phone / switch apps
- Open browser 30+ seconds later
- Come back to phone minutes later

5 minutes gives enough time for the app to flush on `visibilitychange` (which fires on app background) while still expiring truly stale flags from crash scenarios.

### Phase 3: Verify Auto-Prefill Safety

**File:** `src/App.jsx`, lines 281-327

The auto-prefill effect correctly:
- Waits for `sync.isReady` (line 283)
- Only prefills active items scheduled for today (line 314)
- Only runs once per day (line 286)

**No changes needed** — but verify with testing that after Phase 1 fix, the auto-prefill doesn't create entries for supplements that cloud says are inactive.

### Phase 4: Build, Test, Deploy

1. `npm start` — verify locally
2. Test scenarios:
   - Hide a supplement → verify it stays hidden after page reload
   - Simulate cloud data arriving with a previously hidden item still visible → verify it gets replaced, not union-merged
3. Update version in 4 places (package.json, Settings.jsx x2, QuickActionsMenu.jsx)
4. `npm run build && npm run deploy`

---

## Key Files

| File | Change | Lines |
|------|--------|-------|
| `src/hooks/useSyncEngine.js` | Replace union merge with cloud-authoritative for arrays | 42-48, 58-64, 78-84 |
| `src/sync/SyncEngine.js` | Extend dirty expiry from 30s to 5min | 30 |
| `src/App.jsx` | No changes (verify only) | 281-327 |

## What This Does NOT Change

- The version vector conflict resolution (SyncEngine._applySnapshot)
- The dirty flag blocking mechanism (pendingChanges/dirtyDomains)
- The echo detection (writeId matching)
- The auto-prefill logic
- How stackEntries/entries/dailyNotes merge (they use spread merge, which is correct)
