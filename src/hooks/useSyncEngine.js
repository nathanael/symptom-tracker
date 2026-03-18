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

  // Counter to track how many apply batches are in flight
  const applyCountRef = useRef(0);

  // Apply cloud data to React state with union merge strategy
  const applyCloudData = useCallback((updates, isInitial) => {
    const cloudRef = cloudRefRef.current;
    if (cloudRef) {
      applyCountRef.current++;
      cloudRef.current = true;
    }

    const setters = settersRef.current;

    if (updates.symptoms?.length > 0 && setters.symptoms) {
      setters.symptoms(prev => {
        const localMap = new Map(prev.map(s => [s.id, s]));
        updates.symptoms.forEach(s => localMap.set(s.id, s));
        return Array.from(localMap.values());
      });
    }

    if (updates.entries && setters.entries) {
      setters.entries(prev => ({ ...prev, ...updates.entries }));
    }

    if (updates.dailyNotes && setters.dailyNotes) {
      setters.dailyNotes(prev => ({ ...prev, ...updates.dailyNotes }));
    }

    if (updates.stackItems?.length > 0 && setters.stackItems) {
      setters.stackItems(prev => {
        const localMap = new Map(prev.map(s => [s.id, s]));
        updates.stackItems.forEach(s => localMap.set(s.id, s));
        return Array.from(localMap.values());
      });
    }

    if (updates.stackEntries && setters.stackEntries) {
      setters.stackEntries(prev => ({ ...prev, ...updates.stackEntries }));
    }

    if (updates.trackingMode && setters.trackingMode) {
      setters.trackingMode(() => updates.trackingMode);
    }

    if (updates.pinnedSymptoms && setters.pinnedSymptoms) {
      setters.pinnedSymptoms(() => new Set(updates.pinnedSymptoms));
    }

    if (updates.inputItems?.length > 0 && setters.inputItems) {
      setters.inputItems(prev => {
        const localMap = new Map(prev.map(s => [s.id, s]));
        updates.inputItems.forEach(s => localMap.set(s.id, s));
        return Array.from(localMap.values());
      });
    }

    if (updates.inputEntries && setters.inputEntries) {
      setters.inputEntries(prev => ({ ...prev, ...updates.inputEntries }));
    }

    // Reset flag after React has committed the batch AND run all useEffect
    // callbacks triggered by the state changes above.  The old setTimeout(0)
    // raced with React 18's effect scheduling (effects fire via MessageChannel,
    // which can interleave with setTimeout(0)), causing useLocalStorage effects
    // to see isApplyingCloudRef=false and erroneously notify the sync engine of
    // "local" changes — marking domains dirty and blocking future server pulls.
    //
    // Two-frame delay: requestAnimationFrame fires after paint, then setTimeout
    // fires in the next macrotask — well after React's useEffect commit phase.
    if (cloudRef) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          applyCountRef.current--;
          if (applyCountRef.current <= 0) {
            applyCountRef.current = 0;
            cloudRef.current = false;
          }
        }, 0);
      });
    }
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
        if (Object.keys(domains).length > 0) {
          applyCloudData(domains, true);
        }
        const ts = serverData.updatedAt?.toDate();
        if (ts) {
          setSyncStatus(prev => ({ ...prev, lastSynced: ts }));
        }
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

  return {
    notifyChange,
    syncing: syncStatus.syncing,
    lastSynced: syncStatus.lastSynced,
    syncError: syncStatus.syncError,
    setSyncError,
    isReady: engineRef.current?.isReady() ?? false,
  };
}
