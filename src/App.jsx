import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useLocalStorage, useLocalStorageSet } from './hooks/useLocalStorage';
import { useFirebase } from './hooks/useFirebase';
import {
  STORAGE_KEY_SYMPTOMS,
  STORAGE_KEY_ENTRIES,
  STORAGE_KEY_NOTES,
  STORAGE_KEY_MODE,
  STORAGE_KEY_STACK_ITEMS,
  STORAGE_KEY_STACK_ENTRIES,
  STORAGE_KEY_PINNED,
  STORAGE_KEY_COPY_DAYS,
  STORAGE_KEY_TREND_WINDOW,
  STORAGE_KEY_LOCAL_UPDATED_AT,
  STORAGE_KEY_INPUT_ITEMS,
  STORAGE_KEY_INPUT_ENTRIES,
  severityColors,
  NA_SEVERITY,
  trackingModes,
  defaultSymptoms,
  defaultStackItems,
  HOLD_DELAY,
  DRAG_SENSITIVITY,
  SWIPE_THRESHOLD,
  SWIPE_TIME_LIMIT,
} from './utils/constants';
import {
  getDateKey,
  formatDate,
  getCurrentTimePeriod,
  isMobile,
  isStandalone,
  haptic,
  isScheduledForDate,
  generateAIDataExport,
  generateSampleData,
  generateSampleStackData,
  getInsights,
  exportCSV,
} from './utils/helpers';

// Components
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import SymptomList from './components/SymptomList';
import Stack from './components/Stack';
import Inputs from './components/Inputs';
import Calendar from './components/Calendar';
import Insights from './components/Insights';
import Settings from './components/Settings';
import Export from './components/Export';
import RapidEntry from './components/RapidEntry';
import NoteModal from './components/NoteModal';
import DayNightToggle from './components/DayNightToggle';
import SymptomGraph from './components/SymptomGraph';

