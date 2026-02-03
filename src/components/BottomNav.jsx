const statusColors = { none: '#ef4444', some: '#fbbf24', all: '#4ade80' };

export default function BottomNav({
  appMode,
  setAppMode,
  showInsights,
  setShowInsights,
  showSettings,
  setShowSettings,
  showExport,
  setShowExport,
  tabBadges,
}) {
  const isViewOpen = showInsights || showSettings || showExport;

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'rgba(8, 9, 10, 0.95)',
      borderTop: '1px solid rgba(255, 255, 255, 0.05)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      zIndex: 200,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        padding: '8px 0',
        maxWidth: '500px',
        margin: '0 auto',
      }}>
        {/* Symptoms Tab */}
        <button
          onClick={() => {
            setAppMode('symptoms');
            setShowInsights(false);
            setShowSettings(false);
            setShowExport(false);
          }}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: '8px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <div style={{ position: 'relative' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={appMode === 'symptoms' && !isViewOpen ? '#8b5cf6' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v4"/>
              <path d="M12 18v4"/>
              <path d="M4.93 4.93l2.83 2.83"/>
              <path d="M16.24 16.24l2.83 2.83"/>
              <path d="M2 12h4"/>
              <path d="M18 12h4"/>
              <path d="M4.93 19.07l2.83-2.83"/>
              <path d="M16.24 7.76l2.83-2.83"/>
            </svg>
            <div style={{
              position: 'absolute',
              top: '-2px',
              right: '-2px',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: statusColors[tabBadges.symptoms.status],
            }} />
          </div>
          <span style={{
            fontSize: '11px',
            color: appMode === 'symptoms' && !isViewOpen ? '#8b5cf6' : '#64748b',
            fontWeight: appMode === 'symptoms' && !isViewOpen ? '600' : '400',
          }}>
            Symptoms
          </span>
        </button>

        {/* Stack Tab */}
        <button
          onClick={() => {
            setAppMode('stack');
            setShowInsights(false);
            setShowSettings(false);
            setShowExport(false);
          }}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: '8px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <div style={{ position: 'relative' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={appMode === 'stack' && !isViewOpen ? '#8b5cf6' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>
            </svg>
            <div style={{
              position: 'absolute',
              top: '-2px',
              right: '-2px',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: statusColors[tabBadges.stack.status],
            }} />
          </div>
          <span style={{
            fontSize: '11px',
            color: appMode === 'stack' && !isViewOpen ? '#8b5cf6' : '#64748b',
            fontWeight: appMode === 'stack' && !isViewOpen ? '600' : '400',
          }}>
            Stack
          </span>
        </button>

        {/* Insights Tab */}
        <button
          onClick={() => {
            setShowInsights(!showInsights);
            setShowSettings(false);
            setShowExport(false);
          }}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: '8px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={showInsights ? '#8b5cf6' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18"/>
            <path d="M18 9l-5 5-4-4-3 3"/>
          </svg>
          <span style={{
            fontSize: '11px',
            color: showInsights ? '#8b5cf6' : '#64748b',
            fontWeight: showInsights ? '600' : '400',
          }}>
            Insights
          </span>
        </button>

        {/* Settings Tab */}
        <button
          onClick={() => {
            setShowSettings(!showSettings);
            setShowInsights(false);
            setShowExport(false);
          }}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: '8px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={showSettings ? '#8b5cf6' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
          <span style={{
            fontSize: '11px',
            color: showSettings ? '#8b5cf6' : '#64748b',
            fontWeight: showSettings ? '600' : '400',
          }}>
            Settings
          </span>
        </button>
      </div>
    </div>
  );
}
