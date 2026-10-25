# Teacher badges rollout: DB runbook for the applying developer

Two migrations, applied **in this order**, same session or separate ones:

| Order | Migration | Prod | Measure first with | Section |
|---|---|---|---|---|
| 1 | `supabase/migrations/20260904150000_classroom_planning_syllabus_badges.sql` | **APPLIED 2026-09-07** (Tushar; 54 badges to 31 staff; two fixes folded into the file, see below) | `scripts/measure-classroom-badge-ladders.sql` | §1 to §9 |
| 2 | `supabase/migrations/20260904160000_assessment_marking_teamwork_badges.sql` | **NOT applied** | `scripts/measure-staff-badge-ladders-round2.sql` | §10 onward |

Order matters because both re-emit the whole `evaluate_teacher_badges` body and the second is a superset of the first. Applying 2 then 1 would silently drop the nine round-3 counters. Round 1 is already live, so only round 2 remains.

**Two Postgres rules learned from the round 1 apply (2026-09-07), already folded into round 2:**

- `AFTER UPDATE OF <cols> ... REFERENCING NEW TABLE` is refused (`0A000`, transition tables cannot be specified for triggers with column lists). Every statement-level trigger with a transition table must be a bare `AFTER UPDATE`. The trigger function filters the transition table instead.
- Both `INSERT ... SELECT FROM tb` upserts in the evaluator carry `ORDER BY tb.id` so two concurrent evaluator runs for the same teacher lock `badge_progress` rows in one order. A deadlock there is swallowed by the trigger wrapper as a WARNING, which means a silently unawarded badge.

Round 2 was written on a machine with no local Supabase, so work-queue ground rule 11 (execute locally before pushing) was not met by its author. Please run it against a local instance before prod.

**Frontend bridge to remove afterwards.** Until round 2 lands, the page shows its 21 badges from a frontend mirror, `src/components/achievements/teacher/pendingTeacherCatalog.ts`, merged into the payload by `useTeacherAchievements`. Those tiles carry the hint "Tracking starts with the next update" instead of a progress bar, cannot be earned, and are excluded from the next-badge card. The mirror matches server rows by badge name, so each badge switches to its real row the moment the migration is applied, with no deploy needed. Once round 2 is verified in prod, delete that file and the two call sites (`useTeacherAchievements.ts`, `TeacherAchievementsView.tsx`) so the catalog has one source of truth again. If you re-pace a rung before applying, also update the matching row in the mirror or the tile wording will change on the day the database catches up.

**Round 1 migration:** `supabase/migrations/20260904150000_classroom_planning_syllabus_badges.sql`
**Companion script:** `scripts/measure-classroom-badge-ladders.sql`
**Frontend pair:** the same branch's changes to `src/pages/AchievementsPage.tsx`, `src/components/achievements/**` (see §7 for ship order)
**Written:** 2026-09-04 by Naman's branch (`naman-branch`). Author of the SQL had no prod access, so every number in the catalog is provisional and every precondition below is unverified against prod. This document exists so you can verify and apply it without reading the whole planning conversation.

---

## 1. What this change does (30-second version)

Teachers have an Achievements page (`/achievements`) with 23 badges in five tabs. Badges are **rows in `badge_definitions`** (`badge_type = 'teacher'`), awarded by **one Postgres function** `evaluate_teacher_badges(uuid, boolean)` that computes a handful of lifetime counts per teacher and joins them to the catalog by `criteria_metric`. Triggers on the source tables call the evaluator whenever a count can move. The page reads everything through the `teacher_achievements()` RPC.

This migration:

