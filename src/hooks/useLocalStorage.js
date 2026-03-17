import { useState, useEffect, useRef } from 'react';

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

  useEffect(() => {
    // Skip the initial render (value came from localStorage already)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
    // Notify sync engine of local change (skip if this was a cloud-apply)
    if (onChangeRef.current && !cloudRefRef.current?.current) {
      onChangeRef.current(storedValue);
    }
  }, [key, storedValue]);

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

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify([...storedValue]));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
    // Notify sync engine of local change (skip if this was a cloud-apply)
    if (onChangeRef.current && !cloudRefRef.current?.current) {
      onChangeRef.current([...storedValue]);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}
