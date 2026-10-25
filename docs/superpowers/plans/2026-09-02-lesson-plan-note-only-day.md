# Note-Only Lesson Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a teacher log a period that had no chapter delivery (a surprise test, an activity) with a mandatory free-text note, and have that count as the day being logged everywhere the platform asks "was this logged?".

**Architecture:** One new discriminator column on `tt_lesson_plans` (`is_note_only`), one new SECURITY DEFINER write RPC (`tt_record_period_note`) shared by all three UI surfaces, and an amended "was this day logged?" predicate in the two functions that gate check-out and the SY1 admin flag. Everything else is left alone because existing consumers already filter on `session_type = 'teaching'` or a non-null `topic_id`.

**Tech Stack:** PostgreSQL 15 (Supabase), PostgREST, React 18 + TypeScript, TanStack Query v5, shadcn/ui, Tailwind.

**Spec:** [docs/superpowers/specs/2026-09-02-lesson-plan-note-only-day-design.md](../specs/2026-09-02-lesson-plan-note-only-day-design.md)

## Global Constraints

- **No test runner exists in this repo.** There is no vitest/jest/playwright and no `test` script in `package.json`. DB behaviour is proven with SQL assertion suites run through `scripts/run-sql.ps1` (house pattern: [scripts/verify-student-lockdown.sql](../../../scripts/verify-student-lockdown.sql)). Frontend is verified with typecheck + eslint + build + a scripted manual smoke. Do not invent a test command.
- **Zero-error contract (CLAUDE.md §5a):** `npm run typecheck`, `npx eslint <changed paths>`, `npx vite build` must each exit 0. Never `// eslint-disable`, never `as any`. `prefer-const` and `@typescript-eslint/no-explicit-any` are hard errors.
- **No em-dashes in user-facing text.** Use a comma, a colon, or `·`.
- **Every error toast** goes through `toastError(err, { fallback, context })` from `src/lib/toast.ts`. `toast.success` for success only.
- **New SECURITY DEFINER functions:** `REVOKE ALL ... FROM anon, PUBLIC` **by name**, then `GRANT EXECUTE ... TO authenticated`. Verify in `information_schema.routine_privileges` (CLAUDE.md §11).
- **New RLS predicates** wrap stable per-row calls as `(select auth.uid())` (CLAUDE.md §23.13).
- **Dialogs:** never add `max-h-*`, `flex`, `overflow-*` or `h-full` to `DialogContent`, the inner `<form>`, `DialogHeader` or `DialogFooter` (ui-invariants §1). Padding utilities like `pr-8` are fine.
- **Design tokens:** `text-ink-*` not raw greys; cards `surface-card frosted-shadow rounded-card`; must work at 375px and flip in dark mode.
- **Migration ledger is stale.** Apply SQL to prod via `scripts/run-sql.ps1`, not `supabase db push`. Project ref `gyymkgohcijeksmrzuyw`.
- **Canonical note-only row shape:** `is_note_only = true`, `topic_id NULL`, `chapter_topic_id NULL`, `session_type 'other'`, `status 'done'`, `note` non-empty.

**Branch first.** All work happens on `feat/lesson-plan-note-only`, not `main`.

```bash
git checkout -b feat/lesson-plan-note-only
```

---

### Task 1: Schema — `is_note_only` column, CHECK, index

**Files:**
- Create: `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql`
- Create: `scripts/verify-note-only-day.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: column `public.tt_lesson_plans.is_note_only boolean NOT NULL DEFAULT false`; constraint `tt_lesson_plans_note_only_requires_note`; index `idx_tt_lesson_plans_note_only_group`. Later tasks append to the same migration file and add cells to the same verify script.

- [ ] **Step 1: Write the failing assertion**

Create `scripts/verify-note-only-day.sql`. This first version has no DDL of its own, so it runs against whatever is live and must fail while the column does not exist.

```sql
-- Proves the note-only lesson log behaves correctly under real RLS.
-- Run via scripts/run-sql.ps1. Applies its own DDL inside a transaction and
-- ROLLS BACK, so it can run before the migration exists. Results come back as a
-- table because the Management API discards RAISE NOTICE.
--
-- Cells are appended by later tasks. Keep the numbering stable.
BEGIN;

CREATE TEMP TABLE _no_results(seq int, label text, status text) ON COMMIT DROP;

DO $suite$
DECLARE
  v_fails int := 0;
  r1 text; r2 text;
BEGIN
  -- 1. The column exists and defaults to false.
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tt_lesson_plans'
        AND column_name = 'is_note_only'
        AND data_type = 'boolean' AND is_nullable = 'NO'
        AND column_default = 'false')
    THEN 'ok' ELSE 'FAIL column missing or wrong shape' END INTO r1;

  -- 2. The CHECK rejects is_note_only with a blank note.
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tt_lesson_plans'::regclass
      AND conname = 'tt_lesson_plans_note_only_requires_note')
  THEN 'ok' ELSE 'FAIL constraint missing' END INTO r2;

  INSERT INTO _no_results VALUES
    (1, 'is_note_only column exists, NOT NULL, default false', r1),
    (2, 'note-only rows require a non-empty note (CHECK)',      r2);

  SELECT count(*) INTO v_fails FROM _no_results WHERE status <> 'ok';
  INSERT INTO _no_results VALUES
    (99, 'SUMMARY', CASE WHEN v_fails = 0
                         THEN 'ALL NOTE-ONLY ASSERTIONS PASSED'
                         ELSE v_fails || ' ASSERTION(S) FAILED' END);
  IF v_fails > 0 THEN
    RAISE EXCEPTION '% note-only assertion(s) FAILED', v_fails;
  END IF;
END $suite$;

SELECT seq, label, status FROM _no_results ORDER BY seq;

ROLLBACK;
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day.sql -OutFile "$env:TEMP/no_verify.json"
cat "$env:TEMP/no_verify.json"
```

Expected: HTTP ERROR, body contains `2 note-only assertion(s) FAILED`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql`:

```sql
-- Note-only lesson log: a period that had no chapter delivery (surprise test,
-- class activity) becomes a first-class, resolvable log entry.
--
-- Design: docs/superpowers/specs/2026-09-02-lesson-plan-note-only-day-design.md
--
-- The row shape is is_note_only=true + topic_id NULL + session_type 'other' +
-- status 'done'. The last three already exclude it from every syllabus-coverage
-- filter for free; is_note_only is the unambiguous discriminator for the two
-- "was this day logged?" predicates below, which gate a teacher's check-out.

-- ---------------------------------------------------------------
-- 1. Column, constraint, index
-- ---------------------------------------------------------------
ALTER TABLE public.tt_lesson_plans
  ADD COLUMN IF NOT EXISTS is_note_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.tt_lesson_plans
  DROP CONSTRAINT IF EXISTS tt_lesson_plans_note_only_requires_note;
ALTER TABLE public.tt_lesson_plans
  ADD CONSTRAINT tt_lesson_plans_note_only_requires_note
  CHECK (NOT is_note_only OR btrim(COALESCE(note, '')) <> '');

-- Backs the EXISTS in teacher_pending_syllabus_days / dash_evaluate_syllabus_flags.
-- Partial, so it stays tiny next to the full table.
CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_note_only_group
  ON public.tt_lesson_plans (class_id, subject_id, date)
  WHERE is_note_only;
```

- [ ] **Step 4: Teach the verify script to apply the DDL itself, then re-run**

At the top of the `DO $suite$` block in `scripts/verify-note-only-day.sql`, immediately after `BEGIN`, insert the DDL under test so the suite is self-contained and can run before the migration is applied:

```sql
  -- ---------- apply the DDL under test (rolled back at the end) ----------
  ALTER TABLE public.tt_lesson_plans
    ADD COLUMN IF NOT EXISTS is_note_only boolean NOT NULL DEFAULT false;
  ALTER TABLE public.tt_lesson_plans
    DROP CONSTRAINT IF EXISTS tt_lesson_plans_note_only_requires_note;
  ALTER TABLE public.tt_lesson_plans
    ADD CONSTRAINT tt_lesson_plans_note_only_requires_note
    CHECK (NOT is_note_only OR btrim(COALESCE(note, '')) <> '');
```

