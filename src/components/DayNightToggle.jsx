export default function DayNightToggle({ isNight, onToggle }) {
  // Timing constants matching the original prototype
  const trackTransition = '0.6s cubic-bezier(0.4, 0.0, 0.2, 1)';
  const bounceTransition = '0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';

  return (
    <div
      onClick={onToggle}
      style={{
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        WebkitTapHighlightColor: 'transparent',
        flex: 1,
      }}
    >
      <svg
        viewBox="0 0 100 40"
        height={57}
        style={{
          display: 'block',
          overflow: 'visible',
          width: 'auto',
        }}
      >
        <defs>
          {/* Day shadow filter */}
          <filter id="dn-shadow-day" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#000000" floodOpacity="0.2" />
          </filter>

          {/* Night glow filter */}
          <filter id="dn-glow-night" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#FEFCD7" floodOpacity="0.9" />
          </filter>

          {/* Crescent moon mask - shared by sun and moon */}
          <mask id="dn-moon-mask" maskUnits="userSpaceOnUse" x="-50" y="-50" width="100" height="100">
            <rect x="-50" y="-50" width="100" height="100" fill="white" />
            <circle
              cx="0" cy="0" r="13" fill="black"
              style={{
                transform: isNight ? 'translate(-6px, -6px)' : 'translate(25px, -25px)',
                transition: `transform ${bounceTransition}`,
              }}
            />
          </mask>
        </defs>

        {/* Track */}
        <rect
          x="0" y="0" width="100" height="40" rx="20" ry="20"
          fill={isNight ? '#1E3A8A' : '#73C0FC'}
          style={{ transition: `fill ${trackTransition}` }}
        />

        {/* Night Stars (sparkle paths) */}
        <g style={{
          opacity: isNight ? 1 : 0,
          transform: isNight ? 'translateY(0)' : 'translateY(-10px)',
          transition: 'opacity 0.4s ease, transform 0.6s ease',
        }}>
          <path d="M 20 8 Q 20 12 16 12 Q 20 12 20 16 Q 20 12 24 12 Q 20 12 20 8 Z" fill="#ffffff" />
          <path d="M 35 19 Q 35 22 32 22 Q 35 22 35 25 Q 35 22 38 22 Q 35 22 35 19 Z" fill="#ffffff" opacity="0.8" />
          <path d="M 48 12 Q 48 14 46 14 Q 48 14 48 16 Q 48 14 50 14 Q 48 14 48 12 Z" fill="#ffffff" opacity="0.6" />
        </g>

        {/* Day Clouds */}
        <g style={{
          opacity: isNight ? 0 : 1,
          transform: isNight ? 'translateY(10px)' : 'translateY(0)',
          transition: 'opacity 0.4s ease, transform 0.6s ease',
        }}>
          {/* Large cloud */}
          <g fill="#ffffff" opacity="0.9">
            <circle cx="70" cy="20" r="6" />
            <circle cx="78" cy="22" r="4" />
            <circle cx="64" cy="22" r="4" />
            <rect x="64" y="20" width="14" height="6" rx="3" />
          </g>
          {/* Small cloud */}
          <g fill="#ffffff" opacity="0.6">
            <circle cx="50" cy="14" r="4" />
            <circle cx="55" cy="15" r="3" />
            <circle cx="45" cy="15" r="3" />
            <rect x="45" y="14" width="10" height="4" rx="2" />
          </g>
        </g>

        {/* Sliding Knob */}
        <g style={{
          transform: isNight ? 'translate(80px, 20px)' : 'translate(20px, 20px)',
          transition: `transform ${bounceTransition}`,
        }}>
          {/* Sun Rays */}
          <g
            stroke="#FFD43B" strokeWidth="2" strokeLinecap="round"
            style={{
              opacity: isNight ? 0 : 1,
              transform: isNight ? 'rotate(90deg) scale(0.5)' : 'rotate(0deg) scale(1)',
              transition: `opacity 0.4s ease, transform ${bounceTransition}`,
            }}
          >
            <line x1="0" y1="-12.5" x2="0" y2="-15.5" />
            <line x1="0" y1="12.5" x2="0" y2="15.5" />
            <line x1="12.5" y1="0" x2="15.5" y2="0" />
            <line x1="-12.5" y1="0" x2="-15.5" y2="0" />
            <line x1="8.8" y1="-8.8" x2="11" y2="-11" />
            <line x1="-8.8" y1="8.8" x2="-11" y2="11" />
            <line x1="8.8" y1="8.8" x2="11" y2="11" />
            <line x1="-8.8" y1="-8.8" x2="-11" y2="-11" />
          </g>

          {/* Day Knob (Sun) */}
          <g
            filter="url(#dn-shadow-day)"
            style={{
              opacity: isNight ? 0 : 1,
              visibility: isNight ? 'hidden' : 'visible',
              transition: isNight
                ? 'opacity 0.4s ease, visibility 0s linear 0.4s'
                : 'opacity 0.4s ease, visibility 0s linear',
            }}
          >
            <circle cx="0" cy="0" r="10" fill="#FFD43B" mask="url(#dn-moon-mask)" />
          </g>

          {/* Night Knob (Moon) */}
          <g
            filter="url(#dn-glow-night)"
            style={{
              opacity: isNight ? 1 : 0,
              visibility: isNight ? 'visible' : 'hidden',
              transition: isNight
                ? 'opacity 0.6s ease, visibility 0s linear'
                : 'opacity 0.6s ease, visibility 0s linear 0.6s',
            }}
          >
            <circle cx="0" cy="0" r="13" fill="#FEFCD7" mask="url(#dn-moon-mask)" />
          </g>
        </g>
      </svg>
    </div>
  );
}
