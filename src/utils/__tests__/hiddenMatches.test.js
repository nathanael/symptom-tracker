import { describe, it, expect } from 'vitest';
import { findHiddenMatches } from '../../components/HiddenSearchResults';

const items = [
  { id: 'a', name: 'Headache', active: true },
  { id: 'b', name: 'Head pressure', active: false },
  { id: 'c', name: 'Headband rash', active: false, deletedAt: '2026-09-01T00:00:00Z' },
  { id: 'd', name: 'Fatigue', active: false, description: 'head feels heavy' },
];

describe('findHiddenMatches', () => {
  it('returns nothing without a search', () => {
    expect(findHiddenMatches('  ', [['symptom', items]])).toEqual([]);
  });
  it('finds hidden and deleted items by name or description, never active ones', () => {
    const r = findHiddenMatches('head', [['symptom', items]]);
    expect(r.map((m) => [m.item.id, m.deleted])).toEqual([['d', false], ['b', false], ['c', true]]);
  });
  it('skips ids already shown', () => {
    expect(findHiddenMatches('head', [['symptom', items]], new Set(['b'])).map((m) => m.item.id)).toEqual(['d', 'c']);
  });
});