Run again:

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day.sql -OutFile "$env:TEMP/no_verify.json"
cat "$env:TEMP/no_verify.json"
```

Expected: HTTP 201, `ALL NOTE-ONLY ASSERTIONS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260902120000_lesson_plan_note_only_day.sql scripts/verify-note-only-day.sql
git commit -m "feat(timetable): is_note_only column for chapterless lesson logs"
```

---

### Task 2: `tt_record_period_note` RPC

**Files:**
- Modify: `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql` (append)
- Modify: `scripts/verify-note-only-day.sql` (append cells 3 to 8)

**Interfaces:**
- Consumes: `is_note_only` from Task 1.
- Produces: `public.tt_record_period_note(p_class_id uuid, p_subject_id uuid, p_date date, p_note text, p_slot_id uuid DEFAULT NULL) RETURNS uuid`. The frontend hook in Task 7 calls it with exactly these argument names.

- [ ] **Step 1: Write the failing assertions**

Append to the `DO $suite$` block in `scripts/verify-note-only-day.sql`, before the `INSERT INTO _no_results` report. Add fixture variables to the `DECLARE` list first:

```sql
  v_inst  uuid := gen_random_uuid();
  v_teach uuid := gen_random_uuid();
  v_cls   uuid := gen_random_uuid();
  v_subj  uuid;
  v_struct uuid := gen_random_uuid();
  v_pslot uuid := gen_random_uuid();
  v_slotA uuid := gen_random_uuid();
  v_slotB uuid := gen_random_uuid();
  v_ay    text := 'ZZ-NOTEONLY';
  v_date  date := date '2026-09-02';   -- a Wednesday
  v_lp    uuid;
  v_cnt   int;
  r3 text; r4 text; r5 text; r6 text; r7 text; r8 text;
```

Fixtures, placed after the DDL block and before the assertions:

```sql
  -- ---------- fixtures ----------
  INSERT INTO public.institutions (id, name, code)
  VALUES (v_inst, 'ZZ NoteOnly Inst', 'ZZNOTE');

  INSERT INTO auth.users (id, email) VALUES (v_teach, 'zz.note.teach@test.invalid');
  UPDATE public.profiles SET institution_id = v_inst, full_name = 'ZZ NoteOnly Teacher'
   WHERE id = v_teach;
  INSERT INTO public.user_roles (user_id, role, institution_id)
  VALUES (v_teach, 'teacher', v_inst);

  SELECT id INTO v_subj FROM public.universal_subjects LIMIT 1;

  INSERT INTO public.cal_academic_years (institution_id, code, starts_on, ends_on, is_active)
  VALUES (v_inst, v_ay, v_date - 60, v_date + 60, true);

  INSERT INTO public.classes (id, institution_id, name, section, academic_year, is_active)
  VALUES (v_cls, v_inst, 'ZZ Class 4', 'C', v_ay, true);

  INSERT INTO public.tt_period_structures (id, institution_id, name, working_days)
  VALUES (v_struct, v_inst, 'ZZ Struct', ARRAY['monday','tuesday','wednesday','thursday','friday']);

  INSERT INTO public.tt_period_slots (id, structure_id, period_number, label, start_time, end_time, kind)
  VALUES (v_pslot, v_struct, 2, 'Period 2', '08:55', '09:30', 'period');

  INSERT INTO public.tt_class_structure (institution_id, class_id, structure_id, academic_year, publish_status)
  VALUES (v_inst, v_cls, v_struct, v_ay, 'published');

  INSERT INTO public.tt_slots (id, institution_id, class_id, period_slot_id, day, academic_year, slot_type, subject_id, teacher_id)
  VALUES (v_slotA, v_inst, v_cls, v_pslot, 'wednesday', v_ay, 'theory', v_subj, v_teach);
```

Assertions (still inside the `DO` block, after `SET LOCAL ROLE authenticated` and the forged claim, which you add here):

```sql
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_teach::text, 'role', 'authenticated')::text, true);

  -- 3. An empty note is rejected.
  BEGIN
    PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, '   ', v_slotA);
    r3 := 'FAIL blank note was accepted';
  EXCEPTION WHEN OTHERS THEN
    r3 := CASE WHEN SQLERRM ILIKE '%note is required%' THEN 'ok'
               ELSE 'FAIL wrong error: ' || SQLERRM END;
  END;

  -- 4. An explicit slot writes the canonical row shape.
  v_lp := public.tt_record_period_note(v_cls, v_subj, v_date, 'Surprise test', v_slotA);
  SELECT CASE WHEN lp.is_note_only AND lp.topic_id IS NULL
                   AND lp.session_type = 'other' AND lp.status = 'done'
                   AND lp.note = 'Surprise test' AND lp.owner_teacher_id = v_teach
              THEN 'ok'
              ELSE 'FAIL shape: note_only=' || lp.is_note_only || ' st=' || lp.session_type
                   || ' status=' || lp.status END
    INTO r4 FROM public.tt_lesson_plans lp WHERE lp.id = v_lp;

  -- 5. Idempotent: calling again updates in place, never duplicates.
  PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, 'Surprise test v2', v_slotA);
  SELECT count(*) INTO v_cnt FROM public.tt_lesson_plans
   WHERE slot_id = v_slotA AND date = v_date;
  SELECT CASE WHEN v_cnt = 1 AND (SELECT note FROM public.tt_lesson_plans WHERE id = v_lp) = 'Surprise test v2'
              THEN 'ok' ELSE 'FAIL rows=' || v_cnt END INTO r5;

  -- 6. Server-side slot resolution (no p_slot_id) finds the teacher's slot.
  DELETE FROM public.tt_lesson_plans WHERE slot_id = v_slotA AND date = v_date;
  v_lp := public.tt_record_period_note(v_cls, v_subj, v_date, 'Assembly ran over', NULL);
  SELECT CASE WHEN lp.slot_id = v_slotA AND lp.is_note_only THEN 'ok'
              ELSE 'FAIL resolved slot=' || coalesce(lp.slot_id::text,'null') END
    INTO r6 FROM public.tt_lesson_plans lp WHERE lp.id = v_lp;

  -- 7. A mismatched (slot, class) pair is refused.
  BEGIN
    PERFORM public.tt_record_period_note(gen_random_uuid(), v_subj, v_date, 'x', v_slotA);
    r7 := 'FAIL mismatched class accepted';
  EXCEPTION WHEN OTHERS THEN r7 := 'ok';
  END;

  -- 8. anon cannot execute it.
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' AND routine_name = 'tt_record_period_note'
      AND grantee = 'anon')
  THEN 'ok' ELSE 'FAIL anon holds EXECUTE' END INTO r8;
```

Add the rows to the report insert:

```sql
    (3, 'blank note is rejected',                          r3),
    (4, 'explicit slot writes the canonical row shape',    r4),
    (5, 'second call updates in place (idempotent)',       r5),
    (6, 'server resolves the slot when none is given',     r6),
    (7, 'mismatched class/slot pair is refused',           r7),
    (8, 'anon has no EXECUTE on tt_record_period_note',    r8),
```

- [ ] **Step 2: Run to verify cells 3 to 8 fail**

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day.sql -OutFile "$env:TEMP/no_verify.json"
cat "$env:TEMP/no_verify.json"
```

Expected: HTTP ERROR, `6 note-only assertion(s) FAILED` (function does not exist).

- [ ] **Step 3: Write the RPC**

Append to `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql`:

