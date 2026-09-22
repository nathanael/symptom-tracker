# Home dashboard — easy mode

Date: 2026-09-22
Status: approved design, not yet planned

## Purpose

The app currently opens onto a dense symptom list. Every logging path exists
but is buried: rapid entry and talk mode live in the overflow menu, meal
capture lives in the Protocol overflow, and matching yesterday's supplements
is a menu item three taps deep.

This design adds a home screen that reveals three starting points — symptoms,
meals, supplements — as large photographic cards. Tapping one expands it in
place to show two or three ways in, ordered so the intended one is first. The
detailed views are unchanged and remain reachable; this is an easier surface
over the existing app, not a replacement for it.

Mobile only. Desktop keeps `DesktopToolbar` and lands on Symptoms as it does
today.

## Navigation

`appMode` gains a fourth value, `'home'`, and initialises to it. `BottomNav`'s
`TABS` becomes four entries — Home, Symptoms, Protocol, Progress — with
`mobileNav.css` tightening per-tab padding so four labels fit at 390pt.

An effect coerces `appMode` from `'home'` to `'symptoms'` whenever `isDesktop`
becomes true, so a rotated tablet or a resized browser window cannot strand the
user on a screen that is not rendered there.

Home keeps the existing mobile `Header`. Every action on this screen writes to
`selectedDate`, and `selectedDate` does not reset to today on its own. A
dateless full-bleed home would log last Tuesday's supplements while appearing
to be today. The date stepper stays; the cards begin below it.

## The three cards

A flex column filling the height below the header: 12px side padding, 10px
gaps, bottom padding clearing the 110px dock.

Each card is a `<button>` containing a full-bleed WebP, a bottom-up
`rgba(8,9,10,.85)` scrim, a title at 26px/700 on the scrim, and a status line
beneath at 13px in `#94a3b8`.

| Card | Title | Ways in, in order |
|---|---|---|
| Symptoms | Log symptoms | Rapid entry · Talk me through it · Full list |
| Meals | Log a meal | Photo · Type it · Today's meals |
| Supplements | Log supplements | Match yesterday · Simple checklist · Full detail |

The first option on each card is the intended path and renders with a brighter
fill than the others.

### Expansion

Collapsed, all three cards are `flex: 1 1 0`. Tapping one sets `flex-grow: 6`
on it; the other two keep `flex-grow: 1` with `min-height: 64px` so they remain
thumb-sized, tappable strips. Tapping a strip moves the expansion to it.
Tapping the open card's header, or pressing Escape, collapses everything.

The transition animates `flex-grow`, which is plain number interpolation and
behaves correctly in iOS Safari. It deliberately does not animate
`grid-template-rows` between `fr` values, which has been unreliable there.
`prefers-reduced-motion` drops the transition and swaps states directly.

Options render inside the expanded card, over the lower portion of its
photograph: full-width 52px rows, `rgba(0,0,0,.45)` with a backdrop blur, 12px
radius, icon from the existing `solar` set plus a label.

### Status lines

Derived at render, never stored. A card whose count is zero renders no line at
all, so a fresh morning shows three clean photographs.

- Symptoms — symptom entries recorded for `getDateKey(selectedDate)`.
- Meals — meals on the `meals` map for the same key, e.g. "2 meals".
- Supplements — "6 of 9 taken", denominator being active items where
  `isScheduledForDate(item.schedule, selectedDate)`.

These three computations live in `src/utils/homeSummary.js` as pure functions
so they can be unit tested.

### Images

Three free-licensed photographs in `src/assets/home/`, imported by `Home.jsx`
rather than placed in `public/`. Vite then rewrites the URLs, which keeps them
correct under the GitHub Pages base path.

Each is downscaled to 800x600 and encoded as WebP at roughly 60KB, about 180KB
total, fetched once and cached. Replacing one later means overwriting the file
of the same name and rebuilding.

## Actions behind the cards

Home performs no logging of its own. It is a launcher over components that
already exist:

| Option | Invokes |
|---|---|
| Rapid entry | `setShowRapidEntry(true)` |
| Talk me through it | `openTalkMode()` |
| Full list | `setAppMode('symptoms')` |
| Photo | `setMealSheet({})` — the capture sheet opens the camera on mount |
| Type it | `setMealSheet({ manual: true })` — same sheet, skipping the picker |
| Today's meals | `setAppMode('stack')`, scrolled to the meals section |
| Match yesterday | `protocolMatchYesterday()` |
| Simple checklist | `setShowSimpleProtocol(true)` |
| Full detail | `setAppMode('stack')` |

"Type it" is the one existing component that needs a small change:
`MealCapture` currently always starts at `stage: 'capture'` for a new meal and
clicks the file input on mount. It gains an optional prop so it can start at
`'review'` with an empty ingredient list instead.

## SimpleProtocol

A full-screen overlay in the same mould as `RapidEntry`.

- Title row: "Today · 6 of 9".
- One 64px row per active supplement scheduled for `selectedDate`: name at 17px
  on the left, a 28px circular check on the right, the whole row tappable.
- No dose text, no time-of-day columns, no inputs section.
- Footer: "Full detail →", which closes the overlay and sets `appMode` to
  `'stack'`.
- Nothing scheduled for the date: "Nothing scheduled today", plus the footer.

Tapping a row writes exactly the record `protocolCheckAll` already writes —
`{ date: dateKey, itemId: item.id, dose: item.defaultDose, taken: true }` at
key `` `${dateKey}-${item.id}` `` — and un-tapping deletes that key. Because
the shape is identical, sync, backup, tombstones and the supplement graphs
continue to work with no changes to the data layer.

No undo toast. A mistap is undone by tapping the row again, which is faster
than reaching for a toast.

## Files

New:

- `src/components/Home.jsx`
- `src/components/home.css`
- `src/components/SimpleProtocol.jsx`
- `src/utils/homeSummary.js`
- `src/utils/__tests__/homeSummary.test.js`
- `src/assets/home/symptoms.webp`, `meals.webp`, `supplements.webp`

Edited:

- `src/App.jsx` — the `'home'` mode and its initial value, the desktop
  coercion effect, rendering `Home`, one `showSimpleProtocol` state and its
  overlay.
- `src/components/BottomNav.jsx` — fourth tab.
- `src/components/mobileNav.css` — fit four tabs.
- `src/components/MealCapture.jsx` — optional prop to start in review.

`App.jsx` is already 1460 lines. This design does not refactor it; that is out
of scope. `Home` is kept purely presentational so the new surface area there is
one state variable and a props object.

## Testing and verification

The project's Vitest suite covers logic, not components. Accordingly:

- `homeSummary.test.js` covers zero-state silence, partial counts, and the
  scheduled-items denominator including items inactive or not scheduled for
  the date.
- Everything else is layout and interaction, verified the way this project
  verifies changes: bump the version, `npm run build && npm run deploy`, and
  check it on the phone against the deployed Pages build. No claim of
  correctness is made from a localhost or headless check.

## Explicitly out of scope

- Any Home screen on desktop.
- A setting to turn easy mode off, or to choose a different landing tab.
- Repeating a recent meal.
- Editing doses from the simplified checklist.
- Refactoring `App.jsx`.
