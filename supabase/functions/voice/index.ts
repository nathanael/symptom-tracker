// Talk mode backend (Supabase Edge Function, Deno). Holds the provider keys, verifies the
// caller's Firebase login, enforces a per-user daily cap, and hands the browser short-lived
// session tokens. Deployed with verify_jwt off: auth is the Firebase ID token, checked below.
//
//   POST /voice/gemini-token          -> { secret, model }      (GEMINI_API_KEY)
//   POST /voice/token { engine }      -> { secret }             (OPENAI_API_KEY)
//   POST /voice/turn { transcript, state } -> { tool }
//   POST /voice/speak { text }        -> audio/mpeg
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { GoogleGenAI, Modality } from 'npm:@google/genai@2';
import { GREETING, INSTRUCTIONS, PIPELINE_INSTRUCTIONS, TOOLS, ASK_USER_TOOL } from './dailyCheckinSpec.js';

const FIREBASE_PROJECT = 'symptoms-dae26';
const ORIGINS = ['https://nathanael.github.io', 'http://localhost:5173'];
// Per user, per UTC day. Generous for real use, tight enough that a leaked login can't run up a bill.
const DAILY_CAPS = { sessions: 20, turns: 800, tts_chars: 20000 };
const MAX_TTS_CHARS = 300;
const MAX_TRANSCRIPT_CHARS = 1000;

// Model ids change often: override with function secrets (e.g. TALK_GEMINI_MODEL) rather than in code
const env = (name: string, fallback = '') => Deno.env.get(name) || fallback;
const GEMINI_MODEL = () => env('TALK_GEMINI_MODEL', 'gemini-3.8-live');
const GEMINI_VOICE = () => env('TALK_GEMINI_VOICE', 'Despina');
// The Live API re-bills the whole context every turn. The app owns the checklist, so the model
// needs almost no history: compress early. Set to 0 to turn compression off.
const GEMINI_TRIGGER_TOKENS = () => Number(env('TALK_GEMINI_TRIGGER_TOKENS', '4000'));
const REALTIME_MODEL = () => env('TALK_REALTIME_MODEL', 'gpt-realtime-2.1-mini');
const TRANSCRIBE_MODEL = () => env('TALK_TRANSCRIBE_MODEL', 'gpt-live-transcribe');
const TEXT_MODEL = () => env('TALK_TEXT_MODEL', 'gpt-5.4-mini');
const TTS_MODEL = () => env('TALK_TTS_MODEL', 'gpt-4o-mini-tts');
const OPENAI_VOICE = () => env('TALK_VOICE', 'marin');

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const firebaseKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

