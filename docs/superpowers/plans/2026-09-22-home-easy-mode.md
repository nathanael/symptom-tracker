# Home Easy-Mode Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile home screen of three photographic cards — symptoms, meals, supplements — each expanding in place to reveal two or three easy ways to log that thing.

**Architecture:** A new `appMode` value, `'home'`, becomes the app's initial state and a fourth tab in the mobile dock. `Home.jsx` is purely presentational: it renders three cards and calls handlers `App.jsx` already owns (`setShowRapidEntry`, `openTalkMode`, `setMealSheet`, `protocolMatchYesterday`, `setAppMode`). The only genuinely new view is `SimpleProtocol.jsx`, a stripped-down supplement checklist that writes the identical record `protocolCheckAll` already writes, so the sync, backup and graph layers need no changes. Desktop never renders any of it.

**Tech Stack:** React 18, Vite, plain CSS files imported per component, Vitest for logic tests, `gh-pages` for deploy.

**Spec:** `docs/superpowers/specs/2026-09-22-home-easy-mode-design.md`

## Global Constraints

- **Mobile only.** Nothing in this plan may render when `isDesktop` is true. `DesktopToolbar` is not modified.
- **No new dependencies.** No npm installs.
- **No data-layer changes.** `SimpleProtocol` writes `{ date, itemId, dose, taken: true }` at key `` `${dateKey}-${itemId}` ``, identical to `protocolCheckAll` in `src/App.jsx:509`. Nothing in `src/sync/` is touched.
- **Version discipline (from `CLAUDE.md`).** The version lives only in `package.json` and is bumped with `npm version <x.y.z> --no-git-tag-version`, which updates `package-lock.json` too. Both files are committed. Never hardcode a version string anywhere else. Every deploy is preceded by a bump, no exceptions.
- **Deploy is the verification step.** After pushing, always run `npm run build && npm run deploy`. Layout and interaction are confirmed on the deployed GitHub Pages build on a phone — never from a localhost or headless check, and never claimed without it.
- **JPEG, not WebP — a deliberate deviation from the spec.** The spec says WebP. `sips`, which ships with macOS, produces JPEG with no new dependency and no risk of a missing `cwebp`; at 800x600 the size difference is roughly 15KB across all three files. If `cwebp` happens to be installed, WebP is fine — change the three import extensions in `Home.jsx` to match.
- **Existing styling tokens.** Background `#08090a`, panel `#0e0f11`, text `#f3f4f6`, muted `#9ca3af`, dimmer muted `#6b7280`, status line `#94a3b8`, accent `#8b5cf6`. Hairlines are `1px solid rgba(255,255,255,.07)`; control borders are `rgba(255,255,255,.12)`.
- **Icons** come from the existing `solar` map in `src/components/solarIcons.jsx`. Do not add icons. Available keys: `symptoms`, `protocol`, `progress`, `more`, `trash`, `gear`, `copy`, `edit`, `yesterday`, `note`, `bolt`, `mic`, `camera`.

---

### Task 1: Home summary counts

The three status lines under the card titles. Pure functions over the raw stores so they can be unit tested and so `Home` stays presentational.

**Files:**
- Create: `src/utils/homeSummary.js`
- Test: `src/utils/__tests__/homeSummary.test.js`

**Interfaces:**
- Consumes: `getDateKey(date)` and `isScheduledForDate(schedule, date)` from `src/utils/helpers.js`; `mealDateKey(key)` from `src/food/mealKey.js`.
- Produces:
  - `symptomsLogged(entries, date) -> number`
  - `mealsLogged(meals, date) -> number`
  - `supplementsTaken(stackItems, stackEntries, date) -> { taken: number, due: number }`
  - `summaryLines({ entries, meals, stackItems, stackEntries, date }) -> { symptoms: string|null, meals: string|null, supplements: string|null }`

Data shapes, for reference while writing the tests:

- `entries` is an object keyed `` `${dateKey}-${symptomId}-${timeId}` `` with values `{ time, severity, date, symptomId, note? }`. **Count the values by their own `date` field, not by parsing keys** — symptom ids contain hyphens, so key parsing is wrong.
- `meals` is an object keyed by a meal key whose date is extracted with `mealDateKey(key)`.
- `stackItems` is an array of `{ id, name, unit, defaultDose, active, order, schedule? }`.
- `stackEntries` is an object keyed `` `${dateKey}-${itemId}` `` with values `{ date, itemId, dose, taken }`.
- `getDateKey` returns `YYYY-MM-DD` in **local** time.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/__tests__/homeSummary.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { symptomsLogged, mealsLogged, supplementsTaken, summaryLines } from '../homeSummary';

