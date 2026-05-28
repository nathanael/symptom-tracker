import { useState, useEffect, useRef, useCallback } from 'react';
import SyncEngine from '../sync/SyncEngine';
import { saveSnapshot, listSnapshots, restoreSnapshot, bootSnapshotIfStale, currentItemCount } from '../utils/snapshots';

/**
 * React hook that bridges SyncEngine to component state.
 *
 * @param {string|null} uid - Firebase user ID
 * @param {boolean} firebaseReady - Whether Firebase has initialized
 * @param {Object} stateSetters - Map of domain name to React setState function
 * @param {Object} isApplyingCloudRef - Shared ref to prevent feedback loops
 * @returns {{ notifyChange, syncing, lastSynced, syncError, setSyncError, isReady }}
 */
export function useSyncEngine(uid, firebaseReady, stateSetters, isApplyingCloudRef) {
  const engineRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState({
    syncing: false,
    lastSynced: null,
    syncError: null,
  });

  // Keep stateSetters in a ref to avoid re-creating engine on every render
  const settersRef = useRef(stateSetters);
  settersRef.current = stateSetters;

  // Keep isApplyingCloudRef in a ref to avoid dependency in useCallback
  const cloudRefRef = useRef(isApplyingCloudRef);
  cloudRefRef.current = isApplyingCloudRef;

  // Apply cloud data to React state with union merge strategy.
  // Sets isApplyingCloudRef=true so useLocalStorage effects skip onChange.
  // The ref is reset by a useEffect in App.jsx declared AFTER all useLocalStorage
  // hooks — React guarantees declaration-order effect execution within a component,
  // so the reset runs after all useLocalStorage effects have checked the flag.
  const applyCloudData = useCallback((updates, isInitial, forceReplace = false) => {
    // Belt-and-braces: if the incoming cloud data would meaningfully reduce
    // total local item count, snapshot first. Cheap, covers any path
    // (init, listener, polling, forcePull) that calls applyCloudData.
    try {
      const localTotal = currentItemCount();
      let cloudTotal = 0;
      for (const [domain, data] of Object.entries(updates)) {
        if (Array.isArray(data)) cloudTotal += data.length;
        else if (data && typeof data === 'object') cloudTotal += Object.keys(data).length;
      }
      if (cloudTotal > 0 && localTotal > 0 && cloudTotal < localTotal * 0.95) {
        saveSnapshot(forceReplace ? 'preCloudReplace' : 'preCloudShrink');
        // Hard guard: a merge (non-destructive) path must never reduce total
        // local items by more than 50%. If we'd shrink that much, abort —
        // a merge that drops half the data is almost certainly a bug or a
        // garbage cloud doc.
        if (!forceReplace && cloudTotal < localTotal * 0.5) {
          console.warn('[Sync] aborting merge that would shrink local by >50%',
            { localTotal, cloudTotal });
          return;
        }
      }
    } catch (e) {
      console.warn('[Sync] safety snapshot failed:', e);
    }

    const cloudRef = cloudRefRef.current;
    if (cloudRef) {
      cloudRef.current = true;
    }

    const setters = settersRef.current;

    // Per-key timestamp merge. Each entry/item has an optional _t (write time
    // in ms since epoch). For each key/id present in either side, keep the
    // version with the higher _t. Entries without _t are treated as _t=0
    // (legacy data — any new write supersedes them). This replaces the older
    // per-domain dirty/pending gating, which silently dropped cloud updates
    // when version vectors matched even though the data had diverged.

    const jsonEqual = (a, b) => {
      if (a === b) return true;
      return JSON.stringify(a) === JSON.stringify(b);
    };

    const tOf = (v) => (v && typeof v === 'object' && typeof v._t === 'number') ? v._t : 0;

    const mergeMapByTime = (prev, cloud) => {
      if (!prev || typeof prev !== 'object') return cloud;
      if (!cloud || typeof cloud !== 'object') return prev;
      if (jsonEqual(prev, cloud)) return prev;
      const merged = {};
      const keys = new Set([...Object.keys(prev), ...Object.keys(cloud)]);
      for (const k of keys) {
        const p = prev[k];
        const c = cloud[k];
        if (p === undefined) merged[k] = c;
        else if (c === undefined) merged[k] = p;
        else merged[k] = tOf(p) > tOf(c) ? p : c;
      }
      return jsonEqual(prev, merged) ? prev : merged;
    };

    const mergeArrayByTime = (prev, cloud) => {
      if (!Array.isArray(prev)) return cloud;
      if (!Array.isArray(cloud)) return prev;
      if (jsonEqual(prev, cloud)) return prev;
      const byId = new Map();
      for (const item of cloud) {
        if (item && item.id != null) byId.set(item.id, item);
      }
      for (const item of prev) {
        if (!item || item.id == null) continue;
        const existing = byId.get(item.id);
        if (!existing) byId.set(item.id, item);
        else if (tOf(item) > tOf(existing)) byId.set(item.id, item);
      }
      const merged = [...byId.values()];
      return jsonEqual(prev, merged) ? prev : merged;
    };

    if (updates.symptoms && setters.symptoms) {
      setters.symptoms(prev => forceReplace ? updates.symptoms : mergeArrayByTime(prev, updates.symptoms));
    }

    if (updates.entries && setters.entries) {
      setters.entries(prev => forceReplace ? updates.entries : mergeMapByTime(prev, updates.entries));
    }

    if (updates.dailyNotes && setters.dailyNotes) {
      setters.dailyNotes(prev => forceReplace ? updates.dailyNotes : mergeMapByTime(prev, updates.dailyNotes));
    }

    if (updates.stackItems && setters.stackItems) {
      setters.stackItems(prev => forceReplace ? updates.stackItems : mergeArrayByTime(prev, updates.stackItems));
    }

    if (updates.stackEntries && setters.stackEntries) {
      setters.stackEntries(prev => forceReplace ? updates.stackEntries : mergeMapByTime(prev, updates.stackEntries));
    }

    if (updates.trackingMode && setters.trackingMode) {
      setters.trackingMode(prev => prev === updates.trackingMode ? prev : updates.trackingMode);
    }

    if (updates.pinnedSymptoms && setters.pinnedSymptoms) {
      // pinnedSymptoms is a small id array — cloud-authoritative is fine.
      setters.pinnedSymptoms(prev => {
        const incoming = updates.pinnedSymptoms;
        if (prev instanceof Set && prev.size === incoming.length &&
            incoming.every(id => prev.has(id))) return prev;
        return new Set(incoming);
      });
    }

    if (updates.inputItems && setters.inputItems) {
      setters.inputItems(prev => forceReplace ? updates.inputItems : mergeArrayByTime(prev, updates.inputItems));
    }

    if (updates.inputEntries && setters.inputEntries) {
      setters.inputEntries(prev => forceReplace ? updates.inputEntries : mergeMapByTime(prev, updates.inputEntries));
    }

    // No timer-based reset here. The ref is reset by a useEffect in App.jsx
    // that runs after all useLocalStorage effects (React declaration-order guarantee).
  }, []);

  // Create/destroy engine when uid changes
  useEffect(() => {
    if (!uid || !firebaseReady) {
      // No user — destroy any existing engine
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
      return;
    }

    // Always take a boot snapshot before the engine touches anything. Cheap,
    // and gives the user a recovery point from before any sync activity.
    bootSnapshotIfStale();

    // Create new engine
    const engine = new SyncEngine(uid, applyCloudData);

    engine.onStatusChange = (status) => {
      setSyncStatus(prev => ({
        syncing: status.syncing,
        lastSynced: status.lastSynced || prev.lastSynced,
        syncError: status.syncError,
      }));
    };

    engineRef.current = engine;

    // Initialize and apply server data. The timestamp-based merge in
    // applyCloudData handles any in-flight pending edits correctly, so we
    // always apply every domain the cloud has.
    engine.initialize().then((serverData) => {
      if (serverData && !engine._destroyed) {
        const domains = engine._extractDomains(serverData, 'all');
        console.log('[Sync] useSyncEngine: init resolved, applying domains:', Object.keys(domains));
        if (Object.keys(domains).length > 0) {
          applyCloudData(domains, true);
        }
        const ts = (typeof serverData.updatedAt?.toDate === 'function') ? serverData.updatedAt.toDate() : null;
        if (ts) {
          setSyncStatus(prev => ({ ...prev, lastSynced: ts }));
        }
      } else {
        console.log('[Sync] useSyncEngine: init resolved with', serverData ? 'data (but destroyed)' : 'null');
      }
      // Start polling fallback if streaming listener isn't delivering server data
      if (!engine._destroyed) {
        engine._startPollingIfNeeded();
      }
    });

    // Flush pending changes when app goes to background or closes
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        engine.flushNow();
      }
    };
    const handleUnload = () => engine.flushNow();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
      engine.flushNow();
      engine.destroy();
      if (engineRef.current === engine) {
        engineRef.current = null;
      }
    };
  }, [uid, firebaseReady, applyCloudData]);

  // Notify engine of a local change (always queue, even before ready)
  const notifyChange = useCallback((domain, data) => {
    if (engineRef.current) {
      engineRef.current.notifyLocalChange(domain, data);
    }
  }, []);

  const setSyncError = useCallback((error) => {
    setSyncStatus(prev => ({ ...prev, syncError: error }));
    if (engineRef.current) {
      engineRef.current.syncError = error;
    }
  }, []);

  const forcePush = useCallback((allData) => {
    if (engineRef.current) {
      return engineRef.current.forcePush(allData);
    }
    return Promise.resolve();
  }, []);

  const forcePull = useCallback((opts) => {
    if (engineRef.current) {
      return engineRef.current.forcePull(opts);
    }
    return Promise.resolve(null);
  }, []);

  return {
    notifyChange,
    forcePush,
    forcePull,
    saveSnapshot,
    listSnapshots,
    restoreSnapshot,
    syncing: syncStatus.syncing,
    lastSynced: syncStatus.lastSynced,
    syncError: syncStatus.syncError,
    setSyncError,
    isReady: engineRef.current?.isReady() ?? false,
  };
}
