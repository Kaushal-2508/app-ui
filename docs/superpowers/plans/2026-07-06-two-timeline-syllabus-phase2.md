# Two-Timeline Syllabus — Phase 2 (The Projection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The auto-generated timeline — remaining chapters spread live across remaining periods (spec §4.3/§4.4/§7/§8): projected chapter on every teacher My Week period card and student timetable cell, teacher editing (change-chapter = sequence hint, reorder sheet, past-day corrections with delete), "Auto wins" by construction (nothing stored, recomputed on read).

**Architecture:** One migration: RLS `(select auth.uid())` wrapper on the Phase-1 tables (the deferred finding — REQUIRED before this phase's direct client `syllabus_sequence` writes) + three RPCs (`teacher_projection_for_range`, `class_projection_for_range`, `delete_syllabus_progress`). Frontend: projection/reorder/delete hooks in `useSyllabusProgress.ts`, corrections mode in `SyllabusProgressGroup`, a `ChapterReorderSheet`, a Syllabus section in `LessonPlanDialogV2`, chapter lines on `TeacherMyWeekPageV2` PeriodChips, and a `chapterOverlay` prop on `TimetableGridV2` wired from `StudentWeekPageV2`.

## Global Constraints (binding — same as Phase 1)

- §5a: `npm run typecheck` + `npx eslint <changed>` + `npx vite build` all clean per task. No `any`, `prefer-const`, `toastError` for all errors, explicit `staleTime: 60_000` on every new useQuery, no `select("*")` (the one direct table write — sequence upsert — uses explicit columns), no JWT-less `getUser`.
- §24: all "today" math inside RPCs via `institutions.timezone`; the client never computes teaching dates — it passes ISO strings from page state and keys off RPC-returned dates.
- RPC bounds: range clamped to ≤ 62 days; internal expansion today→AY-end is the algorithm's denominator (bounded by AY; ~200 rows/teacher, ~2k rows/class — measured cost class of the Phase-1 pending RPC).
- Projection ordering contract: remaining chapters ordered `has_partial DESC, position ASC, topic_name`; periods ordered `date, period start_time, slot_id`; blocks allocated `base = ⌊P/R⌋`, first `P mod R` chapters get `+1`; `P<R` ⇒ first P chapters get 1, rest unscheduled (overflow).
- Branch: continue on `feat/two-timeline-syllabus`.

---

## Task 1: Migration E — RLS wrapper + 3 RPCs (controller, prod-apply)

**Files:** Create `supabase/migrations/20260706120000_syllabus_projection_phase2.sql`

**Interfaces produced:**
- `teacher_projection_for_range(p_from date, p_to date) → jsonb` `{ projected:[{date,slot_id,class_id,subject_id,topic_id,topic_name,chapter_ord}], actual:[{date,class_id,subject_id,topic_id,topic_name,action}], overflow:[{class_id,subject_id,unscheduled}] }`
- `class_projection_for_range(p_class_id uuid, p_from date, p_to date) → jsonb` `{ projected:[same row shape] }` (students: own published class only)
- `delete_syllabus_progress(p_class_id,p_subject_id,p_topic_id,p_date) → jsonb` `{ deleted, lesson_plan_reverted }`

- [ ] **Step 1: Write the migration** — four parts, exactly:

```sql
-- 20260706120000_syllabus_projection_phase2.sql
-- Phase 2 (spec §4.3/§4.4 + §7 corrections + deferred RLS finding):
--  A. Re-create the four Phase-1 policies with (select auth.uid()) so the
--     per-row helper calls are initplan-cached — REQUIRED before this phase
--     introduces direct client writes to syllabus_sequence (enterprise rule 7).
--  B. teacher_projection_for_range — projected chapters per period + actual
--     events for the teacher's groups in a window, plus per-group overflow.
--  C. class_projection_for_range — same projection for ONE class (student grid).
--  D. delete_syllabus_progress — corrections: remove an event and best-effort
--     revert its dual-written done lesson-plan row to 'planned'.

-- ---------------------------------------------------------------------------
-- A. RLS (select auth.uid()) wrapper — semantics identical to Phase 1.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members read syllabus progress" ON public.syllabus_progress_events;
CREATE POLICY "Members read syllabus progress" ON public.syllabus_progress_events
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution((select auth.uid())));

DROP POLICY IF EXISTS "Members read syllabus sequence" ON public.syllabus_sequence;
CREATE POLICY "Members read syllabus sequence" ON public.syllabus_sequence
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution((select auth.uid())));

DROP POLICY IF EXISTS "Staff write syllabus progress" ON public.syllabus_progress_events;
CREATE POLICY "Staff write syllabus progress" ON public.syllabus_progress_events
  FOR ALL TO authenticated
  USING (
    institution_id = public.get_user_institution((select auth.uid()))
    AND (
      public.tt_user_can_edit_class_slots((select auth.uid()), class_id)
      OR EXISTS (SELECT 1 FROM public.class_assignments ca
                 WHERE ca.user_id = (select auth.uid()) AND ca.role = 'teacher'
                   AND ca.class_id = syllabus_progress_events.class_id)
      OR EXISTS (SELECT 1 FROM public.tt_slots s
                 WHERE s.teacher_id = (select auth.uid())
                   AND s.class_id = syllabus_progress_events.class_id
                   AND s.subject_id = syllabus_progress_events.subject_id)
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution((select auth.uid()))
    AND (
      public.tt_user_can_edit_class_slots((select auth.uid()), class_id)
      OR EXISTS (SELECT 1 FROM public.class_assignments ca
                 WHERE ca.user_id = (select auth.uid()) AND ca.role = 'teacher'
                   AND ca.class_id = syllabus_progress_events.class_id)
      OR EXISTS (SELECT 1 FROM public.tt_slots s
                 WHERE s.teacher_id = (select auth.uid())
                   AND s.class_id = syllabus_progress_events.class_id
                   AND s.subject_id = syllabus_progress_events.subject_id)
    )
  );

DROP POLICY IF EXISTS "Staff write syllabus sequence" ON public.syllabus_sequence;
CREATE POLICY "Staff write syllabus sequence" ON public.syllabus_sequence
  FOR ALL TO authenticated
  USING (
    institution_id = public.get_user_institution((select auth.uid()))
    AND (
      public.tt_user_can_edit_class_slots((select auth.uid()), class_id)
      OR EXISTS (SELECT 1 FROM public.class_assignments ca
                 WHERE ca.user_id = (select auth.uid()) AND ca.role = 'teacher'
                   AND ca.class_id = syllabus_sequence.class_id)
      OR EXISTS (SELECT 1 FROM public.tt_slots s
                 WHERE s.teacher_id = (select auth.uid())
                   AND s.class_id = syllabus_sequence.class_id
                   AND s.subject_id = syllabus_sequence.subject_id)
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution((select auth.uid()))
    AND (
      public.tt_user_can_edit_class_slots((select auth.uid()), class_id)
      OR EXISTS (SELECT 1 FROM public.class_assignments ca
                 WHERE ca.user_id = (select auth.uid()) AND ca.role = 'teacher'
                   AND ca.class_id = syllabus_sequence.class_id)
      OR EXISTS (SELECT 1 FROM public.tt_slots s
                 WHERE s.teacher_id = (select auth.uid())
                   AND s.class_id = syllabus_sequence.class_id
                   AND s.subject_id = syllabus_sequence.subject_id)
    )
  );

-- ---------------------------------------------------------------------------
-- B. teacher_projection_for_range — the "auto" timeline, computed on read.
-- Denominator = ALL remaining periods today→AY-end; output sliced to window.
-- KEEP THE CORE CTEs IN SYNC with class_projection_for_range below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_projection_for_range(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_inst   uuid;
  v_tz     text;
  v_today  date;
  v_ay     text;
  v_ay_end date;
  v_to     date;
  v_result jsonb;
  v_empty  jsonb := jsonb_build_object('projected','[]'::jsonb,'actual','[]'::jsonb,'overflow','[]'::jsonb);
BEGIN
  IF v_uid IS NULL THEN RETURN v_empty; END IF;
  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_uid;
  IF v_inst IS NULL THEN RETURN v_empty; END IF;
  SELECT COALESCE(i.timezone,'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT ay.code, ay.ends_on INTO v_ay, v_ay_end
  FROM public.cal_academic_years ay
  WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
  IF v_ay IS NULL THEN RETURN v_empty; END IF;
  v_to := LEAST(p_to, p_from + 62, v_ay_end);
  IF p_from > v_to THEN RETURN v_empty; END IF;

  WITH grp AS (
    SELECT DISTINCT s.class_id, s.subject_id
    FROM public.tt_slots s
    WHERE s.teacher_id = v_uid AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical') AND s.subject_id IS NOT NULL
  ),
  dd AS (SELECT d::date AS d FROM generate_series(v_today, v_ay_end, interval '1 day') g(d)),
  periods AS (
    SELECT s.class_id, s.subject_id, s.id AS slot_id, dd.d,
           row_number() OVER (PARTITION BY s.class_id, s.subject_id
                              ORDER BY dd.d, psl.start_time, s.id) AS rn
    FROM public.tt_slots s
    JOIN grp g ON g.class_id = s.class_id AND g.subject_id = s.subject_id
    JOIN public.tt_class_structure cs ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    JOIN public.tt_period_structures ps ON ps.id = cs.structure_id
    JOIN public.tt_period_slots psl ON psl.id = s.period_slot_id
    JOIN dd ON public.tt_dow_to_text(dd.d) = s.day
           AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE s.teacher_id = v_uid AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical') AND s.subject_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.cal_events ce
        WHERE ce.institution_id = v_inst AND ce.academic_year = v_ay
          AND ce.kind IN ('holiday','exam_block') AND dd.d BETWEEN ce.starts_on AND ce.ends_on)
  ),
  ptot AS (SELECT class_id, subject_id, count(*)::int AS total_p FROM periods GROUP BY 1,2),
  chapter_set AS (
    SELECT DISTINCT g.class_id, g.subject_id, st.id AS topic_id, st.topic_name,
           st.chapter_number, st.display_order
    FROM grp g
    JOIN public.classes c ON c.id = g.class_id
    JOIN LATERAL (
      SELECT st1.id, st1.topic_name, st1.chapter_number, st1.display_order
      FROM public.topic_class_mappings tcm
      JOIN public.syllabus_topics st1 ON st1.id = tcm.topic_id
      WHERE c.class_group_id IS NOT NULL AND tcm.class_group_id = c.class_group_id
        AND st1.subject_id = g.subject_id AND st1.is_active = true
      UNION ALL
      SELECT st2.id, st2.topic_name, st2.chapter_number, st2.display_order
      FROM public.syllabus_topics st2
      WHERE st2.subject_id = g.subject_id AND st2.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM public.topic_class_mappings tcm3
          JOIN public.syllabus_topics st3 ON st3.id = tcm3.topic_id
          WHERE c.class_group_id IS NOT NULL AND tcm3.class_group_id = c.class_group_id
            AND st3.subject_id = g.subject_id AND st3.is_active = true)
    ) st ON true
  ),
  remaining AS (
    SELECT cs2.*,
      EXISTS (SELECT 1 FROM public.syllabus_progress_events e
              WHERE e.class_id = cs2.class_id AND e.subject_id = cs2.subject_id
                AND e.topic_id = cs2.topic_id AND e.action = 'partial') AS has_partial,
      COALESCE(sq.position,
        10000 + (row_number() OVER (PARTITION BY cs2.class_id, cs2.subject_id
                 ORDER BY cs2.display_order NULLS LAST, cs2.chapter_number NULLS LAST, cs2.topic_name))::int) AS pos
    FROM chapter_set cs2
    LEFT JOIN public.syllabus_sequence sq
      ON sq.class_id = cs2.class_id AND sq.subject_id = cs2.subject_id AND sq.topic_id = cs2.topic_id
    WHERE NOT EXISTS (SELECT 1 FROM public.syllabus_progress_events e
      WHERE e.class_id = cs2.class_id AND e.subject_id = cs2.subject_id
        AND e.topic_id = cs2.topic_id AND e.action = 'completed')
  ),
  ordered AS (
    SELECT r.*,
      row_number() OVER (PARTITION BY class_id, subject_id ORDER BY has_partial DESC, pos, topic_name) AS ord,
      count(*) OVER (PARTITION BY class_id, subject_id)::int AS total_r
    FROM remaining r
  ),
  alloc AS (
    SELECT o.*, pt.total_p,
      (pt.total_p / o.total_r) + CASE WHEN o.ord <= (pt.total_p % o.total_r) THEN 1 ELSE 0 END AS cnt
    FROM ordered o
    JOIN ptot pt ON pt.class_id = o.class_id AND pt.subject_id = o.subject_id
  ),
  blocks AS (
    SELECT a.*, SUM(a.cnt) OVER (PARTITION BY class_id, subject_id ORDER BY ord) AS cum_end
    FROM alloc a
  ),
  proj AS (
    SELECT p.d, p.slot_id, p.class_id, p.subject_id, b.topic_id, b.topic_name, b.ord AS chapter_ord
    FROM periods p
    JOIN blocks b ON b.class_id = p.class_id AND b.subject_id = p.subject_id
      AND p.rn > (b.cum_end - b.cnt) AND p.rn <= b.cum_end
    WHERE p.d BETWEEN GREATEST(p_from, v_today) AND v_to
  ),
  act AS (
    SELECT e.date AS d, e.class_id, e.subject_id, e.topic_id, st.topic_name, e.action
    FROM public.syllabus_progress_events e
    JOIN grp g ON g.class_id = e.class_id AND g.subject_id = e.subject_id
    JOIN public.syllabus_topics st ON st.id = e.topic_id
    WHERE e.date BETWEEN p_from AND v_to
  ),
  ovf AS (SELECT class_id, subject_id, count(*)::int AS unscheduled FROM blocks WHERE cnt = 0 GROUP BY 1,2)
  SELECT jsonb_build_object(
    'projected', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d,'YYYY-MM-DD'), 'slot_id', slot_id, 'class_id', class_id,
        'subject_id', subject_id, 'topic_id', topic_id, 'topic_name', topic_name,
        'chapter_ord', chapter_ord) ORDER BY d) FROM proj), '[]'::jsonb),
    'actual', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d,'YYYY-MM-DD'), 'class_id', class_id, 'subject_id', subject_id,
        'topic_id', topic_id, 'topic_name', topic_name, 'action', action) ORDER BY d) FROM act), '[]'::jsonb),
    'overflow', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'class_id', class_id, 'subject_id', subject_id, 'unscheduled', unscheduled)) FROM ovf), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_projection_for_range(date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.teacher_projection_for_range(date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- C. class_projection_for_range — one class, all subjects (student grid).
-- Same core as B with grp := the class's subject groups; students must be
-- enrolled in the class and the timetable published.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.class_projection_for_range(p_class_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_inst   uuid;
  v_tz     text;
  v_today  date;
  v_ay     text;
  v_ay_end date;
  v_to     date;
  v_result jsonb;
  v_empty  jsonb := jsonb_build_object('projected','[]'::jsonb);
BEGIN
  IF v_uid IS NULL THEN RETURN v_empty; END IF;
  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL OR v_inst IS DISTINCT FROM public.get_user_institution(v_uid) THEN RETURN v_empty; END IF;
  -- Students: only their own class, and only when the timetable is published.
  IF public.has_role(v_uid, 'student') THEN
    IF NOT EXISTS (SELECT 1 FROM public.class_assignments ca
                   WHERE ca.user_id = v_uid AND ca.role = 'student' AND ca.class_id = p_class_id) THEN
      RETURN v_empty;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.tt_class_structure cs
                   WHERE cs.class_id = p_class_id AND cs.publish_status = 'published') THEN
      RETURN v_empty;
    END IF;
  END IF;
  SELECT COALESCE(i.timezone,'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT ay.code, ay.ends_on INTO v_ay, v_ay_end
  FROM public.cal_academic_years ay
  WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
  IF v_ay IS NULL THEN RETURN v_empty; END IF;
  v_to := LEAST(p_to, p_from + 62, v_ay_end);
  IF p_from > v_to THEN RETURN v_empty; END IF;

  WITH grp AS (
    SELECT DISTINCT s.class_id, s.subject_id
    FROM public.tt_slots s
    WHERE s.class_id = p_class_id AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical') AND s.subject_id IS NOT NULL
  ),
  dd AS (SELECT d::date AS d FROM generate_series(v_today, v_ay_end, interval '1 day') g(d)),
  periods AS (
    SELECT s.class_id, s.subject_id, s.id AS slot_id, dd.d,
           row_number() OVER (PARTITION BY s.class_id, s.subject_id
                              ORDER BY dd.d, psl.start_time, s.id) AS rn
    FROM public.tt_slots s
    JOIN grp g ON g.class_id = s.class_id AND g.subject_id = s.subject_id
    JOIN public.tt_class_structure cs ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    JOIN public.tt_period_structures ps ON ps.id = cs.structure_id
    JOIN public.tt_period_slots psl ON psl.id = s.period_slot_id
    JOIN dd ON public.tt_dow_to_text(dd.d) = s.day
           AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE s.class_id = p_class_id AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical') AND s.subject_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.cal_events ce
        WHERE ce.institution_id = v_inst AND ce.academic_year = v_ay
          AND ce.kind IN ('holiday','exam_block') AND dd.d BETWEEN ce.starts_on AND ce.ends_on)
  ),
  ptot AS (SELECT class_id, subject_id, count(*)::int AS total_p FROM periods GROUP BY 1,2),
  chapter_set AS (
    SELECT DISTINCT g.class_id, g.subject_id, st.id AS topic_id, st.topic_name,
           st.chapter_number, st.display_order
    FROM grp g
    JOIN public.classes c ON c.id = g.class_id
    JOIN LATERAL (
      SELECT st1.id, st1.topic_name, st1.chapter_number, st1.display_order
      FROM public.topic_class_mappings tcm
      JOIN public.syllabus_topics st1 ON st1.id = tcm.topic_id
      WHERE c.class_group_id IS NOT NULL AND tcm.class_group_id = c.class_group_id
        AND st1.subject_id = g.subject_id AND st1.is_active = true
      UNION ALL
      SELECT st2.id, st2.topic_name, st2.chapter_number, st2.display_order
      FROM public.syllabus_topics st2
      WHERE st2.subject_id = g.subject_id AND st2.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM public.topic_class_mappings tcm3
          JOIN public.syllabus_topics st3 ON st3.id = tcm3.topic_id
          WHERE c.class_group_id IS NOT NULL AND tcm3.class_group_id = c.class_group_id
            AND st3.subject_id = g.subject_id AND st3.is_active = true)
    ) st ON true
  ),
  remaining AS (
    SELECT cs2.*,
      EXISTS (SELECT 1 FROM public.syllabus_progress_events e
              WHERE e.class_id = cs2.class_id AND e.subject_id = cs2.subject_id
                AND e.topic_id = cs2.topic_id AND e.action = 'partial') AS has_partial,
      COALESCE(sq.position,
        10000 + (row_number() OVER (PARTITION BY cs2.class_id, cs2.subject_id
                 ORDER BY cs2.display_order NULLS LAST, cs2.chapter_number NULLS LAST, cs2.topic_name))::int) AS pos
    FROM chapter_set cs2
    LEFT JOIN public.syllabus_sequence sq
      ON sq.class_id = cs2.class_id AND sq.subject_id = cs2.subject_id AND sq.topic_id = cs2.topic_id
    WHERE NOT EXISTS (SELECT 1 FROM public.syllabus_progress_events e
      WHERE e.class_id = cs2.class_id AND e.subject_id = cs2.subject_id
        AND e.topic_id = cs2.topic_id AND e.action = 'completed')
  ),
  ordered AS (
    SELECT r.*,
      row_number() OVER (PARTITION BY class_id, subject_id ORDER BY has_partial DESC, pos, topic_name) AS ord,
      count(*) OVER (PARTITION BY class_id, subject_id)::int AS total_r
    FROM remaining r
  ),
  alloc AS (
    SELECT o.*, pt.total_p,
      (pt.total_p / o.total_r) + CASE WHEN o.ord <= (pt.total_p % o.total_r) THEN 1 ELSE 0 END AS cnt
    FROM ordered o
    JOIN ptot pt ON pt.class_id = o.class_id AND pt.subject_id = o.subject_id
  ),
  blocks AS (
    SELECT a.*, SUM(a.cnt) OVER (PARTITION BY class_id, subject_id ORDER BY ord) AS cum_end
    FROM alloc a
  ),
  proj AS (
    SELECT p.d, p.slot_id, p.class_id, p.subject_id, b.topic_id, b.topic_name, b.ord AS chapter_ord
    FROM periods p
    JOIN blocks b ON b.class_id = p.class_id AND b.subject_id = p.subject_id
      AND p.rn > (b.cum_end - b.cnt) AND p.rn <= b.cum_end
    WHERE p.d BETWEEN GREATEST(p_from, v_today) AND v_to
  )
  SELECT jsonb_build_object(
    'projected', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(d,'YYYY-MM-DD'), 'slot_id', slot_id, 'class_id', class_id,
        'subject_id', subject_id, 'topic_id', topic_id, 'topic_name', topic_name,
        'chapter_ord', chapter_ord) ORDER BY d) FROM proj), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.class_projection_for_range(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.class_projection_for_range(uuid, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- D. delete_syllabus_progress — corrections. Removes one jar event and, if it
-- had dual-written a done lesson-plan row for the same chapter+date, reverts
-- that row to 'planned' so coverage doesn't overcount (best-effort).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_syllabus_progress(
  p_class_id uuid, p_subject_id uuid, p_topic_id uuid, p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_inst    uuid;
  v_deleted int  := 0;
  v_revert  boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'You must be signed in.'; END IF;
  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'Class not found.'; END IF;
  IF v_inst IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'You are not allowed to edit syllabus progress for this class.';
  END IF;
  IF NOT (
    public.tt_user_can_edit_class_slots(v_uid, p_class_id)
    OR EXISTS (SELECT 1 FROM public.class_assignments ca
               WHERE ca.user_id = v_uid AND ca.role = 'teacher' AND ca.class_id = p_class_id)
    OR EXISTS (SELECT 1 FROM public.tt_slots s
               WHERE s.teacher_id = v_uid AND s.class_id = p_class_id AND s.subject_id = p_subject_id)
  ) THEN
    RAISE EXCEPTION 'You are not allowed to edit syllabus progress for this class.';
  END IF;

  DELETE FROM public.syllabus_progress_events e
  WHERE e.class_id = p_class_id AND e.subject_id = p_subject_id
    AND e.topic_id = p_topic_id AND e.date = p_date;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    BEGIN
      UPDATE public.tt_lesson_plans lp
      SET status = 'planned', updated_by = v_uid, updated_at = now()
      WHERE lp.class_id = p_class_id AND lp.subject_id = p_subject_id
        AND lp.date = p_date AND lp.topic_id = p_topic_id AND lp.status = 'done';
      v_revert := FOUND;
    EXCEPTION WHEN OTHERS THEN
      v_revert := false;
    END;
  END IF;

  RETURN jsonb_build_object('deleted', v_deleted > 0, 'lesson_plan_reverted', v_revert);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_syllabus_progress(uuid, uuid, uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_syllabus_progress(uuid, uuid, uuid, date) TO authenticated;
```

- [ ] **Step 2:** Apply via `run-sql.ps1` → `HTTP 201`, `[]`.
- [ ] **Step 3:** Verify via `run-sql.ps1`: all three functions exist in `pg_proc`; `teacher_projection_for_range(CURRENT_DATE, CURRENT_DATE + 6)` runs (service role → empty shape); the four policies' `qual` contain `select auth.uid`; **functional spot-check** — run the projection core for a real class (Salci National, Class 12 Commerce A / English Core) by invoking `class_projection_for_range` … as service role it early-outs, so instead validate with a direct EXPLAIN-less inline of the CTE for one group (copy the CTE body with literals) confirming it returns rows and every projected date ≥ today.
- [ ] **Step 4:** Commit (`feat(lms): projection RPCs + delete-correction + RLS initplan wrap (phase 2)`).

---

## Task 2: types regen

Same procedure as Phase 1 Task 3 (temp file → Compare-Object additive-only → UTF-8 no BOM → `npm run typecheck` → commit `chore(types): projection + delete RPCs (regen)`). Expect 3 new function signatures, zero removals.

---

## Task 3: Hooks — extend `src/hooks/useSyllabusProgress.ts`

**Interfaces produced (Tasks 4–7 import these EXACT names):** `ProjectedPeriod`, `ActualEntry`, `ProjectionOverflow`, `TeacherProjection`, `useTeacherProjection`, `useClassProjection`, `useReorderChapters`, `useDeleteSyllabusProgress`.

- [ ] **Step 1: Append to the file** (after `useRecordSyllabusProgress`):

```ts
export interface ProjectedPeriod {
  date: string;
  slot_id: string;
  class_id: string;
  subject_id: string;
  topic_id: string;
  topic_name: string;
  chapter_ord: number;
}
export interface ActualEntry {
  date: string;
  class_id: string;
  subject_id: string;
  topic_id: string;
  topic_name: string;
  action: ChapterAction;
}
export interface ProjectionOverflow {
  class_id: string;
  subject_id: string;
  unscheduled: number;
}
export interface TeacherProjection {
  projected: ProjectedPeriod[];
  actual: ActualEntry[];
  overflow: ProjectionOverflow[];
}

/** Auto-timeline for the calling teacher's slots in [from, to] + actual entries for the window. */
export function useTeacherProjection(args: { fromIso: string; toIso: string; enabled?: boolean }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["syllabus-projection", "teacher", user?.id, args.fromIso, args.toIso],
    enabled: (args.enabled ?? true) && !!user?.id && !!args.fromIso && !!args.toIso,
    staleTime: 60_000,
    queryFn: async (): Promise<TeacherProjection> => {
      const { data, error } = await supabase.rpc("teacher_projection_for_range", {
        p_from: args.fromIso,
        p_to: args.toIso,
      });
      if (error) throw error;
      return (data as unknown as TeacherProjection) ?? { projected: [], actual: [], overflow: [] };
    },
  });
}

/** Auto-timeline for one class (student week grid). */
export function useClassProjection(args: { classId: string; fromIso: string; toIso: string } | null) {
  return useQuery({
    queryKey: ["syllabus-projection", "class", args?.classId, args?.fromIso, args?.toIso],
    enabled: !!args,
    staleTime: 60_000,
    queryFn: async (): Promise<ProjectedPeriod[]> => {
      if (!args) return [];
      const { data, error } = await supabase.rpc("class_projection_for_range", {
        p_class_id: args.classId,
        p_from: args.fromIso,
        p_to: args.toIso,
      });
      if (error) throw error;
      const parsed = data as unknown as { projected: ProjectedPeriod[] } | null;
      return parsed?.projected ?? [];
    },
  });
}

/** Rewrite the remaining-chapter order for one (class, subject). Auto wins:
 *  the projection recomputes from this order on the next read. */
export function useReorderChapters() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      classId: string; subjectId: string; institutionId: string; orderedTopicIds: string[];
    }) => {
      const rows = input.orderedTopicIds.map((topicId, idx) => ({
        institution_id: input.institutionId,
        class_id: input.classId,
        subject_id: input.subjectId,
        topic_id: topicId,
        position: idx + 1,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("syllabus_sequence")
        .upsert(rows, { onConflict: "class_id,subject_id,topic_id" });
      if (error) throw error;
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't reorder the chapters.", context: "reorderChapters" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["syllabus-projection"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-progress-state"] });
    },
  });
}

/** Corrections: delete one jar entry (and revert its dual-written done row). */
export function useDeleteSyllabusProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { classId: string; subjectId: string; topicId: string; date: string }) => {
      const { error } = await supabase.rpc("delete_syllabus_progress", {
        p_class_id: input.classId,
        p_subject_id: input.subjectId,
        p_topic_id: input.topicId,
        p_date: input.date,
      });
      if (error) throw error;
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't remove the entry.", context: "deleteSyllabusProgress" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-syllabus-days"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-progress-state"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-projection"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "lesson-plan"] });
    },
  });
}
```

- [ ] **Step 2:** `npm run typecheck` + `npx eslint src/hooks/useSyllabusProgress.ts` clean. Commit (`feat(lms): projection/reorder/delete hooks (phase 2)`).

---

## Task 4: `SyllabusProgressGroup` — corrections mode

**Files:** Modify `src/components/lesson-completion/SyllabusProgressGroup.tsx`

- [ ] **Step 1:** Widen the props: `source: "checkout" | "checkin" | "correction"` and add optional `allowDelete?: boolean`.
- [ ] **Step 2:** Import `Trash2` from lucide + `useDeleteSyllabusProgress`; instantiate `const del = useDeleteSyllabusProgress();`; include `del.isPending` in the existing `busy`-style disabling of the picker/buttons (extend `record.isPending` checks to `record.isPending || del.isPending`).
- [ ] **Step 3:** In the `savedToday.map` row, after the action `Badge`, render when `allowDelete`:

```tsx
            {allowDelete && (
              <Button
                type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-ink-500 hover:text-rose-600"
                disabled={record.isPending || del.isPending}
                onClick={() => del.mutate({ classId, subjectId, topicId: c.topic_id, date })}
                title="Remove this entry"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
```

- [ ] **Step 4:** Verify (`typecheck` + eslint on the file) and confirm the two existing call sites (CheckOutLessonGate, CheckInBacklogSheet) compile unchanged (they don't pass `allowDelete`). Commit (`feat(lms): corrections mode on syllabus progress group`).

---

## Task 5: `ChapterReorderSheet` + `LessonPlanDialogV2` Syllabus section

**Files:** Create `src/components/lesson-completion/ChapterReorderSheet.tsx`; Modify `src/components/timetable-v2/LessonPlanDialogV2.tsx`

- [ ] **Step 1: Create `ChapterReorderSheet.tsx`** (verbatim):

```tsx
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ListOrdered } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { Button } from "@/components/ui/button";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import {
  useSyllabusProgressState,
  useReorderChapters,
} from "@/hooks/useSyllabusProgress";

/**
 * "Edit the whole timeline" surface: reorder the remaining (not-completed)
 * chapters of one (class, subject). Saving rewrites syllabus_sequence; every
 * projection recomputes from the new order on next read (Auto wins — no pins).
 */
export function ChapterReorderSheet({
  open, onOpenChange, classId, subjectId, subjectName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  subjectId: string;
  subjectName: string;
}) {
  const { institutionId } = useEffectiveInstitution();
  const { data: chapters = [], isLoading, isError } = useSyllabusProgressState(
    open ? { classId, subjectId, date: "" } : null,
  );
  const reorder = useReorderChapters();
  const [order, setOrder] = useState<{ id: string; label: string }[]>([]);

  // Seed local order from the server state each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setOrder(
      chapters
        .filter((c) => c.status !== "completed")
        .map((c) => ({
          id: c.topic_id,
          label: `${c.chapter_number != null ? `${c.chapter_number}. ` : ""}${c.topic_name}`,
        })),
    );
  }, [open, chapters]);

  const move = (idx: number, dir: -1 | 1) => {
    setOrder((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const save = async () => {
    if (!institutionId) return;
    await reorder.mutateAsync({
      classId, subjectId, institutionId,
      orderedTopicIds: order.map((o) => o.id),
    });
    onOpenChange(false);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Chapter order"
      subtitle={`${subjectName} — the auto timeline follows this order`}
      icon={<ListOrdered className="h-4 w-4" />}
      primaryAction={{ label: "Save order", onClick: save, disabled: order.length === 0 || !institutionId, loading: reorder.isPending }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: reorder.isPending }}
    >
      {isLoading ? (
        <p className="py-6 text-sm text-ink-500">Loading chapters…</p>
      ) : isError ? (
        <p className="py-6 text-sm text-ink-500">Couldn't load chapters. Close and try again.</p>
      ) : order.length === 0 ? (
        <p className="py-6 text-sm text-ink-500">No remaining chapters — everything is completed.</p>
      ) : (
        <form data-dirty="true" onSubmit={(e) => e.preventDefault()} className="space-y-1.5">
          {order.map((c, idx) => (
            <div key={c.id} className="flex items-center gap-2 rounded-lg border border-surface-stroke px-2.5 py-1.5">
              <span className="w-6 text-xs tabular-nums text-ink-500">{idx + 1}.</span>
              <span className="flex-1 min-w-0 truncate text-sm text-ink-900">{c.label}</span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => move(idx, -1)} disabled={idx === 0 || reorder.isPending} title="Move up">
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                onClick={() => move(idx, 1)} disabled={idx === order.length - 1 || reorder.isPending} title="Move down">
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </form>
      )}
    </MobileSheet>
  );
}
```

NOTE — `useSyllabusProgressState` takes `date: string`; passing `""` yields `p_date: ""` which Postgres rejects as a date. **Adjust the hook first** (this task owns it): change the state hook's args type to `{ classId: string; subjectId: string; date?: string | null }` and pass `p_date: args.date || null`. Both existing callers pass a real date — unchanged behavior.

- [ ] **Step 2: `LessonPlanDialogV2` Syllabus section.** Add optional props (backward-compatible — existing callers compile unchanged):

```tsx
  /** Auto-timeline lookup for THIS slot: dateIso → projected chapter. */
  projectionByDate?: Map<string, { topic_name: string; chapter_ord: number }>;
  /** Institution-local today (from the projection query's perspective). */
  todayIso?: string;
```

Inside the component (after the `chapters` query), add:

```tsx
  const isPastDate = !!todayIso && date < todayIso;
  const projected = projectionByDate?.get(date) ?? null;
  const [reorderOpen, setReorderOpen] = useState(false);
  const progressState = useSyllabusProgressState(
    open && !isPastDate && subjectId ? { classId: slot.class_id, subjectId, date } : null,
  );
  const reorder = useReorderChapters();
  const remainingOrdered = (progressState.data ?? []).filter((c) => c.status !== "completed");

  async function teachDifferentChapter(topicIdPicked: string) {
    if (!institutionId || !subjectId || !projected) return;
    // Auto-wins reorder: move the picked chapter to the ordinal of the chapter
    // currently projected on this period; everything re-flows on next read.
    const ids = remainingOrdered.map((c) => c.topic_id).filter((id) => id !== topicIdPicked);
    const at = Math.min(Math.max(projected.chapter_ord - 1, 0), ids.length);
    ids.splice(at, 0, topicIdPicked);
    await reorder.mutateAsync({
      classId: slot.class_id, subjectId, institutionId, orderedTopicIds: ids,
    });
  }
```

And in the JSX, directly ABOVE the existing "Select chapter" block, insert the section:

```tsx
          {subjectId && (isPastDate ? (
            <div className="space-y-2 rounded-lg border border-surface-stroke p-2.5">
              <p className="text-sm font-medium">Syllabus — what was covered this day</p>
              <SyllabusProgressGroup
                classId={slot.class_id}
                subjectId={subjectId}
                className={classLabel}
                subjectName={subjectLabel}
                date={date}
                source="correction"
                allowDelete
              />
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-surface-stroke p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Auto timeline</p>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => setReorderOpen(true)}>
                  Reorder chapters
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {projected
                  ? <>Projected for this period: <span className="font-medium text-foreground">{projected.topic_name}</span></>
                  : "No projection for this period (outside the loaded week, or syllabus finished)."}
              </p>
              {projected && remainingOrdered.length > 1 && (
                <Select
                  value=""
                  onValueChange={(v) => { void teachDifferentChapter(v); }}
                  disabled={reorder.isPending}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Teach a different chapter here…" />
                  </SelectTrigger>
                  <SelectContent>
                    {remainingOrdered.filter((c) => c.topic_id !== projected?.topic_id).map((c) => (
                      <SelectItem key={c.topic_id} value={c.topic_id}>
                        {c.chapter_number != null ? `${c.chapter_number}. ` : ""}{c.topic_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}
```

Plus at the bottom of the returned JSX (inside `<Dialog>`, after `</DialogContent>` is NOT valid — place it as a sibling INSIDE `DialogContent`, after `<DialogFooter>`):

```tsx
        {subjectId && (
          <ChapterReorderSheet
            open={reorderOpen}
            onOpenChange={setReorderOpen}
            classId={slot.class_id}
            subjectId={subjectId}
            subjectName={subjectLabel}
          />
        )}
```

Imports to add: `SyllabusProgressGroup`, `ChapterReorderSheet`, `useSyllabusProgressState`, `useReorderChapters`.

- [ ] **Step 3:** Verify all three §5a checks (the dialog file + new sheet + hooks file). Commit (`feat(lms): lesson-plan dialog syllabus section + chapter reorder sheet`).

---

## Task 6: TeacherMyWeekPageV2 — PeriodChip chapter lines + dialog wiring

**Files:** Modify `src/pages/teacher/TeacherMyWeekPageV2.tsx`

- [ ] **Step 1: Fetch the projection for the visible window.** Below the `backlogOpen` state block:

```tsx
  const projFrom = weekIsos[0] ?? null;
  const projTo = weekIsos[weekIsos.length - 1] ?? null;
  const projection = useTeacherProjection({
    fromIso: projFrom ?? "", toIso: projTo ?? "", enabled: !!projFrom && !!projTo,
  });
  // Institution-local "today" = the first projected date can't precede it; more
  // robustly: the RPC only projects dates >= its today, so any date present in
  // `projected` that equals a weekIso tells us today <= that iso. For the
  // past/future split use the device date (IST-only deployment, same rule as
  // isPastCutoff).
  const todayIso = isoDate(new Date());
  const projBySlotDate = useMemo(() => {
    const m = new Map<string, { topic_name: string; chapter_ord: number }>();
    for (const p of projection.data?.projected ?? []) {
      m.set(`${p.slot_id}|${p.date}`, { topic_name: p.topic_name, chapter_ord: p.chapter_ord });
    }
    return m;
  }, [projection.data]);
  const actualByGroupDate = useMemo(() => {
    const m = new Map<string, { topic_name: string; action: string }[]>();
    for (const a of projection.data?.actual ?? []) {
      const k = `${a.class_id}|${a.subject_id}|${a.date}`;
      const list = m.get(k) ?? [];
      list.push({ topic_name: a.topic_name, action: a.action });
      m.set(k, list);
    }
    return m;
  }, [projection.data]);
```

(Import `useTeacherProjection` from `@/hooks/useSyllabusProgress`; `useMemo` is already imported.)

- [ ] **Step 2: Thread to DayCard/PeriodChip.** Pass `chapterLine` down: in the `weekDates.map`, compute per chip inside `DayCard` — change `DayCard` and `PeriodChip` props: `DayCard` gains `chapterLineFor: (slot: TeacherWeekSlot) => string | null`; the page passes:

```tsx
              chapterLineFor={(slot) => {
                if (dayIso >= todayIso) {
                  const p = projBySlotDate.get(`${slot.id}|${dayIso}`);
                  return p ? `→ ${p.topic_name}` : null;
                }
                const entries = actualByGroupDate.get(`${slot.class_id}|${slot.subject_id}|${dayIso}`);
                if (!entries || entries.length === 0) return null;
                const first = entries[0];
                const mark = first.action === "completed" ? "✓" : "◐";
                return entries.length > 1
                  ? `${mark} ${first.topic_name} +${entries.length - 1}`
                  : `${mark} ${first.topic_name}`;
              }}
```

`DayCard` forwards `line={chapterLineFor(s)}` to each `PeriodChip`; `PeriodChip` gains `line?: string | null` and renders, between the class line and the status badge:

```tsx
      {line && (
        <div className="text-[10px] text-teal-700 truncate" title={line}>{line}</div>
      )}
```

- [ ] **Step 3: Dialog wiring.** Build the per-slot map for the tapped slot and pass the new props:

```tsx
        <LessonPlanDialogV2
          …existing props…
          todayIso={todayIso}
          projectionByDate={(() => {
            const m = new Map<string, { topic_name: string; chapter_ord: number }>();
            for (const p of projection.data?.projected ?? []) {
              if (p.slot_id === planTarget.slot.id) m.set(p.date, { topic_name: p.topic_name, chapter_ord: p.chapter_ord });
            }
            return m;
          })()}
        />
```

- [ ] **Step 4:** §5a checks on the page. Commit (`feat(lms): projected/actual chapter lines on teacher week + dialog wiring`).

---

## Task 7: Student grid overlay

**Files:** Modify `src/components/timetable-v2/TimetableGridV2.tsx`, `src/pages/student/StudentWeekPageV2.tsx`

- [ ] **Step 1: `TimetableGridV2`** — add to `Props`: `chapterOverlay?: Map<string, string>;` (key = tt_slots row id; a weekly grid shows each slot once, so slot id alone addresses the cell for the CURRENT week). In the cell render, change the fixed height to `chapterOverlay ? "h-[72px]" : "h-[60px]"` (via `cn`) and, inside the `existing ? (…)` branch after the teacher-name span, add:

```tsx
                                {chapterOverlay?.get(existing.id) && (
                                  <span className="text-[10px] text-teal-700 truncate">
                                    → {chapterOverlay.get(existing.id)}
                                  </span>
                                )}
```

(`existing.id` is the `tt_slots` row id on `ResolvedSlotV2` — verify the field name in `useTimetableV2.ts` and adapt if it differs.)

- [ ] **Step 2: `StudentWeekPageV2`** — compute the CURRENT real week (Mon..Sun containing today), call the projection, build the map, pass it:

```tsx
import { addDays, format, startOfWeek } from "date-fns";
import { useMemo } from "react";
import { useClassProjection } from "@/hooks/useSyllabusProgress";
…
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const fromIso = format(weekStart, "yyyy-MM-dd");
  const toIso = format(addDays(weekStart, 6), "yyyy-MM-dd");
  const projection = useClassProjection(
    data?.classId ? { classId: data.classId, fromIso, toIso } : null,
  );
  const chapterOverlay = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projection.data ?? []) m.set(p.slot_id, p.topic_name);
    return m;
  }, [projection.data]);
```

and pass `chapterOverlay={chapterOverlay}` to `<TimetableGridV2 …/>`.

- [ ] **Step 3:** §5a checks. Commit (`feat(lms): projected chapter overlay on student week grid`).

---

## Task 8: Full verification + final review + push

- [ ] `npm run typecheck` · `npx eslint` on every file touched in Phase 2 · `npx vite build` — all clean.
- [ ] Scale-gate walk (one-line verdicts) — staleTime on 2 new queries · bounded RPC windows (≤62 days) · reorder upsert bounded by chapter count · no select("*") beyond explicit-column sequence upsert · idempotent upserts/deletes · errors via toastError.
- [ ] Final whole-branch review (Phase-2 diff), fix findings, update ledger + memory, push branch. Merge only after user smoke-test.
