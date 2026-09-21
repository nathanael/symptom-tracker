# Meal logging (photo first) — design

*2026-09-21. Branch `claude/meal-logging`, based on `main` v6.6.19.*

## Goal

Take a photo of a meal, have an AI list the ingredients, let the user correct the list, and store it
with a timestamp. Nothing else: no link to symptoms, no correlation, no charts. The data only has to
be stored well enough that later analysis can use it.

Text and voice description come next and reuse everything except the input step.

## Out of scope

- Keeping the photo (discarded after analysis; never stored or synced)
- Quantities, calories, nutrition
- Any tie to "Other factors → Food" (`inputItems` / `inputEntries`)
- Insights, correlation, export formatting beyond what the JSON backup gets for free
- A meal history screen beyond a plain list for the viewed day (needed to edit or delete a mistake)

## Backend: `POST /meal` on the `glimpse-voice` worker

`cloudflare/voice/src/index.js` gains one route, behind the same Firebase auth and CORS as the rest.

Request (one of):

```json
{ "image": "<base64 JPEG, no data: prefix>" }
{ "text": "chicken caesar wrap and a coffee with oat milk" }
```

Response:

```json
{ "name": "Chicken caesar wrap", "ingredients": ["chicken", "romaine", "parmesan", "..."] }
```

- Uses `GEMINI_API_KEY` (already set) through `@google/genai` `models.generateContent`, with a
  response schema so the reply is always `{ name: string, ingredients: string[] }`.
- Model id in `DEFAULTS` as `MEAL_MODEL`, overridable from `wrangler.toml` like the talk models.
- Prompt: list the actual ingredients likely in the dish, including ones that can't be seen but are
  almost certainly there (oil, flour, dairy in a sauce); lowercase, singular, generic names
  ("tomato", not "3 cherry tomatoes"); no quantities; if the image is not food, return an empty list.
- Own daily cap: `DAILY_CAPS.meals = 50`, spent through the existing `spend()`.
- Limits: reject `image` over ~1.5 MB base64 and `text` over 2,000 chars with 400.
- Errors reuse `HttpError`: 502 "Couldn't read that meal. Try again or type it in."
- The parsing/normalising of the model reply (trim, lowercase, dedupe, drop empties, cap at 40
  items) lives in its own pure module, `cloudflare/voice/src/mealParse.js`, so it can be unit tested.

## Client

New folder `src/food/`:

| File | Purpose |
|---|---|
| `mealApi.js` | `analyzeMeal({ image } \| { text })` → `{ name, ingredients }`. Reuses the authenticated `post` from `src/voice/voiceApi.js` (export it). |
| `shrinkImage.js` | File → base64 JPEG, longest side 1024px, quality 0.8, via canvas. Pure apart from the canvas. |
| `mealKey.js` | `mealKey(date)` → `YYYY-MM-DDTHH:mm:ss-<4 char id>` in **local** time, so the key's date prefix matches the day the user sees and month-sharding works. |

New component `src/components/MealCapture.jsx` (+ css), a full-screen sheet with three states:

1. **Capture** — a hidden `<input type="file" accept="image/*" capture="environment">` opened
   straight away, so on the phone the camera appears with one tap. Also accepts a library photo.
2. **Analyzing** — spinner over the photo preview (object URL, revoked on close).
3. **Review** — meal name (editable), ingredient list (tap to rename, × to remove, "Add ingredient"
   field at the bottom), time (defaults to now, editable), **Save** / **Cancel**.

If analysis fails or the device is offline, the sheet goes to Review with an empty list and the
error shown inline, so the meal can still be typed by hand. `source` is then `'manual'`.

Entry points: "Log a meal" in the mobile ⋯ quick-actions menu (`QuickActionsMenu.jsx`) and a button
on the Protocol tab. Signed-out users see the existing "sign in" message from the API.

The Protocol tab also shows a small "Meals" section for the viewed day: time, name, ingredient
count; tap to reopen the Review sheet on that record, with Delete (toast + Undo, like other deletes).

## Storage and sync

New map domain `meals`, month-sharded, exactly like `inputEntries`:

```js
meals: { storageKey: 'symptomTracker_meals', kind: 'map', sharding: 'month' }
```

Record, keyed by `mealKey`:

```js
{ time: '2026-09-21T12:41:07-04:00', name: 'Chicken caesar wrap',
  ingredients: ['chicken', 'romaine', ...], source: 'photo' | 'text' | 'manual' }
```

The app never stamps `_t`; deletes become tombstones through the engine as for other map domains.

Domain lists are hardcoded in several places, all of which need `meals` added:

- `src/sync/domains.js` — the domain itself
- `src/sync/SyncEngineV2.js` — `FIELD_FOR_MAP_DOMAIN`, and the hydrate/decode block around the
  `inputEntries` handling (~line 973–986). **Not** `LEGACY_STRINGIFIED_DOMAINS`: meals never existed
  in the legacy blob.
- `src/hooks/useSyncEngine.js` — `MAP_DOMAINS`
- `src/sync/hydrate.js` — month-doc field mapping
- `src/utils/constants.js`, `src/utils/snapshots.js` — storage key, snapshot coverage
- `src/components/Settings.jsx` — backup/restore include `meals`
- `firestore.rules` — only if month docs validate field names (check; no change expected)
- `src/App.jsx` — `useLocalStorage` state + wiring into the sync hook

Older app versions ignore the unknown `meals` field in month docs; verify they don't strip it on
write (field-level writes via `fieldWriter.js` should leave it alone).

## Testing

- `mealParse` — normalising, dedupe, non-food → empty, malformed reply
- `mealKey` — local-date prefix, month routing through `monthIdForKey`, uniqueness within a second
- `domains` / `hydrate` / engine tests extended so `meals` round-trips, merges and tombstones like
  `inputEntries`
- `shrinkImage` — dimension maths only (canvas stubbed)
- Worker route checked once against the deployed worker with a real food photo (counts against the
  meal cap, not the talk cap)
- Final check is Nate on his phone via GitHub Pages

## Release

Worker: `npx wrangler deploy` from `cloudflare/voice`. App: version bump, commit, push to main,
`npm run build && npm run deploy`, per CLAUDE.md.

## Next (not in this spec)

Text/voice input: a "Describe it instead" option on the Capture step — a text box (the phone
keyboard's dictation covers voice) that calls the same route with `{ text }` and lands on the same
Review step.
