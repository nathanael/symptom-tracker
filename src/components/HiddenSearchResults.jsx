import { daysUntilPurge, isDeleted } from '../utils/softDelete';

const KIND_LABEL = { symptom: '', supplement: 'Supplement', factor: 'Factor' };

// Hidden and deleted items whose name or description matches the search.
// lists: [[kind, items], ...] with every item, including hidden and soft-deleted ones.
export function findHiddenMatches(search, lists, excludeIds = new Set()) {
  const s = (search || '').trim().toLowerCase();
  if (!s) return [];
  const out = [];
  for (const [kind, items] of lists) {
    for (const item of items || []) {
      if (excludeIds.has(item.id)) continue;
      if (!(isDeleted(item) || item.active === false)) continue;
      const text = `${item.name || ''} ${item.description || ''}`.toLowerCase();
      if (text.includes(s)) out.push({ kind, item, deleted: isDeleted(item) });
    }
  }
  return out.sort((a, b) => a.item.name.localeCompare(b.item.name));
}

// Search results for items that are out of view, each with a Restore button
export default function HiddenSearchResults({ matches, onRestore }) {
  if (!matches.length) return null;
  return (
    <>
      <div className="lr-sec"><b>HIDDEN & DELETED</b> {matches.length} matching <span>Restore to bring one back</span></div>
      {matches.map((m) => {
        const days = m.deleted ? daysUntilPurge(m.item) : null;
        return (
          <div key={`${m.kind}-${m.item.id}`} className="lr-row lr-hidden-match">
            <span className="lr-hm-name">{m.item.name}</span>
            {KIND_LABEL[m.kind] && <span className="lr-hm-kind">{KIND_LABEL[m.kind]}</span>}
            <span className={`lr-hm-tag ${m.deleted ? 'deleted' : ''}`}>
              {m.deleted ? `Deleted · removed in ${days} day${days === 1 ? '' : 's'}` : 'Hidden'}
            </span>
            <button className="lr-link lr-hm-restore" onClick={() => onRestore(m)}>Restore</button>
          </div>
        );
      })}
    </>
  );
}