const DAY = new Date(2026, 8, 22);        // 2026-09-22, a Tuesday
const OTHER = new Date(2026, 8, 21);

const entries = {
  '2026-09-22-head-ache-am': { date: '2026-09-22', symptomId: 'head-ache', time: 'am', severity: 3 },
  '2026-09-22-head-ache-pm': { date: '2026-09-22', symptomId: 'head-ache', time: 'pm', severity: 2 },
  '2026-09-21-head-ache-am': { date: '2026-09-21', symptomId: 'head-ache', time: 'am', severity: 1 },
};

const meals = {
  '2026-09-22T08:15:00-a1b2': { name: 'porridge', ingredients: ['oats'] },
  '2026-09-22T13:40:00-c3d4': { name: 'salad', ingredients: ['lettuce'] },
  '2026-09-21T19:02:00-e5f6': { name: 'curry', ingredients: ['rice'] },
};

const stackItems = [
  { id: 'd3', name: 'D3', defaultDose: 5000, active: true },
  { id: 'b2', name: 'B2', defaultDose: 250, active: true },
  { id: 'zinc', name: 'Zinc', defaultDose: 15, active: false },                       // inactive
  { id: 'iron', name: 'Iron', defaultDose: 20, active: true,
    schedule: { type: 'days', days: [1] } },                                          // Mondays only
];

const stackEntries = {
  '2026-09-22-d3': { date: '2026-09-22', itemId: 'd3', dose: 5000, taken: true },
  '2026-09-22-zinc': { date: '2026-09-22', itemId: 'zinc', dose: 15, taken: true },    // inactive item
};

describe('symptomsLogged', () => {
  it('counts entries recorded on the date', () => {
    expect(symptomsLogged(entries, DAY)).toBe(2);
  });

  it('counts a different date independently', () => {
    expect(symptomsLogged(entries, OTHER)).toBe(1);
  });

  it('is zero for an empty or missing store', () => {
    expect(symptomsLogged({}, DAY)).toBe(0);
    expect(symptomsLogged(undefined, DAY)).toBe(0);
  });
});

describe('mealsLogged', () => {
  it('counts meals whose key falls on the date', () => {
    expect(mealsLogged(meals, DAY)).toBe(2);
    expect(mealsLogged(meals, OTHER)).toBe(1);
  });

  it('is zero for an empty or missing store', () => {
    expect(mealsLogged({}, DAY)).toBe(0);
    expect(mealsLogged(undefined, DAY)).toBe(0);
  });
});

describe('supplementsTaken', () => {
  it('counts only active items scheduled for the date', () => {
    // D3 and B2 are due; Zinc is inactive; Iron is Mondays and the 22nd is a Tuesday.
    expect(supplementsTaken(stackItems, stackEntries, DAY)).toEqual({ taken: 1, due: 2 });
  });

  it('does not let an entry for a non-due item inflate taken past due', () => {
    const { taken, due } = supplementsTaken(stackItems, stackEntries, DAY);
    expect(taken).toBeLessThanOrEqual(due);
  });

  it('reports zero due when nothing is active', () => {
    expect(supplementsTaken([{ id: 'x', name: 'X', active: false }], {}, DAY))
      .toEqual({ taken: 0, due: 0 });
  });

  it('is safe on missing stores', () => {
    expect(supplementsTaken(undefined, undefined, DAY)).toEqual({ taken: 0, due: 0 });
  });
});

