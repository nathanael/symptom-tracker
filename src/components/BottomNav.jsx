import './mobileNav.css';
import QuickActionsMenu from './QuickActionsMenu';
import { solar } from './solarIcons';

const TABS = [
  { id: 'symptoms', label: 'Symptoms', icon: solar.symptoms },
  { id: 'stack', label: 'Protocol', icon: solar.protocol },
  { id: 'insights', label: 'Progress', icon: solar.progress },
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
            <svg viewBox="0 0 24 24">{solar.more}</svg>
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
