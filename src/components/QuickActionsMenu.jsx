import { useEffect } from 'react';

export default function QuickActionsMenu({
  appMode,
  showInsights,
  onClose,
  // Symptoms page actions
  onCopyData,
  copyDays,
  onRapidEntry,
  onEditNote,
  onEditSymptoms,
  // Stack page actions
  onCheckAll,
  onClear,
  onMatchYesterday,
  onEditStack,
  onEditInputs,
  // Common
  onOpenSettings,
}) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleAction = (action) => {
    action();
    onClose();
  };

  const MenuItem = ({ icon, label, subtext, color = '#60a5fa', onClick }) => (
    <button
      onClick={() => handleAction(onClick)}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '14px',
        padding: '14px 20px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: '44px',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = color === '#9ca3af'
          ? 'rgba(156, 163, 175, 0.1)'
          : 'rgba(59, 130, 246, 0.2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{
        width: '24px',
        height: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color,
      }}>
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{
          fontSize: '15px',
          fontWeight: '500',
          color,
        }}>
          {label}
        </span>
        <span style={{
          fontSize: '12px',
          color: '#64748b',
        }}>
          {subtext}
        </span>
      </div>
    </button>
  );

  const Divider = () => (
    <div style={{
      height: '1px',
      background: 'rgba(255, 255, 255, 0.08)',
      margin: '4px 20px',
    }} />
  );

  // Icons
  const SparklesIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/>
      <path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1 3 1z"/>
      <path d="M19 12l1 2 1-2 2-1-2-1-1-2-1 2-2 1 2 1z"/>
    </svg>
  );

  const LightningIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  );

  const PencilIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  );

  const ListIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"></line>
      <line x1="8" y1="12" x2="21" y2="12"></line>
      <line x1="8" y1="18" x2="21" y2="18"></line>
      <line x1="3" y1="6" x2="3.01" y2="6"></line>
      <line x1="3" y1="12" x2="3.01" y2="12"></line>
      <line x1="3" y1="18" x2="3.01" y2="18"></line>
    </svg>
  );

  const GearIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  );

  const CheckIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );

  const XIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  );

  const HistoryIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
      <path d="M12 7v5l4 2"/>
    </svg>
  );

  const RefreshIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9h-4m-5 9a9 9 0 0 1-9-9m9 9v-4m-9-5a9 9 0 0 1 9-9m-9 9h4m5-9v4"/>
    </svg>
  );

  const currentVersion = 'v4.6.8';

  const handleCheckForUpdates = () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (registration) {
          registration.update().then(() => {
            window.location.reload();
          });
        } else {
          window.location.reload();
        }
      });
    } else {
      window.location.reload();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 299,
        }}
      />

      {/* Menu */}
      <div
        style={{
          position: 'fixed',
          bottom: '80px',
          right: '16px',
          background: 'rgba(20, 22, 26, 0.98)',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          zIndex: 300,
          overflow: 'hidden',
          minWidth: '280px',
          maxWidth: 'calc(100vw - 32px)',
        }}
      >
        {/* Check for updates - shown on all pages */}
        <MenuItem
          icon={RefreshIcon}
          label="Check for updates"
          subtext={`Current version: ${currentVersion}`}
          color="#9ca3af"
          onClick={handleCheckForUpdates}
        />
        <Divider />

        {showInsights ? (
          // Insights page - only show Settings
          <MenuItem
            icon={GearIcon}
            label="Settings"
            subtext="Sync, tracking mode, backups"
            color="#e5e7eb"
            onClick={onOpenSettings}
          />
        ) : appMode === 'symptoms' ? (
          <>
            <MenuItem
              icon={GearIcon}
              label="Settings"
              subtext="Sync, tracking mode, backups"
              color="#e5e7eb"
              onClick={onOpenSettings}
            />
            <MenuItem
              icon={ListIcon}
              label="Edit Symptoms"
              subtext="Manage your symptom list"
              color="#e5e7eb"
              onClick={onEditSymptoms}
            />
            <Divider />
            <MenuItem
              icon={LightningIcon}
              label="Rapid Entry Mode"
              subtext="Quickly log all symptoms in sequence"
              onClick={onRapidEntry}
            />
            <MenuItem
              icon={PencilIcon}
              label="Edit Day's Note"
              subtext="Add notes about today"
              onClick={onEditNote}
            />
            <MenuItem
              icon={SparklesIcon}
              label={`Copy ${copyDays} Days for AI`}
              subtext="Paste into ChatGPT, Gemini or Claude"
              onClick={onCopyData}
            />
          </>
        ) : (
          <>
            <MenuItem
              icon={GearIcon}
              label="Settings"
              subtext="Sync, tracking mode, backups"
              color="#e5e7eb"
              onClick={onOpenSettings}
            />
            <MenuItem
              icon={ListIcon}
              label="Edit Supplement Stack"
              subtext="Manage your supplement list"
              color="#e5e7eb"
              onClick={onEditStack}
            />
            <MenuItem
              icon={ListIcon}
              label="Edit Inputs"
              subtext="Manage foods, substances, activities"
              color="#e5e7eb"
              onClick={onEditInputs}
            />
            <Divider />
            <MenuItem
              icon={HistoryIcon}
              label="Match Yesterday"
              subtext="Copy yesterday's selections to today"
              onClick={onMatchYesterday}
            />
            <MenuItem
              icon={CheckIcon}
              label="Check All"
              subtext="Mark all supplements as taken"
              onClick={onCheckAll}
            />
            <MenuItem
              icon={XIcon}
              label="Clear"
              subtext="Remove all entries for today"
              onClick={onClear}
            />
          </>
        )}
      </div>
    </>
  );
}
