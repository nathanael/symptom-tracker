import { useEffect } from 'react';
import { formatDate } from '../utils/helpers';

const icons = {
  note: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  yesterday: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />,
  bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
};

// The one mobile overflow. Ordered for the thumb: rare and destructive at the top,
// the actions used most (day notes, rapid entry) at the bottom next to the ⋯ button.
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
  // Stack page actions
  onClear,
  onMatchYesterday,
  onEditProtocol,
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

  const currentVersion = 'v6.4.2';

  const tab = showInsights ? 'insights' : appMode === 'symptoms' ? 'symptoms' : 'protocol';
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
          {tab === 'insights' ? 'Insights' : `${tab === 'symptoms' ? 'Symptoms' : 'Protocol'} · ${formatDate(selectedDate)}`}
          <span>{currentVersion}</span>
        </h6>
        {tab !== 'insights' && <Item icon="trash" label="Clear day" danger onClick={tab === 'symptoms' ? onClearSymptoms : onClear} />}
        <Item icon="gear" label="Settings" onClick={onOpenSettings} />
        <hr />
        <Item icon="copy" label="Copy for AI" hint={`${copyDays} days`} onClick={onCopyData} />
        {tab === 'symptoms' && <Item icon="list" label="Edit symptoms" onClick={onEditSymptoms} />}
        {tab === 'protocol' && (
          <>
            <Item icon="list" label="Edit protocol" onClick={onEditProtocol} />
            <Item icon="yesterday" label="Match yesterday" onClick={onMatchYesterday} />
          </>
        )}
        {tab !== 'insights' && (
          <>
            <hr />
            <Item icon="note" label="Day notes" onClick={onEditNote} />
            {tab === 'symptoms' && <Item icon="bolt" label="Rapid entry" primary onClick={onRapidEntry} />}
          </>
        )}
      </div>
    </>
  );
}
