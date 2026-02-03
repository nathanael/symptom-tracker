export default function BottomNav({
  appMode,
  setAppMode,
  showInsights,
  setShowInsights,
  showSettings,
  setShowSettings,
  showExport,
  setShowExport,
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
      zIndex: 200,
      paddingBottom: '20px',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        padding: '4px 0',
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
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={appMode === 'symptoms' && !isViewOpen ? '#8b5cf6' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
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
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={appMode === 'stack' && !isViewOpen ? '#8b5cf6' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.5 20.5L3.5 13.5c-1.4-1.4-1.4-3.6 0-5s3.6-1.4 5 0"/>
            <path d="M13.5 3.5L20.5 10.5c1.4 1.4 1.4 3.6 0 5s-3.6 1.4-5 0"/>
            <path d="M8.5 15.5l7-7"/>
          </svg>
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