const authenticate = async (req: Request) => {
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

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const spend = async (uid: string, field: keyof typeof DAILY_CAPS, amount: number) => {
  const { data, error } = await db.rpc('spend_voice', { p_uid: uid, p_field: field, p_amount: amount, p_cap: DAILY_CAPS[field] });
  if (error) {
    console.error('spend_voice failed', error);
    throw new HttpError(500, 'Something went wrong.');
  }
  if (!data) throw new HttpError(429, "You've hit today's talk mode limit. It resets at midnight UTC.");
};

// The Gemini key was saved in the dashboard under the project's name; accept either spelling
const SECRET_ALIASES: Record<string, string[]> = { GEMINI_API_KEY: ['GEMINI_API_KEY', 'Glimpse'] };

const requireKey = (name: string) => {
  const key = (SECRET_ALIASES[name] || [name]).map((alias) => env(alias)).find(Boolean);
  if (!key) throw new HttpError(503, 'This talk mode voice is not set up yet.');
  return key;
};

const openai = async (path: string, body: unknown) => {
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireKey('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
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
const geminiToken = async (uid: string) => {
  const apiKey = requireKey('GEMINI_API_KEY');
  await spend(uid, 'sessions', 1);
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
  const trigger = GEMINI_TRIGGER_TOKENS();
  const model = GEMINI_MODEL();
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
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICE() } } },
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

const openaiSession = (engine: string) => {
  const input = { transcription: { model: TRANSCRIBE_MODEL() }, noise_reduction: { type: 'near_field' } };
  if (engine === 'realtime') {
    return {
      type: 'realtime',
      model: REALTIME_MODEL(),
      instructions: `${INSTRUCTIONS}\n\n${opening}`,
      tools: TOOLS,
      audio: { input: { ...input, turn_detection: { type: 'semantic_vad' } }, output: { voice: OPENAI_VOICE() } },
    };
  }
  return { type: 'transcription', audio: { input: { ...input, turn_detection: { type: 'server_vad', silence_duration_ms: 700 } } } };
};

const openaiToken = async (uid: string, body: Record<string, unknown>) => {
  requireKey('OPENAI_API_KEY');
  const engine = body.engine === 'realtime' ? 'realtime' : 'pipeline';
  await spend(uid, 'sessions', 1);
  const data = await (await openai('/realtime/client_secrets', { session: openaiSession(engine) })).json();
  return Response.json({ secret: data.value, expiresAt: data.expires_at, engine });
};

// A small text model turns one transcribed utterance into exactly one tool call
const turn = async (uid: string, body: Record<string, unknown>) => {
  const transcript = String(body.transcript || '').slice(0, MAX_TRANSCRIPT_CHARS);
  if (!transcript.trim()) throw new HttpError(400, 'Empty transcript.');
  requireKey('OPENAI_API_KEY');
  await spend(uid, 'turns', 1);
  const data = await (await openai('/responses', {
    model: TEXT_MODEL(),
    instructions: PIPELINE_INSTRUCTIONS,
    input: `State: ${JSON.stringify(body.state ?? {}).slice(0, 2000)}\nUser said: ${transcript}`,
    tools: [...TOOLS, ASK_USER_TOOL],
    tool_choice: 'required',
    parallel_tool_calls: false,
    store: false,
  })).json();
  const call = data.output?.find((item: { type: string }) => item.type === 'function_call');
  if (!call) throw new HttpError(502, 'The voice service returned no action.');
  let args = {};
  try {
    args = JSON.parse(call.arguments || '{}');
  } catch {
    // leave args empty: the client's handler reports the bad call back as an error
  }
  return Response.json({ tool: { name: call.name, args } });
};

// The client caches clips by text, so each line is paid for once
const speak = async (uid: string, body: Record<string, unknown>) => {
  const text = String(body.text || '').trim().slice(0, MAX_TTS_CHARS);
  if (!text) throw new HttpError(400, 'Nothing to say.');
  requireKey('OPENAI_API_KEY');
  await spend(uid, 'tts_chars', text.length);
  const res = await openai('/audio/speech', {
    model: TTS_MODEL(),
    voice: OPENAI_VOICE(),
    input: text,
    instructions: 'Warm, brisk, conversational. Like a friendly nurse running through a checklist.',
    response_format: 'mp3',
  });
  return new Response(res.body, { headers: { 'Content-Type': 'audio/mpeg' } });
};

const routes: Record<string, (uid: string, body: Record<string, unknown>) => Promise<Response>> = {
  'gemini-token': geminiToken,
  token: openaiToken,
  turn,
  speak,
};

const cors = (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
};

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  let res: Response;
  try {
    const route = routes[new URL(req.url).pathname.split('/').filter(Boolean).pop() || ''];
    if (!route || req.method !== 'POST') throw new HttpError(404, 'Not found.');
    const uid = await authenticate(req);
    res = await route(uid, await req.json().catch(() => ({})));
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    res = Response.json({ error: err instanceof HttpError ? err.message : 'Something went wrong.' }, { status: err instanceof HttpError ? err.status : 500 });
  }
  Object.entries(headers).forEach(([key, value]) => res.headers.set(key, value));
  return res;
});
