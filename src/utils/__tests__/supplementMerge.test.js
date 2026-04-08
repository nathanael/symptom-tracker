import { describe, it, expect } from 'vitest';
import { mergeSupplements, previewMerge } from '../supplementMerge';

describe('previewMerge', () => {
  it('counts source entries and conflicts', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 100, taken: true },
      '2026-03-02-src-123': { date: '2026-03-02', itemId: 'src-123', dose: 200, taken: true },
      '2026-03-02-tgt-456': { date: '2026-03-02', itemId: 'tgt-456', dose: 150, taken: true },
      '2026-03-03-tgt-456': { date: '2026-03-03', itemId: 'tgt-456', dose: 300, taken: true },
    };
    const result = previewMerge(stackEntries, 'tgt-456', 'src-123');
    expect(result.sourceEntryCount).toBe(2);
    expect(result.targetEntryCount).toBe(2);
    expect(result.conflictCount).toBe(1);
  });

  it('returns zero counts for items with no entries', () => {
    const result = previewMerge({}, 'tgt-456', 'src-123');
    expect(result.sourceEntryCount).toBe(0);
    expect(result.targetEntryCount).toBe(0);
    expect(result.conflictCount).toBe(0);
  });
});

describe('mergeSupplements', () => {
  const stackItems = [
    { id: 'tgt-456', name: 'B1', unit: 'mg', defaultDose: 100, active: true, order: 0 },
    { id: 'src-123', name: 'Vitamin B1', unit: 'mg', defaultDose: 200, active: true, order: 1 },
    { id: 'other-789', name: 'Magnesium', unit: 'mg', defaultDose: 400, active: true, order: 2 },
  ];

  it('moves entries with no conflicts', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 100, taken: true },
      '2026-03-02-tgt-456': { date: '2026-03-02', itemId: 'tgt-456', dose: 150, taken: true },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'sum');
    expect(result.stackItems).toHaveLength(2);
    expect(result.stackItems.find(i => i.id === 'src-123')).toBeUndefined();
    expect(result.stackEntries['2026-03-01-tgt-456']).toEqual({
      date: '2026-03-01', itemId: 'tgt-456', dose: 100, taken: true,
    });
    expect(result.stackEntries['2026-03-02-tgt-456']).toEqual({
      date: '2026-03-02', itemId: 'tgt-456', dose: 150, taken: true,
    });
    expect(result.stackEntries['2026-03-01-src-123']).toBeUndefined();
    expect(Object.keys(result.stackEntries)).toHaveLength(2);
  });

  it('sums doses on conflict with strategy "sum"', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 100, taken: true },
      '2026-03-01-tgt-456': { date: '2026-03-01', itemId: 'tgt-456', dose: 150, taken: false },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'sum');
    expect(result.stackEntries['2026-03-01-tgt-456']).toEqual({
      date: '2026-03-01', itemId: 'tgt-456', dose: 250, taken: true,
    });
    expect(result.stackEntries['2026-03-01-src-123']).toBeUndefined();
  });

  it('keeps higher dose on conflict with strategy "higher"', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 300, taken: false },
      '2026-03-01-tgt-456': { date: '2026-03-01', itemId: 'tgt-456', dose: 150, taken: true },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'higher');
    expect(result.stackEntries['2026-03-01-tgt-456']).toEqual({
      date: '2026-03-01', itemId: 'tgt-456', dose: 300, taken: true,
    });
  });

  it('handles source with zero entries', () => {
    const stackEntries = {
      '2026-03-01-tgt-456': { date: '2026-03-01', itemId: 'tgt-456', dose: 150, taken: true },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'sum');
    expect(result.stackItems).toHaveLength(2);
    expect(result.stackItems.find(i => i.id === 'src-123')).toBeUndefined();
    expect(result.stackEntries['2026-03-01-tgt-456'].dose).toBe(150);
  });

  it('preserves unrelated entries', () => {
    const stackEntries = {
      '2026-03-01-src-123': { date: '2026-03-01', itemId: 'src-123', dose: 100, taken: true },
      '2026-03-01-other-789': { date: '2026-03-01', itemId: 'other-789', dose: 400, taken: true },
    };
    const result = mergeSupplements(stackItems, stackEntries, 'tgt-456', 'src-123', 'sum');
    expect(result.stackEntries['2026-03-01-other-789']).toEqual({
      date: '2026-03-01', itemId: 'other-789', dose: 400, taken: true,
    });
  });
});
