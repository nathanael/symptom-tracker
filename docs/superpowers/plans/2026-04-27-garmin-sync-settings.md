# Garmin Sync Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge the local garmy server (localhost:8484) to Firestore so sleep data syncs automatically, with login/status/sync UI in Settings.

**Architecture:** New `useGarminSync` hook mounted in App.jsx handles server detection, auth proxying, and data bridging (garmy → Firestore). Settings.jsx gets a GARMIN section. The garmy server gets CORS headers.

**Tech Stack:** React 18, Firestore (compat SDK via `getFirebaseDb()`), garmy Python server

**Spec:** `docs/superpowers/specs/2026-04-27-garmin-sync-settings-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/hooks/useGarminSync.js` | Create | Server detection, auth proxy, Firestore bridging, auto-sync interval |
| `src/components/Settings.jsx` | Modify | Add GARMIN section UI between Cloud Sync and Tracking Mode |
| `src/App.jsx` | Modify | Mount `useGarminSync`, pass state/methods to Settings |
| `/Users/monster/dev/garmy/garmin-sleep-upgrade/server.py` | Modify | Add CORS headers + OPTIONS handler |

---

### Task 1: Add CORS headers to garmy server

**Files:**
- Modify: `/Users/monster/dev/garmy/garmin-sleep-upgrade/server.py:60-85`

- [ ] **Step 1: Add CORS `end_headers` override and `do_OPTIONS` to the Handler class**

In `server.py`, add these two methods to the `Handler` class (after `__init__`, before `do_GET`):

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

- [ ] **Step 2: Verify the server still starts**

Run: `cd /Users/monster/dev/garmy && .venv/bin/python garmin-sleep-upgrade/server.py &`
Expected: "Garmin Sleep Love → http://localhost:8484" prints without errors. Kill the server after verifying.

- [ ] **Step 3: Commit**

```bash
cd /Users/monster/dev/garmy
git add garmin-sleep-upgrade/server.py
git commit -m "feat: add CORS headers for cross-origin React app access"
```

---

### Task 2: Create `useGarminSync` hook

**Files:**
- Create: `src/hooks/useGarminSync.js`

- [ ] **Step 1: Create the hook file**

