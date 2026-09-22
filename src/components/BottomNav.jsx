import './mobileNav.css';
import QuickActionsMenu from './QuickActionsMenu';
import { solar } from './solarIcons';

const TABS = [
  { id: 'home', label: 'Home', icon: solar.bolt },
  { id: 'symptoms', label: 'Symptoms', icon: solar.symptoms },
  { id: 'stack', label: 'Protocol', icon: solar.protocol },
  { id: 'insights', label: 'Progress', icon: solar.progress },
];

// Mobile dock: the destinations in a pill, plus one overflow button beside it
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
  onTalkMode,
  onClear,
  onMatchYesterday,
  onEditProtocol,
  onLogMeal,
}) {
  const activeTab = showInsights ? 'insights' : appMode === 'home' ? 'home' : appMode === 'symptoms' ? 'symptoms' : 'stack';

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

  // On Home the tab pill folds into a single "Advanced mode" button; tapping it opens the
  // Symptoms tab and the pill unfolds back into the tabs. Tapping the Home tab folds it again.
  // Both layers stay mounted, stacked in one grid cell, so the swap can animate both ways.
  const easy = appMode === 'home' && !showInsights;

  return (
    <>
      <div className="mn-dock">
        <div className="mn-dock-in">
          <div className={`mn-tabs${easy ? ' easy' : ''}`}>
            <div className="mn-layer mn-tablist" role="tablist" aria-hidden={easy || undefined}>
              {TABS.map((tab, i) => (
                <button key={tab.id} role="tab" style={{ '--i': i }} tabIndex={easy ? -1 : 0} aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'on' : ''} onClick={() => goTo(tab.id)}>
                  <svg viewBox="0 0 24 24">{tab.icon}</svg><span>{tab.label}</span>
                </button>
              ))}
            </div>
            <button className="mn-layer mn-adv" tabIndex={easy ? 0 : -1} aria-hidden={!easy || undefined} onClick={() => goTo('symptoms')}>
              Advanced mode
            </button>
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
          onTalkMode={onTalkMode}
          onClear={onClear}
          onMatchYesterday={onMatchYesterday}
          onEditProtocol={onEditProtocol}
          onLogMeal={onLogMeal}
          onOpenSettings={() => {
            setShowSettings(true);
            setShowQuickActions(false);
          }}
        />
      )}
    </>
  );
}
