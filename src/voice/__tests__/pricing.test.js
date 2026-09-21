import { describe, it, expect } from 'vitest';
import { geminiCost, realtimeCost, formatUsd, formatClock, monthlyProjections } from '../pricing';

describe('geminiCost', () => {
  it('prices audio and text separately and sums every turn', () => {
    const turn = {
      promptTokenCount: 3000,
      promptTokensDetails: [{ modality: 'TEXT', tokenCount: 2000 }, { modality: 'AUDIO', tokenCount: 1000 }],
      responseTokenCount: 120,
      responseTokensDetails: [{ modality: 'AUDIO', tokenCount: 100 }],
    };
    // 2000 text in @0.75 + 1000 audio in @3 + 20 text out @4.5 + 100 audio out @12, per 1M
    const one = (2000 * 0.75 + 1000 * 3 + 20 * 4.5 + 100 * 12) / 1e6;
    expect(geminiCost([turn])).toBeCloseTo(one, 10);
    expect(geminiCost([turn, turn])).toBeCloseTo(one * 2, 10);
    expect(geminiCost([])).toBe(0);
  });

  it('bills tool results and thinking as text, and tolerates missing fields', () => {
    expect(geminiCost([{ toolUsePromptTokenCount: 1000, thoughtsTokenCount: 1000 }])).toBeCloseTo((1000 * 0.75 + 1000 * 4.5) / 1e6, 10);
    expect(geminiCost([{}])).toBe(0);
  });
});

describe('realtimeCost', () => {
  it('discounts cached input', () => {
    const usage = {
      input_token_details: { text_tokens: 1000, audio_tokens: 500, cached_tokens_details: { text_tokens: 800, audio_tokens: 400 } },
      output_token_details: { text_tokens: 50, audio_tokens: 200 },
    };
    const expected = (200 * 0.6 + 100 * 10 + 800 * 0.06 + 400 * 0.3 + 50 * 2.4 + 200 * 20) / 1e6;
    expect(realtimeCost([usage])).toBeCloseTo(expected, 10);
    expect(realtimeCost([{}])).toBe(0);
  });
});

describe('formatting and projections', () => {
  it('reads as cents below one cent and dollars above', () => {
    expect(formatUsd(0.0432)).toBe('$0.043');
    expect(formatUsd(0.004)).toBe('0.4¢');
    expect(formatUsd(1.239)).toBe('$1.24');
    expect(formatClock(130)).toBe('2:10');
    expect(formatClock(9)).toBe('0:09');
  });

  it('projects a 30-day month at twice daily, daily and every other day', () => {
    expect(monthlyProjections(0.05)).toEqual([
      { label: 'Twice a day', math: '$0.050 × 60', usd: 3 },
      { label: 'Once a day', math: '$0.050 × 30', usd: 1.5 },
      { label: 'Every other day', math: '$0.050 × 15', usd: 0.75 },
    ]);
  });
});
