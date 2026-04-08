export function previewMerge(stackEntries, targetId, sourceId) {
  let sourceEntryCount = 0;
  let targetEntryCount = 0;
  const sourceDates = new Set();
  const targetDates = new Set();

  for (const [key, entry] of Object.entries(stackEntries)) {
    if (key.endsWith(`-${sourceId}`)) {
      sourceEntryCount++;
      sourceDates.add(entry.date);
    } else if (key.endsWith(`-${targetId}`)) {
      targetEntryCount++;
      targetDates.add(entry.date);
    }
  }

  let conflictCount = 0;
  for (const date of sourceDates) {
    if (targetDates.has(date)) conflictCount++;
  }

  return { sourceEntryCount, targetEntryCount, conflictCount };
}

export function mergeSupplements(stackItems, stackEntries, targetId, sourceId, strategy) {
  const sourceEntries = {};
  const otherEntries = {};

  for (const [key, entry] of Object.entries(stackEntries)) {
    if (key.endsWith(`-${sourceId}`)) {
      sourceEntries[entry.date] = entry;
    } else {
      otherEntries[key] = entry;
    }
  }

  for (const [date, srcEntry] of Object.entries(sourceEntries)) {
    const targetKey = date + '-' + targetId;
    const existing = otherEntries[targetKey];
    if (existing) {
      otherEntries[targetKey] = {
        date,
        itemId: targetId,
        dose: strategy === 'sum' ? existing.dose + srcEntry.dose : Math.max(existing.dose, srcEntry.dose),
        taken: existing.taken || srcEntry.taken,
      };
    } else {
      otherEntries[targetKey] = { date, itemId: targetId, dose: srcEntry.dose, taken: srcEntry.taken };
    }
  }

  const newStackItems = stackItems.filter(i => i.id !== sourceId);

  return { stackItems: newStackItems, stackEntries: otherEntries };
}

export function previewDelete(stackEntries, targetId) {
  let entryCount = 0;
  for (const key of Object.keys(stackEntries)) {
    if (key.endsWith(`-${targetId}`)) entryCount++;
  }
  return { entryCount };
}

export function deleteSupplement(stackItems, stackEntries, targetId) {
  const newEntries = {};
  let deletedCount = 0;
  for (const [key, entry] of Object.entries(stackEntries)) {
    if (key.endsWith(`-${targetId}`)) {
      deletedCount++;
    } else {
      newEntries[key] = entry;
    }
  }
  const newStackItems = stackItems.filter(i => i.id !== targetId);
  return { stackItems: newStackItems, stackEntries: newEntries, deletedCount };
}

export function renameSupplement(stackItems, targetId, newName) {
  return stackItems.map(item => {
    if (item.id !== targetId) return item;
    const historyEntry = {
      timestamp: new Date().toISOString(),
      type: 'updated',
      changes: { name: { from: item.name, to: newName } },
    };
    return {
      ...item,
      name: newName,
      history: [...(item.history || []), historyEntry],
    };
  });
}
