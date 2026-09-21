import { GREETING, ACKS } from './scripts/dailyCheckin';
import { mintToken, talkTurn } from './voiceApi';
import { connect } from './webrtcConnection';
import { createSpeaker } from './ttsCache';
import { lineFor, linesFor, stateFor, parseUtterance, LINES, SHORT_GREETING } from './lines';

const GREETED_KEY = 'symptomTracker_talkModeGreeted';

const normalize = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The cheap engine: a transcription-only session hears the user, plain answers are parsed locally,
// anything else goes to a small text model, and the app replies with cached clips.
//
// Both engines share this shape:
//   createXEngine({ checkin, warmLines, onState, onCaption, onLevel, onError, onEnd })
//   -> { start(), stop(), setMuted(bool), sendText(text), advance(toolResult) }
// States: connecting | listening | thinking | speaking | error
export const createPipelineEngine = ({ checkin, warmLines = [], onState, onCaption, onLevel, onError, onEnd }) => {
  const speaker = createSpeaker();
  let connection = null;
  let state = {};
  let lastLine = '';
  let ending = false;
  let stopped = false;
  let userMuted = false;
  let busy = Promise.resolve();

  const say = async (text) => {
    lastLine = text;
    onCaption({ who: 'app', text });
    onState('speaking');
    await speaker.say(text);
    if (!stopped) onState('listening');
  };

  const end = (reason) => {
    if (stopped) return;
    stopped = true;
    speaker.stop();
    connection?.close();
    onEnd(reason);
  };

  const respond = async (result) => {
    state = stateFor(result, state);
    if (result.paused || result.finished) ending = true;
    for (const line of linesFor(result)) {
      if (stopped) return;
      await say(line);
    }
    if (ending) return end(result.paused ? 'paused' : 'finished');
    // Nothing left anywhere: no question to wait on, so close out
    if (result.done && !result.other_period) {
      checkin.handle('finish');
      end('finished');
    }
  };

  const hear = async (text) => {
    if (stopped || ending || !text.trim()) return;
    // The mic can pick up our own clip; a multi-word transcript of the line we just spoke is an echo
    const heard = normalize(text);
    if (heard.includes(' ') && normalize(lastLine).includes(heard)) return;
    speaker.stop();
    onCaption({ who: 'user', text });
    onState('thinking');
    let call = parseUtterance(text, state);
    if (!call) {
      try {
        call = await talkTurn(text, { ...state, last_said: lastLine });
      } catch (err) {
        if (err.status === 401 || err.status === 429) return fail(err.message);
        return say(LINES.again);
      }
    }
    if (call.name === 'ask_user') return say(String(call.args?.text || LINES.again));
    await respond(checkin.handle(call.name, call.args));
  };

  const fail = (message) => {
    onState('error');
    onError(message);
  };

  const onEvent = (event) => {
    if (event.type === 'input_audio_buffer.speech_started') {
      // Barge-in: stop talking as soon as the user starts
      if (speaker.speaking) speaker.stop();
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      busy = busy.then(() => hear(event.transcript || ''));
    } else if (event.type === 'error') {
      console.error('[voice] transcription error', event.error);
    }
  };

  return {
    start: async () => {
      onState('connecting');
      const opening = checkin.start();
      state = stateFor(opening);
      speaker.warm([localStorage.getItem(GREETED_KEY) ? SHORT_GREETING : GREETING, ...Object.values(LINES), ...new Set(ACKS), "Got it, I've noted that.", ...warmLines]);
      // Listening is optional: without a connection the session still runs on typed/tapped input
      try {
        const { secret } = await mintToken('pipeline');
        if (stopped) return;
        connection = await connect({ secret, onEvent, onLevel, onClosed: () => !stopped && fail('The voice connection dropped.') });
        if (stopped) return connection.close();
      } catch (err) {
        fail(err.message);
        if (!import.meta.env.DEV) return;
      }
      if (opening.done) return respond(opening);
      // The full explanation once; after that people know the drill. Mic off while it plays:
      // it is long enough that echo would otherwise cut it short.
      const greeted = localStorage.getItem(GREETED_KEY);
      connection?.setMuted(true);
      await say(greeted ? SHORT_GREETING : GREETING);
      localStorage.setItem(GREETED_KEY, '1');
      if (stopped) return;
      connection?.setMuted(userMuted);
      await say(lineFor(opening));
    },
    stop: () => end('stopped'),
    setMuted: (muted) => {
      userMuted = muted;
      connection?.setMuted(muted);
    },
    sendText: (text) => { busy = busy.then(() => hear(text)); },
    // The user tapped a rating instead of speaking: move the conversation on
    advance: (result) => { busy = busy.then(() => !stopped && respond(result)); },
  };
};
