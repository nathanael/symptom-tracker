// Advanced-mode transition. Going in, the Home photographs break into tiles that burst away from
// the button, tumble, and land as the blocks of the screen being opened (its top bar and rows);
// coming back, those blocks burst from the Home tab and land as the photographs again.
//
// The tiles live on their own fixed layer (.fx-layer, styled in home.css). `commit` is the
// state change that swaps the screens; the destination renders underneath, held invisible
// (html.fx-hold) so it can be measured, and fades in once the tiles land.

import { springs, reducedMotion, rand, wait, nextFrame } from './motion';

// Same as .hm-card::before, so a tile is indistinguishable from its piece of the card.
const GRAD = 'linear-gradient(to bottom, rgba(8,9,10,.34) 0%, rgba(8,9,10,.78) 34%, rgba(8,9,10,.78) 78%, rgba(8,9,10,.5) 100%)';
const TARGETS = '.mn-top, .lr-head, .lr-ghead, .lr-row';
const COLS = 6;           // tiles across each card
const CHAOS = 1;          // scales the burst distance, spin and timing spread
const BURST_MS = 400;
const EMPTY = '#131417';  // tint for a target with no background of its own

let running = false;
const root = document.documentElement;
const sizes = new Map();

function imageSize(url) {
  if (sizes.has(url)) return Promise.resolve(sizes.get(url));
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => { const s = { w: im.naturalWidth, h: im.naturalHeight }; sizes.set(url, s); res(s); };
    im.onerror = () => res({ w: 1, h: 1 });
    im.src = url;
  });
}

const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const centre = (el) => { const r = rect(el); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };

