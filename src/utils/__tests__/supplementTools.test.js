import { describe, it, expect } from 'vitest';
import { mergeSupplements, previewMerge, renameSupplement, deleteSupplement, previewDelete } from '../supplementTools';

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

describe('previewDelete', () => {
  it('counts entries for the target', () => {
    const stackEntries = {
      '2026-03-01-item-1': { date: '2026-03-01', itemId: 'item-1', dose: 100, taken: true },
      '2026-03-02-item-1': { date: '2026-03-02', itemId: 'item-1', dose: 200, taken: true },
      '2026-03-01-item-2': { date: '2026-03-01', itemId: 'item-2', dose: 50, taken: true },
    };
    const result = previewDelete(stackEntries, 'item-1');
    expect(result.entryCount).toBe(2);
  });

  it('returns zero for item with no entries', () => {
    const result = previewDelete({}, 'item-1');
    expect(result.entryCount).toBe(0);
  });
});

describe('deleteSupplement', () => {
  const stackItems = [
    { id: 'item-1', name: 'B1', unit: 'mg', defaultDose: 100, active: true },
    { id: 'item-2', name: 'Magnesium', unit: 'mg', defaultDose: 400, active: true },
  ];

  it('removes item and all its entries', () => {
    const stackEntries = {
      '2026-03-01-item-1': { date: '2026-03-01', itemId: 'item-1', dose: 100, taken: true },
      '2026-03-02-item-1': { date: '2026-03-02', itemId: 'item-1', dose: 200, taken: true },
      '2026-03-01-item-2': { date: '2026-03-01', itemId: 'item-2', dose: 50, taken: true },
    };
    const result = deleteSupplement(stackItems, stackEntries, 'item-1');
    expect(result.stackItems).toHaveLength(1);
    expect(result.stackItems[0].id).toBe('item-2');
    expect(Object.keys(result.stackEntries)).toHaveLength(1);
    expect(result.stackEntries['2026-03-01-item-2']).toBeDefined();
    expect(result.deletedCount).toBe(2);
  });

  it('handles item with zero entries', () => {
    const result = deleteSupplement(stackItems, {}, 'item-1');
    expect(result.stackItems).toHaveLength(1);
    expect(result.deletedCount).toBe(0);
  });
});

describe('renameSupplement', () => {
  const stackItems = [
    { id: 'item-1', name: 'B1', unit: 'mg', defaultDose: 100, active: true, history: [] },
    { id: 'item-2', name: 'Magnesium', unit: 'mg', defaultDose: 400, active: true, history: [] },
  ];

  it('updates name and adds history entry', () => {
    const result = renameSupplement(stackItems, 'item-1', 'Vitamin B1');
    expect(result).toHaveLength(2);
    const renamed = result.find(i => i.id === 'item-1');
    expect(renamed.name).toBe('Vitamin B1');
    expect(renamed.history).toHaveLength(1);
    expect(renamed.history[0].type).toBe('updated');
    expect(renamed.history[0].changes.name).toEqual({ from: 'B1', to: 'Vitamin B1' });
  });

  it('does not modify other items', () => {
    const result = renameSupplement(stackItems, 'item-1', 'Vitamin B1');
    const other = result.find(i => i.id === 'item-2');
    expect(other.name).toBe('Magnesium');
    expect(other.history).toHaveLength(0);
  });
});
