import { useState, useEffect } from 'react';
import { haptic, formatRelativeTime } from '../utils/helpers';

export const isTyping = (target) =>
  target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

// Text input that keeps a local draft and commits on blur / Enter
export function DraftInput({ value, onCommit, onAbandon, className, placeholder, autoFocus, inputMode, style }) {
  const initial = value ?? '';
  const [draft, setDraft] = useState(String(initial));
  useEffect(() => setDraft(String(value ?? '')), [value]);
  return (
    <input
      className={className}
      style={style}
      value={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      inputMode={inputMode}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => { if (autoFocus) e.target.select(); }}
      onBlur={() => { if (draft !== String(value ?? '')) onCommit(draft); else onAbandon?.(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.target.blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(String(value ?? ''));
          const el = e.target;
          setTimeout(() => el.blur(), 0);
        }
      }}
    />
  );
}

// Pointer-based drag reorder (mouse + touch). Rows opt in with data-reorder-id and data-reorder-group.
export function useReorderDrag(onCommit) {
  const [drag, setDrag] = useState(null); // { id, group, overId }

  const gripProps = (id, group = 'default') => ({
    onPointerDown: (e) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ id, group, overId: null });
      haptic('light');
    },
    onPointerMove: (e) => {
      if (!drag || drag.id !== id) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(`[data-reorder-group="${group}"]`);
      const overId = el ? el.getAttribute('data-reorder-id') : null;
      if (overId !== drag.overId) setDrag({ id, group, overId });
    },
    onPointerUp: () => {
      if (drag && drag.overId && drag.overId !== drag.id) onCommit(drag.id, drag.overId, group);
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
  });

  const rowClass = (id) =>
    `${drag?.id === id ? 'dragging' : ''} ${drag?.overId === id && drag.id !== id ? 'over' : ''}`;

  return { gripProps, rowClass };
}

// Change history with Revert on every entry except the latest
export function ChangeLog({ history, format, onRevert }) {
  const rows = (history || [])
    .map((entry, index) => ({ entry, index, text: format(entry) }))
    .filter((r) => r.text)
    .reverse();
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="lr-log-head">CHANGE HISTORY</div>
      {rows.map(({ entry, index, text }, i) => (
        <div className="lr-log-row" key={index}>
          <div><small>{formatRelativeTime(entry.timestamp)}</small><span>{text}</span></div>
          {i > 0 && onRevert && <button className="lr-link" onClick={() => onRevert(index)}>Revert</button>}
        </div>
      ))}
    </div>
  );
}
