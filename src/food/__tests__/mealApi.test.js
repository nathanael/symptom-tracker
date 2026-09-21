import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../voice/voiceApi.js', () => ({
  BASE: 'https://worker.test',
  post: vi.fn(),
  VoiceApiError: class extends Error {
    constructor(status, message) { super(message); this.status = status; }
  },
}));

const { post } = await import('../../voice/voiceApi.js');
const { analyzeMeal } = await import('../mealApi.js');

const reply = (body) => ({ json: async () => body });

beforeEach(() => { post.mockReset(); });

describe('analyzeMeal', () => {
  it('posts an image to /meal and normalises the reply', async () => {
    post.mockResolvedValue(reply({ name: 'Wrap', ingredients: ['  Chicken ', 'chicken'] }));
    const result = await analyzeMeal({ image: 'BASE64DATA' });
    expect(post).toHaveBeenCalledWith('https://worker.test/meal', { image: 'BASE64DATA' });
    expect(result).toEqual({ name: 'Wrap', ingredients: ['chicken'] });
  });

  it('posts text when there is no image', async () => {
    post.mockResolvedValue(reply({ name: 'Toast', ingredients: ['bread'] }));
    await analyzeMeal({ text: 'buttered toast' });
    expect(post).toHaveBeenCalledWith('https://worker.test/meal', { text: 'buttered toast' });
  });

  it('never sends both fields', async () => {
    post.mockResolvedValue(reply({ name: '', ingredients: [] }));
    await analyzeMeal({ image: 'IMG', text: 'ignored' });
    expect(post).toHaveBeenCalledWith('https://worker.test/meal', { image: 'IMG' });
  });

  it('rejects when neither is supplied', async () => {
    await expect(analyzeMeal({})).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it('lets the API error through untouched', async () => {
    post.mockRejectedValue(Object.assign(new Error('nope'), { status: 429 }));
    await expect(analyzeMeal({ text: 'x' })).rejects.toMatchObject({ status: 429 });
  });
});
