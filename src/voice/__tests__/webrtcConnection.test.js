import { describe, it, expect, vi, afterEach } from 'vitest';
import { micErrorMessage, connect } from '../webrtcConnection';

const named = (name) => Object.assign(new Error(name), { name });

describe('micErrorMessage', () => {
  it('keeps talk mode wording by default', () => {
    expect(micErrorMessage(named('NotAllowedError'))).toBe('Microphone access is blocked. Allow it for this site to use talk mode.');
  });

  it('names the feature it is given', () => {
    expect(micErrorMessage(named('SecurityError'), 'voice notes')).toBe('Microphone access is blocked. Allow it for this site to use voice notes.');
  });

  it('has feature-neutral wording for a missing or failed mic', () => {
    expect(micErrorMessage(named('NotFoundError'), 'voice notes')).toBe('No microphone found.');
    expect(micErrorMessage(named('AbortError'), 'voice notes')).toBe("Couldn't start the microphone.");
  });
});

describe('connect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws a MicError in the caller\'s words when the mic is refused', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(named('NotAllowedError')) } });
    await expect(connect({ secret: 's', onEvent: () => {}, feature: 'voice notes' })).rejects.toMatchObject({
      name: 'MicError',
      message: 'Microphone access is blocked. Allow it for this site to use voice notes.',
    });
  });

  it('defaults to talk mode wording when no feature is passed', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(named('NotAllowedError')) } });
    await expect(connect({ secret: 's', onEvent: () => {} })).rejects.toMatchObject({
      name: 'MicError',
      message: 'Microphone access is blocked. Allow it for this site to use talk mode.',
    });
  });
});
