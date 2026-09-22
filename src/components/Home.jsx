// The easy-mode landing screen: three photographs, each expanding in place to the two or three
// ways into that kind of logging. Purely presentational — every option calls a handler App
// already owns, and nothing here writes to a store or derives a count.

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

  // The first option on each card is the intended path and renders brighter than the others.
  const cards = [
    {
      id: 'symptoms', title: 'Log symptoms', art: symptomsArt, line: summary.symptoms,
      options: [
        { icon: 'bolt', label: 'Rapid entry', onClick: onRapidEntry },
        { icon: 'mic', label: 'Talk me through it', onClick: onTalkMode },
        { icon: 'symptoms', label: 'Full list', onClick: onSymptomList },
      ],
    },
    {
      id: 'meals', title: 'Log a meal', art: mealsArt, line: summary.meals,
      options: [
        { icon: 'camera', label: 'Photo', onClick: onPhotoMeal },
        { icon: 'edit', label: 'Type it', onClick: onTypeMeal },
        { icon: 'note', label: "Today's meals", onClick: onTodaysMeals },
      ],
    },
    {
      id: 'supplements', title: 'Log supplements', art: supplementsArt, line: summary.supplements,
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
              className="hm-face"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : card.id)}
            >
              <h2>{card.title}</h2>
              {card.line && <small>{card.line}</small>}
            </button>
            {isOpen && (
              <div className="hm-opts">
                {card.options.map((opt, i) => (
                  <button
                    type="button"
                    key={opt.label}
                    className={i === 0 ? 'primary' : ''}
                    onClick={opt.onClick}
                  >
                    <svg viewBox="0 0 24 24">{solar[opt.icon]}</svg>{opt.label}
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
