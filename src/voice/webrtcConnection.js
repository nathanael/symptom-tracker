// One WebRTC call to the OpenAI Realtime API: microphone up, events (and, for speech-to-speech
// sessions, the model's audio) down. Authenticated with a short-lived client secret.
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

export const micErrorMessage = (err) => {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'Microphone access is blocked. Allow it for this site to use talk mode.';
  if (err?.name === 'NotFoundError') return 'No microphone found.';
  return "Couldn't start the microphone.";
};

export const connect = async ({ secret, onEvent, onLevel, onClosed, playRemoteAudio = false }) => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    throw new Error(micErrorMessage(err));
  }

  const pc = new RTCPeerConnection();
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  let audioEl = null;
  if (playRemoteAudio) {
    audioEl = new Audio();
    audioEl.autoplay = true;
    pc.ontrack = (e) => { audioEl.srcObject = e.streams[0]; };
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
    setMuted: (muted) => stream.getAudioTracks().forEach((track) => { track.enabled = !muted; }),
    close,
  };
};
