# Note-only lesson log ("what happened this period" without a chapter)

Date: 2026-09-02
Status: approved design, not yet implemented
Area: timetable-module, two-timeline syllabus
Skills to re-read before coding: `timetable-module`, `salci-design-system`, `ui-invariants`, `high-concurrency-patterns`

## 1. Problem

`LessonPlanDialogV2` forces the teacher to pick a chapter before Save is enabled
([LessonPlanDialogV2.tsx:212-214](../../../src/components/timetable-v2/LessonPlanDialogV2.tsx#L212-L214)).
When a period is not chapter delivery (a surprise test, a class activity, an assembly
that ate the period, a revision drill), the teacher has nowhere to record what actually
happened.

The gap is worse than "no record". A chapterless day currently **traps** the teacher:

| Consumer | Predicate | Consequence |
|---|---|---|
| `teacher_pending_syllabus_days` ([20260704150000:88-95](../../../supabase/migrations/20260704150000_pending_syllabus_days_skip_chapterless.sql#L88-L95)) | `filled` = `EXISTS(syllabus_progress_events for class+subject+date)` | day stays in "N days unlogged" forever |
| `CheckOutLessonGate` ([CheckOutLessonGate.tsx:30-31](../../../src/components/lesson-completion/CheckOutLessonGate.tsx#L30-L31)) | `canProceed = unfilledCount === 0` | teacher cannot check out |
| `dash_evaluate_syllabus_flags` ([20260706160000:57-63](../../../supabase/migrations/20260706160000_sy1_review_fixes.sql#L57-L63)) | same `NOT EXISTS` | SY1 "syllabus logging is behind" flag raised after 3 days |

And a jar event cannot rescue them: `syllabus_progress_events.topic_id` is `NOT NULL`
([20260704140000:12-25](../../../supabase/migrations/20260704140000_syllabus_progress_phase1.sql#L12-L25))
and `record_syllabus_progress` rejects a topic that does not belong to the subject.

So the feature is not just "add a note field". It is "make a chapterless period a
first-class, resolvable log entry".

## 2. Decisions taken

1. **A note-only save counts as that day being logged.** It clears the unlogged badge,
   unblocks check-out, and stops the SY1 flag.
2. **The escape exists on all three surfaces**: the Lesson Plan dialog, the blocking
   check-out gate, and the check-in backlog sheet. The gate is where the trap actually
   bites.
3. **Just a mandatory note.** No activity-type picker. Stored under the existing
   `session_type = 'other'`.

## 3. Data model

One column on `tt_lesson_plans`. No new table.

```sql
ALTER TABLE public.tt_lesson_plans
  ADD COLUMN IF NOT EXISTS is_note_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.tt_lesson_plans
  ADD CONSTRAINT tt_lesson_plans_note_only_requires_note
  CHECK (NOT is_note_only OR btrim(COALESCE(note, '')) <> '');

CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_note_only_group
  ON public.tt_lesson_plans (class_id, subject_id, date)
  WHERE is_note_only;
```

Canonical shape of a note-only row:

| Column | Value | Why |
|---|---|---|
| `is_note_only` | `true` | the discriminator, read only by the new predicates in §5.2 and the export label in §5.4 |
| `topic_id` / `chapter_topic_id` | `NULL` | no chapter was delivered |
| `session_type` | `'other'` | keeps it out of every `session_type = 'teaching'` coverage filter |
| `status` | `'done'` | the period happened; also protects it from the clobber in §5.1 and from the `tt-notify-absence-pending` sweep, which only touches `'planned'` |
| `note` | required, trimmed | the entire content of the record |

### Why an explicit column and not `session_type='other' AND topic_id IS NULL`

The inferred-marker option (no DDL at all) was considered seriously and is genuinely
viable. It was probed against prod on 2026-09-02:

```
non_teaching_rows 0 · non_teaching_no_topic 0 · option_a_false_positives 0
rows_with_a_note 132 · total_rows 758
```

So there is **no retroactive-resolution risk**: no existing row would be silently
reclassified as note-only. That was the strongest argument for a dedicated column and it
does not hold.

The column is still the right call, for two narrower reasons:

1. **The discriminator gates a teacher's ability to check out of work.** Under the
   inferred option the marker is a three-predicate tautology
   (`session_type <> 'teaching' AND topic_id IS NULL AND btrim(note) <> ''`) that has to
   be reproduced byte-identically in two SECURITY DEFINER functions (§5.2), the export
   RPC, and the frontend hydration. A false negative there re-traps the teacher; a false
   positive silently suppresses a real SY1 gap. `session_type` already carries three
   other legal values (`'test'`, `'doubt_session'`, `'other'`) that are dead today but
   are exactly what a future "log the kind of session" feature would use, at which point
   the tautology breaks.
2. **`CHECK (NOT is_note_only OR note is non-empty)` is only expressible with the flag.**
   Phrasing it on `session_type` would wrongly constrain any future non-note `'other'`
   or `'test'` row.

What the column does **not** change: the row still carries `session_type='other'` and
`topic_id NULL`, so every existing `session_type='teaching'` / non-null-topic filter
keeps excluding it for free. No existing consumer needs an `is_note_only = false` clause
added. The flag is purely additive, read only by the new predicates in §5.2 and the
export label in §5.4.

Both options require the same carve-out in `record_syllabus_progress` (§5.1), whose
`ON CONFLICT ... DO UPDATE SET session_type='teaching', topic_id=EXCLUDED.topic_id`
([20260704141000:283-290](../../../supabase/migrations/20260704141000_syllabus_progress_rpcs.sql#L283-L290))
would otherwise convert a note-only row either way. That is not a point of difference.

`src/integrations/supabase/types.ts` is currently in sync with the migrations, so it
**must be regenerated** after this migration:
`npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw`.

## 4. Write path

### 4.1 New RPC (single write path for all three surfaces)

```
public.tt_record_period_note(
  p_class_id   uuid,
  p_subject_id uuid,
  p_date       date,
  p_note       text,
  p_slot_id    uuid DEFAULT NULL
) RETURNS uuid          -- the tt_lesson_plans row id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
```

Behaviour:

1. Reject `auth.uid() IS NULL`; reject `btrim(p_note) = ''` with
   `A note is required.`; reject `length(btrim(p_note)) > 2000`.
2. Resolve institution from `profiles`.
3. **Slot resolution.**
   - `p_slot_id` given (the dialog): load it and require **both**
     `s.class_id = p_class_id AND s.subject_id IS NOT DISTINCT FROM p_subject_id`
     (so a caller cannot log against a mismatched pair) and
     `s.teacher_id = v_uid OR public.tt_user_can_edit_class_slots(v_uid, s.class_id)`.
   - `p_slot_id` NULL (the gate / backlog sheet): pick from the caller's own
     `tt_slots` matching class + subject + active AY + `slot_type IN ('theory','practical')`
     + `day = tt_dow_to_text(p_date)`, LEFT JOINed to any existing plan row for that date
     and ordered `(lp.id IS NULL) DESC, lp.is_note_only DESC, s.id` so an empty period is
     preferred, then an existing note-only period. If the chosen slot already carries a
     chapter-tagged row, raise
     `Every period for this class today already has a lesson logged.` rather than
     destroying it.
4. Upsert on `(slot_id, date)` with the §3 canonical shape.
   `owner_teacher_id` comes from the slot's `teacher_id`, so an admin logging on behalf
   of a teacher does not steal ownership.
5. `REVOKE ALL ... FROM anon, PUBLIC` **by name**, then
   `GRANT EXECUTE ... TO authenticated` (CLAUDE.md §11: Supabase default privileges grant
   `anon` EXECUTE on every new public function and `REVOKE FROM PUBLIC` does not strip it).
   Verify afterwards via `information_schema.routine_privileges`.

One RPC, one transaction, idempotent on `(slot_id, date)`.

**Client hook:** `useRecordPeriodNote` in
[src/hooks/useTimetableV2.ts](../../../src/hooks/useTimetableV2.ts) (it writes
`tt_lesson_plans`, so it belongs with the other lesson-plan hooks, not in
`useSyllabusProgress.ts`). `onError` goes through `toastError(e, { fallback: "Couldn't
save the note.", context: "recordPeriodNote" })`. `onSuccess` invalidates
`["timetable-v2"]` (covers the lesson-plan, week-plans and month-count keys),
`["teacher-pending-syllabus-days"]`, `["syllabus-progress-state"]` and `["dash"]`.

### 4.2 Existing upsert must send the mode explicitly

[useTimetableV2.ts:1282](../../../src/hooks/useTimetableV2.ts#L1282) hardcodes
`session_type: input.session_type ?? "teaching"` and
[:1285](../../../src/hooks/useTimetableV2.ts#L1285) hardcodes `topic_id: input.topic_id ?? null`.
Any later chapter-mode save therefore already rewrites `session_type` back to
`'teaching'`. That is the correct behaviour for the toggle-off direction, but it must
now also clear the new flag, so the dialog's chapter branch passes
`is_note_only: false` and `session_type: "teaching"` explicitly.

`UpsertLessonPlanInput`, `LessonPlanRow`, and the select lists in
`useLessonPlanForDate` ([:1240](../../../src/hooks/useTimetableV2.ts#L1240)) and
`useTeacherPlansForWeek` ([:1362](../../../src/hooks/useTimetableV2.ts#L1362)) all gain
`is_note_only`. Without the select-list change the dialog reopens a saved note-only row
in chapter mode.

`useUpsertLessonPlan.onSuccess` currently does not invalidate
`["teacher-pending-syllabus-days"]` ([:1296-1302](../../../src/hooks/useTimetableV2.ts#L1296-L1302)).
Add it, or the unlogged badge stays stale after a save.

## 5. Consumer contract changes

### 5.1 `record_syllabus_progress` — stop clobbering note-only rows

Slot picker ([20260704141000:271-280](../../../supabase/migrations/20260704141000_syllabus_progress_rpcs.sql#L271-L280))
currently skips only slots that already hold a `status='done'` row. Widen it:

```sql
AND NOT EXISTS (
  SELECT 1 FROM public.tt_lesson_plans lp
  WHERE lp.slot_id = s.id AND lp.date = p_date
    AND (lp.status = 'done' OR lp.is_note_only)
)
```

and add `is_note_only = false` to the `DO UPDATE SET` list as a belt-and-braces guard.

If every candidate slot is note-only the picker returns nothing, the best-effort
dual-write is skipped, and the jar event is still written. Correct.

### 5.2 The shared "was this day logged?" predicate (two functions, kept in lockstep)

`teacher_pending_syllabus_days` `grps` CTE:

```sql
EXISTS (SELECT 1 FROM public.syllabus_progress_events e
        WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d)
OR EXISTS (SELECT 1 FROM public.tt_lesson_plans lp
           WHERE lp.class_id = o.class_id AND lp.subject_id = o.subject_id
             AND lp.date = o.d AND lp.is_note_only) AS filled
```

`dash_evaluate_syllabus_flags` `unfilled` CTE gets the mirrored
`AND NOT EXISTS (... is_note_only ...)`.

**These two predicates must never diverge.** A teacher who resolves a day in the UI but
still gets flagged on the admin dashboard is the exact failure this note calls out.

### 5.3 `evaluate_teacher_badges` — do not inflate the lessons-taught ladder

[20260818120000:220-222](../../../supabase/migrations/20260818120000_teacher_badges.sql#L220-L222)
counts `tt_lesson_plans WHERE owner_teacher_id = _user_id AND status = 'done'`. Because
note-only rows are written as `'done'` they would count as lessons taught. Add
`AND lp.session_type = 'teaching'`.

### 5.4 `tt_lesson_plan_export` — name the gap instead of leaving it blank

Sheet 1 already reports a note-only row as `fill_status = 'Filled'` with the note in the
notes column, which is the desired outcome. Only the chapter cell is misleading (blank).
Surface `lp.is_note_only` in the `rows` CTE and emit
`'chapter', COALESCE(chapter, CASE WHEN is_note_only THEN 'No chapter (activity logged)' END)`.

Sheet 2 (chapter delivery %) already excludes the row via
`COALESCE(lp.topic_id, ct.chapter_id) IS NOT NULL`. No change.

## 6. UI

### 6.1 The toggle

Placement: right-aligned on the `DialogTitle` row. The dialog fork pins its close X at
`absolute right-4 top-4 ... z-10`
([dialog.tsx:50](../../../src/components/ui/dialog.tsx#L50)), which overlaps a switch at
the true corner. Reserve space with `pr-8` on `DialogHeader` and a short comment, the
same mitigation used (as `pr-12`) at
[AssignTeacherClassSubjectDialog.tsx:646](../../../src/components/school/AssignTeacherClassSubjectDialog.tsx#L646).
`DialogHeader` is `flex-col`, so the title row needs its own
`flex items-center justify-between gap-3` wrapper. Nothing else on `DialogContent`, the
inner `<form>`, `DialogHeader` or `DialogFooter` changes: no `max-h-*`, `flex`,
`overflow-*` or `h-full` (ui-invariants §1).

`Switch` + `Label htmlFor` + `cursor-pointer`, matching the repo's dominant toggle idiom
([AssignSubjectToClassDialog.tsx:511-526](../../../src/components/school/AssignSubjectToClassDialog.tsx#L511-L526)).

Header placement puts the toggle outside the `<form data-dirty="true">`. That is safe
here specifically because the attribute on that form is a **static** `"true"`
([LessonPlanDialogV2.tsx:285-289](../../../src/components/timetable-v2/LessonPlanDialogV2.tsx#L285-L289)),
not conditional on dirtiness, so the service-worker guard in `main.tsx` already suppresses
reloads for the whole time the dialog is open regardless of where the control sits. Do not
copy header placement into a dialog whose `data-dirty` is computed.

### 6.2 Dialog behaviour when the toggle is ON

Hidden: the auto-timeline block and the past-date `SyllabusProgressGroup` correction
block (both at [:302-353](../../../src/components/timetable-v2/LessonPlanDialogV2.tsx#L302-L353)),
the chapter select ([:355-434](../../../src/components/timetable-v2/LessonPlanDialogV2.tsx#L355-L434)),
and the study-material upload ([:436-486](../../../src/components/timetable-v2/LessonPlanDialogV2.tsx#L436-L486)).

Three reasons these must be **hidden, not merely optional**:

- `useUploadStudyMaterialForChapter` requires a `topicId`
  ([useSyllabusHierarchy.ts:874-882](../../../src/hooks/useSyllabusHierarchy.ts#L874-L882));
  there is no chapterless upload path at all. Any file already staged is cleared when the
  toggle flips on, and the amber Alert at
  [:479-485](../../../src/components/timetable-v2/LessonPlanDialogV2.tsx#L479-L485)
  (which keys off `hasChapter`) goes with it.
- `teachDifferentChapter` ([:143-153](../../../src/components/timetable-v2/LessonPlanDialogV2.tsx#L143-L153))
  writes `syllabus_sequence` **on selection, not on Save**. Leaving the auto-timeline
  visible would let a note-only interaction silently reorder the projector.
- A stale `newChapterName` left in the "add new chapter" input would create an orphan
  `syllabus_topics` row. The note-only save path skips the `addChapter.mutateAsync` block
  at [:216-231](../../../src/components/timetable-v2/LessonPlanDialogV2.tsx#L216-L231)
  entirely.

**Overwriting an existing chapter entry.** `UNIQUE (slot_id, date)` means one row per
period, so flipping the toggle ON over a period that already has a chapter logged will
clear `topic_id`. Per CLAUDE.md §9a ("any save that removes existing assignments MUST
confirm first, naming what it will remove"), the dialog renders an amber Alert naming the
chapter that will be cleared, and the Save button reads **"Replace chapter entry"**
instead of "Save". Study material already uploaded under that chapter stays in the
syllabus; it is orphaned from this period, not deleted, and the Alert says so.

The note field is promoted: label becomes **"What happened this period"** with a
required marker, placeholder "Surprise test on Chapter 4, class activity, assembly ran
over...", and a one-line helper "This day will count as logged. No chapter is recorded."

`canSave` becomes:

```ts
const canSave = !isSubmitting && !!institutionId &&
  (noteOnly ? note.trim().length > 0 : hasChapter);
```

Save routes to `tt_record_period_note` (with the explicit `slot_id`) when `noteOnly`,
and to the existing upsert otherwise. `noteOnly` hydrates from
`existing.data.is_note_only` in the effect at
[:167-176](../../../src/components/timetable-v2/LessonPlanDialogV2.tsx#L167-L176).

Toggling OFF an existing note-only row requires picking a chapter before Save re-enables;
saving then converts the row back to chapter mode. There is no delete affordance for a
note-only row in this iteration.

### 6.3 Period chip on the teacher week

[TeacherMyWeekPageV2.tsx:519](../../../src/pages/teacher/TeacherMyWeekPageV2.tsx#L519)
indexes `STATUS_VISUAL[plan.status]` unguarded, so a note-only row currently renders as
whatever its status says. Add an explicit branch before the status lookup: a distinct
"Logged" badge (slate/violet tone, `NotebookPen` icon), and render the note text as the
`line` instead of the projected chapter, truncated with a `title` tooltip.

### 6.4 Check-out gate and check-in backlog sheet

`SyllabusProgressGroup` gains an `allowNoteOnly?: boolean` prop. When set, it renders a
collapsed link under the chapter picker: **"Something else happened this period?"** which
expands a textarea plus a Save button calling `tt_record_period_note` (no `slot_id`, the
server resolves it). On success the parent's `useTeacherPendingSyllabusDays` query is
invalidated, the group flips to filled, and `canProceed` unblocks.

Passed by [CheckOutLessonGate.tsx:71-79](../../../src/components/lesson-completion/CheckOutLessonGate.tsx#L71-L79)
and `CheckInBacklogSheet.tsx:50-58`. **Not** passed by the Lesson Plan dialog's
correction mount, which already has the header toggle: two routes to the same outcome in
one dialog would be confusing.

## 7. Deliberately unchanged (verified safe)

| Surface | Why it is safe |
|---|---|
| `dash_syllabus_coverage_build` | filters `status='done' AND session_type='teaching'` AND non-null chapter, so excluded three times over |
| `src/lib/syllabusCoverage.ts:113-116` | explicit `session_type !== "teaching"` and `!topic_id` guards (this path is also currently unmounted) |
| `timetableCompat.fetchCoveragePlans` | `.in("topic_id", chapterIds)` excludes NULL topic at the DB level; does not select `note` |
| `dash_teacher_action_queue` | keys on row existence only, so a note-only row already clears "N slots unlogged this week" |
| `dash_teacher_syllabus_chapters` | filters `topic_id IS NOT NULL` |
| `teacher_projection_for_range` | never reads `tt_lesson_plans` |
| `delete_syllabus_progress` | matches on `topic_id = p_topic_id`, never NULL |
| `tt-notify-absence-pending` | only sweeps `status='planned'`; note-only rows are `'done'` |
| Every student *code path* | no student-facing code reads `tt_lesson_plans` at all; `useStudentWeekV2` reads `tt_slots` only. The raw-PostgREST exposure is a separate matter, see §7a |

## 7a. Student note leak: narrow the policy (not just "no code reads it")

`tt_lesson_plans_select_student_published`
([20260424100000:680-694](../../../supabase/migrations/20260424100000_tt_cal_phase1_schema.sql#L680-L694))
grants students SELECT on rows with `status IN ('planned','done')` in a published class.
RLS has no column-level restriction, so **any student can read `note` today** with a
direct `GET /rest/v1/tt_lesson_plans?select=note`. Nothing in the app does it, and the
"students never see notes" guarantee (`useStudentWeekV2` nulls slot notes at
[useTimetableV2.ts:928](../../../src/hooks/useTimetableV2.ts#L928)) rests entirely on
that absence.

This is pre-existing, but the feature raises the stakes: "surprise test tomorrow,
chapters 4 to 6" is a note with consequences, and note-only rows are written as `'done'`,
squarely inside the policy. Narrow it in the same migration:

```sql
DROP POLICY tt_lesson_plans_select_student_published ON public.tt_lesson_plans;
CREATE POLICY tt_lesson_plans_select_student_published
  ON public.tt_lesson_plans FOR SELECT
  USING (
    public.has_role((select auth.uid()), 'student')
    AND status IN ('planned','done')
    AND session_type = 'teaching'      -- new: note-only rows are staff-private
    AND EXISTS (
      SELECT 1
      FROM public.tt_class_structure cs
      JOIN public.class_assignments  ca ON ca.class_id = cs.class_id
      WHERE cs.class_id = tt_lesson_plans.class_id
        AND cs.publish_status = 'published'
        AND ca.user_id = (select auth.uid())
        AND ca.role    = 'student'
    )
  );
```

`(select auth.uid())` per CLAUDE.md §23.13 while the policy is being rewritten anyway
(these are the last `tt_*` policies still on the bare form).

**Residual, logged not fixed here:** chapter-mode notes stay student-readable over raw
PostgREST. The real fix is dropping the student policy entirely (no student code path
reads this table) or replacing it with a column-restricted view. Out of scope for this
change; it predates it and is not made worse by it.

## 8. Migration

Single file `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql`, in order:

1. `ALTER TABLE` + CHECK + partial index (§3)
2. `CREATE OR REPLACE teacher_pending_syllabus_days` (§5.2)
3. `CREATE OR REPLACE dash_evaluate_syllabus_flags` (§5.2)
4. `CREATE OR REPLACE record_syllabus_progress` (§5.1)
5. `CREATE OR REPLACE evaluate_teacher_badges` (§5.3)
6. `CREATE OR REPLACE tt_lesson_plan_export` (§5.4)
7. `DROP` + `CREATE POLICY tt_lesson_plans_select_student_published` (§7a)
8. `CREATE FUNCTION tt_record_period_note` + `REVOKE ... FROM anon, PUBLIC` + `GRANT ... TO authenticated` (§4.1)

Applied to prod through the Management API via `scripts/run-sql.ps1` (the
`supabase_migrations.schema_migrations` ledger is not maintained in this repo), then
verified with `pg_proc` / `information_schema.routine_privileges` / `information_schema.columns`.
Types regenerated afterwards.

## 9. Scale Gate

| # | Item | Verdict |
|---|---|---|
| 1 | Bounded list queries | pass. No new list query. `teacher_pending_syllabus_days` keeps its 60-day window and `LIMIT 30`. |
| 2 | Server-side aggregation | pass. The new predicate is an `EXISTS` inside the existing RPC, not a client count. |
| 3 | Explicit `staleTime` | pass. No new `useQuery`; the write goes through `useMutation`. Existing reads inherit the 60s global default. |
| 4 | No `select("*")` | pass. Explicit column added to two existing select lists. |
| 5 | Idempotent mutations | pass. `ON CONFLICT (slot_id, date) DO UPDATE`, plus an `isPending` gate on the Save button. |
| 6 | Dependent writes in one transaction | pass. `tt_record_period_note` is a single RPC. |
| 7 | FK index in the same migration | n/a, no new FK. A partial index backs the new predicate. |
| 8 | Errors surfaced | pass. `toastError` on the mutation; the RPC raises friendly messages that `isLikelyUserFriendly()` passes through. |
| 9 | No JWT-less `getUser()` | pass. `useAuth` / the RPC's own `auth.uid()`. |
| 10 | No sub-30s `refetchInterval` | n/a, none added. |
| 13 | `(select auth.uid())` in new RLS | pass. The one rewritten policy (§7a) uses `(select auth.uid())` in both places. The new RPC is SECURITY DEFINER and resolves `auth.uid()` once into a variable. |
| 14 | Edge-function hygiene | n/a. No edge function is added or changed; `tt-notify-absence-pending` is untouched because note-only rows are `'done'`, not `'planned'`. |

Cost of the new predicate: one extra index-only `EXISTS` per (class, subject, day) group
inside an RPC that already expands at most 60 days. Negligible.

## 10. Test plan

1. Teacher opens a period for today, flips the toggle, saves with an empty note: Save
   stays disabled.
2. Saves with a note: chip reads "Logged" with the note text; the monthly `x / y` badge
   increments; the unlogged badge decrements.
3. Same teacher, same day, attempts check-out: the gate lets them through.
4. Reopen the same period: the toggle is ON and the note is populated.
5. Toggle OFF, pick a chapter, save: row becomes `session_type='teaching'`,
   `is_note_only=false`, `topic_id` set; coverage % moves.
6. Note-only on slot A, then chapter progress recorded at check-out for the same class,
   subject and date: the jar event lands on slot B (or nowhere), and slot A's note-only
   row is untouched.
7. Coordinator export: the row reads Filled, chapter "No chapter (activity logged)",
   notes = the teacher's text; Sheet 2 percentage unchanged.
8. Admin Command Center: SY1 flag resolves for a teacher whose only gaps were note-only
   days.
9. Teacher badges: lessons-taught count does not move.
10. Toggle ON over a period that already has a chapter: the amber Alert names the chapter,
    the button reads "Replace chapter entry", and the saved row has `topic_id NULL`.
11. Student RLS, via `SET LOCAL ROLE authenticated` + a student's JWT claims: a note-only
    row is NOT returned by `select id, note from tt_lesson_plans`, while a chapter-mode
    row in the same published class still is.
12. `tt_record_period_note` is not executable by `anon`
    (`information_schema.routine_privileges`).
13. 375px and dark mode on the dialog; toggle does not collide with the close X.
14. `npm run typecheck`, `npx eslint <touched paths>`, `npx vite build` all exit 0.

## 11. Risks

- **Predicate drift.** §5.2 changes two functions that must agree. Mitigation: both live
  in the same migration file, adjacent, with a cross-reference comment in each.
- **Teacher over-use.** Nothing stops a teacher logging every period as note-only, which
  would zero their syllabus coverage while showing a clean unlogged badge. Coverage % is
  the existing counter-signal and it is visible to admins on the Command Center; no
  additional throttle in this iteration.
- **`session_type` overload.** `'other'` now carries two meanings until a future
  non-note "other" session exists. `is_note_only` is the discriminator; never branch on
  `session_type = 'other'` alone.
