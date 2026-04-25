import { trackingModes, severityColors, NA_SEVERITY } from './constants';
import { computeHealthScore } from './healthScore';

// Schedule Helpers
export const isScheduledForDate = (schedule, date) => {
  // Check startDate for all schedule types first
  // Use 'T00:00:00' suffix to parse as local time, not UTC
  if (schedule?.startDate) {
    const start = new Date(schedule.startDate + 'T00:00:00');
    start.setHours(0, 0, 0, 0);
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);
    if (target < start) return false;
  }

  if (!schedule || schedule.type === 'daily') return true;

  if (schedule.type === 'days') {
    return schedule.days?.includes(date.getDay()) ?? true;
  }

  if (schedule.type === 'interval') {
    const start = new Date(schedule.startDate + 'T00:00:00');
    start.setHours(0, 0, 0, 0);
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const diffDays = Math.round((targetDate - start) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays % schedule.interval === 0;
  }

  return true;
};

// History Tracking Helpers
export const createHistoryEntry = (item) => {
  return {
    timestamp: new Date().toISOString(),
    type: 'created',
    snapshot: {
      name: item.name,
      defaultDose: item.defaultDose,
      unit: item.unit,
      description: item.description || '',
      schedule: item.schedule,
      active: item.active
    }
  };
};

// Normalize schedule to only include relevant fields for its type
const normalizeSchedule = (schedule) => {
  if (!schedule) return { type: 'daily' };

  const base = { type: schedule.type || 'daily' };

  if (base.type === 'daily') {
    // Daily schedules only need type and optionally startDate
    if (schedule.startDate) base.startDate = schedule.startDate;
  } else if (base.type === 'days') {
    // Days schedules need type, days array, and optionally startDate
    base.days = schedule.days || [];
    if (schedule.startDate) base.startDate = schedule.startDate;
  } else if (base.type === 'interval') {
    // Interval schedules need type, interval, and startDate
    base.interval = schedule.interval || 2;
    if (schedule.startDate) base.startDate = schedule.startDate;
  }

  return base;
};

export const recordHistoryChange = (item, newValues) => {
  const changes = {};
  const fields = ['name', 'defaultDose', 'unit', 'description', 'schedule', 'active'];

  for (const field of fields) {
    let oldVal = item[field];
    let newVal = newValues[field];

    // Normalize schedules before comparison
    if (field === 'schedule') {
      oldVal = normalizeSchedule(oldVal);
      newVal = normalizeSchedule(newVal);
    }

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[field] = { from: item[field], to: newValues[field] };
    }
  }

  if (Object.keys(changes).length === 0) return null;

  return {
    timestamp: new Date().toISOString(),
    type: 'updated',
    changes
  };
};

// Reconstruct supplement state at a specific history entry
export const reconstructStateAtEntry = (historyArray, targetIndex) => {
  const createdEntry = historyArray.find(h => h.type === 'created');
  if (!createdEntry) return null;

  let state = { ...createdEntry.snapshot };

  for (let i = 0; i <= targetIndex; i++) {
    const entry = historyArray[i];
    if (entry.type === 'updated' && entry.changes) {
      Object.entries(entry.changes).forEach(([field, change]) => {
        state[field] = change.to;
      });
    }
  }
  return state;
};

// Reconstruct supplement state as it was on a given date
export const reconstructStateAtDate = (historyArray, dateStr) => {
  if (!historyArray || historyArray.length === 0) return null;
  const createdEntry = historyArray.find(h => h.type === 'created');
  if (!createdEntry) return null;

  // Target is end of the given date
  const targetEnd = new Date(dateStr + 'T23:59:59.999Z');

  let state = { ...createdEntry.snapshot };

  for (const entry of historyArray) {
    if (entry.type === 'updated' && entry.changes) {
      const entryTime = new Date(entry.timestamp);
      if (entryTime <= targetEnd) {
        Object.entries(entry.changes).forEach(([field, change]) => {
          state[field] = change.to;
        });
      }
    }
  }
  return state;
};