function App() {
  // App mode: 'symptoms' or 'stack'
  const [appMode, setAppMode] = useState('symptoms');
  // Protocol sub-view: 'stack' or 'inputs'
  const [protocolView, setProtocolView] = useState('stack');
  const scrollContainerRef = useRef(null);

  // Core data state
  const [symptoms, setSymptoms] = useLocalStorage(STORAGE_KEY_SYMPTOMS, []);
  const [entries, setEntries] = useLocalStorage(STORAGE_KEY_ENTRIES, {});
  const [dailyNotes, setDailyNotes] = useLocalStorage(STORAGE_KEY_NOTES, {});
  const [trackingMode, setTrackingMode] = useLocalStorage(STORAGE_KEY_MODE, 'ampm');
  const [stackItems, setStackItems] = useLocalStorage(STORAGE_KEY_STACK_ITEMS, []);
  const [stackEntries, setStackEntries] = useLocalStorage(STORAGE_KEY_STACK_ENTRIES, {});
  const [pinnedSymptoms, setPinnedSymptoms] = useLocalStorageSet(STORAGE_KEY_PINNED, new Set());
  const [inputItems, setInputItems] = useLocalStorage(STORAGE_KEY_INPUT_ITEMS, []);
  const [inputEntries, setInputEntries] = useLocalStorage(STORAGE_KEY_INPUT_ENTRIES, {});
  const [copyDays, setCopyDays] = useLocalStorage(STORAGE_KEY_COPY_DAYS, 7);
  const [trendWindow, setTrendWindow] = useLocalStorage(STORAGE_KEY_TREND_WINDOW, 7);

  // Date state
  const [selectedDate, setSelectedDate] = useState(new Date());
  const lastCurrentDateRef = useRef(null);

  // View state
  const [showCalendar, setShowCalendar] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showSymptomGraph, setShowSymptomGraph] = useState(null);

  // UI state
  const [lastAction, setLastAction] = useState('');
  const [copyToastMessage, setCopyToastMessage] = useState('');
  const [symptomSearch, setSymptomSearch] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [quickLogSymptom, setQuickLogSymptom] = useState(null);
  const [quickLogTime, setQuickLogTime] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [insightsWindow, setInsightsWindow] = useState(60);

  // Rapid entry state
  const [rapidEntryMode, setRapidEntryMode] = useState(false);
  const [rapidEntryConfirm, setRapidEntryConfirm] = useState(false);
  const [rapidEntryIndex, setRapidEntryIndex] = useState(0);

  // Flash column indicator
  const [flashColumn, setFlashColumn] = useState(null);

  // Manage symptoms/stack/inputs screens
  const [showAddSymptom, setShowAddSymptom] = useState(false);
  const [showManageStack, setShowManageStack] = useState(false);
  const [showManageInputs, setShowManageInputs] = useState(false);

  // Firebase
  const firebase = useFirebase();

  // Refs
  const justLoggedRef = useRef(false);

  // Reset scroll when switching views
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [appMode, protocolView]);

  // Derived values
  const timePeriods = trackingModes[trackingMode].periods;

  const activeSymptoms = useMemo(() => {
    let active = symptoms.filter(s => s.active);
    if (symptomSearch.trim()) {
      const search = symptomSearch.toLowerCase();
      active = active.filter(s => s.name.toLowerCase().includes(search));
    }
    return active.sort((a, b) => {
      const aPinned = pinnedSymptoms.has(a.id);
      const bPinned = pinnedSymptoms.has(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return (a.order || 0) - (b.order || 0);
    });
  }, [symptoms, symptomSearch, pinnedSymptoms]);

  const totalActiveSymptoms = useMemo(() =>
    symptoms.filter(s => s.active).length,
    [symptoms]
  );

  const incompleteSymptoms = useMemo(() => {
    const dateKey = selectedDate.toISOString().split('T')[0];
    const timePeriod = quickLogTime || (new Date().getHours() < 12 ? 'morning' : 'evening');

    const allActive = symptoms.filter(s => s.active).sort((a, b) => {
      const aPinned = pinnedSymptoms.has(a.id);
      const bPinned = pinnedSymptoms.has(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return (a.order || 0) - (b.order || 0);
    });

    return allActive.filter(symptom => {
      if (trackingMode === 'ampm') {
        // Auto-N/A: symptom doesn't apply to this period
        if (symptom.applicablePeriods && !symptom.applicablePeriods.includes(timePeriod)) return false;
        const hasTimePeriodEntry = entries[`${dateKey}-${symptom.id}-${timePeriod}`];
        if (hasTimePeriodEntry) return false;
        if (timePeriod === 'morning' && entries[`${dateKey}-${symptom.id}-daily`]) {
          return false;
        }
        return true;
      } else {
        const hasDailyEntry = entries[`${dateKey}-${symptom.id}-daily`];
        if (hasDailyEntry) return false;
        const hasMorningEntry = entries[`${dateKey}-${symptom.id}-morning`];
        const hasEveningEntry = entries[`${dateKey}-${symptom.id}-evening`];
        if (hasMorningEntry || hasEveningEntry) return false;
        return true;
      }
    });
  }, [symptoms, entries, selectedDate, quickLogTime, trackingMode, pinnedSymptoms]);

  // Check for date changes (midnight) - uses local time
  const currentDateKey = getDateKey(new Date());
  if (lastCurrentDateRef.current !== null && lastCurrentDateRef.current !== currentDateKey) {
    const selectedDateKey = getDateKey(selectedDate);
    if (selectedDateKey === lastCurrentDateRef.current) {
      lastCurrentDateRef.current = currentDateKey;
      setTimeout(() => setSelectedDate(new Date()), 0);
    } else {
      lastCurrentDateRef.current = currentDateKey;
    }
  } else if (lastCurrentDateRef.current === null) {
    lastCurrentDateRef.current = currentDateKey;
  }

  // Auto-clear lastAction
  useEffect(() => {
    if (lastAction) {
      const timer = setTimeout(() => setLastAction(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastAction]);

  // Auto-sync to cloud
  const syncTimeoutRef = useRef(null);
  const lastSyncDataRef = useRef('');
  // Start true to prevent initial localStorage load from updating timestamp
  const isLoadingDataRef = useRef(true);
  // Counter to force auto-sync re-check after initial cloud merge completes
  const [syncTrigger, setSyncTrigger] = useState(0);

  // Re-lock loading flag when user signs in, BEFORE effects run
  // This prevents auto-sync from pushing empty local data to cloud
  // before loadFromCloud() has a chance to complete
  const prevUserRef = useRef(firebase.user);
  if (firebase.user && !prevUserRef.current) {
    isLoadingDataRef.current = true;
  }
  prevUserRef.current = firebase.user;

  useEffect(() => {
    if (!firebase.user || firebase.syncing || isLoadingDataRef.current) return;

    const currentData = JSON.stringify({
      symptoms, entries, dailyNotes, stackItems, stackEntries, pinnedSymptoms: [...pinnedSymptoms], trackingMode, inputItems, inputEntries
    });

    if (currentData === lastSyncDataRef.current) return;

    // Set ref eagerly so the cloud listener skips the echo of our own write
    lastSyncDataRef.current = currentData;
    firebase.saveToCloud({
      symptoms,
      entries,
      dailyNotes,
      stackItems,
      stackEntries,
      pinnedSymptoms: [...pinnedSymptoms],
      trackingMode,
      inputItems,
      inputEntries,
    });
  }, [firebase.user, firebase.syncing, symptoms, entries, dailyNotes, stackItems, stackEntries, pinnedSymptoms, trackingMode, inputItems, inputEntries, syncTrigger]);

  // Track local update timestamp for sync conflict resolution
  // Only update when user makes changes, not during initial load or cloud sync
  useEffect(() => {
    if (isLoadingDataRef.current) return;
    localStorage.setItem(STORAGE_KEY_LOCAL_UPDATED_AT, Date.now().toString());
  }, [symptoms, entries, dailyNotes, stackItems, stackEntries, pinnedSymptoms, trackingMode, inputItems, inputEntries]);

  // Listen to cloud changes in real-time
  const isInitialCloudLoad = useRef(true);
  useEffect(() => {
    if (firebase.user && firebase.firebaseReady) {
      isInitialCloudLoad.current = true;
      const unsubscribe = firebase.listenToCloud((data) => {
        const isInitial = isInitialCloudLoad.current;
        isInitialCloudLoad.current = false;

        // Update lastSyncDataRef so auto-sync doesn't immediately push back
        const incomingData = JSON.stringify({
          symptoms: data.symptoms, entries: data.entries, dailyNotes: data.dailyNotes,
          stackItems: data.stackItems, stackEntries: data.stackEntries,
          pinnedSymptoms: data.pinnedSymptoms || [], trackingMode: data.trackingMode,
          inputItems: data.inputItems, inputEntries: data.inputEntries
        });

        if (!isInitial && incomingData === lastSyncDataRef.current) return;

        // On initial load, compare timestamps to decide merge strategy.
        // On subsequent updates, accept cloud data.
        if (isInitial) {
          const localUpdatedAt = parseInt(localStorage.getItem(STORAGE_KEY_LOCAL_UPDATED_AT) || '0');
          const cloudUpdatedAt = data.updatedAt?.toDate?.()?.getTime() || 0;
          const localIsNewer = localUpdatedAt > cloudUpdatedAt;

          if (localIsNewer) {
            // Local data is more recent (e.g., offline changes) — merge with local priority
            if (data.symptoms?.length > 0) {
              setSymptoms(prev => {
                const cloudMap = new Map(data.symptoms.map(s => [s.id, s]));
                prev.forEach(s => cloudMap.set(s.id, s));
                return Array.from(cloudMap.values());
              });
            }
            if (data.entries) {
              setEntries(prev => {
                const merged = { ...data.entries };
                Object.keys(prev).forEach(key => { merged[key] = prev[key]; });
                return merged;
              });
            }
            if (data.dailyNotes) {
              setDailyNotes(prev => {
                const merged = { ...data.dailyNotes };
                Object.keys(prev).forEach(key => { merged[key] = prev[key]; });
                return merged;
              });
            }
            if (data.stackItems?.length > 0) {
              setStackItems(prev => {
                const cloudMap = new Map(data.stackItems.map(s => [s.id, s]));
                prev.forEach(s => {
                  const cloud = cloudMap.get(s.id);
                  // If cloud explicitly disabled this item, respect that
                  if (cloud && !cloud.active) {
                    cloudMap.set(s.id, { ...s, active: false });
                  } else {
                    cloudMap.set(s.id, s);
                  }
                });
                return Array.from(cloudMap.values());
              });
            }
            if (data.stackEntries) {
              setStackEntries(prev => {
                const merged = { ...data.stackEntries };
                Object.keys(prev).forEach(key => { merged[key] = prev[key]; });
                return merged;
              });
            }
            if (data.trackingMode) setTrackingMode(data.trackingMode);
            if (data.pinnedSymptoms) setPinnedSymptoms(new Set(data.pinnedSymptoms));
            if (data.inputItems?.length > 0) {
              setInputItems(prev => {
                const cloudMap = new Map(data.inputItems.map(s => [s.id, s]));
                prev.forEach(s => {
                  const cloud = cloudMap.get(s.id);
                  if (cloud && !cloud.active) {
                    cloudMap.set(s.id, { ...s, active: false });
                  } else {
                    cloudMap.set(s.id, s);
                  }
                });
                return Array.from(cloudMap.values());
              });
            }
            if (data.inputEntries) {
              setInputEntries(prev => {
                const merged = { ...data.inputEntries };
                Object.keys(prev).forEach(key => { merged[key] = prev[key]; });
                return merged;
              });
            }
          } else {
            // Cloud data is more recent — accept cloud data to prevent stale
            // local data from overwriting newer cloud data. For entries, do a
            // union merge (cloud priority) as a safety net to preserve any
            // local entries that might not be in cloud.
            if (data.symptoms?.length > 0) setSymptoms(data.symptoms);
            if (data.entries) {
              setEntries(prev => ({ ...prev, ...data.entries }));
            }
            if (data.dailyNotes) {
              setDailyNotes(prev => ({ ...prev, ...data.dailyNotes }));
            }
            if (data.stackItems?.length > 0) {
              setStackItems(prev => {
                const localMap = new Map(prev.map(s => [s.id, s]));
                data.stackItems.forEach(s => localMap.set(s.id, s));
                return Array.from(localMap.values());
              });
            }
            if (data.stackEntries) {
              setStackEntries(prev => ({ ...prev, ...data.stackEntries }));
            }
            if (data.trackingMode) setTrackingMode(data.trackingMode);
            if (data.pinnedSymptoms) setPinnedSymptoms(new Set(data.pinnedSymptoms));
            if (data.inputItems?.length > 0) {
              setInputItems(prev => {
                const localMap = new Map(prev.map(s => [s.id, s]));
                data.inputItems.forEach(s => localMap.set(s.id, s));
                return Array.from(localMap.values());
              });
            }
            if (data.inputEntries) {
              setInputEntries(prev => ({ ...prev, ...data.inputEntries }));
            }
          }
        } else {
          // Real-time update from another device — merge to preserve local items
          if (data.symptoms?.length > 0) setSymptoms(data.symptoms);
          if (data.entries) setEntries(prev => ({ ...prev, ...data.entries }));
          if (data.dailyNotes) setDailyNotes(prev => ({ ...prev, ...data.dailyNotes }));
          if (data.stackItems?.length > 0) {
            setStackItems(prev => {
              const localMap = new Map(prev.map(s => [s.id, s]));
              data.stackItems.forEach(s => localMap.set(s.id, s));
              return Array.from(localMap.values());
            });
          }
          if (data.stackEntries) setStackEntries(prev => ({ ...prev, ...data.stackEntries }));
          if (data.trackingMode) setTrackingMode(data.trackingMode);
          if (data.pinnedSymptoms) setPinnedSymptoms(new Set(data.pinnedSymptoms));
          if (data.inputItems?.length > 0) {
            setInputItems(prev => {
              const localMap = new Map(prev.map(s => [s.id, s]));
              data.inputItems.forEach(s => localMap.set(s.id, s));
              return Array.from(localMap.values());
            });
          }
          if (data.inputEntries) setInputEntries(prev => ({ ...prev, ...data.inputEntries }));
        }

        lastSyncDataRef.current = incomingData;
        // Enable timestamp updates after cloud sync completes
        if (isLoadingDataRef.current) {
          setTimeout(() => {
            isLoadingDataRef.current = false;
            // Force auto-sync to re-check — the ref change alone won't trigger a re-render,
            // so local-only data from the merge would never get pushed to cloud
            setSyncTrigger(prev => prev + 1);
          }, 100);
        }
      });

      // If listener setup fails or takes too long, still unlock
      const fallback = setTimeout(() => {
        if (isLoadingDataRef.current) {
          isLoadingDataRef.current = false;
          setSyncTrigger(prev => prev + 1);
        }
      }, 5000);

      return () => {
        if (unsubscribe) unsubscribe();
        clearTimeout(fallback);
      };
    } else if (!firebase.user && !firebase.authLoading) {
      // No user logged in, enable timestamp updates
      setTimeout(() => { isLoadingDataRef.current = false; }, 100);
    }
  }, [firebase.user, firebase.firebaseReady, firebase.authLoading]);

  // Fallback: ensure timestamp updates are enabled after 10s even if Firebase never loads
  useEffect(() => {
    const fallbackTimer = setTimeout(() => {
      if (isLoadingDataRef.current) {
        isLoadingDataRef.current = false;
      }
    }, 10000);
    return () => clearTimeout(fallbackTimer);
  }, []);

  // Auto-prefill today's stack from yesterday's checked entries
  const lastPrefillDateRef = useRef(localStorage.getItem('lastStackPrefillDate'));
  useEffect(() => {
    if (isLoadingDataRef.current) return;
    const todayKey = getDateKey(new Date());
    if (lastPrefillDateRef.current === todayKey) return;

    // Check if any stack entries already exist for today
    const hasTodayEntries = Object.keys(stackEntries).some(key => key.startsWith(todayKey));
    if (hasTodayEntries) {
      lastPrefillDateRef.current = todayKey;
      localStorage.setItem('lastStackPrefillDate', todayKey);
      return;
    }

    // Copy yesterday's entries
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getDateKey(yesterday);
    const yesterdayEntries = Object.entries(stackEntries).filter(([key]) => key.startsWith(yesterdayKey));
    if (yesterdayEntries.length === 0) {
      lastPrefillDateRef.current = todayKey;
      localStorage.setItem('lastStackPrefillDate', todayKey);
      return;
    }

    const newEntries = { ...stackEntries };
    yesterdayEntries.forEach(([key, entry]) => {
      const itemId = key.substring(yesterdayKey.length + 1);
      const item = stackItems.find(i => i.id === itemId);
      if (item && item.active && isScheduledForDate(item.schedule, new Date())) {
        newEntries[`${todayKey}-${itemId}`] = {
          date: todayKey,
          itemId,
          dose: entry.dose,
          taken: true,
        };
      }
    });

    setStackEntries(newEntries);
    lastPrefillDateRef.current = todayKey;
    localStorage.setItem('lastStackPrefillDate', todayKey);
  }, [stackEntries, stackItems]);

  // Handlers
  const changeDate = useCallback((days) => {
    setSelectedDate(prevDate => {
      const newDate = new Date(prevDate);
      newDate.setDate(newDate.getDate() + days);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (newDate > today) return prevDate;
      return newDate;
    });
    setLastAction('');
  }, []);

  const selectDate = useCallback((date) => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (date > today) return;
    setSelectedDate(date);
    setShowCalendar(false);
    setLastAction('');
  }, []);

  const quickLog = useCallback((symptomId, severity, timeOverride = null) => {
    const dateKey = getDateKey(selectedDate);
    const timeId = timeOverride || timePeriods[0].id;
    const key = `${dateKey}-${symptomId}-${timeId}`;

    justLoggedRef.current = true;

    setEntries(prev => ({
      ...prev,
      [key]: { time: timeId, severity, date: dateKey, symptomId }
    }));

    const symptom = symptoms.find(s => s.id === symptomId);
    const period = timePeriods.find(p => p.id === timeId);
    haptic('light');
    setQuickLogSymptom(null);
    const severityLabel = severity === NA_SEVERITY ? 'N/A' : severity;
    setLastAction(`${symptom?.name}: ${severityLabel} (${period?.label || timeId})`);
  }, [selectedDate, timePeriods, symptoms]);

  const quickCopyData = useCallback(() => {
    const insights = getInsights(copyDays, entries, symptoms);
    const data = generateAIDataExport(copyDays, entries, symptoms, stackItems, stackEntries, dailyNotes, trackingMode, insights, inputItems, inputEntries);
    navigator.clipboard.writeText(data);
    setCopyToastMessage(`Copied ${copyDays} day${copyDays > 1 ? 's' : ''} of tracking for AI chat`);
    haptic('light');
    setTimeout(() => setCopyToastMessage(''), 2250);
  }, [copyDays, entries, symptoms, stackItems, stackEntries, dailyNotes, trackingMode, inputItems, inputEntries]);

  const canGoForward = useMemo(() => {
    const tomorrow = new Date(selectedDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return tomorrow <= today;
  }, [selectedDate]);

  // Tab badge data
  const tabBadges = useMemo(() => {
    const dateKey = getDateKey(selectedDate);
    const todaySymptomEntries = Object.values(entries).filter(e => e.date === dateKey);
    const todayStackEntries = Object.values(stackEntries).filter(e => e.date === dateKey);
    const activeStackCount = stackItems.filter(i => i.active).length;
    const activeSymptomCount = symptoms.filter(s => s.active).length;

    const symptomStatus = todaySymptomEntries.length === 0 ? 'none'
      : todaySymptomEntries.length >= activeSymptomCount ? 'all' : 'some';
    const stackStatus = todayStackEntries.length === 0 ? 'none'
      : todayStackEntries.length >= activeStackCount ? 'all' : 'some';

    return {
      symptoms: { count: todaySymptomEntries.length, total: activeSymptomCount, status: symptomStatus },
      stack: { taken: todayStackEntries.length, total: activeStackCount, status: stackStatus },
    };
  }, [entries, stackEntries, stackItems, symptoms, selectedDate]);

  // Get symptom entries for a given symptom
  const getSymptomEntries = useCallback((symptomId) => {
    const dateKey = getDateKey(selectedDate);
    const timeOrder = { night: 0, morning: 1, allday: 2, midday: 3, evening: 4, daily: 2 };

    const allDayEntries = Object.entries(entries)
      .filter(([key]) => key.startsWith(`${dateKey}-${symptomId}`))
      .map(([key, value]) => value);

    if (trackingMode === 'simple') {
      const dailyEntry = allDayEntries.find(e => e.time === 'daily');
      if (dailyEntry) return [dailyEntry];

      const morningEntry = allDayEntries.find(e => e.time === 'morning');
      const eveningEntry = allDayEntries.find(e => e.time === 'evening');

      if (morningEntry || eveningEntry) {
        const severities = [];
        if (morningEntry && morningEntry.severity !== NA_SEVERITY) severities.push(morningEntry.severity);
        if (eveningEntry && eveningEntry.severity !== NA_SEVERITY) severities.push(eveningEntry.severity);
        if (severities.length === 0) {
          // Both are N/A, show N/A
          return [{
            time: 'daily',
            severity: NA_SEVERITY,
            date: dateKey,
            symptomId,
            _synthetic: true,
            _fromAmPm: true,
          }];
        }
        const avgSeverity = Math.round(severities.reduce((a, b) => a + b, 0) / severities.length);
        return [{
          time: 'daily',
          severity: avgSeverity,
          date: dateKey,
          symptomId,
          _synthetic: true,
          _fromAmPm: true,
        }];
      }
      return [];
    }

    if (trackingMode === 'ampm') {
      const morningEntry = allDayEntries.find(e => e.time === 'morning');
      const eveningEntry = allDayEntries.find(e => e.time === 'evening');
      const dailyEntry = allDayEntries.find(e => e.time === 'daily');

      if (dailyEntry && !morningEntry && !eveningEntry) {
        return [{
          ...dailyEntry,
          time: 'morning',
          _synthetic: true,
          _fromDaily: true,
        }];
      }

      return allDayEntries
        .filter(e => e.time === 'morning' || e.time === 'evening')
        .sort((a, b) => (timeOrder[a.time] || 0) - (timeOrder[b.time] || 0));
    }

    return allDayEntries.sort((a, b) => (timeOrder[a.time] || 0) - (timeOrder[b.time] || 0));
  }, [entries, selectedDate, trackingMode]);

  // Get most recent entry for a symptom
  const getMostRecentEntry = useCallback((symptomId, currentTimePeriod = null) => {
    const selectedDateKey = getDateKey(selectedDate);
    const timeOrder = { morning: 0, daily: 1, evening: 2 };
    const currentTimeOrder = timeOrder[currentTimePeriod] ?? 999;

    const allEntries = Object.entries(entries)
      .filter(([key]) => key.includes(`-${symptomId}-`))
      .map(([key, value]) => ({ key, ...value }))
      .filter(entry => {
        if (entry.date < selectedDateKey) return true;
        if (entry.date === selectedDateKey) {
          const entryTimeOrder = timeOrder[entry.time] ?? 0;
          return entryTimeOrder < currentTimeOrder;
        }
        return false;
      })
      .sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        return (timeOrder[b.time] || 0) - (timeOrder[a.time] || 0);
      });

    return allEntries.length > 0 ? allEntries[0] : null;
  }, [entries, selectedDate]);

  // Main render
  return (
    <div
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#08090A',
        minHeight: '100%',
        color: '#f8fafc',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
    {/* Desktop max-width wrapper */}
    <div
      style={{
        maxWidth: '500px',
        width: '100%',
        margin: '0 auto',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#08090A',
        boxShadow: window.innerWidth > 500 ? '0 0 40px rgba(0,0,0,0.5)' : 'none',
      }}
    >
      {/* Rapid Entry Mode */}
      {rapidEntryMode && (
        <RapidEntry
          symptoms={activeSymptoms}
          entries={entries}
          selectedDate={selectedDate}
          trackingMode={trackingMode}
          quickLogTime={quickLogTime}
          setQuickLogTime={setQuickLogTime}
          rapidEntryIndex={rapidEntryIndex}
          setRapidEntryIndex={setRapidEntryIndex}
          rapidEntryConfirm={rapidEntryConfirm}
          setRapidEntryConfirm={setRapidEntryConfirm}
          setRapidEntryMode={setRapidEntryMode}
          quickLog={quickLog}
          setEntries={setEntries}
          getMostRecentEntry={getMostRecentEntry}
          setCopyToastMessage={setCopyToastMessage}
        />
      )}

      {/* Header - hide when in edit modes */}
      {!showAddSymptom && !showManageStack && !showManageInputs && (
        <Header
          selectedDate={selectedDate}
          changeDate={changeDate}
          canGoForward={canGoForward}
          setShowCalendar={setShowCalendar}
          setCalendarMonth={setCalendarMonth}
        />
      )}

      {/* Scrollable Content Area */}
      <div ref={scrollContainerRef} style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        paddingBottom: '155px',
        WebkitOverflowScrolling: 'touch',
      }}>
        <div style={{
          width: '100%',
        }}>
          {appMode === 'symptoms' ? (
            <SymptomList
              symptoms={symptoms}
              setSymptoms={setSymptoms}
              activeSymptoms={activeSymptoms}
              entries={entries}
              setEntries={setEntries}
              selectedDate={selectedDate}
              trackingMode={trackingMode}
              timePeriods={timePeriods}
              pinnedSymptoms={pinnedSymptoms}
              setPinnedSymptoms={setPinnedSymptoms}
              quickLogSymptom={quickLogSymptom}
              setQuickLogSymptom={setQuickLogSymptom}
              quickLogTime={quickLogTime}
              setQuickLogTime={setQuickLogTime}
              quickLog={quickLog}
              setLastAction={setLastAction}
              symptomSearch={symptomSearch}
              setSymptomSearch={setSymptomSearch}
              searchVisible={searchVisible}
              setSearchVisible={setSearchVisible}
              showAddSymptom={showAddSymptom}
              setShowAddSymptom={setShowAddSymptom}
              getSymptomEntries={getSymptomEntries}
              getMostRecentEntry={getMostRecentEntry}
              getCurrentTimePeriod={() => getCurrentTimePeriod(trackingMode)}
              trendWindow={trendWindow}
              flashColumn={flashColumn}
              onOpenGraph={setShowSymptomGraph}
            />
          ) : (
            <>
              {protocolView === 'stack' ? (
                <Stack
                  stackItems={stackItems}
                  setStackItems={setStackItems}
                  stackEntries={stackEntries}
                  setStackEntries={setStackEntries}
                  selectedDate={selectedDate}
                  setLastAction={setLastAction}
                  showManageStack={showManageStack}
                  setShowManageStack={setShowManageStack}
                />
              ) : (
                <Inputs
                  inputItems={inputItems}
                  setInputItems={setInputItems}
                  inputEntries={inputEntries}
                  setInputEntries={setInputEntries}
                  selectedDate={selectedDate}
                  setLastAction={setLastAction}
                  showManageInputs={showManageInputs}
                  setShowManageInputs={setShowManageInputs}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Note Modal */}
      {showNoteModal && (
        <NoteModal
          selectedDate={selectedDate}
          dailyNotes={dailyNotes}
          setDailyNotes={setDailyNotes}
          onClose={() => setShowNoteModal(false)}
        />
      )}

      {/* Floating AM/PM + Rapid Entry Pill - only on symptoms page in AM/PM mode */}
      {appMode === 'symptoms' && trackingMode === 'ampm' && !showAddSymptom && !showManageStack && !showManageInputs && !showInsights && !showSettings && !showSymptomGraph && !rapidEntryMode && (
        <div style={{
          position: 'fixed',
          bottom: 'calc(105px + env(safe-area-inset-bottom))',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          zIndex: 200,
        }}>
          {/* Rapid Entry Button */}
          <button
            onClick={() => {
              const effectiveTime = quickLogTime || getCurrentTimePeriod(trackingMode);
              if (!quickLogTime) {
                setQuickLogTime(effectiveTime);
              }
              const dateKey = getDateKey(selectedDate);
              const timeKey = trackingMode === 'ampm' ? effectiveTime : 'daily';
              const allActive = symptoms.filter(s => s.active).sort((a, b) => {
                const aPinned = pinnedSymptoms.has(a.id);
                const bPinned = pinnedSymptoms.has(b.id);
                if (aPinned && !bPinned) return -1;
                if (!aPinned && bPinned) return 1;
                return (a.order || 0) - (b.order || 0);
              });
              const firstIncomplete = allActive.findIndex(s => !entries[`${dateKey}-${s.id}-${timeKey}`]);
              setRapidEntryIndex(firstIncomplete >= 0 ? firstIncomplete : 0);
              if (incompleteSymptoms.length === 0 && totalActiveSymptoms > 0) {
                setRapidEntryConfirm(true);
                setRapidEntryMode(true);
              } else {
                setRapidEntryMode(true);
              }
            }}
            style={{
              width: '44px',
              height: '44px',
              background: 'rgba(15, 17, 21, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '50%',
              color: '#fbbf24',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </button>
          {/* Day/Night Toggle */}
          <DayNightToggle
            isNight={(quickLogTime || getCurrentTimePeriod(trackingMode)) === 'evening'}
            onToggle={() => {
              const current = quickLogTime || getCurrentTimePeriod(trackingMode);
              const next = current === 'morning' ? 'evening' : 'morning';
              setQuickLogTime(next);
              setFlashColumn(next);
              setTimeout(() => setFlashColumn(null), 400);
              setCopyToastMessage(next === 'morning' ? '..AM..' : '..PM..');
              setTimeout(() => setCopyToastMessage(''), 2000);
            }}
          />
          {/* Note Button */}
          <button
            onClick={() => setShowNoteModal(true)}
            style={{
              width: '44px',
              height: '44px',
              background: 'rgba(15, 17, 21, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '50%',
              color: '#9ca3af',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>
        </div>
      )}

      {/* Toast Notification */}
      {copyToastMessage && (
        <div style={{
          position: 'fixed',
          top: 'calc(20px + env(safe-area-inset-top))',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(99, 102, 241, 0.95)',
          color: '#fff',
          padding: '12px 20px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '500',
          zIndex: 2000,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          textAlign: 'center',
        }}>
          {copyToastMessage}
        </div>
      )}

      {/* Calendar Modal */}
      {showCalendar && (
        <Calendar
          selectedDate={selectedDate}
          selectDate={selectDate}
          calendarMonth={calendarMonth}
          setCalendarMonth={setCalendarMonth}
          entries={entries}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {/* Insights */}
      {showInsights && (
        <Insights
          entries={entries}
          symptoms={symptoms}
          insightsWindow={insightsWindow}
          setInsightsWindow={setInsightsWindow}
          onOpenGraph={setShowSymptomGraph}
        />
      )}

      {/* Symptom Graph */}
      {showSymptomGraph && (
        <SymptomGraph
          primarySymptomId={showSymptomGraph}
          symptoms={symptoms}
          activeSymptoms={activeSymptoms}
          entries={entries}
          trackingMode={trackingMode}
          onClose={() => setShowSymptomGraph(null)}
          onChangeSymptom={setShowSymptomGraph}
        />
      )}

      {/* Settings */}
      {showSettings && (
        <Settings
          user={firebase.user}
          syncing={firebase.syncing}
          lastSynced={firebase.lastSynced}
          syncError={firebase.syncError}
          setSyncError={firebase.setSyncError}
          firebaseError={firebase.firebaseError}
          signInWithGoogle={firebase.signInWithGoogle}
          signInWithEmail={firebase.signInWithEmail}
          forgotPassword={firebase.forgotPassword}
          signOut={firebase.signOut}
          trackingMode={trackingMode}
          setTrackingMode={setTrackingMode}
          symptoms={symptoms}
          setSymptoms={setSymptoms}
          entries={entries}
          setEntries={setEntries}
          dailyNotes={dailyNotes}
          setDailyNotes={setDailyNotes}
          stackItems={stackItems}
          setStackItems={setStackItems}
          stackEntries={stackEntries}
          setStackEntries={setStackEntries}
          pinnedSymptoms={pinnedSymptoms}
          setPinnedSymptoms={setPinnedSymptoms}
          inputItems={inputItems}
          setInputItems={setInputItems}
          inputEntries={inputEntries}
          setInputEntries={setInputEntries}
          copyDays={copyDays}
          setCopyDays={setCopyDays}
          trendWindow={trendWindow}
          setTrendWindow={setTrendWindow}
          setLastAction={setLastAction}
          setCopyToastMessage={setCopyToastMessage}
          setShowExport={setShowExport}
          setShowSettings={setShowSettings}
        />
      )}

      {/* Export */}
      {showExport && (
        <Export
          entries={entries}
          symptoms={symptoms}
          dailyNotes={dailyNotes}
          stackItems={stackItems}
          stackEntries={stackEntries}
          trackingMode={trackingMode}
          inputItems={inputItems}
          inputEntries={inputEntries}
          setCopyToastMessage={setCopyToastMessage}
          onClose={() => setShowExport(false)}
        />
      )}

      {/* Bottom Navigation - hide when in edit modes */}
      {!showAddSymptom && !showManageStack && !showManageInputs && (
        <BottomNav
          appMode={appMode}
          setAppMode={setAppMode}
          protocolView={protocolView}
          setProtocolView={setProtocolView}
          showInsights={showInsights}
          setShowInsights={setShowInsights}
          showSettings={showSettings}
          setShowSettings={setShowSettings}
          showExport={showExport}
          setShowExport={setShowExport}
          showQuickActions={showQuickActions}
          setShowQuickActions={setShowQuickActions}
          // Symptoms page actions
          onCopyData={quickCopyData}
          copyDays={copyDays}
          onRapidEntry={() => {
            const effectiveTime = quickLogTime || getCurrentTimePeriod(trackingMode);
            if (trackingMode === 'ampm' && !quickLogTime) {
              setQuickLogTime(effectiveTime);
            }
            // Compute first incomplete symptom index
            const dateKey = getDateKey(selectedDate);
            const timeKey = trackingMode === 'ampm' ? effectiveTime : 'daily';
            const allActive = symptoms.filter(s => s.active).sort((a, b) => {
              const aPinned = pinnedSymptoms.has(a.id);
              const bPinned = pinnedSymptoms.has(b.id);
              if (aPinned && !bPinned) return -1;
              if (!aPinned && bPinned) return 1;
              return (a.order || 0) - (b.order || 0);
            });
            const firstIncomplete = allActive.findIndex(s => !entries[`${dateKey}-${s.id}-${timeKey}`]);
            setRapidEntryIndex(firstIncomplete >= 0 ? firstIncomplete : 0);
            if (incompleteSymptoms.length === 0 && totalActiveSymptoms > 0) {
              setRapidEntryConfirm(true);
              setRapidEntryMode(true);
            } else {
              setRapidEntryMode(true);
            }
          }}
          onEditNote={() => setShowNoteModal(true)}
          onEditSymptoms={() => setShowAddSymptom(true)}
          // Stack page actions
          onCheckAll={() => {
            const dateKey = getDateKey(selectedDate);
            const activeItems = stackItems.filter(i =>
              i.active && isScheduledForDate(i.schedule, selectedDate)
            );
            const newEntries = { ...stackEntries };
            activeItems.forEach(item => {
              const entryKey = `${dateKey}-${item.id}`;
              newEntries[entryKey] = {
                date: dateKey,
                itemId: item.id,
                dose: item.defaultDose,
                taken: true
              };
            });
            setStackEntries(newEntries);
            haptic('success');
            setLastAction('All selected');
          }}
          onClear={() => {
            const dateKey = getDateKey(selectedDate);
            const newEntries = { ...stackEntries };
            Object.keys(newEntries).forEach(key => {
              if (key.startsWith(dateKey)) {
                delete newEntries[key];
              }
            });
            setStackEntries(newEntries);
            setLastAction('All cleared');
          }}
          onMatchYesterday={() => {
            const dateKey = getDateKey(selectedDate);
            const yesterday = new Date(selectedDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayKey = getDateKey(yesterday);

            const yesterdayEntries = Object.entries(stackEntries).filter(([key]) => key.startsWith(yesterdayKey));
            if (yesterdayEntries.length === 0) {
              setLastAction('No entries from yesterday');
              return;
            }

            const newEntries = { ...stackEntries };
            let copiedCount = 0;
            yesterdayEntries.forEach(([key, entry]) => {
              const itemId = key.substring(yesterdayKey.length + 1);
              const item = stackItems.find(i => i.id === itemId);
              if (item && item.active && isScheduledForDate(item.schedule, selectedDate)) {
                newEntries[`${dateKey}-${itemId}`] = {
                  date: dateKey,
                  itemId: itemId,
                  dose: entry.dose,
                  taken: true
                };
                copiedCount++;
              }
            });

            setStackEntries(newEntries);
            haptic('success');
            setLastAction(`Matched ${copiedCount} from yesterday`);
          }}
          onEditStack={() => setShowManageStack(true)}
          onEditInputs={() => setShowManageInputs(true)}
        />
      )}
    </div>
    </div>
  );
}

export default App;
