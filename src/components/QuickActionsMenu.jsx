import { useEffect } from 'react';
import { formatDate } from '../utils/helpers';
import { solar } from './solarIcons';
import { APP_VERSION } from '../version';

const icons = {
  note: solar.note,
  list: solar.edit,
  yesterday: solar.yesterday,
  copy: solar.copy,
  gear: solar.gear,
  trash: solar.trash,
  bolt: solar.bolt,
  mic: solar.mic,
  camera: solar.camera,
};

// The one mobile overflow. Ordered for the thumb: rare and destructive at the top,
// the actions used most (day notes, talk mode, rapid entry) at the bottom next to the ⋯ button.
export default function QuickActionsMenu({
  appMode,
  showInsights,
  selectedDate,
  onClose,
  // Symptoms page actions
  onCopyData,
  copyDays,
  onEditNote,
  onEditSymptoms,
  onClearSymptoms,
  onRapidEntry,
  onTalkMode,
  // Stack page actions
  onClear,
  onMatchYesterday,
  onEditProtocol,
  onLogMeal,
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

  const currentVersion = `v${APP_VERSION}`;

  const tab = showInsights ? 'insights' : appMode === 'home' ? 'home' : appMode === 'symptoms' ? 'symptoms' : 'protocol';
  const Item = ({ icon, label, hint, danger, primary, onClick }) => (
    <button className={danger ? 'danger' : primary ? 'primary' : ''} onClick={() => { onClick(); onClose(); }}>
      <svg viewBox="0 0 24 24">{icons[icon]}</svg>{label}{hint && <small>{hint}</small>}
    </button>
  );

  return (
    <>
      <div className="mn-dim" onClick={onClose} />
      <div className="mn-sheet" role="menu">
        <h6>
          {tab === 'insights' ? 'Progress' : tab === 'home' ? `Home · ${formatDate(selectedDate)}` : `${tab === 'symptoms' ? 'Symptoms' : 'Protocol'} · ${formatDate(selectedDate)}`}
          <span>{currentVersion}</span>
        </h6>
        {tab !== 'insights' && tab !== 'home' && <Item icon="trash" label="Clear day" danger onClick={tab === 'symptoms' ? onClearSymptoms : onClear} />}
        <Item icon="gear" label="Settings" onClick={onOpenSettings} />
        <hr />
        <Item icon="copy" label="Copy for AI" hint={`${copyDays} days`} onClick={onCopyData} />
        {tab === 'symptoms' && <Item icon="list" label="Edit symptoms" onClick={onEditSymptoms} />}
        {tab === 'protocol' && (
          <>
            <Item icon="list" label="Edit protocol" onClick={onEditProtocol} />
            <Item icon="yesterday" label="Match yesterday" onClick={onMatchYesterday} />
            <Item icon="camera" label="Log a meal" onClick={onLogMeal} />
          </>
        )}
        {tab !== 'insights' && (
          <>
            <hr />
            <Item icon="note" label="Day notes" onClick={onEditNote} />
            {tab === 'symptoms' && <Item icon="mic" label="Talk me through it" onClick={onTalkMode} />}
            {tab === 'symptoms' && <Item icon="bolt" label="Rapid entry" primary onClick={onRapidEntry} />}
          </>
        )}
      </div>
    </>
  );
}
