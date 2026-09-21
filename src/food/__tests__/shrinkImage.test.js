import { describe, it, expect } from 'vitest';
import { fitDimensions } from '../shrinkImage.js';

describe('fitDimensions', () => {
  it('scales a landscape photo by its width', () => {
    expect(fitDimensions(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it('scales a portrait photo by its height', () => {
    expect(fitDimensions(3000, 4000, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it('leaves a photo already within the limit alone', () => {
    expect(fitDimensions(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });

  it('never upscales a tiny image', () => {
    expect(fitDimensions(64, 64, 1024)).toEqual({ width: 64, height: 64 });
  });

  it('returns whole pixels', () => {
    const { width, height } = fitDimensions(1999, 1001, 1024);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    expect(fitDimensions(10000, 3, 1024)).toEqual({ width: 1024, height: 1 });
  });

  it('is defensive about junk input', () => {
    expect(fitDimensions(0, 0, 1024)).toEqual({ width: 0, height: 0 });
    expect(fitDimensions(NaN, 100, 1024)).toEqual({ width: 0, height: 0 });
  });
});
