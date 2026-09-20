import { describe, it, expect } from 'vitest';
import { suggestGroup, groupNames, groupSymptoms, availableGroups, nextGroupOrder, groupColor, DEFAULT_GROUPS, UNGROUPED_COLOR } from '../symptomGroups';

describe('suggestGroup', () => {
  it('suggests a group from the name a person typed', () => {
    expect(suggestGroup('Bloating after meals')).toBe('Gut');
    expect(suggestGroup('Diarrhea / Loose stool')).toBe('Gut');
    expect(suggestGroup('Irritability')).toBe('Mood');
    expect(suggestGroup('Brain fog')).toBe('Mood');
    expect(suggestGroup('Neuropathy')).toBe('Nerve & pain');
    expect(suggestGroup('Malassezia flare')).toBe('Skin');
  });

  it('uses the description too', () => {
    expect(suggestGroup('Flare', 'Red chest and blotchy skin')).toBe('Skin');
  });

  it('returns null when nothing matches, and matches whole-word prefixes only', () => {
    expect(suggestGroup('Urinary urgency')).toBe(null);
    expect(suggestGroup('')).toBe(null);
    expect(suggestGroup('Megaspore')).toBe(null); // contains "gas" but no word starts with it
  });

  it('only ever picks from the groups it is given', () => {
    expect(suggestGroup('Bloating', '', ['Mood', 'Skin'])).toBe(null);
    expect(suggestGroup('Bloating', '', ['My custom group'])).toBe(null);
  });
});

describe('grouping', () => {
  const symptoms = [
    { id: 'a', group: 'Mood', groupOrder: 1 },
    { id: 'b' },
    { id: 'c', group: 'Gut', groupOrder: 0 },
    { id: 'd', group: 'Mood', groupOrder: 1 },
  ];

  it('orders groups by groupOrder and keeps the person\'s order inside each', () => {
    expect(groupNames(symptoms)).toEqual(['Gut', 'Mood']);
    expect(groupSymptoms(symptoms).map((g) => [g.name, g.rows.map((r) => r.id)])).toEqual([
      ['Gut', ['c']], ['Mood', ['a', 'd']], [null, ['b']],
    ]);
  });

  it('omits the ungrouped section when empty and can show not-yet-used groups', () => {
    const all = [{ id: 'a', group: 'Gut', groupOrder: 0 }];
    expect(groupSymptoms(all, ['New one']).map((g) => g.name)).toEqual(['Gut', 'New one']);
  });

  it('offers groups in use first, then unused defaults, without duplicates', () => {
    expect(availableGroups([{ id: 'a', group: 'Sleep', groupOrder: 0 }, { id: 'b', group: 'Gut', groupOrder: 1 }]))
      .toEqual(['Sleep', 'Gut', ...DEFAULT_GROUPS.filter((g) => g !== 'Gut')]);
  });

  it('treats a renamed default as the same group: no duplicate option, suggestions still land in it', () => {
    const renamed = [{ id: 'a', group: 'Nerve', groupOrder: 0 }];
    expect(availableGroups(renamed)).toEqual(['Nerve', 'Gut', 'Mood', 'Skin']);
    expect(suggestGroup('Migraine', '', availableGroups(renamed))).toBe('Nerve');
  });

  it('puts a new group after the existing ones', () => {
    expect(nextGroupOrder(symptoms)).toBe(2);
    expect(nextGroupOrder([])).toBe(0);
  });

  it('gives every group a stable colour', () => {
    expect(groupColor('Gut')).toBe('#fb923c');
    expect(groupColor('Sleep')).toBe(groupColor('Sleep'));
    expect(groupColor(null)).toBe(UNGROUPED_COLOR);
  });
});
