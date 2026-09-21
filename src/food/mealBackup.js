// Merging meals from a backup file.
//
// Loading a backup never overwrites: it fills in what this device is missing, matching the
// behaviour of every other domain in Settings' restore.
//
// Pure module.

/**
 * @returns {{ merged: Object, added: number }}
 */
export function mergeBackupMeals(current, backup) {
  const merged = { ...(current && typeof current === 'object' ? current : {}) };
  let added = 0;
  if (backup && typeof backup === 'object' && !Array.isArray(backup)) {
    for (const [key, value] of Object.entries(backup)) {
      if (!merged[key]) { merged[key] = value; added += 1; }
    }
  }
  return { merged, added };
}
