# Voice dictation for per-question feedback (Hybrid Evaluate)

**Date:** 2026-08-12
**Status:** approved, ready for implementation
**Surface:** `/teacher/hybrid/evaluate/:attemptId` — [HybridEvaluatePage.tsx](../../../src/pages/teacher/HybridEvaluatePage.tsx)

## Problem

Teachers marking scanned answer sheets type per-question feedback by hand, one question at a
time, while holding a stylus or looking at the paper. Typing is the slowest part of the marking
loop. They asked for the phone-keyboard mic behaviour: tap, talk, words appear.

## Constraint that shaped the design

**A web page cannot invoke OS dictation.** The Android/iOS keyboard mic button and Windows+H are
operating-system features with no web API. Any site that appears to do this is really using the
browser's own Web Speech API.

We therefore replicate the *behaviour*, not the mechanism. On Android Chrome and iOS Safari the
Web Speech API is backed by the same recognition service the keyboard mic uses, so accuracy is
equivalent. On Chrome/Edge desktop it replaces Windows+H with an in-page button.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Engine | Web Speech API | Free, no server, no new edge function, live interim text. Rejected: record-and-transcribe (per-use cost, 2-5 s delay, new infra) |
| Scope | This page's feedback boxes only | Smallest safe change. Not generalised until a second surface actually needs it (YAGNI) |
| Insert mode | Append to end | Matches keyboard dictation; can never destroy typed text |
| Language | `en-IN` hardcoded | Indian accents, names and places. `navigator.language` is unpredictable; a picker is UI clutter until a non-English school asks |
| Interim text | Shown live | Immediate proof the mic is hearing you; matches phone behaviour |
| Unsupported browsers | Button not rendered | A hidden affordance beats a visible broken one. Firefox has no support and no plan to add it |

## Architecture

Three units, each independently understandable and testable.

### 1. `src/hooks/useSpeechDictation.ts` — engine, no UI

```ts
const { isSupported, isListening, start, stop } = useSpeechDictation({
  lang: "en-IN",
  onTranscript: (text, isFinal) => void,
});
```

Owns: feature detection, the `SpeechRecognition` instance, `en-IN`, interim results, error
translation, and teardown. Emits text upward; never touches the DOM.

The Web Speech API is absent from TypeScript's `lib.dom.d.ts`, so this file carries minimal local
type declarations. No `any` (CLAUDE.md §5a bans it as a hard lint error).

### 2. `src/components/hybrid/DictationButton.tsx` — UI only

Renders `null` when `isSupported` is false. States:

| State | Appearance | Tooltip |
|---|---|---|
| Idle | mic icon, `brand-primary` | "Dictate feedback" |
| Listening | mic icon, `destructive` + soft pulse | "Listening… tap to stop" |
| Unsupported | not rendered | n/a |
| Locked (published) | not rendered | n/a |

Colors flow through existing tokens, so dark mode flips (design-system rules 15/17). No raw hex.

### 3. `HybridEvaluatePage.tsx` — wiring

The button sits in the **Feedback label row, right-aligned** — not overlaid inside the textarea,
where it would collide with the resize grip and the text.

```
Feedback (optional)                          [ mic ]
+--------------------------------------------------+
| A note the student will see with their result     |
+--------------------------------------------------+
```

Transcript is written through the existing `updateDraft(q.id, { comment })`. The existing 500 ms
debounced upsert then persists it. **No new save path, no schema change** — dictated text lands in
the same `teacher_comment` column as typed text.

## Append algorithm (the duplication trap)

With `continuous = true` and `interimResults = true`, `onresult` fires repeatedly and re-delivers
the same phrase until it is final. A naive `value += transcript` duplicates text badly.

Correct model — the textarea value is always recomputed, never accumulated in place:

```
value = baseText + finalizedSoFar + currentInterim
```

