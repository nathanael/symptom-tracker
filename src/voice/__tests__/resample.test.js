import { describe, it, expect } from 'vitest';
import { createResampler } from '../resample';

const tone = (rate, seconds, hz) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));

describe('createResampler', () => {
  it('produces the right number of samples across uneven chunks, with no drift', () => {
    const resample = createResampler(48000, 16000);
    const input = tone(48000, 1, 440);
    let total = 0;
    // Chunk sizes that do not divide by the 3:1 ratio, the way a worklet delivers them
    for (let offset = 0; offset < input.length;) {
      const size = Math.min(input.length - offset, 4801);
      total += resample(input.subarray(offset, offset + size)).pcm.length;
      offset += size;
    }
    expect(total).toBe(16000);
  });

  it('handles a non-integer ratio (44.1 kHz devices)', () => {
    const resample = createResampler(44100, 16000);
    let total = 0;
    for (let i = 0; i < 10; i++) total += resample(tone(44100, 0.1, 300)).pcm.length;
    expect(Math.abs(total - 16000)).toBeLessThanOrEqual(1);
  });

  it('keeps the signal: same tone, same level, 16-bit range', () => {
    const resample = createResampler(48000, 16000);
    const { pcm, peak } = resample(tone(48000, 0.5, 440));
    expect(peak).toBeCloseTo(0.5, 1);
    const max = Math.max(...pcm);
    expect(max).toBeGreaterThan(0.45 * 0x7fff);
    expect(max).toBeLessThanOrEqual(0.5 * 0x7fff + 1);
    // Zero crossings of a 440 Hz tone over half a second: about 440
    let crossings = 0;
    for (let i = 1; i < pcm.length; i++) if ((pcm[i - 1] < 0) !== (pcm[i] < 0)) crossings++;
    expect(Math.abs(crossings - 440)).toBeLessThanOrEqual(2);
  });

  it('passes audio through unchanged when the rates already match', () => {
    const { pcm } = createResampler(16000, 16000)(Float32Array.from([0, 0.5, -0.5, 1, -1]));
    expect([...pcm]).toEqual([0, Math.floor(0.5 * 0x7fff), -0.5 * 0x8000, 0x7fff, -0x8000]);
  });
});
