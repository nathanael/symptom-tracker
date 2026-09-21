import { useEffect, useRef } from 'react';

// rgb per voice state; the orb eases between them
const COLORS = {
  connecting: [129, 140, 248],
  thinking: [129, 140, 248],
  listening: [56, 189, 248],
  speaking: [167, 139, 250],
  error: [248, 113, 113],
};

const BARS = 84;

// The voice, drawn: a glowing core and a ring of bars that moves with whoever is talking. Reads
// the mic level from a ref so audio-rate updates never re-render.
export default function VoiceOrb({ status, levelRef }) {
  const canvasRef = useRef(null);
  const live = useRef({});
  live.current = { status };

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
    const color = [...COLORS.connecting];

    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const t = now / 1000;
      const { status: state } = live.current;
      const waiting = state === 'connecting' || state === 'thinking';

      let target = 0;
      if (state === 'listening') target = Math.min(1, (levelRef.current || 0) * 1.6);
      // No level for her audio on every engine, so her voice is a plausible syllable rhythm
      else if (state === 'speaking') target = 0.3 + 0.45 * Math.abs(Math.sin(t * 7.1) * Math.sin(t * 2.3 + 1)) + 0.12 * Math.sin(t * 13);
      // Waiting: a slow breath, so a long connect still reads as alive
      else if (waiting) target = 0.22 + 0.16 * Math.sin(t * 2.4);
      energy += (target - energy) * (target > energy ? 0.3 : 0.1);

      const goal = COLORS[state] || COLORS.connecting;
      for (let i = 0; i < 3; i++) color[i] += (goal[i] - color[i]) * 0.08;
      const rgb = `${color[0] | 0},${color[1] | 0},${color[2] | 0}`;

      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      // The bars reach 1.44 R at full voice: keep them inside the canvas
      const R = Math.max(36, Math.min(width * 0.24, height * 0.33, 130));

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(R * 3.4, height / 2));
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
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [levelRef]);

  return <canvas ref={canvasRef} className="tm-orb" aria-hidden="true" />;
}
