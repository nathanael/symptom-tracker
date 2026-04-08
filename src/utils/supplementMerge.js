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
