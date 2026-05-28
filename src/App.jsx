import { useState, useRef, useEffect, useMemo, useCallback, useDeferredValue } from 'react';
import { useLocalStorage, useLocalStorageSet } from './hooks/useLocalStorage';
import { useFirebase } from './hooks/useFirebase';
import { useSyncEngine } from './hooks/useSyncEngine';
import { useDesktopMode } from './hooks/useMediaQuery';
import { useGarminSync } from './hooks/useGarminSync';
import { detectDataShrink, restoreSnapshot } from './utils/snapshots';
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
import DesktopToolbar from './components/DesktopToolbar';
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
import SupplementGraph from './components/SupplementGraph';

function App() {
  // App mode: 'symptoms' or 'stack'
  const [appMode, setAppMode] = useState('symptoms');
  // Protocol sub-view: 'stack' or 'inputs'
  const [protocolView, setProtocolView] = useState('stack');
  const scrollContainerRef = useRef(null);

  // Firebase (auth only)
  const firebase = useFirebase();

  // Shared ref: prevents feedback loops when applying cloud data to local state.
  // When true, useLocalStorage onChange callbacks skip notifying the sync engine.
  const isApplyingCloudRef = useRef(false);

  // Ref to hold the sync engine's notifyChange function (breaks circular dep)
  const syncNotifyRef = useRef(null);

  // Core data state — with onChange callbacks for sync
  const [symptoms, setSymptoms] = useLocalStorage(STORAGE_KEY_SYMPTOMS, [],
    (data) => syncNotifyRef.current?.('symptoms', data),
    isApplyingCloudRef
  );
  const [entries, setEntries] = useLocalStorage(STORAGE_KEY_ENTRIES, {},
    (data) => syncNotifyRef.current?.('entries', data),
    isApplyingCloudRef
  );
  const [dailyNotes, setDailyNotes] = useLocalStorage(STORAGE_KEY_NOTES, {},
    (data) => syncNotifyRef.current?.('dailyNotes', data),
    isApplyingCloudRef
  );
  const [trackingMode, setTrackingMode] = useLocalStorage(STORAGE_KEY_MODE, 'ampm',
    (data) => syncNotifyRef.current?.('trackingMode', data),
    isApplyingCloudRef
  );
  const [stackItems, setStackItems] = useLocalStorage(STORAGE_KEY_STACK_ITEMS, [],
    (data) => syncNotifyRef.current?.('stackItems', data),
    isApplyingCloudRef
  );
  const [stackEntries, setStackEntries] = useLocalStorage(STORAGE_KEY_STACK_ENTRIES, {},
    (data) => syncNotifyRef.current?.('stackEntries', data),
    isApplyingCloudRef
  );
  const [pinnedSymptoms, setPinnedSymptoms] = useLocalStorageSet(STORAGE_KEY_PINNED, new Set(),
    (data) => syncNotifyRef.current?.('pinnedSymptoms', data),
    isApplyingCloudRef
  );
  const [inputItems, setInputItems] = useLocalStorage(STORAGE_KEY_INPUT_ITEMS, [],
    (data) => syncNotifyRef.current?.('inputItems', data),
    isApplyingCloudRef
  );
  const [inputEntries, setInputEntries] = useLocalStorage(STORAGE_KEY_INPUT_ENTRIES, {},
    (data) => syncNotifyRef.current?.('inputEntries', data),
    isApplyingCloudRef
  );
  const [copyDays, setCopyDays] = useLocalStorage(STORAGE_KEY_COPY_DAYS, 7);
  const [trendWindow, setTrendWindow] = useLocalStorage(STORAGE_KEY_TREND_WINDOW, 7);

  // Reset the cloud-apply flag AFTER all useLocalStorage effects have run.
  // React guarantees effects run in declaration order within a component,
  // so this fires after every useLocalStorage effect above has checked the flag.
  // This replaces the unreliable timer-based reset (setTimeout/rAF race with
  // React 18's MessageChannel-based effect scheduling).
  useEffect(() => {
    if (isApplyingCloudRef.current) {
      isApplyingCloudRef.current = false;
    }
  });

  // Sync engine — bridges state to Firestore
  const sync = useSyncEngine(
    firebase.user?.uid,
    firebase.firebaseReady,
    {
      symptoms: setSymptoms,
      entries: setEntries,
      dailyNotes: setDailyNotes,
      stackItems: setStackItems,
      stackEntries: setStackEntries,
      pinnedSymptoms: setPinnedSymptoms,
      trackingMode: setTrackingMode,
      inputItems: setInputItems,
      inputEntries: setInputEntries,
    },
    isApplyingCloudRef
  );

  // Wire up the sync notifyChange function so onChange callbacks can reach it
  syncNotifyRef.current = sync.notifyChange;

  // Date state
  const [selectedDate, setSelectedDate] = useState(new Date());
  const lastCurrentDateRef = useRef(null);

  // View state
  const [showCalendar, setShowCalendar] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [insightsSubtab, setInsightsSubtab] = useState('studio');
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showSymptomGraph, setShowSymptomGraph] = useState(null);
  const [showSupplementGraph, setShowSupplementGraph] = useState(null);

  // Detect possible data loss at boot — if any snapshot has substantially
  // more items than current localStorage, surface a one-click restore banner.
  const [dataLossSnapshot, setDataLossSnapshot] = useState(() => detectDataShrink(0.7));

  // UI state
  const [lastAction, setLastAction] = useState('');
  const [copyToastMessage, setCopyToastMessage] = useState('');
  const [symptomSearch, setSymptomSearch] = useState('');
  const [protocolSearch, setProtocolSearch] = useState('');
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

  // Desktop mode
  const isDesktop = useDesktopMode();

  const garminSync = useGarminSync(firebase.user);

  // Refs
  const justLoggedRef = useRef(false);

  // Deferred entries: during rapid-fire entry, React defers re-renders of
  // components that use this value, keeping the main thread free for the
  // active RapidEntry overlay. Heavy components (SymptomList, Stack, Insights,
  // health score, tab badges) use deferredEntries instead of entries.
  const deferredEntries = useDeferredValue(entries);
  const deferredStackEntries = useDeferredValue(stackEntries);

  // URL action shortcut: handles ?action=push or ?action=pull-merge so a
  // recovery can be a single bookmark/click instead of navigating Settings.
  // Runs once when the engine is ready.
  const urlActionRanRef = useRef(false);
  useEffect(() => {
    if (urlActionRanRef.current || !sync.isReady) return;
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (!action) return;
    urlActionRanRef.current = true;

    const clearAction = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('action');
      window.history.replaceState({}, '', url.toString());
    };

    (async () => {
      if (action === 'push') {
        if (!confirm('Push this device\'s local data to cloud now? (Overwrites cloud with what this device has.)')) {
          clearAction();
          return;
        }
        await sync.forcePush({
          symptoms, entries, dailyNotes, stackItems, stackEntries,
          pinnedSymptoms: [...pinnedSymptoms], trackingMode, inputItems, inputEntries,
        });
        alert('Push complete. Cloud now has this device\'s data.');
        clearAction();
      } else if (action === 'pull-merge') {
        const result = await sync.forcePull({ destructive: false });
        if (result) {
          const total = Object.values(result.summary).reduce((a, b) => a + b, 0);
          alert(`Merge complete. Cloud had ${total} items; merged with local (snapshot saved as ${result.snapshotId}).`);
        } else {
          alert('Pull failed — see console.');
        }
        clearAction();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.isReady]);

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
        const hasTimePeriodEntry = deferredEntries[`${dateKey}-${symptom.id}-${timePeriod}`];
        if (hasTimePeriodEntry) return false;
        if (timePeriod === 'morning' && deferredEntries[`${dateKey}-${symptom.id}-daily`]) {
          return false;
        }
        return true;
      } else {
        const hasDailyEntry = deferredEntries[`${dateKey}-${symptom.id}-daily`];
        if (hasDailyEntry) return false;
        const hasMorningEntry = deferredEntries[`${dateKey}-${symptom.id}-morning`];
        const hasEveningEntry = deferredEntries[`${dateKey}-${symptom.id}-evening`];
        if (hasMorningEntry || hasEveningEntry) return false;
        return true;
      }
    });
  }, [symptoms, deferredEntries, selectedDate, quickLogTime, trackingMode, pinnedSymptoms]);

  // Check for date changes (midnight) - uses local time
  useEffect(() => {
    const currentDateKey = getDateKey(new Date());
    if (lastCurrentDateRef.current !== null && lastCurrentDateRef.current !== currentDateKey) {
      const selectedDateKey = getDateKey(selectedDate);
      if (selectedDateKey === lastCurrentDateRef.current) {
        lastCurrentDateRef.current = currentDateKey;
        setSelectedDate(new Date());
      } else {
        lastCurrentDateRef.current = currentDateKey;
      }
    } else if (lastCurrentDateRef.current === null) {
      lastCurrentDateRef.current = currentDateKey;
    }
  });

  // Auto-clear lastAction
  useEffect(() => {
    if (lastAction) {
      const timer = setTimeout(() => setLastAction(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [lastAction]);

  // Auto-prefill today's stack and inputs from yesterday's checked entries.
  // Uses refs to read latest data without causing re-triggers, and re-runs
  // when sync becomes ready (so cloud data is included).
  const stackEntriesRef = useRef(stackEntries);
  stackEntriesRef.current = stackEntries;
  const stackItemsRef = useRef(stackItems);
  stackItemsRef.current = stackItems;
  const inputEntriesRef = useRef(inputEntries);
  inputEntriesRef.current = inputEntries;
  const inputItemsRef = useRef(inputItems);
  inputItemsRef.current = inputItems;
  const prefillRanRef = useRef(false);
  useEffect(() => {
    // Wait for sync engine to be ready before prefilling (prevents pushing stale data)
    if (firebase.user && !sync.isReady) return;
    // Only run once per app session (after sync is ready)
    if (prefillRanRef.current) return;
    prefillRanRef.current = true;

    const todayKey = getDateKey(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getDateKey(yesterday);

    // Prefill stack entries (per-item, skipping items that already have today's entry)
    const currentStackEntries = stackEntriesRef.current;
    const currentStackItems = stackItemsRef.current;
    const yesterdayStackEntries = Object.entries(currentStackEntries).filter(([key]) => key.startsWith(yesterdayKey));
    if (yesterdayStackEntries.length > 0) {
      setStackEntries(prev => {
        const newEntries = { ...prev };
        let changed = false;
        yesterdayStackEntries.forEach(([key, entry]) => {
          const itemId = key.substring(yesterdayKey.length + 1);
          const todayEntryKey = `${todayKey}-${itemId}`;
          if (newEntries[todayEntryKey]) return; // already has today's entry
          const item = currentStackItems.find(i => i.id === itemId);
          if (item && item.active && isScheduledForDate(item.schedule, new Date())) {
            newEntries[todayEntryKey] = {
              date: todayKey,
              itemId,
              dose: entry.dose,
              taken: true,
            };
            changed = true;
          }
        });
        return changed ? newEntries : prev;
      });
    }

    // Prefill input entries (per-item, skipping items that already have today's entry)
    const currentInputEntries = inputEntriesRef.current;
    const currentInputItems = inputItemsRef.current;
    const yesterdayInputEntries = Object.entries(currentInputEntries).filter(([key]) => key.startsWith(yesterdayKey));
    if (yesterdayInputEntries.length > 0) {
      setInputEntries(prev => {
        const newEntries = { ...prev };
        let changed = false;
        yesterdayInputEntries.forEach(([key, entry]) => {
          const inputId = key.substring(yesterdayKey.length + 1);
          const todayEntryKey = `${todayKey}-${inputId}`;
          if (newEntries[todayEntryKey]) return; // already has today's entry
          const item = currentInputItems.find(i => i.id === inputId);
          if (item && item.active) {
            newEntries[todayEntryKey] = {
              date: todayKey,
              inputId,
              logged: true,
              count: entry.count || 1,
            };
            changed = true;
          }
        });
        return changed ? newEntries : prev;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebase.user, sync.isReady]);

  // Desktop keyboard shortcuts
  useEffect(() => {
    if (!isDesktop) return;
    const handleKeyDown = (e) => {
      // Don't fire when typing in inputs/textareas
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      // Don't fire when rapid entry is open (it has its own keyboard handler)
      if (rapidEntryMode) return;

      if (e.key === '1') {
        setShowInsights(false);
        setAppMode('symptoms');
      } else if (e.key === '2') {
        setShowInsights(false);
        setAppMode('protocol');
      } else if (e.key === '3') {
        setShowInsights(true);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedDate(prev => {
          const d = new Date(prev);
          d.setDate(d.getDate() - 1);
          return d;
        });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedDate(prev => {
          const d = new Date(prev);
          d.setDate(d.getDate() + 1);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return d > today ? prev : d;
        });
      } else if (e.key === 't' || e.key === 'T') {
        setSelectedDate(new Date());
      } else if (e.key === 'r' || e.key === 'R') {
        if (!showSettings && !showCalendar && !showExport && !showNoteModal && !showSymptomGraph && !showSupplementGraph) {
          setRapidEntryMode(true);
        }
      } else if (e.key === 'Escape') {
        // Close modals in priority order
        if (showSymptomGraph) setShowSymptomGraph(null);
        else if (showSupplementGraph) setShowSupplementGraph(null);
        else if (showSettings) setShowSettings(false);
        else if (showCalendar) setShowCalendar(false);
        else if (showExport) setShowExport(false);
        else if (showNoteModal) setShowNoteModal(false);
        else if (showAddSymptom) setShowAddSymptom(false);
        else if (showManageStack) setShowManageStack(false);
        else if (showManageInputs) setShowManageInputs(false);
        else if (showInsights) setShowInsights(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDesktop, rapidEntryMode, showSettings, showCalendar, showExport, showNoteModal, showSymptomGraph, showSupplementGraph, showInsights, showAddSymptom, showManageStack, showManageInputs]);

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

  // Tab badge data — uses deferred entries to avoid blocking during rapid entry
  const tabBadges = useMemo(() => {
    const dateKey = getDateKey(selectedDate);
    const todaySymptomEntries = Object.values(deferredEntries).filter(e => e.date === dateKey);
    const todayStackEntries = Object.values(deferredStackEntries).filter(e => e.date === dateKey);
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
  }, [deferredEntries, deferredStackEntries, stackItems, symptoms, selectedDate]);

  // Get symptom entries for a given symptom
  const getSymptomEntries = useCallback((symptomId) => {
    const dateKey = getDateKey(selectedDate);
    const timeOrder = { night: 0, morning: 1, allday: 2, midday: 3, evening: 4, daily: 2 };

    const allDayEntries = Object.entries(deferredEntries)
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
  }, [deferredEntries, selectedDate, trackingMode]);

  // Get most recent entry for a symptom
  const getMostRecentEntry = useCallback((symptomId, currentTimePeriod = null) => {
    const selectedDateKey = getDateKey(selectedDate);
    const timeOrder = { morning: 0, daily: 1, evening: 2 };
    const currentTimeOrder = timeOrder[currentTimePeriod] ?? 999;

    const allEntries = Object.entries(deferredEntries)
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
  }, [deferredEntries, selectedDate]);

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
        maxWidth: isDesktop ? '1400px' : '500px',
        width: '100%',
        margin: '0 auto',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#08090A',
        boxShadow: !isDesktop && window.innerWidth > 500 ? '0 0 40px rgba(0,0,0,0.5)' : 'none',
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
          initialRapidEntryIndex={rapidEntryIndex}
          rapidEntryConfirm={rapidEntryConfirm}
          setRapidEntryConfirm={setRapidEntryConfirm}
          setRapidEntryMode={setRapidEntryMode}
          quickLog={quickLog}
          setEntries={setEntries}
          getMostRecentEntry={getMostRecentEntry}
          setCopyToastMessage={setCopyToastMessage}
          isDesktop={isDesktop}
        />
      )}

      {/* Desktop Toolbar - replaces Header + BottomNav on desktop */}
      {isDesktop && !showAddSymptom && !showManageStack && !showManageInputs && (
        <DesktopToolbar
          selectedDate={selectedDate}
          changeDate={changeDate}
          canGoForward={canGoForward}
          setShowCalendar={setShowCalendar}
          setCalendarMonth={setCalendarMonth}
          appMode={appMode}
          setAppMode={setAppMode}
          showInsights={showInsights}
          setShowInsights={setShowInsights}
          quickLogTime={quickLogTime}
          setQuickLogTime={setQuickLogTime}
          trackingMode={trackingMode}
          symptoms={symptoms}
          entries={deferredEntries}
          flashColumn={flashColumn}
          setFlashColumn={setFlashColumn}
          setCopyToastMessage={setCopyToastMessage}
          onRapidEntry={() => {
            const effectiveTime = quickLogTime || getCurrentTimePeriod(trackingMode);
            if (trackingMode === 'ampm' && !quickLogTime) {
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
          onEditNote={() => setShowNoteModal(true)}
          onCopyData={quickCopyData}
          copyDays={copyDays}
          onEditSymptoms={() => setShowAddSymptom(true)}
          onCheckAll={() => {
            const dateKey = getDateKey(selectedDate);
            const activeItems = stackItems.filter(i =>
              i.active && isScheduledForDate(i.schedule, selectedDate)
            );
            setStackEntries(prev => {
              const newEntries = { ...prev };
              activeItems.forEach(item => {
                const entryKey = `${dateKey}-${item.id}`;
                newEntries[entryKey] = {
                  date: dateKey,
                  itemId: item.id,
                  dose: item.defaultDose,
                  taken: true
                };
              });
              return newEntries;
            });
            haptic('success');
            setLastAction('All selected');
          }}
          onClear={() => {
            const dateKey = getDateKey(selectedDate);
            setStackEntries(prev => {
              const newEntries = { ...prev };
              Object.keys(newEntries).forEach(key => {
                if (key.startsWith(dateKey)) {
                  delete newEntries[key];
                }
              });
              return newEntries;
            });
            setLastAction('All cleared');
          }}
          onMatchYesterday={() => {
            const dateKey = getDateKey(selectedDate);
            const yesterday = new Date(selectedDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayKey = getDateKey(yesterday);
            setStackEntries(prev => {
              const yesterdayEntries = Object.entries(prev).filter(([key]) => key.startsWith(yesterdayKey));
              if (yesterdayEntries.length === 0) {
                setLastAction('No entries from yesterday');
                return prev;
              }
              const newEntries = { ...prev };
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
              setLastAction(`Matched ${copiedCount} from yesterday`);
              return newEntries;
            });
            haptic('success');
          }}
          onEditStack={() => setShowManageStack(true)}
          onEditInputs={() => setShowManageInputs(true)}
          onOpenSettings={() => {
            setShowSettings(true);
            setShowInsights(false);
          }}
        />
      )}

      {/* Mobile Header - hide on desktop and when in edit modes */}
      {!isDesktop && !showAddSymptom && !showManageStack && !showManageInputs && (
        <Header
          selectedDate={selectedDate}
          changeDate={changeDate}
          canGoForward={canGoForward}
          setShowCalendar={setShowCalendar}
          setCalendarMonth={setCalendarMonth}
          symptoms={symptoms}
          entries={deferredEntries}
          trackingMode={trackingMode}
        />
      )}

      {/* Desktop Content Area */}
      {isDesktop ? (
        <div ref={scrollContainerRef} style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}>
          <div style={{
            maxWidth: showInsights ? '1800px' : '1400px',
            margin: '0 auto',
            padding: '24px 32px',
            paddingBottom: '80px',
          }}>
            {showInsights ? (
              <Insights
                user={firebase.user}
                entries={deferredEntries}
                symptoms={symptoms}
                stackItems={stackItems}
                stackEntries={deferredStackEntries}
                insightsWindow={insightsWindow}
                setInsightsWindow={setInsightsWindow}
                onOpenGraph={setShowSymptomGraph}
                onOpenSupplementGraph={setShowSupplementGraph}
                isDesktop={true}
                trackingMode={trackingMode}
                setStackItems={setStackItems}
              />
            ) : appMode === 'symptoms' ? (
              <SymptomList
                symptoms={symptoms}
                setSymptoms={setSymptoms}
                activeSymptoms={activeSymptoms}
                entries={deferredEntries}
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
                isDesktop={isDesktop}
                onRapidEntry={() => {
                  const effectiveTime = quickLogTime || getCurrentTimePeriod(trackingMode);
                  if (trackingMode === 'ampm' && !quickLogTime) {
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
                onEditNote={() => setShowNoteModal(true)}
                onCopyData={quickCopyData}
                copyDays={copyDays}
                setCopyDays={setCopyDays}
                onEditSymptoms={() => setShowAddSymptom(true)}
              />
            ) : (
              /* Protocol: action bar + side-by-side supplements + inputs */
              <div>
                {/* Protocol action bar — matches symptoms layout */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '16px',
                }}>
                  {/* Search — ~25% width */}
                  <div style={{ position: 'relative', width: '25%', minWidth: '180px', flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                      type="text"
                      value={protocolSearch}
                      onChange={(e) => setProtocolSearch(e.target.value)}
                      placeholder="Search..."
                      style={{
                        width: '100%',
                        padding: '8px 32px 8px 34px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '8px',
                        color: '#f8fafc',
                        fontSize: '13px',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    {protocolSearch && (
                      <button
                        onClick={() => setProtocolSearch('')}
                        style={{
                          position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                          background: 'transparent', border: 'none', color: '#6b7280',
                          fontSize: '14px', cursor: 'pointer', padding: '2px 6px',
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {/* Actions — right-aligned */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto' }}>
                    {[
                      { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>, label: 'Match Yesterday', action: () => {
                        const dateKey = getDateKey(selectedDate);
                        const yesterday = new Date(selectedDate);
                        yesterday.setDate(yesterday.getDate() - 1);
                        const yesterdayKey = getDateKey(yesterday);
                        setStackEntries(prev => {
                          const yesterdayEntries = Object.entries(prev).filter(([key]) => key.startsWith(yesterdayKey));
                          if (yesterdayEntries.length === 0) { setLastAction('No entries from yesterday'); return prev; }
                          const newEntries = { ...prev };
                          let copiedCount = 0;
                          yesterdayEntries.forEach(([key, entry]) => {
                            const itemId = key.substring(yesterdayKey.length + 1);
                            const item = stackItems.find(i => i.id === itemId);
                            if (item && item.active && isScheduledForDate(item.schedule, selectedDate)) {
                              newEntries[`${dateKey}-${itemId}`] = { date: dateKey, itemId, dose: entry.dose, taken: true };
                              copiedCount++;
                            }
                          });
                          setLastAction(`Matched ${copiedCount} from yesterday`);
                          return newEntries;
                        });
                        haptic('success');
                      }},
                      { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>, label: 'Check All', action: () => {
                        const dateKey = getDateKey(selectedDate);
                        const activeItems = stackItems.filter(i => i.active && isScheduledForDate(i.schedule, selectedDate));
                        setStackEntries(prev => {
                          const newEntries = { ...prev };
                          activeItems.forEach(item => {
                            newEntries[`${dateKey}-${item.id}`] = { date: dateKey, itemId: item.id, dose: item.defaultDose, taken: true };
                          });
                          return newEntries;
                        });
                        haptic('success');
                        setLastAction('All selected');
                      }},
                      { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>, label: 'Clear', action: () => {
                        const dateKey = getDateKey(selectedDate);
                        setStackEntries(prev => {
                          const newEntries = { ...prev };
                          Object.keys(newEntries).forEach(key => { if (key.startsWith(dateKey)) delete newEntries[key]; });
                          return newEntries;
                        });
                        setLastAction('All cleared');
                      }},
                      { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>, label: 'Edit Stack', action: () => setShowManageStack(true) },
                      { icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>, label: 'Edit Inputs', action: () => setShowManageInputs(true) },
                    ].map(({ icon, label, action }) => (
                      <button
                        key={label}
                        onClick={action}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          padding: '6px 10px', background: 'transparent',
                          border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px',
                          color: '#9ca3af', fontSize: '12px', fontWeight: '500',
                          cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = '#e5e7eb'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#9ca3af'; }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', width: '14px', height: '14px' }}>{icon}</span>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Side-by-side panels */}
                <div style={{
                  display: 'flex',
                  gap: '24px',
                }}>
                  <div style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.06)',
                    overflow: 'hidden',
                  }}>
                    <Stack
                      stackItems={stackItems}
                      setStackItems={setStackItems}
                      stackEntries={deferredStackEntries}
                      setStackEntries={setStackEntries}
                      selectedDate={selectedDate}
                      setLastAction={setLastAction}
                      showManageStack={showManageStack}
                      setShowManageStack={setShowManageStack}
                      onOpenSupplementGraph={setShowSupplementGraph}
                      isDesktop={isDesktop}
                      searchFilter={protocolSearch}
                    />
                  </div>
                  <div style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.06)',
                    overflow: 'hidden',
                  }}>
                    <Inputs
                      inputItems={inputItems}
                      setInputItems={setInputItems}
                      inputEntries={inputEntries}
                      setInputEntries={setInputEntries}
                      selectedDate={selectedDate}
                      setLastAction={setLastAction}
                      showManageInputs={showManageInputs}
                      setShowManageInputs={setShowManageInputs}
                      isDesktop={isDesktop}
                      searchFilter={protocolSearch}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Mobile: tab-switching layout */
        <div ref={scrollContainerRef} style={{
          flex: 1,
          overflowY: (showManageStack || showAddSymptom || showManageInputs) ? 'hidden' : 'auto',
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
                entries={deferredEntries}
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
                    stackEntries={deferredStackEntries}
                    setStackEntries={setStackEntries}
                    selectedDate={selectedDate}
                    setLastAction={setLastAction}
                    showManageStack={showManageStack}
                    setShowManageStack={setShowManageStack}
                    onOpenSupplementGraph={setShowSupplementGraph}
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
      )}

      {/* Note Modal */}
      {showNoteModal && (
        <NoteModal
          selectedDate={selectedDate}
          dailyNotes={dailyNotes}
          setDailyNotes={setDailyNotes}
          onClose={() => setShowNoteModal(false)}
          isDesktop={isDesktop}
        />
      )}

      {/* Floating AM/PM + Rapid Entry Pill - mobile only, symptoms page in AM/PM mode */}
      {!isDesktop && appMode === 'symptoms' && trackingMode === 'ampm' && !showAddSymptom && !showManageStack && !showManageInputs && !showInsights && !showSettings && !showSymptomGraph && !rapidEntryMode && (
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
          {/* AM/PM Toggle */}
          {(() => {
            const current = quickLogTime || getCurrentTimePeriod(trackingMode);
            const isAM = current === 'morning';
            return (
              <div style={{
                display: 'flex',
                background: 'rgba(15, 17, 21, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '22px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
                padding: '4px',
                gap: '2px',
              }}>
                <button
                  onClick={() => {
                    if (!isAM) {
                      setQuickLogTime('morning');
                      setFlashColumn('morning');
                      setTimeout(() => setFlashColumn(null), 400);
                      setCopyToastMessage('..AM..');
                      setTimeout(() => setCopyToastMessage(''), 2000);
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '18px',
                    border: 'none',
                    background: isAM ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                    color: isAM ? '#a5b4fc' : '#6b7280',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >AM</button>
                <button
                  onClick={() => {
                    if (isAM) {
                      setQuickLogTime('evening');
                      setFlashColumn('evening');
                      setTimeout(() => setFlashColumn(null), 400);
                      setCopyToastMessage('..PM..');
                      setTimeout(() => setCopyToastMessage(''), 2000);
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '18px',
                    border: 'none',
                    background: !isAM ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                    color: !isAM ? '#a5b4fc' : '#6b7280',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >PM</button>
              </div>
            );
          })()}
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
        </div>
      )}

      {/* Data-loss banner: detected current localStorage has shrunk vs newest snapshot */}
      {dataLossSnapshot && (
        <div style={{
          position: 'fixed',
          top: 'calc(20px + env(safe-area-inset-top))',
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: 'calc(100vw - 40px)',
          background: '#7f1d1d',
          color: '#fff',
          padding: '14px 18px',
          borderRadius: '10px',
          fontSize: '13px',
          zIndex: 3000,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div style={{ fontWeight: '600', fontSize: '14px' }}>
            Possible data loss detected
          </div>
          <div style={{ fontSize: '13px', lineHeight: '1.4' }}>
            You currently have <b>{dataLossSnapshot.currentCount}</b> items, but a snapshot from{' '}
            {new Date(dataLossSnapshot.ts).toLocaleString()} ({dataLossSnapshot.label}) has{' '}
            <b>{dataLossSnapshot.itemCount}</b>. Restore it?
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => {
                const ok = restoreSnapshot(dataLossSnapshot.id);
                if (ok) {
                  alert('Restored. Reloading.');
                  window.location.reload();
                } else {
                  alert('Restore failed.');
                }
              }}
              style={{
                background: '#fff',
                color: '#7f1d1d',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Restore snapshot
            </button>
            <button
              onClick={() => setDataLossSnapshot(null)}
              style={{
                background: 'transparent',
                color: '#fecaca',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                padding: '8px 14px',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
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
          entries={deferredEntries}
          onClose={() => setShowCalendar(false)}
          isDesktop={isDesktop}
        />
      )}

      {/* Insights - mobile only as overlay (desktop renders inline) */}
      {showInsights && !isDesktop && (
        <Insights
          user={firebase.user}
          entries={deferredEntries}
          symptoms={symptoms}
          stackItems={stackItems}
          stackEntries={deferredStackEntries}
          insightsWindow={insightsWindow}
          setInsightsWindow={setInsightsWindow}
          onOpenGraph={setShowSymptomGraph}
          onOpenSupplementGraph={setShowSupplementGraph}
          trackingMode={trackingMode}
          insightsSubtab={insightsSubtab}
          setInsightsSubtab={setInsightsSubtab}
          setStackItems={setStackItems}
        />
      )}

      {/* Symptom Graph */}
      {showSymptomGraph && (
        <SymptomGraph
          primarySymptomId={showSymptomGraph}
          symptoms={symptoms}
          activeSymptoms={activeSymptoms}
          entries={deferredEntries}
          trackingMode={trackingMode}
          onClose={() => setShowSymptomGraph(null)}
          onChangeSymptom={setShowSymptomGraph}
          isDesktop={isDesktop}
        />
      )}

      {/* Supplement Graph */}
      {showSupplementGraph && (
        <SupplementGraph
          primaryItemId={showSupplementGraph}
          stackItems={stackItems}
          stackEntries={deferredStackEntries}
          symptoms={symptoms}
          entries={deferredEntries}
          trackingMode={trackingMode}
          onClose={() => setShowSupplementGraph(null)}
          onChangeItem={setShowSupplementGraph}
          isDesktop={isDesktop}
        />
      )}

      {/* Settings */}
      {showSettings && (
        <Settings
          user={firebase.user}
          syncing={sync.syncing}
          lastSynced={sync.lastSynced}
          syncError={sync.syncError}
          setSyncError={sync.setSyncError}
          firebaseError={firebase.firebaseError}
          authError={firebase.authError}
          setAuthError={firebase.setAuthError}
          signInWithGoogle={firebase.signInWithGoogle}
          signInWithEmail={firebase.signInWithEmail}
          forgotPassword={firebase.forgotPassword}
          signOut={firebase.signOut}
          trackingMode={trackingMode}
          setTrackingMode={setTrackingMode}
          symptoms={symptoms}
          setSymptoms={setSymptoms}
          entries={deferredEntries}
          setEntries={setEntries}
          dailyNotes={dailyNotes}
          setDailyNotes={setDailyNotes}
          stackItems={stackItems}
          setStackItems={setStackItems}
          stackEntries={deferredStackEntries}
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
          isDesktop={isDesktop}
          garminSync={garminSync}
          onForcePush={() => sync.forcePush({
            symptoms,
            entries,
            dailyNotes,
            stackItems,
            stackEntries,
            pinnedSymptoms: [...pinnedSymptoms],
            trackingMode,
            inputItems,
            inputEntries,
          })}
          onForcePull={sync.forcePull}
        />
      )}

      {/* Export */}
      {showExport && (
        <Export
          entries={deferredEntries}
          symptoms={symptoms}
          dailyNotes={dailyNotes}
          stackItems={stackItems}
          stackEntries={deferredStackEntries}
          trackingMode={trackingMode}
          inputItems={inputItems}
          inputEntries={inputEntries}
          setCopyToastMessage={setCopyToastMessage}
          onClose={() => setShowExport(false)}
          isDesktop={isDesktop}
        />
      )}

      {/* Bottom Navigation - mobile only, hide when in edit modes */}
      {!isDesktop && !showAddSymptom && !showManageStack && !showManageInputs && (
        <BottomNav
          appMode={appMode}
          setAppMode={setAppMode}
          protocolView={protocolView}
          setProtocolView={setProtocolView}
          showInsights={showInsights}
          setShowInsights={setShowInsights}
          insightsSubtab={insightsSubtab}
          setInsightsSubtab={setInsightsSubtab}
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
            setStackEntries(prev => {
              const newEntries = { ...prev };
              activeItems.forEach(item => {
                const entryKey = `${dateKey}-${item.id}`;
                newEntries[entryKey] = {
                  date: dateKey,
                  itemId: item.id,
                  dose: item.defaultDose,
                  taken: true
                };
              });
              return newEntries;
            });
            haptic('success');
            setLastAction('All selected');
          }}
          onClear={() => {
            const dateKey = getDateKey(selectedDate);
            setStackEntries(prev => {
              const newEntries = { ...prev };
              Object.keys(newEntries).forEach(key => {
                if (key.startsWith(dateKey)) {
                  delete newEntries[key];
                }
              });
              return newEntries;
            });
            setLastAction('All cleared');
          }}
          onMatchYesterday={() => {
            const dateKey = getDateKey(selectedDate);
            const yesterday = new Date(selectedDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayKey = getDateKey(yesterday);

            setStackEntries(prev => {
              const yesterdayEntries = Object.entries(prev).filter(([key]) => key.startsWith(yesterdayKey));
              if (yesterdayEntries.length === 0) {
                setLastAction('No entries from yesterday');
                return prev;
              }

              const newEntries = { ...prev };
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

              setLastAction(`Matched ${copiedCount} from yesterday`);
              return newEntries;
            });
            haptic('success');
          }}
          onEditStack={() => setShowManageStack(true)}
          onEditInputs={() => setShowManageInputs(true)}
          symptoms={symptoms}
          entries={deferredEntries}
          trackingMode={trackingMode}
          selectedDate={selectedDate}
        />
      )}
    </div>
    </div>
  );
}

export default App;
