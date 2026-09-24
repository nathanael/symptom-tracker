// One WebRTC call to the OpenAI Realtime API: microphone up, events (and, for speech-to-speech
// sessions, the model's audio) down. Authenticated with a short-lived client secret.
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

// `feature` names what needs the mic, so talk mode and voice notes each read right
export const micErrorMessage = (err, feature = 'talk mode') => {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return `Microphone access is blocked. Allow it for this site to use ${feature}.`;
  if (err?.name === 'NotFoundError') return 'No microphone found.';
  return "Couldn't start the microphone.";
};

// iOS Safari only plays an <audio> element without a tap if it has already played inside one (or
// while the page is capturing the mic, which is not something to lean on). The launch tap creates
// and primes this shared element; connect() then attaches the model's audio to it.
let remoteAudio = null;
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
export const primeRemoteAudio = () => {
  if (!remoteAudio) {
    remoteAudio = new Audio();
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;
  }
  remoteAudio.srcObject = null;
  remoteAudio.src = SILENCE;
  remoteAudio.play().catch(() => {});
};

export const connect = async ({ secret, onEvent, onLevel, onClosed, playRemoteAudio = false, feature }) => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    // Named, so a caller can tell "the mic" apart from "the connection" without matching strings
    const micError = new Error(micErrorMessage(err, feature));
    micError.name = 'MicError';
    throw micError;
  }

  const pc = new RTCPeerConnection();
  const micTrack = stream.getAudioTracks()[0];
  const sender = pc.addTrack(micTrack, stream);

  let audioEl = null;
  if (playRemoteAudio) {
    if (!remoteAudio) primeRemoteAudio();
    audioEl = remoteAudio;
    pc.ontrack = (e) => {
      audioEl.removeAttribute('src');
      audioEl.srcObject = e.streams[0];
      audioEl.play().catch((err) => console.warn('[voice] remote audio blocked', err?.name));
    };
  }

  const channel = pc.createDataChannel('oai-events');
  channel.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch (err) {
      console.error('[voice] bad event', err);
    }
  };
  const opened = new Promise((resolve, reject) => {
    channel.onopen = resolve;
    channel.onerror = () => reject(new Error('The voice connection failed.'));
  });

  // Mic level for the UI pulse, 0..1
  let levelTimer = null;
  let audioCtx = null;
  if (onLevel) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      onLevel(Math.min(1, peak / 64));
    }, 80);
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(levelTimer);
    audioCtx?.close().catch(() => {});
    stream.getTracks().forEach((track) => track.stop());
    if (audioEl) audioEl.srcObject = null;
    channel.close();
    pc.close();
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && !closed) {
      close();
      onClosed?.();
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch(CALLS_URL, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' }, body: offer.sdp });
    if (!res.ok) throw new Error('The voice service refused the connection.');
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    await opened;
  } catch (err) {
    close();
    throw err;
  }

  return {
    send: (event) => channel.readyState === 'open' && channel.send(JSON.stringify(event)),
    // Stop or resume SENDING the mic without touching the capture itself. Disabling the track
    // (track.enabled = false) makes iOS Safari treat the page as no longer capturing: it then
    // blocks the model's audio and the mic does not come back cleanly.
    setMuted: (muted) => sender.replaceTrack(muted ? null : micTrack).catch((err) => console.warn('[voice] mic switch failed', err?.name)),
    close,
  };
};
