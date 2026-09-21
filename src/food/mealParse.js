// Normalising a meal reply from the model.
//
// The worker asks Gemini for a response schema, but a model reply is still
// untrusted input: it can arrive with the wrong shape, duplicates, blanks, or
// an unbounded list. Everything the app stores passes through here first.
//
// Ingredients are lowercased so that "Egg" logged today and "egg" logged
// tomorrow are the same thing when this data is eventually correlated.
//
// Pure module.

const MAX_INGREDIENTS = 40;
const MAX_NAME = 80;

/**
 * @param {unknown} raw
 * @returns {{ name: string, ingredients: string[] }}
 */
export function normalizeMeal(raw) {
  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

  const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, MAX_NAME) : '';

  const ingredients = [];
  const seen = new Set();
  if (Array.isArray(obj.ingredients)) {
    for (const item of obj.ingredients) {
      if (item == null) continue;
      const value = String(item).trim().toLowerCase();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      ingredients.push(value);
      if (ingredients.length === MAX_INGREDIENTS) break;
    }
  }

  return { name, ingredients };
}
