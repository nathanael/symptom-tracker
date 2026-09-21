import { micErrorMessage } from './webrtcConnection';

// Raw PCM in and out for engines that speak over a WebSocket rather than WebRTC (Gemini Live):
// the mic as 16 kHz 16-bit chunks, and a gapless player for the 24 kHz chunks that come back.

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
    if (this.size >= 1600) { // ~100 ms at 16 kHz
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
  playContext = playContext || new Ctx({ sampleRate: PLAY_RATE });
  playContext.resume().catch(() => {});
};

// onChunk(base64 PCM16 @ 16 kHz), onLevel(0..1)
export const createMic = async ({ onChunk, onLevel }) => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (err) {
    throw new Error(micErrorMessage(err));
  }
  const context = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: MIC_RATE });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(context, 'pcm-capture');
  let muted = false;
  node.port.onmessage = (e) => {
    const samples = e.data;
    let peak = 0;
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      peak = Math.max(peak, Math.abs(v));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    onLevel?.(muted ? 0 : Math.min(1, peak * 2));
    if (!muted) onChunk(toBase64(new Uint8Array(pcm.buffer)));
  };
  context.createMediaStreamSource(stream).connect(node);

  return {
    mimeType: `audio/pcm;rate=${context.sampleRate}`,
    setMuted: (value) => { muted = value; },
    close: () => {
      node.port.onmessage = null;
      stream.getTracks().forEach((track) => track.stop());
      context.close().catch(() => {});
    },
  };
};

// Plays base64 PCM16 @ 24 kHz chunks back to back. onIdle fires when the queue runs dry.
export const createPlayer = ({ onIdle } = {}) => {
  primePlayback();
  const context = playContext;
  const sources = new Set();
  let nextStart = 0;
  let turnStart = 0; // context time this run of audio began

  return {
    play: (data) => {
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
      if (!context || sources.size === 0) return 1;
      const total = nextStart - turnStart;
      return total > 0 ? Math.min(1, Math.max(0, (context.currentTime - turnStart) / total)) : 0;
    },
  };
};
