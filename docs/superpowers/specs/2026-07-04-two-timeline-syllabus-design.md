# Two-Timeline Syllabus (Actual Jar + Auto Projection) — Design

- **Date:** 2026-07-04
- **Status:** Approved in brainstorming — pending spec review
- **Supersedes (partially):** `2026-07-03-teacher-logout-lesson-capture-design.md` — the check-out trigger survives; the per-period capture model, the login hard-block gate, and the "chapter spans N sessions" pacing are replaced (see §10).
- **Principle:** Additive where possible; the only removals are the pieces of yesterday's Phase 1 this model supersedes.

## 1. Summary

Per (class, subject) there are two timelines:

1. **ACTUAL ("the jar")** — teacher-recorded chapter progress. Filled at **check-out** (required, per class taught today), backfilled via a **non-blocking check-in popup** for missed/absent days, and correctable from past days on the teacher's My Week page. This is the single source of truth for "how much syllabus is done."
2. **PROJECTED (auto-generated)** — never stored; computed live by spreading the remaining (uncompleted) chapters, in teacher-controlled order, across the remaining scheduled periods until the academic year ends. Students see it on their week grid ("today's class covers Ch 5"); teachers see and edit it on My Week. **Auto wins:** the calculator always owns the layout — teacher edits are absorbed as chapter-sequence changes and everything re-flows; nothing is pinned. Daily "auto-adjustment" happens for free because actuals and remaining periods change daily.

The actual timeline is never modified by the projection. The projection is recomputed from the actual timeline + sequence + timetable on every read.

## 2. Decisions locked in brainstorming (user answers, 2026-07-04)

