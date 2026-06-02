import { useState, useEffect, useRef, useCallback } from 'react';
import SyncEngineV2 from '../sync/SyncEngineV2';
import { mergeMapByTime, mergeIdArrayByTime } from '../sync/merge';
import { readLocalDomains } from '../sync/migrationV2';
import { saveSnapshot, listSnapshots, restoreSnapshot, bootSnapshotIfStale } from '../utils/snapshots';

// Map domains arrive from the engine as flat `{ key: value+_t }` maps and live
// in React as objects; merge them per-key by `_t`.
const MAP_DOMAINS = ['entries', 'dailyNotes', 'stackEntries', 'inputEntries'];
// Definition id-array domains arrive as APP-shape arrays and live in React as
// arrays; merge them by id+`_t`.
const ID_ARRAY_DOMAINS = ['symptoms', 'stackItems', 'inputItems'];

/**
 * React hook that bridges SyncEngineV2 to component state.
 *
 * @param {string|null} uid - Firebase user ID
 * @param {boolean} firebaseReady - Whether Firebase has initialized
 * @param {Object} stateSetters - Map of domain name to React setState function
 * @param {Object} isApplyingCloudRef - Shared ref to prevent feedback loops
 * @returns {{ notifyChange, forcePush, forcePull, saveSnapshot, listSnapshots,
 *   restoreSnapshot, syncing, lastSynced, syncError, setSyncError, isReady }}
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

  // Apply cloud data to React state, driven by SyncEngineV2's emit contract:
  //   onCloudUpdate(domains, isInitial, opts)
  // where opts may carry { deletes: { domain: [keys] } } (remote deletes) or
  // { replace: true } (destructive forcePull — replace state, don't merge).
  //
  // Sets isApplyingCloudRef=true around ALL state setters (merges, deletes,
  // replaces) so the useLocalStorage→notifyChange feedback loop is suppressed:
  // a cloud-apply must never echo back as a local write. The ref is reset by a
  // useEffect in App.jsx declared AFTER all useLocalStorage hooks — React
  // guarantees declaration-order effect execution within a component, so the
  // reset runs after all useLocalStorage effects have checked the flag.
  const applyCloudData = useCallback((domains, isInitial, opts) => {
    const cloudRef = cloudRefRef.current;
    if (cloudRef) {
      cloudRef.current = true;
    }

    const setters = settersRef.current;
    const replace = !!(opts && opts.replace);
    const deletes = (opts && opts.deletes) || null;

    if (domains && typeof domains === 'object') {
      // --- Map domains: merge per-key by _t (or replace wholesale). ---
      for (const domain of MAP_DOMAINS) {
        if (!(domain in domains) || !setters[domain]) continue;
        const incoming = domains[domain];
        setters[domain](prev => replace ? incoming : mergeMapByTime(prev, incoming));
      }

      // --- Definition id-array domains: merge by id+_t (or replace). ---
      for (const domain of ID_ARRAY_DOMAINS) {
        if (!(domain in domains) || !setters[domain]) continue;
        const incoming = domains[domain];
        setters[domain](prev => replace ? incoming : mergeIdArrayByTime(prev, incoming));
      }

      // --- pinnedSymptoms: cloud-authoritative small id array → Set. ---
      if ('pinnedSymptoms' in domains && setters.pinnedSymptoms) {
        const incoming = domains.pinnedSymptoms || [];
        setters.pinnedSymptoms(prev => {
          if (prev instanceof Set && prev.size === incoming.length &&
              incoming.every(id => prev.has(id))) return prev;
          return new Set(incoming);
        });
      }

      // --- trackingMode: scalar, cloud-authoritative. ---
      if ('trackingMode' in domains && setters.trackingMode) {
        const incoming = domains.trackingMode;
        setters.trackingMode(prev => prev === incoming ? prev : incoming);
      }
    }

    // --- REMOTE deletes: remove dropped keys/ids from React state. ---
    // Applied in the SAME cloudRef flag window as the merges above so they
    // don't echo back as local writes. Skipped entirely on a replace (the
    // wholesale set already reflects the cloud's deletions).
    if (deletes && !replace) {
      for (const domain of MAP_DOMAINS) {
        const keys = deletes[domain];
        if (!keys || keys.length === 0 || !setters[domain]) continue;
        setters[domain](prev => {
          if (!prev || typeof prev !== 'object') return prev;
          const next = { ...prev };
          let changed = false;
          for (const k of keys) {
            if (k in next) { delete next[k]; changed = true; }
          }
          return changed ? next : prev;
        });
      }
      for (const domain of ID_ARRAY_DOMAINS) {
        const ids = deletes[domain];
        if (!ids || ids.length === 0 || !setters[domain]) continue;
        const idSet = new Set(ids);
        setters[domain](prev => {
          if (!Array.isArray(prev)) return prev;
          const next = prev.filter(it => !(it && idSet.has(it.id)));
          return next.length === prev.length ? prev : next;
        });
      }
    }

    // Surface a last-synced time on every applied cloud update.
    setSyncStatus(prev => ({ ...prev, lastSynced: new Date() }));

    // No timer-based reset here. isApplyingCloudRef is reset by a useEffect in
    // App.jsx that runs after all useLocalStorage effects (React declaration-
    // order guarantee).
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
    const engine = new SyncEngineV2(uid, applyCloudData);

    engine.onStatusChange = (status) => {
      setSyncStatus(prev => ({
        syncing: status.syncing,
        lastSynced: status.lastSynced || prev.lastSynced,
        syncError: status.syncError,
      }));
    };

    engineRef.current = engine;

    // Initialize. The engine emits via onCloudUpdate(domains, true) during
    // initialize() when the cloud has data, so applyCloudData fires
    // automatically — do NOT double-apply from the return value.
    engine.initialize().then(() => {
      if (!engine._destroyed && engine.syncError) {
        setSyncStatus(prev => ({ ...prev, syncError: engine.syncError }));
      }
      // Reconcile-on-load: heal silent drift between this device and the cloud.
      // Reads the REAL cloud and pushes up any local record a dropped upload
      // left local-only (the shadow wrongly believes it synced), and pulls down
      // anything a dead listener missed. Additive only — never deletes. This is
      // what stops "newest items missing on the other device" from persisting
      // until a manual backup/import. Fire-and-forget; reconcile never throws.
      if (!engine._destroyed) {
        engine.reconcile(readLocalDomains());
      }
    });

    // Flush pending changes when app goes to background or closes; catch up on
    // cloud changes missed while backgrounded when it returns to foreground.
    // The Safari PWA streaming listener can die silently while hidden, so a
    // refresh on visible is the user-facing complement to the engine heartbeat.
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        engine.flushNow();
      } else if (document.visibilityState === 'visible') {
        engine.refreshFromCloud();
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