// Apply historical state to a supplement item for display on a given date.
// For today, returns the item unchanged. For past dates, overlays historical
// name, dose, unit, description, schedule, and active status.
// Items with no history (legacy) are returned unchanged.
export const applyHistoricalState = (item, selectedDate) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(selectedDate);
  target.setHours(0, 0, 0, 0);

  if (target >= today) return item;

  if (!item.history || item.history.length === 0) return item;

  const dateStr = target.toISOString().split('T')[0];
  const historical = reconstructStateAtDate(item.history, dateStr);
  if (!historical) return item;

  return {
    ...item,
    name: historical.name,
    description: historical.description,
    unit: historical.unit,
    defaultDose: historical.defaultDose,
    schedule: historical.schedule,
    active: historical.active
  };
};

// Format timestamp as relative time
export const formatRelativeTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  // For older dates, show formatted date
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

// Date Helpers - uses LOCAL time, not UTC
export const getDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const formatDate = (date) => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
};

export const formatTableDate = (dateStr) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit'
  });
};

// Time Period Helpers
export const getCurrentTimePeriod = (trackingMode) => {
  if (trackingMode !== 'ampm') return 'daily';
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : 'evening';
};

// Environment Detection
export const isMobile = () => {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
};

export const isStandalone = () => {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true ||
         document.referrer.includes('android-app://');
};

// Haptic Feedback
export const haptic = (type = 'light') => {
  if (!navigator.vibrate) return;
  switch (type) {
    case 'light':
      navigator.vibrate(10);
      break;
    case 'medium':
      navigator.vibrate(20);
      break;
    case 'heavy':
      navigator.vibrate([30, 10, 30]);
      break;
    case 'success':
      navigator.vibrate([10, 30, 10]);
      break;
    default:
      navigator.vibrate(10);
  }
};

