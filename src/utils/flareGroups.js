// "Intelligent" grouping for the Symptoms tab: symptoms whose bad days tend to coincide.
// Pure maths on the log. No network, no model.
import { getStripDateKeys, getSeverityStrip } from './listHelpers';
import { suggestGroup, DEFAULT_GROUPS } from './symptomGroups';

export const WINDOW_DAYS = 90;
const MIN_LOGGED_DAYS = 14; // a symptom needs this much history to take part
const MIN_FLARE_DAYS = 3;
const MIN_SHARED_FLARES = 3; // two symptoms must have flared together at least this often
const LINK_THRESHOLD = 0.5; // share of flare days that coincide (within a day of each other)
const MIN_LIFT = 1.5; // and that must beat what chance alone would give
export const MIN_HISTORY_DAYS = 21; // below this the whole view says "not enough data yet"

// A flare is a day clearly above this symptom's own normal, never a 0
export const flareThreshold = (values) => {
  const logged = values.filter((v) => v !== null);
  if (logged.length === 0) return Infinity;
  const mean = logged.reduce((a, b) => a + b, 0) / logged.length;
  const sd = Math.sqrt(logged.reduce((a, b) => a + (b - mean) ** 2, 0) / logged.length);
  // At least a 2: a symptom flickering between 0 and 1 is noise, and noise lines up by accident
  return Math.max(mean + Math.max(0.75 * sd, 0.75), 2);
};

const flareDays = (values, threshold) => values.reduce((days, v, i) => (v !== null && v >= threshold ? [...days, i] : days), []);

// How much two symptoms' flare days coincide (±1 day), 0..1, or 0 when it could be chance
export const flareSimilarity = (a, b, totalDays) => {
  if (a.length === 0 || b.length === 0) return 0;
  const near = (xs, ys) => xs.filter((x) => ys.some((y) => Math.abs(x - y) <= 1)).length;
  const shared = Math.min(near(a, b), near(b, a));
  if (shared < MIN_SHARED_FLARES) return 0;
  const similarity = (near(a, b) + near(b, a)) / (a.length + b.length);
  const expected = Math.min(1, (3 * Math.max(a.length, b.length)) / totalDays); // chance a given flare has a neighbour
  return similarity / expected >= MIN_LIFT ? similarity : 0;
};

// Average-linkage clustering: keep merging the two most similar clusters while they are similar enough
const cluster = (ids, sim) => {
  let clusters = ids.map((id) => [id]);
  const between = (x, y) => x.reduce((sum, i) => sum + y.reduce((s, j) => s + sim(i, j), 0), 0) / (x.length * y.length);
  for (;;) {
    let best = null;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const score = between(clusters[i], clusters[j]);
        if (score >= LINK_THRESHOLD && (!best || score > best.score)) best = { i, j, score };
      }
    }
    if (!best) return clusters;
    clusters = [...clusters.filter((_, k) => k !== best.i && k !== best.j), [...clusters[best.i], ...clusters[best.j]]];
  }
};

// Name a cluster from its members' names: the word-list group most of them fall in, else its most flare-prone member
const nameCluster = (members, flareCount, taken) => {
  const votes = new Map();
  members.forEach((s) => {
    const g = suggestGroup(s.name, s.description, DEFAULT_GROUPS);
    if (g) votes.set(g, (votes.get(g) || 0) + 1);
  });
  const [top, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (top && count * 2 >= members.length && !taken.has(top)) return top;
  const lead = [...members].sort((a, b) => flareCount(b) - flareCount(a))[0];
  return `${lead.name} + ${members.length - 1}`;
};

/**
 * @param symptoms  active symptoms, already in the person's own order
 * @param entries   the entry map
 * @param today     Date the 90-day window ends on
 * @param viewDate  Date being looked at, for the "flaring" badge
 * @returns {{ ready: boolean, historyDays: number, sections: Array<{ name: string|null, rows, badge: string|null }> }}
 *   sections keep the person's order; the last one (name null) holds symptoms with no clear partner
 */
export const computeFlareGroups = (symptoms, entries, today, viewDate = today) => {
  const keys = getStripDateKeys(today, WINDOW_DAYS);
  const series = new Map(symptoms.map((s) => [s.id, getSeverityStrip(entries, s.id, keys)]));
  const historyDays = keys.filter((_, i) => symptoms.some((s) => series.get(s.id)[i] !== null)).length;
  if (historyDays < MIN_HISTORY_DAYS) return { ready: false, historyDays, sections: [{ name: null, rows: symptoms, badge: null }] };

  const threshold = new Map(symptoms.map((s) => [s.id, flareThreshold(series.get(s.id))]));
  const flares = new Map(symptoms.map((s) => [s.id, flareDays(series.get(s.id), threshold.get(s.id))]));
  const eligible = symptoms.filter((s) =>
    series.get(s.id).filter((v) => v !== null).length >= MIN_LOGGED_DAYS && flares.get(s.id).length >= MIN_FLARE_DAYS);

  const cache = new Map();
  const sim = (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!cache.has(k)) cache.set(k, flareSimilarity(flares.get(a), flares.get(b), keys.length));
    return cache.get(k);
  };
  const byId = new Map(symptoms.map((s) => [s.id, s]));
  const position = new Map(symptoms.map((s, i) => [s.id, i]));
  const inOrder = (ids) => [...ids].sort((a, b) => position.get(a) - position.get(b));

  const groups = cluster(eligible.map((s) => s.id), sim)
    .filter((ids) => ids.length > 1)
    .map(inOrder)
    .sort((a, b) => position.get(a[0]) - position.get(b[0]));

  // "Flaring" = on the day being viewed, at least half of a group (and 2+) is at or above its own flare line
  const [viewKey] = getStripDateKeys(viewDate, 1);
  const viewValue = (id) => getSeverityStrip(entries, id, [viewKey])[0];
  const taken = new Set();
  const sections = groups.map((ids) => {
    const rows = ids.map((id) => byId.get(id));
    const name = nameCluster(rows, (s) => flares.get(s.id).length, taken);
    taken.add(name);
    const up = ids.filter((id) => { const v = viewValue(id); return v !== null && v >= threshold.get(id); }).length;
    return { name, rows, badge: up >= 2 && up * 2 >= ids.length ? `flaring · ${up} of ${ids.length} up` : null };
  });

  const groupedIds = new Set(groups.flat());
  const solo = symptoms.filter((s) => !groupedIds.has(s.id));
  if (solo.length > 0) sections.push({ name: null, rows: solo, badge: null });
  return { ready: true, historyDays, sections };
};