// Each Home card cut into a grid; every tile carries its slice of the photo and gradient.
async function photoTiles() {
  const cards = [...document.querySelectorAll('.hm-card')];
  const out = [];
  for (const card of cards) {
    const url = getComputedStyle(card).backgroundImage.replace(/^url\(["']?|["']?\)$/g, '');
    const im = await imageSize(url);
    const r = rect(card);
    const s = Math.max(r.w / im.w, r.h / im.h), iw = im.w * s, ih = im.h * s, ox = (r.w - iw) / 2, oy = (r.h - ih) / 2;
    const tw = r.w / COLS, rows = Math.max(2, Math.round(r.h / tw)), th = r.h / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < COLS; x++) {
      const tx = x * tw, ty = y * th;
      out.push({
        x: r.x + tx, y: r.y + ty, w: tw, h: th,
        bg: `${GRAD}, url("${url}")`, size: `${r.w}px ${r.h}px, ${iw}px ${ih}px`,
        pos: `${-tx}px ${-ty}px, ${ox - tx}px ${oy - ty}px`,
      });
    }
  }
  return out;
}

// The on-screen blocks of the advanced screen, cut into roughly `n` cells. Falls back to a grid
// over the viewport when the screen has too few recognisable blocks (Progress, say).
function slots(n) {
  const vh = innerHeight;
  let els = [...document.querySelectorAll(TARGETS)]
    .map((el) => ({ el, r: rect(el) }))
    .filter(({ r }) => r.w > 20 && r.h > 12 && r.y < vh - 90 && r.y + r.h > 0);
  if (els.length < 4) els = [{ el: null, r: { x: 12, y: 12, w: innerWidth - 24, h: vh - 120 } }];
  const s = Math.sqrt(els.reduce((a, { r }) => a + r.w * r.h, 0) / n), out = [];
  for (const { el, r } of els) {
    const bg = el ? getComputedStyle(el).backgroundColor : '';
    const color = !bg || bg === 'transparent' || /rgba\(.*,\s*0(\.0+)?\)$/.test(bg) ? EMPTY : bg;
    const cols = Math.max(1, Math.round(r.w / s)), rows = Math.max(1, Math.round(r.h / s));
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
      out.push({ x: r.x + x * r.w / cols, y: r.y + y * r.h / rows, w: r.w / cols, h: r.h / rows, color });
  }
  return out;
}

const tf = (dx, dy, rx, ry, rz, sx, sy) => `translate(${dx}px,${dy}px) rotateX(${rx}deg) rotateY(${ry}deg) rotate(${rz}deg) scale(${sx},${sy})`;

// Loosely top-to-bottom, so most tiles travel roughly where they belong but cross on the way.
const shuffleByY = (list) => list.map((t) => [t, t.y + t.x * 0.2 + rand(0, 260) * CHAOS]).sort((a, b) => a[1] - b[1]).map((a) => a[0]);

function fly(layer, photos, cells, toAdv, origin) {
  const P = shuffleByY(photos), S = shuffleByY(cells), N = Math.max(P.length, S.length);
  const sp = springs.tile(), total = BURST_MS + sp.ms, off = BURST_MS / total, land = off + (1 - off) * 0.35;
  const anims = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < N; i++) {
    const p = P[i % P.length], s = S[i % S.length];
    const el = document.createElement('div');
    el.className = 'fx-tile';
    Object.assign(el.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 0.6 + 'px', height: p.h + 0.6 + 'px', backgroundImage: p.bg, backgroundSize: p.size, backgroundPosition: p.pos });
    const tint = document.createElement('i');
    tint.style.background = s.color;
    el.appendChild(tint);
    frag.appendChild(el);

    const ssx = s.w / p.w, ssy = s.h / p.h;
    const atP = tf(0, 0, 0, 0, 0, 1, 1), atS = tf(s.x - p.x, s.y - p.y, 0, 0, 0, ssx, ssy);
    const src = toAdv ? p : s, cx = src.x + src.w / 2, cy = src.y + src.h / 2;
    let vx = cx - origin.x, vy = cy - origin.y;
    const len = Math.hypot(vx, vy) || 1;
    vx /= len; vy /= len;
    const mag = rand(60, 230) * CHAOS, side = rand(-60, 60) * CHAOS;
    const bx = cx + vx * mag - vy * side, by = cy + vy * mag + vx * side;
    const k = rand(0.75, 1.25), bsx = (1 + ssx) / 2 * k, bsy = (1 + ssy) / 2 * k;
    const burst = tf(bx - p.w * bsx / 2 - p.x, by - p.h * bsy / 2 - p.y, rand(-80, 80) * CHAOS, rand(-80, 80) * CHAOS, rand(-200, 200) * CHAOS, bsx, bsy);
    // A shockwave: tiles nearer the button go first.
    const o = { duration: total, delay: len * 0.45 + rand(0, 90) * CHAOS, fill: 'both' };
    anims.push(el.animate([
      { transform: toAdv ? atP : atS, easing: 'cubic-bezier(.1,.75,.25,1)' },
      { transform: burst, offset: off, easing: sp.easing },
      { transform: toAdv ? atS : atP },
    ], o));
    tint.animate(toAdv
      ? [{ opacity: 0 }, { opacity: 0, offset: off * 0.5 }, { opacity: 1, offset: land }, { opacity: 1 }]
      : [{ opacity: 1 }, { opacity: 0.4, offset: off }, { opacity: 0, offset: land }, { opacity: 0 }], o);
  }
  layer.replaceChildren(frag);

  const ring = document.createElement('div');
  ring.className = 'fx-ring';
  Object.assign(ring.style, { left: origin.x + 'px', top: origin.y + 'px' });
  layer.appendChild(ring);
  ring.animate([{ transform: 'scale(0)', opacity: 0.9 }, { transform: 'scale(14)', opacity: 0 }], { duration: 520, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' });

  return Promise.all(anims.map((a) => a.finished));
}

// Still tiles standing in for the screen being left, from the moment it is hidden until the
// destination has rendered and can be measured for the real flight.
function placeholders(layer, tiles) {
  const frag = document.createDocumentFragment();
  for (const t of tiles) {
    const el = document.createElement('div');
    el.className = 'fx-tile';
    Object.assign(el.style, { left: t.x + 'px', top: t.y + 'px', width: t.w + 0.6 + 'px', height: t.h + 0.6 + 'px' });
    if (t.bg) Object.assign(el.style, { backgroundImage: t.bg, backgroundSize: t.size, backgroundPosition: t.pos });
    else el.style.background = t.color;
    frag.appendChild(el);
  }
  layer.replaceChildren(frag);
}

async function land(layer) {
  root.classList.add('fx-reveal');
  root.classList.remove('fx-hold', 'fx-noface');
  await layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'ease-out', fill: 'forwards' }).finished;
  layer.remove();
  root.classList.remove('fx-reveal');
}

// toAdv: Home → the screen `commit` opens. !toAdv: the current screen → Home.
export async function shatterSwitch({ toAdv, originEl, commit }) {
  if (running) return;
  if (reducedMotion() || (toAdv && !document.querySelector('.hm-card'))) { commit(); return; }
  running = true;
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  const origin = centre(originEl);
  try {
    if (toAdv) {
      root.classList.add('fx-noface');
      const [photos] = await Promise.all([photoTiles(), wait(110)]);
      document.body.appendChild(layer);
      placeholders(layer, photos);
      root.classList.add('fx-hold');
      commit();
      await nextFrame();
      await fly(layer, photos, slots(photos.length), true, origin);
    } else {
      const cells = slots(COLS * 12);
      document.body.appendChild(layer);
      placeholders(layer, cells);
      root.classList.add('fx-hold');
      commit();
      await nextFrame();
      const photos = await photoTiles();
      await fly(layer, photos, cells, false, origin);
    }
    await land(layer);
  } finally {
    layer.remove();
    root.classList.remove('fx-hold', 'fx-noface', 'fx-reveal');
    running = false;
  }
}
