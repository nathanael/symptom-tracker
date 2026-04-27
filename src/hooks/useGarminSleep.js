import { useCallback, useEffect, useRef, useState } from 'react';
import { getFirebaseDb } from '../utils/firebase';
import { applyFirestoreSnapshot } from '../utils/garminSleepCache';

const CACHE_KEY = 'garminSleepCache';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { days: [], lastPushedAt: null };
    const parsed = JSON.parse(raw);
    return { days: parsed.days || [], lastPushedAt: parsed.lastPushedAt || null };
  } catch {
    return { days: [], lastPushedAt: null };
  }
}

function writeCache(days, lastPushedAt) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ days, lastPushedAt }));
  } catch {
    // localStorage quota or disabled — non-fatal
  }
}

export function useGarminSleep(user) {
  const initial = readCache();
  const [days, setDays] = useState(initial.days);
  const [lastPushedAt, setLastPushedAt] = useState(initial.lastPushedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const daysRef = useRef(days);
  const lastPushedAtRef = useRef(lastPushedAt);

  // Keep refs in sync with state
  daysRef.current = days;
  lastPushedAtRef.current = lastPushedAt;

  const refetch = useCallback(async () => {
    if (!user || !user.uid) return;
    const db = getFirebaseDb();
    if (!db) return;
    setLoading(true);
    setError(null);
    try {
      const base = db.collection('users').doc(user.uid).collection('garminSleep');
      const curLastPushedAt = lastPushedAtRef.current;
      const curDays = daysRef.current;
      let snap;
      if (curLastPushedAt) {
        snap = await base
          .where('syncedAt', '>', new Date(curLastPushedAt))
          .orderBy('syncedAt')
          .get();
      } else {
        snap = await base.get();
      }
      const docs = snap.docs.map(d => d.data());
      const { merged, newestTs } = applyFirestoreSnapshot(curDays, curLastPushedAt, docs);
      setDays(merged);
      setLastPushedAt(newestTs);
      writeCache(merged, newestTs);
    } catch (e) {
      console.warn('[useGarminSleep] fetch failed:', e);
      setError(e);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.uid]);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    const handler = () => {
      // Reset state so refetch does a full query instead of incremental
      setDays([]);
      setLastPushedAt(null);
      daysRef.current = [];
      lastPushedAtRef.current = null;
      refetch();
    };
    window.addEventListener('garmin-sleep-synced', handler);
    return () => window.removeEventListener('garmin-sleep-synced', handler);
  }, [refetch]);

  return { days, loading, error, refetch };
}
