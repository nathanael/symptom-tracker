export function mergeDays(cache, incoming) {
  const byDate = new Map();
  for (const d of cache) byDate.set(d.date, d);
  for (const d of incoming) byDate.set(d.date, d);  // incoming wins on conflict
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
