# Voice note from Home

Date: 2026-09-24
Status: approved design, not yet planned
Mockups: `mockups/voice-note.html` (Dock 2, Recorder C, Review)

## Purpose

Taking a note today means Advanced mode → ⋯ → Day notes → type. This adds a
one-tap spoken note to the Home screen: tap **Note** in the dock, talk, watch
the words appear, fix anything misheard, save. The result is appended to
today's day note, so it shows wherever day notes already show (Day notes
modal, Copy for AI, backups) with no new data type.

Mobile Home only. Desktop and Advanced mode are unchanged.

## Decisions

| Question | Decision |
|---|---|
| Where the note goes | Appended to **today's** day note (`dailyNotes`), prefixed with the time |
| How speech becomes text | Live, through the existing voice worker (OpenAI transcription-only realtime session) |
| What Stop does | Opens a review step: editable text, **Discard** / **Save** |
| Dock button | Purple "Note" pill between Advanced mode and ⋯ |
| Recorder look | Words fill the screen; Siri-style ribbon waveform above the stop button |

## Dock

`BottomNav`'s Home dock becomes:

`[ Advanced mode (flex 1) ] [ Note (108 × 54) ] [ ⋯ (54 × 54) ]`

- **Note pill**: 108px wide (two circles), 54px tall, 22px radius — the same
  corners as the Advanced mode pill. Fill `linear-gradient(135deg, #7c3aed,
  #a855f7)`, white mic icon (a new `solar.mic` entry in `solarIcons.jsx`) and
  the label "Note", 15px/600.
- It is a new `mn-note` button rendered only while the dock is in its Home
  (`easy`) state. When the dock unfolds into the tab list for Advanced mode, the
  pill fades and collapses to zero width with the same timing as `.mn-adv`, so
  the tabs get the full width back. `prefers-reduced-motion` swaps instantly.
- Tapping it calls a new `onVoiceNote` prop, which App wires to
  `setShowVoiceNote(true)`.

## Recorder screen (`VoiceNote.jsx`, `voiceNote.css`)

A full-screen layer over everything (portal to `document.body`, z-index above
the dock — the same reason `SeriesPicker` portals: iOS paints fixed layers
inside a scroll container under the dock). It starts listening on open; there
is no separate record button.

Top to bottom:

1. **Header** (safe-area aware): round × at left; "Today's note" with the date
   under it in the middle; red pulsing dot and `m:ss` timer at right.
2. **Words** (flex 1): 24px/500, bottom-aligned so the newest line sits just
   above the waveform. Finished sentences render in `#6b7280` for all but the
   most recent one, which is `#f3f4f6`; the words still being heard (the current
   partial) render in `#c4b5fd` with a blinking caret. The top 30% fades out
   with a mask so older text scrolls away upward. Before the first word:
   "Listening…" in grey.
3. **Ribbon** (170px canvas): three layered, additively blended waves (sky
   `56,189,248`, violet `167,139,250`, pink `244,114,182`) with a
   `sin²` envelope so they taper to a point at both edges. Amplitude follows the
   mic level, eased toward the latest reading each frame; at silence it rests as
   a thin line. Drawn on `requestAnimationFrame` from a ref, so audio-rate level
   updates never re-render React. Reduced motion: a static line whose thickness
   follows the level.
4. **Stop**: 78px ring with a red rounded square, bottom safe-area padding.

### States

| State | Shown | Leaves by |
|---|---|---|
| `connecting` | Header, "Getting ready…", flat ribbon | token + connection ready → `listening`; failure → `error` |
| `listening` | As above, live words, moving ribbon, running timer | Stop / auto-stop / app hidden → `review`; × → close (confirm if any text) |
| `review` | Header "Review note" + duration; editable textarea with the full transcript; still bar strip of the recording; "Adds to today's note as "08:42 — …""; **Discard** / **Save** | Save → append + toast + close; Discard → close |
| `error` | The reason, **Type instead** (opens the existing Day notes modal), **Close** | — |

- **Stop** ends the session and goes to `review`. Any partial still in flight
  is kept: the review text is all completed segments plus the last partial.
