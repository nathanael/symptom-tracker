import { NA_SEVERITY } from '../../utils/constants';
import { getLastSeverity } from '../../utils/listHelpers';
import { entryKey, listFor, otherIncomplete } from '../checkinQueue';

export { GREETING, INSTRUCTIONS, TOOLS } from '../../../cloudflare/voice/src/dailyCheckinSpec.js';

const normalize = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// -1..5 as an integer, or null when the model sent something unusable
export const parseSeverity = (value) => {
  if (typeof value === 'string' && /^n\/?a$/i.test(value.trim())) return NA_SEVERITY;
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isInteger(n) && n >= NA_SEVERITY && n <= 5 ? n : null;
};

// How a symptom is said aloud: its name, then its description when it has one
export const spokenName = (s) => (s.description ? `${s.name}, ${s.description}` : s.name);

// Best symptom for a spoken name: exact, then containment, then shared words. Null when nothing
// matches; { ambiguous } when the top score is shared.
export const matchSymptom = (symptoms, spoken) => {
  const target = normalize(spoken);
  if (!target) return null;
  const words = new Set(target.split(' '));
  const scored = symptoms.map((s) => {
    const name = normalize(s.name);
    let score = name.split(' ').filter((w) => words.has(w)).length;
    if (name === target) score = 100;
    else if (name.includes(target) || target.includes(name)) score = 50;
    // Symptoms can share a name and differ only by description ("Anxiety" physical / mental):
    // once the name fits, the description's words break the tie
    if (score > 0 && s.description) {
      const detail = normalize(s.description);
      score += normalize(`${s.name} ${s.description}`) === target ? 100 : detail.split(' ').filter((w) => words.has(w)).length;
    }
    return { s, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score) {
    return { ambiguous: scored.filter((x) => x.score === scored[0].score).map((x) => spokenName(x.s)) };
  }
  return scored[0].s;
};

// What the voice says after saving an answer: short, plain, and fixed. Reflecting the user's note
// back in her own words came across as awkward; a simple hand-off to the next symptom does not.
export const ACKS = ['Okay, next.', 'Got it. Next.', 'Okay, next.', 'Alright, next.'];
export const NOTE_ACKS = ['Noted. Next.', 'Got it, noted. Next.'];

// Rides in the tool result because that is the one thing a live model reads fresh every turn;
// session-level style guidance fades over a long conversation.
const acknowledgement = (note, random) => {
  const phrases = note ? NOTE_ACKS : ACKS;
  return phrases[Math.floor(random() * phrases.length)];
};

// A saved answer and the next question, as the single line to speak. Handed over as two fields,
// the model has said the "next" hand-off and then left the symptom itself unnamed.
const spoken = (ack, state) => (state.next ? { ...state, next: { ...state.next, say: `${ack} ${state.next.say}` } } : { ...state, acknowledge: ack });

// What to tell a live model after the user taps a rating on screen. Deliberately leaves out the
// saved value: given it, the model has copied that number onto the next symptom.
export const handEntryMessage = (result) => {
  const { saved, acknowledge, ...rest } = result;
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
  let opened = false; // the first question of a period also asks about the period itself
  const skipped = new Set();
  // Ratings written this session: React state lags a write, so tool results can't wait for it
  const written = {};

  const entries = () => ({ ...ctx.getEntries(), ...written });
  const key = (symptomId, periodId = period) => entryKey(ctx.dateKey, symptomId, periodId);
  const periodLabel = (id) => ctx.timePeriods.find((p) => p.id === id)?.label || id;

  // How a period is said out loud. "PM" covers the whole back half of the day, so which half it is
  // now decides between afternoon and evening.
  const periodWord = (id) => {
    if (id === 'morning') return 'morning';
    if (id === 'evening') return (ctx.now ? ctx.now() : new Date()).getHours() < 17 ? 'afternoon' : 'evening';
    return 'today';
  };
  const spokenPeriod = (id) => (id === 'daily' ? 'today' : `this ${periodWord(id)}`);

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
    const asked = ask(next, all);
    opened = true;
    return { next: asked, remaining: list.filter(pending).length };
  };


  // How to ask a symptom. `say` rides in every result because guidance given once fades over a
  // long live session.
  const ask = (symptom, all) => {
    const last = getLastSeverity(all, symptom.id, period, ctx.selectedDate);
    const lastTime = last === null ? '' : ` Last time was ${last === 0 ? 'zero' : `a ${['one', 'two', 'three', 'four', 'five'][last - 1]}`}.`;
    return {
      symptom_id: symptom.id,
      name: symptom.name,
      ...(symptom.description ? { description: symptom.description } : {}),
      ...(last !== null ? { last_time: last } : {}),
      // The first question of a period names the period, so they know which slot they are filling
      say: `${spokenName(symptom)}.${lastTime}${opened ? '' : ` How about ${spokenPeriod(period)}?`}`,
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
      const text = note?.trim();
      return { saved: { name: symptom.name, severity: value, ...(text ? { note: text } : {}) }, ...spoken(acknowledgement(text, ctx.random || Math.random), describe()) };
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
      const acknowledge = acknowledgement(note?.trim(), ctx.random || Math.random);
      // Stay on the symptom that was being asked, unless that is the one just revised
      const pendingId = currentId;
      const current = pendingId && pendingId !== match.id && ctx.symptoms.find((s) => s.id === pendingId);
      if (current) return { saved: { name: match.name, severity: value }, ...spoken(acknowledge, { next: ask(current, entries()) }), note: 'Continue with the symptom you were asking about.' };
      return { saved: { name: match.name, severity: value }, ...spoken(acknowledge, describe()) };
    },
    switch_period: ({ period_id }) => {
      if (!ctx.timePeriods.some((p) => p.id === period_id)) return { error: 'Unknown period_id.' };
      period = period_id;
      currentId = null;
      opened = false;
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
    // Opening state for the model: which period, how to move to another one, the first symptom
    start: () => {
      const other = ctx.timePeriods.find((p) => p.id !== period);
      return {
        period: periodLabel(period),
        periods: ctx.timePeriods.map((p) => ({ period_id: p.id, when: spokenPeriod(p.id) })),
        ...(other ? { switch_hint: `We're recording symptoms for ${spokenPeriod(period)}. To record ${spokenPeriod(other.id)} instead, just say switch to ${periodWord(other.id)}.` } : {}),
        ...describe(),
      };
    },
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
