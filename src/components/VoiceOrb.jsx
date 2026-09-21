import { useEffect, useRef } from 'react';

// rgb per voice state; the orb eases between them
const COLORS = {
  connecting: [129, 140, 248],
  thinking: [129, 140, 248],
  listening: [56, 189, 248],
  speaking: [167, 139, 250],
  error: [248, 113, 113],
  muted: [107, 114, 128],
};

const RINGS = [
  { r: 1.5, width: 2, alpha: 0.55, speed: 0.5, arcs: [[0, 1.3], [2.1, 0.7], [3.6, 1.9]] },
  { r: 1.78, width: 1.25, alpha: 0.34, speed: -0.32, arcs: [[0.4, 2.4], [3.4, 0.5], [4.4, 1.2]] },
  { r: 2.08, width: 1, alpha: 0.2, speed: 0.18, arcs: [[1, 0.9], [2.6, 2.8]] },
];
const BARS = 84;

// The voice, drawn: a glowing core, a ring of bars that moves with whoever is talking, and slow
// instrument rings around it. Reads the mic level from a ref so audio-rate updates never re-render.
export default function VoiceOrb({ status, muted, levelRef }) {
  const canvasRef = useRef(null);
  const live = useRef({});
  live.current = { status, muted };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frame = 0;
    let energy = 0;
    let spin = 0;
    let last = performance.now();
    const color = [...COLORS.connecting];

    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const { status: state, muted: isMuted } = live.current;
      const waiting = state === 'connecting' || state === 'thinking';

      let target = 0;
      if (state === 'listening') target = isMuted ? 0 : Math.min(1, (levelRef.current || 0) * 1.6);
      // No level for her audio on every engine, so her voice is a plausible syllable rhythm
      else if (state === 'speaking') target = 0.3 + 0.45 * Math.abs(Math.sin(t * 7.1) * Math.sin(t * 2.3 + 1)) + 0.12 * Math.sin(t * 13);
      else if (waiting) target = 0.16 + 0.1 * Math.sin(t * 2.4);
      energy += (target - energy) * (target > energy ? 0.3 : 0.1);

      const goal = COLORS[isMuted && state === 'listening' ? 'muted' : state] || COLORS.connecting;
      for (let i = 0; i < 3; i++) color[i] += (goal[i] - color[i]) * 0.08;
      const rgb = `${color[0] | 0},${color[1] | 0},${color[2] | 0}`;
      spin += dt * (waiting ? 2.6 : 0.7 + energy * 1.2);

      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height * 0.44;
      const R = Math.max(40, Math.min(width * 0.2, height * 0.17, 120));

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 3.4);
      glow.addColorStop(0, `rgba(${rgb},${0.2 + energy * 0.3})`);
      glow.addColorStop(0.45, `rgba(${rgb},${0.05 + energy * 0.08})`);
      glow.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      const coreR = R * (0.5 + energy * 0.3);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      core.addColorStop(0, `rgba(255,255,255,${0.75 + energy * 0.25})`);
      core.addColorStop(0.35, `rgba(${rgb},0.85)`);
      core.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, R * 0.028);
      ctx.strokeStyle = `rgba(${rgb},0.9)`;
      ctx.beginPath();
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const wobble = 0.5 + 0.5 * Math.sin(i * 0.93 + t * 6.2) * Math.sin(i * 0.37 - t * 3.3);
        const len = R * (0.04 + energy * 0.42 * wobble);
        const r0 = R * 1.02;
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
      }
      ctx.stroke();

      for (const ring of RINGS) {
        ctx.lineWidth = ring.width;
        ctx.strokeStyle = `rgba(${rgb},${ring.alpha})`;
        for (const [start, sweep] of ring.arcs) {
          const a = start + spin * ring.speed;
          ctx.beginPath();
          ctx.arc(cx, cy, R * ring.r + energy * R * 0.06, a, a + sweep);
          ctx.stroke();
        }
      }

      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${rgb},0.16)`;
      ctx.beginPath();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 - spin * 0.08;
        const r0 = R * 2.3;
        const r1 = r0 + (i % 5 === 0 ? R * 0.09 : R * 0.04);
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      }
      ctx.stroke();
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [levelRef]);

  return <canvas ref={canvasRef} className="tm-orb" aria-hidden="true" />;
}
