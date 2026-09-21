// Normalising a meal reply from the model.
//
// The worker asks Gemini for a response schema, but a model reply is still
// untrusted input: it can arrive with the wrong shape, duplicates, blanks, or
// an unbounded list. Everything the app stores passes through here first.
//
// This function is total: it never throws, even on poisoned input (objects
// with throwing getters, items whose toString() throws, etc.). Any exception
// during normalisation degrades gracefully: bad properties fall back to empty
// strings/arrays, and bad ingredients are skipped.
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
  let obj = {};
  try {
    obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  } catch {
    return { name: '', ingredients: [] };
  }

  let name = '';
  try {
    name = typeof obj.name === 'string' ? obj.name.trim().slice(0, MAX_NAME) : '';
  } catch {
    // name stays ''
  }

  const ingredients = [];
  const seen = new Set();
  let ingredientsList;
  try {
    ingredientsList = obj.ingredients;
  } catch {
    ingredientsList = undefined;
  }

  if (Array.isArray(ingredientsList)) {
    for (const item of ingredientsList) {
      if (item == null) continue;
      let value;
      try {
        value = String(item).trim().toLowerCase();
      } catch {
        continue;
      }
      if (!value || seen.has(value)) continue;
      seen.add(value);
      ingredients.push(value);
      if (ingredients.length === MAX_INGREDIENTS) break;
    }
  }

  return { name, ingredients };
}
