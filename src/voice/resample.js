// Streaming linear resampler to 16-bit PCM: feed it Float32 chunks at one rate, get Int16 chunks at
// another. The read position carries over between chunks, so the output has no seams or drift.
//
// Pure module.
export const createResampler = (fromRate, toRate) => {
  const step = fromRate / toRate;
  let position = 0; // where the next output sample falls, in input samples, relative to this chunk

  return (samples) => {
    const pcm = new Int16Array(Math.max(0, Math.ceil((samples.length - position) / step)) + 1);
    let peak = 0;
    let count = 0;
    while (position < samples.length) {
      const index = Math.floor(position);
      const a = samples[index];
      const b = index + 1 < samples.length ? samples[index + 1] : a;
      const v = Math.max(-1, Math.min(1, a + (b - a) * (position - index)));
      peak = Math.max(peak, Math.abs(v));
      pcm[count++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      position += step;
    }
    position -= samples.length;
    return { pcm: pcm.subarray(0, count), peak };
  };
};
