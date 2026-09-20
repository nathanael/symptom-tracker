// Soft delete: items keep living in their arrays with a `deletedAt` stamp for
// RETENTION_DAYS, are hidden from every list, and are purged (with their entries) after that.

export const RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export const isDeleted = (item) => !!item?.deletedAt;
export const liveItems = (items) => (Array.isArray(items) ? items.filter((i) => !isDeleted(i)) : []);

export const markDeleted = (item, now = new Date()) => ({ ...item, active: false, deletedAt: now.toISOString() });

// deletedAt is nulled rather than removed so a field-merge sync write can't leave the old stamp behind
export const restoreDeleted = (item) => ({ ...item, active: true, deletedAt: null });

export const daysUntilPurge = (item, now = new Date()) => {
  if (!isDeleted(item)) return null;
  const elapsed = now.getTime() - new Date(item.deletedAt).getTime();
  return Math.max(0, Math.ceil(RETENTION_DAYS - elapsed / DAY_MS));
};

export const isExpired = (item, now = new Date()) =>
  isDeleted(item) && now.getTime() - new Date(item.deletedAt).getTime() >= RETENTION_DAYS * DAY_MS;

const entryBelongsTo = (key, entry, ids, idField) => {
  const owner = entry && entry[idField];
  if (owner != null) return ids.has(owner);
  // Legacy entries without the owner field: fall back to the key shape `${date}-${id}` / `${date}-${id}-${period}`
  for (const id of ids) {
    if (key.endsWith(`-${id}`) || key.includes(`-${id}-`)) return true;
  }
  return false;
};

export const countEntriesFor = (entryMap, id, idField) => {
  const ids = new Set([id]);
  return Object.entries(entryMap || {}).filter(([key, entry]) => entryBelongsTo(key, entry, ids, idField)).length;
};

// Returns the same map when nothing was removed, so callers can skip a state write
export const removeEntriesFor = (entryMap, idList, idField) => {
  const ids = new Set(idList);
  if (ids.size === 0) return entryMap;
  let removed = 0;
  const next = {};
  for (const [key, entry] of Object.entries(entryMap || {})) {
    if (entryBelongsTo(key, entry, ids, idField)) removed++;
    else next[key] = entry;
  }
  return removed === 0 ? entryMap : next;
};
