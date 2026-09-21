# Meal Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photograph a meal, have Gemini list its ingredients, let the user correct the list, and store it with a timestamp.

**Architecture:** A new `POST /meal` route on the existing `glimpse-voice` Cloudflare Worker holds the Gemini key and returns `{ name, ingredients }`. The app shrinks the photo to base64 JPEG, posts it, normalises the reply, and shows an editable review sheet. Saving writes a record into a new month-sharded sync domain, `meals`, which inherits sync, tombstones, snapshots and backup from the existing engine. The photo is never stored.

**Tech Stack:** React 18, Vite 6, Vitest 4, Cloudflare Workers, `@google/genai`, Firebase Auth + Firestore.

**Spec:** `docs/superpowers/specs/2026-09-21-meal-logging-design.md`

## Global Constraints

- Branch `claude/meal-logging`, based on `main` (v6.6.19). Work in the worktree at `/Users/nate/Dev/symptoms/.claude/worktrees/git-pull-63c7de`.
- Tests: `npx vitest run <path>`. Test environment is `node` (`vite.config.js`), so **no DOM**. Do not write tests that need `document`, `window`, `canvas` or React rendering — test pure modules only.
- The app NEVER stamps `_t` on local records. Only the sync engine does. Meal records carry no `_t`.
- Meal record keys MUST begin `YYYY-MM-DD` in **local** time so `monthIdForKey` (`src/sync/keyRouting.js:5`) routes them to the right month document.
- The version lives only in `package.json`; bump with `npm version <x.y.z> --no-git-tag-version`. Never hardcode a version string.
- Photos are discarded after analysis. Never write image data to localStorage, Firestore, or a backup file.
- Worker deploy: `npx wrangler deploy` from `cloudflare/voice`. App deploy: `npm run build && npm run deploy`.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

## Correction to the spec

While reading the code for this plan, two spec claims turned out to be wrong and are corrected here:

- **`src/sync/hydrate.js` needs no change.** `fieldForDomain` (`hydrate.js:25`) already defaults the month-doc field name to the domain name, and it iterates `MAP_DOMAINS` imported from `domains.js`. Adding `meals` to `domains.js` is enough.
- **`src/sync/SyncEngineV2.js` needs no change.** It imports `MAP_DOMAINS` from `domains.js` (`SyncEngineV2.js:17`) and `fieldForMapDomain` (`:63`) likewise defaults to the domain name. `LEGACY_STRINGIFIED_DOMAINS` and the legacy-blob decode block are for the pre-v2 blob, which never contained meals, so they stay as they are.
- **`firestore.rules` needs no change.** It is a `{document=**}` wildcard scoped by uid.

The only hardcoded map-domain list that must change is `src/hooks/useSyncEngine.js:9`.

---

### Task 1: The `meals` sync domain

Registers the domain so localStorage, sync, tombstones, snapshots and migration all pick it up.

**Files:**
- Modify: `src/sync/domains.js:13-23`
- Modify: `src/utils/constants.js:15`
- Modify: `src/utils/snapshots.js:15-25`
- Modify: `src/hooks/useSyncEngine.js:1-12`
- Test: `src/sync/__tests__/mealsDomain.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `DOMAINS.meals` with `storageKey: 'symptomTracker_meals'`, `kind: 'map'`, `sharding: 'month'`. `MAP_DOMAINS` (already exported from `src/sync/domains.js`) now includes `'meals'`. `STORAGE_KEY_MEALS` exported from `src/utils/constants.js`.

- [ ] **Step 1: Write the failing test**

Create `src/sync/__tests__/mealsDomain.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { DOMAINS, MAP_DOMAINS, storageKeyFor, isMonthSharded } from '../domains.js';
import { assembleDomainsFromDocs } from '../hydrate.js';
import { STORAGE_KEY_MEALS } from '../../utils/constants.js';

