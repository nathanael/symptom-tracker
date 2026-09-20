import './mobileNav.css';
import QuickActionsMenu from './QuickActionsMenu';

const TABS = [
  { id: 'symptoms', label: 'Symptoms', icon: <path d="M3 12h4l3-8 4 16 3-8h4" /> },
  { id: 'stack', label: 'Protocol', icon: <path d="m12 2 9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5" /> },
  { id: 'insights', label: 'Insights', icon: <path d="M6 20v-6M12 20V4M18 20v-9" /> },
];

// Mobile dock: three real destinations in a pill, plus one overflow button beside it
export default function BottomNav({
  appMode,
  setAppMode,
  showInsights,
  setShowInsights,
  showSettings,
  setShowSettings,
  setShowExport,
  showQuickActions,
  setShowQuickActions,
  selectedDate,
  // Action handlers
  onCopyData,
  copyDays,
  onEditNote,
  onEditSymptoms,
  onClearSymptoms,
  onRapidEntry,
  onClear,
  onMatchYesterday,
  onEditProtocol,
}) {
  const activeTab = showInsights ? 'insights' : appMode === 'symptoms' ? 'symptoms' : 'stack';

  const goTo = (tab) => {
    if (tab === 'insights') {
      setShowInsights(true);
    } else {
      setAppMode(tab);
      setShowInsights(false);
    }
    setShowSettings(false);
    setShowExport(false);
    setShowQuickActions(false);
  };

  return (
    <>
      <div className="mn-dock">
        <div className="mn-dock-in">
          <div className="mn-tabs" role="tablist">
            {TABS.map((tab) => (
              <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'on' : ''} onClick={() => goTo(tab.id)}>
                <svg viewBox="0 0 24 24">{tab.icon}</svg>{tab.label}
              </button>
            ))}
          </div>
          <button className={`mn-more ${showQuickActions ? 'on' : ''}`} aria-label="More actions" aria-haspopup="menu" onClick={() => setShowQuickActions(!showQuickActions)}>
            <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>
          </button>
        </div>
      </div>

      {showQuickActions && !showSettings && (
        <QuickActionsMenu
          appMode={appMode}
          showInsights={showInsights}
          selectedDate={selectedDate}
          onClose={() => setShowQuickActions(false)}
          onCopyData={onCopyData}
          copyDays={copyDays}
          onEditNote={onEditNote}
          onEditSymptoms={onEditSymptoms}
          onClearSymptoms={onClearSymptoms}
          onRapidEntry={onRapidEntry}
          onClear={onClear}
          onMatchYesterday={onMatchYesterday}
          onEditProtocol={onEditProtocol}
          onOpenSettings={() => {
            setShowSettings(true);
            setShowQuickActions(false);
          }}
        />
      )}
    </>
  );
}
