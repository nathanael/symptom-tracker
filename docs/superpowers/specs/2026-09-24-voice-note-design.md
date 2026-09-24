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

`[ Advanced mode (flex 1) ] [ Note (108 × 56) ] [ ⋯ (54 × 54) ]`

- **Note pill**: 108px wide (two circles), 56px tall and 22px radius — the
  same height and corners as the Advanced mode pill (46px button + 4px padding
  + 1px border each side). Fill `linear-gradient(135deg, #7c3aed,
  #a855f7)`, white mic icon (the existing `solar.mic` in `solarIcons.jsx`) and
  the label "Note", 15px/600.
- At 320px wide the row leaves the Advanced mode pill about 110px, so below a
  360px viewport its label drops to 14px and the gaps to 8px. Checked in the
  preview at 320×568.
- It is a new `mn-note` button that is always rendered, like `.mn-adv`: an
  `easy` class shows it, and outside Home it has `tabIndex={-1}`,
  `aria-hidden` and no pointer events. When the dock unfolds into the tab list
  for Advanced mode, the pill fades and collapses to zero width (animating
  `width`, `margin` and `opacity`) with the same timing as `.mn-adv`, so the
  tabs get the full width back; coming back to Home it grows back.
  `prefers-reduced-motion` swaps instantly.
- Tapping it calls a new `onVoiceNote` prop, which App wires to
  `setShowVoiceNote(true)`.
- `VoiceNote` takes `onSave(text)`, `onClose()` and `onTypeInstead()`. App's
  `onTypeInstead` closes the recorder and calls `setShowNoteModal(true)`.

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
| `listening` | As above, live words, moving ribbon, running timer | Stop / auto-stop / app hidden → `finishing`; × → close (confirm if any text) |
| `finishing` | Words stay; ribbon eases flat; timer stops; stop button dimmed and disabled; "Finishing…" under the words | last words transcribed, or 3s timeout → `review` |
| `review` | Header "Review note" + duration; editable textarea with the full transcript; still bar strip of the recording; "Adds to today's note as "08:42 — …""; **Discard** / **Save** | Save → append + toast + close; Discard → close |
| `error` | The reason, **Type instead** (opens the existing Day notes modal), **Close** | — |

- **Stop** does not just close the connection: with server-side turn detection
  the audio since the last pause has not been committed yet, and closing would
  drop the final sentence. Stop calls `dictation.finish()` (see Client), which
  stops sending the mic, commits the remaining audio and waits for it to be
  transcribed before closing. The review text is every item in order, using
  the final text where an item completed and its partial where it did not.
- **×** while `listening`: if any text has arrived, the controls are replaced
  in place by "Discard this note?" with **Discard** and **Keep recording**
  (recording carries on underneath); otherwise it closes straight away. × in
  `review` shows the same prompt with **Discard** / **Keep editing** when the
  text is non-empty. No native `confirm()`.
- **Auto-stop** at 10:00 goes through `finishing` like Stop, bounding cost per
  note.
- **App hidden** (`visibilitychange` → hidden): iOS takes the mic away from a
  backgrounded PWA, so it is treated as Stop (`finishing` → `review`). If the
  connection has already gone, `finish()` resolves at once with what was heard.
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
createDictation({ onTranscript, onLevel, onDropped })
  -> { start(): Promise<void>, finish(): Promise<void>, cancel(): void }