// Data Export Helpers
export const generateAIDataExport = (days, entries, symptoms, stackItems, stackEntries, dailyNotes, trackingMode, insights = null, inputItems = [], inputEntries = {}) => {
  const today = new Date();
  const timePeriods = trackingModes[trackingMode].periods;
  let output = [];

  // AI-friendly intro framing
  output.push(`I've been tracking my health symptoms. Here is the data.\n`);

  // Header
  output.push(`## Symptom Tracking (last ${days} days)`);
  output.push(`Generated: ${today.toLocaleDateString()}\n`);

  // Health Score section
  output.push('## Health Score');
  output.push('Daily score (0-100, higher is better) computed as 100 − (avg severity / 5 × 100) across logged active symptoms. Days with no logged symptoms are blank.\n');
  output.push('| Date | Score |');
  output.push('| ---- | ----- |');
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = getDateKey(date);
    const { score } = computeHealthScore(symptoms, entries, dateKey, trackingMode);
    output.push(`| ${dateKey} | ${score == null ? '' : score} |`);
  }
  output.push('');

  // Symptoms table
  output.push('### Symptoms');
  output.push('Scale: 0 (none) to 5 (extreme). "-" = not recorded. "N/A" = not applicable.\n');
  const headers = ['Date', ...timePeriods.map(p => p.label)];

  // Get symptom data for each symptom
  const activeSymptoms = symptoms.filter(s => s.active);

  activeSymptoms.forEach(symptom => {
    const desc = symptom.description ? ` — ${symptom.description}` : '';
    output.push(`\n### ${symptom.name}${desc}`);
    output.push('| ' + headers.join(' | ') + ' |');
    output.push('| ' + headers.map(() => '---').join(' | ') + ' |');

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = getDateKey(date);

      const row = [formatTableDate(dateKey)];
      timePeriods.forEach(period => {
        const entry = entries[`${dateKey}-${symptom.id}-${period.id}`];
        if (entry) {
          row.push(entry.severity === NA_SEVERITY ? 'N/A' : entry.severity.toString());
        } else if (symptom.applicablePeriods && !symptom.applicablePeriods.includes(period.id)) {
          row.push('N/A');
        } else {
          row.push('-');
        }
      });

      output.push('| ' + row.join(' | ') + ' |');
    }
  });

  // Supplement list with descriptions
  const activeSupplements = stackItems.filter(s => s.active);
  if (activeSupplements.length > 0) {
    output.push('\n### Supplements');
    activeSupplements.forEach(item => {
      const desc = item.description ? ` — ${item.description}` : '';
      output.push(`- ${item.name} (${item.defaultDose}${item.unit})${desc}`);
    });
  }

  // Stack summary - include ALL items with entries, regardless of active state
  output.push('\n### Supplements Taken');

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = getDateKey(date);

    // Find ALL entries for this date, regardless of active state
    const takenItems = Object.entries(stackEntries)
      .filter(([key, entry]) => key.startsWith(dateKey) && entry.taken)
      .map(([key, entry]) => {
        const item = stackItems.find(i => i.id === entry.itemId);
        return item ? `${item.name} (${entry.dose}${item.unit})` : null;
      })
      .filter(Boolean);

    if (takenItems.length > 0) {
      output.push(`\n**${formatTableDate(dateKey)}**: ${takenItems.join(', ')}`);
    }
  }

  // Inputs section
  if (inputItems.length > 0) {
    output.push('\n### Inputs Tracked');
    const activeInputs = inputItems.filter(i => i.active);
    if (activeInputs.length > 0) {
      activeInputs.forEach(item => {
        const verdict = item.verdict ? ` [${item.verdict}]` : '';
        const desc = item.description ? ` — ${item.description}` : '';
        output.push(`- ${item.name} (${item.category})${verdict}${desc}`);
      });
    }

    output.push('\n### Input Log');
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = getDateKey(date);

      const loggedInputs = Object.entries(inputEntries)
        .filter(([key, entry]) => key.startsWith(dateKey) && entry.logged)
        .map(([key, entry]) => {
          const item = inputItems.find(it => it.id === entry.inputId);
          if (!item) return null;
          const count = entry.count || 1;
          return count > 1 ? `${item.name} (x${count})` : item.name;
        })
        .filter(Boolean);

      if (loggedInputs.length > 0) {
        output.push(`\n**${formatTableDate(dateKey)}**: ${loggedInputs.join(', ')}`);
      }
    }
  }

  // Notes
  output.push('\n### Daily Notes');
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateKey = getDateKey(date);
    const note = dailyNotes[dateKey];

    if (note && note.trim()) {
      output.push(`- ${formatTableDate(dateKey)}: ${note}`);
    }
  }

  // Detected patterns section (if insights provided)
  if (insights && insights.hasEnoughData && insights.insights && insights.insights.length > 0) {
    output.push('\n## Patterns Already Detected');
    insights.insights.forEach(insight => {
      const direction = insight.direction === 'improving' ? 'improved' : 'worsened';
      output.push(`- ${insight.name}: ${direction} ${insight.percentChange}% (avg ${insight.firstAvg} → ${insight.secondAvg})`);
    });
  }

  // Suggested questions for AI
  output.push('\n## Questions to explore');
  output.push('1. What patterns do you notice in my symptoms?');
  output.push('2. Which symptoms seem to correlate with each other?');
  output.push('3. Do my supplements appear to affect any symptoms?');
  if (inputItems.length > 0) {
    output.push('4. Do any of my inputs (foods, substances, activities) correlate with symptom changes?');
    output.push('5. What questions should I ask my doctor based on this data?');
  } else {
    output.push('4. What questions should I ask my doctor based on this data?');
  }

  return output.join('\n');
};

