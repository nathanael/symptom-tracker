import { useState, useEffect, useRef, useCallback } from 'react';
import SyncEngine from '../sync/SyncEngine';

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
  const applyCloudData = useCallback((updates, isInitial) => {
    const cloudRef = cloudRefRef.current;
    if (cloudRef) {
      cloudRef.current = true;
    }

    const setters = settersRef.current;

    // Bail-out helpers: return prev when merge produces identical data,
    // avoiding new object references that cascade re-renders.
    // Uses JSON.stringify (native C++) for fast deep comparison.
    const jsonEqual = (a, b) => {
      if (a === b) return true;
      return JSON.stringify(a) === JSON.stringify(b);
    };

    const mergeMap = (prev, cloud) => {
      // Quick check: if cloud adds no new keys and all values match, bail out
      const cloudKeys = Object.keys(cloud);
      const prevKeys = Object.keys(prev);
      // If cloud is a subset of prev with same values, no change
      if (cloudKeys.every(k => k in prev) && prevKeys.length >= cloudKeys.length) {
        // Only deep-compare cloud keys (not all prev keys)
        if (cloudKeys.every(k => jsonEqual(prev[k], cloud[k]))) return prev;
      }
      const merged = { ...prev, ...cloud };
      return merged;
    };

    const mergeArrayById = (prev, cloud) => {
      if (!prev || !Array.isArray(prev)) return cloud;
      // Quick length + id check before expensive merge
      if (prev.length === cloud.length) {
        const prevById = new Map(prev.map(i => [i.id, i]));
        if (cloud.every(item => {
          const existing = prevById.get(item.id);
          return existing && jsonEqual(existing, item);
        })) return prev;
      }
      const cloudById = new Map(cloud.map(i => [i.id, i]));
      const localById = new Map(prev.map(i => [i.id, i]));
      const merged = new Map(cloudById);
      localById.forEach((item, id) => { if (!merged.has(id)) merged.set(id, item); });
      return [...merged.values()];
    };

    if (updates.symptoms && setters.symptoms) {
      setters.symptoms(prev => mergeArrayById(prev, updates.symptoms));
    }

    if (updates.entries && setters.entries) {
      setters.entries(prev => mergeMap(prev, updates.entries));
    }

    if (updates.dailyNotes && setters.dailyNotes) {
      setters.dailyNotes(prev => mergeMap(prev, updates.dailyNotes));
    }

    if (updates.stackItems && setters.stackItems) {
      setters.stackItems(prev => mergeArrayById(prev, updates.stackItems));
    }

    if (updates.stackEntries && setters.stackEntries) {
      setters.stackEntries(prev => mergeMap(prev, updates.stackEntries));
    }

    if (updates.trackingMode && setters.trackingMode) {
      setters.trackingMode(prev => prev === updates.trackingMode ? prev : updates.trackingMode);
    }

    if (updates.pinnedSymptoms && setters.pinnedSymptoms) {
      setters.pinnedSymptoms(prev => {
        const incoming = updates.pinnedSymptoms;
        if (prev instanceof Set && prev.size === incoming.length &&
            incoming.every(id => prev.has(id))) return prev;
        return new Set(incoming);
      });
    }

    if (updates.inputItems && setters.inputItems) {
      setters.inputItems(prev => mergeArrayById(prev, updates.inputItems));
    }

    if (updates.inputEntries && setters.inputEntries) {
      setters.inputEntries(prev => mergeMap(prev, updates.inputEntries));
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

    // Initialize and apply server data.
    // On init, server data is authoritative — only skip domains where the user
    // made changes THIS session (pendingChanges), not stale dirty flags.
    engine.initialize().then((serverData) => {
      if (serverData && !engine._destroyed) {
        const domains = engine._extractDomains(serverData, 'skipPending');
        console.log('[Sync] useSyncEngine: init resolved, applying domains:', Object.keys(domains), 'skippedPending:', [...engine.pendingChanges.keys()]);
        if (Object.keys(domains).length > 0) {
          applyCloudData(domains, true);
        }
        const ts = serverData.updatedAt?.toDate();
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

  return {
    notifyChange,
    forcePush,
    syncing: syncStatus.syncing,
    lastSynced: syncStatus.lastSynced,
    syncError: syncStatus.syncError,
    setSyncError,
    isReady: engineRef.current?.isReady() ?? false,
  };
}
