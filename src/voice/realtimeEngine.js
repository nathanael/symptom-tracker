import { mintToken } from './voiceApi';
import { handEntryMessage } from './scripts/dailyCheckin';
import { connect } from './webrtcConnection';
import { realtimeCost } from './pricing';
import { totalWeight } from './speechPace';

// The natural engine: one speech-to-speech model hears, decides and talks. Instructions and tools
// are fixed server-side when the token is minted; here we run its tool calls and feed back results.
// Interface: createXEngine({ checkin, onState, onCaption, onLevel, onError, onEnd })
// -> { start(), stop(), setMuted(bool), sendText(text), advance(toolResult) }.
export const createRealtimeEngine = ({ checkin, onState, onCaption, onLevel, onError, onEnd }) => {
  let connection = null;
  let stopped = false;
  let ending = null; // 'paused' | 'finished' once the model has been told to wrap up
  let endTimer = null;
  let appCaption = '';
  const usages = []; // one per model response, for the cost estimate
  let modelId = 'openai realtime';
  // Half-duplex: the mic only reaches the model while it is the user's turn. On speakers the
  // model otherwise hears its own voice, takes it for the user, cuts itself off and starts a new
  // (billed) response, over and over.
  let userMuted = false;
  let modelBusy = true; // from connect until the greeting has finished playing
  let audioPlaying = false;
  let audioStartedAt = 0;
  // Syllables per second, corrected after every utterance she finishes
  let pace = 4.4;
  let releaseTimer = null;
  const applyMic = () => connection?.setMuted(userMuted || modelBusy);
  const holdMic = () => {
    clearTimeout(releaseTimer);
    modelBusy = true;
    applyMic();
  };
  // A short tail after she stops covers room echo; the long fallback covers a missed event
  const releaseMic = (delay = 350) => {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      modelBusy = false;
      applyMic();
    }, delay);
  };
  const startedAt = Date.now();

  const end = (reason) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(endTimer);
    clearTimeout(releaseTimer);
    connection?.close();
    const stats = { engine: 'OpenAI', model: modelId, usd: realtimeCost(usages), seconds: Math.round((Date.now() - startedAt) / 1000), turns: usages.length };
    console.info('[voice] openai session', stats, usages);
    onEnd(reason, stats);
  };

  const fail = (message) => {
    onState('error');
    onError(message);
  };

  const tell = (text) => {
    connection.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    connection.send({ type: 'response.create' });
  };

  const runTools = (calls) => {
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        // empty args: the handler answers with an error the model can recover from
      }
      const result = checkin.handle(call.name, args);
      if (result.paused) ending = 'paused';
      if (result.finished) ending = 'finished';
      connection.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) } });
    }
    connection.send({ type: 'response.create' });
    // Let it say goodbye, but don't wait forever if no audio comes
    if (ending) endTimer = setTimeout(() => end(ending), 6000);
  };

  const onEvent = (event) => {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        onState('listening');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) onCaption({ who: 'user', text: event.transcript.trim() });
        break;
      case 'response.created':
        appCaption = '';
        holdMic();
        onState('thinking');
        break;
      case 'output_audio_buffer.started':
        audioPlaying = true;
        audioStartedAt = Date.now();
        holdMic();
        break;
      case 'response.output_audio_transcript.delta':
        appCaption += event.delta || '';
        onCaption({ who: 'app', text: appCaption });
        onState('speaking');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        if (event.type === 'output_audio_buffer.stopped' && audioStartedAt) {
          const seconds = (Date.now() - audioStartedAt) / 1000;
          const said = totalWeight(appCaption.split(/\s+/).filter(Boolean));
          // Ignore the odd clipped or interrupted turn; ease towards the rest
          if (seconds > 0.8 && said > 3) pace += ((said / seconds) - pace) * 0.5;
        }
        audioPlaying = false;
        if (ending) return end(ending);
        releaseMic();
        onState('listening');
        break;
      case 'response.done': {
        if (event.response?.usage) usages.push(event.response.usage);
        const calls = (event.response?.output || []).filter((item) => item.type === 'function_call');
        if (calls.length > 0) runTools(calls);
        // A response with no speech (a tool call) never fires the audio events; one with speech
        // releases the mic when playback stops, with a fallback in case that event is missed
        else releaseMic(audioPlaying ? 20000 : 0);
        break;
      }
      case 'error':
        console.error('[voice] realtime error', event.error);
        break;
      default:
    }
  };

  return {
    start: async () => {
      onState('connecting');
      // Before connecting, so the screen shows where we are (and taps work) even if voice fails
      const opening = checkin.start();
      try {
        const { secret, model } = await mintToken('realtime');
        if (stopped) return;
        if (model) modelId = model;
        connection = await connect({ secret, onEvent, onLevel, playRemoteAudio: true, onClosed: () => !stopped && fail('The voice connection dropped.') });
        if (stopped) return connection.close();
        applyMic();
      } catch (err) {
        return fail(err.message);
      }
      tell(`Opening state from the app (not the user speaking): ${JSON.stringify(opening)}`);
    },
    stop: () => end('stopped'),
    // No timing from a remote audio track: estimate from an ordinary speaking pace
    speechProgress: () => {
      if (!audioPlaying) return 1;
      const seconds = totalWeight(appCaption.split(/\s+/).filter(Boolean)) / pace;
      return seconds > 0 ? Math.min(0.99, (Date.now() - audioStartedAt) / 1000 / seconds) : 0;
    },
    setMuted: (muted) => {
      userMuted = muted;
      applyMic();
    },
    sendText: (text) => connection && tell(text),
    // The user tapped a rating instead of speaking
    advance: (result) => connection && tell(handEntryMessage(result)),
  };
};
