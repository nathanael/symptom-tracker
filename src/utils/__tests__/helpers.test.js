import { describe, it, expect } from 'vitest';
import { applyHistoricalState, generateAIDataExport, buildCSVText } from '../helpers';

describe('applyHistoricalState', () => {
  const today = new Date();

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

describe('generateAIDataExport — Health Score section', () => {
  const symptoms = [
    { id: 's1', name: 'Headache', active: true, applicablePeriods: ['daily'] },
  ];
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const entries = {
    [`${dateKey}-s1-daily`]: { severity: 2, date: dateKey, symptomId: 's1', time: 'daily' },
  };

  it('includes a Health Score section with explainer and per-day score', () => {
    const out = generateAIDataExport(7, entries, symptoms, [], {}, {}, 'simple');
    expect(out).toMatch(/## Health Score/);
    expect(out).toMatch(/0-100/);
    expect(out).toMatch(/100 . \(avg severity \/ 5/); // explainer line — handles ASCII '-' or '−' Unicode minus
    // 100 - (2/5)*100 = 60
    expect(out).toMatch(new RegExp(`\\| ${dateKey} \\| 60 \\|`));
  });

  it('shows blank when no symptoms logged that day', () => {
    const out = generateAIDataExport(2, {}, symptoms, [], {}, {}, 'simple');
    expect(out).toMatch(/## Health Score/);
    // Row exists with empty score
    expect(out).toMatch(/\|\s*\|\s*$/m);
  });
});

describe('buildCSVText — Health Score', () => {
  const symptoms = [{ id: 's1', name: 'Headache', active: true, applicablePeriods: ['daily'] }];
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const entries = {
    [`${dateKey}-s1-daily`]: { severity: 4, date: dateKey, symptomId: 's1', time: 'daily' },
  };

  it('starts with a comment line explaining health_score', () => {
    const csv = buildCSVText(7, entries, symptoms, 'simple');
    expect(csv.split('\n')[0]).toMatch(/^# health_score:/);
  });

  it('appends Health Score rows per date', () => {
    const csv = buildCSVText(7, entries, symptoms, 'simple');
    // 100 - (4/5)*100 = 20
    expect(csv).toMatch(new RegExp(`${dateKey},"Health Score",daily,20`));
  });

  it('omits Health Score row when no symptoms logged that day', () => {
    const csv = buildCSVText(7, {}, symptoms, 'simple');
    expect(csv).not.toMatch(/Health Score/);
  });
});
