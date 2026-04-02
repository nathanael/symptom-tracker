import { useState, useEffect, useRef } from 'react';

const LS_DEBOUNCE_MS = 100;

export function useLocalStorage(key, initialValue, onChange, isApplyingCloudRef) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const isFirstRender = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Store ref in a ref so effect closure doesn't need it as dependency
  const cloudRefRef = useRef(isApplyingCloudRef);
  cloudRefRef.current = isApplyingCloudRef;
  const flushTimerRef = useRef(null);
  const pendingWriteRef = useRef(null);

  useEffect(() => {
    // Skip the initial render (value came from localStorage already)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Notify sync engine immediately (skip if this was a cloud-apply).
    // Sync engine has its own 500ms debounce for Firestore writes.
    if (onChangeRef.current && !cloudRefRef.current?.current) {
      onChangeRef.current(storedValue);
    }

    // Debounce the expensive localStorage write (JSON.stringify + setItem)
    // to avoid blocking the main thread during rapid state changes.
    pendingWriteRef.current = { key, value: storedValue };
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      pendingWriteRef.current = null;
      try {
        localStorage.setItem(key, JSON.stringify(storedValue));
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    }, LS_DEBOUNCE_MS);
  }, [key, storedValue]);

  // Flush any pending write on unmount to prevent data loss
  useEffect(() => {
    return () => {
      clearTimeout(flushTimerRef.current);
      if (pendingWriteRef.current) {
        try {
          const { key: k, value } = pendingWriteRef.current;
          localStorage.setItem(k, JSON.stringify(value));
        } catch (_) { /* ignore */ }
      }
    };
  }, []);

  return [storedValue, setStoredValue];
}

export function useLocalStorageSet(key, initialValue, onChange, isApplyingCloudRef) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? new Set(JSON.parse(item)) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const isFirstRender = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const cloudRefRef = useRef(isApplyingCloudRef);
  cloudRefRef.current = isApplyingCloudRef;
  const flushTimerRef = useRef(null);
  const pendingWriteRef = useRef(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Notify sync engine immediately (skip if this was a cloud-apply)
    if (onChangeRef.current && !cloudRefRef.current?.current) {
      onChangeRef.current([...storedValue]);
    }

    // Debounce localStorage write
    pendingWriteRef.current = { key, value: [...storedValue] };
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      pendingWriteRef.current = null;
      try {
        localStorage.setItem(key, JSON.stringify([...storedValue]));
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    }, LS_DEBOUNCE_MS);
  }, [key, storedValue]);

  // Flush any pending write on unmount
  useEffect(() => {
    return () => {
      clearTimeout(flushTimerRef.current);
      if (pendingWriteRef.current) {
        try {
          const { key: k, value } = pendingWriteRef.current;
          localStorage.setItem(k, JSON.stringify(value));
        } catch (_) { /* ignore */ }
      }
    };
  }, []);

  return [storedValue, setStoredValue];
}
