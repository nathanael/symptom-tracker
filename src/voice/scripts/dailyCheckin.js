import { NA_SEVERITY } from '../../utils/constants';
import { getLastSeverity } from '../../utils/listHelpers';
import { entryKey, listFor, otherIncomplete } from '../checkinQueue';

export { GREETING, INSTRUCTIONS, LIVE_GUIDANCE, TOOLS } from '../../../supabase/functions/voice/dailyCheckinSpec.js';

const normalize = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// -1..5 as an integer, or null when the model sent something unusable
export const parseSeverity = (value) => {
  if (typeof value === 'string' && /^n\/?a$/i.test(value.trim())) return NA_SEVERITY;
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(n) && n >= NA_SEVERITY && n <= 5 ? n : null;
};

// Best symptom for a spoken name: exact, then containment, then shared words. Null when nothing
// matches; { ambiguous } when the top score is shared.
export const matchSymptom = (symptoms, spoken) => {
  const target = normalize(spoken);
  if (!target) return null;
  const words = new Set(target.split(' '));
  const scored = symptoms.map((s) => {
    const name = normalize(s.name);
    if (name === target) return { s, score: 100 };
    if (name.includes(target) || target.includes(name)) return { s, score: 50 };
    return { s, score: name.split(' ').filter((w) => words.has(w)).length };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score) {
    return { ambiguous: scored.filter((x) => x.score === scored[0].score).map((x) => x.s.name) };
  }
  return scored[0].s;
};

// What to tell a live model after the user taps a rating on screen. Deliberately leaves out the
// saved value: given it, the model has copied that number onto the next symptom.
export const handEntryMessage = (result) => {
  const { saved, ...rest } = result;
  return `The user entered ${saved?.name || 'that symptom'} on the screen themselves. It is already saved: do not call any tool for it. Carry on from this state by asking the next symptom and waiting for their answer: ${JSON.stringify(rest)}`;
};

// The daily check-in conversation, driven by tool calls. `ctx`:
//   symptoms, timePeriods, selectedDate, dateKey, period (starting period id)
//   getEntries()                       live entries map
//   log(symptomId, severity, periodId, note)   writes a rating (App's quickLog)
//   onCurrent(symptom, periodId), onPause(), onFinish()   UI hooks, all optional
export const createCheckin = (ctx) => {
  let period = ctx.period;
  let currentId = null;
  const skipped = new Set();
  // Ratings written this session: React state lags a write, so tool results can't wait for it
  const written = {};

  const entries = () => ({ ...ctx.getEntries(), ...written });
  const key = (symptomId, periodId = period) => entryKey(ctx.dateKey, symptomId, periodId);
  const periodLabel = (id) => ctx.timePeriods.find((p) => p.id === id)?.label || id;

  const describe = () => {
    const list = listFor(ctx.symptoms, period);
    const all = entries();
    const pending = (s) => !all[key(s.id)] && !skipped.has(s.id);
    const from = list.findIndex((s) => s.id === currentId);
    let next = null;
    for (let offset = 1; offset <= list.length && !next; offset++) {
      const candidate = list[(from + offset + list.length) % list.length];
      if (pending(candidate)) next = candidate;
    }
    if (!next) {
      currentId = null;
      ctx.onCurrent?.(null, period);
      const other = otherIncomplete(ctx.symptoms, all, ctx.dateKey, ctx.timePeriods, period);
      return {
        done: true,
        period: periodLabel(period),
        skipped: list.filter((s) => skipped.has(s.id) && !all[key(s.id)]).length,
        other_period: other ? { period_id: other.id, label: other.label || other.id, left: other.left } : null,
      };
    }
    currentId = next.id;
    ctx.onCurrent?.(next, period);
    const last = getLastSeverity(all, next.id, period, ctx.selectedDate);
    return {
      next: {
        symptom_id: next.id,
        name: next.name,
        ...(next.description ? { description: next.description } : {}),
        // `say` rides in every result because guidance given once fades over a long live session
        ...(last !== null ? { last_time: last, say: `${next.name}. Last time was ${last === 0 ? 'zero' : `a ${['one', 'two', 'three', 'four', 'five'][last - 1]}`}.` } : {}),
      },
      remaining: list.filter(pending).length,
    };
  };

  const write = (symptom, severity, note) => {
    const text = note?.trim();
    ctx.log(symptom.id, severity, period, text || undefined);
    const previous = entries()[key(symptom.id)];
    const kept = text || previous?.note;
    written[key(symptom.id)] = { time: period, severity, date: ctx.dateKey, symptomId: symptom.id, ...(kept ? { note: kept } : {}) };
  };

  const handlers = {
    record_symptom: ({ symptom_id, severity, note }) => {
      const symptom = listFor(ctx.symptoms, period).find((s) => s.id === symptom_id);
      if (!symptom) return { error: 'Unknown symptom_id. Use the id from the last tool result.', ...describe() };
      const value = parseSeverity(severity);
      if (value === null) return { error: 'severity must be an integer 0 to 5, or -1 for not applicable. Ask the user again.' };
      write(symptom, value, note);
      return { saved: { name: symptom.name, severity: value, ...(note?.trim() ? { note: note.trim() } : {}) }, ...describe() };
    },
    skip_symptom: ({ symptom_id }) => {
      if (symptom_id) skipped.add(symptom_id);
      return describe();
    },
    revise_symptom: ({ symptom_name, severity, note }) => {
      const match = matchSymptom(listFor(ctx.symptoms, period), symptom_name);
      if (!match) return { error: `No symptom matches "${symptom_name}".` };
      if (match.ambiguous) return { error: 'More than one symptom matches. Ask which one.', candidates: match.ambiguous };
      const existing = entries()[key(match.id)];
      const value = severity === undefined || severity === null ? existing?.severity : parseSeverity(severity);
      if (value === undefined || value === null) return { error: `${match.name} has no rating yet. Ask for a number from 0 to 5.` };
      write(match, value, note);
      skipped.delete(match.id);
      // Stay on the symptom that was being asked, unless that is the one just revised
      const pendingId = currentId;
      const current = pendingId && pendingId !== match.id && ctx.symptoms.find((s) => s.id === pendingId);
      if (current) return { saved: { name: match.name, severity: value }, next: { symptom_id: current.id, name: current.name }, note: 'Continue with the symptom you were asking about.' };
      return { saved: { name: match.name, severity: value }, ...describe() };
    },
    switch_period: ({ period_id }) => {
      if (!ctx.timePeriods.some((p) => p.id === period_id)) return { error: 'Unknown period_id.' };
      period = period_id;
      currentId = null;
      skipped.clear();
      return { period: periodLabel(period), ...describe() };
    },
    pause_session: () => {
      ctx.onPause?.();
      return { paused: true, say: 'Say a short goodbye. Their progress is saved.' };
    },
    finish: () => {
      ctx.onFinish?.();
      return { finished: true };
    },
  };

  return {
    // Opening state for the model: which period, the first symptom, how many remain
    start: () => ({ period: periodLabel(period), ...describe() }),
    handle: (name, args) => {
      const handler = handlers[name];
      if (!handler) return { error: `Unknown tool ${name}.` };
      try {
        return handler(args || {});
      } catch (err) {
        return { error: String(err?.message || err) };
      }
    },
    period: () => period,
    currentId: () => currentId,
  };
};
