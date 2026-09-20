// Symptom groups ("My groups" on the Symptoms tab).
//
// A symptom's group lives ON the symptom (`group` = the group's name, `groupOrder` = where that
// group sits in the list), so groups sync with the symptoms themselves and need no store of
// their own. A group therefore exists exactly as long as something is in it.

// Few on purpose. Anything that fits none of these stays ungrouped.
export const DEFAULT_GROUPS = ['Gut', 'Mood', 'Nerve & pain', 'Skin'];

const DEFAULT_COLORS = { Gut: '#fb923c', Mood: '#a78bfa', 'Nerve & pain': '#38bdf8', Skin: '#f472b6' };
const CUSTOM_COLORS = ['#4ade80', '#facc15', '#2dd4bf', '#f87171', '#c084fc', '#94a3b8'];
export const UNGROUPED_COLOR = '#6b7280';

export const groupColor = (name) => {
  if (!name) return UNGROUPED_COLOR;
  const asDefault = DEFAULT_GROUPS.find((d) => firstWord(d) === firstWord(name)); // a renamed default keeps its colour
  if (asDefault) return DEFAULT_COLORS[asDefault];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return CUSTOM_COLORS[hash % CUSTOM_COLORS.length];
};

// Word list for suggesting a group from whatever name the person typed. Whole-word prefixes,
// so "bloat" matches "Bloating" but "gas" does not match "Gasping".
const KEYWORDS = {
  Gut: ['gut', 'stomach', 'bowel', 'stool', 'diarrhea', 'diarrhoea', 'constipat', 'bloat', 'gas', 'fart', 'burp', 'belch',
    'reflux', 'heartburn', 'bile', 'nausea', 'vomit', 'cramp', 'indigest', 'appetite', 'ibs', 'abdominal', 'abdomen', 'dysphagia', 'swallow'],
  Mood: ['mood', 'anxiety', 'anxious', 'depress', 'irritab', 'anger', 'angry', 'rage', 'panic', 'stress', 'withdraw', 'motivation',
    'apathy', 'sad', 'fog', 'focus', 'concentrat', 'memory', 'libido', 'drive', 'lonely', 'overwhelm'],
  'Nerve & pain': ['nerve', 'neuropath', 'pain', 'ache', 'headache', 'migraine', 'tingl', 'numb', 'burning', 'fascia', 'fascial',
    'tight', 'stiff', 'spasm', 'twitch', 'tremor', 'dizz', 'vertigo', 'tinnitus', 'sciatica', 'joint', 'muscle'],
  Skin: ['skin', 'rash', 'itch', 'flush', 'hives', 'eczema', 'psoriasis', 'acne', 'dermatitis', 'malassezia', 'dandruff',
    'thrush', 'blister', 'redness', 'blotch', 'peeling', 'dry skin'],
};

// Suggest a group for a symptom name, choosing only from `available` group names. null = no idea.
export const suggestGroup = (name, description = '', available = DEFAULT_GROUPS) => {
  const words = `${name || ''} ${description || ''}`.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0) return null;
  let best = null;
  let bestScore = 0;
  for (const group of available) {
    // A renamed default ("Nerve & pain" -> "Nerve") keeps its word list
    const keys = KEYWORDS[group] || KEYWORDS[DEFAULT_GROUPS.find((d) => firstWord(d) === firstWord(group))];
    if (!keys) continue;
    const score = words.filter((w) => keys.some((k) => w.startsWith(k))).length;
    if (score > bestScore) { best = group; bestScore = score; }
  }
  return best;
};

// Group names in display order, from the symptoms that carry them
export const groupNames = (symptoms) => {
  const order = new Map();
  for (const s of symptoms) {
    if (!s.group) continue;
    const at = typeof s.groupOrder === 'number' ? s.groupOrder : Number.MAX_SAFE_INTEGER;
    if (!order.has(s.group) || at < order.get(s.group)) order.set(s.group, at);
  }
  return [...order.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([name]) => name);
};

// [{ name, rows }] in display order; the ungrouped section (name null) comes last and only when non-empty.
// `symptoms` must already be in the person's own order; that order is kept inside each group.
export const groupSymptoms = (symptoms, extraNames = []) => {
  const names = [...groupNames(symptoms), ...extraNames.filter((n) => !symptoms.some((s) => s.group === n))];
  const sections = names.map((name) => ({ name, rows: symptoms.filter((s) => s.group === name) }));
  const loose = symptoms.filter((s) => !s.group);
  if (loose.length > 0) sections.push({ name: null, rows: loose });
  return sections;
};

// Groups offered in a symptom's Group menu: the ones in use, then any unused defaults
// A default counts as already covered when a group in use shares its first word, so renaming
// "Nerve & pain" to "Nerve" does not bring "Nerve & pain" back as a second option.
const firstWord = (name) => name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
export const availableGroups = (symptoms, extraNames = []) => {
  const used = [...new Set([...groupNames(symptoms), ...extraNames])];
  const taken = new Set(used.map(firstWord));
  return [...used, ...DEFAULT_GROUPS.filter((g) => !taken.has(firstWord(g)))];
};

// groupOrder for a group that is about to get its first member: after every existing group
export const nextGroupOrder = (symptoms) =>
  Math.max(-1, ...symptoms.map((s) => (typeof s.groupOrder === 'number' ? s.groupOrder : -1))) + 1;
