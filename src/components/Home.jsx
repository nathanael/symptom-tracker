// The easy-mode landing screen: three photographs. Tapping one morphs it into a panel that fills
// the Home area — the photo grows out of its tile, the title flies up into a header and the two
// or three ways into that kind of logging spring up from the bottom. Purely presentational —
// every option calls a handler App already owns, and nothing here writes to a store.
//
// The morph is imperative Web Animations (see motion.js for the springs): React only mounts the
// panel; the layout effect measures where the tile was and plays the panel out of it. Closing
// plays it back into the tile before the panel unmounts. Drag the open panel down to dismiss.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { solar } from './solarIcons';
import { springs, reducedMotion } from './motion';
import symptomsArt from '../assets/home/symptoms.jpg';
import mealsArt from '../assets/home/meals.jpg';
import supplementsArt from '../assets/home/supplements.jpg';
import './home.css';

const relTo = (el, base) => {
  const r = el.getBoundingClientRect(), b = base.getBoundingClientRect();
  return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
};
const boxFrames = (a, b) => [
  { left: a.x + 'px', top: a.y + 'px', width: a.w + 'px', height: a.h + 'px', borderRadius: a.rad },
  { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px', borderRadius: b.rad },
];

export default function Home({
  summary,            // { symptoms, meals, supplements } — each a string, or null to show no line
  onRapidEntry,
  onTalkMode,
  onSymptomList,
  onPhotoMeal,
  onTypeMeal,
  onTodaysMeals,
  onMatchYesterday,
  onSimpleChecklist,
  onProtocolDetail,
}) {
  const [open, setOpen] = useState(null);   // 'symptoms' | 'meals' | 'supplements' | null
  const cardRefs = useRef({});
  const xpRef = useRef(null);
  const busy = useRef(false);

  // Supplements on top, symptoms at the bottom. Two ways to log, then one way deeper. The `deep` option is the door into the detailed view
  // rather than a way of logging, so it renders as plain text under the two bars.
  const cards = [
    {
      id: 'supplements', title: 'Log supplements', art: supplementsArt, line: summary.supplements,
      options: [
        { icon: 'yesterday', label: 'Match yesterday', onClick: onMatchYesterday },
        { icon: 'protocol', label: 'Simple checklist', onClick: onSimpleChecklist },
        { icon: 'more', label: 'Full detail', onClick: onProtocolDetail, deep: true },
      ],
    },
    {
      id: 'meals', title: 'Log a meal', art: mealsArt, line: summary.meals,
      options: [
        { icon: 'camera', label: 'Photo', onClick: onPhotoMeal },
        { icon: 'edit', label: 'Type it', onClick: onTypeMeal },
        { icon: 'note', label: "Today's meals", onClick: onTodaysMeals, deep: true },
      ],
    },
    {
      id: 'symptoms', title: 'Log symptoms', art: symptomsArt, line: summary.symptoms,
      options: [
        { icon: 'bolt', label: 'Rapid entry', onClick: onRapidEntry },
        { icon: 'mic', label: 'Talk me through it', onClick: onTalkMode },
        { icon: 'symptoms', label: 'Full list', onClick: onSymptomList, deep: true },
      ],
    },
  ];
  const openCard = cards.find((c) => c.id === open);

  const show = (id) => {
    if (busy.current || open) return;
    busy.current = true;
    setOpen(id);
  };

  // Where the panel's pieces sit when folded back into the tile, relative to the panel.
  const tileGeometry = (xp) => {
    const card = cardRefs.current[open];
    return { box: { ...relTo(card, xp), rad: '20px' }, title: relTo(card.querySelector('h2'), xp) };
  };

  // Open: play the panel out of its tile.
  useLayoutEffect(() => {
    const xp = xpRef.current;
    if (!open || !xp) return;
    const q = (s) => xp.querySelector(s);
    if (reducedMotion()) {
      xp.animate([{ opacity: 0 }, { opacity: 1 }], 200).finished.then(() => { busy.current = false; }, () => {});
      return;
    }
    const { box, title } = tileGeometry(xp);
    const full = { x: 0, y: 0, w: xp.clientWidth, h: xp.clientHeight, rad: '20px' };
    const h2 = q('h2'), lr = relTo(h2, xp);
    const sp = springs.card(), bs = springs.btn();
    xp.style.pointerEvents = 'none';
    const main = q('.hm-xp-bg').animate(boxFrames(box, full), { duration: sp.ms, easing: sp.easing });
    q('.g1').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: 'ease-out', fill: 'forwards' });
    q('.g2').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-out' });
    h2.animate([{ transform: `translate(${title.x - lr.x}px,${title.y - lr.y}px) scale(${title.h / lr.h})` }, { transform: 'none' }], { duration: sp.ms, easing: sp.easing });
    q('.hm-xp-head small')?.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 160, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
    q('.hm-xp-x').animate([{ opacity: 0, transform: 'scale(.5) rotate(-90deg)' }, { opacity: 1, transform: 'none' }], { duration: bs.ms, delay: 200, easing: bs.easing, fill: 'backwards' });
    xp.querySelectorAll('.hm-opts button').forEach((b, i) => b.animate(
      [{ opacity: 0, transform: 'translateY(90px) scale(.86)' }, { opacity: 1, transform: 'none' }],
      { duration: bs.ms, delay: 150 + i * 70, easing: bs.easing, fill: 'backwards' }));
    // Deaf to taps until it has arrived, so the finger lifting from the opening tap can't land
    // on an option sliding in under it.
    main.finished.then(() => { busy.current = false; xp.style.pointerEvents = ''; }, () => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close: play the panel back into its tile from wherever it is now (it may be mid-drag).
  const close = () => {
    const xp = xpRef.current;
    if (busy.current || !open || !xp) return;
    busy.current = true;
    const done = () => { busy.current = false; setOpen(null); };
    if (reducedMotion()) { xp.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished.then(done, done); return; }
    const q = (s) => xp.querySelector(s);
    const bg = q('.hm-xp-bg'), h2 = q('h2');
    const cb = relTo(bg, xp), ch = relTo(h2, xp), curRad = getComputedStyle(bg).borderTopLeftRadius;
    xp.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    xp.style.transform = ''; bg.style.borderRadius = '';
    xp.parentElement.classList.remove('recede');
    const { box, title } = tileGeometry(xp), lh = relTo(h2, xp);
    const sp = springs.close(), o = { duration: sp.ms, easing: sp.easing, fill: 'forwards' };
    const main = bg.animate(boxFrames({ ...cb, rad: curRad }, box), o);
    h2.animate([
      { transform: `translate(${ch.x - lh.x}px,${ch.y - lh.y}px) scale(${ch.h / lh.h})` },
      { transform: `translate(${title.x - lh.x}px,${title.y - lh.y}px) scale(${title.h / lh.h})` },
    ], o);
    q('.g1').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'forwards' });
    q('.g2').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    xp.querySelectorAll('.hm-xp-head small, .hm-xp-x, .hm-opts button').forEach((el, i) => el.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(40px) scale(.94)' }],
      { duration: 180, delay: i * 25, easing: 'ease-in', fill: 'forwards' }));
    main.finished.then(done, done);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Drag down to dismiss: the panel follows the finger, shrinking; let go past 90px to close,
  // short of that it springs back.
  const drag = useRef(null);
  const onPointerDown = (e) => {
    if (busy.current || e.target.closest('button')) return;
    drag.current = { y0: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const xp = xpRef.current, dy = Math.max(0, e.clientY - drag.current.y0), p = Math.min(dy / 400, 1);
    drag.current.dy = dy;
    xp.style.transform = `translateY(${dy * 0.4}px) scale(${1 - p * 0.2})`;
    xp.querySelector('.hm-xp-bg').style.borderRadius = `${20 + p * 30}px`;
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const { dy } = drag.current;
    drag.current = null;
    if (dy > 90) return close();
    const xp = xpRef.current, from = xp.style.transform, sp = springs.card();
    xp.style.transform = '';
    xp.querySelector('.hm-xp-bg').style.borderRadius = '';
    if (from) xp.animate([{ transform: from }, { transform: 'none' }], { duration: sp.ms, easing: sp.easing });
  };

  return (
    <div className={`hm${open ? ' recede' : ''}`}>
      {cards.map((card) => (
        <section
          key={card.id}
          ref={(el) => { cardRefs.current[card.id] = el; }}
          className={`hm-card${open === card.id ? ' hide' : ''}`}
          style={{ backgroundImage: `url(${card.art})` }}
        >
          <button
            type="button"
            className="hm-hit"
            aria-expanded={open === card.id}
            aria-label={`${card.title} — show options`}
            onClick={() => show(card.id)}
          />
          <div className="hm-face">
            <h2>{card.title}</h2>
            {card.line && <small>{card.line}</small>}
          </div>
        </section>
      ))}

      {openCard && (
        <div
          ref={xpRef}
          className="hm-xp"
          role="dialog"
          aria-label={openCard.title}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="hm-xp-bg" style={{ backgroundImage: `url(${openCard.art})` }}>
            <i className="g1" /><i className="g2" />
          </div>
          <button type="button" className="hm-xp-x" aria-label={`${openCard.title} — hide options`} onClick={close}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          <div className="hm-xp-head">
            <h2>{openCard.title}</h2>
            {openCard.line && <small>{openCard.line}</small>}
          </div>
          <div className="hm-opts">
            {openCard.options.map((opt) => (
              <button type="button" key={opt.label} className={opt.deep ? 'deep' : ''} onClick={opt.onClick}>
                <svg viewBox="0 0 24 24">{solar[opt.icon]}</svg>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