```

- `start()`: `post(`${BASE}/transcribe-token`)` via `voiceApi.js`, then
  `connect({ secret, onEvent, onLevel, onClosed, feature: 'voice notes' })`
  from `webrtcConnection.js` (mic up, no remote audio). It **rejects** on
  failure, with the `VoiceApiError` from `post` (carrying `status`: 0 offline,
  401 signed out, 429 over the daily cap) or the `Error` from `connect` (mic or
  connection). `VoiceNote` maps these to the Errors table.
- `onTranscript(items)`: called whenever the transcript changes, with the
  ordered item list (below).
- `finish()`: the Stop path.
  1. `connection.setMuted(true)` — stop sending the mic (`replaceTrack(null)`,
     which `connect` already provides). The capture stays open, so `onLevel`
     keeps reporting; `VoiceNote` ignores levels once it is `finishing`.
  2. `connection.send({ type: 'input_audio_buffer.commit' })`.
  3. Wait for the commit's reply: an `input_audio_buffer.committed` event
     (which adds the final item through the reducer) or, when nothing was left
     in the buffer, the service's empty-buffer `error` event (ignored during
     `finish()`).
  4. Then wait until every item is `done`.
  5. Steps 3–4 share one 3-second limit. `connection.close()`; resolve.
     Idempotent; resolves at once if the connection is already closed.
- `cancel()`: closes immediately without waiting (×/Discard while recording).
- `error` events from the service while listening are logged (`console.warn`)
  and otherwise ignored; only a closed connection ends the note early.
- `onDropped()`: fires only when the connection closes on its own (the
  `onClosed` callback from `connect`) — not after `finish()` or `cancel()`.
  `VoiceNote` then goes straight to `review` with what was heard and shows the
  "Connection lost" notice.

#### Transcript items

The transcript is a list of items, one per committed stretch of speech, each
`{ id, text, done }`. A pure reducer does the work so it can be tested without
WebRTC:

```js
reduceTranscript(items, event) -> items
transcriptText(items) -> string   // non-empty texts joined with a space
```

- **Order** is the order in which an `item_id` is first seen in any event.
  `input_audio_buffer.committed` arrives before that item's transcription
  events, so in practice this is commit order; items first seen through a
  delta or a completion (after a missed commit event) are appended at the end.
- `input_audio_buffer.committed` → adds `{ id, text: '', done: false }` if new.
- `conversation.item.input_audio_transcription.delta` → appends `delta` to
  that item's text (adding the item if new) unless it is already `done`.
- `conversation.item.input_audio_transcription.completed` → sets the item's
  text to `transcript` and `done: true`.
- Anything else → unchanged.

Display: `done` items before the most recent `done` item are grey, the most
recent `done` item is white, and every item not yet `done` is purple with the
caret after the last one.

### Errors

Mapped to one plain sentence on the `error` state, all offering **Type instead**:

| Cause | Message |
|---|---|
| Not signed in (`VoiceApiError` status 401; `VoiceNote` uses its own wording, not `post`'s talk-mode message) | "Sign in to use voice notes." |
| Mic blocked / missing / failed (`Error` with `name === 'MicError'`) | its message, from `micErrorMessage(err, 'voice notes')`: "Microphone access is blocked. Allow it for this site to use voice notes.", "No microphone found." or "Couldn't start the microphone." |
| Offline / worker unreachable | "Can't reach the voice service. Check your connection." |
| Daily cap (429) | the worker's message |
| Any other `Error` from `connect` (refused or failed connection) | "Couldn't start voice notes. Try again in a moment." |
| Anything else | "Something went wrong starting voice notes." |
| Connection drops mid-note | not an error screen: `onDropped` → `review` with what was heard, plus a one-line notice "Connection lost — this is what was heard." |

## Files

| File | Change |
|---|---|
| `cloudflare/voice/src/index.js` | `transcribeToken` route, `DAILY_CAPS.notes` |
| `src/voice/dictation.js` | new: token + connection + `finish()` + transcript reducer |
| `src/voice/webrtcConnection.js` | `micErrorMessage(err, feature = 'talk mode')`; `connect` accepts an optional `feature` and passes it through, and its mic failure is thrown as an `Error` with `name = 'MicError'` so callers can tell it from connection failures. Talk mode's wording and handling are unchanged |
| `src/utils/voiceNote.js` | new: `appendToNote` |
| `src/components/VoiceNote.jsx`, `voiceNote.css` | new: recorder and review |
| `src/components/BottomNav.jsx`, `mobileNav.css` | Note pill in the Home dock |
| `src/App.jsx` | `showVoiceNote` state, render `VoiceNote`, save handler, toast |

## Testing

- `src/utils/__tests__/voiceNote.test.js`: time format (single-digit hours,
  midnight), joining onto empty / existing text, whitespace-only text ignored.
- `src/voice/__tests__/dictation.test.js`:
  - `reduceTranscript`: deltas accumulate per item; `completed` replaces the
    partial and sets `done`; a delta after `completed` is ignored; two items
    streaming at once stay separate; order follows first sighting (commit
    first, then an item first seen by delta goes last); unknown events leave
    the list unchanged.
  - `transcriptText`: joins completed and partial texts in order, skipping
    empty items.
  - `finish()` with a stubbed connection: mutes and sends one commit; with
    every earlier item already done, it does not resolve until the
    `committed` event arrives and that new item completes; it resolves on the
    empty-buffer error when nothing was left; it resolves after 3s when the
    reply or completion never comes; it never calls `onDropped`.
- `src/voice/__tests__/webrtcConnection` (or alongside existing voice tests):
  `micErrorMessage` defaults to talk mode wording and uses the given feature.
- Preview: the dock pill on Home at 375 and 320 wide, and its collapse into Advanced mode; the
  recorder's layout and ribbon at 375×812 and 320×568 with a stubbed dictation;
  review, Save and the appended note in Day notes.
- On the phone, after `npx wrangler deploy`: real speech in the PWA, tapping
  Stop straight after the last word (the last sentence must survive), locking
  the screen mid-note (iOS may pause the 3s wait in the background, so review
  can appear only on return), and airplane mode for the error path.

## Out of scope

- Keeping the audio file.
- AI clean-up of the transcript.
- Voice notes for a past day, or from Advanced mode.
- Separate, individually listed notes.