describe('meals domain', () => {
  it('is a month-sharded map domain', () => {
    expect(DOMAINS.meals).toEqual({
      storageKey: 'symptomTracker_meals',
      kind: 'map',
      sharding: 'month',
    });
    expect(MAP_DOMAINS).toContain('meals');
    expect(isMonthSharded('meals')).toBe(true);
    expect(storageKeyFor('meals')).toBe(STORAGE_KEY_MEALS);
  });

  it('hydrates from month docs under a `meals` field', () => {
    const { domains, shadow } = assembleDomainsFromDocs({}, {
      '2026-09': { meals: { '2026-09-21T12:41:07-ab12': { name: 'Wrap', ingredients: ['chicken'], _t: 5 } } },
      '2026-08': { meals: { '2026-08-02T08:00:00-cd34': { name: 'Eggs', ingredients: ['egg'], _t: 4 } } },
    });
    expect(Object.keys(domains.meals).sort()).toEqual([
      '2026-08-02T08:00:00-cd34',
      '2026-09-21T12:41:07-ab12',
    ]);
    expect(domains.meals['2026-09-21T12:41:07-ab12'].name).toBe('Wrap');
    expect(shadow.meals).toBeDefined();
  });

  it('keeps a tombstoned meal out of the app view but in the shadow', () => {
    const { domains, shadow, tombstones } = assembleDomainsFromDocs({}, {
      '2026-09': { meals: { '2026-09-21T12:41:07-ab12': { _deleted: true, _t: 9 } } },
    });
    expect(domains.meals).toEqual({});
    expect(shadow.meals['2026-09-21T12:41:07-ab12']).toEqual({ _deleted: true, _t: 9 });
    expect(tombstones.meals).toEqual({ '2026-09-21T12:41:07-ab12': 9 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/sync/__tests__/mealsDomain.test.js`
Expected: FAIL — `STORAGE_KEY_MEALS` is not exported, `DOMAINS.meals` is undefined.

- [ ] **Step 3: Add the domain**

In `src/sync/domains.js`, add a line to the `DOMAINS` object immediately after the `dailyNotes` line:

```js
  meals:          { storageKey: 'symptomTracker_meals',       kind: 'map',     sharding: 'month' },
```

In `src/utils/constants.js`, after `STORAGE_KEY_INPUT_ENTRIES`:

```js
export const STORAGE_KEY_MEALS = 'symptomTracker_meals';
```

In `src/utils/snapshots.js`, add to the end of `TRACKED_KEYS`:

```js
  'symptomTracker_meals',
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/sync/__tests__/mealsDomain.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Stop `useSyncEngine` duplicating the domain list**

In `src/hooks/useSyncEngine.js`, delete the hardcoded array on line 9 and derive it from the single source of truth. Replace:

```js
// Map domains arrive from the engine as flat `{ key: value+_t }` maps and live
// in React as objects; merge them per-key by `_t`.
const MAP_DOMAINS = ['entries', 'dailyNotes', 'stackEntries', 'inputEntries'];
```

with:

```js
// Map domains arrive from the engine as flat `{ key: value+_t }` maps and live
// in React as objects; merge them per-key by `_t`. Derived from domains.js so a
// new map domain is picked up here without a second edit.
import { MAP_DOMAINS } from '../sync/domains';
```

Move that `import` up beside the other imports at the top of the file (imports must not sit below other statements for readability; the existing import block ends at line 5).

- [ ] **Step 6: Run the whole suite to verify nothing regressed**

Run: `npx vitest run`
Expected: PASS — every existing sync test still green.

- [ ] **Step 7: Commit**

```bash
git add src/sync/domains.js src/utils/constants.js src/utils/snapshots.js src/hooks/useSyncEngine.js src/sync/__tests__/mealsDomain.test.js
git commit -m "feat(meals): register the meals sync domain

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Meal record keys

A meal key is a local-time timestamp plus a short random suffix, so two meals in the same second don't collide and the date prefix routes to the right month document.

**Files:**
- Create: `src/food/mealKey.js`
- Test: `src/food/__tests__/mealKey.test.js`

**Interfaces:**
- Consumes: `monthIdForKey` from `src/sync/keyRouting.js` (test only).
- Produces:
  - `mealKey(date: Date, randomSuffix?: () => string) => string` — e.g. `'2026-09-21T12:41:07-ab12'`
  - `mealDateKey(key: string) => string` — the `'YYYY-MM-DD'` prefix, or `''` if the key is malformed
  - `compareMealKeys(a: string, b: string) => number` — chronological sort comparator

- [ ] **Step 1: Write the failing test**

Create `src/food/__tests__/mealKey.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { mealKey, mealDateKey, compareMealKeys } from '../mealKey.js';
import { monthIdForKey } from '../../sync/keyRouting.js';

describe('mealKey', () => {
  it('formats local wall-clock time, not UTC', () => {
    // 21 Sep 2026, 12:41:07 in whatever zone the test machine runs in
    const key = mealKey(new Date(2026, 8, 21, 12, 41, 7), () => 'ab12');
    expect(key).toBe('2026-09-21T12:41:07-ab12');
  });

  it('zero-pads every field', () => {
    const key = mealKey(new Date(2026, 0, 5, 7, 3, 9), () => 'cd34');
    expect(key).toBe('2026-01-05T07:03:09-cd34');
  });

  it('routes to the month of the local date', () => {
    expect(monthIdForKey(mealKey(new Date(2026, 8, 21, 23, 59, 0), () => 'ab12'))).toBe('2026-09');
  });

  it('produces different keys for the same second', () => {
    const at = new Date(2026, 8, 21, 12, 41, 7);
    expect(mealKey(at)).not.toBe(mealKey(at));
  });

  it('uses a 4-character lowercase alphanumeric suffix by default', () => {
    expect(mealKey(new Date(2026, 8, 21, 12, 41, 7))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-[a-z0-9]{4}$/);
  });
});

describe('mealDateKey', () => {
  it('extracts the date prefix', () => {
    expect(mealDateKey('2026-09-21T12:41:07-ab12')).toBe('2026-09-21');
  });

  it('returns an empty string for anything malformed', () => {
    expect(mealDateKey('nonsense')).toBe('');
    expect(mealDateKey(null)).toBe('');
    expect(mealDateKey(undefined)).toBe('');
  });
});

describe('compareMealKeys', () => {
  it('sorts chronologically', () => {
    const keys = [
      '2026-09-21T18:00:00-zz99',
      '2026-09-21T08:15:00-aa11',
      '2026-09-20T23:00:00-bb22',
    ];
    expect([...keys].sort(compareMealKeys)).toEqual([
      '2026-09-20T23:00:00-bb22',
      '2026-09-21T08:15:00-aa11',
      '2026-09-21T18:00:00-zz99',
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/food/__tests__/mealKey.test.js`
Expected: FAIL — cannot resolve `../mealKey.js`.

- [ ] **Step 3: Write the implementation**

Create `src/food/mealKey.js`:

```js
// Keys for meal records.
//
// A key is a LOCAL wall-clock timestamp plus a short random suffix:
//   2026-09-21T12:41:07-ab12
//
// Local, not UTC, for two reasons: the sync engine shards map domains by the
// key's `YYYY-MM` prefix (see sync/keyRouting.js), and the app groups meals by
// the day the user saw on the clock. A UTC key would file a late-evening meal
// under tomorrow.
//
// Pure module.

const DATE_RE = /^(\d{4}-\d{2}-\d{2})T/;

const pad = (n) => String(n).padStart(2, '0');

const randomSuffix = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/**
 * @param {Date} date - defaults to now
 * @param {() => string} suffix - injectable for tests
 * @returns {string} e.g. '2026-09-21T12:41:07-ab12'
 */
export function mealKey(date = new Date(), suffix = randomSuffix) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${stamp}-${suffix()}`;
}

/** The 'YYYY-MM-DD' a meal key belongs to, or '' if the key is malformed. */
export function mealDateKey(key) {
  if (typeof key !== 'string') return '';
  const m = key.match(DATE_RE);
  return m ? m[1] : '';
}

/** Chronological comparator. Keys are fixed-width, so a string compare is chronological. */
export function compareMealKeys(a, b) {
  return String(a).localeCompare(String(b));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/food/__tests__/mealKey.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/food/mealKey.js src/food/__tests__/mealKey.test.js
git commit -m "feat(meals): local-time meal record keys

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Normalising the model's reply

The worker asks Gemini for a JSON schema, but a model reply is never trusted. Normalisation happens client-side, where the test runner is.

**Files:**
- Create: `src/food/mealParse.js`
- Test: `src/food/__tests__/mealParse.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeMeal(raw: unknown) => { name: string, ingredients: string[] }`. Never throws. `name` is trimmed and capped at 80 characters. `ingredients` are trimmed, lowercased, de-duplicated, stripped of empties, and capped at 40 items.

- [ ] **Step 1: Write the failing test**

Create `src/food/__tests__/mealParse.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { normalizeMeal } from '../mealParse.js';

describe('normalizeMeal', () => {
  it('keeps a well-formed reply', () => {
    expect(normalizeMeal({ name: 'Chicken caesar wrap', ingredients: ['chicken', 'romaine'] }))
      .toEqual({ name: 'Chicken caesar wrap', ingredients: ['chicken', 'romaine'] });
  });

  it('trims and lowercases ingredients but not the name', () => {
    expect(normalizeMeal({ name: '  Greek Salad  ', ingredients: ['  Feta ', 'OLIVE OIL'] }))
      .toEqual({ name: 'Greek Salad', ingredients: ['feta', 'olive oil'] });
  });

  it('de-duplicates case-insensitively, keeping first order', () => {
    expect(normalizeMeal({ name: 'x', ingredients: ['Egg', 'egg', 'butter', 'EGG'] }).ingredients)
      .toEqual(['egg', 'butter']);
  });

  it('drops empty and whitespace-only ingredients', () => {
    expect(normalizeMeal({ name: 'x', ingredients: ['egg', '', '   ', null, 'butter'] }).ingredients)
      .toEqual(['egg', 'butter']);
  });

  it('caps the list at 40 items', () => {
    const many = Array.from({ length: 60 }, (_, i) => `item${i}`);
    expect(normalizeMeal({ name: 'x', ingredients: many }).ingredients).toHaveLength(40);
  });

  it('caps the name at 80 characters', () => {
    expect(normalizeMeal({ name: 'a'.repeat(200), ingredients: [] }).name).toHaveLength(80);
  });

  it('coerces non-string ingredients to strings', () => {
    expect(normalizeMeal({ name: 'x', ingredients: [42, 'egg'] }).ingredients).toEqual(['42', 'egg']);
  });

  it('returns an empty meal for junk input', () => {
    const empty = { name: '', ingredients: [] };
    expect(normalizeMeal(null)).toEqual(empty);
    expect(normalizeMeal(undefined)).toEqual(empty);
    expect(normalizeMeal('a string')).toEqual(empty);
    expect(normalizeMeal(42)).toEqual(empty);
    expect(normalizeMeal([])).toEqual(empty);
    expect(normalizeMeal({})).toEqual(empty);
    expect(normalizeMeal({ name: 'x', ingredients: 'not an array' })).toEqual({ name: 'x', ingredients: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/food/__tests__/mealParse.test.js`
Expected: FAIL — cannot resolve `../mealParse.js`.

- [ ] **Step 3: Write the implementation**

Create `src/food/mealParse.js`:

```js
// Normalising a meal reply from the model.
//
// The worker asks Gemini for a response schema, but a model reply is still
// untrusted input: it can arrive with the wrong shape, duplicates, blanks, or
// an unbounded list. Everything the app stores passes through here first.
//
// Ingredients are lowercased so that "Egg" logged today and "egg" logged
// tomorrow are the same thing when this data is eventually correlated.
//
// Pure module.

const MAX_INGREDIENTS = 40;
const MAX_NAME = 80;

/**
 * @param {unknown} raw
 * @returns {{ name: string, ingredients: string[] }}
 */
export function normalizeMeal(raw) {
  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

  const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, MAX_NAME) : '';

  const ingredients = [];
  const seen = new Set();
  if (Array.isArray(obj.ingredients)) {
    for (const item of obj.ingredients) {
      if (item == null) continue;
      const value = String(item).trim().toLowerCase();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      ingredients.push(value);
      if (ingredients.length === MAX_INGREDIENTS) break;
    }
  }

  return { name, ingredients };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/food/__tests__/mealParse.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/food/mealParse.js src/food/__tests__/mealParse.test.js
git commit -m "feat(meals): normalise the model's ingredient reply

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The `POST /meal` worker route

Adds the route to the existing worker: same Firebase auth, same CORS, its own daily cap, the Gemini key that is already configured.

**Files:**
- Modify: `cloudflare/voice/src/index.js` (the `DAILY_CAPS` constant at :15, the `DEFAULTS` object at :19-31, a new handler before `const routes =`, and the `routes` map)

**Interfaces:**
- Consumes: the existing `HttpError`, `spend`, `requireKey`, `setting` helpers in that file; `GoogleGenAI` (already imported at :9).
- Produces: `POST /meal` accepting `{ image: string }` (base64 JPEG, no `data:` prefix) or `{ text: string }`, returning `{ name: string, ingredients: string[] }`.

- [ ] **Step 1: Raise the cap map**

In `cloudflare/voice/src/index.js`, change the `DAILY_CAPS` line (:15) from:

```js
const DAILY_CAPS = { sessions: 150 };
```

to:

```js
// `sessions` is talk mode; `meals` is photo/text meal analysis. Separate counters so a heavy day
// of one never locks out the other.
const DAILY_CAPS = { sessions: 150, meals: 50 };
```

- [ ] **Step 2: Add the model default**

In the `DEFAULTS` object, add a line after `TALK_VOICE: 'marin',`:

```js
  // Meal photo analysis (not a Live model — plain generateContent with vision)
  MEAL_MODEL: 'gemini-3-flash',
```

- [ ] **Step 3: Add the handler**

Insert immediately above the `const routes = ...` line:

```js
// --- Meal analysis -------------------------------------------------------
// A photo (base64 JPEG) or a typed description in; a name and an ingredient list out. The image is
// never stored — it lives only for the length of this request.

const MEAL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    ingredients: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'ingredients'],
};

const MEAL_PROMPT = [
  'Identify this meal and list the ingredients in it.',
  '',
  '- `name`: a short dish name, five words at most (e.g. "Chicken caesar wrap").',
  '- `ingredients`: the individual food ingredients. Include ones that are not visible but are',
  '  almost certainly present — cooking oil, butter, flour in a bread, dairy in a creamy sauce.',
  '- Use lowercase, singular, generic names: "tomato", not "3 cherry tomatoes"; "olive oil", not',
  '  "extra virgin olive oil from Tuscany".',
  '- No quantities, no preparation notes, no brand names.',
  '- If this is not food, return an empty name and an empty list.',
].join('\n');

const IMAGE_LIMIT = 1500000; // base64 chars, ~1.1MB of JPEG
const TEXT_LIMIT = 2000;

const meal = async (env, uid, body) => {
  const image = typeof body?.image === 'string' ? body.image : '';
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!image && !text) throw new HttpError(400, 'Send a photo or a description.');
  if (image.length > IMAGE_LIMIT) throw new HttpError(400, 'That photo is too large.');
  if (text.length > TEXT_LIMIT) throw new HttpError(400, 'That description is too long.');

  const apiKey = requireKey(env, 'GEMINI_API_KEY');
  await spend(env, uid, 'meals', 1);

  const parts = image
    ? [{ inlineData: { mimeType: 'image/jpeg', data: image } }, { text: MEAL_PROMPT }]
    : [{ text: `${MEAL_PROMPT}\n\nThe meal: ${text}` }];

  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: setting(env, 'MEAL_MODEL'),
      contents: [{ role: 'user', parts }],
      config: { responseMimeType: 'application/json', responseJsonSchema: MEAL_SCHEMA },
    });
    // The app normalises this again (src/food/mealParse.js); here we only guarantee it is JSON.
    return Response.json(JSON.parse(res.text));
  } catch (err) {
    console.error('Meal analysis error', err);
    throw new HttpError(502, "Couldn't read that meal. Try again or type it in.");
  }
};
```

- [ ] **Step 4: Register the route**

Change the `routes` line from:

```js
const routes = { 'gemini-token': geminiToken, token: openaiToken, log: saveLog };
```

to:

```js
const routes = { 'gemini-token': geminiToken, token: openaiToken, log: saveLog, meal };
```

- [ ] **Step 5: Document the override**

At the end of `cloudflare/voice/wrangler.toml`, extend the commented `[vars]` block with:

```toml
# MEAL_MODEL = "gemini-3-flash"
```

- [ ] **Step 6: Deploy the worker**

```bash
cd cloudflare/voice && npx wrangler deploy
```
Expected: a successful deploy printing the `glimpse-voice` workers.dev URL.

- [ ] **Step 7: Verify the route is live**

An unauthenticated request must be rejected by the auth layer, which proves the route exists and is wired behind auth:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://glimpse-voice.glimpse-voice.workers.dev/meal -H 'Content-Type: application/json' -d '{"text":"toast"}'
```
Expected: `401`. A `404` means the route is not registered.

**Note on the model id:** `gemini-3-flash` is the default and may not be a valid id. If the first real photo (Task 10) returns a 502, check the worker log with `npx wrangler tail` from `cloudflare/voice`; if the error is an unknown model, set a valid id under `[vars]` in `wrangler.toml` and redeploy rather than editing `DEFAULTS`.

- [ ] **Step 8: Commit**

```bash
git add cloudflare/voice/src/index.js cloudflare/voice/wrangler.toml
git commit -m "feat(meals): POST /meal route on the voice worker

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The client API

**Files:**
- Modify: `src/voice/voiceApi.js:10` and `:3` (export `post` and `BASE`)
- Create: `src/food/mealApi.js`
- Test: `src/food/__tests__/mealApi.test.js`

**Interfaces:**
- Consumes: `post(url, body) => Promise<Response>` and `BASE` from `src/voice/voiceApi.js`; `normalizeMeal` from `src/food/mealParse.js`.
- Produces: `analyzeMeal({ image?: string, text?: string }) => Promise<{ name: string, ingredients: string[] }>`. Rejects with the existing `VoiceApiError` (which carries `.status` and a user-facing `.message`).

- [ ] **Step 1: Write the failing test**

Create `src/food/__tests__/mealApi.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../voice/voiceApi.js', () => ({
  BASE: 'https://worker.test',
  post: vi.fn(),
}));

const { post } = await import('../../voice/voiceApi.js');
const { analyzeMeal } = await import('../mealApi.js');

const reply = (body) => ({ json: async () => body });

beforeEach(() => { post.mockReset(); });

describe('analyzeMeal', () => {
  it('posts an image to /meal and normalises the reply', async () => {
    post.mockResolvedValue(reply({ name: 'Wrap', ingredients: ['  Chicken ', 'chicken'] }));
    const result = await analyzeMeal({ image: 'BASE64DATA' });
    expect(post).toHaveBeenCalledWith('https://worker.test/meal', { image: 'BASE64DATA' });
    expect(result).toEqual({ name: 'Wrap', ingredients: ['chicken'] });
  });

  it('posts text when there is no image', async () => {
    post.mockResolvedValue(reply({ name: 'Toast', ingredients: ['bread'] }));
    await analyzeMeal({ text: 'buttered toast' });
    expect(post).toHaveBeenCalledWith('https://worker.test/meal', { text: 'buttered toast' });
  });

  it('never sends both fields', async () => {
    post.mockResolvedValue(reply({ name: '', ingredients: [] }));
    await analyzeMeal({ image: 'IMG', text: 'ignored' });
    expect(post).toHaveBeenCalledWith('https://worker.test/meal', { image: 'IMG' });
  });

  it('rejects when neither is supplied', async () => {
    await expect(analyzeMeal({})).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it('lets the API error through untouched', async () => {
    post.mockRejectedValue(Object.assign(new Error('nope'), { status: 429 }));
    await expect(analyzeMeal({ text: 'x' })).rejects.toMatchObject({ status: 429 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/food/__tests__/mealApi.test.js`
Expected: FAIL — cannot resolve `../mealApi.js`.

- [ ] **Step 3: Export the shared pieces from `voiceApi`**

In `src/voice/voiceApi.js`, change line 3 from `const BASE = ...` to:

```js
export const BASE = 'https://glimpse-voice.glimpse-voice.workers.dev';
```

and line 10 from `const post = async (url, body) => {` to:

```js
// Shared by every caller of this worker (talk mode, meal analysis): attaches the Firebase ID
// token and turns a non-2xx into a VoiceApiError carrying the worker's user-facing message.
export const post = async (url, body) => {
```

- [ ] **Step 4: Write the implementation**

Create `src/food/mealApi.js`:

```js
// Client for the meal analysis route on the glimpse-voice worker.
//
// The worker holds the Gemini key; this sends one photo or one description and gets back a dish
// name and an ingredient list. The photo is not stored anywhere — the caller drops it as soon as
// this resolves.

import { BASE, post, VoiceApiError } from '../voice/voiceApi';
import { normalizeMeal } from './mealParse';

/**
 * @param {{ image?: string, text?: string }} input - base64 JPEG (no data: prefix) or a description
 * @returns {Promise<{ name: string, ingredients: string[] }>}
 */
export const analyzeMeal = async ({ image, text } = {}) => {
  const body = image ? { image } : text ? { text } : null;
  if (!body) throw new VoiceApiError(400, 'Take a photo or describe the meal.');
  return normalizeMeal(await (await post(`${BASE}/meal`, body)).json());
};
```

Because the test mocks `voiceApi.js` with only `BASE` and `post`, add `VoiceApiError` to the mock factory in the test file:

```js
vi.mock('../../voice/voiceApi.js', () => ({
  BASE: 'https://worker.test',
  post: vi.fn(),
  VoiceApiError: class extends Error {
    constructor(status, message) { super(message); this.status = status; }
  },
}));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/food/__tests__/mealApi.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — the `voiceApi` export change breaks nothing.

- [ ] **Step 7: Commit**

```bash
git add src/voice/voiceApi.js src/food/mealApi.js src/food/__tests__/mealApi.test.js
git commit -m "feat(meals): client for the meal analysis route

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Shrinking the photo

A phone photo is several megabytes; the worker takes 1.5 MB of base64. The dimension maths is pulled out as a pure function because the test environment has no canvas.

**Files:**
- Create: `src/food/shrinkImage.js`
- Test: `src/food/__tests__/shrinkImage.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fitDimensions(width: number, height: number, max: number) => { width: number, height: number }` — pure, integer results, never upscales
  - `shrinkImage(file: File, max?: number, quality?: number) => Promise<string>` — base64 JPEG with no `data:` prefix. Browser only.

- [ ] **Step 1: Write the failing test**

Create `src/food/__tests__/shrinkImage.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { fitDimensions } from '../shrinkImage.js';

describe('fitDimensions', () => {
  it('scales a landscape photo by its width', () => {
    expect(fitDimensions(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it('scales a portrait photo by its height', () => {
    expect(fitDimensions(3000, 4000, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it('leaves a photo already within the limit alone', () => {
    expect(fitDimensions(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });

  it('never upscales a tiny image', () => {
    expect(fitDimensions(64, 64, 1024)).toEqual({ width: 64, height: 64 });
  });

  it('returns whole pixels', () => {
    const { width, height } = fitDimensions(1999, 1001, 1024);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    expect(fitDimensions(10000, 3, 1024)).toEqual({ width: 1024, height: 1 });
  });

  it('is defensive about junk input', () => {
    expect(fitDimensions(0, 0, 1024)).toEqual({ width: 0, height: 0 });
    expect(fitDimensions(NaN, 100, 1024)).toEqual({ width: 0, height: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/food/__tests__/shrinkImage.test.js`
Expected: FAIL — cannot resolve `../shrinkImage.js`.

- [ ] **Step 3: Write the implementation**

Create `src/food/shrinkImage.js`:

```js
// Turning a camera photo into something small enough to post.
//
// A phone photo is several megabytes; the worker accepts 1.5MB of base64. 1024px on the longest
// side is plenty for identifying food and keeps the request well inside that.
//
// `fitDimensions` is pure and tested; `shrinkImage` needs a browser (canvas, Image, FileReader).

const DEFAULT_MAX = 1024;
const DEFAULT_QUALITY = 0.8;

/**
 * Fit width x height inside a max-length square, preserving aspect ratio. Never upscales.
 * @returns {{ width: number, height: number }} whole pixels
 */
export function fitDimensions(width, height, max) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    // A very wide image would round its short side to 0 and make an unusable canvas.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const loadImage = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That photo couldn't be read.")); };
  img.src = url;
});

/**
 * @param {File} file
 * @returns {Promise<string>} base64 JPEG, no `data:` prefix
 */
export async function shrinkImage(file, max = DEFAULT_MAX, quality = DEFAULT_QUALITY) {
  const img = await loadImage(file);
  const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, max);
  if (!width || !height) throw new Error("That photo couldn't be read.");
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] || '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/food/__tests__/shrinkImage.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/food/shrinkImage.js src/food/__tests__/shrinkImage.test.js
git commit -m "feat(meals): shrink camera photos before analysis

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The capture and review sheet

A full-screen sheet with three states: capture, analyzing, review. It owns no persistence — it hands a finished meal back through `onSave`.

**Files:**
- Create: `src/components/MealCapture.jsx`
- Create: `src/components/mealCapture.css`
- Modify: `src/components/solarIcons.jsx` (add a `camera` icon)

**Interfaces:**
- Consumes: `analyzeMeal` (`src/food/mealApi.js`), `shrinkImage` (`src/food/shrinkImage.js`).
- Produces: default export `MealCapture`, props:
  - `existing?: { key: string, name: string, ingredients: string[], time: string, source: string }` — when set, the sheet opens straight to review for an already-saved meal
  - `onSave({ name, ingredients, at, source }) => void` — `at` is a `Date`, `source` is `'photo' | 'text' | 'manual'`
  - `onDelete?(key: string) => void` — only rendered when `existing` is set
  - `onClose() => void`
  - `isDesktop: boolean`

- [ ] **Step 1: Add the camera icon**

In `src/components/solarIcons.jsx`, add to the `solar` object beside the other icons:

```jsx
  camera: <><g fill="currentColor"><path fillRule="evenodd" d="M12 10.5C10.6193 10.5 9.5 11.6193 9.5 13C9.5 14.3807 10.6193 15.5 12 15.5C13.3807 15.5 14.5 14.3807 14.5 13C14.5 11.6193 13.3807 10.5 12 10.5Z" clipRule="evenodd"/><path fillRule="evenodd" d="M9.77778 21H14.2222C17.3433 21 18.9038 21 20.0248 20.2646C20.5092 19.9468 20.9261 19.5347 21.2476 19.0557C22 17.9474 22 16.4049 22 13.32C22 10.2351 22 8.69264 21.2476 7.58435C20.9261 7.10533 20.5092 6.69324 20.0248 6.37543C19.3044 5.90271 18.4027 5.73432 17.022 5.67422C16.3631 5.67422 15.7959 5.18134 15.6667 4.54545C15.4728 3.59163 14.6219 2.90909 13.6337 2.90909H10.3663C9.37805 2.90909 8.52715 3.59163 8.33333 4.54545C8.20412 5.18134 7.63685 5.67422 6.978 5.67422C5.59733 5.73432 4.69555 5.90271 3.97524 6.37543C3.49076 6.69324 3.07386 7.10533 2.75242 7.58435C2 8.69264 2 10.2351 2 13.32C2 16.4049 2 17.9474 2.75242 19.0557C3.07386 19.5347 3.49076 19.9468 3.97524 20.2646C5.09619 21 6.65674 21 9.77778 21ZM12 9C9.79086 9 8 10.7909 8 13C8 15.2091 9.79086 17 12 17C14.2091 17 16 15.2091 16 13C16 10.7909 14.2091 9 12 9Z" clipRule="evenodd"/></g></>, // camera-bold
```

- [ ] **Step 2: Write the component**

Create `src/components/MealCapture.jsx`:

```jsx
// Photograph a meal, have the model name its ingredients, correct the list, save it.
//
// Three states: `capture` (the file picker is opened for you, so the camera is one tap on a
// phone), `analyzing`, and `review`. Every path lands in `review`, including a failed analysis —
// a meal can always be typed by hand. The photo lives only as long as the request; nothing here
// stores it or hands it to `onSave`.

import { useEffect, useRef, useState } from 'react';
import { analyzeMeal } from '../food/mealApi';
import { shrinkImage } from '../food/shrinkImage';
import { solar } from './solarIcons';
import './mealCapture.css';

const pad = (n) => String(n).padStart(2, '0');
const timeValue = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

// Merge an HH:mm from the time input back onto a date.
const withTime = (date, value) => {
  const [h, m] = String(value).split(':').map(Number);
  const next = new Date(date);
  if (Number.isFinite(h) && Number.isFinite(m)) next.setHours(h, m, 0, 0);
  return next;
};

export default function MealCapture({ existing, onSave, onDelete, onClose, isDesktop }) {
  const [stage, setStage] = useState(existing ? 'review' : 'capture');
  const [preview, setPreview] = useState(null);      // object URL, revoked on unmount
  const [error, setError] = useState(null);
  const [name, setName] = useState(existing?.name || '');
  const [ingredients, setIngredients] = useState(existing?.ingredients || []);
  const [adding, setAdding] = useState('');
  const [source, setSource] = useState(existing?.source || 'photo');
  const [at, setAt] = useState(existing?.time ? new Date(existing.time) : new Date());

  const fileRef = useRef(null);
  const previewRef = useRef(null);
  previewRef.current = preview;

  // Open the picker as soon as the sheet mounts: on a phone that is the camera, one tap in.
  useEffect(() => {
    if (stage === 'capture') fileRef.current?.click();
  }, [stage]);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';                    // so picking the same file twice still fires
    if (!file) return;                      // cancelled the picker
    setError(null);
    setPreview(URL.createObjectURL(file));
    setStage('analyzing');
    try {
      const image = await shrinkImage(file);
      const meal = await analyzeMeal({ image });
      setName(meal.name);
      setIngredients(meal.ingredients);
      setSource('photo');
      if (meal.ingredients.length === 0) setError("Couldn't see any food in that. Add the ingredients yourself.");
    } catch (err) {
      setError(err?.message || "Couldn't read that meal. Add the ingredients yourself.");
      setSource('manual');
    } finally {
      setStage('review');
    }
  };

  const addIngredient = () => {
    const value = adding.trim().toLowerCase();
    if (!value || ingredients.includes(value)) { setAdding(''); return; }
    setIngredients((prev) => [...prev, value]);
    setAdding('');
  };

  const rename = (index, value) => setIngredients((prev) =>
    prev.map((item, i) => (i === index ? value.toLowerCase() : item)));

  const remove = (index) => setIngredients((prev) => prev.filter((_, i) => i !== index));

  const save = () => {
    const clean = ingredients.map((i) => i.trim().toLowerCase()).filter(Boolean);
    if (clean.length === 0 && !name.trim()) return;
    onSave({ name: name.trim(), ingredients: clean, at, source });
    onClose();
  };

  return (
    <div className={`mc-root${isDesktop ? ' desktop' : ''}`} role="dialog" aria-label="Log a meal">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={pick}
      />

      <header className="mc-head">
        <button className="mc-x" onClick={onClose} aria-label="Cancel">✕</button>
        <h4>{existing ? 'Edit meal' : 'Log a meal'}</h4>
        {stage === 'review' && <button className="mc-save" onClick={save}>Save</button>}
      </header>

      {stage === 'capture' && (
        <div className="mc-body mc-centered">
          <svg className="mc-bigicon" viewBox="0 0 24 24">{solar.camera}</svg>
          <p>Take a photo of your meal.</p>
          <button className="mc-primary" onClick={() => fileRef.current?.click()}>Open camera</button>
          <button className="mc-link" onClick={() => { setSource('manual'); setStage('review'); }}>
            Type it instead
          </button>
        </div>
      )}

      {stage === 'analyzing' && (
        <div className="mc-body mc-centered">
          {preview && <img className="mc-preview" src={preview} alt="" />}
          <div className="mc-spinner" />
          <p>Reading the ingredients…</p>
        </div>
      )}

      {stage === 'review' && (
        <div className="mc-body">
          {preview && <img className="mc-preview small" src={preview} alt="" />}
          {error && <div className="mc-error">{error}</div>}

          <label className="mc-field">
            <span>Meal</span>
            <input
              value={name}
              placeholder="What was it?"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <label className="mc-field">
            <span>Time</span>
            <input type="time" value={timeValue(at)} onChange={(e) => setAt(withTime(at, e.target.value))} />
          </label>

          <div className="mc-sec">INGREDIENTS · {ingredients.length}</div>
          {ingredients.map((item, index) => (
            <div className="mc-ing" key={`${index}-${item}`}>
              <input value={item} onChange={(e) => rename(index, e.target.value)} />
              <button onClick={() => remove(index)} aria-label={`Remove ${item}`}>✕</button>
            </div>
          ))}

          <div className="mc-ing add">
            <input
              value={adding}
              placeholder="Add an ingredient"
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addIngredient(); } }}
              onBlur={addIngredient}
            />
          </div>

          {existing && onDelete && (
            <button className="mc-danger" onClick={() => { onDelete(existing.key); onClose(); }}>
              Delete this meal
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the stylesheet**

Create `src/components/mealCapture.css`. Match the existing dark theme: read `src/components/talkMode.css` first and reuse its colour values and sheet geometry rather than inventing new ones. The rules needed are `.mc-root` (fixed full-screen, column flex, z-index above the nav), `.mc-head`, `.mc-x`, `.mc-save`, `.mc-body` (scrollable, `-webkit-overflow-scrolling: touch`), `.mc-centered`, `.mc-bigicon`, `.mc-preview` (and `.small`), `.mc-spinner` (a CSS keyframe rotation), `.mc-error`, `.mc-field`, `.mc-sec`, `.mc-ing` (and `.add`), `.mc-primary`, `.mc-link`, `.mc-danger`.

Two requirements that are easy to miss:
- Inputs must be at least `16px` font-size, or iOS Safari zooms the page when one is focused.
- `.mc-root` must sit above the mobile bottom nav; use the same z-index as the talk mode sheet.

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: a successful build with no unresolved imports.

- [ ] **Step 5: Run the suite**

Run: `npx vitest run`
Expected: PASS — unchanged, this task adds no tests (a node test environment cannot render React).

- [ ] **Step 6: Commit**

```bash
git add src/components/MealCapture.jsx src/components/mealCapture.css src/components/solarIcons.jsx
git commit -m "feat(meals): capture and review sheet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire meals into the app

State, the two entry points, the day's meal list, and delete-with-undo.

**Files:**
- Create: `src/components/MealList.jsx`
- Modify: `src/App.jsx` (imports, state at :116, `stateSetters` at :166, forcePush payload at :259 and :1307, render)
- Modify: `src/components/QuickActionsMenu.jsx` (icon map at :6-15, a new `onLogMeal` prop, a menu item)
- Modify: `src/components/ProtocolRows.jsx` (a `mealsSlot` prop, rendered at :562)

**Interfaces:**
- Consumes: `mealKey`, `mealDateKey`, `compareMealKeys` (`src/food/mealKey.js`); `MealCapture` (Task 7); `STORAGE_KEY_MEALS` (Task 1).
- Produces: `meals` React state, shape `{ [mealKey]: { time: string, name: string, ingredients: string[], source: string } }`. `MealList` default export with props `{ meals, dateKey, onOpen(key), onAdd() }`.

- [ ] **Step 1: Write the meal list component**

Create `src/components/MealList.jsx`:

```jsx
// The meals logged on the day being viewed. Read-only summary; tapping one reopens the review
// sheet so it can be corrected or deleted.

import { mealDateKey, compareMealKeys } from '../food/mealKey';
import { solar } from './solarIcons';

const timeLabel = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export default function MealList({ meals, dateKey, onOpen, onAdd }) {
  const keys = Object.keys(meals || {})
    .filter((key) => mealDateKey(key) === dateKey)
    .sort(compareMealKeys);

  return (
    <>
      <div className="lr-sec">
        <b>MEALS</b> {keys.length === 0 ? 'none logged' : `${keys.length} logged`}
      </div>
      {keys.map((key) => {
        const meal = meals[key];
        const count = meal.ingredients?.length || 0;
        return (
          <div className="lr-row lr-cols" key={key} onClick={() => onOpen(key)}>
            <div className="lr-name">
              {meal.name || 'Meal'}
              <small>{timeLabel(meal.time)} · {count} ingredient{count === 1 ? '' : 's'}</small>
            </div>
          </div>
        );
      })}
      <div className="lr-row lr-cols lr-add" onClick={onAdd}>
        <svg viewBox="0 0 24 24" width="18" height="18">{solar.camera}</svg>
        <div className="lr-fields">Log a meal</div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add the state to `App.jsx`**

Add the imports beside the existing ones:

```js
import MealCapture from './components/MealCapture';
import MealList from './components/MealList';
import { mealKey, mealDateKey } from './food/mealKey';
```

and add `STORAGE_KEY_MEALS` to the existing `constants` import (the block containing `STORAGE_KEY_INPUT_ENTRIES` at :20).

After the `inputEntries` `useLocalStorage` (:116-119), add:

```js
  const [meals, setMeals] = useLocalStorage(STORAGE_KEY_MEALS, {},
    (data) => syncNotifyRef.current?.('meals', data),
    isApplyingCloudRef
  );
```

In the `stateSetters` object (:166), add after `inputEntries: setInputEntries,`:

```js
      meals: setMeals,
```

In BOTH forcePush payloads (`src/App.jsx:259` and `:1307`), add `meals,` after `inputEntries,`.

- [ ] **Step 3: Add the sheet state and handlers**

After the `showTalkMode` state (:187), add:

```js
  // null = closed; { key } opens an existing meal for editing; {} opens a fresh capture
  const [mealSheet, setMealSheet] = useState(null);
```

Beside the other day-action callbacks (near `openTalkMode` at :638), add:

```js
  const saveMeal = useCallback(({ name, ingredients, at, source }) => {
    setMeals((prev) => {
      const next = { ...prev };
      // Editing keeps the original key so the record updates rather than duplicating.
      const key = mealSheet?.key || mealKey(at);
      if (mealSheet?.key) delete next[mealSheet.key];
      next[key] = { time: at.toISOString(), name, ingredients, source };
      return next;
    });
    setLastAction(name ? `Logged ${name}` : 'Meal logged');
  }, [mealSheet, setMeals, setLastAction]);

  const deleteMeal = useCallback((key) => {
    let removed = null;
    setMeals((prev) => {
      removed = prev[key];
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setUndoToast({
      message: 'Meal deleted',
      onUndo: () => setMeals((prev) => (removed ? { ...prev, [key]: removed } : prev)),
    });
  }, [setMeals]);
```

Check the exact `setUndoToast` shape against the existing calls at `src/App.jsx:430` and `:446` and match it (it may carry more fields than `message` and `onUndo`).

- [ ] **Step 4: Render the sheet**

Beside the `{showTalkMode && (` block (:951), add:

```jsx
      {mealSheet && (
        <MealCapture
          existing={mealSheet.key ? { key: mealSheet.key, ...meals[mealSheet.key] } : null}
          onSave={saveMeal}
          onDelete={deleteMeal}
          onClose={() => setMealSheet(null)}
          isDesktop={isDesktop}
        />
      )}
```

- [ ] **Step 5: Add the two entry points**

In the `ProtocolRows` render block (`src/App.jsx:906-929`), add a prop:

```jsx
                mealsSlot={(
                  <MealList
                    meals={meals}
                    dateKey={getDateKey(selectedDate)}
                    onOpen={(key) => setMealSheet({ key })}
                    onAdd={() => setMealSheet({})}
                  />
                )}
```

(`getDateKey` is already imported in `App.jsx`; confirm this and add it to the `utils/helpers` import if not.)

In `src/components/ProtocolRows.jsx`, accept `mealsSlot` in the props list beside `barSlot` (:64), and render it in the main return immediately after the factors map and before the `isDesktop` hint bar (`:562`):

```jsx
      {mealsSlot}
```

In `src/components/QuickActionsMenu.jsx`: add `camera: solar.camera,` to the `icons` map, add `onLogMeal,` to the props beside `onMatchYesterday`, and add a menu item inside the `tab === 'protocol'` block:

```jsx
            <Item icon="camera" label="Log a meal" onClick={onLogMeal} />
```

Then pass `onLogMeal={() => setMealSheet({})}` at both `QuickActionsMenu` usages in `App.jsx` (:815 and :896 areas, and the third at :1352 — check each with `grep -n "onTalkMode=" src/App.jsx` and add the prop wherever `onTalkMode` is passed).

- [ ] **Step 6: Build and run the suite**

Run: `npm run build && npx vitest run`
Expected: a successful build; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/components/MealList.jsx src/components/ProtocolRows.jsx src/components/QuickActionsMenu.jsx
git commit -m "feat(meals): log, list and delete meals from the Protocol tab

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Meals in the backup file

**Files:**
- Modify: `src/components/Settings.jsx` (props at :55-70, `backupToFile` at :219-233, restore at :289-293, the storage-key map at :143)
- Modify: `src/App.jsx` (the `Settings` render block at :1275-1310, and the in-App restore at :1072)
- Test: `src/food/__tests__/mealBackup.test.js`

**Interfaces:**
- Consumes: `meals`, `setMeals` from `App.jsx` (Task 8).
- Produces: `mergeBackupMeals(current: object, backup: object) => { merged: object, added: number }` exported from `src/food/mealBackup.js`, used by both restore paths.

- [ ] **Step 1: Write the failing test**

Create `src/food/__tests__/mealBackup.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { mergeBackupMeals } from '../mealBackup.js';

const meal = (name) => ({ time: '2026-09-21T12:00:00.000Z', name, ingredients: ['egg'], source: 'photo' });

describe('mergeBackupMeals', () => {
  it('adds meals the device does not have', () => {
    const { merged, added } = mergeBackupMeals({ a: meal('Have') }, { b: meal('New') });
    expect(Object.keys(merged).sort()).toEqual(['a', 'b']);
    expect(added).toBe(1);
  });

  it('never overwrites a meal already on the device', () => {
    const { merged, added } = mergeBackupMeals({ a: meal('Mine') }, { a: meal('Theirs') });
    expect(merged.a.name).toBe('Mine');
    expect(added).toBe(0);
  });

  it('tolerates a backup with no meals', () => {
    expect(mergeBackupMeals({ a: meal('Mine') }, undefined)).toEqual({ merged: { a: meal('Mine') }, added: 0 });
    expect(mergeBackupMeals({ a: meal('Mine') }, null).added).toBe(0);
    expect(mergeBackupMeals({ a: meal('Mine') }, 'junk').added).toBe(0);
  });

  it('tolerates empty current state', () => {
    const { merged, added } = mergeBackupMeals(undefined, { b: meal('New') });
    expect(merged).toEqual({ b: meal('New') });
    expect(added).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/food/__tests__/mealBackup.test.js`
Expected: FAIL — cannot resolve `../mealBackup.js`.

- [ ] **Step 3: Write the implementation**

Create `src/food/mealBackup.js`:

```js
// Merging meals from a backup file.
//
// Loading a backup never overwrites: it fills in what this device is missing, matching the
// behaviour of every other domain in Settings' restore.
//
// Pure module.

/**
 * @returns {{ merged: Object, added: number }}
 */
export function mergeBackupMeals(current, backup) {
  const merged = { ...(current && typeof current === 'object' ? current : {}) };
  let added = 0;
  if (backup && typeof backup === 'object' && !Array.isArray(backup)) {
    for (const [key, value] of Object.entries(backup)) {
      if (!merged[key]) { merged[key] = value; added += 1; }
    }
  }
  return { merged, added };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/food/__tests__/mealBackup.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire it into Settings**

In `src/components/Settings.jsx`:

- Add `meals,` and `setMeals,` to the props list after `setInputEntries,` (:62).
- Import the helper: `import { mergeBackupMeals } from '../food/mealBackup';`
- Add `meals,` to the `backup` object in `backupToFile` after `inputEntries,` (:232).
- Add `'symptomTracker_meals'` to the storage-key map at :143, following the pattern of the `inputEntries` line there (read that block first and match its shape — it maps a label to a key).
- After the `backup.inputEntries` restore block (:289-293), add:

```js
        if (backup.meals) setMeals(prev => {
          const { merged, added } = mergeBackupMeals(prev, backup.meals);
          addedRef.count += added;
          return merged;
        });
```

In `src/App.jsx`, pass `meals={meals}` and `setMeals={setMeals}` in the `Settings` render block (after `setInputEntries={setInputEntries}` at :1284), and mirror the same restore block at the in-App backup loader (:1072, following the `backup.inputEntries` block there).

- [ ] **Step 6: Build and run the suite**

Run: `npm run build && npx vitest run`
Expected: a successful build; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/food/mealBackup.js src/food/__tests__/mealBackup.test.js src/components/Settings.jsx src/App.jsx
git commit -m "feat(meals): include meals in backup and restore

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Release

Nate tests on GitHub Pages only — localhost and the in-app browser are not usable for him. The feature is not verified until it is deployed.

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm version`)

- [ ] **Step 1: Run the whole suite one last time**

Run: `npx vitest run`
Expected: PASS, with no skipped meal tests.

- [ ] **Step 2: Bump the version**

```bash
npm version 6.7.0 --no-git-tag-version
```

(A new feature, so the minor bumps. If `main` has moved past 6.6.19 in the meantime, bump the minor from whatever is current.)

- [ ] **Step 3: Commit and push**

```bash
git add package.json package-lock.json
git commit -m "feat(meals): photograph a meal and log its ingredients; release v6.7.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin claude/meal-logging
```

- [ ] **Step 4: Merge to main**

Confirm with Nate whether he wants a PR or a direct merge to `main`. Either way, `main` must carry the release before the deploy, per `CLAUDE.md`.

- [ ] **Step 5: Deploy**

```bash
npm run build && npm run deploy
```
Expected: `gh-pages` publishes `dist`.

- [ ] **Step 6: Hand it to Nate**

Tell him it is live, and ask him to photograph a real meal on his phone. Watch for:
- a 502 from `/meal` — check `npx wrangler tail` from `cloudflare/voice`; an unknown-model error means `MEAL_MODEL` needs a valid id in `wrangler.toml` (see the note in Task 4)
- the saved meal appearing on a second device after sync

---

## Self-review

**Spec coverage.** Backend route → Task 4. `mealApi.js` → Task 5. `shrinkImage.js` → Task 6. `mealKey.js` → Task 2. Normalisation → Task 3 (moved client-side from the worker; the reason is recorded in the spec's own testing section and in Task 3's header comment). `MealCapture.jsx` three states → Task 7. Offline/failure fallback to a hand-typed list → Task 7, Step 2 (`catch` sets `source: 'manual'` and still reaches review). Entry points → Task 8, Step 5. Meals day list with delete and undo → Task 8, Steps 1 and 3. `meals` sync domain and every plumbing point → Task 1 (with three spec claims corrected at the top of this plan). Backup/restore → Task 9. Release → Task 10. Text/voice input is explicitly out of scope in the spec and is not planned here; the worker route accepts `{ text }` from Task 4 so the follow-up is a UI change only.

**Placeholders.** Two steps deliberately describe rather than dictate: Task 7 Step 3 (the stylesheet, which must match `talkMode.css`'s existing values rather than a set I would invent blind) and three small spots in Tasks 8 and 9 where the plan says to read the neighbouring block and match its shape (`setUndoToast`'s fields, Settings' storage-key map, the third `QuickActionsMenu` call site). Those are files I did not read in full; naming the exact pattern to copy is more honest than guessing a line.

**Type consistency.** `mealKey(date, suffix)` is called as `mealKey(at)` in Task 8. `mealDateKey` returns `'YYYY-MM-DD'`, compared against `getDateKey(selectedDate)` in Task 8 — both local-date strings. `analyzeMeal({ image })` matches Task 5's signature. `normalizeMeal` is applied in `mealApi`, not in the component. The record shape `{ time, name, ingredients, source }` is written in Task 8 Step 3, read in `MealList` (Task 8 Step 1) and in `MealCapture`'s `existing` prop (Task 7), and merged in Task 9 — consistent in all four.
