---
name: timetable-module
description: Timetable module — period structures, shared resources, class workspace, substitute mode, lesson planning, teacher + student week views, academic calendar, AY rollover. Use when touching `/school/timetable`, `/school/timetable/:classId`, `/teacher/my-week`, `/student/my-week`, `/school/calendar`, `/school/shared-resources`, or any of `tt_period_structures`, `tt_period_slots`, `tt_class_structure`, `tt_resources`, `tt_slots`, `tt_substitutions`, `tt_lesson_plans`, `cal_academic_years`, `cal_events`, or the `copy-timetable-template`, `tt-notify-substitute`, `tt-notify-absence-pending`, `get-working-days` edge functions.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Timetable Module

Rebuilt 2026-04-23 on branch `timetable-rebuild`. Seven legacy tables were dropped in migration `20260503100000_tt_cal_phase6_drop_legacy.sql`; design + decisions live in `docs/superpowers/specs/2026-04-23-timetable-academic-calendar-rebuild-design.md`. The stack spans five inter-dependent layers. Edit any one with the others in mind — they share constraints, triggers, and RLS patterns.

## 1. Period Structures — weekly grid foundation

Tables live in migration `20260424100000_tt_cal_phase1_schema.sql`.

* **`tt_period_structures`** — `(id, institution_id, name, working_days TEXT[], ...)`. `working_days` is TEXT[] of `'monday'..'sunday'` with CHECK; lets different wings run different schedules (Primary Mon–Sat, Senior Mon–Fri).
* **`tt_period_slots`** — `(id, structure_id, period_number, label, start_time, end_time, kind)`. `kind IN ('period','break')`. Trigger `tt_prevent_overlapping_period_slots` uses `tsrange` with exclusive `()` bounds so back-to-back slots (09:00–09:40, 09:40–10:20) do NOT falsely conflict. `UNIQUE (structure_id, period_number)` + `CHECK (end_time > start_time)`.
* **`tt_class_structure`** — `(id, institution_id, class_id, structure_id, academic_year, publish_status, published_at, published_by, ...)`. `UNIQUE (class_id, academic_year)` — one structure per class per year. `publish_status IN ('draft','published')` controls per-class visibility of `tt_slots` rows to teachers/students (see §3). FK to `tt_period_structures` uses `ON DELETE RESTRICT` so a structure can't be dropped while classes still reference it — surface the friendly "Unassign this structure from all classes before deleting." message by regex-matching the error (`useDeletePeriodStructure` in [useTimetableV2.ts](../../src/hooks/useTimetableV2.ts)).

**Period-number encoding invariant ([PeriodStructureDialogV2.tsx](../../src/components/timetable-v2/PeriodStructureDialogV2.tsx) + `useCreatePeriodStructure`).** `UNIQUE (structure_id, period_number)` covers breaks too. The creator sorts rows by `start_time`, numbers non-break slots `1..N`, and assigns break slots `period_number = 1000 + idx`. Preserve this scheme or inserts fail with unique-constraint errors whenever a structure contains breaks.

**RLS pattern.** `tt_period_slots` scopes tenancy via `EXISTS` on parent `tt_period_structures` row, not a direct `institution_id`. Writes gated on `school_admin/super_school_admin` + `institution_id = public.get_user_institution(auth.uid())`. Super admins `FOR ALL`. Coordinators read-only — creating structures is admin-only by spec.

**UI entry points.**
* Admin/coordinator: Settings gear on `/school/timetable` → `SettingsSheetV2` → Structures tab (list + create + delete).
* `/school/period-structures` still resolves: it redirects to `/school/timetable` so any stale bookmark doesn't 404.

## 2. Shared Resources — school-wide room pool

* **`tt_resources`** — `(id, institution_id, name, kind, capacity, description, ...)`. `kind IN ('lab','library','computer_room','sports_facility','other')`. `UNIQUE (institution_id, name)`. `capacity >= 1`. `institution_id` `ON DELETE CASCADE`.
* RLS mirrors `tt_period_structures` (admin write, everyone-in-institution read).

