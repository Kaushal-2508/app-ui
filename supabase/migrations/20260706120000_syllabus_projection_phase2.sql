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
