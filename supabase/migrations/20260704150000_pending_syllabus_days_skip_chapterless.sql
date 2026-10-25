-- 20260704150000_pending_syllabus_days_skip_chapterless.sql
-- Task-6 review fix (F2, trap-freedom): a (class, subject) group whose subject
-- has NO active chapters can never receive a jar entry, so demanding it would
-- permanently block check-out. Skip such groups at the source. (The companion
-- UI fix adds a "revision mode" for subjects whose chapters are all completed.)
-- Only change vs 20260704141000: the EXISTS(active syllabus_topics) clause in
-- the slots CTE.

CREATE OR REPLACE FUNCTION public.teacher_pending_syllabus_days(p_include_today boolean DEFAULT false)
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
      AND s.slot_type IN ('theory','practical') AND s.subject_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb);
  END IF;

  v_end := LEAST(v_end, CASE WHEN p_include_today THEN v_today ELSE v_today - 1 END);
  v_start := GREATEST(v_start, v_today - 60);
  IF v_start > v_end THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  WITH days AS (
    SELECT d::date AS d FROM generate_series(v_start, v_end, interval '1 day') AS g(d)
  ),
  slots AS (
    SELECT s.class_id, s.subject_id, s.day,
           trim(c.name || COALESCE(' ' || c.section, '')) AS class_name,
           us.name AS subject_name,
           cs.structure_id
    FROM public.tt_slots s
    JOIN public.classes c              ON c.id = s.class_id
    JOIN public.universal_subjects us  ON us.id = s.subject_id
    JOIN public.tt_class_structure cs  ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    WHERE s.teacher_id = v_uid
      AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical')
      AND s.subject_id IS NOT NULL
      -- Trap-freedom: a subject with no active chapters can never be filled —
      -- never demand it. (Chapter-set resolution falls back to all active
      -- subject topics, so "has any chapter" ⇔ this EXISTS.)
      AND EXISTS (
        SELECT 1 FROM public.syllabus_topics st
        WHERE st.subject_id = s.subject_id AND st.is_active = true
      )
  ),
  occ AS (
    SELECT DISTINCT sl.class_id, sl.class_name, sl.subject_id, sl.subject_name, dd.d
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
  ),
  grps AS (
    SELECT o.*,
           EXISTS (
             SELECT 1 FROM public.syllabus_progress_events e
             WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d
           ) AS filled
    FROM occ o
  ),
  by_day AS (
    SELECT g.d,
           bool_and(g.filled) AS all_filled,
           jsonb_agg(jsonb_build_object(
             'class_id', g.class_id, 'class_name', g.class_name,
             'subject_id', g.subject_id, 'subject_name', g.subject_name,
             'filled', g.filled
           ) ORDER BY g.class_name, g.subject_name) AS groups
    FROM grps g
    GROUP BY g.d
  ),
  pending AS (
    SELECT * FROM by_day WHERE NOT all_filled
  )
  SELECT jsonb_build_object(
    -- Count over the 60-day window (intentionally window-bounded; older gaps
    -- are out of scope for this per-login hot query).
    'unresolved_day_count', (SELECT count(*) FROM pending),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(p.d, 'YYYY-MM-DD'),
        'is_today', (p.d = v_today),
        'groups', p.groups) ORDER BY p.d)
      FROM (SELECT * FROM pending ORDER BY (d = v_today) DESC, d ASC LIMIT 30) p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_pending_syllabus_days(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.teacher_pending_syllabus_days(boolean) TO authenticated;
