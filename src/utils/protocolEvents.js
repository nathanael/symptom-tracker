// What changed in the protocol, and what a symptom did around it. Read from the log itself
// (what was actually taken), not from edits to a supplement's settings.
import { isDeleted } from './softDelete';

const STOP_GAP_DAYS = 14; // a supplement not taken for this long has been stopped, not just missed
const STICK_ENTRIES = 3; // a new dose counts once it has been taken this many times running
const MIN_LOGGED_DAYS = 14;
const MIN_SIDE_DAYS = 3;

const toDate = (dateStr) => new Date(`${dateStr}T12:00:00`);
const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (dateStr, n) => {
  const d = toDate(dateStr);
  d.setDate(d.getDate() + n);
  return toKey(d);
};
const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / 86400000);
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Starts, stops and lasting dose changes, oldest first.
 * Whatever was already being taken on the first day of tracking is not a "start".
 * @returns {Array<{ date, itemId, name, type: 'start'|'stop'|'dose', from?, to?, label, since }>}  `since` reads after "Since …"
 */
export const getProtocolEvents = (stackItems, stackEntries, todayStr) => {
  const byItem = new Map();
  let trackingStart = null;
  Object.values(stackEntries || {}).forEach((entry) => {
    if (!entry?.date || !entry.itemId || entry.taken === false) return;
    if (!byItem.has(entry.itemId)) byItem.set(entry.itemId, []);
    byItem.get(entry.itemId).push(entry);
    if (trackingStart === null || entry.date < trackingStart) trackingStart = entry.date;
  });

  const events = [];
  (stackItems || []).forEach((item) => {
    const log = byItem.get(item.id);
    if (!log || isDeleted(item)) return;
    log.sort((a, b) => (a.date < b.date ? -1 : 1));
    const gapLimit = item.schedule?.type === 'interval' ? Math.max(STOP_GAP_DAYS, (item.schedule.interval || 1) * 3) : STOP_GAP_DAYS;
    const doseOf = (entry) => entry.dose ?? item.defaultDose ?? null;
    const push = (date, type, extra = {}) => events.push({ date, itemId: item.id, name: item.name, type, ...extra });

    let dose = doseOf(log[0]);
    if (log[0].date !== trackingStart) push(log[0].date, 'start', { label: `Started ${item.name}`, since: `starting ${item.name}` });
    for (let i = 1; i < log.length; i++) {
      const entry = log[i];
      if (diffDays(entry.date, log[i - 1].date) > gapLimit) {
        push(addDays(log[i - 1].date, 1), 'stop', { label: `Stopped ${item.name}`, since: `stopping ${item.name}` });
        push(entry.date, 'start', { label: `Restarted ${item.name}`, since: `restarting ${item.name}` });
        dose = doseOf(entry);
        continue;
      }
      const next = doseOf(entry);
      if (next === dose || next === null) continue;
      const run = log.slice(i, i + STICK_ENTRIES);
      if (run.length >= 2 && run.every((e) => doseOf(e) === next)) {
        const label = `${item.name} ${dose} → ${next} ${item.unit || ''}`.trim();
        push(entry.date, 'dose', { from: dose, to: next, label, since: `${item.name} went ${dose} → ${next} ${item.unit || ''}`.trim() });
        dose = next;
      }
    }
    const last = log[log.length - 1].date;
    if (diffDays(todayStr, last) > gapLimit) push(addDays(last, 1), 'stop', { label: `Stopped ${item.name}`, since: `stopping ${item.name}` });
  });

  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

// A symptom's own usual range on the 0–5 scale, or null until there is enough history to say
export const normalRange = (values) => {
  const logged = (values || []).filter((v) => v !== null && v !== undefined);
  if (logged.length < MIN_LOGGED_DAYS) return null;
  const avg = mean(logged);
  const sd = Math.sqrt(mean(logged.map((v) => (v - avg) ** 2)));
  const half = Math.max(0.75 * sd, 0.75);
  return { lo: Math.max(0, avg - half), hi: Math.min(5, avg + half) };
};

const MIN_VERDICT_DAYS = 7; // logged days needed on each side before saying anything
const MIN_POINTS = 0.5; // on the 0–5 scale, less than this is not a change worth reporting
const MIN_EFFECT = 0.5; // ...and it has to stand out from the symptom's own day-to-day noise

/**
 * What a daily series did around a protocol change, comparing only clean stretches: the "before"
 * starts no earlier than the previous change and the "after" stops at the next one.
 * @param seriesFor  (dates: string[]) => Array<number|null>
 * @returns {{ status: 'ok', before, after, delta, meaningful } | { status: 'early'|'crowded' }}
 *   early = not enough days logged yet; crowded = another change is too close to tell them apart
 */
export const changeEffect = (seriesFor, eventDate, todayStr, { prevChange = null, nextChange = null, span = 30 } = {}) => {
  const range = (from, to) => Array.from({ length: Math.max(0, diffDays(to, from) + 1) }, (_, i) => addDays(from, i));
  const logged = (dates) => seriesFor(dates).filter((v) => v !== null && v !== undefined && v >= 0);

  const openStart = addDays(eventDate, -span);
  const cutStart = prevChange && prevChange > openStart;
  const openEnd = [addDays(eventDate, span - 1), todayStr].sort()[0];
  const cutEnd = nextChange && addDays(nextChange, -1) < openEnd;
  const before = logged(range(cutStart ? prevChange : openStart, addDays(eventDate, -1)));
  const after = logged(range(eventDate, cutEnd ? addDays(nextChange, -1) : openEnd));
  if (after.length < MIN_VERDICT_DAYS) return { status: cutEnd ? 'crowded' : 'early' };
  if (before.length < MIN_VERDICT_DAYS) return { status: cutStart ? 'crowded' : 'early' };

  const delta = mean(after) - mean(before);
  const variance = (values) => mean(values.map((v) => (v - mean(values)) ** 2));
  const noise = Math.sqrt((variance(before) * before.length + variance(after) * after.length) / (before.length + after.length));
  const meaningful = Math.abs(delta) >= MIN_POINTS && Math.abs(delta) >= MIN_EFFECT * noise;
  return { status: 'ok', before: mean(before), after: mean(after), delta, noise, meaningful };
};