```js
import { useState, useEffect, useCallback, useRef } from 'react';
import { getFirebaseDb } from '../utils/firebase';

const GARMY_BASE = 'http://localhost:8484';
const SYNC_INTERVAL = 10 * 60 * 1000; // 10 minutes
const SHORT_TIMEOUT = 2000; // 2s for server detection
const SYNC_TIMEOUT = 120000; // 120s for Garmin sync

function transformRecord(record) {
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

async function fetchWithTimeout(url, options = {}, timeout = SHORT_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export function useGarminSync(user) {
  const [serverAvailable, setServerAvailable] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(() => localStorage.getItem('garminLastSync'));
  const [error, setError] = useState(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const syncingRef = useRef(false);

  // Check server availability and auth status; returns { available, authenticated }
  const checkServer = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${GARMY_BASE}/api/auth/status`);
      if (!res.ok) { setServerAvailable(false); return { available: false, authenticated: false }; }
      const data = await res.json();
      setServerAvailable(true);
      setAuthenticated(data.authenticated);
      return { available: true, authenticated: data.authenticated };
    } catch {
      setServerAvailable(false);
      setAuthenticated(false);
      return { available: false, authenticated: false };
    }
  }, []);

  // Bridge data from garmy server to Firestore
  const bridgeToFirestore = useCallback(async (daysParam) => {
    if (!user?.uid) return;
    const db = getFirebaseDb();
    if (!db) return;

    // 1. Fetch from garmy server
    const url = daysParam ? `${GARMY_BASE}/api/sleep?days=${daysParam}` : `${GARMY_BASE}/api/sleep`;
    const res = await fetchWithTimeout(url, {}, 30000);
    if (!res.ok) throw new Error('Failed to fetch sleep data from garmy server');
    const records = await res.json();
    if (!records.length) return;

    // 2. Query Firestore for existing dates (projection — only reads 'date' field)
    const collection = db.collection('users').doc(user.uid).collection('garminSleep');
    const snap = await collection.select('date').get();
    const existingDates = new Set(snap.docs.map(d => d.data().date));

    // 3. Filter to new records only
    const newRecords = records
      .map(transformRecord)
      .filter(r => r.date && !existingDates.has(r.date));

    if (!newRecords.length) return;

    // 4. Batch write to Firestore (max 500 per batch)
    for (let i = 0; i < newRecords.length; i += 500) {
      const batch = db.batch();
      const chunk = newRecords.slice(i, i + 500);
      for (const record of chunk) {
        const docRef = collection.doc(record.date);
        batch.set(docRef, record);
      }
      await batch.commit();
    }
  }, [user]);

  // Full sync: trigger garmy pull, then bridge to Firestore
  const syncNow = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setError(null);
    try {
      // Try to trigger Garmin → SQLite sync first (ok if it fails)
      try {
        await fetchWithTimeout(
          `${GARMY_BASE}/api/sync`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 7 }) },
          SYNC_TIMEOUT
        );
      } catch {
        // Non-fatal — SQLite may still have data to bridge
      }

      // Bridge all data to Firestore
      await bridgeToFirestore(null);

      const now = new Date().toISOString();
      setLastSync(now);
      localStorage.setItem('garminLastSync', now);

      window.dispatchEvent(new Event('garmin-sleep-synced'));
    } catch (e) {
      console.warn('[useGarminSync] sync failed:', e);
      setError(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
      syncingRef.current = false;
    }
  }, [bridgeToFirestore]);

  // Auto-sync: only bridge recent data, skip Garmin pull
  const autoSync = useCallback(async () => {
    if (syncingRef.current || !serverAvailable || !authenticated || !user?.uid) return;
    syncingRef.current = true;
    setSyncing(true);
    setError(null);
    try {
      await bridgeToFirestore(14);
      const now = new Date().toISOString();
      setLastSync(now);
      localStorage.setItem('garminLastSync', now);
      window.dispatchEvent(new Event('garmin-sleep-synced'));
    } catch (e) {
      console.warn('[useGarminSync] auto-sync failed:', e);
      setError(e.message || 'Auto-sync failed');
    } finally {
      setSyncing(false);
      syncingRef.current = false;
    }
  }, [serverAvailable, authenticated, user, bridgeToFirestore]);

  // Auth methods
  const login = useCallback(async (email, password) => {
    setError(null);
    try {
      const res = await fetchWithTimeout(
        `${GARMY_BASE}/api/auth/login`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) },
        30000
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Login failed');
      if (data.mfa_required) {
        setMfaRequired(true);
      } else {
        setAuthenticated(true);
        setMfaRequired(false);
      }
    } catch (e) {
      setError(e.message || 'Login failed');
    }
  }, []);

  const submitMfa = useCallback(async (code) => {
    setError(null);
    try {
      const res = await fetchWithTimeout(
        `${GARMY_BASE}/api/auth/mfa`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) },
        30000
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'MFA failed');
      setAuthenticated(true);
      setMfaRequired(false);
    } catch (e) {
      setError(e.message || 'MFA verification failed');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetchWithTimeout(`${GARMY_BASE}/api/auth/logout`, { method: 'POST' }, 5000);
    } catch {
      // Best-effort
    }
    setAuthenticated(false);
    setMfaRequired(false);
    setLastSync(null);
    localStorage.removeItem('garminLastSync');
  }, []);

  // Check server on mount
  useEffect(() => { checkServer(); }, [checkServer]);

  // Auto-sync interval (check server + sync every 10 min)
  useEffect(() => {
    const id = setInterval(async () => {
      const status = await checkServer();
      if (status.available && status.authenticated && user?.uid) {
        autoSync();
      }
    }, SYNC_INTERVAL);
    return () => clearInterval(id);
  }, [checkServer, autoSync, user]);

  return {
    serverAvailable, authenticated, syncing, lastSync, error, mfaRequired,
    login, submitMfa, logout, syncNow, checkServer,
  };
}
```

- [ ] **Step 2: Verify the file has no syntax errors**

Run: `node -c src/hooks/useGarminSync.js`
Expected: no output (no syntax errors)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGarminSync.js
git commit -m "feat: add useGarminSync hook for garmy server bridge"
```

