import { useEffect, useRef } from 'react';

// rgb, relative size, phase: three waves added together so they glow where they cross
const WAVES = [['56,189,248', 1, 0], ['167,139,250', 0.8, 1.7], ['244,114,182', 0.6, 3.1]];

// The voice as a ribbon: three soft waves that swell with the mic level and taper to a point at
// both edges. Reads the level from a ref so audio-rate updates never re-render. `active` false
// lets it settle to a thin line (connecting, finishing).
export default function VoiceRibbon({ levelRef, active }) {
  const canvasRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

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

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let energy = 0;
    let frame = 0;
    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const target = activeRef.current ? Math.min(1, (levelRef.current || 0) * 1.6) : 0;
      energy += (target - energy) * (target > energy ? 0.3 : 0.08);
      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;

      // Reduced motion: a steady line whose thickness follows the voice
      if (still) {
        const h = 1.5 + energy * 10;
        ctx.fillStyle = 'rgba(167,139,250,.8)';
        ctx.fillRect(width * 0.08, mid - h / 2, width * 0.84, h);
        return;
      }

      const t = now / 1000;
      ctx.globalCompositeOperation = 'lighter';
      for (const [rgb, k, phase] of WAVES) {
        const amp = (3 + energy * height * 0.36) * k;
        // sin² envelope: zero at both edges, full in the middle
        const y = (x, side) => {
          const u = x / width;
          return mid + side * Math.sin(u * 9 + t * 3.2 * k + phase) * amp * Math.sin(Math.PI * u) ** 2;
        };
        ctx.beginPath();
        ctx.moveTo(0, y(0, 1));
        for (let x = 3; x <= width; x += 3) ctx.lineTo(x, y(x, 1));
        for (let x = width; x >= 0; x -= 3) ctx.lineTo(x, y(x, -0.6));
        ctx.closePath();
        ctx.fillStyle = `rgba(${rgb},.28)`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},.8)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [levelRef]);

  return <canvas ref={canvasRef} className="vn-ribbon" aria-hidden="true" />;
}