1. **Capture unit:** per (class, subject) chapter entries at check-out — REPLACES the per-period Completed/Not-done rows and the "spans N sessions" pacing input.
2. **Partial:** a flag only — no %; a partial chapter stays in the dropdown until later marked Completed.
3. **Pace horizon:** the teacher's total remaining scheduled periods for that class+subject (i.e., through the active academic year's end). No target dates.
4. **Login gate:** REMOVED. The non-blocking check-in popup is the single backlog surface for ALL missed days (absent or forgot-to-fill). Nothing hard-blocks login.
5. **No-progress day (revision/test/doubt):** still required — teacher marks the current chapter Partial again. Every class taught today must have ≥1 entry before check-out completes.
6. **Student view:** projected chapter shown on the student week/timetable grid cells; no separate future-browsing page.
7. **Teacher edits:** full freedom, expressed as reordering — with **Auto wins** semantics (an edit re-flows the projection immediately; the next recalc may shift it again if actual progress deviates; no pins). User consciously accepted this.
8. **Plan unit:** chapter per PERIOD (each period cell carries its own projected chapter; consecutive periods of one chapter show the same chapter).
9. **Corrections:** no new tab — past-day entries are editable from the existing teacher Timetable tab (`/teacher/my-week`).
10. **UI home (screenshot):** `TeacherMyWeekPageV2` — the `PeriodChip` cards (today's "Empty" badge position) display the projected/actual chapter; tap opens the existing `LessonPlanDialogV2` extended with a Syllabus section.

## 3. Data model (one new migration)

### `syllabus_progress_events` — the jar

```sql
CREATE TABLE public.syllabus_progress_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id)       ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES public.classes(id)            ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  topic_id        UUID NOT NULL REFERENCES public.syllabus_topics(id)    ON DELETE CASCADE,
  date            DATE NOT NULL,                       -- the teaching date this entry covers
  action          TEXT NOT NULL CHECK (action IN ('completed','partial')),
  source          TEXT NOT NULL CHECK (source IN ('checkout','checkin','correction')),
  recorded_by     UUID REFERENCES public.profiles(id)  ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT spe_unique UNIQUE (class_id, subject_id, topic_id, date)
);
```

- Upsert key `(class_id, subject_id, topic_id, date)` — marking the same chapter Completed after Partial on the same day overwrites the action (idempotent double-tap).
- **Chapter state is derived:** a chapter is *completed* ⇔ any event with `action='completed'` exists. The dropdown lists chapters with **no** completed event. Repeated Partial entries across days = multiple rows (useful history of how long a chapter ran).
- **Day resolution is derived:** (class, subject, date) is *filled* ⇔ ≥1 event exists for that triple+date. This is what the pending-days RPC checks.
- FK indexes on institution_id / class_id / subject_id / topic_id / recorded_by **in the same migration** (§23). `recorded_by` follows §21 (SET NULL authorship).

### `syllabus_sequence` — teacher-controlled chapter order

```sql
CREATE TABLE public.syllabus_sequence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id)       ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES public.classes(id)            ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  topic_id        UUID NOT NULL REFERENCES public.syllabus_topics(id)    ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  updated_by      UUID REFERENCES public.profiles(id)  ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sseq_unique UNIQUE (class_id, subject_id, topic_id)
);
```

- Zero rows for a (class, subject) → default order = the chapter set's `display_order`/`chapter_number` (identical to `useChaptersForExam` / coverage). Rows are only written when a teacher edits.
- Per **class** (section), not class_group — different sections progress and reorder independently.

### RLS (both tables)

- SELECT: institution members (`institution_id = get_user_institution(auth.uid())`).
- ALL (write): same tri-clause proven on `tt_chapter_pacing` (2026-07-04 fix): `tt_user_can_edit_class_slots(auth.uid(), class_id)` OR `class_assignments role='teacher'` for the class OR `tt_slots.teacher_id = auth.uid()` for the class+subject. SECURITY DEFINER helpers only — no inline cross-table recursion beyond these proven EXISTS.

### Retired writes (tables/columns stay for now)

`tt_chapter_pacing` (no more writes; table dropped in a later cleanup migration), `tt_lesson_plans.completion_pct` (no more writes). `usePacingTracker`/`get_pacing_summary` is unrelated dead legacy — untouched.

## 4. RPCs (all SECURITY DEFINER, §24 timezone, bounded per §23)

### 4.1 `teacher_pending_syllabus_days(p_include_today boolean) → jsonb`

Replaces `teacher_pending_lesson_days` as the gate/popup source (old function dropped in cleanup once the frontend has swapped).

- Scope: calling teacher's `tt_slots` (theory/practical) expanded over working days (per class's period structure) minus holidays/exam_blocks, active AY, **60-day lookback**, zero-slot pre-check, `LIMIT 30` days with **today never truncated** (today-first ordering) — all carried over from the hardened v1.
- **Absent days are now INCLUDED** (the check-in popup is exactly where the teacher fills them — reverses v1's exclusion; the substitute question stays out of scope, the teacher records what got covered).
- A day appears iff ≥1 of its (class, subject) groups has **no** `syllabus_progress_events` row for that date.
- Returns: `{ unresolved_day_count, days: [{ date, is_today, groups: [{ class_id, class_name, subject_id, subject_name, filled: bool }] }] }`. (Chapter lists are NOT embedded — the sheet fetches per-group state via 4.2, cached.)

### 4.2 `syllabus_progress_state(p_class_id, p_subject_id) → jsonb`

The per-group working set for dropdowns and the reorder sheet: the chapter set (resolved exactly like `useChaptersForExam`: `topic_class_mappings` by class_group → fallback all active subject topics), each with `{ topic_id, name, chapter_number, position (sequence or default), status: completed|partial|untouched, last_event_date }`. One bounded call per (class, subject); client caches `staleTime: 60_000`.

### 4.3 `class_projection_for_range(p_class_id, p_from date, p_to date) → jsonb`

For the student grid (and any per-class view): for every theory/practical slot-occurrence of the class in `[p_from, p_to]` with `date >= today`, the projected `{ date, slot_id, subject_id, topic_id, topic_name }`.

**Projection algorithm (pure, deterministic — the heart of "auto"):**
1. `R` = chapters without a completed event, ordered by sequence position; a chapter with a *partial* event sorts first within its position band (it's in progress — the timeline continues it).
2. `P` = the class+subject's remaining period-occurrences from **today** through the AY end (tt_slots × working days minus holidays/exam_blocks).
3. Allocate contiguous blocks: `base = floor(|P| / |R|)`, `extra = |P| mod |R|`; the first `extra` chapters get `base+1` periods each. If `|P| < |R|`, the first `|P|` chapters get one period each and the overflow chapters are unscheduled (teacher edit view shows a "beyond timetable" warning count; students simply see what's assigned). `|R| = 0` → no projection (syllabus finished).
4. Report the slice that falls inside `[p_from, p_to]`.

RLS-equivalent guard inside the RPC: students only for their own enrolled class (published timetable), staff for institution classes.

### 4.4 `teacher_projection_for_range(p_from date, p_to date) → jsonb`

Same output shape, across ALL the calling teacher's slots (one call powers the My Week overlay). Internally the same algorithm per distinct (class, subject).

### 4.5 `record_syllabus_progress(p_class_id, p_subject_id, p_topic_id, p_date, p_action, p_source) → jsonb`

The single write path for jar entries (checkout, check-in backfill, corrections). The event upsert and the coverage dual-write (§5) are two dependent writes, so they live in ONE transaction here (enterprise rule 6) instead of sequential client calls. SECURITY DEFINER with an explicit permission check (the same tri-clause as the tables' RLS — the function bypasses RLS so it must re-verify), institution derived from the class row (never trusted from the client). Returns `{ event_id, lesson_plan_written }`.

Sequence edits need no RPC — the client upserts `syllabus_sequence` rows directly (RLS covers it) and invalidates the projection queries.

## 5. Check-out sheet rework (jar entry point #1)

`CheckOutLessonGate`'s shell, trigger (StaffCheckInCard Check Out intercept, teachers only), and dismiss-cancels semantics are unchanged. The inner content is replaced:

- **Groups:** one section per distinct (class, subject) among today's slots (from 4.1 `include_today=true` → today's `groups`).
- **Group UI** (`SyllabusProgressGroup` + `ChapterEntryRow`, replacing `LessonCompletionChecklist`/`LessonCompletionRow`): a dropdown of not-completed chapters (from 4.2) + a **Completed / Partial completed** toggle + an Add button; each added entry renders as a row; **"+"** adds another chapter entry. Chapters marked Completed disappear from the dropdown immediately.
- **Write:** each added entry calls `record_syllabus_progress` (4.5) with `date = today`, `source = 'checkout'` — event upsert + coverage dual-write in one transaction. Per-row save = interruption-proof (unchanged principle).
- **Gate:** "Check out" enables only when every group has ≥1 event for today (`filled` on refetch). Revision/test day → teacher adds the current chapter as Partial (decision #5).
- **Coverage dual-write:** on `action='completed'`, best-effort upsert one `tt_lesson_plans` row (`status='done'`, `session_type='teaching'`, `topic_id`, owner/created/updated stamps) onto a slot of that class+subject **that day** which has no done row yet — keeps every existing coverage surface (`syllabusCoverage.ts`, `dash_*` RPCs, lesson-plan export) working unchanged. If more chapters complete that day than free slots (rare), the remainder lives only in the events table — reconciled when coverage readers gain an events UNION (Phase 3). Dual-write failures never block the event write (same best-effort pattern as the pacing fix).

## 6. Check-in popup (jar entry point #2 — replaces the login gate)

- After a successful **check-in** (`StaffCheckInCard`), if 4.1 (`include_today=false`) reports backlog, open a **non-blocking** MobileSheet: backlog days (oldest first), each with the same group/chapter entry UI (`source='checkin'`). Check-in itself is already complete; the sheet stays open until filled or explicitly closed, and reappears at the next check-in while backlog remains.
- A quiet backlog chip on My Week ("N days unlogged") opens the same sheet — the passive reminder between check-ins.
- **Removed:** `LoginLessonGate` (component deleted), the ProtectedRoute pending-days fetch + interstitial (reverted to plain `<AppLayout>{children}</AppLayout>` path). Nothing blocks login anymore (decision #4).
- The >3-unresolved-days coordinator escalation stays deferred (Phase 3 of the original spec); `unresolved_day_count` remains available for it.

## 7. Teacher My Week integration (projection display + edit + corrections)

`TeacherMyWeekPageV2`:

- **PeriodChip** gains one truncated chapter line under the class label: dates ≥ today → projected chapter (from 4.4, one query per visible window, `staleTime: 60_000`); dates < today → that day's actual events for the chip's (class, subject) (e.g. "✓ Ch 5 · partial"), from a bounded per-window events fetch. The existing status badge stays.
- **Tap → `LessonPlanDialogV2` gains a "Syllabus" section** (the "best position in the timetable tab", decision #9):
  - Future/today dates: shows the projected chapter + a "teach a different chapter here" picker. Picking chapter X for what is the k-th remaining period of that (class, subject) rewrites `syllabus_sequence` so X sits at remaining-position k; all projections re-flow instantly (**Auto wins** — no pins; the next recalc may move it again if actuals deviate).
  - Past dates: lists that day's events for the (class, subject) with add/edit/delete (`source='correction'`) — the corrections surface.
  - A "Reorder chapters" link opens a drag-list sheet of the full remaining sequence (the "edit the whole timeline" freedom in one place), writing `syllabus_sequence` positions.
- Existing lesson-plan notes/status behavior in the dialog is untouched.

## 8. Student week grid

`TimetableGridV2` gets an **optional** prop `chapterOverlay?: Map<string /* `${slotId}|${dateIso}` */, string>`; when present, cells render one small truncated chapter line. Only `StudentWeekPageV2` passes it (other callers unaffected): it maps the current real week's weekday→date, calls 4.3 for `[today's week]`, and builds the map. Students thus see the planned chapter on each period of the current week — today emphasized by the grid's existing today styling. Read-only; students never see the jar directly.

## 9. Seeding & rollout

- Backfill in the same migration: `INSERT ... SELECT` from `tt_lesson_plans` (`status='done' AND session_type='teaching' AND topic_id IS NOT NULL`) → `syllabus_progress_events (action='completed', source='correction', date=lp.date, recorded_by=lp.owner_teacher_id)` with `ON CONFLICT DO NOTHING` — so dropdowns don't re-offer chapters already taught, and projections start from reality on day one.
- The events UNIQUE constraint makes the backfill re-runnable.

## 10. Superseded / retired / unchanged (vs. yesterday's shipped Phase 1)

| Piece (shipped 2026-07-03/04) | Fate |
|---|---|
| Check Out trigger + `CheckOutLessonGate` shell + dismiss-guard | **Stays** (content swapped, §5) |
| `LessonCompletionRow` / `LessonCompletionChecklist` | Retired → `SyllabusProgressGroup` / `ChapterEntryRow` |
| `LoginLessonGate` + ProtectedRoute gate | **Removed** (→ §6 popup) |
| `teacher_pending_lesson_days` RPC | Superseded by 4.1; dropped in cleanup migration after frontend swap |
| `tt_chapter_pacing` + `useSetChapterPacing`/`useChapterPacing` | Writes stop; table dropped in cleanup |
| `completion_pct` writes | Stop (column stays, harmless) |
| Coverage dual-write into `tt_lesson_plans` | **Stays** (§5), now keyed to completed events |
| Logout, signOut invariants, non-teacher check-out | Untouched |

## 11. Phasing

- **Phase 1 — the jar:** migration (two tables + RLS + FK indexes + backfill), RPCs 4.1 + 4.2, check-out sheet rework, check-in popup + My Week backlog chip, remove login gate, coverage dual-write. *(Capture must exist before projection has data.)*
- **Phase 2 — the projection:** RPCs 4.3 + 4.4, My Week PeriodChip overlay + LessonPlanDialog Syllabus section + reorder sheet, student grid overlay.
- **Phase 3 (deferred):** >3-day `dashboard_flags` escalation; coverage-reader UNION with events (closes the 2-chapters-1-period gap); cleanup migration (drop `tt_chapter_pacing`, drop old RPC).

## 12. §23 / §24 compliance

Explicit `staleTime: 60_000` on every new query; all RPCs bounded (60-day lookback, LIMIT 30 days, zero-slot pre-check, range-windowed projections); "today" always via `(now() AT TIME ZONE institutions.timezone)::date`; every FK indexed in-migration; RLS via the proven helper tri-clause; no `select("*")`; event upserts idempotent (UNIQUE), single-flight guards on sheet buttons; `toastError` on every mutation; error state before empty state in the sheet and overlays.

## 13. Risks / accepted trade-offs

- **Auto wins** (explicit user choice): a teacher's placement can shift on the next recalc when actual pace deviates. Edits are sequence hints, not pins.
- Chapters > remaining periods → overflow is surfaced only in the teacher edit view.
- Two teachers sharing a (class, subject) share the jar and sequence — last write wins (acceptable; events record who).
- A day with more completed chapters than periods leaves the surplus out of legacy coverage until Phase 3's reader UNION (events table is always complete).
- No offline handling (unchanged v1 gap).
