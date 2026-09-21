// Talk mode backend (Cloudflare Worker). Holds the provider keys, verifies the caller's Firebase
// login, enforces a per-user daily cap, and hands the browser short-lived session tokens.
//
//   POST /gemini-token   -> { secret, model }   Gemini Live   (secret GEMINI_API_KEY)
//   POST /token          -> { secret }          OpenAI realtime (secret OPENAI_API_KEY)
//
// Deploy: `npx wrangler deploy` in this folder. Secrets: `npx wrangler secret put GEMINI_API_KEY`.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { GoogleGenAI, Modality } from '@google/genai';
import { GREETING, INSTRUCTIONS, TOOLS } from './dailyCheckinSpec.js';

const FIREBASE_PROJECT = 'symptoms-dae26';
const ORIGINS = ['https://nathanael.github.io', 'http://localhost:5173'];
// Per user, per UTC day. Generous for real use, tight enough that a leaked login can't run up a bill.
const DAILY_CAPS = { sessions: 20 };

// Model ids change often: override with vars in wrangler.toml rather than in code
const DEFAULTS = {
  TALK_GEMINI_MODEL: 'gemini-3.8-live',
  TALK_GEMINI_VOICE: 'Despina',
  // The Live API re-bills the whole context every turn. The app owns the checklist, so the model
  // needs almost no history: compress early. Set to 0 to turn compression off.
  TALK_GEMINI_TRIGGER_TOKENS: '4000',
  TALK_REALTIME_MODEL: 'gpt-realtime-2.1-mini',
  TALK_TRANSCRIBE_MODEL: 'gpt-live-transcribe',
  TALK_VOICE: 'marin',
};
const setting = (env, name) => env[name] || DEFAULTS[name];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const firebaseKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

const authenticate = async (req) => {
  const token = (req.headers.get('Authorization') || '').match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Sign in to use talk mode.');
  try {
    const { payload } = await jwtVerify(token, firebaseKeys, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT}`,
      audience: FIREBASE_PROJECT,
    });
    if (!payload.sub) throw new Error('no subject');
    return payload.sub;
  } catch {
    throw new HttpError(401, 'Sign in to use talk mode.');
  }
};

// One KV record per user per day. KV isn't transactional, so two simultaneous requests can
// under-count by one; fine for a spending guard.
const spend = async (env, uid, field, amount) => {
  const key = `usage:${uid}:${new Date().toISOString().slice(0, 10)}`;
  const usage = (await env.VOICE_USAGE.get(key, 'json')) || {};
  const next = (usage[field] || 0) + amount;
  if (next > DAILY_CAPS[field]) throw new HttpError(429, "You've hit today's talk mode limit. It resets at midnight UTC.");
  await env.VOICE_USAGE.put(key, JSON.stringify({ ...usage, [field]: next }), { expirationTtl: 60 * 60 * 48 });
};

const requireKey = (env, name) => {
  if (!env[name]) throw new HttpError(503, 'This talk mode voice is not set up yet.');
  return env[name];
};

const openai = async (env, path, body) => {
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireKey(env, 'OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('OpenAI error', path, res.status, await res.text());
    throw new HttpError(502, 'The voice service is unavailable right now.');
  }
  return res;
};

const opening = `The first message gives you the opening state. Start by saying this greeting, then ask the first symptom: "${GREETING}"`;

// The token is single-use, short-lived, and carries the whole session config, so the browser
// can't repurpose it for a different model or prompt.
const geminiToken = async (env, uid) => {
  const apiKey = requireKey(env, 'GEMINI_API_KEY');
  await spend(env, uid, 'sessions', 1);
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
  const trigger = Number(setting(env, 'TALK_GEMINI_TRIGGER_TOKENS'));
  const model = setting(env, 'TALK_GEMINI_MODEL');
  try {
    const created = await ai.authTokens.create({
      config: {
        uses: 1,
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        expireTime: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setting(env, 'TALK_GEMINI_VOICE') } } },
            systemInstruction: `${INSTRUCTIONS}\n\n${opening}`,
            // BLOCKING: the next question comes from the tool result, so the model has to wait for it
            tools: [{
              functionDeclarations: TOOLS.map((tool) => ({
                name: tool.name,
                description: tool.description,
                behavior: 'BLOCKING',
                ...(Object.keys(tool.parameters.properties).length > 0 ? { parametersJsonSchema: tool.parameters } : {}),
              })),
            }],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            // Live defaults to HIGH on both: it then hears its own voice from the speakers as the
            // user starting to talk, and cuts in the moment the user pauses mid-thought.
            realtimeInputConfig: {
              automaticActivityDetection: {
                startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
                endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
                silenceDurationMs: 1100,
              },
            },
            ...(trigger > 0 ? { contextWindowCompression: { triggerTokens: String(trigger), slidingWindow: { targetTokens: String(Math.round(trigger / 2)) } } } : {}),
          },
        },
      },
    });
    return Response.json({ secret: created.name, model, engine: 'gemini' });
  } catch (err) {
    console.error('Gemini token error', err);
    throw new HttpError(502, 'The voice service is unavailable right now.');
  }
};

const openaiToken = async (env, uid) => {
  requireKey(env, 'OPENAI_API_KEY');
  await spend(env, uid, 'sessions', 1);
  const session = {
    type: 'realtime',
    model: setting(env, 'TALK_REALTIME_MODEL'),
    instructions: `${INSTRUCTIONS}\n\n${opening}`,
    tools: TOOLS,
    audio: {
      input: {
        transcription: { model: setting(env, 'TALK_TRANSCRIBE_MODEL') },
        noise_reduction: { type: 'near_field' },
        // Low eagerness: wait through mid-sentence pauses rather than jumping in
        turn_detection: { type: 'semantic_vad', eagerness: 'low' },
      },
      output: { voice: setting(env, 'TALK_VOICE') },
    },
  };
  const data = await (await openai(env, '/realtime/client_secrets', { session })).json();
  return Response.json({ secret: data.value, expiresAt: data.expires_at, engine: 'realtime' });
};

const routes = { 'gemini-token': geminiToken, token: openaiToken };

const cors = (req) => {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
};

export default {
  async fetch(req, env) {
    const headers = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    let res;
    try {
      const route = routes[new URL(req.url).pathname.split('/').filter(Boolean).pop() || ''];
      if (!route || req.method !== 'POST') throw new HttpError(404, 'Not found.');
      const uid = await authenticate(req);
      res = await route(env, uid, await req.json().catch(() => ({})));
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      res = Response.json({ error: err instanceof HttpError ? err.message : 'Something went wrong.' }, { status: err instanceof HttpError ? err.status : 500 });
    }
    res = new Response(res.body, res);
    Object.entries(headers).forEach(([key, value]) => res.headers.set(key, value));
    return res;
  },
};