// Sample Data Generators
export const generateSampleData = (symptoms, mode = 'ampm') => {
  const entries = {};
  const today = new Date();
  const periods = trackingModes[mode].periods;

  const clusters = {
    fatigue: ['daytime-fatigue', 'brain-fog', 'air-hunger-am', 'air-hunger-pm'],
    anxiety: ['anxiety-mental', 'anxiety-physical', 'irritability', 'social-withdrawal'],
    digestive: ['heartburn', 'diarrhea', 'skinny-stool', 'farting-burping', 'oral-thrush'],
    urinary: ['urinary-urgency', 'pee-dribble', 'penile-retraction'],
    pain: ['headache', 'nerve-pain', 'fascial-tightness'],
  };

  const monthlyTrends = {
    'headache': [1.5, 1.3, 1.2, 1.0, 0.8, 0.7],
    'brain-fog': [1.4, 1.3, 1.1, 1.0, 0.9, 0.8],
    'heartburn': [1.2, 1.0, 0.8, 1.0, 1.2, 1.0],
    'daytime-fatigue': [1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
    'psoriasis': [0.5, 0.6, 0.8, 1.0, 1.2, 1.3],
    'irritability': [0.7, 0.8, 0.9, 1.0, 1.1, 1.2],
    'anxiety-mental': [1.3, 1.2, 1.1, 1.0, 0.9, 0.8],
    'diarrhea': [1.0, 1.1, 0.9, 1.0, 0.8, 1.2],
  };

  const weekendEffect = {
    'headache': [1.2, 1.1, 0.9, 0.9, 0.9, 1.0, 1.1],
    'anxiety-mental': [0.8, 1.2, 1.1, 1.0, 1.0, 0.9, 0.8],
  };

  for (let daysAgo = 0; daysAgo < 180; daysAgo++) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const dateKey = date.toISOString().split('T')[0];
    const monthsAgo = Math.floor(daysAgo / 30);
    const dayOfWeek = date.getDay();

    if (Math.random() < 0.85) {
      let selectedSymptomIds = [];
      const activeSymptoms = symptoms.filter(s => s.active);

      if (Math.random() < 0.4) {
        const clusterNames = Object.keys(clusters);
        const cluster = clusters[clusterNames[Math.floor(Math.random() * clusterNames.length)]];
        const clusterSymptoms = cluster.filter(id =>
          activeSymptoms.some(s => s.id === id)
        );
        if (clusterSymptoms.length > 0) {
          const numFromCluster = Math.min(clusterSymptoms.length, Math.floor(Math.random() * 2) + 1);
          selectedSymptomIds = clusterSymptoms.slice(0, numFromCluster);
        }
      }

      const numAdditional = Math.floor(Math.random() * 2) + 1;
      const otherSymptoms = activeSymptoms
        .filter(s => !selectedSymptomIds.includes(s.id))
        .sort(() => Math.random() - 0.5)
        .slice(0, numAdditional)
        .map(s => s.id);

      selectedSymptomIds = [...selectedSymptomIds, ...otherSymptoms];

      selectedSymptomIds.forEach(symptomId => {
        const numPeriods = mode === 'simple' ? 1 : (Math.random() < 0.7 ? 1 : 2);
        const shuffledPeriods = [...periods].sort(() => Math.random() - 0.5).slice(0, numPeriods);

        shuffledPeriods.forEach(period => {
          let baseSeverity = Math.floor(Math.random() * 4) + 1;

          const trend = monthlyTrends[symptomId];
          if (trend && monthsAgo < trend.length) {
            baseSeverity = Math.round(baseSeverity * trend[monthsAgo]);
          }

          const weekPattern = weekendEffect[symptomId];
          if (weekPattern) {
            baseSeverity = Math.round(baseSeverity * weekPattern[dayOfWeek]);
          }

          if (period.id === 'morning' && ['headache', 'air-hunger-am'].includes(symptomId)) {
            baseSeverity = Math.min(5, baseSeverity + 1);
          }

          const key = `${dateKey}-${symptomId}-${period.id}`;
          entries[key] = {
            time: period.id,
            severity: Math.min(5, Math.max(1, baseSeverity)),
            date: dateKey,
            symptomId: symptomId
          };
        });
      });
    }
  }

  return entries;
};

