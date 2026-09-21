// Client for the meal analysis route on the glimpse-voice worker.
//
// The worker holds the Gemini key; this sends one photo or one description and gets back a dish
// name and an ingredient list. The photo is not stored anywhere — the caller drops it as soon as
// this resolves.

import { BASE, post, VoiceApiError } from '../voice/voiceApi';
import { normalizeMeal } from './mealParse';

/**
 * @param {{ image?: string, text?: string }} input - base64 JPEG (no data: prefix) or a description
 * @returns {Promise<{ name: string, ingredients: string[] }>}
 */
export const analyzeMeal = async ({ image, text } = {}) => {
  const body = image ? { image } : text ? { text } : null;
  if (!body) throw new VoiceApiError(400, 'Take a photo or describe the meal.');
  return normalizeMeal(await (await post(`${BASE}/meal`, body)).json());
};
