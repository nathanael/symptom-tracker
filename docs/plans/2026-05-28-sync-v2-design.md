# Sync v2 — Granular, race-free cloud sync

**Date:** 2026-05-28
**Status:** Approved design — pending implementation plan
**Author:** Nate + Claude

## Problem

Cloud sync has lost the user's health data repeatedly over several months. The
root cause is architectural, not a single bug: each of the nine sync "domains"
(`entries`, `stackEntries`, `inputEntries`, `dailyNotes`, `symptoms`,
`stackItems`, `inputItems`, `pinnedSymptoms`, `trackingMode`) is stored as a
single JSON-**stringified blob** in one Firestore document (`users/{uid}`). The
blob is stringified to dodge Firestore's ~40k-index-entries-per-document limit.

Consequence: every sync — every severity tap, every supplement toggle —
rewrites the **entire** domain blob (e.g. all 6,566 entries). There is no
"update one record." Because writes are whole-blob replacements, the app must
read-merge-rewrite in memory before each write, and that merge races against:

- the Firestore listener firing mid-edit,
- the `isApplyingCloudRef` flag suppressing change notifications,
- a 500 ms debounce,
- a `pendingChanges` map that is not re-synced after a cloud merge.

When these line up wrong, a device writes a blob missing keys another device
just added → those keys are destroyed in the cloud → the listener then
propagates the loss back to all devices. Every patch to date (`_t` timestamps,
local snapshots, shrink-guards, pre-flush merges) is an attempt to make
whole-blob replacement safe. It cannot be made fully safe.

## Key insight

Firestore can update a single **nested field by path** as an atomic,
server-side operation that never touches sibling keys:

```js
update({ "entries.2026-05-28-flushing-morning": { severity: 2, _t: 1716... } })
```

If every edit writes only its own record this way, the entire class of
"device A clobbers device B's untouched data" becomes **structurally
impossible** — there is no read-merge-rewrite cycle to race. The 40k-index
limit is then managed purely by **sharding documents by month**.

## Requirements (from brainstorming)

- **Concurrency:** edits are rarely truly simultaneous; the user works one
  device at a time in practice. **Last-write-wins per record** is sufficient.
  No CRDT, no merge UI.
- **Scope:** cloud-sync core only. Destructive-button hardening (Clear-day,
  Clear-all, single-tap badge deletes) is a separate follow-up.
- **Offline-first preserved:** localStorage remains the instant source of truth
  for the UI; Firestore is a granular mirror.
- **App-state shapes unchanged:** React state and localStorage keep their
  current flat shapes (`entries` stays a flat `{key: value}` object). Only the
  sync layer changes, to minimize blast radius.

## Data model

```
users/{uid}/months/{YYYY-MM}          ← real map fields, NEVER stringified
    entries:      { "2026-05-28-flushing-morning": { severity, time, symptomId, date, _t } }
    stackEntries: { "2026-05-28-magnesium":        { taken, dose, date, itemId, _t } }
    inputEntries: { "2026-05-28-wheat-…":          { logged, count, date, inputId, _t } }
    notes:        { "2026-05-28":                  { text, _t } }

users/{uid}/meta/definitions          ← changes rarely
    symptoms:       { "<id>": { …symptom, _t } }   (keyed by id, not an array)
    stackItems:     { "<id>": { …, _t } }
    inputItems:     { "<id>": { …, _t } }
    pinnedSymptoms: [ … ]              (small id array; whole-field write OK)
    trackingMode:   { value, _t }

users/{uid}/meta/_migration           ← { v2DoneAt, fromDevice }
```

- Every record carries `_t` (write time in ms since epoch) for LWW.
- The month key for a record is derived from its date prefix (all map-domain
  keys begin with `YYYY-MM-DD`).
- Definitions are re-keyed from arrays to id-keyed maps so they too can use
  atomic field-path updates (kills the array-merge races).
- The legacy `users/{uid}` blob document is **left untouched as a backup** and
  never deleted.

### Worst-case index check (per-month sharding)

A heavy month ≈ 40 symptoms × 2 times × 31 days ≈ 2,480 entry records ×
~4 indexed fields ≈ ~10k composite index entries — comfortably under the 40k
per-document limit, and each month doc's growth is permanently bounded to one
month.

## Write path

The app's existing `onChange` callbacks still fire on every edit. The sync
engine then:

1. Diffs the new domain state against the last-known-synced state
   (`_lastAppliedCloud`) to find the **specific keys changed or deleted**. This
   diff already exists today for `_t` stamping and is reused.
2. Stamps changed records with `_t = Date.now()`.
3. Translates each changed/deleted key to a field path on its month doc (or the
   definitions doc) and batches them per target document:
   - change → `update({ "entries.<key>": { …, _t } })`
   - delete → `update({ "entries.<key>": deleteField() })`
4. Sends via the SDK `update()`. If Safari's streaming channel is down, falls
   back to REST `PATCH` with `updateMask.fieldPaths` — the same atomic
   per-field merge over plain HTTP.

No blob is ever written. A write touches only the keys the user changed.
Different records never collide; same record resolves by newest `_t`.

## Read / sync path

- **Cold load:** `get()` the `definitions` doc + all `months` docs (~7 for the
  current history) once, hydrate localStorage/React. localStorage drives the UI
  instantly.
- **Realtime:** a listener on the (small) `months` collection + `definitions`.
  Incoming changes merge into local state per-key by `_t` (cloud-only keys
  preserved, newer wins). Same merge logic as today, but on tiny per-month
  payloads instead of a 6,566-key blob.
- **Offline:** edits land in localStorage immediately. Field-updates that fail
  to send queue in a small localStorage outbox and replay on reconnect. Replay
  is safe: each update is idempotent and `_t`-guarded, so re-sending cannot
  resurrect deleted records or overwrite a newer value.

## Migration (one-time, non-destructive)

On first load of the new version, per device:

1. Snapshot localStorage (existing snapshot util).
2. If no `_migration` flag exists, explode **localStorage** (the freshest, most
   complete source on that device — *not* the cloud blob) into month docs +
   the definitions doc via batched field writes.
3. Write the `_migration` flag. Leave the legacy blob doc in place.

Migration cannot lose data: it reads from localStorage and deletes nothing. If
both devices migrate, they write the same keyed records and converge via LWW.
The new version keeps reading the legacy blob as a fallback until month docs
exist, so a not-yet-updated device is never stranded. Practical step: update
both devices to the new version around the same time.

**Clock-skew caveat:** LWW by client wall-clock can misorder if device clocks
differ materially. Acceptable for single-user personal use; noted as a known
limitation.

## What this removes

Whole-domain blob writes, the in-memory pre-flush merge, the shrink-guards, the
`pendingChanges` race, and the `isApplyingCloudRef` timing dependency that broke
supplement-hide in v5.5.0. All were scaffolding to make blob-rewriting safe;
with field-path updates they are unnecessary.

## Testing

- Unit: key ↔ (month, field-path) routing; change-diff → field-update
  translation; delete handling; `_t` LWW reconciliation.
- Regression: reproduce the exact two-device race that has been losing data and
  assert no clobber.
- Migration: localStorage/blob → month docs round-trips losslessly.
- Existing suite stays green where still relevant; `SyncEngine` tests rewritten
  for the new model.

## Out of scope (separate follow-ups)

- Confirmation/undo on destructive UI actions (Clear-day, Clear-all, single-tap
  badge deletes).
- Server-timestamp-based ordering to eliminate clock-skew (only if multi-user
  ever becomes a goal).
