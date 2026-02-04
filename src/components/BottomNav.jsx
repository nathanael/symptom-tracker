import QuickActionsMenu from './QuickActionsMenu';

export default function BottomNav({
  appMode,
  setAppMode,
  showInsights,
  setShowInsights,
  showSettings,
  setShowSettings,
  showExport,
  setShowExport,
  showQuickActions,
  setShowQuickActions,
  // Action handlers
  onCopyData,
  copyDays,
  onRapidEntry,
  onEditNote,
  onEditSymptoms,
  onCheckAll,
  onClear,
  onEditStack,
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
            setShowQuickActions(false);
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
            setShowQuickActions(false);
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
            setShowQuickActions(false);
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

        {/* Actions Tab */}
        <button
          onClick={() => {
            setShowQuickActions(!showQuickActions);
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
          {/* Ellipsis (three dots) icon */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill={showQuickActions ? '#8b5cf6' : '#64748b'}>
            <circle cx="12" cy="12" r="2"/>
            <circle cx="5" cy="12" r="2"/>
            <circle cx="19" cy="12" r="2"/>
          </svg>
          <span style={{
            fontSize: '11px',
            color: showQuickActions ? '#8b5cf6' : '#64748b',
            fontWeight: showQuickActions ? '600' : '400',
          }}>
            Actions
          </span>
        </button>
      </div>

      {/* Quick Actions Menu */}
      {showQuickActions && (
        <QuickActionsMenu
          appMode={appMode}
          onClose={() => setShowQuickActions(false)}
          onCopyData={onCopyData}
          copyDays={copyDays}
          onRapidEntry={onRapidEntry}
          onEditNote={onEditNote}
          onEditSymptoms={onEditSymptoms}
          onCheckAll={onCheckAll}
          onClear={onClear}
          onEditStack={onEditStack}
          onOpenSettings={() => {
            setShowSettings(true);
            setShowQuickActions(false);
          }}
        />
      )}
    </div>
  );
}
