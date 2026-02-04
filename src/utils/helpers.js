import { trackingModes, severityColors } from './constants';

// Schedule Helpers
export const isScheduledForDate = (schedule, date) => {
  // Check startDate for all schedule types first
  if (schedule?.startDate) {
    const start = new Date(schedule.startDate);
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
    const start = new Date(schedule.startDate);
    start.setHours(0, 0, 0, 0);
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((targetDate - start) / (1000 * 60 * 60 * 24));
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

export const recordHistoryChange = (item, newValues) => {
  const changes = {};
  const fields = ['name', 'defaultDose', 'unit', 'description', 'schedule', 'active'];

  for (const field of fields) {
    if (JSON.stringify(item[field]) !== JSON.stringify(newValues[field])) {
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
export const generateAIDataExport = (days, entries, symptoms, stackItems, stackEntries, dailyNotes, trackingMode, insights = null) => {
  const today = new Date();
  const timePeriods = trackingModes[trackingMode].periods;
  let output = [];

  // AI-friendly intro framing
  output.push(`I've been tracking my health symptoms. Please analyze this data and help me understand patterns. Focus on pattern recognition, not medical advice.\n`);

  // Header
  output.push(`## Symptom Tracking (last ${days} days)`);
  output.push(`Generated: ${today.toLocaleDateString()}\n`);

  // Symptoms table
  output.push('### Symptoms');
  const headers = ['Date', ...timePeriods.map(p => p.label)];

  // Get symptom data for each symptom
  const activeSymptoms = symptoms.filter(s => s.active);

  activeSymptoms.forEach(symptom => {
    output.push(`\n### ${symptom.name}`);
    output.push('| ' + headers.join(' | ') + ' |');
    output.push('| ' + headers.map(() => '---').join(' | ') + ' |');

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = getDateKey(date);

      const row = [formatTableDate(dateKey)];
      timePeriods.forEach(period => {
        const entry = entries[`${dateKey}-${symptom.id}-${period.id}`];
        row.push(entry ? entry.severity.toString() : '-');
      });

      output.push('| ' + row.join(' | ') + ' |');
    }
  });

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
  output.push('4. What questions should I ask my doctor based on this data?');

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
  const minDaysNeeded = Math.ceil(windowDays * 0.5);

  // Get all entries in window
  const windowEntries = Object.values(entries).filter(e => {
    const entryDate = new Date(e.date);
    const daysAgo = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
    return daysAgo <= windowDays;
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
  const halfWindow = Math.floor(windowDays / 2);
  const insights = [];

  symptoms.filter(s => s.active).forEach(symptom => {
    const symptomEntries = windowEntries.filter(e => e.symptomId === symptom.id);
    if (symptomEntries.length < 5) return;

    const firstHalf = symptomEntries.filter(e => {
      const daysAgo = Math.floor((today - new Date(e.date)) / (1000 * 60 * 60 * 24));
      return daysAgo > halfWindow;
    });

    const secondHalf = symptomEntries.filter(e => {
      const daysAgo = Math.floor((today - new Date(e.date)) / (1000 * 60 * 60 * 24));
      return daysAgo <= halfWindow;
    });

    if (firstHalf.length < 3 || secondHalf.length < 3) return;

    const firstAvg = firstHalf.reduce((sum, e) => sum + e.severity, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, e) => sum + e.severity, 0) / secondHalf.length;

    const change = secondAvg - firstAvg;
    const percentChange = Math.round((change / Math.max(firstAvg, 0.5)) * 100);

    if (Math.abs(percentChange) >= 20) {
      // Build chart data from all symptom entries, sorted by date
      const chartData = symptomEntries
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(e => ({ date: e.date, severity: e.severity }));

      insights.push({
        symptomId: symptom.id,
        name: symptom.name,
        direction: change < 0 ? 'improving' : 'worsening',
        percentChange: Math.abs(percentChange),
        firstAvg: Math.round(firstAvg * 10) / 10,
        secondAvg: Math.round(secondAvg * 10) / 10,
        chartData,
        entryCount: symptomEntries.length,
      });
    }
  });

  // Sort by magnitude of change
  insights.sort((a, b) => b.percentChange - a.percentChange);

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

    // Find entries for this date/symptom
    Object.entries(entries).forEach(([key, entry]) => {
      if (key.includes(dateKey) && key.includes(symptomId)) {
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
export const exportCSV = (days, entries, symptoms, trackingMode) => {
  const today = new Date();
  const timePeriods = trackingModes[trackingMode].periods;

  let csv = 'Date,Symptom,Time Period,Severity\n';

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
      csv += `${entry.date},"${symptom?.name || entry.symptomId}",${period?.label || entry.time},${entry.severity}\n`;
    });

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
