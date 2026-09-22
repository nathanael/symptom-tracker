// The easy-mode landing screen: three photographs, each expanding in place to the two or three
// ways into that kind of logging. Purely presentational — every option calls a handler App
// already owns, and nothing here writes to a store or derives a count.
//
// The whole tile is the tap target: `hm-hit` is a transparent button filling the card, sitting
// above the photo but below the options, so tapping anywhere opens the card and tapping the
// background of an open card closes it again. That keeps one real, focusable button per card
// without nesting buttons inside buttons.

import { useEffect, useState } from 'react';
import { solar } from './solarIcons';
import symptomsArt from '../assets/home/symptoms.jpg';
import mealsArt from '../assets/home/meals.jpg';
import supplementsArt from '../assets/home/supplements.jpg';
import './home.css';

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

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The first option on each card is the intended path and reads louder than the others.
  const cards = [
    {
      id: 'symptoms', title: 'Log symptoms', icon: 'symptoms', art: symptomsArt, line: summary.symptoms,
      options: [
        { icon: 'bolt', label: 'Rapid entry', onClick: onRapidEntry },
        { icon: 'mic', label: 'Talk me through it', onClick: onTalkMode },
        { icon: 'symptoms', label: 'Full list', onClick: onSymptomList },
      ],
    },
    {
      id: 'meals', title: 'Log a meal', icon: 'camera', art: mealsArt, line: summary.meals,
      options: [
        { icon: 'camera', label: 'Photo', onClick: onPhotoMeal },
        { icon: 'edit', label: 'Type it', onClick: onTypeMeal },
        { icon: 'note', label: "Today's meals", onClick: onTodaysMeals },
      ],
    },
    {
      id: 'supplements', title: 'Log supplements', icon: 'protocol', art: supplementsArt, line: summary.supplements,
      options: [
        { icon: 'yesterday', label: 'Match yesterday', onClick: onMatchYesterday },
        { icon: 'protocol', label: 'Simple checklist', onClick: onSimpleChecklist },
        { icon: 'more', label: 'Full detail', onClick: onProtocolDetail },
      ],
    },
  ];

  return (
    <div className="hm">
      {cards.map((card) => {
        const isOpen = open === card.id;
        return (
          <section
            key={card.id}
            className={`hm-card${isOpen ? ' on' : ''}${open && !isOpen ? ' off' : ''}`}
            style={{ backgroundImage: `url(${card.art})` }}
          >
            <button
              type="button"
              className="hm-hit"
              aria-expanded={isOpen}
              aria-label={isOpen ? `${card.title} — hide options` : `${card.title} — show options`}
              onClick={() => setOpen(isOpen ? null : card.id)}
            />
            <div className="hm-face">
              <svg className="hm-glyph" viewBox="0 0 24 24">{solar[card.icon]}</svg>
              <h2>{card.title}</h2>
              {card.line && <small>{card.line}</small>}
            </div>
            {isOpen && (
              <div className="hm-opts">
                {card.options.map((opt, i) => (
                  <button
                    type="button"
                    key={opt.label}
                    style={{ '--i': i }}
                    className={i === 0 ? 'primary' : ''}
                    onClick={opt.onClick}
                  >
                    <svg viewBox="0 0 24 24">{solar[opt.icon]}</svg>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
