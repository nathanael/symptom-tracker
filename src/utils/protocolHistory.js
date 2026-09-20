import { INPUT_CATEGORIES } from './constants';
import { isScheduledForDate, recordHistoryChange } from './helpers';
import { formatSchedule } from '../components/SchedulePicker';

// Apply a patch to a supplement, appending a history entry when tracked fields change
export const applySupplementPatch = (item, patch) => {
  const next = { ...item, ...patch };
  const historyEntry = recordHistoryChange(item, next);
  const history = item.history || [];
  next.history = historyEntry ? [...history, historyEntry] : history;
  return next;
};

const INPUT_FIELDS = ['name', 'description', 'category', 'verdict', 'active'];

// Apply a patch to an input ("other factor"); stamps verdictDate when the verdict changes
export const applyInputPatch = (item, patch) => {
  const next = { ...item, ...patch };
  const changes = {};
  for (const field of INPUT_FIELDS) {
    const from = item[field] ?? null;
    const to = next[field] ?? null;
    if (from !== to) changes[field] = { from: item[field], to: next[field] };
  }
  if (changes.verdict) next.verdictDate = new Date().toISOString();
  const history = item.history || [];
  next.history = Object.keys(changes).length > 0
    ? [...history, { timestamp: new Date().toISOString(), type: 'updated', changes }]
    : history;
  return next;
};

export const formatSupplementChange = (entry, unit = '') => {
  if (entry.type === 'created') return 'Created';
  if (entry.type !== 'updated' || !entry.changes) return 'Updated';
  const parts = [];
  Object.entries(entry.changes).forEach(([field, change]) => {
    if (field === 'active') parts.push(change.to ? 'Restored' : 'Hidden');
    else if (change.from === change.to) return;
    else if (field === 'defaultDose') parts.push(`Dose: ${change.from}${unit} → ${change.to}${unit}`);
    else if (field === 'name') parts.push(`Name: ${change.from} → ${change.to}`);
    else if (field === 'unit') parts.push(`Unit: ${change.from} → ${change.to}`);
    else if (field === 'description') parts.push('Description changed');
    else if (field === 'schedule') {
      const from = formatSchedule(change.from) || 'Daily';
      const to = formatSchedule(change.to) || 'Daily';
      if (from !== to) parts.push(`Schedule: ${from} → ${to}`);
    }
  });
  return parts.join(', ') || null;
};

export const formatInputChange = (entry) => {
  if (entry.type === 'created') return 'Created';
  if (entry.type !== 'updated' || !entry.changes) return 'Updated';
  const label = (id) => INPUT_CATEGORIES.find((c) => c.id === id)?.label || id;
  const parts = [];
  Object.entries(entry.changes).forEach(([field, change]) => {
    if (field === 'active') parts.push(change.to ? 'Restored' : 'Hidden');
    else if (field === 'name' && change.from !== change.to) parts.push(`Name: ${change.from} → ${change.to}`);
    else if (field === 'category' && change.from !== change.to) parts.push(`Category: ${label(change.from)} → ${label(change.to)}`);
    else if (field === 'description' && change.from !== change.to) parts.push('Description changed');
    else if (field === 'verdict' && (change.from || 'none') !== (change.to || 'none')) parts.push(`Verdict: ${change.from || 'none'} → ${change.to || 'none'}`);
  });
  return parts.join(', ') || null;
};

// Short label for the next scheduled day after `date` ("Tomorrow", "Sat", "Oct 3"); null if none within 60 days
export const nextDueLabel = (schedule, date) => {
  for (let i = 1; i <= 60; i++) {
    const d = new Date(date);
    d.setDate(d.getDate() + i);
    if (!isScheduledForDate(schedule, d)) continue;
    if (i === 1) return 'Tomorrow';
    if (i < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return null;
};