```sql
-- ---------------------------------------------------------------
-- 2. tt_record_period_note — the single write path for note-only logs.
--    Used by the Lesson Plan dialog (explicit p_slot_id) and by the
--    check-out gate / check-in backlog sheet (group-scoped, server resolves
--    the slot). One RPC, one transaction, idempotent on (slot_id, date).
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_record_period_note(
  p_class_id   uuid,
  p_subject_id uuid,
  p_date       date,
  p_note       text,
  p_slot_id    uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_inst  uuid;
  v_ay    text;
  v_note  text := btrim(COALESCE(p_note, ''));
  v_slot  uuid;
  v_owner uuid;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_note = '' THEN RAISE EXCEPTION 'A note is required.'; END IF;
  IF length(v_note) > 2000 THEN
    RAISE EXCEPTION 'That note is too long. Keep it under 2000 characters.';
  END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_uid;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'no institution context'; END IF;

  SELECT ay.code INTO v_ay FROM public.cal_academic_years ay
   WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
  IF v_ay IS NULL THEN RAISE EXCEPTION 'no active academic year'; END IF;

  IF p_slot_id IS NOT NULL THEN
    -- Dialog path: the caller already knows the period. Verify both that the
    -- slot really belongs to this (class, subject) pair and that the caller may
    -- write it, so a crafted payload cannot log against someone else's class.
    SELECT s.id, s.teacher_id INTO v_slot, v_owner
      FROM public.tt_slots s
     WHERE s.id = p_slot_id
       AND s.class_id = p_class_id
       AND s.subject_id IS NOT DISTINCT FROM p_subject_id
       AND (s.teacher_id = v_uid OR public.tt_user_can_edit_class_slots(v_uid, s.class_id));
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'That period does not match this class, or you cannot edit it.';
    END IF;
  ELSE
    -- Gate path: only the (class, subject, date) group is known. Prefer a period
    -- with nothing logged, then one already note-only; never overwrite a chapter.
    SELECT s.id, s.teacher_id INTO v_slot, v_owner
      FROM public.tt_slots s
      LEFT JOIN public.tt_lesson_plans lp
             ON lp.slot_id = s.id AND lp.date = p_date
     WHERE s.class_id = p_class_id
       AND s.subject_id IS NOT DISTINCT FROM p_subject_id
       AND s.academic_year = v_ay
       AND s.slot_type IN ('theory','practical')
       AND s.day = public.tt_dow_to_text(p_date)
       AND s.teacher_id = v_uid
     ORDER BY (lp.id IS NULL) DESC, lp.is_note_only DESC NULLS LAST, s.id
     LIMIT 1;
    IF v_slot IS NULL THEN
      RAISE EXCEPTION 'You have no period for this class on that day.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.tt_lesson_plans lp
       WHERE lp.slot_id = v_slot AND lp.date = p_date
         AND NOT lp.is_note_only AND lp.topic_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Every period for this class today already has a lesson logged.';
    END IF;
  END IF;

  INSERT INTO public.tt_lesson_plans (
    institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
    session_type, status, topic_id, chapter_topic_id, note, is_note_only,
    created_by, updated_by
  ) VALUES (
    v_inst, v_slot, p_class_id, p_subject_id, COALESCE(v_owner, v_uid), p_date,
    'other', 'done', NULL, NULL, v_note, true,
    v_uid, v_uid
  )
  ON CONFLICT (slot_id, date) DO UPDATE SET
    session_type     = 'other',
    status           = 'done',
    topic_id         = NULL,
    chapter_topic_id = NULL,
    note             = EXCLUDED.note,
    is_note_only     = true,
    updated_by       = EXCLUDED.updated_by,
    updated_at       = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new
-- public function, and REVOKE FROM PUBLIC does not strip it (CLAUDE.md §11).
REVOKE ALL ON FUNCTION public.tt_record_period_note(uuid, uuid, date, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tt_record_period_note(uuid, uuid, date, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.tt_record_period_note(uuid, uuid, date, text, uuid) TO authenticated;
```

- [ ] **Step 4: Mirror the RPC into the verify script and re-run**

The suite applies its own DDL so it can run pre-migration. Copy the entire `CREATE OR REPLACE FUNCTION public.tt_record_period_note ... $$;` block plus the three grant lines into the suite's DDL section (immediately after the `ALTER TABLE` statements added in Task 1, Step 4).

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day.sql -OutFile "$env:TEMP/no_verify.json"
cat "$env:TEMP/no_verify.json"
```

Expected: HTTP 201, `ALL NOTE-ONLY ASSERTIONS PASSED`, 8 cells green.

Note on cell 8: inside the suite the grants are applied by the suite itself, so cell 8 is only meaningful in the live re-verify in Task 6. It must still be green here.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260902120000_lesson_plan_note_only_day.sql scripts/verify-note-only-day.sql
git commit -m "feat(timetable): tt_record_period_note RPC for chapterless period logs"
```

---

### Task 3: The shared "was this day logged?" predicate

This is the heart of the feature. Both functions must change identically.

**Files:**
- Modify: `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql` (append)
- Modify: `scripts/verify-note-only-day.sql` (append cells 9 to 11)
- Reference: [supabase/migrations/20260704150000_pending_syllabus_days_skip_chapterless.sql](../../../supabase/migrations/20260704150000_pending_syllabus_days_skip_chapterless.sql), [supabase/migrations/20260706160000_sy1_review_fixes.sql](../../../supabase/migrations/20260706160000_sy1_review_fixes.sql)

**Interfaces:**
- Consumes: `is_note_only` (Task 1), `tt_record_period_note` (Task 2).
- Produces: `teacher_pending_syllabus_days(boolean)` and `dash_evaluate_syllabus_flags(uuid)` with unchanged signatures and unchanged return shapes. No frontend type changes.

- [ ] **Step 1: Write the failing assertions**

Add to `DECLARE`: `r9 text; r10 text; r11 text; v_pending jsonb;`

Add these cells after cell 8:

```sql
  -- 9. THE CRITICAL ONE: a note-only row resolves the day, so the teacher is
  --    no longer trapped at check-out.
  DELETE FROM public.tt_lesson_plans WHERE slot_id = v_slotA AND date = v_date;
  PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, 'Surprise test', v_slotA);
  SELECT public.teacher_pending_syllabus_days(true) INTO v_pending;
  SELECT CASE WHEN NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_pending->'days') d
            WHERE (d->>'date')::date = v_date)
         THEN 'ok'
         ELSE 'FAIL day still listed as unlogged' END INTO r9;

  -- 10. REGRESSION GUARD: a plain lesson plan WITHOUT the flag must NOT resolve
  --     the day. Without this, any saved plan would silently satisfy the gate.
  DELETE FROM public.tt_lesson_plans WHERE slot_id = v_slotA AND date = v_date;
  INSERT INTO public.tt_lesson_plans
    (institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
     session_type, status, note, is_note_only)
  VALUES (v_inst, v_slotA, v_cls, v_subj, v_teach, v_date,
          'other', 'done', 'not flagged', false);
  SELECT public.teacher_pending_syllabus_days(true) INTO v_pending;
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_pending->'days') d
            WHERE (d->>'date')::date = v_date)
         THEN 'ok'
         ELSE 'FAIL unflagged row wrongly resolved the day' END INTO r10;

  -- 11. The two predicates agree: dash_evaluate_syllabus_flags uses the same
  --     rule, so a teacher resolved in the UI is not still flagged for admins.
  --     Compared structurally, since the flag needs >3 days to fire.
  SELECT CASE WHEN (
    SELECT count(*) FROM pg_get_functiondef('public.dash_evaluate_syllabus_flags(uuid)'::regprocedure) f
     WHERE f LIKE '%is_note_only%') = 1
  THEN 'ok' ELSE 'FAIL SY1 flag predicate was not updated in lockstep' END INTO r11;
```

Report rows:

```sql
    (9,  'note-only row RESOLVES the day (unblocks check-out)', r9),
    (10, 'a lesson plan WITHOUT the flag does not resolve it',  r10),
    (11, 'SY1 flag predicate updated in lockstep',              r11),
```

- [ ] **Step 2: Run to verify cells 9 and 11 fail**

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day.sql -OutFile "$env:TEMP/no_verify.json"
cat "$env:TEMP/no_verify.json"
```

Expected: HTTP ERROR, `2 note-only assertion(s) FAILED` (cells 9 and 11; cell 10 passes already because nothing resolves the day yet).

- [ ] **Step 3: Amend both functions**

Append to the migration. Copy the **entire** `CREATE OR REPLACE FUNCTION public.teacher_pending_syllabus_days` body verbatim from [20260704150000_pending_syllabus_days_skip_chapterless.sql:9-123](../../../supabase/migrations/20260704150000_pending_syllabus_days_skip_chapterless.sql#L9-L123), then replace exactly the `grps` CTE.

Before:

```sql
  grps AS (
    SELECT o.*,
           EXISTS (
             SELECT 1 FROM public.syllabus_progress_events e
             WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d
           ) AS filled
    FROM occ o
  ),
