import { micErrorMessage } from './webrtcConnection';
import { createResampler } from './resample';

// Raw PCM in and out for engines that speak over a WebSocket rather than WebRTC (Gemini Live):
// the mic as 16 kHz 16-bit chunks, and a gapless player for the 24 kHz chunks that come back.
//
// Both run on ONE AudioContext at the device's own rate. An iPhone has a single hardware rate, and
// a second context asking for a different one (16 kHz to capture beside 24 kHz to play) can leave
// the first frozen: its clock stops, nothing plays, and the conversation hangs on her first word.
// So the mic is resampled down in JS, and playback buffers carry their own 24 kHz rate.

const MIC_RATE = 16000;
const PLAY_RATE = 24000;

const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = []; this.size = 0; }
  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;
    this.buffer.push(new Float32Array(input));
    this.size += input.length;
    if (this.size >= sampleRate / 10) { // ~100 ms
      const out = new Float32Array(this.size);
      let offset = 0;
      for (const chunk of this.buffer) { out.set(chunk, offset); offset += chunk.length; }
      this.port.postMessage(out, [out.buffer]);
      this.buffer = []; this.size = 0;
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

const toBase64 = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const fromBase64 = (data) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

// iOS only starts an AudioContext inside a tap, and talk mode speaks after async work, so the
// launch tap creates and resumes the playback context up front.
let playContext = null;
// `fresh` (the launch tap) replaces the context: on iOS one that has lived through an earlier
// session's mic capture or a WebRTC call can report "running" and still play nothing.
export const primePlayback = ({ fresh = false } = {}) => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (fresh && playContext) {
    playContext.close().catch(() => {});
    playContext = null;
  }
  playContext = playContext || new Ctx();
  playContext.resume().catch(() => {});
};

// The shared context, checked: running with its clock advancing. One that is not (iOS can freeze it
// when capture starts) is replaced, which the browser allows without a tap while the mic is live.
const workletLoaded = new WeakSet();
const healthyContext = async () => {
  primePlayback();
  await playContext.resume().catch(() => {});
  const before = playContext.currentTime;
  await new Promise((resolve) => setTimeout(resolve, 160));
  if (playContext.state !== 'running' || playContext.currentTime === before) {
    console.warn('[voice] audio context stalled, replacing it', playContext.state);
    primePlayback({ fresh: true });
    await playContext.resume().catch(() => {});
  }
  return playContext;
};

// onChunk(base64 PCM16 @ 16 kHz), onLevel(0..1)
export const createMic = async ({ onChunk, onLevel }) => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (err) {
    throw new Error(micErrorMessage(err));
  }
  // After capture has started: that is the moment iOS may stall a context made before it
  const context = await healthyContext();
  if (!workletLoaded.has(context)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
      workletLoaded.add(context);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const node = new AudioWorkletNode(context, 'pcm-capture');
  const source = context.createMediaStreamSource(stream);
  let muted = false;
  // Down from the device rate to the 16 kHz the model takes
  const resample = createResampler(context.sampleRate, MIC_RATE);
  node.port.onmessage = (e) => {
    const { pcm, peak } = resample(e.data);
    onLevel?.(muted ? 0 : Math.min(1, peak * 2));
    if (!muted && pcm.length) onChunk(toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)));
  };
  source.connect(node);

  return {
    mimeType: `audio/pcm;rate=${MIC_RATE}`,
    setMuted: (value) => { muted = value; },
    close: () => {
      node.port.onmessage = null;
      try { source.disconnect(); } catch { /* already gone */ }
      stream.getTracks().forEach((track) => track.stop());
    },
  };
};

// Plays base64 PCM16 @ 24 kHz chunks back to back. onIdle fires when the queue runs dry.
export const createPlayer = ({ onIdle } = {}) => {
  primePlayback();
  const sources = new Set();
  let nextStart = 0;
  let turnStart = 0; // context time this run of audio began

  return {
    play: (data) => {
      // Looked up each time: the mic may have replaced a stalled context since this player was made
      const context = playContext;
      if (!context) return;
      // Opening the mic can suspend or interrupt the context on iOS
      if (context.state !== 'running') context.resume().catch(() => {});
      const bytes = fromBase64(data);
      const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
      const buffer = context.createBuffer(1, pcm.length, PLAY_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      if (sources.size === 0) turnStart = Math.max(nextStart, context.currentTime + 0.03);
      nextStart = Math.max(nextStart, context.currentTime + 0.03);
      source.start(nextStart);
      nextStart += buffer.duration;
      sources.add(source);
      source.onended = () => {
        sources.delete(source);
        if (sources.size === 0) onIdle?.();
      };
    },
    // Barge-in: drop everything queued
    flush: () => {
      sources.forEach((source) => {
        source.onended = null;
        try { source.stop(); } catch { /* already stopped */ }
      });
      sources.clear();
      nextStart = 0;
      turnStart = 0;
    },
    get playing() { return sources.size > 0; },
    // How far through the audio queued for this turn we are, 0..1. More audio arriving extends the
    // queue, so this eases forward rather than jumping; 1 once everything queued has played.
    get progress() {
      const context = playContext;
      if (!context || sources.size === 0) return 1;
      const total = nextStart - turnStart;
      return total > 0 ? Math.min(1, Math.max(0, (context.currentTime - turnStart) / total)) : 0;
    },
  };
};
