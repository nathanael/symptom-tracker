import QuickActionsMenu from './QuickActionsMenu';

export default function BottomNav({
  appMode,
  setAppMode,
  protocolView,
  setProtocolView,
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
  onMatchYesterday,
  onEditStack,
  onEditInputs,
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
      {/* Pinned Protocol Tabs */}
      {!isViewOpen && appMode === 'stack' && (
        <div style={{
          maxWidth: '500px',
          margin: '0 auto',
          padding: '8px 16px',
          display: 'flex',
          gap: '8px',
        }}>
          {['stack', 'inputs'].map(view => {
            const isActive = protocolView === view;
            return (
              <button
                key={view}
                onClick={() => setProtocolView(view)}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: isActive ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
                  color: isActive ? '#a78bfa' : '#64748b',
                  border: isActive
                    ? '1px solid rgba(139, 92, 246, 0.3)'
                    : '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                {view === 'stack' ? 'Supplements' : 'Other Inputs'}
              </button>
            );
          })}
        </div>
      )}
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
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          <span style={{
            fontSize: '11px',
            color: appMode === 'stack' && !isViewOpen ? '#8b5cf6' : '#64748b',
            fontWeight: appMode === 'stack' && !isViewOpen ? '600' : '400',
          }}>
            Protocol
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
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <span style={{
            fontSize: '11px',
            color: showInsights ? '#8b5cf6' : '#64748b',
            fontWeight: showInsights ? '600' : '400',
          }}>
            Insights
          </span>
        </button>

        {/* Actions Tab - hidden when Settings is open */}
        <button
          onClick={() => {
            if (showSettings) return; // Don't open menu when Settings is open
            setShowQuickActions(!showQuickActions);
          }}
          disabled={showSettings}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            padding: '8px',
            cursor: showSettings ? 'default' : 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            opacity: showSettings ? 0.3 : 1,
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
            More
          </span>
        </button>
      </div>

      {/* Quick Actions Menu */}
      {showQuickActions && !showSettings && (
        <QuickActionsMenu
          appMode={appMode}
          showInsights={showInsights}
          onClose={() => setShowQuickActions(false)}
          onCopyData={onCopyData}
          copyDays={copyDays}
          onRapidEntry={onRapidEntry}
          onEditNote={onEditNote}
          onEditSymptoms={onEditSymptoms}
          onCheckAll={onCheckAll}
          onClear={onClear}
          onMatchYesterday={onMatchYesterday}
          onEditStack={onEditStack}
          onEditInputs={onEditInputs}
          onOpenSettings={() => {
            setShowSettings(true);
            setShowQuickActions(false);
            setShowInsights(false);
          }}
        />
      )}
    </div>
  );
}