describe('summaryLines', () => {
  it('phrases each line', () => {
    expect(summaryLines({ entries, meals, stackItems, stackEntries, date: DAY })).toEqual({
      symptoms: '2 logged today',
      meals: '2 meals',
      supplements: '1 of 2 taken',
    });
  });

  it('singularises one meal', () => {
    const one = { '2026-09-22T08:15:00-a1b2': { name: 'porridge' } };
    expect(summaryLines({ entries: {}, meals: one, stackItems: [], stackEntries: {}, date: DAY }).meals)
      .toBe('1 meal');
  });

  it('is silent on a fresh day so the cards stay clean', () => {
    expect(summaryLines({ entries: {}, meals: {}, stackItems, stackEntries: {}, date: DAY })).toEqual({
      symptoms: null,
      meals: null,
      supplements: null,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/homeSummary.test.js`
Expected: FAIL — `Failed to resolve import "../homeSummary"`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/homeSummary.js`:

```js
// The one-line counts under each Home card. Pure over the raw stores so they can be unit
// tested and so Home itself stays presentational.
//
// Every line goes null at zero: a fresh morning should be three clean photographs, not three
// zeroes. That includes supplements — "0 of 9 taken" is deliberately not shown. If that ever
// feels wrong, the single line to change is in summaryLines.

import { getDateKey, isScheduledForDate } from './helpers';
import { mealDateKey } from '../food/mealKey';

// Entry values carry their own `date`, so count values rather than parsing keys — symptom ids
// contain hyphens and a key split would be wrong.
export function symptomsLogged(entries, date) {
  const dateKey = getDateKey(date);
  let n = 0;
  for (const entry of Object.values(entries || {})) {
    if (entry?.date === dateKey) n += 1;
  }
  return n;
}

export function mealsLogged(meals, date) {
  const dateKey = getDateKey(date);
  let n = 0;
  for (const key of Object.keys(meals || {})) {
    if (mealDateKey(key) === dateKey) n += 1;
  }
  return n;
}

// `taken` is counted over the due list only, so an entry left behind by an item that has since
// been descheduled or deactivated cannot push taken past due.
export function supplementsTaken(stackItems, stackEntries, date) {
  const dateKey = getDateKey(date);
  const due = (stackItems || []).filter((i) => i.active && isScheduledForDate(i.schedule, date));
  let taken = 0;
  for (const item of due) {
    if (stackEntries?.[`${dateKey}-${item.id}`]?.taken) taken += 1;
  }
  return { taken, due: due.length };
}

export function summaryLines({ entries, meals, stackItems, stackEntries, date }) {
  const symptoms = symptomsLogged(entries, date);
  const mealCount = mealsLogged(meals, date);
  const { taken, due } = supplementsTaken(stackItems, stackEntries, date);
  return {
    symptoms: symptoms === 0 ? null : `${symptoms} logged today`,
    meals: mealCount === 0 ? null : `${mealCount} meal${mealCount === 1 ? '' : 's'}`,
    supplements: taken === 0 ? null : `${taken} of ${due} taken`,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/homeSummary.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/homeSummary.js src/utils/__tests__/homeSummary.test.js
git commit -m "feat(home): derive the three home-card summary counts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Two props the Home options need

`Home`'s "Type it" option must reach the meal review sheet without opening the camera, and "Today's meals" must land on the meals section rather than below a full supplement list. Both are additive props whose absence leaves today's behaviour byte-for-byte unchanged.

**Files:**
- Modify: `src/components/MealCapture.jsx:26-42`
- Modify: `src/components/MealList.jsx:44`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `<MealCapture startManual />` — mounts at `stage: 'review'` with `source: 'manual'` and never clicks the file input.
  - `<MealList scrollIntoViewOnMount />` — scrolls its own heading into view once on mount.

- [ ] **Step 1: Add `startManual` to MealCapture**

In `src/components/MealCapture.jsx`, change the signature and the initial `stage`/`source`:

```jsx
export default function MealCapture({ existing, startManual, onSave, onDelete, onClose }) {
  const [stage, setStage] = useState(existing || startManual ? 'review' : 'capture');
```

and

```jsx
  const [source, setSource] = useState(existing?.source || (startManual ? 'manual' : 'photo'));
```

Leave the `useEffect` that clicks `fileRef` untouched — it is already guarded by `if (stage === 'capture')`, which `startManual` now skips.

- [ ] **Step 2: Add `scrollIntoViewOnMount` to MealList**

In `src/components/MealList.jsx`, add the imports and a ref on the heading. Change the import line to:

```jsx
import { useEffect, useRef } from 'react';
import { mealDateKey, compareMealKeys } from '../food/mealKey';
import { solar } from './solarIcons';
```

Change the signature and add the effect:

```jsx
export default function MealList({ meals, dateKey, onOpen, onAdd, scrollIntoViewOnMount }) {
  const headingRef = useRef(null);

  // "Today's meals" on the Home screen lands on the Protocol tab, where this section sits below
  // the whole supplement list and would otherwise be off-screen on arrival.
  useEffect(() => {
    if (scrollIntoViewOnMount) headingRef.current?.scrollIntoView({ block: 'start' });
  }, [scrollIntoViewOnMount]);
```

and put the ref on the existing section heading:

```jsx
      <div className="lr-sec" ref={headingRef}>
```

- [ ] **Step 3: Verify the defaults are unchanged and the build is clean**

Run: `npm test && npm run build`
Expected: tests PASS, build succeeds. Neither prop is passed by any caller yet, so behaviour is identical.

- [ ] **Step 4: Commit**

```bash
git add src/components/MealCapture.jsx src/components/MealList.jsx
git commit -m "feat(meals): add startManual and scrollIntoViewOnMount props

Both default to today's behaviour; the Home screen's 'Type it' and
'Today's meals' options are the first callers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The Home component

The three cards and their expansion, in isolation. Nothing renders it yet — Task 4 wires it in.

**Files:**
- Create: `src/assets/home/symptoms.jpg`, `src/assets/home/meals.jpg`, `src/assets/home/supplements.jpg`
- Create: `src/components/Home.jsx`
- Create: `src/components/home.css`

**Interfaces:**
- Consumes: `summaryLines(...)` from Task 1 — but only its *return value*, passed in as the `summary` prop. `Home` does not import `homeSummary`.
- Produces: `<Home summary onRapidEntry onTalkMode onSymptomList onPhotoMeal onTypeMeal onTodaysMeals onMatchYesterday onSimpleChecklist onProtocolDetail />`, where `summary` is `{ symptoms, meals, supplements }` with each value a string or `null`, and every `on*` is a zero-argument function.

- [ ] **Step 1: Acquire the three photographs**

Source one photograph per card from a site whose licence permits redistribution without attribution in a private app — Unsplash or Pexels. Search terms that suit the dark treatment: morning light on bedding for symptoms, a plated meal shot from above for meals, capsules on a plain surface for supplements.

Process each to 800×600 JPEG with the macOS built-in, no new dependency:

```bash
mkdir -p src/assets/home
sips -Z 1400 -s format jpeg -s formatOptions 72 \
  ~/Downloads/<downloaded-file> --out src/assets/home/symptoms.jpg
sips --cropToHeightWidth 600 800 src/assets/home/symptoms.jpg
```

Two passes on purpose: `-Z` scales the longest edge to 1400 while keeping the aspect ratio, so the
crop that follows always has enough pixels in both dimensions. `--cropToHeightWidth` takes
**height then width** — 600 then 800.

Repeat for `meals.jpg` and `supplements.jpg`.

Acceptance: each file is 800×600, under 80KB (`ls -lh src/assets/home/`), and dark enough in its lower third that white 26px text on the scrim stays legible. Prefer a photograph whose subject sits in the upper half, since the lower half is covered by the scrim and the option rows.

If there is no network access at execution time, do not block: generate three placeholder gradients so the build is never broken, and tell Nate in the handoff that the art is a placeholder.

```bash
mkdir -p src/assets/home
for n in symptoms meals supplements; do
  sips -s format jpeg -s formatOptions 60 --resampleHeightWidth 600 800 \
    public/icon-512.png --out "src/assets/home/$n.jpg"
done
```

That stretches the app icon into three identical, obviously-wrong placeholders — which is the
point: the build works, and nobody mistakes them for the finished art.

- [ ] **Step 2: Write the stylesheet**

Create `src/components/home.css`:

```css
/* Home — three photographs, one expanding in place. Same tokens as the nav and Rapid entry.
   The expansion animates flex-grow, a plain number, rather than grid-template-rows between
   fr units, which iOS Safari has not interpolated reliably. */
.hm { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.hm * { -webkit-tap-highlight-color: transparent; }

.hm-card { position: relative; flex: 1 1 0; min-height: 64px; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 20px; overflow: hidden; background-size: cover; background-position: center; background-color: #17191c; transition: flex-grow .28s cubic-bezier(.22,1,.36,1); }
.hm-card::before { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, rgba(8,9,10,.93) 0%, rgba(8,9,10,.6) 45%, rgba(8,9,10,.18) 100%); }
.hm-card.on { flex-grow: 6; }
.hm-card.off { flex-grow: 1; }

.hm-face { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border: 0; background: none; color: #f3f4f6; font-family: inherit; text-align: left; cursor: pointer; }
.hm-face h2 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; }
.hm-face small { color: #94a3b8; font-size: 13px; }
.hm-card.off .hm-face { padding: 0 16px; height: 64px; justify-content: center; }
.hm-card.off .hm-face h2 { font-size: 17px; font-weight: 600; }
.hm-card.off .hm-face small { display: none; }

.hm-opts { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px; animation: hmOptsIn .2s ease-out; }
@keyframes hmOptsIn { from { opacity: 0; transform: translateY(6px); } }
.hm-opts button { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 14px; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; background: rgba(0,0,0,.45); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); color: #f3f4f6; font-family: inherit; font-size: 15.5px; text-align: left; cursor: pointer; }
.hm-opts button svg { width: 20px; height: 20px; flex: none; fill: currentColor; color: #9ca3af; }
.hm-opts button:active { background: rgba(0,0,0,.62); }
.hm-opts button.primary { background: rgba(139,92,246,.32); border-color: rgba(139,92,246,.5); font-weight: 500; }
.hm-opts button.primary svg { color: #ddd6fe; }

@media (prefers-reduced-motion: reduce) {
  .hm-card { transition: none; }
  .hm-opts { animation: none; }
}
```

- [ ] **Step 3: Write the component**

Create `src/components/Home.jsx`:

```jsx
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
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run build`
Expected: succeeds. The three JPEGs appear hashed under `dist/assets/`, which is what makes the Pages base path correct — confirm with `ls dist/assets | grep -E 'symptoms|meals|supplements'`.

- [ ] **Step 5: Commit**

```bash
git add src/assets/home src/components/Home.jsx src/components/home.css
git commit -m "feat(home): the three-card easy-mode landing component

Not reachable yet; App wiring follows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire Home into the app

Home becomes the fourth tab and the app's landing screen. Eight of the nine options go live. "Simple checklist" temporarily calls the same handler as "Full detail" so this task ships something whole; Task 5 replaces it.

**Files:**
- Modify: `src/components/BottomNav.jsx:5-9` (the `TABS` array) and its tab-rendering JSX
- Modify: `src/components/mobileNav.css` (the `.mn-tabs` rules)
- Modify: `src/App.jsx` — `appMode` initial value (`:74`), a new effect, the render branch (`:820`), and the `BottomNav` props (`:1421`)

**Interfaces:**
- Consumes: `summaryLines` from Task 1; `<Home>` from Task 3; `startManual` and `scrollIntoViewOnMount` from Task 2.
- Produces: `appMode === 'home'` as a valid, default state; `scrollToMeals` boolean state in `App` consumed by `MealList`.

- [ ] **Step 1: Add the Home tab to BottomNav**

In `src/components/BottomNav.jsx`, change `TABS`:

```jsx
const TABS = [
  { id: 'home', label: 'Home', icon: solar.symptoms },
  { id: 'symptoms', label: 'Symptoms', icon: solar.symptoms },
  { id: 'stack', label: 'Protocol', icon: solar.protocol },
  { id: 'insights', label: 'Progress', icon: solar.progress },
];
```

The two `solar.symptoms` are deliberate for now — Home shares the heart-pulse glyph. Replace `home`'s icon with `solar.note` if the duplication reads badly on the device.

Wrap the label in a span so it can ellipsis at four tabs:

```jsx
              <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? 'on' : ''} onClick={() => goTo(tab.id)}>
                <svg viewBox="0 0 24 24">{tab.icon}</svg><span>{tab.label}</span>
              </button>
```

`activeTab` needs no change: it already falls through to `appMode` for anything that is not `'symptoms'`, so add the explicit case to keep it readable:

```jsx
  const activeTab = showInsights ? 'insights' : appMode === 'home' ? 'home' : appMode === 'symptoms' ? 'symptoms' : 'stack';
```

`goTo` needs no change — `setAppMode('home')` is already what it does for a non-insights tab.

- [ ] **Step 2: Make four tabs fit**

In `src/components/mobileNav.css`, replace the two `.mn-tabs button` rules with:

```css
.mn-tabs button { flex: 1; min-width: 0; height: 46px; padding: 0 2px; border: 0; border-radius: 18px; background: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: #6b7280; font-size: 10px; font-weight: 500; }
.mn-tabs button span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mn-tabs button svg { width: 20px; height: 20px; }
```

- [ ] **Step 3: Land on Home, and never on desktop**

In `src/App.jsx`, change the initial mode at line 74:

```jsx
  // App mode: 'home' (the easy-mode landing screen), 'symptoms' or 'stack'
  const [appMode, setAppMode] = useState('home');
```

Add `scrollToMeals` beside the other view state, near line 196:

```jsx
  const [showSimpleProtocol, setShowSimpleProtocol] = useState(false);
  const [scrollToMeals, setScrollToMeals] = useState(false);
```

Add the desktop coercion immediately after the `isDesktop` value is available (put it next to the other `useEffect`s, after the sync wiring):

```jsx
  // Home is mobile-only. Rotating a tablet or widening a browser must not strand the user on a
  // screen desktop does not render.
  useEffect(() => {
    if (isDesktop && appMode === 'home') setAppMode('symptoms');
  }, [isDesktop, appMode]);
```

Add the imports at the top, beside the other component imports:

```jsx
import Home from './components/Home';
import { summaryLines } from './utils/homeSummary';
```

- [ ] **Step 4: Render Home**

**Leave the mobile `Header` exactly as it is.** It renders for every `!isDesktop` branch and must
keep rendering on Home. Every option on this screen writes to `selectedDate`, and `selectedDate`
does not reset to today on its own — a dateless Home would cheerfully log last Tuesday while
looking like today. The date stepper stays at the top; the cards go below it.

In `src/App.jsx`, the render currently reads `{isDesktop ? ( …desktop… ) : ( …mobile scroll container… )}` around line 820. Insert a branch between them so Home sits outside the scrolling container — it fills the viewport and must not scroll:

```jsx
      {isDesktop ? (
        /* …existing desktop content area, unchanged… */
      ) : appMode === 'home' ? (
        <div style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: '104px',
        }}>
          <Home
            summary={summaryLines({
              entries: deferredEntries,
              meals,
              stackItems: liveStackItems,
              stackEntries: deferredStackEntries,
              date: selectedDate,
            })}
            onRapidEntry={() => { setAppMode('symptoms'); setShowRapidEntry(true); }}
            onTalkMode={() => { setAppMode('symptoms'); openTalkMode(); }}
            onSymptomList={() => setAppMode('symptoms')}
            onPhotoMeal={() => setMealSheet({})}
            onTypeMeal={() => setMealSheet({ startManual: true })}
            onTodaysMeals={() => { setScrollToMeals(true); setAppMode('stack'); }}
            onMatchYesterday={() => { setAppMode('stack'); protocolMatchYesterday(); }}
            onSimpleChecklist={() => setAppMode('stack')}
            onProtocolDetail={() => setAppMode('stack')}
          />
        </div>
      ) : (
        /* …existing mobile scroll container, unchanged… */
      )}
```

`onSimpleChecklist` is deliberately identical to `onProtocolDetail` for now; Task 5 points it at `setShowSimpleProtocol(true)`.

- [ ] **Step 5: Pass the two new props through**

`MealCapture` is rendered around line 1038. Pass the flag through from `mealSheet`:

```jsx
        <MealCapture
          existing={mealSheet.key ? { key: mealSheet.key, ...meals[mealSheet.key] } : null}
          startManual={!!mealSheet.startManual}
          onSave={saveMeal}
          onDelete={deleteMeal}
          onClose={() => setMealSheet(null)}
        />
```

`MealList` appears **twice** — once in the desktop `ProtocolRows` at line 902 and once in the mobile one at line 991. Only the mobile one needs the flag; change that occurrence to:

```jsx
                  <MealList
                    meals={meals}
                    dateKey={getDateKey(selectedDate)}
                    scrollIntoViewOnMount={scrollToMeals}
                    onOpen={(key) => setMealSheet({ key })}
                    onAdd={() => setMealSheet({})}
                  />
```

and clear the one-shot flag once it has been consumed, beside the coercion effect:

```jsx
  // One-shot: "Today's meals" sets it, MealList consumes it on its next mount.
  useEffect(() => {
    if (scrollToMeals && appMode === 'stack') {
      const id = setTimeout(() => setScrollToMeals(false), 400);
      return () => clearTimeout(id);
    }
  }, [scrollToMeals, appMode]);
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run build`
Expected: tests PASS, build succeeds.

- [ ] **Step 7: Bump, commit, push, deploy**

Read the current version first, then bump the minor (this is a feature):

```bash
node -p "require('./package.json').version"
npm version 6.8.0 --no-git-tag-version
```

Use the actual next minor if the current version is not 6.7.x.

```bash
git add package.json package-lock.json src/App.jsx src/components/BottomNav.jsx src/components/mobileNav.css
git commit -m "feat(home): land on the easy-mode home screen; release v6.8.0

Home is a fourth mobile tab and the app's initial view. Desktop coerces
back to Symptoms. 'Simple checklist' temporarily opens the full protocol
view; SimpleProtocol follows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
npm run build && npm run deploy
```

- [ ] **Step 8: Confirm on the phone**

Open the deployed Pages URL on the phone and check, reporting what you actually saw:
1. The app opens on Home with three photographs and four dock tabs.
2. Tapping a card expands it smoothly; the other two become tappable strips.
3. Each of the eight live options lands where it should, and "Type it" does **not** open the camera.
4. "Today's meals" arrives on the Protocol tab with the MEALS section in view.
5. The date in the header still drives what gets logged — step back a day, log from Home, confirm it landed on that day.

---

### Task 5: The simplified supplement checklist

**Files:**
- Create: `src/components/SimpleProtocol.jsx`
- Create: `src/components/simpleProtocol.css`
- Modify: `src/App.jsx` — render the overlay, repoint `onSimpleChecklist`

**Interfaces:**
- Consumes: `showSimpleProtocol` state added in Task 4; `getDateKey`, `isScheduledForDate`, `haptic` from `src/utils/helpers.js`.
- Produces: `<SimpleProtocol stackItems stackEntries setStackEntries selectedDate onFullDetail onClose />`.

- [ ] **Step 1: Write the stylesheet**

Create `src/components/simpleProtocol.css`:

```css
/* The simplified supplement view — what's due today, a name and a big check, nothing else.
   Same overlay shell as Rapid entry. */
.sp { position: fixed; inset: 0; z-index: 260; display: flex; flex-direction: column; background: #08090a; color: #f3f4f6; padding-top: env(safe-area-inset-top); }
.sp-in { flex: 1; min-height: 0; width: 100%; max-width: 500px; margin: 0 auto; display: flex; flex-direction: column; }
.sp button { font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }

.sp-bar { flex: none; display: flex; align-items: center; gap: 6px; height: 48px; padding: 0 16px 0 8px; background: #0e0f11; border-bottom: 1px solid rgba(255,255,255,.07); }
.sp-bar h2 { margin: 0; font-size: 16px; font-weight: 600; }
.sp-bar span { margin-left: auto; color: #9ca3af; font-size: 13px; }
.sp-close { width: 40px; height: 40px; border: 0; border-radius: 11px; background: none; color: #9ca3af; display: grid; place-items: center; }
.sp-close:active { background: rgba(255,255,255,.06); }
.sp-close svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }

.sp-list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; }
.sp-empty { margin: 32px 0; text-align: center; color: #6b7280; font-size: 14.5px; }

.sp-row { display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 16px; border: 1px solid rgba(255,255,255,.07); border-radius: 14px; background: #101214; color: #f3f4f6; font-size: 17px; text-align: left; }
.sp-row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-row i { flex: none; width: 28px; height: 28px; border-radius: 50%; border: 2px solid rgba(255,255,255,.22); }
.sp-row:active { background: #16191c; }
.sp-row.on { border-color: rgba(74,222,128,.35); background: rgba(74,222,128,.08); }
.sp-row.on i { border-color: #4ade80; background: #4ade80 no-repeat center/16px url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23052e16' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E"); }

.sp-foot { flex: none; padding: 8px 12px calc(14px + env(safe-area-inset-bottom)); }
.sp-foot button { width: 100%; height: 48px; border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: none; color: #9ca3af; font-size: 15px; }
.sp-foot button:active { background: rgba(255,255,255,.06); }
```

- [ ] **Step 2: Write the component**

Create `src/components/SimpleProtocol.jsx`:

```jsx
// The simplified supplement view: what's due today, a name and a big check, nothing else.
// No doses, no time-of-day columns, no inputs section.
//
// It writes exactly the record protocolCheckAll writes, so sync, backup, tombstones and the
// supplement graphs are unaffected. No undo toast either — a mistap is undone by tapping the
// row again, which is faster than reaching for a toast.

import { useEffect } from 'react';
import { getDateKey, isScheduledForDate, haptic } from '../utils/helpers';
import './simpleProtocol.css';

export default function SimpleProtocol({
  stackItems,
  stackEntries,
  setStackEntries,
  selectedDate,
  onFullDetail,
  onClose,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dateKey = getDateKey(selectedDate);
  const due = (stackItems || []).filter((i) => i.active && isScheduledForDate(i.schedule, selectedDate));
  const keyFor = (item) => `${dateKey}-${item.id}`;
  const isTaken = (item) => !!stackEntries[keyFor(item)]?.taken;
  const taken = due.filter(isTaken).length;

  const toggle = (item) => {
    const key = keyFor(item);
    setStackEntries((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: { date: dateKey, itemId: item.id, dose: item.defaultDose, taken: true } };
    });
    haptic('light');
  };

  return (
    <div className="sp">
      <div className="sp-in">
        <div className="sp-bar">
          <button className="sp-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <h2>Today</h2>
          {due.length > 0 && <span>{taken} of {due.length}</span>}
        </div>

        <div className="sp-list">
          {due.length === 0 ? (
            <p className="sp-empty">Nothing scheduled today.</p>
          ) : due.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sp-row${isTaken(item) ? ' on' : ''}`}
              aria-pressed={isTaken(item)}
              onClick={() => toggle(item)}
            >
              <span>{item.name}</span>
              <i />
            </button>
          ))}
        </div>

        <div className="sp-foot">
          <button onClick={onFullDetail}>Full detail →</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into App**

In `src/App.jsx`, add the import beside the other components:

```jsx
import SimpleProtocol from './components/SimpleProtocol';
```

Repoint the Home handler from Task 4:

```jsx
            onSimpleChecklist={() => setShowSimpleProtocol(true)}
```

Render the overlay next to the `RapidEntry` block around line 1005:

```jsx
      {/* Simplified supplement checklist */}
      {showSimpleProtocol && (
        <SimpleProtocol
          stackItems={liveStackItems}
          stackEntries={stackEntries}
          setStackEntries={setStackEntries}
          selectedDate={selectedDate}
          onFullDetail={() => { setShowSimpleProtocol(false); setAppMode('stack'); }}
          onClose={() => setShowSimpleProtocol(false)}
        />
      )}
```

Note `stackEntries`, not `deferredStackEntries` — this view must reflect a tap immediately, and `useDeferredValue` would make the check lag under load.

- [ ] **Step 4: Verify**

Run: `npm test && npm run build`
Expected: tests PASS, build succeeds.

- [ ] **Step 5: Bump, commit, push, deploy**

```bash
npm version 6.8.1 --no-git-tag-version
git add package.json package-lock.json src/App.jsx src/components/SimpleProtocol.jsx src/components/simpleProtocol.css
git commit -m "feat(home): simplified supplement checklist; release v6.8.1

Name and a big check for what's due today, writing the same record
protocolCheckAll writes so the data layer is untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push
npm run build && npm run deploy
```

- [ ] **Step 6: Confirm on the phone**

On the deployed build, report what you actually saw:
1. Home → Log supplements → Simple checklist opens the list of what's due today.
2. The header count matches the number of filled checks.
3. Tapping a row fills its check; tapping again empties it.
4. Backing out to the Protocol tab shows the same supplements ticked, at their default doses.
5. "Full detail →" closes the overlay onto the Protocol tab.
6. On a day with nothing scheduled, the empty line shows and the footer still works.

---

## Notes for the executor

- **`App.jsx` is 1460 lines and this plan does not refactor it.** Resist the urge. Every addition is one state variable, one effect, one import, or one props object.
- **Line numbers in this plan are from the pre-change file** and drift as you work. Locate by the surrounding code quoted here, not by the number.
- **Do not claim a screen works from a build or a localhost check.** The only verification that counts is the deployed Pages build on the phone. If you cannot check it, say so plainly and hand the check to Nate.
