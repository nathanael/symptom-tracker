import { useState, useEffect, useRef } from 'react';

export function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const timeoutRef = useRef(null);

  useEffect(() => {
    // Debounce localStorage writes to avoid blocking UI
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const write = () => {
      try {
        localStorage.setItem(key, JSON.stringify(storedValue));
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    };

    // Use longer debounce and requestIdleCallback for non-blocking writes on iOS
    timeoutRef.current = setTimeout(() => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(write, { timeout: 1000 });
      } else {
        write();
      }
    }, 500);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}

export function useLocalStorageSet(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? new Set(JSON.parse(item)) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const timeoutRef = useRef(null);

  useEffect(() => {
    // Debounce localStorage writes to avoid blocking UI
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const write = () => {
      try {
        localStorage.setItem(key, JSON.stringify([...storedValue]));
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    };

    // Use longer debounce and requestIdleCallback for non-blocking writes on iOS
    timeoutRef.current = setTimeout(() => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(write, { timeout: 1000 });
      } else {
        write();
      }
    }, 500);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}