```

After:

```sql
  grps AS (
    SELECT o.*,
           (
             EXISTS (
               SELECT 1 FROM public.syllabus_progress_events e
               WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d
             )
             -- A chapterless period (surprise test, activity) logged as a note
             -- resolves the group too. Without this the teacher cannot check
             -- out and the only escape is to falsify a chapter completion.
             -- KEEP IN LOCKSTEP with dash_evaluate_syllabus_flags below.
             OR EXISTS (
               SELECT 1 FROM public.tt_lesson_plans lp
               WHERE lp.class_id = o.class_id AND lp.subject_id = o.subject_id
                 AND lp.date = o.d AND lp.is_note_only
             )
           ) AS filled
    FROM occ o
  ),
```

Then copy the **entire** `CREATE OR REPLACE FUNCTION public.dash_evaluate_syllabus_flags` body verbatim from [20260706160000_sy1_review_fixes.sql:14-83](../../../supabase/migrations/20260706160000_sy1_review_fixes.sql#L14-L83) and replace exactly the `unfilled` CTE.

Before:

```sql
  unfilled AS (
    SELECT o.teacher_id, o.d FROM occ o
    WHERE NOT EXISTS (SELECT 1 FROM syllabus_progress_events e
      WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d)
  )
```

After:

```sql
  unfilled AS (
    SELECT o.teacher_id, o.d FROM occ o
    WHERE NOT EXISTS (SELECT 1 FROM syllabus_progress_events e
      WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d)
      -- KEEP IN LOCKSTEP with teacher_pending_syllabus_days above: a teacher who
      -- resolved a day in the UI must not still be SY1-flagged for admins.
      AND NOT EXISTS (SELECT 1 FROM tt_lesson_plans lp
        WHERE lp.class_id = o.class_id AND lp.subject_id = o.subject_id
          AND lp.date = o.d AND lp.is_note_only)
  )
```

- [ ] **Step 4: Mirror both into the verify script and re-run**

Copy both amended `CREATE OR REPLACE FUNCTION` blocks into the suite's DDL section.

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day.sql -OutFile "$env:TEMP/no_verify.json"
cat "$env:TEMP/no_verify.json"
```

Expected: HTTP 201, `ALL NOTE-ONLY ASSERTIONS PASSED`, 11 cells green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260902120000_lesson_plan_note_only_day.sql scripts/verify-note-only-day.sql
git commit -m "feat(syllabus): a note-only period resolves the day for check-out and SY1"
```

---

### Task 4: Stop `record_syllabus_progress` clobbering note-only rows

**Files:**
- Modify: `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql` (append)
- Modify: `scripts/verify-note-only-day.sql` (append cell 12)
- Reference: [supabase/migrations/20260704141000_syllabus_progress_rpcs.sql:211-301](../../../supabase/migrations/20260704141000_syllabus_progress_rpcs.sql#L211-L301)

**Interfaces:**
- Consumes: `is_note_only` (Task 1).
- Produces: `record_syllabus_progress(uuid, uuid, uuid, date, text, text)` with unchanged signature and behaviour, except that it never targets a note-only row.

- [ ] **Step 1: Write the failing assertion**

Add to `DECLARE`: `r12 text; v_topic uuid;`

Add a second slot to the fixtures (same class, subject, weekday) so the dual-write has somewhere else to land:

```sql
  INSERT INTO public.tt_period_slots (id, structure_id, period_number, label, start_time, end_time, kind)
  VALUES (gen_random_uuid(), v_struct, 4, 'Period 4', '10:05', '10:40', 'period');

  INSERT INTO public.tt_slots (id, institution_id, class_id, period_slot_id, day, academic_year, slot_type, subject_id, teacher_id)
  SELECT v_slotB, v_inst, v_cls, ps.id, 'wednesday', v_ay, 'theory', v_subj, v_teach
    FROM public.tt_period_slots ps WHERE ps.structure_id = v_struct AND ps.period_number = 4;
```

Cell:

```sql
  -- 12. A note-only row survives a later chapter completion on the same
  --     class+subject+date: the dual-write must land on the OTHER slot, not
  --     rewrite the teacher's note into a chapter-tagged teaching row.
  DELETE FROM public.tt_lesson_plans WHERE date = v_date;
  PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, 'Surprise test', v_slotA);
  SELECT st.id INTO v_topic FROM public.syllabus_topics st
   WHERE st.subject_id = v_subj AND st.is_active LIMIT 1;
  IF v_topic IS NULL THEN
    r12 := 'ok (skipped: subject has no chapters)';
  ELSE
    PERFORM public.record_syllabus_progress(v_cls, v_subj, v_topic, v_date, 'completed', 'checkout');
    SELECT CASE WHEN lp.is_note_only AND lp.session_type = 'other' AND lp.topic_id IS NULL
                THEN 'ok'
                ELSE 'FAIL note-only row was clobbered: st=' || lp.session_type
                     || ' topic=' || coalesce(lp.topic_id::text,'null') END
      INTO r12 FROM public.tt_lesson_plans lp WHERE lp.slot_id = v_slotA AND lp.date = v_date;
  END IF;
```

Report row:

```sql
    (12, 'note-only row survives a later chapter completion', r12),
```

- [ ] **Step 2: Run to verify cell 12 fails**

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day.sql -OutFile "$env:TEMP/no_verify.json"
cat "$env:TEMP/no_verify.json"
```

Expected: HTTP ERROR, cell 12 reads `FAIL note-only row was clobbered`.

If the chosen `universal_subjects` row happens to have no active chapters the cell self-skips; pick a subject that does have chapters instead, by changing the fixture to `SELECT st.subject_id FROM public.syllabus_topics st WHERE st.is_active LIMIT 1`.

- [ ] **Step 3: Amend the function**

