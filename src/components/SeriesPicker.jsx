import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './desktopNav.css';
import './insights.css';

// Modal list for choosing which series the Insights chart shows (supplements, symptoms, sleep metrics).
export default function SeriesPicker({ title, noun, items, selectedIds, colors, max = 3, onToggle, onClose, isDesktop, emptyState }) {
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);

  // Desktop only: on a phone the focus raises the keyboard, and iOS then scrolls the panel's header (and Done) out of view
  useEffect(() => {
    if (!isDesktop) return undefined;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isDesktop]);

  const q = search.toLowerCase();
  const filtered = items.filter(it => !q || it.name.toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q));
  const soleMatch = q && filtered.length === 1 ? filtered[0] : null;
  const atMax = selectedIds.length >= max;

  // Done / Enter with a single search match selects it on the way out
  const finish = () => {
    if (soleMatch && !selectedIds.includes(soleMatch.id)) onToggle(soleMatch.id);
    onClose();
  };

  // Rendered on <body>: inside the tab's scroll container, iOS paints this fixed layer under the top bar and the dock, hiding Done
  return createPortal(
    <div className={`is-pick-back${isDesktop ? '' : ' mobile'}`} onClick={onClose}>
      <div className="is-pick" onClick={(e) => e.stopPropagation()}>
        <div className="is-pick-head">
          <h3>{title}</h3>
          <small>{selectedIds.length} of {max}</small>
          <button className="dn-btn" onClick={finish}>Done</button>
        </div>
        {emptyState || (
          <>
            <label className="dn-search is-pick-search">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.stopPropagation(); if (search) setSearch(''); else onClose(); }
                  if (e.key === 'Enter') finish();
                }}
                enterKeyHint="done"
                placeholder={`Search ${noun}…`}
              />
            </label>
            <div className="is-pick-list">
              {filtered.map(it => {
                const idx = selectedIds.indexOf(it.id);
                const isSelected = idx >= 0;
                const on = isSelected || it === soleMatch;
                return (
                  <button
                    key={it.id}
                    className={`is-pick-row${on ? ' on' : ''}`}
                    disabled={atMax && !isSelected}
                    onClick={() => onToggle(it.id)}
                  >
                    <span className="dot" style={isSelected ? { background: colors[idx] } : undefined} />
                    <span className="name">{it.name}{it.description && <small>{it.description}</small>}</span>
                    {isSelected && <svg className="check" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" /></svg>}
                  </button>
                );
              })}
              {filtered.length === 0 && <div className="is-pick-empty">No {noun} match “{search}”.</div>}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
