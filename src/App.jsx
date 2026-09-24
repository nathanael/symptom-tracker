import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, useDeferredValue } from 'react';
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
  STORAGE_KEY_TALK_ENGINE,
  STORAGE_KEY_TALK_SHOW_COST,
  STORAGE_KEY_INPUT_ITEMS,
  STORAGE_KEY_INPUT_ENTRIES,
  STORAGE_KEY_MEALS,
  severityColors,
  NA_SEVERITY,
  trackingModes,
  defaultSymptoms,
  defaultStackItems,
  SWIPE_THRESHOLD,
  SWIPE_TIME_LIMIT,
} from './utils/constants';
import {
  getDateKey,
  noteText,
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
import { clearDay, restoreDay } from './utils/listHelpers';
import { liveItems, markDeleted, restoreDeleted, isExpired, removeEntriesFor } from './utils/softDelete';
import { summaryLines } from './utils/homeSummary';

// Components
import Header from './components/Header';
import Home from './components/Home';
import BottomNav from './components/BottomNav';
import DesktopToolbar from './components/DesktopToolbar';
import RapidEntry from './components/RapidEntry';
import SimpleProtocol from './components/SimpleProtocol';
import TalkMode from './components/TalkMode';
import TalkCostCard from './components/TalkCostCard';
import { primePlayback } from './voice/pcmAudio';
import { primeRemoteAudio } from './voice/webrtcConnection';
import SymptomRows from './components/SymptomRows';
import UndoToast from './components/UndoToast';
import ProtocolRows from './components/ProtocolRows';
import MealCapture from './components/MealCapture';
import MealList from './components/MealList';
import { mealKey, mealDateKey } from './food/mealKey';
import { mergeBackupMeals } from './food/mealBackup';
import Calendar from './components/Calendar';
import Insights from './components/Insights';
import Settings from './components/Settings';
import Export from './components/Export';
import NoteModal from './components/NoteModal';
import VoiceNote from './components/VoiceNote';
import { appendToNote } from './utils/voiceNote';
import SymptomGraph from './components/SymptomGraph';
import SupplementGraph from './components/SupplementGraph';

function App() {
  // App mode: 'home' (the easy-mode landing screen), 'symptoms' or 'stack'
  const [appMode, setAppMode] = useState('home');
  // Protocol sub-view: 'stack' or 'inputs'
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
  const [meals, setMeals] = useLocalStorage(STORAGE_KEY_MEALS, {},
    (data) => syncNotifyRef.current?.('meals', data),
    isApplyingCloudRef
  );
  const [copyDays, setCopyDays] = useLocalStorage(STORAGE_KEY_COPY_DAYS, 7);
  const [talkEngine, setTalkEngine] = useLocalStorage(STORAGE_KEY_TALK_ENGINE, 'gemini');
  const [talkShowCost, setTalkShowCost] = useLocalStorage(STORAGE_KEY_TALK_SHOW_COST, true);

  // Normalize legacy bare-string daily notes → { text } records, once, so the
  // sync diff never spreads a bare string (which would corrupt the record).
  // Guarded to only setDailyNotes when something actually changed (no loop).
  const notesNormalizedRef = useRef(false);
  useEffect(() => {
    if (notesNormalizedRef.current) return;
    notesNormalizedRef.current = true;
    setDailyNotes(prev => {
      let changed = false;
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        if (typeof v === 'string') { next[k] = { text: v }; changed = true; }
        else next[k] = v;
      }
      return changed ? next : prev;
    });
  }, []);

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
      meals: setMeals,
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
  const [showRapidEntry, setShowRapidEntry] = useState(false);
  const [showSimpleProtocol, setShowSimpleProtocol] = useState(false);
  const [showTalkMode, setShowTalkMode] = useState(false);
  const [showVoiceNote, setShowVoiceNote] = useState(false);
  // null = closed; { key } opens an existing meal for editing; {} opens a fresh capture
  const [mealSheet, setMealSheet] = useState(null);
  // One-shot: Home's "Today's meals" sets this so MealList scrolls itself into view on mount.
  const [scrollToMeals, setScrollToMeals] = useState(false);
  const [talkCost, setTalkCost] = useState(null); // stats of the last conversation, until dismissed
  const [showSymptomGraph, setShowSymptomGraph] = useState(null);
  const [showSupplementGraph, setShowSupplementGraph] = useState(null);
  // Mobile History button: jump to Insights with that symptom selected
  const [insightsFocusSymptom, setInsightsFocusSymptom] = useState(null);
  const openSymptomInInsights = (symptomId) => { setInsightsFocusSymptom(symptomId); setShowInsights(true); };
  useEffect(() => { if (!showInsights) setInsightsFocusSymptom(null); }, [showInsights]);

  // Detect possible data loss at boot — if any snapshot has substantially
  // more items than current localStorage, surface a one-click restore banner.
  const [dataLossSnapshot, setDataLossSnapshot] = useState(() => detectDataShrink(0.7));
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const recoveryFileInputRef = useRef(null);

  // UI state
  const [lastAction, setLastAction] = useState('');
  const [copyToastMessage, setCopyToastMessage] = useState('');
  const [symptomSearch, setSymptomSearch] = useState('');
  const [protocolSearch, setProtocolSearch] = useState('');
  const [navSlot, setNavSlot] = useState(null); // desktop context-bar node the active view portals into
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [insightsWindow, setInsightsWindow] = useState(60);


  // Flash column indicator

  // Manage symptoms/stack/inputs screens
  const [symptomEditMode, setSymptomEditMode] = useState(false);
  const [undoToast, setUndoToast] = useState(null);
  const [protocolEditMode, setProtocolEditMode] = useState(false);

  // Desktop mode
  const isDesktop = useDesktopMode();

  // Home is mobile-only. Rotating a tablet or widening a browser must not strand the user on a
  // screen desktop does not render. useLayoutEffect so a desktop cold load never paints a frame
  // with SymptomRows showing while DesktopToolbar still highlights Protocol.
  useLayoutEffect(() => {
    if (isDesktop && appMode === 'home') setAppMode('symptoms');
  }, [isDesktop, appMode]);

  // Home shows no date stepper, so it always means today: arriving on it from a day the user had
  // stepped back to on another tab snaps the date forward rather than logging to a hidden day.
  const onHome = !isDesktop && appMode === 'home' && !showInsights;
  useEffect(() => {
    if (onHome && getDateKey(selectedDate) !== getDateKey(new Date())) setSelectedDate(new Date());
  }, [onHome, selectedDate]);

  // One-shot: "Today's meals" sets it, MealList consumes it on its next mount. If the user
  // leaves Protocol before the timeout fires, clear it immediately instead of leaving it
  // armed for the next visit.
  useEffect(() => {
    if (!scrollToMeals) return;
    if (appMode !== 'stack') {
      setScrollToMeals(false);
      return;
    }
    const id = setTimeout(() => setScrollToMeals(false), 400);
    return () => clearTimeout(id);
  }, [scrollToMeals, appMode]);

  const garminSync = useGarminSync(firebase.user);

  // Refs
  const justLoggedRef = useRef(false);

  // Deferred entries: during rapid-fire entry, React defers re-renders of
  // components that use this value, keeping keyboard logging responsive.
  // Heavy components (SymptomRows, ProtocolRows, Insights, health score,
  // tab badges) use deferredEntries instead of entries.
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
          pinnedSymptoms: [...pinnedSymptoms], trackingMode, inputItems, inputEntries, meals,
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
      } else if (action === 'load-backup') {
        // Show a dedicated recovery modal with a giant tappable button — iOS
        // Safari blocks programmatic file-picker clicks, so we MUST wait for
        // a direct user gesture.
        setShowRecoveryModal(true);
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
  }, [appMode]);

  // Derived values
  const timePeriods = trackingModes[trackingMode].periods;

  // Soft-deleted items stay in state (and sync) until purged, but nothing renders them
  const liveSymptoms = useMemo(() => liveItems(symptoms), [symptoms]);
  const liveStackItems = useMemo(() => liveItems(stackItems), [stackItems]);
  const liveInputItems = useMemo(() => liveItems(inputItems), [inputItems]);

  const activeSymptoms = useMemo(() => {
    let active = liveSymptoms.filter(s => s.active);
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
  }, [liveSymptoms, symptomSearch, pinnedSymptoms]);

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

  const dismissUndoToast = useCallback(() => setUndoToast(null), []);

  // List keyboard entry is live only when nothing is layered over the list
  const listKeyboardEnabled = !showSettings && !showCalendar && !showExport && !showNoteModal
    && !showSymptomGraph && !showSupplementGraph && !showInsights;

  // Clear every symptom entry for the selected day; undoable from the toast
  const clearSymptomDay = () => {
    const { next, removed } = clearDay(entries, getDateKey(selectedDate));
    const count = Object.keys(removed).length;
    if (count === 0) return;
    setEntries(next);
    haptic('medium');
    setUndoToast({
      message: `Cleared ${count} ${count === 1 ? 'entry' : 'entries'} for ${formatDate(selectedDate)}`,
      onUndo: () => setEntries(prev => ({ ...removed, ...prev })),
    });
  };

  // Soft delete (90-day retention). kind: 'symptom' | 'supplement' | 'factor'
  const DOMAIN = {
    symptom: { setItems: setSymptoms, setEntries, idField: 'symptomId' },
    supplement: { setItems: setStackItems, setEntries: setStackEntries, idField: 'itemId' },
    factor: { setItems: setInputItems, setEntries: setInputEntries, idField: 'inputId' },
  };

  const softDeleteItem = (kind, item) => {
    const { setItems } = DOMAIN[kind];
    setItems(prev => prev.map(i => (i.id === item.id ? markDeleted(i) : i)));
    setUndoToast({
      message: `Deleted “${item.name}”. Restorable from Settings for 90 days`,
      onUndo: () => setItems(prev => prev.map(i => (i.id === item.id ? { ...i, deletedAt: null } : i))),
    });
  };

  const restoreDeletedItem = (kind, item) => {
    DOMAIN[kind].setItems(prev => prev.map(i => (i.id === item.id ? restoreDeleted(i) : i)));
    setLastAction(`Restored ${item.name}`);
  };

  const purgeItems = (kind, ids) => {
    if (ids.length === 0) return;
    const { setItems, setEntries: setDomainEntries, idField } = DOMAIN[kind];
    setItems(prev => prev.filter(i => !ids.includes(i.id)));
    setDomainEntries(prev => removeEntriesFor(prev, ids, idField));
  };

  const purgeItemNow = (kind, item) => {
    purgeItems(kind, [item.id]);
    setLastAction(`Deleted ${item.name} permanently`);
  };

  // Purge anything past retention once state is settled: signed-out, or signed-in with sync hydrated.
  // Never while auth is still resolving, so a half-loaded cache can't drive deletes.
  const purgeRanRef = useRef(false);
  useEffect(() => {
    if (purgeRanRef.current || firebase.authLoading) return;
    if (firebase.user && !sync.isReady) return;
    purgeRanRef.current = true;
    purgeItems('symptom', symptoms.filter(i => isExpired(i)).map(i => i.id));
    purgeItems('supplement', stackItems.filter(i => isExpired(i)).map(i => i.id));
    purgeItems('factor', inputItems.filter(i => isExpired(i)).map(i => i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebase.authLoading, firebase.user, sync.isReady]);

  // Protocol bulk actions: act immediately, undo restores the day exactly as it was
  const withProtocolUndo = (message, mutate) => {
    const dateKey = getDateKey(selectedDate);
    const stackSnapshot = clearDay(stackEntries, dateKey).removed;
    const inputSnapshot = clearDay(inputEntries, dateKey).removed;
    mutate(dateKey);
    setUndoToast({
      message,
      onUndo: () => {
        setStackEntries(prev => restoreDay(prev, dateKey, stackSnapshot));
        setInputEntries(prev => restoreDay(prev, dateKey, inputSnapshot));
      },
    });
  };

  const protocolCheckAll = () => withProtocolUndo('Checked all supplements due', (dateKey) => {
    const due = liveStackItems.filter(i => i.active && isScheduledForDate(i.schedule, selectedDate));
    setStackEntries(prev => {
      const next = { ...prev };
      due.forEach(item => {
        const key = `${dateKey}-${item.id}`;
        if (!next[key]) next[key] = { date: dateKey, itemId: item.id, dose: item.defaultDose, taken: true };
      });
      return next;
    });
    haptic('success');
  });

  const protocolClearDay = () => withProtocolUndo(`Cleared protocol for ${formatDate(selectedDate)}`, (dateKey) => {
    setStackEntries(prev => clearDay(prev, dateKey).next);
    setInputEntries(prev => clearDay(prev, dateKey).next);
    haptic('medium');
  });

  const protocolMatchYesterday = () => {
    const yesterday = new Date(selectedDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getDateKey(yesterday);
    const source = Object.values(clearDay(stackEntries, yesterdayKey).removed);
    if (source.length === 0) { setLastAction('No entries from yesterday'); return; }
    withProtocolUndo(`Matched ${formatDate(yesterday)}`, (dateKey) => {
      setStackEntries(prev => {
        const next = { ...prev };
        source.forEach(entry => {
          const item = liveStackItems.find(i => i.id === entry.itemId);
          if (item && item.active && isScheduledForDate(item.schedule, selectedDate)) {
            next[`${dateKey}-${item.id}`] = { date: dateKey, itemId: item.id, dose: entry.dose, taken: true };
          }
        });
        return next;
      });
      haptic('success');
    });
  };

  // Desktop keyboard shortcuts
  useEffect(() => {
    if (!isDesktop) return;
    const handleKeyDown = (e) => {
      // Don't fire when typing in inputs/textareas
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      // The symptom list owns 0-5 (rating) and, in AM/PM mode, the arrows (period).
      // Tabs stay reachable with Shift+1/2/3 and dates with [ and ] from anywhere.
      const listOwnsKeys = listKeyboardEnabled && appMode === 'symptoms' && !symptomEditMode;
      if (symptomEditMode || protocolEditMode) { if (e.key !== 'Escape') return; }
      if (listOwnsKeys && !e.shiftKey && /^[0-5]$/.test(e.key)) return;
      if (listOwnsKeys && trackingMode === 'ampm' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;

      const tabKey = e.shiftKey && /^Digit[123]$/.test(e.code) ? e.code.slice(-1) : e.key;
      if (/^[123]$/.test(tabKey)) setShowSettings(false);
      if (tabKey === '1') {
        setShowInsights(false);
        setAppMode('symptoms');
      } else if (tabKey === '2') {
        setShowInsights(false);
        setAppMode('protocol');
      } else if (tabKey === '3') {
        setShowInsights(true);
      } else if (e.key === 'ArrowLeft' || e.key === '[') {
        e.preventDefault();
        changeDate(-1);
      } else if (e.key === 'ArrowRight' || e.key === ']') {
        e.preventDefault();
        changeDate(1); // same guard as the toolbar arrows: stops at today
      } else if (e.key === 't' || e.key === 'T') {
        setSelectedDate(new Date());
      } else if (e.key === 'Escape') {
        // Close modals in priority order
        if (showSymptomGraph) setShowSymptomGraph(null);
        else if (showSupplementGraph) setShowSupplementGraph(null);
        else if (showSettings) setShowSettings(false);
        else if (showCalendar) setShowCalendar(false);
        else if (showExport) setShowExport(false);
        else if (showNoteModal) setShowNoteModal(false);
        else if (showInsights) setShowInsights(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDesktop, listKeyboardEnabled, appMode, symptomEditMode, trackingMode, showSettings, showCalendar, showExport, showNoteModal, showSymptomGraph, showSupplementGraph, showInsights]);

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

  // `note` undefined keeps whatever note the entry already has; a string replaces it ('' removes it)
  const quickLog = useCallback((symptomId, severity, timeOverride = null, note) => {
    const dateKey = getDateKey(selectedDate);
    const timeId = timeOverride || timePeriods[0].id;
    const key = `${dateKey}-${symptomId}-${timeId}`;

    justLoggedRef.current = true;

    setEntries(prev => {
      const text = (note === undefined ? prev[key]?.note : note)?.trim();
      return {
        ...prev,
        [key]: { time: timeId, severity, date: dateKey, symptomId, ...(text ? { note: text } : {}) }
      };
    });

    const symptom = symptoms.find(s => s.id === symptomId);
    const period = timePeriods.find(p => p.id === timeId);
    haptic('light');
    const severityLabel = severity === NA_SEVERITY ? 'N/A' : severity;
    setLastAction(`${symptom?.name}: ${severityLabel} (${period?.label || timeId})`);
  }, [selectedDate, timePeriods, symptoms]);

  // Talk mode: "make a note that I slept badly" goes on the end of the selected day's note
  const addDayNote = useCallback((text) => {
    const dateKey = getDateKey(selectedDate);
    setDailyNotes((prev) => {
      const existing = noteText(prev[dateKey]);
      return { ...prev, [dateKey]: { text: existing ? `${existing}\n${text}` : text } };
    });
  }, [selectedDate, setDailyNotes]);

  // A voice note always lands on today, keyed when it is saved (not when it was started)
  const saveVoiceNote = useCallback((text) => {
    const now = new Date();
    const dateKey = getDateKey(now);
    setDailyNotes((prev) => ({ ...prev, [dateKey]: { text: appendToNote(noteText(prev[dateKey]), text, now) } }));
    setShowVoiceNote(false);
    setCopyToastMessage("Saved to today's note");
    setTimeout(() => setCopyToastMessage(''), 2250);
  }, [setDailyNotes]);

  // Called from the launch tap itself: iOS only lets talk mode play audio if it starts inside a gesture
  const openTalkMode = useCallback(() => {
    // Only the engine in use: each one's priming touches the phone's audio session
    if (talkEngine === 'realtime') primeRemoteAudio();
    else primePlayback({ fresh: true });
    setTalkCost(null);
    // Deliberately does not touch appMode: every other caller is already on the Symptoms tab
    // (SymptomRows only renders there, and the overflow item only shows there), and forcing it
    // would throw a Home-screen user onto the dense list when the conversation ends.
    setShowInsights(false);
    setShowTalkMode(true);
  }, [talkEngine]);

  // The meal capture sheet reports a Date; the key is derived here rather than trusted from the
  // sheet, and derived OUTSIDE the setMeals updater — an updater must be pure, and mealKey() pulls
  // in a random suffix, so generating it inside would make the updater's result depend on how many
  // times React happens to invoke it (StrictMode invokes render-phase updaters twice).
  const saveMeal = useCallback(({ name, ingredients, at, source }) => {
    const existingKey = mealSheet?.key;
    const candidateKey = mealKey(at);
    // Editing keeps the original key so the record updates in place — unless the new time falls on
    // a different day, in which case the key must move with it: the day list filters by the key's
    // date and sync shards by its month, so an unchanged key would leave the meal filed (and
    // synced) under its old day.
    const sameDay = existingKey && mealDateKey(existingKey) === mealDateKey(candidateKey);
    const key = sameDay ? existingKey : candidateKey;
    setMeals((prev) => {
      const next = { ...prev };
      if (existingKey && existingKey !== key) delete next[existingKey];
      next[key] = { time: at.toISOString(), name, ingredients, source };
      return next;
    });
    haptic('light');
    setLastAction(name ? `Logged ${name}` : 'Meal logged');
  }, [mealSheet, setMeals, setLastAction]);

  const deleteMeal = useCallback((key) => {
    // Captured from the current `meals` state (closure), not from inside the setMeals updater —
    // an updater can run more than once (StrictMode double-invokes render-phase updaters), and
    // reading the about-to-be-removed record back out of `prev` there would race the undo toast,
    // which is built synchronously right after this call.
    const removed = meals[key];
    if (!removed) return;
    setMeals((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setUndoToast({
      message: 'Meal deleted',
      onUndo: () => setMeals((prev) => ({ ...prev, [key]: removed })),
    });
  }, [meals, setMeals]);

  const quickCopyData = useCallback(() => {
    const insights = getInsights(copyDays, entries, liveSymptoms);
    const data = generateAIDataExport(copyDays, entries, liveSymptoms, liveStackItems, stackEntries, dailyNotes, trackingMode, insights, liveInputItems, inputEntries);
    navigator.clipboard.writeText(data);
    setCopyToastMessage(`Copied ${copyDays} day${copyDays > 1 ? 's' : ''} of tracking for AI chat`);
    haptic('light');
    setTimeout(() => setCopyToastMessage(''), 2250);
  }, [copyDays, entries, liveSymptoms, liveStackItems, stackEntries, dailyNotes, trackingMode, liveInputItems, inputEntries]);

  const canGoForward = useMemo(() => {
    const tomorrow = new Date(selectedDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return tomorrow <= today;
  }, [selectedDate]);

  // Tab badge data — uses deferred entries to avoid blocking during fast logging
  const tabBadges = useMemo(() => {
    const dateKey = getDateKey(selectedDate);
    const todaySymptomEntries = Object.values(deferredEntries).filter(e => e.date === dateKey);
    const todayStackEntries = Object.values(deferredStackEntries).filter(e => e.date === dateKey);
    const activeStackCount = liveStackItems.filter(i => i.active).length;
    const activeSymptomCount = liveSymptoms.filter(s => s.active).length;

    const symptomStatus = todaySymptomEntries.length === 0 ? 'none'
      : todaySymptomEntries.length >= activeSymptomCount ? 'all' : 'some';
    const stackStatus = todayStackEntries.length === 0 ? 'none'
      : todayStackEntries.length >= activeStackCount ? 'all' : 'some';

    return {
      symptoms: { count: todaySymptomEntries.length, total: activeSymptomCount, status: symptomStatus },
      stack: { taken: todayStackEntries.length, total: activeStackCount, status: stackStatus },
    };
  }, [deferredEntries, deferredStackEntries, liveStackItems, liveSymptoms, selectedDate]);

  // Get symptom entries for a given symptom
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
    {/* Desktop is full-bleed so the nav rows run edge to edge; their contents and the page centre themselves */}
    <div
      style={{
        maxWidth: isDesktop ? 'none' : '500px',
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
      {/* Desktop Toolbar - replaces Header + BottomNav on desktop */}
      {isDesktop && (
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
          trackingMode={trackingMode}
          search={appMode === 'symptoms' ? symptomSearch : protocolSearch}
          setSearch={appMode === 'symptoms' ? setSymptomSearch : setProtocolSearch}
          slotRef={setNavSlot}
          symptoms={liveSymptoms}
          entries={deferredEntries}
          setCopyToastMessage={setCopyToastMessage}
          onEditNote={() => setShowNoteModal(true)}
          onCopyData={quickCopyData}
          copyDays={copyDays}
          onEditSymptoms={() => { setAppMode('symptoms'); setShowInsights(false); setSymptomEditMode(true); }}
          onCheckAll={protocolCheckAll}
          onClear={protocolClearDay}
          onMatchYesterday={protocolMatchYesterday}
          onEditProtocol={() => { setAppMode('stack'); setShowInsights(false); setProtocolEditMode(true); }}
          settingsOpen={showSettings}
          onCloseSettings={() => setShowSettings(false)}
          onOpenSettings={() => setShowSettings((open) => !open)}
        />
      )}

      {/* Mobile Header - hidden on desktop, and on Home, which is always today */}
      {!isDesktop && !onHome && (
        <Header
          selectedDate={selectedDate}
          changeDate={changeDate}
          canGoForward={canGoForward}
          setShowCalendar={setShowCalendar}
          setCalendarMonth={setCalendarMonth}
          symptoms={liveSymptoms}
          entries={deferredEntries}
          trackingMode={trackingMode}
          showInsights={showInsights}
          slotRef={setNavSlot}
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
            padding: '20px 24px',
            paddingBottom: '80px',
          }}>
            {showInsights ? (
              <Insights
                user={firebase.user}
                entries={deferredEntries}
                symptoms={liveSymptoms}
                stackItems={liveStackItems}
                stackEntries={deferredStackEntries}
                insightsWindow={insightsWindow}
                setInsightsWindow={setInsightsWindow}
                onOpenGraph={setShowSymptomGraph}
                onOpenSupplementGraph={setShowSupplementGraph}
                isDesktop={true}
                barSlot={navSlot}
                trackingMode={trackingMode}
                setStackItems={setStackItems}
              />
            ) : appMode === 'stack' ? (
              <ProtocolRows
                stackItems={liveStackItems}
                setStackItems={setStackItems}
                stackEntries={deferredStackEntries}
                setStackEntries={setStackEntries}
                inputItems={liveInputItems}
                setInputItems={setInputItems}
                inputEntries={inputEntries}
                setInputEntries={setInputEntries}
                selectedDate={selectedDate}
                setLastAction={setLastAction}
                search={protocolSearch}
                setSearch={setProtocolSearch}
                onOpenSupplementGraph={setShowSupplementGraph}
                onCheckAll={protocolCheckAll}
                onClearDay={protocolClearDay}
                onMatchYesterday={protocolMatchYesterday}
                onDeleteItem={(item, kind) => softDeleteItem(kind, item)}
                editing={protocolEditMode}
                setEditing={setProtocolEditMode}
                keyboardEnabled={listKeyboardEnabled}
                isDesktop={isDesktop}
                barSlot={navSlot}
                mealsSlot={(
                  <MealList
                    meals={meals}
                    dateKey={getDateKey(selectedDate)}
                    onOpen={(key) => setMealSheet({ key })}
                    onAdd={() => setMealSheet({})}
                  />
                )}
              />
            ) : (
              <SymptomRows
                symptoms={liveSymptoms}
                setSymptoms={setSymptoms}
                activeSymptoms={activeSymptoms}
                entries={deferredEntries}
                setEntries={setEntries}
                selectedDate={selectedDate}
                timePeriods={timePeriods}
                pinnedSymptoms={pinnedSymptoms}
                quickLog={quickLog}
                setLastAction={setLastAction}
                symptomSearch={symptomSearch}
                setSymptomSearch={setSymptomSearch}
                onOpenGraph={setShowSymptomGraph}
                onEditNote={() => setShowNoteModal(true)}
                onTalkMode={openTalkMode}
                onClearDay={clearSymptomDay}
                onDeleteSymptom={(symptom) => softDeleteItem('symptom', symptom)}
                editing={symptomEditMode}
                setEditing={setSymptomEditMode}
                keyboardEnabled={listKeyboardEnabled}
                isDesktop={isDesktop}
                barSlot={navSlot}
              />
            )}
          </div>
        </div>
      ) : appMode === 'home' && !showInsights ? (
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: '68px', // the dock pill's height plus its bottom margin; .hm's own 12px is the gap
        }}>
          <Home
            summary={summaryLines({
              entries: deferredEntries,
              meals,
              stackItems: liveStackItems,
              stackEntries: deferredStackEntries,
              date: selectedDate,
            })}
            onRapidEntry={() => setShowRapidEntry(true)}
            onTalkMode={() => openTalkMode()}
            onSymptomList={() => setAppMode('symptoms')}
            onPhotoMeal={() => setMealSheet({})}
            onTypeMeal={() => setMealSheet({ startManual: true })}
            onTodaysMeals={() => { setScrollToMeals(true); setAppMode('stack'); }}
            onMatchYesterday={() => protocolMatchYesterday()}
            onSimpleChecklist={() => setShowSimpleProtocol(true)}
            onProtocolDetail={() => setAppMode('stack')}
          />
        </div>
      ) : (
        /* Mobile: tab-switching layout */
        <div ref={scrollContainerRef} className="mn-main" style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingBottom: '110px',
          WebkitOverflowScrolling: 'touch',
        }}>
          <div style={{
            width: '100%',
          }}>
            {showInsights ? (
              <Insights
                user={firebase.user}
                entries={deferredEntries}
                symptoms={liveSymptoms}
                stackItems={liveStackItems}
                stackEntries={deferredStackEntries}
                insightsWindow={insightsWindow}
                setInsightsWindow={setInsightsWindow}
                onOpenGraph={setShowSymptomGraph}
                onOpenSupplementGraph={setShowSupplementGraph}
                barSlot={navSlot}
                trackingMode={trackingMode}
                setStackItems={setStackItems}
                focusSymptomId={insightsFocusSymptom}
              />
            ) : appMode === 'symptoms' ? (
              <SymptomRows
                symptoms={liveSymptoms}
                setSymptoms={setSymptoms}
                activeSymptoms={activeSymptoms}
                entries={deferredEntries}
                setEntries={setEntries}
                selectedDate={selectedDate}
                timePeriods={timePeriods}
                pinnedSymptoms={pinnedSymptoms}
                quickLog={quickLog}
                setLastAction={setLastAction}
                symptomSearch={symptomSearch}
                setSymptomSearch={setSymptomSearch}
                onOpenGraph={openSymptomInInsights}
                onEditNote={() => setShowNoteModal(true)}
                onTalkMode={openTalkMode}
                onClearDay={clearSymptomDay}
                onDeleteSymptom={(symptom) => softDeleteItem('symptom', symptom)}
                editing={symptomEditMode}
                setEditing={setSymptomEditMode}
                keyboardEnabled={listKeyboardEnabled}
                isDesktop={isDesktop}
                barSlot={navSlot}
              />
            ) : (
              <ProtocolRows
                stackItems={liveStackItems}
                setStackItems={setStackItems}
                stackEntries={deferredStackEntries}
                setStackEntries={setStackEntries}
                inputItems={liveInputItems}
                setInputItems={setInputItems}
                inputEntries={inputEntries}
                setInputEntries={setInputEntries}
                selectedDate={selectedDate}
                setLastAction={setLastAction}
                search={protocolSearch}
                setSearch={setProtocolSearch}
                onOpenSupplementGraph={setShowSupplementGraph}
                onCheckAll={protocolCheckAll}
                onClearDay={protocolClearDay}
                onMatchYesterday={protocolMatchYesterday}
                onDeleteItem={(item, kind) => softDeleteItem(kind, item)}
                editing={protocolEditMode}
                setEditing={setProtocolEditMode}
                keyboardEnabled={listKeyboardEnabled}
                isDesktop={isDesktop}
                barSlot={navSlot}
                mealsSlot={(
                  <MealList
                    meals={meals}
                    dateKey={getDateKey(selectedDate)}
                    scrollIntoViewOnMount={scrollToMeals}
                    onOpen={(key) => setMealSheet({ key })}
                    onAdd={() => setMealSheet({})}
                  />
                )}
              />
            )}
          </div>
        </div>
      )}

      {/* Rapid Entry */}
      {showRapidEntry && (
        <RapidEntry
          symptoms={activeSymptoms}
          entries={entries}
          setEntries={setEntries}
          selectedDate={selectedDate}
          trackingMode={trackingMode}
          timePeriods={timePeriods}
          quickLog={quickLog}
          setCopyToastMessage={setCopyToastMessage}
          fromHome={appMode === 'home'}
          onClose={() => setShowRapidEntry(false)}
        />
      )}

      {/* Simplified supplement checklist */}
      {showSimpleProtocol && (
        <SimpleProtocol
          stackItems={liveStackItems}
          stackEntries={stackEntries}
          setStackEntries={setStackEntries}
          selectedDate={selectedDate}
          onFullDetail={() => { setShowSimpleProtocol(false); setAppMode('stack'); }}
          onClose={() => setShowSimpleProtocol(false)}
        />
      )}

      {/* Talk mode */}
      {showTalkMode && (
        <TalkMode
          symptoms={activeSymptoms}
          entries={entries}
          selectedDate={selectedDate}
          trackingMode={trackingMode}
          timePeriods={timePeriods}
          quickLog={quickLog}
          addDayNote={addDayNote}
          engineKind={talkEngine}
          onCost={talkShowCost ? setTalkCost : undefined}
          setCopyToastMessage={setCopyToastMessage}
          fromHome={appMode === 'home'}
          onClose={() => setShowTalkMode(false)}
        />
      )}

      {/* Meal capture / review */}
      {mealSheet && (
        <MealCapture
          existing={mealSheet.key ? { key: mealSheet.key, ...meals[mealSheet.key] } : null}
          startManual={!!mealSheet.startManual}
          onSave={saveMeal}
          onDelete={deleteMeal}
          onClose={() => setMealSheet(null)}
        />
      )}

      {/* Voice note (Home dock) */}
      {showVoiceNote && (
        <VoiceNote
          onSave={saveVoiceNote}
          onClose={() => setShowVoiceNote(false)}
          onTypeInstead={() => { setShowVoiceNote(false); setShowNoteModal(true); }}
        />
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

      {/* Recovery modal — opened via ?action=load-backup URL. Big tappable
          button triggers the file picker via a direct user gesture (iOS Safari
          requires this for programmatic .click() on file inputs). */}
      {showRecoveryModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.85)',
          zIndex: 4000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}>
          <div style={{
            background: '#0f1115',
            border: '1px solid #334155',
            borderRadius: '14px',
            padding: '24px',
            maxWidth: '480px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}>
            <div style={{ color: '#f8fafc', fontSize: '20px', fontWeight: '700' }}>
              Restore from backup
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '14px', lineHeight: '1.5' }}>
              Tap the button below, then pick your backup JSON file from
              <b> Files → iCloud Drive → Downloads</b>. The merge is additive —
              your existing entries are kept, missing ones are restored.
            </div>
            <label
              htmlFor="recovery-file-input"
              style={{
                display: 'block',
                background: 'linear-gradient(135deg, #7c3aed, #6366f1)',
                border: 'none',
                borderRadius: '12px',
                padding: '18px 20px',
                color: '#fff',
                fontSize: '16px',
                fontWeight: '700',
                textAlign: 'center',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              Choose backup file
            </label>
            <input
              id="recovery-file-input"
              ref={recoveryFileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (e) => {
                  try {
                    const backup = JSON.parse(e.target.result);
                    const counts = { added: 0, kept: 0 };
                    if (backup.symptoms) setSymptoms(prev => {
                      const map = new Map(prev.map(s => [s.id, s]));
                      backup.symptoms.forEach(s => { if (!map.has(s.id)) { map.set(s.id, s); counts.added++; } else counts.kept++; });
                      return Array.from(map.values());
                    });
                    if (backup.entries) setEntries(prev => {
                      const m = { ...prev };
                      Object.entries(backup.entries).forEach(([k, v]) => { if (!m[k]) { m[k] = v; counts.added++; } else counts.kept++; });
                      return m;
                    });
                    if (backup.dailyNotes) setDailyNotes(prev => {
                      const m = { ...prev };
                      Object.entries(backup.dailyNotes).forEach(([k, v]) => { if (!m[k]) { m[k] = typeof v === 'string' ? { text: v } : v; counts.added++; } else counts.kept++; });
                      return m;
                    });
                    if (backup.stackItems) setStackItems(prev => {
                      const map = new Map(prev.map(s => [s.id, s]));
                      backup.stackItems.forEach(s => { if (!map.has(s.id)) { map.set(s.id, s); counts.added++; } else counts.kept++; });
                      return Array.from(map.values());
                    });
                    if (backup.stackEntries) setStackEntries(prev => {
                      const m = { ...prev };
                      Object.entries(backup.stackEntries).forEach(([k, v]) => { if (!m[k]) { m[k] = v; counts.added++; } else counts.kept++; });
                      return m;
                    });
                    if (backup.inputItems) setInputItems(prev => {
                      const map = new Map(prev.map(s => [s.id, s]));
                      backup.inputItems.forEach(s => { if (!map.has(s.id)) { map.set(s.id, s); counts.added++; } else counts.kept++; });
                      return Array.from(map.values());
                    });
                    if (backup.inputEntries) setInputEntries(prev => {
                      const m = { ...prev };
                      Object.entries(backup.inputEntries).forEach(([k, v]) => { if (!m[k]) { m[k] = v; counts.added++; } else counts.kept++; });
                      return m;
                    });
                    if (backup.meals) setMeals(prev => {
                      const { merged, added } = mergeBackupMeals(prev, backup.meals);
                      const total = (backup.meals && typeof backup.meals === 'object' && !Array.isArray(backup.meals))
                        ? Object.keys(backup.meals).length : 0;
                      counts.added += added;
                      counts.kept += total - added;
                      return merged;
                    });
                    if (backup.trackingMode) setTrackingMode(backup.trackingMode);
                    if (backup.pinnedSymptoms) setPinnedSymptoms(new Set(backup.pinnedSymptoms));
                    alert(`Restore complete.\n\nAdded: ${counts.added}\nAlready present: ${counts.kept}\n\nBackup exported: ${backup.exportedAt || '(unknown)'}\nApp version: ${backup.version || '(unknown)'}`);
                    setShowRecoveryModal(false);
                  } catch (err) {
                    alert(`Error: ${err.message}\n\nMake sure you selected a valid JSON backup file.`);
                  }
                };
                reader.onerror = () => alert('FileReader error: could not read the file.');
                reader.readAsText(file);
                event.target.value = '';
              }}
            />
            <button
              onClick={() => setShowRecoveryModal(false)}
              style={{
                background: 'transparent',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '10px',
                color: '#cbd5e1',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <div style={{ color: '#64748b', fontSize: '12px', lineHeight: '1.4' }}>
              Doesn't show your .json file? Tap "Browse" in the file picker and
              navigate manually. If the file is grayed out, your iCloud is
              still downloading it — wait a few seconds and try again.
            </div>
          </div>
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

      <UndoToast toast={undoToast} onDismiss={dismissUndoToast} isDesktop={isDesktop} />

      {talkCost && !showTalkMode && <TalkCostCard stats={talkCost} onDismiss={() => setTalkCost(null)} />}

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

      {/* Symptom Graph */}
      {showSymptomGraph && (
        <SymptomGraph
          primarySymptomId={showSymptomGraph}
          symptoms={liveSymptoms}
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
          stackItems={liveStackItems}
          stackEntries={deferredStackEntries}
          symptoms={liveSymptoms}
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
          onRestoreDeleted={restoreDeletedItem}
          onDeleteNow={purgeItemNow}
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
          meals={meals}
          setMeals={setMeals}
          copyDays={copyDays}
          setCopyDays={setCopyDays}
          talkEngine={talkEngine}
          setTalkEngine={setTalkEngine}
          talkShowCost={talkShowCost}
          setTalkShowCost={setTalkShowCost}
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
            meals,
          })}
          onForcePull={sync.forcePull}
        />
      )}

      {/* Export */}
      {showExport && (
        <Export
          entries={deferredEntries}
          symptoms={liveSymptoms}
          dailyNotes={dailyNotes}
          stackItems={liveStackItems}
          stackEntries={deferredStackEntries}
          trackingMode={trackingMode}
          inputItems={liveInputItems}
          inputEntries={inputEntries}
          setCopyToastMessage={setCopyToastMessage}
          onClose={() => setShowExport(false)}
          isDesktop={isDesktop}
        />
      )}

      {/* Bottom Navigation - mobile only, hide when in edit modes */}
      {!isDesktop && (
        <BottomNav
          appMode={appMode}
          setAppMode={setAppMode}
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
          onEditNote={() => setShowNoteModal(true)}
          onEditSymptoms={() => { setAppMode('symptoms'); setShowInsights(false); setSymptomEditMode(true); }}
          onClearSymptoms={clearSymptomDay}
          onRapidEntry={() => { setAppMode('symptoms'); setShowInsights(false); setShowRapidEntry(true); }}
          onTalkMode={openTalkMode}
          // Stack page actions
          onCheckAll={protocolCheckAll}
          onClear={protocolClearDay}
          onMatchYesterday={protocolMatchYesterday}
          onEditProtocol={() => { setAppMode('stack'); setShowInsights(false); setProtocolEditMode(true); }}
          onLogMeal={() => setMealSheet({})}
          onVoiceNote={() => setShowVoiceNote(true)}
          symptoms={liveSymptoms}
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
