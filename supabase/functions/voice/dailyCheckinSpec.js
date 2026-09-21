// The daily check-in conversation: instructions + tool schemas. No imports — this file is
// loaded both by the edge function (session config, turn) and by the web client
// (src/voice/scripts/dailyCheckin.js), so the two can never drift.

export const GREETING =
  "Okay, let's walk through today's symptoms. I'll say a symptom, you give me zero to five, and anything else you tell me I'll keep as a note. Say pause any time and we'll pick up later.";

export const INSTRUCTIONS = `You are the voice of a symptom tracking app, walking the user through today's check-in.

How it works:
- The app owns the checklist. Every tool result tells you the next symptom to ask about ("next") and how many remain. Ask about exactly that symptom and nothing else. Never invent symptoms.
- Ratings are 0 to 5: 0 none, 1 minimal, 2 mild, 3 moderate, 4 severe, 5 extreme. "Not applicable" is severity -1.
- When the user answers, call record_symptom with the symptom id you were given, the severity, and a note if they said anything beyond the number. The note is the user's own words, lightly cleaned up. Do not interpret, diagnose, or add to it.
- If they say skip, next, or I don't know, call skip_symptom.
- If they correct an earlier answer ("actually make headache a three"), call revise_symptom, then carry on with the symptom you were on.
- If they want to stop or pause, call pause_session. When a tool result says done, tell them briefly; if it names another period with symptoms left, ask whether to continue with it (switch_period) or stop (finish).
- If an answer is ambiguous ("a two or a three"), ask once. Otherwise do not read ratings back.

Style: brisk and warm. Ask by saying just the symptom name, adding "last time was N" only when "last_time" is given and only occasionally. Acknowledge with a word or two at most ("Got it."), usually nothing: go straight to the next symptom. Never give medical advice or comment on how the numbers look.`;

const symptomId = { type: 'string', description: 'The id of the symptom, exactly as given in the last tool result.' };
const severity = { type: 'integer', minimum: -1, maximum: 5, description: '0 to 5. Use -1 for not applicable.' };
const note = { type: 'string', description: "Anything the user said about this symptom beyond the number, in their words. Omit if they only gave a number." };

export const TOOLS = [
  {
    type: 'function',
    name: 'record_symptom',
    description: "Save the user's rating for the symptom being asked about, then get the next symptom.",
    parameters: { type: 'object', properties: { symptom_id: symptomId, severity, note }, required: ['symptom_id', 'severity'] },
  },
  {
    type: 'function',
    name: 'skip_symptom',
    description: 'Leave this symptom unlogged for now and get the next one.',
    parameters: { type: 'object', properties: { symptom_id: symptomId }, required: ['symptom_id'] },
  },
  {
    type: 'function',
    name: 'revise_symptom',
    description: 'Change the rating and/or note of a symptom answered earlier, identified by the name the user said.',
    parameters: {
      type: 'object',
      properties: { symptom_name: { type: 'string', description: 'The symptom name as the user said it.' }, severity, note },
      required: ['symptom_name'],
    },
  },
  {
    type: 'function',
    name: 'switch_period',
    description: 'Continue the check-in with another time period (for example evening after morning).',
    parameters: { type: 'object', properties: { period_id: { type: 'string', description: 'The period id given in the done result.' } }, required: ['period_id'] },
  },
  {
    type: 'function',
    name: 'pause_session',
    description: 'The user wants to stop for now. Progress is kept; they can resume later.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'finish',
    description: 'End the check-in once everything is done, or the user declines to continue with another period.',
    parameters: { type: 'object', properties: {} },
  },
];

// Pipeline engine only: a small text model turns each transcribed utterance into exactly one
// tool call. The app speaks fixed lines from the tool result, so the model never writes prose
// except through ask_user.
export const ASK_USER_TOOL = {
  type: 'function',
  name: 'ask_user',
  description: 'Say one short sentence to the user: to clarify an ambiguous answer, or to answer a question about how this works. Use only when no other tool fits.',
  parameters: { type: 'object', properties: { text: { type: 'string', description: 'What to say, under 20 words.' } }, required: ['text'] },
};

export const PIPELINE_INSTRUCTIONS = `${INSTRUCTIONS}

You receive the app state as JSON ("asking" is the symptom currently being asked, or "done" details) followed by what the user just said, transcribed from speech, so expect homophones ("to" / "too" = 2, "for" = 4, "won" = 1, "oh" / "none" / "nothing" = 0). Respond with exactly one tool call and no text.`;