**Capacity semantics.** `capacity` is pool size — up to `capacity` classes can book the same named resource simultaneously. If timetable logic starts treating rooms as addressable units (Lab #1 vs Lab #2), both signature and rule change — until then the pool model is authoritative.

**Two write paths, one table.**
* **Direct**: [useTimetableV2.ts](../../src/hooks/useTimetableV2.ts) `useCreateResource` / `useDeleteResource` invoked from the gear sheet (`/school/timetable` → Settings → Resources).
* **Facade for legacy callers**: [useSharedResources.ts](../../src/hooks/useSharedResources.ts) re-exposes `tt_resources` under the old `SharedResource` shape (translates `kind ⇄ resource_type`, `capacity ⇄ count`). Still used by [SharedResourcesPage](../../src/pages/school/SharedResourcesPage.tsx) at `/school/shared-resources` and [InstitutionWizard](../../src/components/admin/institution-wizard/InstitutionWizard.tsx) step 3. Don't delete the facade until both callers migrate.

**Wizard "No shared resources" is an explicit choice.** `canProceed()` requires `sharedResources.length > 0 || sharedResourcesConfirmedEmpty`. Yes/No card pair; "No" sets `confirmedEmpty=true` and shows confirmation with escape hatch. Don't collapse into a "skip" button — the whole point is preventing silent omission.

## 3. Timetable Workspace — the cells + publish

Single page at `/school/timetable` ([TimetablePageV2.tsx](../../src/pages/school/TimetablePageV2.tsx)) opens a **class-list home**; clicking a class navigates to `/school/timetable/:classId` which renders [ClassWorkspaceV2.tsx](../../src/pages/school/ClassWorkspaceV2.tsx) — the grid + slot drawer + teacher-load panel + publish toggle. Teachers NOT allowed (`school_admin`, `super_school_admin`, `coordinator`, `super_admin` only).

* **`tt_slots`** — `(id, institution_id, class_id, period_slot_id, day, academic_year, slot_type, subject_id?, teacher_id?, resource_id?, notes?)`. `slot_type IN ('theory','practical','library','sports','arts','assembly','free','break')`. `UNIQUE (class_id, period_slot_id, day, academic_year)`. `day IN ('monday'..'sunday')`. **No DB-side conflict check** — cross-class teacher double-booking is handled by the live "Busy / Free" badge inside the slot drawer (uses `useTeacherLoadV2` to pre-compute per-teacher day counts for the workspace's scope).
* **Publish state lives on `tt_class_structure.publish_status`, NOT on `tt_slots`.** The class is the publish unit; individual cells inherit.

**RLS (four policies).**
1. `tt_slots_select_admin_or_coord` — admin/super_admin/coordinator see every row within their institution.
2. `tt_slots_select_teacher_own` — teachers see slots where `teacher_id = auth.uid()` OR they're the `substitute_teacher_id` in a `tt_substitutions` row for that slot.
3. `tt_slots_select_published_for_class` — broad read for any slot whose parent class row in `tt_class_structure` is `publish_status = 'published'`. (This is how students see their class's schedule indirectly.)
4. `tt_slots_admin_or_coord_write` — gated through `public.tt_user_can_edit_class_slots(user, class)` SECURITY DEFINER helper. **Use the helper; don't inline the `wing_class_mappings × wing_assignments` EXISTS.** Inlining triggers RLS recursion under `INSERT ... RETURNING *` per CLAUDE.md §22 pattern.

**Hook surface ([useTimetableV2.ts](../../src/hooks/useTimetableV2.ts)).** `useClassListV2`, `useClassWorkspaceV2`, `useSubjectsForClassV2`, `useTeachersForClassSubjectV2`, `useSaveTtSlot` (upsert `onConflict: "class_id,period_slot_id,day,academic_year"`), `useDeleteTtSlot`, `useSetPublishStatusV2`, `useCalendarWindowV2`, `useTeacherLoadV2`. `ACADEMIC_TYPES = ["theory","practical"]` — only these require subject + teacher; other slot types commit with just `slot_type`.

**Wing-filter gotcha.** `classes` has NO `wing_id` column. `useClassListV2` fetches classes + joins `wing_class_mappings` separately, applies the wing filter client-side. Selecting `wing_id` from `classes` directly raises PG error and renders an empty "No classes in scope" state even though classes exist. Same fix applied in `useTeacherLoadV2` (coordinator wing scope).

**Components.**
* [TimetableGridV2](../../src/components/timetable-v2/TimetableGridV2.tsx) — days × periods, tint by `slot_type`, holiday/exam-block overlay from `useCalendarWindowV2`.
* [SlotDrawerV2](../../src/components/timetable-v2/SlotDrawerV2.tsx) — right-side sheet; subject-first, then teacher filtered to teachers who teach that subject for this class (`class_assignments WHERE role='teacher'`). **`data-dirty="true"` is required** for SW dirty-form handling per CLAUDE.md §17.
* [TeacherLoadPanelV2](../../src/components/timetable-v2/TeacherLoadPanelV2.tsx) — aggregates across all classes in scope (admin: institution-wide; coordinator: their wings).
* [SettingsSheetV2](../../src/components/timetable-v2/SettingsSheetV2.tsx) — gear icon → Structures + Resources tabs (admin-only).

## 4. Substitutions — one-off date overrides

* **`tt_substitutions`** — `(id, slot_id, date, substitute_teacher_id?, original_teacher_id?, status, source, assigned_by?, assigned_at?, reason?, cancelled_reason?, created_by, ...)`. `UNIQUE (slot_id, date)` (`tt_substitutions_unique_slot_date`) — one cover per date per slot; upsert key is `"slot_id,date"`. **There is NO `subject_id` column.** Commit `35150073` (2026-09-10) subject-scoped `tt_lesson_plans` and pasted `subject_id` into this upsert too; every "Save substitute" failed with 42703 until 2026-09-25. Never add it here without a migration adding the column.
* **`status`**: `pending` (auto-flow: teacher out, nobody yet, substitute NULL) → `assigned` (a person picked a cover) or `cancelled` (the teacher checked in; set by the late-check-in trigger) or `no_teacher_available` (the day ended still pending; closed by every attendance pass). `completed` is in the CHECK but nothing writes it, and `dash5_coord_log_backlog` excuses only `assigned` covers, so do not start flipping old covers to `completed`.

**Two write paths, one row.**
1. **Class workspace → Substitute mode** → [SubstituteDialogV2](../../src/components/timetable-v2/SubstituteDialogV2.tsx) → `useUpsertSubstitution`. Any teacher can be picked (not gated on subject/class). **The upsert MUST send `status:'assigned'` + `assigned_by/at`**: the row usually already exists as the auto-flow's `pending` row, an upsert only UPDATEs the columns it sends, and without status the period stayed `pending` with a substitute on it (still on every cover list, never credited). The date must fall on the slot's weekday (the dialog enforces it). The coordinator console's "Assign cover" button lands here.
2. **Attendance → Substitutions tab** → [SubstitutionReviewPanel](../../src/components/attendance/SubstitutionReviewPanel.tsx) → `tt_assign_substitute(sub_id, teacher)`, pending rows only, re-validates availability.

Both paths go through [src/lib/substitutions.ts](../../src/lib/substitutions.ts): `invalidateSubstitutionCaches` (class workspace, Substitutions tab, `dash5 coord cover`, My Week covers) and `notifySubstituteAssigned` (`tt-notify-substitute`). Before 2026-09-25 only path 1 notified, so a cover assigned from the tab never reached the substitute.

**`tt_get_free_teachers_for_slot(slot, date)`** ranks candidates. "Busy" is ANY period in the school on that weekday + year whose TIME overlaps (every school runs two period structures; matching `period_slot_id` alone missed the other one), plus the teachers of basket subjects in an overlapping optional-group period, plus anyone already covering an overlapping period. Returns nothing for a caller who cannot edit the class's slots (returns, not raises, because `dash5_coord_cover` counts it per row).

**Auto-flow (15-min cron `tt-attendance-substitution-pass` → `tt_run_attendance_cron_pass` → `tt_run_attendance_pass_for_institution`).** Everything is institution-local (`now() AT TIME ZONE i.timezone`, never the server date). Slots are scoped to `tt_timetable_ay_code(inst, date)` (the calendar year containing the date, falling back to no filter when no slots carry that code) so a copied-in next-year timetable does not double every cover. `tt_create_pending_subs_for_absent_staff` skips `free`/`break` slots and inactive classes, and RE-OPENS rows the late-check-in trigger cancelled when the teacher is marked absent again (periods not yet started only). The late-check-in trigger compares in institution time; the UTC version cancelled covers for periods already taught. Only schools with an `attendance_settings` row run any of this (Alliance has none, so it relies on path 1).

**Grants.** `tt_create_pending_subs_for_absent_staff`, `tt_run_attendance_cron_pass`, `tt_timetable_ay_code`: service_role/postgres only. `tt_run_attendance_pass_for_institution`, `tt_get_free_teachers_for_slot`, `tt_assign_substitute`, `tt_my_covers`: authenticated, never anon (a NULL `auth.uid()` is the pass's trusted-cron branch). The RLS helpers (`tt_slot_has_substitute_for`, `tt_user_can_edit_slot`, `tt_slot_institution`) keep their grants because policies evaluate them.

**Read access.** `tt_substitutions_select` is `TO authenticated`: the substitute themself, or staff of the school. Students are excluded (the `reason` column is free text like "sick leave").

**The teacher's view.** `tt_my_covers(from, to)` returns `covering` rows (I cover a colleague) and `covered` rows (a colleague covers me), assigned/completed only, 62 days / 500 rows max. [TeacherMyWeekPageV2](../../src/pages/teacher/TeacherMyWeekPageV2.tsx) renders `covering` as a non-tappable purple Cover chip on that date and `covered` as "Covered by <name>" on the teacher's own chip. Covers are date-specific: never put them on the recurring weekday grid.

**Critical invariant.** The substitute does NOT take over the original teacher's `tt_lesson_plans` row (RLS: owner only). **`tt-notify-absence-pending` is RETIRED (410)**: it flipped the original teacher's `planned` plan to `pending`, but the lesson plan dialog has no status controls any more, so nobody could clear it; it was also never scheduled and would have hit the 1,000-row cap with an N+1 loop. Do not schedule it. Its purpose is served by the notification plus "Covered by" in My Week.

**Acceptance suite:** `scripts/test-substitutions.sql` (35 assertions under real RLS as admin / teacher / student / coordinator, rolled back). Run it via `scripts/run-sql.ps1` after touching any of the functions above.

## 5. Lesson Planning — one instance per (slot, date)

Lesson plans layer on `tt_slots` recurring template. Each `tt_slots` row = weekly recurring cell; each `tt_lesson_plans` row = concrete instance for a specific calendar date.

* **`tt_lesson_plans`** — `(id, institution_id, slot_id, class_id, subject_id?, owner_teacher_id?, date, session_type, status, topic_id?, chapter_topic_id?, addressed_topic_ids, note?, planned_at, done_at, ...)`. `session_type IN ('teaching','test','doubt_session','other')`. `status IN ('planned','done','pending','skipped')`. **`UNIQUE (slot_id, date)`** is the upsert key. `class_id`, `subject_id`, `owner_teacher_id`, `session_type` are denormalized from the parent slot for index-backed queries (`useSyllabusCoverage` filters `session_type='teaching' AND status='done'`). Trigger `tt_lesson_plans_stamp_status` sets `planned_at` on first `planned`, `done_at` on first `done`, plus back-stamps `planned_at` on direct→`done` transitions so no `done` row ever has NULL `planned_at`.

**Note-only periods (2026-09-02).** `is_note_only BOOLEAN NOT NULL DEFAULT false` marks a period logged with a free-text note instead of a chapter (surprise test, class activity, assembly that ate the period). Canonical row shape: `is_note_only=true`, `topic_id NULL`, `chapter_topic_id NULL`, `session_type 'other'`, `status 'done'`, non-empty `note` (CHECK `tt_lesson_plans_note_only_requires_note`). Written ONLY by `tt_record_period_note(p_class_id, p_subject_id, p_date, p_note, p_slot_id DEFAULT NULL)`: the dialog passes the period, the check-out sheet and the backlog sheet let the server resolve one. Never assemble the shape by hand from the client.

* **The predicate that MUST stay in lockstep.** A day counts as logged when a `syllabus_progress_events` row exists for (class, subject, date) **OR** a note-only `tt_lesson_plans` row does. That `OR` lives in BOTH `teacher_pending_syllabus_days` and `dash_evaluate_syllabus_flags`. Diverge them and a teacher who resolved a day in the UI is still SY1-flagged to their principal. Both carry cross-referencing comments; cell 11 of the suite pins the pair.
* **Why this is not just a note field.** `syllabus_progress_events.topic_id` is NOT NULL, so before this a chapterless day could never be resolved and the then-blocking `CheckOutLessonGate` would not let the teacher check out at all. The only escape was to claim a chapter they had not taught.
* **Check-out is NOT gated any more (2026-09-11).** `StaffCheckInCard` records the check-out on the tap for everyone; teachers then get `CheckOutSyllabusSheet` (today's groups, chapter or note per group), which is a dismissible prompt: Done, the X and the overlay all just close it, and an unfilled group resurfaces in `CheckInBacklogSheet` at the next check-in. Do not reintroduce a blocking gate: the day it blocked on a bug, teachers could not go home.
* **A planned chapter never blocks a note.** The gate path of `tt_record_period_note` (no `p_slot_id`) refuses only when the chosen period holds a DELIVERED chapter (`status='done'`, not note-only, `topic_id` set); a `planned`/`pending`/`skipped` chapter row is an intention and the note replaces it, exactly as the dialog path already does behind its "Replace chapter entry" alert. Candidate order: empty period, then note-only, then undelivered chapter, delivered chapter last. Before migration `20260911130000` any chapter-tagged row refused, so a teacher who had planned a chapter on the day's only period (or whose chapter entry was deleted via `delete_syllabus_progress`, which reverts the mirror to `planned` and keeps `topic_id`) got "Every period for this class today already has a lesson logged" and could neither log nor, back then, check out. Cells 17-18 of the suite pin both halves.
* **`record_syllabus_progress` skips note-only periods** (`lp.status = 'done' OR lp.is_note_only`) so a later chapter completion lands on a different period instead of rewriting the note into a chapter-tagged teaching row. Do not "simplify" that back to the status check alone: the protection must be semantic, not incidental to how status happens to be set.
* **Never branch on `session_type = 'other'` alone** — `is_note_only` is the discriminator. `'test'` and `'doubt_session'` stay unused and are what a future "kind of session" feature would claim.
* **Students cannot read note-only rows.** `tt_lesson_plans_select_student_published` is narrowed to `session_type = 'teaching'`. RLS cannot restrict columns, so before that a student in a published class could read `note` over raw PostgREST. Chapter-mode notes remain readable: pre-existing, tracked separately.
* Excluded automatically from syllabus coverage, chapter-delivery %, and the lessons-taught badge ladder. Counts as logged for the monthly plans badge and `dash_teacher_action_queue`. Proven by `scripts/verify-note-only-day.sql` (18 assertions under real RLS, run via `scripts/run-sql.ps1`).

**New status vs legacy.** `pending` is new — no analog in the old `lesson_plans` table. Its only writer was the retired `tt-notify-absence-pending` job, so no row in prod has ever held it (0 on 2026-09-25); the UI still renders it defensively. `syllabusCoverage.ts`'s reducer doesn't branch on `pending` so those rows are counted as "activity started but not covered" (matches the `planned` path's behavior).

**RLS (five policies).**
* `tt_lesson_plans_select_admin_or_coord` — `tt_user_can_edit_class_slots(auth.uid(), class_id)` helper (admin-wide + coordinator-wing).
* `tt_lesson_plans_select_owner_teacher` — `owner_teacher_id = auth.uid()` (every teacher reads their own rows).
* `tt_lesson_plans_select_student_published` — `has_role(auth.uid(), 'student')` AND `status IN ('planned','done')` AND student is in `class_assignments (user_id=auth.uid(), role='student', class_id=plans.class_id)` AND class's `tt_class_structure.publish_status='published'`. **Students NEVER see `pending` or `skipped`** — enforced by RLS, not just UI.
* `tt_lesson_plans_admin_or_coord_write` — same helper-gated path as the admin read.
* `tt_lesson_plans_owner_teacher_write` — `owner_teacher_id = auth.uid()`.

**`note` column is NOT filtered at RLS.** Student-facing queries MUST omit `note` from `select()`. [useStudentWeekV2](../../src/hooks/useTimetableV2.ts) + [StudentWeekPageV2](../../src/pages/student/StudentWeekPageV2.tsx) handle this by projecting `note: null` in the resolved slot shape.

**Hook + UI surface.** `useLessonPlanForDate(slotId, date)`, `useUpsertLessonPlan`, `useTeacherPlansForWeek` in [useTimetableV2.ts](../../src/hooks/useTimetableV2.ts). UI is [LessonPlanDialogV2](../../src/components/timetable-v2/LessonPlanDialogV2.tsx) — minimal for this iteration: status + notes + date picker. Topic/chapter picker is an open follow-up. Draft autosave from the legacy `lessonPlanDraft.ts` was NOT ported — add it back if user-reported unsaved-work complaints resurface.

**Syllabus coverage ([syllabusCoverage.ts](../../src/lib/syllabusCoverage.ts) + `useSyllabusCoverage`).** Routes through [timetableCompat.ts](../../src/lib/timetableCompat.ts) `fetchCoveragePlans` — reads `tt_lesson_plans` filtered by `class_id + subject_id + topic_id IN chapters`. Returns `{ total, covered, pending, skipped, percentage }`. Counts chapters where at least one row has `status='done' AND session_type='teaching'`.

## 6. Academic Calendar

* **`cal_academic_years`** — `(id, institution_id, code, starts_on, ends_on, is_active)`. Partial unique index `one_active_year_per_institution` enforces exactly-one-active per institution. `code` (e.g. `'2026-27'`) is the string that every `tt_*` table's `academic_year` column joins against — keep them identical.
* **`cal_events`** — `(id, institution_id, academic_year, title, kind, starts_on, ends_on, color?, notes?, ...)`. `kind IN ('holiday','exam_block','event')`. `starts_on <= ends_on` (single-day events have `ends_on = starts_on`). Exam blocks get overlap-guarded by trigger `cal_prevent_overlapping_exam_blocks` (same-AY `exam_block` rows can't overlap); holidays vs exam_blocks is a soft confirm at UI layer.
* **Dropped from legacy schema:** `term_start`, `term_end`, `working_day`, `ptm` event_types. Terms are gone entirely (product call — "make it simple"). PTM + special_event collapsed into the generic `event` kind.

**Compat shim ([timetableCompat.ts](../../src/lib/timetableCompat.ts)).** `useAcademicCalendar` is untouched externally — it routes through this shim, which translates `cal_events` rows back into the legacy `AcademicCalendarEvent` shape. External consumers (~30 files across Exams, Attendance, Reports, Dashboard, Students, etc.) don't know the rebuild happened. **Don't bypass the shim** — if you need calendar data in new code, import from `timetableCompat` directly; if you're editing an existing consumer, leave the `useAcademicCalendar` call alone.

**Dual-write was removed in Phase 6a** (commit `023eb8a`). The `academic_calendar` table is DROPPED. There's no "mirror" anymore; `cal_events` is the only source of truth.

**`currentAcademicYear()`** stays as a sync-callable pure function (date-based April-March heuristic). The async variant `currentAcademicYearActive(institutionId)` prefers `cal_academic_years.is_active` when populated, falls back to the heuristic otherwise.

## 7. Edge functions

| Function | Purpose | Invoke pattern |
|---|---|---|
| `copy-timetable-template` | AY rollover. Reads + writes `tt_slots`. Does NOT copy `tt_lesson_plans`. | From [NewYearSetupDialog](../../src/components/calendar/NewYearSetupDialog.tsx) via `supabase.functions.invoke` |
| `tt-notify-substitute` | Client-invoked fire-and-forget after a cover is assigned (either path). Caller must pass `tt_user_can_edit_slot`; refuses rows with no substitute. Notifies substitute + original teacher (`original_teacher_id`, so basket periods work). | `notifySubstituteAssigned` in `src/lib/substitutions.ts` |
| `tt-notify-absence-pending` | **RETIRED 2026-09-25**, deployed as a 410. Do not schedule (see §4). | none |
| `get-working-days` | Reads `cal_events`. Returns per-AY list of working days minus holidays/exam_blocks. | `useWorkingDays` hook (currently has no frontend callers, kept for external API consumers) |

**Deploy:** `npx supabase@latest functions deploy <name> --project-ref gyymkgohcijeksmrzuyw`. Any edit requires redeploy.

## 8. AY Transition, Print, Guard Rails

**New-year auto-prompt ([AnnualCalendarPage.tsx](../../src/pages/school/AnnualCalendarPage.tsx) + [NewYearSetupDialog.tsx](../../src/components/calendar/NewYearSetupDialog.tsx)).** When `canEdit` admin switches to a year where BOTH `cal_events.length === 0` AND `tt_slots count === 0`, auto-open dialog. Gated by `sessionStorage` key `ay-setup-prompted:{year}` to fire once per session per year. The dialog path to "Copy from Y" fires `copy-timetable-template` (against `tt_slots`).

**Print view ([TimetablePrintViewV2.tsx](../../src/components/timetable-v2/TimetablePrintViewV2.tsx)).** `openTimetablePrintWindowV2({ className, classSection, academicYear, institutionName?, structure, slots })` — `window.open('', '_blank')` + embedded CSS + auto-`print()`. Don't refactor into a hidden in-tree `<div>`; the window-open sidesteps global Tailwind and sidebar chrome cleanly. Resource names are intentionally NOT rendered because `ResolvedSlotV2` only carries `resource_id`, not name — add a second join when the UX calls for it.

**Sticky mobile action bar.** `sticky bottom-0 bg-background border-t -mx-6 px-6 py-3 md:static md:border-0 md:py-0 md:mx-0 md:px-0`. The `-mx-6/px-6` compensates for DialogContent's inner `p-6` wrapper (see `ui-invariants` skill §13) — don't "clean up" without retesting 375px.

**Student "What's coming"** was a legacy feature on the old `StudentWeekPage`; v2 doesn't render it yet. The `useStudentWeekV2` hook returns the published `tt_slots` list — add a date-filter derivation in `StudentWeekPageV2` when someone asks for it back.

**Guard rails.**
* **No period structure for the class.** Admin/coord sees a clear empty state on the class workspace (no inline picker in v2 yet — must go through the gear sheet). Coordinator for an off-wing class sees "ask your admin" read-only fallback. If the coordinator CAN edit but no structure has been created in the institution at all, the gear sheet's Structures tab → "New" button is the path.
* **No eligible teachers.** When `useTeachersForClassSubjectV2` returns `[]` AND `slot_type IN ('theory','practical')` AND subject selected, `SlotDrawerV2` shows an amber Alert + disables Save. The coordinator/admin must go to Classes → this class → Teachers and assign someone to the subject first.
* **Cross-class teacher conflict.** Detected client-side via `useTeacherLoadV2` + the "Busy / Free" badge in `SlotDrawerV2`. Not a DB constraint — by design, so admins can override for co-taught periods if they ever need to.

## Dirty-form contract

All timetable forms that write set `data-dirty="true"` so the SW soft-toast path fires correctly mid-edit. See main CLAUDE.md §17. Applies to `SlotDrawerV2`, `SubstituteDialogV2`, `LessonPlanDialogV2`, `PeriodStructureDialogV2`, `ResourceDialogV2`.

## Attendance Auto-Mark — Institution-Local Timezone (full text of CLAUDE.md §24)

`attendance_settings.staff_check_in_time` / `staff_check_out_time` are bare `TIME` columns storing institution-local wall-clock (IST for SALCI). Any DB code comparing them to `now()` MUST convert via `(now() AT TIME ZONE i.timezone)::time` with `i` joined from `institutions` (default timezone `'Asia/Kolkata'`).

**The 2026-05-25 bug.** `tt_run_attendance_cron_pass()` used `(now() AT TIME ZONE 'UTC')::time` — for an IST school with `check_in_time = 08:00` the cron only fired after 13:30 IST, well past school hours. Auto-mark was dead for every IST school and the Substitutions tab always showed "All covered". Fix migration: `20260525120000_attendance_tz_fix_and_admin_override.sql`.

**Live callers.**
* DB: `tt_run_attendance_pass_for_institution(uuid)` — single entry point for both the 15-min cron and the client RPC. Always uses `(now() AT TIME ZONE v_tz)`.
* Frontend: `isPastCutoff(settings)` in `src/hooks/useStaffAttendance.ts` compares **browser local time** to settings. Safe for India-only today; a non-IST school will need `institutions.timezone` here too.

**Page-view RPC kick.** The Workday page (`src/pages/staff/WorkdayPage.tsx`, route `/staff/workday`) calls `tt_run_attendance_pass_for_institution` once per session (per institutionId per date) when an admin/coordinator opens it past local cutoff. It lived on `SchoolAttendancePage` until 2026-09-28, when every staff surface (own check-in, Staff Attendance, Substitutions, staff leave) moved to Workday and the Attendance page became students only — skips the 15-min cron lag. Guarded by sessionStorage key `salci:att-pass:{institutionId}:{YYYY-MM-DD}`. Hook: `useRunAttendancePass` (`src/hooks/useRunAttendancePass.ts`). The cron remains the fallback.

**Auto-mark is decoupled from `staff_substitution_enabled`.** The sub flag only gates `tt_create_pending_subs_for_absent_staff()`; the absence row is inserted unconditionally — schools without auto-subs still get correct attendance.

**Admin override.** `useUpsertStaffAttendance` (`src/hooks/useStaffAttendance.ts`) upserts any teacher's row for today (status + optional remarks) with `auto_marked_absent = false`. Trigger `tt_substitutions_cancel_on_late_checkin_trg` (AFTER INSERT OR UPDATE OF status) cancels pending subs for the teacher's remaining periods when status flips to present/late. RLS has explicit INSERT/UPDATE/DELETE policies for super_admin / super_school_admin / school_admin / coordinator scoped to the institution.

**Client-side preview.** When a teacher has no row yet and local cutoff has passed, `useScopedStaffAttendance` (`src/hooks/useAttendanceLists.ts`) exposes `derived: true, status: "absent"` so `AttendanceListPanel` renders an "Absent · syncing" pill during the brief RPC roundtrip. Mutation paths never read this derived state — they always target the DB row identity.

**Don't reintroduce the UTC comparison.** Any future timezone-sensitive comparison (student attendance window, exam start time, dashboard "today") MUST go through `(now() AT TIME ZONE i.timezone)` against the institution's column — the dash_* dashboard RPCs all follow this pattern.

## Staff Leave — one decision path, and it reaches attendance (2026-09-28)

Migration `20260928160000_staff_leave_review.sql`, spec `docs/superpowers/specs/2026-09-26-staff-leave-workflow-design.md`, suite `scripts/test-staff-leave.sql` (39 assertions under real RLS, rolled back). Staff apply on Workday (`/staff/workday`, old `/staff/my-leaves` redirects); the table is the HR module's `staff_leave_requests`.

* **`review_staff_leave(p_request_id, p_decision, p_notes)` is the ONLY way a decision is written.** The Workday Staff Leaves tab and the HR & Payroll `StaffLeavePanel` both call it. It locks the request, authorises through `can_review_staff_leave`, and in one transaction stamps the request and writes the attendance. Its FIRST statement rejects any decision other than approved/rejected with 22023: the frontend probes for the function by calling it with `'probe'`, so keep that check first.
* **The ladder** (`can_review_staff_leave`): teacher -> any school admin, or a coordinator whose wing holds one of the teacher's classes (the coordinator must hold the coordinator ROLE, not just a `wing_assignments` row); coordinator -> a school admin; school admin -> another school admin; never yourself; super admins anything. The same helper backs the reviewers' SELECT policy, which is how coordinators see their wing's requests.
* **An approval writes `on_leave` rows on the school's WORKING days only** (weekdays in the institution's `tt_period_structures.working_days`, Mon to Sat when there are none, minus `cal_events` holidays), with `remarks = 'Approved leave <request id>'` as the marker. A present/late day is left alone (counted as skipped); an absent row is overwritten. The attendance pass inserts only where no row exists, so advance `on_leave` rows survive it, and `tt_create_pending_subs_for_absent_staff` raises cover for `on_leave` exactly as for absent.
* **Balances move by the days actually written**, never the calendar span, and overturning an approval undoes exactly that: past covered days turn back to `absent` (`remarks = 'Leave <id> not approved'`), today and later are deleted and returned to the pass, and the balance is refunded. Deciding the status a request already has is a no-op, so a double submit cannot charge twice.
* **Policies:** staff INSERT only their own `pending` request for their own school, SELECT their own, DELETE their own only while `pending`, and have NO UPDATE (the old FOR ALL owner policy let a teacher approve their own leave from the console). Admins hold SELECT only (`Admins view staff leave requests`, migration `20260928163000`, applied 2026-09-28): the old FOR ALL admin policy let an admin approve their own request with a direct UPDATE that skipped attendance and the balance. Never re-grant admins UPDATE; route every decision through the RPC.
## Student Leave — two paths, one shape (2026-09-03)

Migration `20260903120000_teacher_marked_student_leave.sql`. Spec: `docs/superpowers/specs/2026-07-06-late-removal-and-student-leave-workflow-design.md` (its locked decision #2 is **superseded** here).

A student gets leave two ways and they must stay indistinguishable downstream:
1. **The student applies** — `leave_requests` row, `source='student'`, `status='pending'` → a reviewer calls `review_student_leave`.
2. **A teacher marks it** — the third pill in `ClassAttendanceMarker`, committed by `save_class_attendance`, which creates the `leave_requests` row already `approved` with `source='staff'`.

Both end as an approved `leave_requests` row **plus** an `attendance_records` row with `status='leave'`.

* **`attendance_records.status` is now `('present','absent','leave','sick','casual','holiday')`.** `sick`/`casual` predate `leave` and are effectively dead (3 prod rows); nothing writes them. `late` stays out of this plane. The roster RPC **rejects** anything but present/absent/leave, so a stray payload cannot repurpose the others.
* **`leave` is never counted as PRESENT, but it IS counted in the TOTAL.** A student on leave was still accounted for that day, so they stay in the denominator; they are simply not in the numerator. 6 present / 2 absent / 2 on leave renders as **"Students present today: 6 of 10 - 60.0%"**. Concretely: every `dash_*` ratio keeps `count(*) FILTER (WHERE status IN ('present','late'))` over a plain `count(*)`. Migration `20260905160000`.
* **Two wrong turns to not repeat.** (1) `20260903120000` added `'leave'` to the numerators to keep dashboard numbers frozen - that is the pre-decision behaviour, leave counted as present, and produced "8 of 10 - 80.0%". (2) `20260905120000` then over-corrected by putting `status <> 'leave'` in every attendance WHERE, which pulled leave students out of the DENOMINATOR too and produced "6 of 8 - 75.0%". The landing point is numerator-only exclusion. Do not add `'leave'` to a present-numerator, and do not filter leave rows out of the attendance queries.
* **`dash_evaluate_flags` A4 is the one place `'leave'` belongs in a status list**: it counts anything `NOT IN ('present','late','leave')` as missed school, so a leave the school granted cannot raise a truancy flag or its auto-task. Leave rows DO reach A4 (they are no longer filtered), so that list is load-bearing - if you touch it, re-check the flag catalog.
* The student-facing `present/(present+absent)` percentage is a DIFFERENT metric and has never included leave on either side. Leave being in the dashboard denominator but out of the student's percentage is intentional, not drift: one is a daily roll-call, the other is a graded-days ratio.
* **Never write these two tables from the client.** Staff hold no write policy on `leave_requests` by design. The whole class-day goes through `save_class_attendance(p_class_id, p_date, p_rows jsonb)` in one transaction (CLAUDE.md §9a). `useUpsertAttendance` survives only for the dead `FaceAttendance` component — do not route the roster back through it.
* **`marked_by` on a leave row written by an approval is NULL, deliberately.** `computeAttendanceLock` locks a whole class-day as "marked by another teacher" the moment ANY row carries someone else's id, so stamping the reviewer there made approving one student's leave turn the entire roster read-only for the class teacher. Who decided it lives on `leave_requests.reviewed_by`. A roster save still stamps the saving teacher on every row it writes.
* **`salci.leave_write` is the edit-window escape hatch.** `enforce_student_attendance_edit_window` fires inside the leave RPCs too (SECURITY DEFINER does NOT change `auth.uid()`), and from 2026-08-11 to 2026-09-03 it aborted every leave decision touching a future or out-of-window date — the whole transaction, including the `leave_requests` update and the notification. `review_student_leave` now raises that transaction-local GUC before writing and **lowers it again straight after** (`set_config(..., true)` lasts to the end of the TRANSACTION, not the function). `save_class_attendance` deliberately does NOT raise it: the roster writes only the date it is showing and must obey the window.
* **Withdrawal is narrow on purpose.** Flipping a leave-marked student to present/absent deletes ONLY a `source='staff'` single-day approved row for exactly that date. A student's own application, and any multi-day leave, survives — reversing someone else's request belongs in the Leaves list. The UI confirms first, naming the students (§9a).
* **`remarks` is the origin marker** the roster reads with no extra query: `'Leave marked by teacher'` vs `'Leave approved'` (an approval's note is preserved when a teacher re-saves a day already covered by one). The literals are duplicated in `save_class_attendance` and in `TEACHER_LEAVE_REMARK`/`APPROVED_LEAVE_REMARK` in `src/hooks/useAttendance.ts` — keep them in step.
* **`save_class_attendance` returns `{marked, leaves_created, leaves_updated, leaves_kept, leaves_withdrawn}`** and the hook surfaces `leaves_kept`. Re-tapping Leave on a student the roster already put on leave **updates** that record's type and reason (an earlier version dropped the correction behind a success toast). A leave the STUDENT applied for, or any multi-day leave, is counted in `leaves_kept` and left byte-for-byte alone — the roster cannot detect either from the records it holds, so the count is the only honest way to tell the teacher their re-typed reason was not stored.
* **No overlap constraint exists** on `leave_requests` (an explicit non-goal of the original design). The RPC instead reuses an approved row that already covers the date rather than stacking a duplicate, which is also what makes the save idempotent. A still-**pending** application can coexist with a teacher-marked leave; later-write-wins, as the original spec accepted.
* **The two paths must refresh the SAME caches, and do so through one list.** `invalidateAttendanceCaches` in [src/lib/attendanceCache.ts](../../src/lib/attendanceCache.ts) is called by BOTH `useSaveClassAttendance` and `useReviewLeave`. They previously carried two hand-written lists and had already drifted: approving a leave left the "Marked today" chip, the coordinator roster, the per-user history, the Reports pivot and the student's dashboard summary showing pre-decision data until their staleTime expired. Add a new attendance- or leave-reading query key to that file, not to a call site.
* **A REJECTION never writes a future date** (`dates_deferred` in the RPC result). "Not on leave" is not "absent": before the edit-window exemption a future-dated rejection failed outright, and after it the call began writing `absent` rows for days that had not happened and firing `notify_student_absent` ("You were marked absent on <future date>"). Approvals still write future dates, because a granted leave IS a known future state.
* **`leave_requests.source` is not client-settable.** The student INSERT/UPDATE policies pin it to `'student'`; only `save_class_attendance` writes `'staff'`. Without that pin a student could POST `source='staff'` over raw PostgREST and make their own application look like a leave the school granted them - which is the one thing the column exists to record. Migration `20260903150000_student_leave_parity.sql`.
* **Adding a student status? Seven frontend maps plus the DB.** `AttendanceStatus` (`src/hooks/useAttendance.ts`) and `DayAttendanceCode` (`src/hooks/useStudentMonthAttendance.ts`) are the only compile-exhaustive gates (via `attendanceTones.ts`) — widen those FIRST for a compiler-driven checklist, because `attendance_records.status` is `string` in the generated types so nothing else errors. Then: `toStudentStatusCode`, `STATUS_TO_CODE`, `useAttendanceCounts`, `AttendanceHistoryView`, `AttendanceListPanel`, `TeacherClassAttendanceFlow`, `ClassAttendanceMarker`'s RECORDED_* maps, `StudentAttendancePage`'s local mappers, and `useAttendanceAnalytics` (which feeds the CBSE PDF). Silent disappearance is the failure mode, not a crash.
* **The roster now renders an error state before its empty state.** It used to read only `data`/`isLoading`, so a failed records query left the draft defaulting every student to present and a Save would overwrite a real day. Marking, the bulk buttons, the counts line and the Save bar are all suppressed while either query is in error — keep it that way.
* Acceptance suite: `scripts/test-student-leave.sql` — 27 assertions under a real teacher's JWT (`SET LOCAL ROLE authenticated` + `request.jwt.claims`), wrapped in `BEGIN … ROLLBACK` so it is safe to run against prod. Run it via `scripts/run-sql.ps1` after touching either RPC.

## Dashboard action cards (2026-10-03)
The staff dashboards' top slot (`DashboardTopSlot`) shows check-in, substitution, leave and check-out cards from ONE read-only RPC, `my_dashboard_actions(p_view)`, with the logic in the owner-only twin `_my_dashboard_actions(uid, view, now)` (acceptance suite: `scripts/test-dashboard-actions.sql`). Spec: `docs/superpowers/specs/2026-10-03-dashboard-action-cards-design.md`.
* The cover count needs a real staff check-in that day (schools that never check in raise a cover for every period) and skips periods already over; admin and coordinator views only.
* Admins never get STUDENT leave on the card (owner's rule). Staff leave: the admin view uses `can_review_staff_leave`; the coordinator view inlines ONLY its coordinator rung, so an admin who also coordinates never gets the whole school there (§25). Student counts require `student_in_class`, so a stranded request never pins the card.
* The query key is `["staff-attendance", "my-actions", uid, view, schoolDate]`: any write that invalidates `["staff-attendance"]` refreshes the cards. A new write path that changes check-in, covers or leave must invalidate that prefix, or `DASHBOARD_ACTIONS_KEY` from `src/lib/dashboardActionsKey.ts`. Keep that key module import-free and apart from `src/lib/dashboardActions.ts`: entry-chunk helpers import it, and `check:banner-chunk` fails if the cards' logic reaches the entry.
* `pass_due` lets an admin or coordinator dashboard kick `tt_run_attendance_pass_for_institution` once a day (`useAttendancePassKick`, the same sessionStorage flag as Workday), 20 to 60 s late on purpose and without a toast: a school's dashboards all turn due at the cutoff, which is also a cron tick, and two passes at once can collide on UNIQUE(staff_id, date).
* The check flow is shared (`useStaffCheckFlow`: the greeting button, the cards, Workday's card) and four rules from the final review (2026-10-05) are load-bearing. Check-out stamps only today's OPEN row (`date = today`, `check_out_at IS NULL`, `maybeSingle`; no row means already updated, so a neutral toast and no syllabus sheet), so no second tab, device or card left from yesterday can move a recorded time. A 23505 on check-in re-reads and says only "Today's attendance is already recorded.", because the row can be the attendance pass's absent mark. Both writes seed `["staff-attendance", "today", uid, date]` with the returned row, so the greeting never re-offers the action just taken. The used card is dropped ONLY from cached answers whose status is success, keeping their `dataUpdatedAt` and re-invalidating them: a plain `setQueriesData` turns a failed answer back into old cards (§6) and makes every cached answer look new.
