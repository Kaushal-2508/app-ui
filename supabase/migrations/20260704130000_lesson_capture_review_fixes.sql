-- 20260704130000_lesson_capture_review_fixes.sql
-- Whole-feature review fixes (Phase 1 lesson-capture):
--   F5 [CRITICAL]: the days LIMIT kept the OLDEST 30 days; when a teacher has
--     >30 unresolved days (rollout: every working day is unresolved) TODAY was
--     truncated out, so the check-out gate (keys on is_today) saw nothing and
--     falsely reported "all set" — defeating the primary capture trigger.
--     Fix: order so today is never dropped ((d = v_today) DESC first).
--   F6 [IMPORTANT]: unresolved_day_count is over the bounded (60-day) window,
--     not "uncapped" — correct the comments to match the actual behavior.
--   F7 [IMPORTANT]: pacing-write RLS only allowed admins/coords or
--     class_assignments teachers, but the gate surfaces slots purely from
--     tt_slots.teacher_id. A timetable-only teacher (no class_assignments row)
--     was RLS-denied on the pacing write, which aborted "Completed" and forced
--     them to mark taught lessons "Not done". Add a tt_slots-teacher clause so
--     write authorization matches the surfacing.

-- ---------------------------------------------------------------------------
-- F5 + F6: RPC replace (signature unchanged — no types regen).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_pending_lesson_days(p_include_today boolean DEFAULT false)
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
  v_start  date;
  v_end    date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_uid;
  IF v_inst IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT ay.code, ay.starts_on, ay.ends_on INTO v_ay, v_start, v_end
  FROM public.cal_academic_years ay
  WHERE ay.institution_id = v_inst AND ay.is_active = true
  LIMIT 1;
  IF v_ay IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tt_slots s
    WHERE s.teacher_id = v_uid AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical')
  ) THEN
    RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb);
  END IF;

  v_end := LEAST(v_end, CASE WHEN p_include_today THEN v_today ELSE v_today - 1 END);
  -- Bound the lookback to a recent window (hot-path cost). Chronic older gaps
  -- are out of scope for this per-login query by design.
  v_start := GREATEST(v_start, v_today - 60);
  IF v_start > v_end THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  WITH days AS (
    SELECT d::date AS d FROM generate_series(v_start, v_end, interval '1 day') AS g(d)
  ),
  slots AS (
    SELECT s.id AS slot_id, s.class_id, s.subject_id, s.day,
           c.name AS class_name_raw, c.section AS class_section,
           us.name AS subject_name,
           cs.structure_id
    FROM public.tt_slots s
    JOIN public.classes c             ON c.id = s.class_id
    LEFT JOIN public.universal_subjects us ON us.id = s.subject_id
    JOIN public.tt_class_structure cs ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    WHERE s.teacher_id = v_uid
      AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical')
  ),
  occ AS (
    SELECT sl.slot_id, sl.class_id, sl.class_name_raw, sl.class_section,
           sl.subject_id, sl.subject_name, dd.d
    FROM slots sl
    JOIN public.tt_period_structures ps ON ps.id = sl.structure_id
    JOIN days dd ON public.tt_dow_to_text(dd.d) = sl.day
                AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cal_events ce
      WHERE ce.institution_id = v_inst AND ce.academic_year = v_ay
        AND ce.kind IN ('holiday','exam_block')
        AND dd.d BETWEEN ce.starts_on AND ce.ends_on
    )
    -- Phase-1 present-teacher scope: drop days the teacher was absent/on leave.
    AND NOT EXISTS (
      SELECT 1 FROM public.staff_attendance_records sar
      WHERE sar.staff_id = v_uid AND sar.date = dd.d
        AND sar.status IN ('absent','on_leave')
    )
  ),
  unresolved AS (
    SELECT o.*,
           lp.topic_id,
           false AS was_absent
    FROM occ o
    LEFT JOIN public.tt_lesson_plans lp ON lp.slot_id = o.slot_id AND lp.date = o.d
    WHERE lp.id IS NULL OR lp.status NOT IN ('done','skipped')
  ),
  enriched AS (
    SELECT u.*,
           cp.planned_sessions,
           CASE WHEN cp.planned_sessions IS NOT NULL AND cp.planned_sessions > 0
                THEN round(100.0 / cp.planned_sessions, 2) END AS expected_pct
    FROM unresolved u
    LEFT JOIN public.tt_chapter_pacing cp
      ON cp.class_id = u.class_id AND cp.subject_id = u.subject_id AND cp.topic_id = u.topic_id
  ),
  by_day AS (
    SELECT e.d, bool_or(e.was_absent) AS was_absent,
      jsonb_agg(jsonb_build_object(
        'slot_id', e.slot_id, 'class_id', e.class_id,
        'class_name', trim(e.class_name_raw || COALESCE(' ' || e.class_section, '')),
        'subject_id', e.subject_id, 'subject_name', e.subject_name,
        'topic_id', e.topic_id, 'planned_sessions', e.planned_sessions, 'expected_pct', e.expected_pct
      ) ORDER BY e.slot_id) AS slots
    FROM enriched e
    GROUP BY e.d
  )
  SELECT jsonb_build_object(
    -- Count of unresolved days within the lookback window (see v_start bound).
    -- Phase-3 >3-day escalation reads this; gaps older than the window are
    -- intentionally out of scope for this per-login hot query.
    'unresolved_day_count', (SELECT count(*) FROM by_day),
    -- Bounded page. TODAY must never be truncated (the check-out gate keys on
    -- is_today), so order today first, then oldest past days.
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(bd.d,'YYYY-MM-DD'),
        'is_today', (bd.d = v_today),
        'was_absent', bd.was_absent,
        'slots', bd.slots) ORDER BY bd.d)
      FROM (SELECT * FROM by_day ORDER BY (d = v_today) DESC, d ASC LIMIT 30) bd), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_pending_lesson_days(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.teacher_pending_lesson_days(boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- F7: broaden pacing-write RLS to teachers scheduled via tt_slots (matching how
-- the gate surfaces work), in addition to admins/coords and class_assignments.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff write chapter pacing" ON public.tt_chapter_pacing;
CREATE POLICY "Staff write chapter pacing" ON public.tt_chapter_pacing
  FOR ALL TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = tt_chapter_pacing.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = tt_chapter_pacing.class_id
          AND s.subject_id = tt_chapter_pacing.subject_id
      )
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = tt_chapter_pacing.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = tt_chapter_pacing.class_id
          AND s.subject_id = tt_chapter_pacing.subject_id
      )
    )
  );
