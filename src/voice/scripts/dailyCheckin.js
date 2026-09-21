import { NA_SEVERITY } from '../../utils/constants';
import { getLastSeverity } from '../../utils/listHelpers';
import { entryKey, listFor, otherIncomplete } from '../checkinQueue';

import { GREETING, SHORT_GREETING, BARE_GREETING } from '../../../cloudflare/voice/src/dailyCheckinSpec.js';

export { GREETING, SHORT_GREETING, BARE_GREETING, INSTRUCTIONS, TOOLS } from '../../../cloudflare/voice/src/dailyCheckinSpec.js';

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

// Every line she is scripted to say, apart from the greetings (GREETING, SHORT_GREETING and
// BARE_GREETING in cloudflare/voice/src/dailyCheckinSpec.js). Edit the wording here.
// `period` arrives as "this morning" / "this afternoon" / "this evening" / "today".
export const LINES = {
  // The first question of a fresh period, and of one being picked back up
  startWith: (symptom) => `Let's start with the first symptom, ${symptom}.`,
  continueWith: (symptom) => `Let's continue with ${symptom}.`,
  // Every other question is just the symptom ("Anxiety, Physical."), followed by:
  lastTime: (rating) => `Last time was ${rating}.`, // rating: "zero", "a one" ... "a five"
  howAbout: (period) => `How about ${period}?`, // first question of a period only
  // After the greeting, when the day has a morning and an evening (otherWord: "morning" ...)
  switchHintFull: (period, other, otherWord) => `We're recording symptoms for ${period}. To record for ${other} instead, just say switch to ${otherWord}.`,
  switchHintShort: (period, otherWord) => `Recording for ${period}. Say switch to ${otherWord} to change.`,
  // The end of a period
  periodDone: (period, other) => `That's everything for ${period}. Nice work. Would you like to carry on with ${other}, or stop there?`,
  allDone: "Congratulations, that's all of them. You're done for now.",
  goodbye: "You're done for now. Well done.", // only if she reaches the end without having said one of the two above
};

// Conversations before the full introduction gives way to the short one, and the short to the bare
export const FULL_INTRO_SESSIONS = 3;
export const SHORT_INTRO_SESSIONS = 8;

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
//   sessions                           conversations finished on this device: the introduction shrinks with them
//   addDayNote(text)                   appends to the day's note
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
        // The check-in ends on her voice, not on the screen closing under them
        say: other
          ? LINES.periodDone(spokenPeriod(period), spokenPeriod(other.id))
          : LINES.allDone,
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
    const lastTime = last === null ? '' : ` ${LINES.lastTime(last === 0 ? 'zero' : `a ${['one', 'two', 'three', 'four', 'five'][last - 1]}`)}`;
    return {
      symptom_id: symptom.id,
      name: symptom.name,
      ...(symptom.description ? { description: symptom.description } : {}),
      ...(last !== null ? { last_time: last } : {}),
      // The first question of a period says where in the list they are and names the period, so
      // they know which slot they are filling
      say: opened
        ? `${spokenName(symptom)}.${lastTime}`
        : `${(listFor(ctx.symptoms, period).some((s) => all[key(s.id)]) ? LINES.continueWith : LINES.startWith)(spokenName(symptom))}${lastTime} ${LINES.howAbout(spokenPeriod(period))}`,
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
      return { saved: { name: symptom.name, severity: value, ...(text ? { note: text } : {}) }, ...describe() };
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
      if (current) return { saved: { name: match.name, severity: value }, next: ask(current, entries()), note: 'Continue with the symptom you were asking about.' };
      return { saved: { name: match.name, severity: value }, ...describe() };
    },
    switch_period: ({ period_id }) => {
      if (!ctx.timePeriods.some((p) => p.id === period_id)) return { error: 'Unknown period_id.' };
      period = period_id;
      currentId = null;
      opened = false;
      skipped.clear();
      return { period: periodLabel(period), ...describe() };
    },
    add_day_note: ({ text }) => {
      const words = String(text || '').trim();
      if (!words) return { error: 'Nothing to note. Ask what they would like noted.' };
      ctx.addDayNote?.(words);
      const current = currentId && ctx.symptoms.find((s) => s.id === currentId);
      return { saved_day_note: true, ...(current ? { next: ask(current, entries()) } : describe()), note: 'Say "Noted", then continue with the symptom you were asking about.' };
    },
    pause_session: () => {
      ctx.onPause?.();
      return { paused: true, say: 'Say a short goodbye. Their progress is saved.' };
    },
    finish: () => {
      ctx.onFinish?.();
      return { finished: true, note: `If you have not said a closing line yet, say: "${LINES.goodbye}" Otherwise say nothing more.` };
    },
  };

  return {
    // Opening state for the model: which period, how to move to another one, the first symptom
    start: () => {
      const other = ctx.timePeriods.find((p) => p.id !== period);
      const sessions = ctx.sessions || 0;
      // Picking a check-in back up gets no introduction at all, only "Let's continue with…"
      const resuming = listFor(ctx.symptoms, period).some((s) => entries()[key(s.id)]);
      const greeting = resuming ? '' : sessions < FULL_INTRO_SESSIONS ? GREETING : sessions < SHORT_INTRO_SESSIONS ? SHORT_GREETING : BARE_GREETING;
      const hint = resuming || sessions >= SHORT_INTRO_SESSIONS ? ''
        : sessions < FULL_INTRO_SESSIONS ? LINES.switchHintFull(spokenPeriod(period), spokenPeriod(other?.id), periodWord(other?.id))
          : LINES.switchHintShort(spokenPeriod(period), periodWord(other?.id));
      return {
        ...(greeting ? { greeting } : {}),
        period: periodLabel(period),
        periods: ctx.timePeriods.map((p) => ({ period_id: p.id, when: spokenPeriod(p.id) })),
        ...(other && hint ? { switch_hint: hint } : {}),
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
