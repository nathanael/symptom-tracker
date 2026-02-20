import { useRef } from 'react';

export default function DayNightToggle({ isNight, onToggle }) {
  const ref = useRef(null);

  const trackColor = isNight ? '#1E3A8A' : '#73C0FC';
  const knobX = isNight ? 76 : 24;
  const transition = '0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
  const fadeSlow = '0.5s ease';

  return (
    <div
      onClick={onToggle}
      ref={ref}
      style={{
        padding: '6px 4px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <svg
        viewBox="0 0 100 40"
        width={76}
        height={32}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          {/* Drop shadow for sun */}
          <filter id="sun-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#F59E0B" floodOpacity="0.5" />
          </filter>
          {/* Glow for moon */}
          <filter id="moon-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feFlood floodColor="#93C5FD" floodOpacity="0.6" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Crescent mask */}
          <mask id="crescent-mask">
            <rect x="0" y="0" width="100" height="100" fill="white" />
            <circle
              cx={isNight ? 8 : 0}
              cy={isNight ? -3 : 0}
              r="9"
              fill="black"
              style={{ transition: `cx ${fadeSlow}, cy ${fadeSlow}` }}
            />
          </mask>
        </defs>

        {/* Track */}
        <rect
          x="2"
          y="2"
          width="96"
          height="36"
          rx="18"
          ry="18"
          fill={trackColor}
          style={{ transition: `fill ${fadeSlow}` }}
        />

        {/* Stars (night decoration - left half) */}
        <g style={{
          opacity: isNight ? 1 : 0,
          transition: `opacity ${fadeSlow}`,
        }}>
          <circle cx="18" cy="12" r="1" fill="#FDE68A" />
          <circle cx="30" cy="8" r="0.8" fill="#FDE68A" />
          <circle cx="12" cy="24" r="0.6" fill="#FDE68A" />
          <circle cx="38" cy="14" r="0.7" fill="#FDE68A" />
          <circle cx="25" cy="28" r="0.9" fill="#FDE68A" />
          <circle cx="42" cy="26" r="0.5" fill="#FDE68A" />
          {/* Twinkle star */}
          <g style={{
            opacity: isNight ? 1 : 0,
            transition: `opacity 0.8s ease 0.3s`,
          }}>
            <path d="M15 18 L15.5 16 L16 18 L17.5 18.5 L16 19 L15.5 21 L15 19 L13.5 18.5 Z" fill="#FDE68A" opacity="0.8" />
            <path d="M35 22 L35.3 20.8 L35.6 22 L36.8 22.3 L35.6 22.6 L35.3 23.8 L35 22.6 L33.8 22.3 Z" fill="#FDE68A" opacity="0.6" />
          </g>
        </g>

        {/* Clouds (day decoration - right half) */}
        <g style={{
          opacity: isNight ? 0 : 1,
          transition: `opacity ${fadeSlow}`,
        }}>
          {/* Cloud 1 */}
          <g>
            <circle cx="62" cy="14" r="4" fill="white" opacity="0.5" />
            <circle cx="67" cy="13" r="5" fill="white" opacity="0.5" />
            <circle cx="72" cy="14" r="3.5" fill="white" opacity="0.5" />
            <rect x="62" y="14" width="10" height="4" rx="2" fill="white" opacity="0.5" />
          </g>
          {/* Cloud 2 */}
          <g>
            <circle cx="72" cy="28" r="3" fill="white" opacity="0.35" />
            <circle cx="76" cy="27" r="4" fill="white" opacity="0.35" />
            <circle cx="80" cy="28" r="3" fill="white" opacity="0.35" />
            <rect x="72" y="28" width="8" height="3" rx="1.5" fill="white" opacity="0.35" />
          </g>
        </g>

        {/* Knob group */}
        <g style={{
          transform: `translateX(${knobX}px)`,
          transition: `transform ${transition}`,
        }}>
          {/* Sun */}
          <g
            filter={isNight ? undefined : 'url(#sun-shadow)'}
            style={{
              opacity: isNight ? 0 : 1,
              transform: isNight ? 'rotate(60deg)' : 'rotate(0deg)',
              transformOrigin: '0px 20px',
              transition: `opacity 0.4s ease, transform 0.5s ease`,
            }}
          >
            <circle cx="0" cy="20" r="10" fill="#FBBF24" />
            {/* Rays */}
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
              <line
                key={angle}
                x1={0 + Math.cos(angle * Math.PI / 180) * 12}
                y1={20 + Math.sin(angle * Math.PI / 180) * 12}
                x2={0 + Math.cos(angle * Math.PI / 180) * 15}
                y2={20 + Math.sin(angle * Math.PI / 180) * 15}
                stroke="#FBBF24"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            ))}
          </g>

          {/* Moon */}
          <g
            filter={isNight ? 'url(#moon-glow)' : undefined}
            style={{
              opacity: isNight ? 1 : 0,
              transition: `opacity 0.4s ease`,
            }}
          >
            <circle
              cx="0"
              cy="20"
              r="11"
              fill="#E0E7FF"
              mask="url(#crescent-mask)"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
