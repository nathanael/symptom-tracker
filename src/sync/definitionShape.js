// Pure adapters between the app's ARRAY-of-{id,...} representation of
// definition domains and Firestore's id-keyed MAP representation.
// No imports — keep these pure and dependency-free.

export function arrayToIdMap(arr) {
  if (!Array.isArray(arr)) return {};
  const map = {};
  for (const item of arr) {
    if (item && item.id != null) {
      map[item.id] = item;
    }
  }
  return map;
}

export function idMapToArray(map) {
  if (!map || typeof map !== 'object') return [];
  const values = Object.keys(map).map((key) => map[key]);
  // Decorate-sort by [hasOrder, order, index] so the sort is deterministic
  // and stable regardless of engine: ordered items first (asc by order),
  // unordered items after in insertion order.
  return values
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aHas = a.item && typeof a.item.order === 'number';
      const bHas = b.item && typeof b.item.order === 'number';
      if (aHas && bHas) {
        if (a.item.order !== b.item.order) return a.item.order - b.item.order;
        return a.index - b.index;
      }
      if (aHas) return -1;
      if (bHas) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}