- `baseText` — snapshot of the textarea taken once, when dictation **starts** (held in a ref, so
  the recognition callback can't read a stale value).
- `finalizedSoFar` — grows only when a result has `isFinal === true`.
- `currentInterim` — replaced wholesale on every event; discarded once its phrase finalises.

## Lifecycle

- **One mic at a time.** Enforced by a module-level registry keyed by a stable per-hook token, not
  by component state: React refs in sibling fields cannot see each other. Starting one session
  releases any other.
- **Auto-restart, heavily guarded.** *Reversed from the first draft after research.* Chrome ends a
  session after roughly 8 s of silence and caps it near 60 s **even with `continuous = true`**, and
  Safari ignores `continuous` outright. Without restarting, the mic would die every time a teacher
  paused to read an answer, which defeats the feature. Guards that keep this from becoming a
  runaway mic:
  - `wantsToListenRef` — restart only while the user still intends to dictate.
  - Max 20 restarts per user-initiated run.
  - Stop cleanly after 2 consecutive sessions that heard nothing (teacher walked away).
  - **Never** restart on `not-allowed`, `service-not-allowed`, or `aborted`. `onerror` fires before
    `onend`, so the error handler clears the intent flag first; otherwise a denied permission
    becomes a start→error→end→start loop that re-prompts until the tab is killed.
- **Session recycle is the dangerous case.** Each new session numbers its results from 0 again, so
  `onend` must clear the committed-index set. Skipping that silently drops every phrase of the new
  session (looks "already committed"). Covered by test 4.
- **Teardown order matters:** set flags, detach handlers, *then* `abort()`. Any other order lets
  `onend` restart a session that outlives the component and holds the microphone open.
- **`stop()` vs `abort()`:** `stop()` on the user tapping to finish (flushes the phrase in flight);
  `abort()` on unmount (a flushed result would land in a field the teacher already left).
- **Locked attempts.** When `status === "evaluated"` the textarea is disabled and the mic is hidden.

## Render cost

Interim results fire several times per second. They are held in **local state inside
`FeedbackDictationField`**, so a dictating teacher re-renders one field rather than the whole
question list and the paper viewer behind it. Only committed phrases go up through `onChange`.

## Service-worker contract

The field is wrapped in a `<form data-dirty="true">` while listening. `src/main.tsx` suppresses the
service-worker auto-reload only for `form[data-dirty="true"]` — without it, a deploy landing
mid-sentence would hard-reload the marking page and discard unsaved spoken feedback.

## Error handling

All user-facing errors go through `toastError` (CLAUDE.md §19) — never a raw API string.

| Error code | Behaviour |
|---|---|
| `not-allowed` / `service-not-allowed` | Toast: "Allow microphone access in your browser to dictate feedback." |
| `no-speech` | Silent. Just return to idle |
| `audio-capture` | Toast: "No microphone found." |
| `network` | Toast: "Speech recognition needs an internet connection." |
| `aborted` | Silent (we caused it) |

## Privacy — read this before shipping

**SALCI records, uploads and stores no audio, and adds no new database column.** Dictated text
lands in the same `hybrid_marks.teacher_comment` field as typed text.

**But the browser itself does send audio off-device.** Chrome streams captured audio to a Google
speech service (Safari to Apple's); it is a server-based engine, which is why it needs a network
connection and why sessions are time-capped. This is inherent to the Web Speech API on every
platform we target, and is the same path the phone keyboard's mic already uses.

That matters here because the dictated content is teacher commentary about **named minors**. Under
India's DPDP Act this is a third-party disclosure decision, not an implementation footnote. The
honest user-facing sentence, which the UI must carry near the mic:

> Voice typing is processed by your browser's speech service. SALCI does not record or store audio.

Chrome 139+ exposes an experimental `processLocally` flag for on-device recognition. Treat it as
best-effort hardening if adopted later, never as a guarantee.

## Out of scope

Recording/playback, transcription edge function, non-English languages, other feedback surfaces
(`EvaluationWorkspace`, homework marking). Each is a separate change if asked for.

## Verification

1. `npm run typecheck` exit 0; `npx eslint <touched>` zero errors; `npx vite build` exit 0 (§5a).
2. Manual: dictate into Q1 → text appends, autosaves, survives reload.
3. Manual: type text, then dictate → appended, nothing destroyed.
4. Manual: dark mode → button flips; 375 px → label row does not wrap badly.
5. Manual: deny mic permission → friendly toast, no console crash.