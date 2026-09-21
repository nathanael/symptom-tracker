// Estimated cost of one talk mode conversation, from the token counts the providers report as the
// session runs. USD per 1M tokens, paid tier, as published in September 2026. An estimate, not a
// bill: update the numbers when the providers change theirs.
export const PRICES = {
  gemini: { textIn: 0.75, audioIn: 3, textOut: 4.5, audioOut: 12 },
  // gpt-realtime-2.1-mini. Cached input is billed at a fraction of the normal rate.
  realtime: { textIn: 0.6, audioIn: 10, textOut: 2.4, audioOut: 20, cachedTextIn: 0.06, cachedAudioIn: 0.3 },
};

const perMillion = (tokens, price) => ((tokens || 0) * price) / 1e6;

// Gemini Live sends one usageMetadata per model turn; each turn's prompt is the whole context so
// far, which is why a long conversation costs more per turn than a short one.
export const geminiCost = (usages) => {
  const p = PRICES.gemini;
  const count = (details, modality) => (details || []).filter((d) => d.modality === modality).reduce((sum, d) => sum + (d.tokenCount || 0), 0);
  return usages.reduce((total, u) => {
    const promptAudio = count(u.promptTokensDetails, 'AUDIO');
    const responseAudio = count(u.responseTokensDetails, 'AUDIO');
    // Anything not itemized as audio (including tool results and thinking) is billed as text
    const promptText = Math.max(0, (u.promptTokenCount || 0) - promptAudio) + (u.toolUsePromptTokenCount || 0);
    const responseText = Math.max(0, (u.responseTokenCount || 0) - responseAudio) + (u.thoughtsTokenCount || 0);
    return total + perMillion(promptText, p.textIn) + perMillion(promptAudio, p.audioIn) + perMillion(responseText, p.textOut) + perMillion(responseAudio, p.audioOut);
  }, 0);
};

// OpenAI realtime reports usage on every response.done
export const realtimeCost = (usages) => {
  const p = PRICES.realtime;
  return usages.reduce((total, u) => {
    const input = u.input_token_details || {};
    const cached = input.cached_tokens_details || {};
    const output = u.output_token_details || {};
    const cachedText = cached.text_tokens || 0;
    const cachedAudio = cached.audio_tokens || 0;
    return total
      + perMillion(Math.max(0, (input.text_tokens || 0) - cachedText), p.textIn)
      + perMillion(Math.max(0, (input.audio_tokens || 0) - cachedAudio), p.audioIn)
      + perMillion(cachedText, p.cachedTextIn)
      + perMillion(cachedAudio, p.cachedAudioIn)
      + perMillion(output.text_tokens, p.textOut)
      + perMillion(output.audio_tokens, p.audioOut);
  }, 0);
};

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

// "~$0.043 · 2:10 · 14 turns · Gemini"
export const costSummary = ({ engine, usd, seconds, turns }) => {
  const amount = usd < 0.01 ? `${(usd * 100).toFixed(1)}¢` : `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
  return `~${amount} · ${clock(seconds)} · ${turns} turn${turns === 1 ? '' : 's'} · ${engine}`;
};