export const generateSampleStackData = (items) => {
  const entries = {};
  const today = new Date();

  for (let daysAgo = 0; daysAgo < 180; daysAgo++) {
    const date = new Date(today);
    date.setDate(date.getDate() - daysAgo);
    const dateKey = date.toISOString().split('T')[0];

    if (Math.random() < 0.9) {
      items.filter(item => item.active).forEach(item => {
        if (Math.random() < 0.85) {
          const key = `${dateKey}-${item.id}`;
          let dose = item.defaultDose;
          if (Math.random() < 0.1) {
            dose = Math.round(dose * (0.5 + Math.random()));
          }
          entries[key] = {
            date: dateKey,
            itemId: item.id,
            dose: dose,
            taken: true
          };
        }
      });
    }
  }

  return entries;
};

// Insights Calculation
export const getInsights = (windowDays, entries, symptoms) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDaysNeeded = Math.ceil(windowDays * 0.5);

  // Get all entries in window (exclude N/A entries)
  const windowEntries = Object.values(entries).filter(e => {
    if (e.severity === NA_SEVERITY) return false;
    const entryDate = new Date(e.date);
    const daysAgo = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
    return daysAgo >= 0 && daysAgo <= windowDays;
  });

  const daysOfData = new Set(windowEntries.map(e => e.date)).size;
  const entriesCount = windowEntries.length;

  if (daysOfData < minDaysNeeded || entriesCount < 20) {
    return {
      hasEnoughData: false,
      daysOfData,
      entriesCount,
      minDaysNeeded,
      insights: [],
      topCluster: null,
      aiPrompt: '',
    };
  }

  // Calculate trends for each symptom
  const insights = [];

  symptoms.filter(s => s.active).forEach(symptom => {
    const symptomEntries = windowEntries.filter(e => e.symptomId === symptom.id);
    if (symptomEntries.length < 5) return;

    // This week entries (last 7 days)
    const thisWeekEntries = symptomEntries.filter(e => {
      const daysAgo = Math.floor((today - new Date(e.date)) / (1000 * 60 * 60 * 24));
      return daysAgo >= 0 && daysAgo < 7;
    });

    // Previous entries (rest of window, excluding this week)
    const previousEntries = symptomEntries.filter(e => {
      const daysAgo = Math.floor((today - new Date(e.date)) / (1000 * 60 * 60 * 24));
      return daysAgo >= 7;
    });

    // Need at least 3 entries in each period for meaningful comparison
    if (thisWeekEntries.length < 3 || previousEntries.length < 3) return;

    // Calculate averages - compare this week to PREVIOUS period (not including this week)
    const thisWeekAvg = thisWeekEntries.reduce((sum, e) => sum + e.severity, 0) / thisWeekEntries.length;
    const previousAvg = previousEntries.reduce((sum, e) => sum + e.severity, 0) / previousEntries.length;

    // Absolute change (positive = improving, negative = worsening)
    const absoluteChange = previousAvg - thisWeekAvg;

    // Skip if change is too small (< 0.3 pts)
    if (Math.abs(absoluteChange) < 0.3) return;

    // Frequency: unique days this week with this symptom
    const daysThisWeek = new Set(thisWeekEntries.map(e => e.date)).size;

    // Best and worst days (across entire window)
    const sortedBySeverity = [...symptomEntries].sort((a, b) => a.severity - b.severity);
    const bestEntry = sortedBySeverity[0];
    const worstEntry = sortedBySeverity[sortedBySeverity.length - 1];

    // Calculate streak from most recent day backwards
    const streak = calculateStreak(symptomEntries, today);

    // Build chart data from all symptom entries, sorted by date
    const chartData = symptomEntries
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(e => ({ date: e.date, severity: e.severity }));

    insights.push({
      symptomId: symptom.id,
      name: symptom.name,
      direction: absoluteChange > 0 ? 'improving' : 'worsening',
      absoluteChange: Math.round(Math.abs(absoluteChange) * 10) / 10,
      thisWeekAvg: Math.round(thisWeekAvg * 10) / 10,
      previousAvg: Math.round(previousAvg * 10) / 10,
      daysThisWeek,
      bestDay: {
        severity: bestEntry.severity,
        date: bestEntry.date,
      },
      worstDay: {
        severity: worstEntry.severity,
        date: worstEntry.date,
      },
      streak,
      chartData,
      entryCount: symptomEntries.length,
    });
  });

  // Sort by magnitude of absolute change
  insights.sort((a, b) => b.absoluteChange - a.absoluteChange);

  return {
    hasEnoughData: true,
    daysOfData,
    entriesCount,
    minDaysNeeded,
    insights: insights.slice(0, 5),
    topCluster: null, // Could add cluster detection here
    aiPrompt: '', // Will be generated separately
  };
};

