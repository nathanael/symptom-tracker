import { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
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

// Desktop context-bar dropdown. items: { label, onClick, danger } — danger items sit below a divider
export function BarMenu({ label, ariaLabel, className = 'dn-btn', items }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  const firstDanger = shown.findIndex((it) => it.danger);
  return (
    <span className="dn-menu-wrap">
      <button className={className} aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>{label}</button>
      {open && (
        <div className="dn-menu" role="menu">
          {shown.map((it, i) => (
            <span key={it.label} style={{ display: 'contents' }}>
              {i === firstDanger && i > 0 && <hr />}
              <button role="menuitem" className={it.danger ? 'danger' : ''} onClick={it.onClick}>{it.label}</button>
            </span>
          ))}
        </div>
      )}
    </span>
  );
}

// Drag to reorder (mouse + touch), the way a phone's own lists do it: the row lifts and follows the
// pointer, the rows it passes slide out of its way, the page scrolls when it nears an edge, and on
// release it settles into the gap. Rows opt in with data-reorder-id and data-reorder-group.
//
// Everything during the drag is done on the DOM directly (transforms), not through React state, so
// it tracks the finger at frame rate. React only hears about it once, at the drop:
//   onCommit(fromId, toId, group, order)
// `toId` is the row whose place was taken; `order` is every id of the group in its new visual order.
//
// Rows of a group that sit apart (group headers with their symptoms between them) can't slide into
// each other's places; for those the row still follows the pointer and the target is marked `over`.
const EDGE = 90; // px from the top/bottom of the scroll area where auto-scroll starts

const scrollParent = (el) => {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement || document.documentElement;
};

export function useReorderDrag(onCommit) {
  const active = useRef(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  const finish = (drop) => {
    const d = active.current;
    if (!d) return;
    active.current = null;
    cancelAnimationFrame(d.frame);
    document.body.classList.remove('lr-reordering');
    const reset = () => {
      d.items.forEach(({ el }) => {
        el.style.transition = '';
        el.style.transform = '';
        el.classList.remove('over');
      });
      Object.assign(d.row.style, { transition: '', transform: '', zIndex: '', position: '', boxShadow: '', background: '', borderRadius: '' });
    };
    if (!drop || d.index === d.from) {
      // Back where it came from
      d.row.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s';
      d.row.style.transform = '';
      d.row.style.boxShadow = '';
      d.items.forEach(({ el }) => { el.style.transform = ''; el.classList.remove('over'); });
      setTimeout(reset, 210);
      return;
    }
    const ids = d.items.map((item) => item.id);
    const order = [...ids];
    order.splice(d.from, 1);
    order.splice(d.index, 0, d.id);
    const toId = ids[d.index];
    const land = () => {
      // Re-render in the new order and drop the transforms in the same frame: nothing jumps
      flushSync(() => commit.current(d.id, toId, d.group, order));
      reset();
    };
    if (!d.contiguous) return land();
    // Settle into the gap the other rows have opened
    const target = d.items[d.index];
    const settle = d.index > d.from ? target.top + target.height - d.items[d.from].height : target.top;
    d.row.style.transition = 'transform .16s cubic-bezier(.2,.8,.2,1), box-shadow .16s';
    d.row.style.transform = `translateY(${settle - d.items[d.from].top}px)`;
    d.row.style.boxShadow = '0 2px 8px rgba(0,0,0,.3)';
    setTimeout(land, 165);
  };

  const place = () => {
    const d = active.current;
    const dy = d.pointerY - d.startY + (d.scroller.scrollTop - d.startScroll);
    d.row.style.transform = `translateY(${dy}px) scale(1.02)`;
    const self = d.items[d.from];
    // A row gives way once the dragged row's leading edge is past its middle: half a row of travel
    const top = self.top + dy;
    const bottom = top + self.height;
    let index = d.from;
    d.items.forEach((item, i) => {
      if (i < d.from && top < item.top + item.height / 2) index = Math.min(index, i);
      if (i > d.from && bottom > item.top + item.height / 2) index = Math.max(index, i);
    });
    if (index === d.index) return;
    d.index = index;
    haptic('light');
    d.items.forEach((item, i) => {
      if (i === d.from) return;
      if (!d.contiguous) return item.el.classList.toggle('over', i === index);
      const shift = i > d.from && i <= index ? -d.slot : i < d.from && i >= index ? d.slot : 0;
      item.el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };

  // Keeps the row under a still finger while the page scrolls beneath it
  const tick = () => {
    const d = active.current;
    if (!d) return;
    const box = d.scroller === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : d.scroller.getBoundingClientRect();
    const over = d.pointerY < box.top + EDGE ? d.pointerY - (box.top + EDGE) : d.pointerY > box.bottom - EDGE ? d.pointerY - (box.bottom - EDGE) : 0;
    if (over) {
      d.scroller.scrollTop += Math.max(-18, Math.min(18, over * 0.25));
      place();
    }
    d.frame = requestAnimationFrame(tick);
  };

  const gripProps = (id, group = 'default') => ({
    onPointerDown: (e) => {
      if (active.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const root = e.currentTarget.closest('.lr') || document;
      const els = [...root.querySelectorAll(`[data-reorder-group="${group}"]`)];
      const row = els.find((el) => el.getAttribute('data-reorder-id') === id);
      if (!row || els.length < 2) return;
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      const scroller = scrollParent(row);
      const items = els.map((el) => {
        const rect = el.getBoundingClientRect();
        return { el, id: el.getAttribute('data-reorder-id'), top: rect.top, height: rect.height };
      });
      const from = items.findIndex((item) => item.el === row);
      const gaps = items.slice(1).map((item, i) => item.top - (items[i].top + items[i].height));
      const contiguous = gaps.every((gap) => gap < 24);
      const gap = contiguous && gaps.length ? Math.max(0, gaps[Math.min(from, gaps.length - 1)]) : 0;
      active.current = { id, group, row, items, from, index: from, contiguous, slot: items[from].height + gap, scroller, startScroll: scroller.scrollTop, startY: e.clientY, pointerY: e.clientY, frame: 0 };
      items.forEach((item, i) => { if (i !== from) item.el.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'; });
      Object.assign(row.style, { position: 'relative', zIndex: 60, transition: 'box-shadow .15s, background .15s', boxShadow: '0 14px 36px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.08)', background: '#1a1c22', borderRadius: '12px', transform: 'scale(1.02)' });
      document.body.classList.add('lr-reordering');
      active.current.frame = requestAnimationFrame(tick);
      haptic('medium');
    },
    onPointerMove: (e) => {
      const d = active.current;
      if (!d || d.id !== id) return;
      d.pointerY = e.clientY;
      place();
    },
    onPointerUp: () => { if (active.current?.id === id) { haptic('medium'); finish(true); } },
    onPointerCancel: () => { if (active.current?.id === id) finish(false); },
  });

  useEffect(() => () => finish(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Kept for callers: the drag styles itself now
  const rowClass = () => '';

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
