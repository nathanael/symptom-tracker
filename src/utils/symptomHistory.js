// Change-history helpers for symptoms (created snapshot + field diffs)

export const createSymptomHistoryEntry = (symptom) => ({
  timestamp: new Date().toISOString(),
  type: 'created',
  snapshot: {
    name: symptom.name,
    description: symptom.description || '',
    active: symptom.active,
  },
});

export const recordSymptomHistoryChange = (symptom, newValues) => {
  const changes = {};
  for (const field of ['name', 'description', 'active']) {
    if (JSON.stringify(symptom[field]) !== JSON.stringify(newValues[field])) {
      changes[field] = { from: symptom[field], to: newValues[field] };
    }
  }
  if (Object.keys(changes).length === 0) return null;
  return { timestamp: new Date().toISOString(), type: 'updated', changes };
};

// Apply a patch to a symptom, appending a history entry when tracked fields change
export const applySymptomPatch = (symptom, patch) => {
  const next = { ...symptom, ...patch };
  if ('description' in patch && !patch.description) next.description = undefined;
  if ('applicablePeriods' in patch && !patch.applicablePeriods) delete next.applicablePeriods;
  if ('group' in patch && !patch.group) { delete next.group; delete next.groupOrder; }
  const historyEntry = recordSymptomHistoryChange(symptom, next);
  const history = symptom.history || [];
  next.history = historyEntry ? [...history, historyEntry] : history;
  return next;
};

// Name/description as they were after history[targetIndex]
export const reconstructSymptomStateAtEntry = (historyArray, targetIndex) => {
  const createdEntry = historyArray.find((h) => h.type === 'created');
  if (!createdEntry) return null;
  const state = { ...createdEntry.snapshot };
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

export const formatSymptomChange = (entry) => {
  if (entry.type === 'created') return 'Created';
  if (entry.type === 'updated' && entry.changes) {
    const parts = [];
    Object.entries(entry.changes).forEach(([field, change]) => {
      if (field === 'active') parts.push(change.to ? 'Restored' : 'Hidden');
      else if (field === 'name' && change.from !== change.to) parts.push(`Name: ${change.from} → ${change.to}`);
      else if (field === 'description' && change.from !== change.to) parts.push('Description changed');
    });
    return parts.join(', ') || null;
  }
  return 'Updated';
};
