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
    syncedAt: new Date(),
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

    // 2. Query Firestore for existing dates
    const collection = db.collection('users').doc(user.uid).collection('garminSleep');
    const snap = await collection.get();
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

      // Clear garmin sleep cache so useGarminSleep does a full refetch
      localStorage.removeItem('garminSleepCache');

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
      localStorage.removeItem('garminSleepCache');
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