- **×** while `listening`: if any text has arrived, a confirm ("Discard this
  note?"); otherwise it closes straight away. × in `review` behaves as Discard
  after the same confirm when the text is non-empty.
- **Auto-stop** at 10:00 goes to `review`, bounding cost per note.
- **App hidden** (`visibilitychange` → hidden): iOS takes the mic away from a
  backgrounded PWA, so the session is stopped and the screen goes to `review`
  with whatever was heard.
- **Empty review** (nothing heard): the textarea is empty and Save is disabled.
- The **review strip** is a still of the recording: the mic levels sampled
  every ~150ms during recording, downsampled to ~70 bars, grey.

### Saving

`appendToNote(existingText, text, date)` in a new `src/utils/voiceNote.js`:

- Trims `text`; returns `existingText` unchanged if it is empty.
- Formats the line as `HH:MM — <text>` in local 24-hour time (`08:42 — …`).
- Joins with a blank line after any existing text; no leading blank line when
  the day's note is empty.

App saves with a functional updater on the `today` key only:

```js
setDailyNotes(prev => ({ ...prev, [key]: { text: appendToNote(noteText(prev[key]), text, now) } }))
```

`key` is `getDateKey(new Date())` taken at Save time, not the open time, so a
note begun at 23:59 and saved after midnight lands on the new day with the time
it was saved. Home always means today (v6.8.2), so this matches what the user
sees. A toast "Saved to today's note" follows, through App's existing `copyToastMessage` toast.

**Sync**: `dailyNotes` is a per-key last-write-wins map. Editing today's note on
another device at the same moment could let one edit win over the other — the
same exposure as typing a note today. No sync code changes.

## Transcription

### Worker: `POST /transcribe-token`

New route in `cloudflare/voice/src/index.js`, alongside `token` and
`gemini-token`:

- Authenticates the Firebase ID token like every route.
- `await spend(env, uid, 'notes', 1, "You've hit today's voice-note limit. It resets at midnight UTC.")`
  with a new `DAILY_CAPS.notes = 100`, a separate counter so notes never eat
  into talk mode's allowance.
- Mints a client secret for a **transcription-only** realtime session via
  `/realtime/client_secrets`:
  - `type: 'transcription'`
  - `audio.input.transcription.model`: `setting(env, 'TALK_TRANSCRIBE_MODEL')`
    (the model talk mode already uses; overridable in `wrangler.toml`)
  - `audio.input.noise_reduction: { type: 'near_field' }`
  - `audio.input.turn_detection: { type: 'server_vad', silence_duration_ms: 700 }`
    so sentences are committed on natural pauses and arrive as completed
    segments.
- Returns `{ secret, expiresAt, model }`.
- The header comment's route list gains the new line.

The exact session shape must be checked against the current OpenAI Realtime
docs during implementation (transcription sessions have their own schema, and
the WebRTC `calls` endpoint must accept them). If WebRTC does not accept a
transcription session, the fallback is the Realtime WebSocket with the same
secret and PCM from `pcmAudio.js`'s mic; `dictation.js`'s interface stays the
same either way.

### Client: `src/voice/dictation.js`

```js
createDictation({ onPartial, onSegment, onLevel, onError, onEnd })
  -> { start(), stop() }
```

- `start()`: `post(`${BASE}/transcribe-token`)` via `voiceApi.js`, then
  `connect({ secret, onEvent, onLevel, onClosed })` from `webrtcConnection.js`
  (mic up, no remote audio).
- Events, keyed by `item_id` so out-of-order arrivals land in the right place:
  - `conversation.item.input_audio_transcription.delta` → appends to that
    item's partial → `onPartial(text)` with the current partial.
  - `conversation.item.input_audio_transcription.completed` → the item's final
    transcript replaces its partial → `onSegment(text)`.
  - `error` events → `onError(message)`.
- `stop()`: closes the connection and resolves once closed. Idempotent.
- The event reducer is a pure function (`reduceTranscript(state, event)`) so it
  can be unit tested without WebRTC.

`VoiceNote.jsx` owns the state machine and display only; it holds the level in
a ref for the ribbon and the sampled level history for the review strip.

### Errors

Mapped to one plain sentence on the `error` state, all offering **Type instead**:

| Cause | Message |
|---|---|
| Not signed in (401 from `post`) | "Sign in to use voice notes." |
| Mic blocked / missing | from `micErrorMessage` (reworded: "…to use voice notes.") |
| Offline / worker unreachable | "Can't reach the voice service. Check your connection." |
| Daily cap (429) | the worker's message |
| Connection drops mid-note | not an error screen: go to `review` with what was heard, plus a one-line notice "Connection lost — this is what was heard." |

## Files

| File | Change |
|---|---|
| `cloudflare/voice/src/index.js` | `transcribeToken` route, `DAILY_CAPS.notes` |
| `src/voice/dictation.js` | new: token + connection + transcript reducer |
| `src/utils/voiceNote.js` | new: `appendToNote` |
| `src/components/VoiceNote.jsx`, `voiceNote.css` | new: recorder and review |
| `src/components/BottomNav.jsx`, `mobileNav.css` | Note pill in the Home dock |
| `src/components/solarIcons.jsx` | `mic` icon |
| `src/App.jsx` | `showVoiceNote` state, render `VoiceNote`, save handler, toast |

## Testing

- `src/utils/__tests__/voiceNote.test.js`: time format (single-digit hours,
  midnight), joining onto empty / existing text, whitespace-only text ignored.
- `src/voice/__tests__/dictation.test.js`: `reduceTranscript` — deltas
  accumulate per item, `completed` replaces the partial, interleaved items stay
  separate and ordered, the review text is completed segments + last partial.
- Preview: the dock pill on Home and its collapse into Advanced mode; the
  recorder's layout and ribbon at 375×812 and 320×568 with a stubbed dictation;
  review, Save and the appended note in Day notes.
- On the phone, after `npx wrangler deploy`: real speech in the PWA, locking
  the screen mid-note, and airplane mode for the error path.

## Out of scope

- Keeping the audio file.
- AI clean-up of the transcript.
- Voice notes for a past day, or from Advanced mode.
- Separate, individually listed notes.