// Calculate streak of good or bad days from most recent backwards
const calculateStreak = (symptomEntries, today) => {
  // Group entries by date and get average severity per day
  const dailyAvg = {};
  symptomEntries.forEach(e => {
    if (!dailyAvg[e.date]) {
      dailyAvg[e.date] = { sum: 0, count: 0 };
    }
    dailyAvg[e.date].sum += e.severity;
    dailyAvg[e.date].count += 1;
  });

  // Convert to sorted array of { date, avg } from most recent
  const days = Object.entries(dailyAvg)
    .map(([date, data]) => ({
      date,
      avg: data.sum / data.count,
    }))
    .sort((a, b) => b.date.localeCompare(a.date)); // Most recent first

  if (days.length === 0) {
    return { type: 'none', days: 0 };
  }

  // Determine type based on first (most recent) day
  const firstDayAvg = days[0].avg;
  let streakType;
  if (firstDayAvg <= 2) {
    streakType = 'good';
  } else if (firstDayAvg >= 4) {
    streakType = 'bad';
  } else {
    return { type: 'none', days: 0 };
  }

  // Count consecutive days of same type
  let streakDays = 0;
  for (const day of days) {
    const isGood = day.avg <= 2;
    const isBad = day.avg >= 4;

    if (streakType === 'good' && isGood) {
      streakDays++;
    } else if (streakType === 'bad' && isBad) {
      streakDays++;
    } else {
      break;
    }
  }

  // Need at least 2 days for a streak
  if (streakDays < 2) {
    return { type: 'none', days: 0 };
  }

  return { type: streakType, days: streakDays };
};

// Symptom Trend Indicator
export const getSymptomTrend = (symptomId, entries, windowDays = 7) => {
  const now = new Date();
  const midpoint = Math.floor(windowDays / 2);

  // Collect entries for this symptom in the window
  let recentEntries = [];  // last 3-4 days
  let olderEntries = [];   // previous 3-4 days

  for (let i = 0; i < windowDays; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateKey = getDateKey(d);

    // Find entries for this date/symptom (exclude N/A)
    Object.entries(entries).forEach(([key, entry]) => {
      if (key.includes(dateKey) && key.includes(symptomId) && entry.severity !== NA_SEVERITY) {
        if (i < midpoint) {
          recentEntries.push(entry.severity);
        } else {
          olderEntries.push(entry.severity);
        }
      }
    });
  }

  // Need minimum data (at least 1 entry in each half)
  if (recentEntries.length < 1 || olderEntries.length < 1) return 'stable';

  const recentAvg = recentEntries.reduce((a, b) => a + b, 0) / recentEntries.length;
  const olderAvg = olderEntries.reduce((a, b) => a + b, 0) / olderEntries.length;

  // Avoid division by zero
  if (olderAvg === 0) return recentAvg > 0.5 ? 'worsening' : 'stable';

  const percentChange = ((recentAvg - olderAvg) / olderAvg) * 100;

  if (percentChange <= -20) return 'improving';  // severity decreased
  if (percentChange >= 20) return 'worsening';   // severity increased
  return 'stable';
};

