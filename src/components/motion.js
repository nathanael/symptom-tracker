// Springs for the Home card morph and the Advanced-mode shatter. A damped spring is simulated
// once and sampled into a CSS `linear()` easing, so Web Animations can play real overshoot
// without a JS frame loop. Browsers without `linear()` get a bezier that roughly matches.

const HAS_LINEAR = typeof CSS !== 'undefined' && !!CSS.supports?.('transition-timing-function', 'linear(0, 1)');
const cache = new Map();

export function spring(stiffness, zeta) {
  const key = `${stiffness}:${zeta}`;
  if (cache.has(key)) return cache.get(key);
  let out;
  if (!HAS_LINEAR) {
    out = { easing: zeta < 0.8 ? 'cubic-bezier(.34,1.45,.64,1)' : 'cubic-bezier(.22,1,.36,1)', ms: 650 };
  } else {
    const damping = 2 * zeta * Math.sqrt(stiffness), dt = 1 / 240, pts = [0];
    let x = 0, v = 0, t = 0, next = 1 / 60;
    while (t < 4) {
      v += (stiffness * (1 - x) - damping * v) * dt;
      x += v * dt;
      t += dt;
      if (t >= next) {
        pts.push(+x.toFixed(4));
        next += 1 / 60;
        if (t > 0.2 && Math.abs(1 - x) < 0.002 && Math.abs(v) < 0.03) break;
      }
    }
    pts[pts.length - 1] = 1;
    out = { easing: `linear(${pts.join(',')})`, ms: t * 1000 };
  }
  cache.set(key, out);
  return out;
}

// Tuned in the motion lab demo: card opens with a slight overshoot, buttons bounce more,
// closing barely overshoots so the photo never shrinks visibly past its tile.
export const springs = {
  card: () => spring(190, 0.72),
  btn: () => spring(260, 0.64),
  close: () => spring(230, 0.9),
  tile: () => spring(150, 0.64),
};

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const rand = (a, b) => a + Math.random() * (b - a);
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