1. Adds **6 badges** in the Classroom tab on **2 new metrics**:
   - `lessons_planned_ahead`: `tt_lesson_plans` rows whose `planned_at` (converted to the institution's timezone) is a date **before** the period date. i.e. the teacher planned the lesson in advance. Requires a chapter (`topic_id`), `session_type = 'teaching'`, not a note-only row.
   - `syllabus_topics_completed`: `count(DISTINCT topic_id)` in `syllabus_progress_events` where `recorded_by` = teacher and `action = 'completed'`.
2. **Re-emits the whole evaluator function** with the two new counters and a **widened role guard**: `user_roles.role IN ('teacher','coordinator')` instead of `= 'teacher'`. Coordinators now earn the same ladder.
3. **Deactivates** the 4 legacy `badge_type = 'coordinator'` rows (holders keep points; they just stop being offered).
4. Adds 1 partial index, 4 triggers (2 on `tt_lesson_plans`, 2 on `syllabus_progress_events`, all four sharing one new function), a backfill loop, and grants.

Nothing is deleted. No table shape changes. No RLS changes.

---

## 2. Preconditions you MUST verify first

The migration ledger (`supabase_migrations.schema_migrations`) is not maintained in this project, so check the catalog, not the ledger.

| # | Check | Why it matters | How |
|---|---|---|---|
| P1 | `tt_lesson_plans.is_note_only` column exists | Added by `20260902120000_lesson_plan_note_only_day.sql` (2 days before this). The new trigger WHEN clauses reference it. If missing, `CREATE TRIGGER` errors and the whole migration rolls back, which is the correct outcome: apply 20260902120000 first. | `SELECT 1 FROM information_schema.columns WHERE table_name='tt_lesson_plans' AND column_name='is_note_only';` |
| P2 | Live `evaluate_teacher_badges` body contains `AND lp.session_type = 'teaching'` | 20260902120000 patched the live function **in place** (string replace via `pg_get_functiondef`). This migration re-emits the **entire** body and includes that clause. If the live body does NOT have it, 20260902120000 was never applied, and you must apply that first or you will be shipping a body that disagrees with the rest of that migration. | Query 4 in `scripts/measure-classroom-badge-ladders.sql` returns `true`. |
| P3 | No OTHER in-place patches on the evaluator | Same reason. Diff the live body against the function body in this migration's §4. The only expected differences are: the widened guard, the two new `v_planned` / `v_topics` declarations + SELECTs, the two extra VALUES rows, and the two extra arguments in `GREATEST(...)`. Anything else means someone patched prod since 2026-09-02 and you must fold that in before applying. | `SELECT pg_get_functiondef('public.evaluate_teacher_badges(uuid, boolean)'::regprocedure);` |
| P4 | (none) `institutions.timezone` is `TEXT NOT NULL DEFAULT 'Asia/Kolkata'` since `20260525120000` | The planned-ahead comparison uses `AT TIME ZONE i.timezone`; a NULL timezone cannot occur, so this precondition was listed in error (corrected 2026-10-05, work-queue Task 7). | Nothing to check. |
| P5 | `spe_recorded_by_idx` exists on `syllabus_progress_events` | The syllabus counter relies on it. Created with the table in 20260704140000. | `SELECT 1 FROM pg_indexes WHERE indexname='spe_recorded_by_idx';` |

---

## 3. Step 0: measure, then re-pace the rungs

Run `scripts/measure-classroom-badge-ladders.sql` (read-only) through the Management API helper:

```powershell
powershell -File scripts/run-sql.ps1 -SqlFile scripts/measure-classroom-badge-ladders.sql -OutFile "$env:TEMP\ladders.json"
```

Or paste it into the Supabase Dashboard SQL Editor. Read the output file, not the console.

It returns, per metric, how many staff have `>= 1, 5, 10, 20, 40` and the max. Then edit the catalog CTE in **§1 of the migration** so that:

- **bronze** (`criteria_value` currently 1) is reachable on day one. Leave at 1.
- **silver** (currently 10) is something a meaningful minority already has.
- **gold** (currently 40) is a real summit: reached by a few, or by nobody yet but within reach of the max. If the max is 12, a gold rung at 40 is dead and should come down to ~15-20. If the max is 200, 40 is too cheap.

The 2026-08-18 migration (`20260818120000_teacher_badges.sql`, header + inline comments) shows exactly how the existing 23 rungs were paced against measured numbers; copy that style and **write the measured numbers into the comment next to the ladder** so the next person knows what the rungs were paced against.

Also update the badge **descriptions** if you change a number ("Plan 10 lessons ahead of time" → whatever the new value is). The description is what the tile shows.

Re-pacing later is cheap: the catalog CTE re-asserts `criteria_value` on every run, so a follow-up migration with new numbers is one UPDATE.

Query 3 of the script tells you how many coordinator-only users the widened guard will admit; that is the size of the second backfill group.

---

## 4. Apply

- **Apply outside school hours.** §3 of the migration creates an index on `tt_lesson_plans` with plain `CREATE INDEX` (not CONCURRENTLY, which cannot run in a transaction). Brief write lock on that table.
- **Do NOT use `supabase db push`.** The ledger is stale; the CLI would try to replay hundreds of already-applied files.
- Use the Management API helper (`scripts/run-sql.ps1 -SqlFile supabase/migrations/20260904150000_classroom_planning_syllabus_badges.sql`) or the Dashboard SQL Editor. The file is one transaction-safe batch.
- The backfill in §6 loops over every teacher and coordinator with any activity and runs 9 index-backed aggregates each. On 2026-08-18 the equivalent loop over 265 teachers was quick. Expect `RAISE NOTICE 'classroom badge backfill: N users evaluated, M badges awarded'` at the end.

---

## 5. Verify after apply

Run these; each should match.

```sql
-- 5a. Six new rows, active, teacher, classroom.
SELECT name, tier, criteria_metric, criteria_value, points, display_order
FROM badge_definitions
WHERE badge_type='teacher' AND criteria_metric IN ('lessons_planned_ahead','syllabus_topics_completed')
ORDER BY display_order;                                   -- 6 rows

-- 5b. Legacy coordinator catalog retired.
SELECT count(*) FROM badge_definitions WHERE badge_type='coordinator' AND is_active;   -- 0

-- 5c. Evaluator has both new counters AND the note-only clause, and admits coordinators.
SELECT position('v_planned' IN d) > 0            AS has_planned,
       position('v_topics' IN d) > 0             AS has_topics,
       position('lp.session_type = ''teaching''' IN d) > 0 AS has_note_only_patch,
       position('IN (''teacher'', ''coordinator'')' IN d) > 0 AS admits_coordinators
FROM (SELECT pg_get_functiondef('public.evaluate_teacher_badges(uuid, boolean)'::regprocedure) d) x;
                                                          -- all four true

-- 5d. Triggers present.
SELECT tgname, tgrelid::regclass FROM pg_trigger
WHERE tgname IN ('trg_zz_teacher_badges_lesson_planned',
                 'trg_zz_teacher_badges_lesson_planned_upd',
                 'trg_zz_teacher_badges_syllabus',
                 'trg_zz_teacher_badges_syllabus_upd');    -- 4 rows

-- 5e. Index present.
SELECT indexname FROM pg_indexes WHERE indexname='idx_tt_lesson_plans_owner_planned';   -- 1 row

-- 5f. Grants: no PUBLIC / anon EXECUTE. proacl must have NO entry starting with '=' .
SELECT proname, proacl FROM pg_proc
WHERE proname IN ('evaluate_teacher_badges','tg_zz_teacher_badges_syllabus');
-- Expected shape: {postgres=X/postgres,service_role=X/postgres} or similar.
-- A leading "=X/postgres" element means PUBLIC still holds EXECUTE: re-run §7 of the migration.

-- 5g. Backfill landed.
SELECT bd.name, count(ub.id) AS holders
FROM badge_definitions bd LEFT JOIN user_badges ub ON ub.badge_id = bd.id
WHERE bd.criteria_metric IN ('lessons_planned_ahead','syllabus_topics_completed')
GROUP BY bd.name ORDER BY bd.name;

SELECT count(*) FROM notifications
WHERE type='badge_earned' AND metadata->>'backfill'='true' AND created_at > now() - interval '1 hour';
```

---

## 6. Smoke test in the app

Frontend must be deployed for the coordinator parts (see §7). With just the DB applied, an existing teacher account already works:

1. Log in as a teacher (`teacher2` / `teacher3` on SALCI National School are the accounts used during development). Open `/achievements`. Hero should say **29 badges available**. Classroom tab should show 12 tiles; the six new ones sit after Syllabus Shepherd.
2. In My Week, open **tomorrow's** period, pick a chapter, save. Back on `/achievements`, "Planned Ahead" reads `1 of 1 lesson planned ahead`, is earned, and a "Badge earned: Planned Ahead" notification exists. (If the account already had plans, the backfill will have awarded it already; check the tile progress moves by one instead.)
3. Open a **past** period and log it straight to done. The planned-ahead count must **not** move (planned_at is stamped now, which is after the period date).
4. Check in a chapter as completed through the syllabus flow. "Topic Ticked" earned. Complete the **same** chapter for a second section: count stays the same (distinct chapters).
5. After the frontend deploy: log in as a **coordinator-only** user. `/achievements` should render the teacher surface (teal hero, five tabs), not the old flat grid, and there should be no role switcher. The backfill summary notification should be in their bell.

---

## 7. Ship order with the frontend

The frontend on this branch (a) adds the two metrics to type-locked lists so the tiles get proper unit text, and (b) routes coordinators to the teacher surface and removes the page-level role switcher.

- **DB first, then frontend** is the safe order. With the DB applied and the OLD frontend still live: teachers see the six new tiles immediately (the surface is catalog-driven), but with a generic description instead of "N of M lessons planned ahead" until the frontend deploys. Coordinators on the old frontend see the legacy grid with zero active rows ("No badges in this category yet") until the frontend deploys. Cosmetic, minutes-long.
- **Frontend first, DB not applied** is worse: coordinators land on the teacher surface, `evaluate_teacher_badges` still rejects them, so they see 23 badges with no progress at all. Avoid.
- Both in the same deployment window is ideal.

---

## 8. Rollback

If something looks wrong after apply, this hides the new badges and stops the new triggers without touching anyone's earned rows. Leaving the two extra counters inside the evaluator is harmless (they join to inactive rows and award nothing).

```sql
BEGIN;
UPDATE badge_definitions SET is_active=false, updated_at=now()
WHERE badge_type='teacher' AND criteria_metric IN ('lessons_planned_ahead','syllabus_topics_completed');

DROP TRIGGER IF EXISTS trg_zz_teacher_badges_lesson_planned     ON public.tt_lesson_plans;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_lesson_planned_upd ON public.tt_lesson_plans;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_syllabus           ON public.syllabus_progress_events;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_syllabus_upd       ON public.syllabus_progress_events;
DROP FUNCTION IF EXISTS public.tg_zz_teacher_badges_syllabus();
COMMIT;
```

To also take coordinators back off the ladder, re-narrow the guard with the same in-place pattern 20260902120000 used, so nothing else in the body changes:

```sql
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.evaluate_teacher_badges(uuid, boolean)'::regprocedure);
  IF position('ur.role IN (''teacher'', ''coordinator'')' IN d) = 0 THEN
    RAISE EXCEPTION 'guard anchor not found, patch by hand';
  END IF;
  EXECUTE replace(d, 'ur.role IN (''teacher'', ''coordinator'')', 'ur.role = ''teacher''');
END $$;
UPDATE badge_definitions SET is_active=true, updated_at=now()
WHERE badge_type='coordinator' AND name IN ('Coordinator First Task','Efficient Coordinator','Master Coordinator');
-- (Lightning Fast stays off: its metric tasks_on_time has never been computed.)
```

Badges already awarded by the backfill are intentionally NOT revoked by rollback; the platform's rule is that a badge, once earned, is kept.

---

## 9. Where things live (for reading the code)

| Concern | File |
|---|---|
| Original teacher catalog + evaluator + trigger patterns this copies | `supabase/migrations/20260818120000_teacher_badges.sql` |
| Read RPCs the page calls (catalog-driven). Note `teacher_badge_rarity()` in this file filtered `role = 'teacher'` in both the numerator and the denominator, so a coordinator would have read "earned by 0% of teachers"; `20260907110000` (Task 3, applied) widened both predicates to `IN ('teacher','coordinator')` | `supabase/migrations/20260818130000_teacher_achievements_read_api.sql`, superseded for `teacher_badge_rarity()` by `20260907110000` |
| The in-place patch this must preserve | `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql` lines ~513-530 |
| `tt_lesson_plans` schema + `planned_at` stamping trigger | `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql` lines ~220-290 |
| `syllabus_progress_events` schema | `supabase/migrations/20260704140000_syllabus_progress_phase1.sql` |
| Single write path for syllabus events (`record_syllabus_progress`) | `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql` lines ~402-500 |
| Client write path for lesson plans (`useUpsertLessonPlan`) | `src/hooks/useTimetableV2.ts` ~line 1268 |
| Metric lists the frontend type-checks against | `src/components/achievements/teacher/teacherTypes.ts`, `src/components/achievements/types.ts`, `src/components/achievements/toBadgeDisplay.ts` |
| Coordinator routing | `src/pages/AchievementsPage.tsx` (`getEffectiveBadgeType`) |
| Prod SQL mechanics, grant landmines, why the ledger lies | `.claude/skills/prod-operations/SKILL.md` |

---

## 10. Round 3: Assessment, Marking, Teamwork (`20260904160000_assessment_marking_teamwork_badges.sql`)

Same engine, nine more metrics, 21 more badges. Everything in §1 to §9 about how the evaluator, triggers, grants and backfill work applies unchanged. What is new:

| Tab | Badges | Metric | Source |
|---|---|---|---|
| Assessment | Paper Out / Regular Examiner / Publishing Pro (1 / 10 / 25) | `exams_published` | `exams.created_by`, `status IN ('published','active','completed')` |
| Assessment | Question Smith / Bank Builder / Question Vault (10 / 50 / 200) | `questions_authored` | `question_bank.created_by`, `source='manual'` |
| Assessment | AI Co-author (1) | `ai_questions_saved` | `question_bank.created_by`, `source='ai_generated'` |
| Assessment | Template Maker (1), Shared Blueprint (1) | `templates_created`, `templates_shared` | `exam_templates.created_by`, `is_shared` |
| Marking | Results In / Report Ready / Results Veteran (1 / 10 / 25) | `results_published` | `final_results.finalized_by OR published_by`, distinct exam via `student_exam_attempts` |
| Marking | Knows Their Names / Class Mentor / Every Student Seen (5 / 20 / 50) | `students_remarked` | `student_remarks.teacher_id`, distinct `student_id` |
| Teamwork | Stepped In / Reliable Cover / Always There (1 / 5 / 15) | `substitutions_covered` | `tt_substitutions.substitute_teacher_id`, `status IN ('assigned','completed')` |
| Teamwork | Gatekeeper / Fair Reviewer / Leave Steward (1 / 10 / 30) | `leave_reviews_done` | `leave_requests.reviewed_by`, `status IN ('approved','rejected')`, `source='student'` |

**Deliberately excluded**: offline marks (`offline_student_marks`, `offline_section_marks`) and hybrid marks (`hybrid_question_marks`). They belong to the hybrid-and-offline module and were left out of this round on request. `answers_evaluated` still does not count hybrid marking.

### 10a. Extra preconditions (on top of §2)

| # | Check | How |
|---|---|---|
| P6 | Round 1 (20260904150000) is applied | `SELECT 1 FROM badge_definitions WHERE criteria_metric='lessons_planned_ahead';` returns a row |
| P7 | `leave_requests.source` exists (20260903120000) | the leave trigger's WHEN references it |
| P8 | `exam_status` enum is exactly `draft, ready, published, active, completed, archived` | any extra value means the published-status list needs revisiting |

Result set 2 of `scripts/measure-staff-badge-ladders-round2.sql` prints all three.

### 10b. Measure and re-pace

Run `scripts/measure-staff-badge-ladders-round2.sql`. It prints, per metric, how many staff have `>= 1 / 5 / 10 / 25 / 50 / 200` and the max, using the evaluator's exact predicates. Re-pace §1 of the migration by the same rule as §3 above. Watch especially:

- `results_published` and `exams_published` share a shape with `exams_created` (90 teachers had >= 1 exam in August); if their distributions match, keep the ladders parallel so a teacher does not see "25 exams created" as gold and "25 exams published" as gold with a different point value.
- `students_remarked` may be tiny. If fewer than ~10 teachers have any remark, drop the ladder to two rungs (5 / 15) the way `homework_marked` was.
- `substitutions_covered` depends on whether the school uses the substitution engine at all. Max may be single digits; if so, gold at 15 is dead. Bring it down or drop the gold rung.
- `templates_shared` may be zero everywhere. Keep the badge (it is one row) but do not be surprised.

### 10c. Apply

Same rules as §4. Three new indexes are built inside the transaction, one of them on `question_bank` (~99k rows) and two on `final_results` (one row per attempt). Apply outside school hours.

### 10d. Verify

```sql
-- 21 new rows, all active, teacher.
SELECT category, count(*) FROM badge_definitions
WHERE badge_type='teacher' AND is_active
  AND criteria_metric IN ('exams_published','questions_authored','ai_questions_saved',
                          'templates_created','templates_shared','results_published',
                          'students_remarked','substitutions_covered','leave_reviews_done')
GROUP BY category;                        -- assessment 9, marking 6, teamwork 6

-- Evaluator carries all eighteen counters (and still the note-only clause and coordinator guard).
SELECT position('v_leave_reviews' IN d) > 0            AS has_round3,
       position('v_planned' IN d) > 0                  AS has_round2,
       position('lp.session_type = ''teaching''' IN d) > 0 AS has_note_only_patch,
       position('IN (''teacher'', ''coordinator'')' IN d) > 0 AS admits_coordinators
FROM (SELECT pg_get_functiondef('public.evaluate_teacher_badges(uuid, boolean)'::regprocedure) d) x;

-- 9 new triggers.
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname IN (
  'trg_zz_teacher_badges_exam_published','trg_zz_teacher_badges_question_bank',
  'trg_zz_teacher_badges_template','trg_zz_teacher_badges_template_shared',
  'trg_zz_teacher_badges_results','trg_zz_teacher_badges_results_upd',
  'trg_zz_teacher_badges_remark','trg_zz_teacher_badges_substitution',
  'trg_zz_teacher_badges_leave_review');  -- 9 rows

-- 4 new indexes.
SELECT indexname FROM pg_indexes WHERE indexname IN (
  'idx_question_bank_created_by_source','idx_final_results_finalized_by',
  'idx_final_results_published_by','idx_student_remarks_teacher_id');  -- 4 rows

-- Grants: no '=X/' entry in any proacl.
SELECT proname, proacl FROM pg_proc WHERE proname LIKE 'tg_zz_teacher_badges_%' OR proname='evaluate_teacher_badges';
```

### 10e. Smoke test

With both migrations applied and the frontend deployed, a teacher should see **50 badges available** (23 + 6 + 21). Then:

1. Publish a draft exam. Assessment tab: "Paper Out" earned, progress on Regular Examiner moves by one.
2. Add one question manually to the bank. "Question Smith" progress moves by one; add an AI batch and keep it, "AI Co-author" is earned.
3. Save an exam template. "Template Maker" earned. Toggle it shared. "Shared Blueprint" earned.
4. Validate results for an exam. Marking tab: "Results In" earned. Publish the same exam's results: the count does NOT move (distinct exams).
5. Write a remark for a student. "Knows Their Names" reads `1 of 5 students`. A second remark for the same student: unchanged.
6. As admin, assign the teacher as substitute for a period. Teamwork tab: "Stepped In" earned for the substitute, nothing for the absent teacher.
7. As a student, file a leave request; as the teacher, approve it. "Gatekeeper" earned. Mark a leave on a student's behalf from attendance instead: the count does NOT move (source = 'staff').

### 10f. Rollback (round 3 only; §8 still covers round 1)

```sql
BEGIN;
UPDATE badge_definitions SET is_active=false, updated_at=now()
WHERE badge_type='teacher'
  AND criteria_metric IN ('exams_published','questions_authored','ai_questions_saved',
                          'templates_created','templates_shared','results_published',
                          'students_remarked','substitutions_covered','leave_reviews_done');
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_exam_published  ON public.exams;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_question_bank   ON public.question_bank;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_template        ON public.exam_templates;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_template_shared ON public.exam_templates;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_results         ON public.final_results;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_results_upd     ON public.final_results;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_remark          ON public.student_remarks;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_substitution    ON public.tt_substitutions;
DROP TRIGGER IF EXISTS trg_zz_teacher_badges_leave_review    ON public.leave_requests;
DROP FUNCTION IF EXISTS public.tg_zz_teacher_badges_question_bank();
DROP FUNCTION IF EXISTS public.tg_zz_teacher_badges_creator();
DROP FUNCTION IF EXISTS public.tg_zz_teacher_badges_results();
DROP FUNCTION IF EXISTS public.tg_zz_teacher_badges_remark();
DROP FUNCTION IF EXISTS public.tg_zz_teacher_badges_substitution();
DROP FUNCTION IF EXISTS public.tg_zz_teacher_badges_leave_review();
COMMIT;
```
The extra counters left inside the evaluator join to inactive rows and award nothing. Earned badges are kept, as always.

### 10g. Extra files for round 3

| Concern | File |
|---|---|
| `exams` schema + `exam_status` enum | `supabase/migrations/20260104115119_c3121678-...sql` (enum at :9, table at :20+) |
| `question_bank.source` (free text) | `supabase/migrations/20260211070232_8cb519af-...sql:1`; writers in `src/hooks/useQuestionBank.ts`, `src/components/exam/questions/AIGenerateQuestions.tsx` |
| `exam_templates` | `supabase/migrations/20260407120000_exam_creation_flow.sql:63-77` |
| `final_results` (no exam_id; `attempt_id` only) | `supabase/migrations/20260104115902_af62825c-...sql:170-206` |
| `student_remarks` | `supabase/migrations/20260213124509_c9827e76-...sql` |
| `tt_substitutions.status` + CHECK | `supabase/migrations/20260508100000_attendance_phase1_schema.sql:173-206` |
| `leave_requests.source` + `review_student_leave` | `supabase/migrations/20260903120000_teacher_marked_student_leave.sql` |
