// Client for the talk mode backend (cloudflare/voice). Every call carries the user's
// Firebase ID token; the function holds the provider keys.
const BASE = 'https://glimpse-voice.glimpse-voice.workers.dev';

export class VoiceApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const post = async (url, body) => {
  const user = window.firebase?.auth?.().currentUser;
  if (!user) throw new VoiceApiError(401, 'Sign in to use talk mode.');
  const token = await user.getIdToken();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new VoiceApiError(0, "Can't reach the voice service. Check your connection.");
  }
  if (!res.ok) {
    const message = (await res.json().catch(() => null))?.error || 'The voice service is unavailable right now.';
    throw new VoiceApiError(res.status, message);
  }
  return res;
};

// engine: 'gemini' | 'realtime' -> { secret, engine, ... }
export const mintToken = async (engine) => (await post(`${BASE}/${engine === 'gemini' ? 'gemini-token' : 'token'}`, { engine })).json();