Append to the migration. Copy the **entire** `CREATE OR REPLACE FUNCTION public.record_syllabus_progress` body verbatim from [20260704141000_syllabus_progress_rpcs.sql:211-301](../../../supabase/migrations/20260704141000_syllabus_progress_rpcs.sql#L211-L301), then make exactly two changes.

Change 1, the slot picker's guard. Before:

```sql
      AND NOT EXISTS (SELECT 1 FROM tt_lesson_plans lp
                      WHERE lp.slot_id = s.id AND lp.date = p_date AND lp.status = 'done')
```

After:

```sql
      -- Skip note-only periods too. They are already 'done', but pin it
      -- explicitly: a chapter completion must never overwrite a teacher's
      -- record of a surprise test on the same day.
      AND NOT EXISTS (SELECT 1 FROM tt_lesson_plans lp
                      WHERE lp.slot_id = s.id AND lp.date = p_date
                        AND (lp.status = 'done' OR lp.is_note_only))
```

Change 2, the `ON CONFLICT` clause. Before:

```sql
          DO UPDATE SET status = 'done', session_type = 'teaching',
                        topic_id = EXCLUDED.topic_id, updated_by = EXCLUDED.updated_by, updated_at = now();
```

After:

```sql
          DO UPDATE SET status = 'done', session_type = 'teaching',
                        topic_id = EXCLUDED.topic_id, is_note_only = false,
                        updated_by = EXCLUDED.updated_by, updated_at = now();
```

- [ ] **Step 4: Mirror into the verify script and re-run**

Copy the amended block into the suite's DDL section.

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day.sql -OutFile "$env:TEMP/no_verify.json"
cat "$env:TEMP/no_verify.json"
```

Expected: HTTP 201, 12 cells green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260902120000_lesson_plan_note_only_day.sql scripts/verify-note-only-day.sql
git commit -m "fix(syllabus): chapter completion no longer overwrites a note-only period"
```

---

### Task 5: Badge metric, export label, student policy

**Files:**
- Modify: `supabase/migrations/20260902120000_lesson_plan_note_only_day.sql` (append)
- Modify: `scripts/verify-note-only-day.sql` (append cells 13 to 15)
- Reference: [supabase/migrations/20260818120000_teacher_badges.sql:185-225](../../../supabase/migrations/20260818120000_teacher_badges.sql#L185-L225), [supabase/migrations/20260623130000_tt_lesson_plan_export.sql:148-190](../../../supabase/migrations/20260623130000_tt_lesson_plan_export.sql#L148-L190), [supabase/migrations/20260424100000_tt_cal_phase1_schema.sql:680-694](../../../supabase/migrations/20260424100000_tt_cal_phase1_schema.sql#L680-L694)

**Interfaces:**
- Consumes: `is_note_only` (Task 1).
- Produces: no signature changes. `tt_lesson_plan_export`'s `delivery_log[].chapter` may now be the literal `'No chapter (activity logged)'`, which `src/lib/lessonPlanExport.ts:129` already renders as a plain string.

- [ ] **Step 1: Write the failing assertions**

Add to `DECLARE`: `r13 text; r14 text; r15 text; v_stu uuid := gen_random_uuid(); v_rows int;`

Add a student to the fixtures (before the role switch):

```sql
  INSERT INTO auth.users (id, email) VALUES (v_stu, 'zz.note.stu@test.invalid');
  UPDATE public.profiles SET institution_id = v_inst, full_name = 'ZZ NoteOnly Student'
   WHERE id = v_stu;
  INSERT INTO public.user_roles (user_id, role, institution_id)
  VALUES (v_stu, 'student', v_inst);
  INSERT INTO public.class_assignments (user_id, class_id, role, institution_id)
  VALUES (v_stu, v_cls, 'student', v_inst);
```

Cells:

```sql
  -- 13. A note-only row must not credit the lessons-taught badge ladder.
  SELECT CASE WHEN pg_get_functiondef('public.evaluate_teacher_badges(uuid, boolean)'::regprocedure)
                     LIKE '%session_type = ''teaching''%'
              THEN 'ok' ELSE 'FAIL badge metric still counts note-only rows' END INTO r13;

  -- 14. The export names the gap rather than leaving the chapter cell blank.
  SELECT CASE WHEN pg_get_functiondef('public.tt_lesson_plan_export(text,uuid,uuid,uuid,uuid,uuid)'::regprocedure)
                     LIKE '%No chapter (activity logged)%'
              THEN 'ok' ELSE 'FAIL export does not label note-only rows' END INTO r14;

  -- 15. THE LEAK TEST: a student must not be able to read a note-only row.
  --     Chapter-mode rows stay readable (pre-existing, out of scope), so this
  --     also proves the policy was narrowed rather than simply broken.
  DELETE FROM public.tt_lesson_plans WHERE date = v_date;
  PERFORM public.tt_record_period_note(v_cls, v_subj, v_date, 'Pop quiz tomorrow', v_slotA);
  INSERT INTO public.tt_lesson_plans
    (institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
     session_type, status, note, is_note_only)
  VALUES (v_inst, v_slotB, v_cls, v_subj, v_teach, v_date,
          'teaching', 'done', 'normal lesson note', false);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stu::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_rows FROM public.tt_lesson_plans
   WHERE date = v_date AND is_note_only;
  SELECT CASE WHEN v_rows = 0
              AND (SELECT count(*) FROM public.tt_lesson_plans
                    WHERE date = v_date AND NOT is_note_only) = 1
              THEN 'ok'
              ELSE 'FAIL student saw ' || v_rows || ' note-only row(s)' END INTO r15;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_teach::text, 'role', 'authenticated')::text, true);
```

Report rows:

```sql
    (13, 'note-only rows do not credit the lessons-taught badge', r13),
    (14, 'export labels the chapter cell for note-only rows',     r14),
    (15, 'a STUDENT cannot read a note-only row (leak test)',     r15),
```

- [ ] **Step 2: Run to verify cells 13 to 15 fail**

Expected: HTTP ERROR, 3 failures.

- [ ] **Step 3: Make the three changes**

Append to the migration.

**(a) Badge metric.** Copy the entire `CREATE OR REPLACE FUNCTION public.evaluate_teacher_badges` body from [20260818120000_teacher_badges.sql:185](../../../supabase/migrations/20260818120000_teacher_badges.sql#L185) and change the lessons metric.

Before:

```sql
  SELECT count(*)::int INTO v_lessons
  FROM tt_lesson_plans lp
  WHERE lp.owner_teacher_id = _user_id AND lp.status = 'done';
```

After:

```sql
  -- 'Lessons taught' means chapter delivery. A logged surprise test is real
  -- work but it is not a lesson, so it must not inflate the ladder.
  SELECT count(*)::int INTO v_lessons
  FROM tt_lesson_plans lp
  WHERE lp.owner_teacher_id = _user_id AND lp.status = 'done'
    AND lp.session_type = 'teaching';
```

**(b) Export label.** Copy the entire `CREATE OR REPLACE FUNCTION public.tt_lesson_plan_export` body from [20260623130000_tt_lesson_plan_export.sql:65-270](../../../supabase/migrations/20260623130000_tt_lesson_plan_export.sql#L65-L270) and make two edits.

In the `rows` CTE, after `lp.note AS teacher_note,` add:

```sql
      lp.is_note_only AS is_note_only,
```

In the `jsonb_build_object`, replace `'chapter', chapter,` with:

```sql
    'chapter', COALESCE(chapter,
                        CASE WHEN is_note_only THEN 'No chapter (activity logged)' END),
```

**(c) Student policy.** Append:

```sql
-- ---------------------------------------------------------------
-- Student read policy: notes are staff-private.
-- RLS cannot restrict columns, so a student in a published class could read
-- tt_lesson_plans.note over raw PostgREST. No student code path does, but a
-- note-only row is exactly the kind that must not leak ("pop quiz tomorrow").
-- Narrow to teaching rows. (select auth.uid()) per CLAUDE.md §23.13.
-- Residual, tracked separately: chapter-mode notes remain readable.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS tt_lesson_plans_select_student_published ON public.tt_lesson_plans;
CREATE POLICY tt_lesson_plans_select_student_published
  ON public.tt_lesson_plans FOR SELECT
  USING (
    public.has_role((select auth.uid()), 'student')
    AND status IN ('planned','done')
    AND session_type = 'teaching'
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

- [ ] **Step 4: Mirror into the verify script and re-run**

Copy all three blocks into the suite's DDL section.

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day.sql -OutFile "$env:TEMP/no_verify.json"
cat "$env:TEMP/no_verify.json"
```

Expected: HTTP 201, 15 cells green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260902120000_lesson_plan_note_only_day.sql scripts/verify-note-only-day.sql
git commit -m "feat(timetable): badge, export and student-policy handling for note-only rows"
```

---

### Task 6: Apply to prod, re-verify live, regenerate types

**Files:**
- Create: `scripts/verify-note-only-day-live.sql`
- Modify: `src/integrations/supabase/types.ts` (generated)

**Interfaces:**
- Consumes: the complete migration from Tasks 1 to 5.
- Produces: live DB objects and a regenerated `types.ts` carrying `is_note_only: boolean` on the `tt_lesson_plans` Row/Insert/Update types and the `tt_record_period_note` function signature. Task 7 depends on both.

- [ ] **Step 1: Build the live (no-DDL) variant**

Copy `scripts/verify-note-only-day.sql` to `scripts/verify-note-only-day-live.sql` and delete the entire DDL section from its `DO` block, so it exercises the objects that are actually live rather than ones it wrote itself. Keep every fixture and every cell. Keep the `ROLLBACK`.

- [ ] **Step 2: Run the live variant to confirm it fails**

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day-live.sql -OutFile "$env:TEMP/no_live.json"
cat "$env:TEMP/no_live.json"
```

Expected: HTTP ERROR. Nothing is applied yet, so the live objects are the old ones.

- [ ] **Step 3: Apply the migration to prod**

```bash
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260902120000_lesson_plan_note_only_day.sql -OutFile "$env:TEMP/no_apply.json"
cat "$env:TEMP/no_apply.json"
```

Expected: HTTP 201. If it errors, read the body, fix the migration, and re-run. The file is written to be idempotent (`IF NOT EXISTS`, `DROP ... IF EXISTS`, `CREATE OR REPLACE`), so re-running is safe.

- [ ] **Step 4: Re-run the live variant, now green**

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day-live.sql -OutFile "$env:TEMP/no_live.json"
cat "$env:TEMP/no_live.json"
```

Expected: HTTP 201, `ALL NOTE-ONLY ASSERTIONS PASSED`, 15 cells green. Cell 8 (anon has no EXECUTE) is only meaningful here; confirm it is `ok`.

- [ ] **Step 5: Regenerate types**

```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
npm run typecheck
```

Expected: typecheck exits 0. Confirm the new column landed:

```bash
grep -n "is_note_only" src/integrations/supabase/types.ts | head
```

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-note-only-day-live.sql src/integrations/supabase/types.ts
git commit -m "chore(db): apply note-only migration to prod and regenerate types"
```

---

### Task 7: Hook layer

**Files:**
- Modify: `src/hooks/useTimetableV2.ts:1201-1305` and `:1348-1373`

**Interfaces:**
- Consumes: `tt_record_period_note` and the regenerated types (Task 6).
- Produces:
  - `LessonPlanRow` gains `is_note_only: boolean`.
  - `UpsertLessonPlanInput` gains `is_note_only?: boolean`.
  - `useRecordPeriodNote(): UseMutationResult<string, Error, { classId: string; subjectId: string | null; date: string; note: string; slotId?: string | null }>`.
  Tasks 8 and 10 consume all three.

- [ ] **Step 1: Extend the row and input types**

In `LessonPlanRow` (after `topic_id`):

```ts
  /** True when the teacher logged this period with a note instead of a chapter. */
  is_note_only: boolean;
```

In `UpsertLessonPlanInput` (after `topic_id`):

```ts
  /** Chapter-mode saves must pass false explicitly to convert a note-only row back. */
  is_note_only?: boolean;
```

- [ ] **Step 2: Add the column to both select lists**

`useLessonPlanForDate` (line ~1240) and `useTeacherPlansForWeek` (line ~1362). Both currently read:

```ts
        .select("id, slot_id, date, status, note, owner_teacher_id, subject_id, class_id, topic_id")
```

Change both to:

```ts
        .select("id, slot_id, date, status, note, owner_teacher_id, subject_id, class_id, topic_id, is_note_only")
```

Without this the dialog reopens a saved note-only row in chapter mode and the week chip cannot tell the two apart.

- [ ] **Step 3: Write the flag on the upsert and fix the stale invalidation**

In `useUpsertLessonPlan`'s payload, after `topic_id: input.topic_id ?? null,`:

```ts
            is_note_only: input.is_note_only ?? false,
```

In its `onSuccess`, after the `teacher-plans-week` line:

```ts
      // A save can flip a day from unlogged to logged, so the backlog badge and
      // the check-out gate must refetch. This was missing before note-only.
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-syllabus-days"] });
```

- [ ] **Step 4: Add the note write hook**

Insert after `useUpsertLessonPlan`:

```ts
export interface RecordPeriodNoteInput {
  classId: string;
  subjectId: string | null;
  date: string;
  note: string;
  /** Explicit period when the caller knows it (the dialog). Omit to let the
   *  server resolve one from class + subject + weekday (the check-out gate). */
  slotId?: string | null;
}

/**
 * Log a period that had no chapter delivery. One SECURITY DEFINER RPC shared by
 * the lesson-plan dialog and the check-out / check-in sheets, so slot
 * resolution and the row shape live in one place.
 */
export function useRecordPeriodNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordPeriodNoteInput): Promise<string> => {
      const { data, error } = await supabase.rpc("tt_record_period_note", {
        p_class_id: input.classId,
        p_subject_id: input.subjectId,
        p_date: input.date,
        p_note: input.note,
        p_slot_id: input.slotId ?? null,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      toast.success("Note saved");
      queryClient.invalidateQueries({ queryKey: ["timetable-v2"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-syllabus-days"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-progress-state"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save the note.", context: "recordPeriodNote" }),
  });
}
```

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npx eslint src/hooks/useTimetableV2.ts
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useTimetableV2.ts
git commit -m "feat(timetable): useRecordPeriodNote hook and is_note_only plumbing"
```

---

### Task 8: The toggle in the Lesson Plan dialog

**Files:**
- Modify: `src/components/timetable-v2/LessonPlanDialogV2.tsx`

**Interfaces:**
- Consumes: `useRecordPeriodNote`, `LessonPlanRow.is_note_only` (Task 7).
- Produces: no exports change.

- [ ] **Step 1: Add imports and state**

Add to the imports:

```ts
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useRecordPeriodNote } from "@/hooks/useTimetableV2";
```

(`useRecordPeriodNote` joins the existing `@/hooks/useTimetableV2` import block rather than a second import statement.)

Add state next to the others:

```ts
  const [noteOnly, setNoteOnly] = useState(false);
```

and the mutation next to `upsert`:

```ts
  const recordNote = useRecordPeriodNote();
```

- [ ] **Step 2: Reset and hydrate the toggle**

In the reset effect (`[open, initialDate, slot.day, slot.id]`), add:

```ts
    setNoteOnly(false);
```

In the hydration effect (`[open, date, existing.data]`), change the two branches to:

```ts
    if (existing.data) {
      setNote(existing.data.note ?? "");
      setTopicId(existing.data.topic_id ?? null);
      setNoteOnly(existing.data.is_note_only);
    } else {
      setNote("");
      setTopicId(null);
      setNoteOnly(false);
    }
```

- [ ] **Step 3: Flipping the toggle clears chapter-mode staging**

Add next to the other handlers:

```ts
  function handleNoteOnlyChange(next: boolean) {
    setNoteOnly(next);
    if (!next) return;
    // Chapter-mode staging is meaningless in note-only mode, and a leftover
    // new-chapter name would create an orphan syllabus_topics row on save.
    setCreatingChapter(false);
    setNewChapterName("");
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
```

- [ ] **Step 4: Replace the save gate**

Replace lines 207-214 with:

```ts
  const isSubmitting =
    upsert.isPending || addChapter.isPending || uploadMaterial.isPending || recordNote.isPending;
  // Chapter is mandatory in the normal path: the syllabus tab is organised by
  // chapter and the upload needs one to park files under. Note-only mode swaps
  // that requirement for a mandatory note, so a period with no chapter delivery
  // (surprise test, activity) is still a logged period.
  const hasChapter =
    topicId !== null || (creatingChapter && newChapterName.trim().length > 0);
  const canSave =
    !isSubmitting && !!institutionId && (noteOnly ? note.trim().length > 0 : hasChapter);

  // Turning the toggle on over a saved chapter clears it: UNIQUE (slot_id, date)
  // means one row per period. Name what will go before the teacher commits.
  const replacedChapterName = noteOnly && existing.data?.topic_id
    ? ((chapters.data ?? []).find((c) => c.id === existing.data?.topic_id)?.topicName ?? "the saved chapter")
    : null;
```

- [ ] **Step 5: Branch the save**

At the top of `handleSave`, before `let resolvedTopicId = topicId;`:

```ts
    if (noteOnly) {
      await recordNote.mutateAsync({
        classId: classIdFallback,
        subjectId: subjectIdFallback,
        date,
        note: note.trim(),
        slotId: slot.id,
      });
      onOpenChange(false);
      return;
    }
```

And in the existing `upsert.mutateAsync` call, add the explicit mode so toggling off converts the row back:

```ts
      topic_id: resolvedTopicId,
      session_type: "teaching",
      is_note_only: false,
```

- [ ] **Step 6: Put the toggle in the header**

Replace the `DialogHeader` block with:

```tsx
        {/* pr-8 reserves room for DialogContent's absolute close X (right-4),
            which would otherwise sit on top of the switch. Same mitigation as
            AssignTeacherClassSubjectDialog. */}
        <DialogHeader className="pr-8">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Lesson plan</DialogTitle>
            <div className="flex items-center gap-2 shrink-0">
              <Label
                htmlFor="lesson-note-only"
                className="text-xs font-medium text-ink-600 cursor-pointer whitespace-nowrap"
              >
                Note only
              </Label>
              <Switch
                id="lesson-note-only"
                checked={noteOnly}
                onCheckedChange={handleNoteOnlyChange}
              />
            </div>
          </div>
          <DialogDescription>
            {classLabel} · {subjectLabel} · {slot.period_label}
            {" "}({slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)})
          </DialogDescription>
        </DialogHeader>
```

- [ ] **Step 7: Hide the chapter-mode blocks**

Wrap three existing blocks so they render only in chapter mode.

Change the syllabus block's condition from `{subjectId && (isPastDate ? (` to:

```tsx
          {!noteOnly && subjectId && (isPastDate ? (
```

Wrap the entire "Select chapter" `<div className="space-y-2">` (currently lines ~355-434) and the entire "Upload study material" `<div className="space-y-2">` (currently ~436-486) each in `{!noteOnly && ( ... )}`.

- [ ] **Step 8: Promote the note field**

Replace the notes block with:

```tsx
          <div className="space-y-2">
            <label className="text-sm font-medium">
              {noteOnly ? (
                <>What happened this period <span className="text-destructive">*</span></>
              ) : (
                "Notes (optional)"
              )}
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={noteOnly ? 4 : 3}
              placeholder={
                noteOnly
                  ? "Surprise test on Chapter 4, class activity, assembly ran over..."
                  : "Topic, objective, carry-forward items, homework..."
              }
            />
            {noteOnly && (
              <p className="text-xs text-ink-500">
                This period will count as logged. No chapter is recorded, so it does not
                move syllabus coverage.
              </p>
            )}
            {replacedChapterName && (
              <Alert className="bg-amber-50 border-amber-200 text-amber-900">
                <AlertDescription className="text-xs">
                  Saving will clear the chapter currently logged here:{" "}
                  <span className="font-medium">{replacedChapterName}</span>. Any study
                  material you uploaded stays in the syllabus.
                </AlertDescription>
              </Alert>
            )}
          </div>
```

- [ ] **Step 9: Name the destructive save**

Change the Save button's label:

```tsx
          <Button onClick={handleSave} disabled={!canSave}>
            {isSubmitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {replacedChapterName ? "Replace chapter entry" : "Save"}
          </Button>
```

- [ ] **Step 10: Verify**

```bash
npm run typecheck && npx eslint src/components/timetable-v2/LessonPlanDialogV2.tsx
```

Expected: both exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/components/timetable-v2/LessonPlanDialogV2.tsx
git commit -m "feat(timetable): note-only toggle on the lesson plan dialog"
```

---

### Task 9: Period chip on the teacher week

**Files:**
- Modify: `src/pages/teacher/TeacherMyWeekPageV2.tsx`

**Interfaces:**
- Consumes: `LessonPlanRow.is_note_only` (Task 7).
- Produces: nothing other tasks use.

- [ ] **Step 1: Import the icon**

Add `NotebookPen` to the existing `lucide-react` import.

- [ ] **Step 2: Branch the chip before the status lookup**

In `PeriodChip`, replace:

```tsx
  const visual = plan ? STATUS_VISUAL[plan.status] : null;
  const Icon = visual?.icon ?? Inbox;
```

with:

```tsx
  // A note-only period is neither "Planned" nor "Done": it is a logged period
  // with no chapter. Branch before the status lookup so it reads honestly.
  const isNoteOnly = plan?.is_note_only ?? false;
  const visual = plan && !isNoteOnly ? STATUS_VISUAL[plan.status] : null;
  const Icon = isNoteOnly ? NotebookPen : (visual?.icon ?? Inbox);
  const badgeClass = isNoteOnly
    ? "bg-violet-50 text-violet-700 border-violet-200"
    : (visual ? visual.badge : "bg-slate-50 text-slate-500 border-slate-200");
  const badgeLabel = isNoteOnly ? "Logged" : (visual ? visual.label : "Empty");
```

- [ ] **Step 3: Use them in the badge**

Replace the badge's `className` and children:

```tsx
        <Badge
          variant="outline"
          className={cn("gap-1 text-[10px] py-0 h-5 font-medium", badgeClass)}
        >
          <Icon className="h-2.5 w-2.5" />
          {badgeLabel}
        </Badge>
```

- [ ] **Step 4: Show the note instead of a projected chapter**

Replace the `line` render with:

```tsx
      {(isNoteOnly ? plan?.note : line) && (
        <div
          className={cn(
            "text-[10px] truncate",
            isNoteOnly ? "text-violet-700" : "text-teal-700",
          )}
          title={isNoteOnly ? (plan?.note ?? undefined) : (line ?? undefined)}
        >
          {isNoteOnly ? plan?.note : line}
        </div>
      )}
```

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npx eslint src/pages/teacher/TeacherMyWeekPageV2.tsx
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/pages/teacher/TeacherMyWeekPageV2.tsx
git commit -m "feat(timetable): note-only periods read as Logged on the week chips"
```

---

### Task 10: The escape at check-out and in the backlog sheet

This is where the trap actually bites: a teacher who ran a surprise test cannot press Check out.

**Files:**
- Modify: `src/components/lesson-completion/SyllabusProgressGroup.tsx`
- Modify: `src/components/lesson-completion/CheckOutLessonGate.tsx:71-79`
- Modify: `src/components/lesson-completion/CheckInBacklogSheet.tsx:50-58`

**Interfaces:**
- Consumes: `useRecordPeriodNote` (Task 7); `PendingGroup.filled` from `useSyllabusProgress`.
- Produces: `SyllabusProgressGroup` gains two optional props, `allowNoteOnly?: boolean` and `serverFilled?: boolean`. Existing call sites keep working unchanged.

- [ ] **Step 1: Extend the props**

```tsx
export function SyllabusProgressGroup({
  classId, subjectId, className, subjectName, date, source, allowDelete,
  allowNoteOnly, serverFilled,
}: {
  classId: string; subjectId: string; className: string; subjectName: string;
  date: string; source: "checkout" | "checkin" | "correction"; allowDelete?: boolean;
  /** Offer "something else happened" so a chapterless day is not a dead end.
   *  Set by the check-out gate and the backlog sheet, NOT by the lesson-plan
   *  dialog, which already has its own note-only toggle in the header. */
  allowNoteOnly?: boolean;
  /** The RPC's own view of whether this group is resolved. A note-only entry
   *  fills the group without producing a chapter row, so the local
   *  savedToday check alone would keep showing it as outstanding. */
  serverFilled?: boolean;
}) {
```

- [ ] **Step 2: Fold the server view into the badge**

Add the hook and state near the others:

```tsx
  const recordNote = useRecordPeriodNote();
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
```

Change:

```tsx
  const filled = savedToday.length > 0;
```

to:

```tsx
  const filled = savedToday.length > 0 || !!serverFilled;
```

Add the imports:

```tsx
import { Textarea } from "@/components/ui/textarea";
import { useRecordPeriodNote } from "@/hooks/useTimetableV2";
```

and add `NotebookPen` to the `lucide-react` import.

- [ ] **Step 3: Add the escape**

Insert just before the closing `</form>`:

```tsx
        {allowNoteOnly && !filled && (
          noteOpen ? (
            <div className="space-y-2 rounded-lg border border-surface-stroke p-2.5">
              <p className="text-xs font-medium text-ink-900">
                What happened this period?
              </p>
              <Textarea
                autoFocus
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Surprise test, class activity, assembly ran over..."
              />
              <p className="text-xs text-ink-500">
                This counts as logged. No chapter is recorded.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button" size="sm"
                  disabled={!noteText.trim() || recordNote.isPending}
                  onClick={async () => {
                    await recordNote.mutateAsync({
                      classId, subjectId, date, note: noteText.trim(),
                    });
                    setNoteOpen(false);
                    setNoteText("");
                  }}
                  className="bg-brand-primary text-white hover:bg-brand-primary/90"
                >
                  {recordNote.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                  Save note
                </Button>
                <Button
                  type="button" size="sm" variant="ghost"
                  disabled={recordNote.isPending}
                  onClick={() => { setNoteOpen(false); setNoteText(""); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button" variant="ghost" size="sm"
              className="h-7 px-1 text-xs text-ink-500 hover:text-ink-900"
              onClick={() => setNoteOpen(true)}
            >
              <NotebookPen className="h-3.5 w-3.5 mr-1" />
              Something else happened this period?
            </Button>
          )
        )}
```

- [ ] **Step 4: Wire both call sites**

In `CheckOutLessonGate.tsx`, add two props to the mapped `SyllabusProgressGroup`:

```tsx
              source="checkout"
              allowNoteOnly
              serverFilled={g.filled}
```

In `CheckInBacklogSheet.tsx`:

```tsx
                  source="checkin"
                  allowNoteOnly
                  serverFilled={g.filled}
```

Leave the `LessonPlanDialogV2` mount alone: it must not gain a second route to the same outcome.

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npx eslint src/components/lesson-completion/
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/lesson-completion/
git commit -m "feat(syllabus): note escape at check-out and in the backlog sheet"
```

---

### Task 11: Full verification and documentation

**Files:**
- Modify: `.claude/skills/timetable-module/SKILL.md`
- Modify: `.claude/CLAUDE.md`

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

- [ ] **Step 1: Run the whole zero-error contract**

```bash
npm run typecheck
npx eslint src/hooks/useTimetableV2.ts src/components/timetable-v2/LessonPlanDialogV2.tsx src/pages/teacher/TeacherMyWeekPageV2.tsx src/components/lesson-completion/
npx vite build
```

Expected: all three exit 0. Bundle-size warnings over 500 kB are not failures.

- [ ] **Step 2: Re-run the live DB suite**

```bash
powershell -File scripts/run-sql.ps1 -SqlFile scripts/verify-note-only-day-live.sql -OutFile "$env:TEMP/no_live.json"
cat "$env:TEMP/no_live.json"
```

Expected: 15 cells green.

- [ ] **Step 3: Manual smoke (no runner exists for this, so it is scripted here)**

`npm run dev`, sign in as a teacher at Alliance, go to `/teacher/my-week`.

1. Tap a period for today. The header shows a "Note only" switch clear of the close X.
2. Flip it on: the auto-timeline, chapter picker and upload all disappear; the note label becomes "What happened this period *"; Save is disabled while the note is empty.
3. Type a note, Save. The chip reads "Logged" in violet with the note text under it.
4. The `x / y` badge increments. If a "days unlogged" chip was showing, it decrements.
5. Reopen the same period: the toggle is on and the note is populated.
6. Toggle off: Save disables until a chapter is picked. Pick one, note the amber alert naming the chapter is absent (there is no saved chapter yet in this direction), Save. Reopen: chapter mode.
7. Toggle on again over that saved chapter: the amber alert names it and the button reads "Replace chapter entry".
8. Shrink to 375px: no horizontal scroll, the switch does not collide with the X.
9. Toggle dark mode: the violet badge, the alert and the switch all flip.
10. Check out from the attendance card on a day with an unlogged group: the group shows "Something else happened this period?", saving a note flips the group to Filled and enables Check out.

- [ ] **Step 4: Update the module skill**

In `.claude/skills/timetable-module/SKILL.md` §5, after the `tt_lesson_plans` column list, add:

```markdown
**Note-only periods (2026-09-02).** `is_note_only BOOLEAN NOT NULL DEFAULT false` marks a
period logged with a free-text note instead of a chapter (surprise test, activity). Row
shape: `is_note_only=true`, `topic_id NULL`, `session_type 'other'`, `status 'done'`,
non-empty `note` (CHECK-enforced). Written ONLY by `tt_record_period_note` (SECURITY
DEFINER, resolves the slot when the caller has only class+subject+date).

**The predicate that must stay in lockstep:** a day counts as logged when a
`syllabus_progress_events` row exists for (class, subject, date) **OR** a note-only
`tt_lesson_plans` row does. That `OR` lives in BOTH `teacher_pending_syllabus_days` and
`dash_evaluate_syllabus_flags`. If they diverge, a teacher who resolved a day in the UI is
still SY1-flagged for admins. `record_syllabus_progress` skips note-only slots so a later
chapter completion never overwrites the note. Never branch on `session_type = 'other'`
alone: `is_note_only` is the discriminator.

Students cannot read note-only rows: `tt_lesson_plans_select_student_published` is
narrowed to `session_type = 'teaching'`.
```

In `.claude/CLAUDE.md` §11, add one bullet under the timetable entries:

```markdown
* **Note-only lesson logs** (`timetable-module` skill §5) — a chapterless period is logged via `tt_record_period_note` with `is_note_only=true`. The "was this day logged?" OR-predicate is duplicated in `teacher_pending_syllabus_days` and `dash_evaluate_syllabus_flags` and MUST stay identical.
```

- [ ] **Step 5: Commit and open the PR**

```bash
git add .claude/
git commit -m "docs: note-only lesson log invariants"
git push -u origin feat/lesson-plan-note-only
gh pr create --title "Note-only lesson log for chapterless periods" --body "$(cat <<'EOF'
## Summary
A teacher who ran a surprise test had nowhere to record it, and worse, could not check out: the check-out gate demands a chapter progress event per class+subject taught that day, and `syllabus_progress_events.topic_id` is NOT NULL so a chapterless day can never produce one. They also accrued an SY1 "syllabus logging is behind" flag with no way to satisfy it.

This adds a "Note only" toggle to the Lesson Plan dialog and the same escape at check-out and in the backlog sheet, and makes such a day count as logged.

## Changes
- `tt_lesson_plans.is_note_only` + CHECK + partial index
- `tt_record_period_note` RPC, the single write path for all three surfaces
- The "was this day logged?" predicate now accepts a note-only row, in **both** `teacher_pending_syllabus_days` and `dash_evaluate_syllabus_flags`
- `record_syllabus_progress` no longer overwrites a note-only row
- Note-only rows excluded from the lessons-taught badge ladder; labelled in the coordinator export
- Student read policy narrowed to `session_type = 'teaching'` so notes stay staff-private

## Verification
`scripts/verify-note-only-day-live.sql`, 15 assertions under real RLS, all green against prod. typecheck / eslint / vite build all exit 0.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage.** Walked every spec section against a task:

| Spec section | Task |
|---|---|
| §3 data model | 1 |
| §4.1 RPC + grants | 2 |
| §4.2 hook plumbing + missing invalidation | 7 |
| §5.1 clobber guard | 4 |
| §5.2 both predicates | 3 |
| §5.3 badge metric | 5 |
| §5.4 export label | 5 |
| §6.1 toggle placement | 8 steps 6 |
| §6.2 hide blocks, promote note, clobber confirm | 8 steps 3,4,7,8,9 |
| §6.3 week chip | 9 |
| §6.4 gate + backlog | 10 |
| §7a student policy | 5 |
| §8 apply + typegen | 6 |
| §10 test plan | verify suite (cells 1-15) + Task 11 step 3 manual script |

No gaps.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". The two places that say "copy the entire function body from <file>:<lines>" name the exact source lines and give the exact before/after snippet, because those functions are 90 to 200 lines of unrelated logic that must not be retyped from memory.

**Type consistency.** `is_note_only` (snake_case, DB and `LessonPlanRow`) vs `slotId`/`classId`/`subjectId` (camelCase, `RecordPeriodNoteInput`) is deliberate and matches the existing split in this file. `useRecordPeriodNote` is imported from `@/hooks/useTimetableV2` in Tasks 8 and 10, matching where Task 7 defines it. `serverFilled` and `allowNoteOnly` are named identically in Task 10 steps 1 and 4. The RPC's parameter names `p_class_id / p_subject_id / p_date / p_note / p_slot_id` match between Task 2 step 3 and Task 7 step 4.
