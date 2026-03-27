import { describe, it, expect } from 'vitest';
import { applyHistoricalState } from '../helpers';

describe('applyHistoricalState', () => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const baseItem = {
    id: 'mag-1',
    name: 'Magnesium',
    defaultDose: 400,
    unit: 'mg',
    description: 'Glycinate',
    schedule: { type: 'daily', startDate: '2026-01-01' },
    active: true,
    history: [
      {
        timestamp: '2026-01-01T10:00:00.000Z',
        type: 'created',
        snapshot: {
          name: 'Magnesium',
          defaultDose: 400,
          unit: 'mg',
          description: 'Glycinate',
          schedule: { type: 'daily', startDate: '2026-01-01' },
          active: true
        }
      }
    ]
  };

  it('returns item unchanged for today', () => {
    const result = applyHistoricalState(baseItem, today);
    expect(result).toEqual(baseItem);
  });

  it('overlays historical properties for past dates', () => {
    const itemWithUpdate = {
      ...baseItem,
      name: 'Mag Glycinate',
      defaultDose: 600,
      history: [
        ...baseItem.history,
        {
          timestamp: '2026-03-15T10:00:00.000Z',
          type: 'updated',
          changes: {
            name: { from: 'Magnesium', to: 'Mag Glycinate' },
            defaultDose: { from: 400, to: 600 }
          }
        }
      ]
    };

    const result = applyHistoricalState(itemWithUpdate, new Date('2026-03-10'));
    expect(result.name).toBe('Magnesium');
    expect(result.defaultDose).toBe(400);
    expect(result.unit).toBe('mg');
  });

  it('overlays historical active status', () => {
    const deactivated = {
      ...baseItem,
      active: false,
      history: [
        ...baseItem.history,
        {
          timestamp: '2026-03-15T10:00:00.000Z',
          type: 'updated',
          changes: { active: { from: true, to: false } }
        }
      ]
    };

    const result = applyHistoricalState(deactivated, new Date('2026-03-10'));
    expect(result.active).toBe(true);
  });

  it('overlays historical schedule', () => {
    const rescheduled = {
      ...baseItem,
      schedule: { type: 'days', days: [1, 3, 5], startDate: '2026-01-01' },
      history: [
        ...baseItem.history,
        {
          timestamp: '2026-03-15T10:00:00.000Z',
          type: 'updated',
          changes: {
            schedule: {
              from: { type: 'daily', startDate: '2026-01-01' },
              to: { type: 'days', days: [1, 3, 5], startDate: '2026-01-01' }
            }
          }
        }
      ]
    };

    const result = applyHistoricalState(rescheduled, new Date('2026-03-10'));
    expect(result.schedule.type).toBe('daily');
  });

  it('returns item unchanged when history is empty/missing', () => {
    const noHistory = { ...baseItem, history: [] };
    const result = applyHistoricalState(noHistory, new Date('2026-03-10'));
    expect(result).toEqual(noHistory);
  });

  it('returns item unchanged when history is undefined (legacy)', () => {
    const legacy = { ...baseItem, history: undefined };
    const result = applyHistoricalState(legacy, new Date('2026-03-10'));
    expect(result).toEqual(legacy);
  });
});