---

### Task 3: Mount `useGarminSync` in App.jsx and pass to Settings

**Files:**
- Modify: `src/App.jsx:52` (imports), `src/App.jsx:1284-1335` (Settings props)
- Modify: `src/components/Settings.jsx:6-47` (prop destructuring)

- [ ] **Step 1: Add import and hook call in App.jsx**

Add import near line 52 (after other hook imports):

```js
import { useGarminSync } from './hooks/useGarminSync';
```

Add the hook call inside the App component, after the existing hook calls (find a spot after the last `use*` hook call, before the date/state section):

```js
const garminSync = useGarminSync(firebase.user);
```

- [ ] **Step 2: Pass garminSync to Settings**

In App.jsx where `<Settings` is rendered (~line 1284), add the prop:

```js
garminSync={garminSync}
```

Add it after the `onForcePush` prop, before the closing `/>`.

- [ ] **Step 3: Add event listener to `useGarminSleep` so it refetches after sync**

In `src/hooks/useGarminSleep.js`, add a `useEffect` after the existing `useEffect(() => { refetch(); }, [refetch]);` (line 65):

```js
  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener('garmin-sleep-synced', handler);
    return () => window.removeEventListener('garmin-sleep-synced', handler);
  }, [refetch]);
```

This ensures SleepAnalyzer and ComparisonStudio (which each call `useGarminSleep` independently) will automatically refetch from Firestore whenever `useGarminSync` completes a sync.

- [ ] **Step 4: Accept the prop in Settings.jsx**

In `src/components/Settings.jsx` line 46, add `garminSync` to the destructured props (before `onForcePush`):

```js
garminSync,
```

- [ ] **Step 5: Verify build**

Run: `npx vite build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/Settings.jsx src/hooks/useGarminSleep.js
git commit -m "feat: mount useGarminSync in App, pass to Settings, add sync event listener"
```

---

### Task 4: Add GARMIN section to Settings UI

**Files:**
- Modify: `src/components/Settings.jsx:578-582` (insert between Cloud Sync and Tracking Mode)

- [ ] **Step 1: Add local state for the Garmin login form**

Inside the Settings component (near line 48, with the other `useState` calls), add:

```js
const [garminEmail, setGarminEmail] = useState('');
const [garminPassword, setGarminPassword] = useState('');
const [garminMfaCode, setGarminMfaCode] = useState('');
```

- [ ] **Step 2: Add the GARMIN section JSX**

Insert the following between the Cloud Sync `</div>` closing tag (line 578) and the `{/* Tracking Mode Selection */}` comment (line 580):

