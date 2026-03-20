export const CATEGORY_HALF_LIVES = { fast: 0.5, moderate: 3, slow: 21 };

// Each entry: [tokens to match, category]
// Tokens are lowercase. A supplement matches if it contains any token set.
const LOOKUP_TABLE = [
  // Fast (~12 hours) — water-soluble vitamins, amino acids
  [['vitamin', 'c'], 'fast'],
  [['vitamin', 'b'], 'fast'],
  [['b1'], 'fast'],
  [['b2'], 'fast'],
  [['b3'], 'fast'],
  [['b5'], 'fast'],
  [['b6'], 'fast'],
  [['b12'], 'fast'],
  [['thiamine'], 'fast'],
  [['riboflavin'], 'fast'],
  [['niacin'], 'fast'],
  [['biotin'], 'fast'],
  [['folate'], 'fast'],
  [['folic', 'acid'], 'fast'],
  [['caffeine'], 'fast'],
  [['l-theanine'], 'fast'],
  [['theanine'], 'fast'],
  [['creatine'], 'fast'],
  [['glutamine'], 'fast'],
  [['taurine'], 'fast'],
  [['glycine'], 'fast'],
  [['melatonin'], 'fast'],
  [['ashwagandha'], 'fast'],

  // Moderate (~3 days) — minerals, some compounds
  [['magnesium'], 'moderate'],
  [['mag'], 'moderate'],
  [['zinc'], 'moderate'],
  [['iron'], 'moderate'],
  [['selenium'], 'moderate'],
  [['calcium'], 'moderate'],
  [['potassium'], 'moderate'],
  [['chromium'], 'moderate'],
  [['copper'], 'moderate'],
  [['manganese'], 'moderate'],
  [['iodine'], 'moderate'],
  [['coq10'], 'moderate'],
  [['probiotics'], 'moderate'],
  [['turmeric'], 'moderate'],
  [['curcumin'], 'moderate'],
  [['berberine'], 'moderate'],
  [['nac'], 'moderate'],
  [['alpha', 'lipoic'], 'moderate'],

  // Slow (~21 days) — fat-soluble vitamins, accumulated compounds
  [['vitamin', 'd'], 'slow'],
  [['vitamin', 'k'], 'slow'],
  [['vitamin', 'a'], 'slow'],
  [['vitamin', 'e'], 'slow'],
  [['fish', 'oil'], 'slow'],
  [['omega'], 'slow'],
  [['dha'], 'slow'],
  [['epa'], 'slow'],
  [['retinol'], 'slow'],
  [['cholecalciferol'], 'slow'],
  [['tocopherol'], 'slow'],
];

/**
 * Case-insensitive token matching against the lookup table.
 * Returns category string ('fast'|'moderate'|'slow') or null.
 */
export function matchSupplementCategory(name) {
  if (!name || typeof name !== 'string') return null;
  const nameTokens = name.toLowerCase().split(/[\s\-\/,]+/).filter(Boolean);
  if (nameTokens.length === 0) return null;

  for (const [matchTokens, category] of LOOKUP_TABLE) {
    if (matchTokens.every(token =>
      nameTokens.some(nt => nt.includes(token) || token.includes(nt))
    )) {
      return category;
    }
  }
  return null;
}
