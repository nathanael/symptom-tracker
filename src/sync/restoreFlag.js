// Marks "the user just restored a local snapshot" across the reload that
// follows it. Restored records keep their old `_t`, so on the next boot they
// would lose to any tombstone written since the snapshot was taken; the engine
// reads this flag to treat them as deliberate fresh writes instead, then clears
// it. All localStorage access is guarded — never throws.

export const RESTORE_FLAG_KEY = 'symptomTracker_restorePending';

export function markRestorePending() {
  try { localStorage.setItem(RESTORE_FLAG_KEY, '1'); } catch { /* unavailable */ }
}

export function isRestorePending() {
  try { return localStorage.getItem(RESTORE_FLAG_KEY) === '1'; } catch { return false; }
}

export function clearRestorePending() {
  try { localStorage.removeItem(RESTORE_FLAG_KEY); } catch { /* unavailable */ }
}