```jsx
        {/* Garmin Section */}
        <div style={{ marginBottom: '8px', marginTop: '24px', paddingLeft: '16px', color: '#64748b', fontSize: '12px', fontWeight: '600', letterSpacing: '0.5px' }}>
          GARMIN
        </div>
        <div style={{
          background: 'rgba(15, 17, 21, 0.5)',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '12px',
        }}>
          {!garminSync.serverAvailable ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#6b7280' }} />
                <span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: '600' }}>Garmin server not detected</span>
              </div>
              <div style={{ color: '#6b7280', fontSize: '12px' }}>
                Start the garmy server on this machine to sync sleep data.
              </div>
            </>
          ) : !garminSync.authenticated && !garminSync.mfaRequired ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#eab308' }} />
                <span style={{ color: '#d1d5db', fontSize: '14px', fontWeight: '600' }}>Server detected</span>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                await garminSync.login(garminEmail, garminPassword);
                setGarminPassword('');
              }}>
                <input
                  type="email"
                  placeholder="Garmin email"
                  value={garminEmail}
                  onChange={e => setGarminEmail(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', marginBottom: '8px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
                  }}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={garminPassword}
                  onChange={e => setGarminPassword(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', marginBottom: '12px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
                  }}
                />
                <button type="submit" style={{
                  width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                  background: 'rgba(99, 102, 241, 0.3)', color: '#a5b4fc', fontSize: '14px',
                  fontWeight: '600', cursor: 'pointer',
                }}>
                  Log In
                </button>
              </form>
            </>
          ) : garminSync.mfaRequired ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#eab308' }} />
                <span style={{ color: '#d1d5db', fontSize: '14px', fontWeight: '600' }}>MFA code required</span>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                await garminSync.submitMfa(garminMfaCode);
                setGarminMfaCode('');
              }}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Enter MFA code"
                  value={garminMfaCode}
                  onChange={e => setGarminMfaCode(e.target.value)}
                  autoFocus
                  style={{
                    width: '100%', padding: '10px 12px', marginBottom: '12px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px', color: '#e5e7eb', fontSize: '14px', outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" style={{
                    flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                    background: 'rgba(99, 102, 241, 0.3)', color: '#a5b4fc', fontSize: '14px',
                    fontWeight: '600', cursor: 'pointer',
                  }}>
                    Submit
                  </button>
                  <button type="button" onClick={() => { garminSync.logout(); setGarminMfaCode(''); }} style={{
                    flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent', color: '#9ca3af', fontSize: '14px', cursor: 'pointer',
                  }}>
                    Cancel
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e' }} />
                <span style={{ color: '#d1d5db', fontSize: '14px', fontWeight: '600' }}>Connected</span>
              </div>
              {garminSync.lastSync && (
                <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '12px' }}>
                  Last synced: {(() => {
                    const diff = Math.round((Date.now() - new Date(garminSync.lastSync).getTime()) / 60000);
                    if (diff < 1) return 'just now';
                    if (diff < 60) return `${diff} min ago`;
                    return `${Math.round(diff / 60)}h ago`;
                  })()}
                </div>
              )}
              {garminSync.syncing ? (
                <div style={{ color: '#9ca3af', fontSize: '13px', padding: '10px 0' }}>Syncing...</div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => garminSync.syncNow()} style={{
                    flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                    background: 'rgba(99, 102, 241, 0.3)', color: '#a5b4fc', fontSize: '14px',
                    fontWeight: '600', cursor: 'pointer',
                  }}>
                    Sync Now
                  </button>
                  <button onClick={() => garminSync.logout()} style={{
                    padding: '10px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                    background: 'transparent', color: '#9ca3af', fontSize: '14px', cursor: 'pointer',
                  }}>
                    Disconnect
                  </button>
                </div>
              )}
            </>
          )}
          {garminSync.error && (
            <div style={{
              marginTop: '8px', color: '#f87171', fontSize: '12px',
              background: 'rgba(248, 113, 113, 0.1)', padding: '8px', borderRadius: '6px',
            }}>
              {garminSync.error}
            </div>
          )}
        </div>
```

- [ ] **Step 3: Verify build**

Run: `npx vite build 2>&1 | tail -5`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/Settings.jsx
git commit -m "feat: add Garmin connection section to Settings UI"
```

---

### Task 5: End-to-end verification

- [ ] **Step 1: Start the garmy server**

Run: `cd /Users/monster/dev/garmy && .venv/bin/python garmin-sleep-upgrade/server.py &`

- [ ] **Step 2: Start the dev server**

Run: `cd /Users/monster/dev/symptom-tracker && npm run dev`

- [ ] **Step 3: Verify Settings shows "Server detected" or "Connected"**

Open the app, navigate to Settings, scroll to the GARMIN section. If the garmy server is running and already authenticated, it should show the green "Connected" state with a "Sync Now" button.

- [ ] **Step 4: Test manual sync**

Click "Sync Now". Verify no errors appear. Check browser console for sync log output. Verify Firestore receives new documents (check via the SleepAnalyzer view).

- [ ] **Step 5: Kill the garmy server and verify graceful fallback**

Stop the garmy server. Refresh the app. The GARMIN section should show "Garmin server not detected" with no errors.

- [ ] **Step 6: Run tests to check nothing is broken**

Run: `npx vitest run 2>&1 | tail -10`
Expected: all existing tests pass

- [ ] **Step 7: Commit any fixes if needed**
