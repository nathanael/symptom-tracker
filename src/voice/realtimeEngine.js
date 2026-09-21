import { mintToken } from './voiceApi';
import { handEntryMessage, LIVE_GUIDANCE } from './scripts/dailyCheckin';
import { connect } from './webrtcConnection';

// The natural engine: one speech-to-speech model hears, decides and talks. Instructions and tools
// are fixed server-side when the token is minted; here we run its tool calls and feed back results.
// Same interface as createPipelineEngine.
export const createRealtimeEngine = ({ checkin, onState, onCaption, onLevel, onError, onEnd }) => {
  let connection = null;
  let stopped = false;
  let ending = null; // 'paused' | 'finished' once the model has been told to wrap up
  let endTimer = null;
  let appCaption = '';

  const end = (reason) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(endTimer);
    connection?.close();
    onEnd(reason);
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
        onState('thinking');
        break;
      case 'response.output_audio_transcript.delta':
        appCaption += event.delta || '';
        onCaption({ who: 'app', text: appCaption });
        onState('speaking');
        break;
      case 'output_audio_buffer.stopped':
        if (ending) end(ending);
        else onState('listening');
        break;
      case 'response.done': {
        const calls = (event.response?.output || []).filter((item) => item.type === 'function_call');
        if (calls.length > 0) runTools(calls);
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
        const { secret } = await mintToken('realtime');
        if (stopped) return;
        connection = await connect({ secret, onEvent, onLevel, playRemoteAudio: true, onClosed: () => !stopped && fail('The voice connection dropped.') });
        if (stopped) return connection.close();
      } catch (err) {
        return fail(err.message);
      }
      tell(`${LIVE_GUIDANCE}\n\nOpening state: ${JSON.stringify(opening)}`);
    },
    stop: () => end('stopped'),
    setMuted: (muted) => connection?.setMuted(muted),
    sendText: (text) => connection && tell(text),
    // The user tapped a rating instead of speaking
    advance: (result) => connection && tell(handEntryMessage(result)),
  };
};