// CSV Export
export const buildCSVText = (days, entries, symptoms, trackingMode) => {
  const today = new Date();
  const timePeriods = trackingModes[trackingMode].periods;

  const lines = [];
  lines.push('# health_score: 0-100, higher is better. Computed as 100 - (avg severity / 5 * 100) across logged active symptoms; blank if no symptoms logged that day.');
  lines.push('Date,Symptom,Time Period,Severity');

  // Existing entries
  Object.values(entries)
    .filter(e => {
      const entryDate = new Date(e.date);
      const daysAgo = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
      return daysAgo <= days;
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach(entry => {
      const symptom = symptoms.find(s => s.id === entry.symptomId);
      const period = timePeriods.find(p => p.id === entry.time);
      const severityVal = entry.severity === NA_SEVERITY ? 'N/A' : entry.severity;
      lines.push(`${entry.date},"${symptom?.name || entry.symptomId}",${period?.label || entry.time},${severityVal}`);
    });

  // Health score rows
  // NOTE: Health Score rows reuse the existing Symptom/Severity columns with Symptom="Health Score".
  // Score scale is 0-100 (not 0-5 like severity). Consumers averaging the Severity column should filter
  // out rows where Symptom="Health Score". The leading "# health_score:" comment documents this for humans.
  for (let i = 0; i <= days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = getDateKey(d);
    const { score } = computeHealthScore(symptoms, entries, dateKey, trackingMode);
    if (score != null) {
      lines.push(`${dateKey},"Health Score",daily,${score}`);
    }
  }

  return lines.join('\n') + '\n';
};

export const exportCSV = (days, entries, symptoms, trackingMode) => {
  const csv = buildCSVText(days, entries, symptoms, trackingMode);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `symptoms-${days}days-${getDateKey(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Supplement Adherence Helpers

/**
 * Get supplement adherence data for a given item over N days.
 * Schedule-aware: only counts days where the supplement was scheduled.
 */
export const getSupplementAdherence = (itemId, stackEntries, stackItems, days) => {
  const item = stackItems.find(i => i.id === itemId);
  if (!item) return { rate: 0, taken: 0, scheduled: 0 };

  const today = new Date();
  let taken = 0;
  let scheduled = 0;

  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = getDateKey(d);

    if (!isScheduledForDate(item.schedule, d)) continue;
    scheduled++;

    const entryKey = `${dateKey}-${itemId}`;
    if (stackEntries[entryKey]?.taken) taken++;
  }

  return {
    rate: scheduled > 0 ? Math.round((taken / scheduled) * 100) : 0,
    taken,
    scheduled,
  };
};

/**
 * Get current streak for a supplement (consecutive taken or missed days).
 * Looks backwards from today, only counting scheduled days.
 */
export const getSupplementStreak = (itemId, stackEntries, stackItems) => {
  const item = stackItems.find(i => i.id === itemId);
  if (!item) return { type: 'taken', days: 0 };

  const today = new Date();
  let streakType = null;
  let streakDays = 0;

  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = getDateKey(d);

    if (!isScheduledForDate(item.schedule, d)) continue;

    const entryKey = `${dateKey}-${itemId}`;
    const wasTaken = !!stackEntries[entryKey]?.taken;

    if (streakType === null) {
      streakType = wasTaken ? 'taken' : 'missed';
      streakDays = 1;
    } else if ((wasTaken && streakType === 'taken') || (!wasTaken && streakType === 'missed')) {
      streakDays++;
    } else {
      break;
    }
  }

  return { type: streakType || 'taken', days: streakDays };
};
