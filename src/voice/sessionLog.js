import { saveLog } from './voiceApi';

// A talk mode conversation as a timeline (what she said, what was heard, every tool call and its
// result, mic and engine events), kept on the voice backend for a couple of weeks so an odd
// conversation can be read back afterwards instead of described from memory. Saved as it goes,
// so a session that dies half-way still leaves its log. Only kept while the talk mode cost card
// (the diagnostics switch in Settings) is on.
const SAVE_EVERY_MS = 15000;
const MAX_EVENTS = 1500;

export const createSessionLog = ({ enabled, meta }) => {
  const startedAt = Date.now();
  const id = new Date(startedAt).toISOString();
  const events = [];
  let dirty = false;
  let saving = false;

  const save = async () => {
    if (!enabled || !dirty || saving) return;
    saving = true;
    dirty = false;
    try {
      await saveLog({ id, meta, seconds: Math.round((Date.now() - startedAt) / 1000), events });
    } catch {
      dirty = true; // try again on the next tick
    }
    saving = false;
  };
  const timer = enabled ? setInterval(save, SAVE_EVERY_MS) : null;

  // Captions arrive as a growing string per turn: log each one once, when it stops growing
  const lines = { app: '', user: '' };
  const settle = (who) => {
    if (lines[who]) events.push({ t: Date.now() - startedAt, type: who === 'app' ? 'said' : 'heard', text: lines[who] });
    lines[who] = '';
  };

  const log = (type, data) => {
    if (!enabled || events.length >= MAX_EVENTS) return;
    events.push({ t: Date.now() - startedAt, type, ...(data === undefined ? {} : { data }) });
    dirty = true;
  };

  return {
    log,
    caption: (who, text) => {
      if (!enabled) return;
      if (lines[who] && !text.startsWith(lines[who])) settle(who);
      lines[who] = text;
      dirty = true;
    },
    close: (reason, stats) => {
      settle('app');
      settle('user');
      log('end', { reason, stats });
      clearInterval(timer);
      return save();
    },
  };
};
