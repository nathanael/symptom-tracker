// Imported statically on purpose. As a lazy chunk it broke every time a new version was deployed
// while the app was open: the old page asked for a chunk file the deploy had just replaced
// ("Importing a module script failed").
import { GoogleGenAI, Modality } from '@google/genai';
import { mintToken } from './voiceApi';
import { handEntryMessage } from './scripts/dailyCheckin';
import { createMic, createPlayer } from './pcmAudio';
import { geminiCost, geminiParts } from './pricing';

// Gemini Live: one speech-to-speech model over a WebSocket. Model, voice, instructions and tools
// are locked into the single-use token server-side; here we stream the mic up, play audio back,
// and run its tool calls. Interface: createXEngine({ checkin, onState, onCaption, onLevel, onError, onEnd })
// -> { start(), stop(), setMuted(bool), sendText(text), advance(toolResult) }.
export const createGeminiEngine = ({ checkin, onState, onCaption, onLevel, onError, onEnd }) => {
  let session = null;
  let mic = null;
  let player = null;
  let stopped = false;
  let closing = false; // we closed the socket ourselves; don't report it as a drop
  let ending = null; // 'paused' | 'finished' once the model has been told to wrap up
  let endTimer = null;
  let turnDone = true;
  let captions = { app: '', user: '' };
  const usages = []; // one per model turn, for the cost estimate
  let modelId = 'gemini';
  let quietUntil = 0;
  let greeted = false; // the mic is held back until the greeting has finished playing
  const startedAt = Date.now();

  const end = (reason) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(endTimer);
    player?.flush();
    mic?.close();
    try { session?.close(); } catch { /* already closed */ }
    const stats = { engine: 'Gemini', model: modelId, usd: geminiCost(usages), parts: geminiParts(usages), seconds: Math.round((Date.now() - startedAt) / 1000), turns: usages.length };
    console.info('[voice] gemini session', stats, usages);
    onEnd(reason, stats);
  };

  const fail = (message) => {
    onState('error');
    onError(message);
  };

  const tell = (text) => session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });

  // The model's turn is over and its audio has played out
  const settle = () => {
    if (stopped || !turnDone || player.playing) return;
    if (ending) return end(ending);
    greeted = true;
    onState('listening');
  };

  const runTools = (calls) => {
    const functionResponses = calls.map((call) => {
      const result = checkin.handle(call.name, call.args || {});
      if (result.paused) ending = 'paused';
      if (result.finished) ending = 'finished';
      return { id: call.id, name: call.name, response: result };
    });
    session.sendToolResponse({ functionResponses });
    // Let it say goodbye, but don't wait forever if no audio comes
    if (ending) endTimer = setTimeout(() => end(ending), 8000);
  };

  const onMessage = (message) => {
    if (stopped) return;
    if (message.usageMetadata) usages.push(message.usageMetadata);
    if (message.toolCall?.functionCalls?.length) {
      onState('thinking');
      runTools(message.toolCall.functionCalls);
    }
    if (message.goAway) console.warn('[voice] gemini closing soon', message.goAway.timeLeft);

    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      // Barge-in: the user spoke over the model
      player.flush();
      captions.app = '';
      onState('listening');
    }
    if (content.inputTranscription?.text) {
      captions.user += content.inputTranscription.text;
      onCaption({ who: 'user', text: captions.user.trim() });
    }
    if (content.outputTranscription?.text) {
      captions.app += content.outputTranscription.text;
      onCaption({ who: 'app', text: captions.app.trim() });
    }
    for (const part of content.modelTurn?.parts || []) {
      if (part.inlineData?.data) {
        turnDone = false;
        onState('speaking');
        player.play(part.inlineData.data);
      }
    }
    if (content.turnComplete) {
      turnDone = true;
      captions = { app: '', user: '' };
      settle();
    }
  };

  return {
    start: async () => {
      onState('connecting');
      // Before connecting, so the screen shows where we are (and taps work) even if voice fails
      const opening = checkin.start();
      try {
        player = createPlayer({ onIdle: settle });
        const { secret, model } = await mintToken('gemini');
        if (stopped) return;
        modelId = model;
        // Ephemeral tokens are only accepted on v1alpha
        const ai = new GoogleGenAI({ apiKey: secret, httpOptions: { apiVersion: 'v1alpha' } });
        session = await ai.live.connect({
          model,
          config: { responseModalities: [Modality.AUDIO] },
          callbacks: {
            onmessage: onMessage,
            onerror: (e) => console.error('[voice] gemini error', e?.message || e),
            onclose: (e) => {
              if (stopped || closing) return;
              console.warn('[voice] gemini closed', e?.code, e?.reason);
              fail('The voice connection dropped.');
            },
          },
        });
        if (stopped) return session.close();
      } catch (err) {
        return fail(err.message || "Couldn't start talk mode.");
      }
      try {
        mic = await createMic({
          onLevel,
          // Half-duplex: while she is talking (plus a short tail for room echo) the mic is not sent,
          // or on speakers she hears herself, takes it for the user, and interrupts her own sentence
          onChunk: (data) => {
            if (stopped) return;
            if (player.playing || !turnDone) quietUntil = Date.now() + 350;
            if (!greeted || Date.now() < quietUntil) return;
            session.sendRealtimeInput({ audio: { data, mimeType: mic?.mimeType || 'audio/pcm;rate=16000' } });
          },
        });
        if (stopped) return mic.close();
      } catch (err) {
        fail(err.message);
        // In development the session still runs on typed input, for testing without a microphone
        if (!import.meta.env.DEV) {
          closing = true;
          return session.close();
        }
      }
      tell(`Opening state from the app (not the user speaking): ${JSON.stringify(opening)}`);
    },
    stop: () => end('stopped'),
    setMuted: (muted) => mic?.setMuted(muted),
    // Where her voice is in the sentence, for the captions
    speechProgress: () => (player ? player.progress : 1),
    sendText: (text) => tell(text),
    // The user tapped a rating instead of speaking
    advance: (result) => tell(handEntryMessage(result)),
  };
};
