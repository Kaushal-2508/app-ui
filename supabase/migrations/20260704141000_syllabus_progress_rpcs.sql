-- 20260704141000_syllabus_progress_rpcs.sql
-- Phase-1 RPCs for the two-timeline syllabus (spec §4.1, §4.2, §4.5).

-- ---------------------------------------------------------------------------
-- 4.1 teacher_pending_syllabus_days — backlog of (class,subject) groups per
-- working day with no jar entry. Carries over the hardened bounds from
-- teacher_pending_lesson_days (60-day lookback, LIMIT 30 days today-first,
-- zero-slot pre-check, institution timezone). DIFFERENCES: groups are
-- (class,subject) not slots, and ABSENT DAYS ARE INCLUDED — the check-in
-- popup is where the teacher fills them (spec decision #4).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4.2 syllabus_progress_state — the chapter working set for one
-- (class, subject): the SAME chapter resolution as useChaptersForExam /
-- coverage (class_group mapping → fallback all active subject topics),
-- sequence-or-default ordering, event-derived status, and the action already
-- recorded for p_date (prefill).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.syllabus_progress_state(p_class_id uuid, p_subject_id uuid, p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_inst uuid;
  v_cg   uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT c.institution_id, c.class_group_id INTO v_inst, v_cg
  FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL OR v_inst IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    WITH mapped AS (
      SELECT st.id, st.topic_name, st.chapter_number, st.display_order
      FROM public.topic_class_mappings tcm
      JOIN public.syllabus_topics st ON st.id = tcm.topic_id
      WHERE v_cg IS NOT NULL
        AND tcm.class_group_id = v_cg
        AND st.subject_id = p_subject_id
        AND st.is_active = true
    ),
    effective AS (
      SELECT * FROM mapped
      UNION ALL
      SELECT st.id, st.topic_name, st.chapter_number, st.display_order
      FROM public.syllabus_topics st
      WHERE st.subject_id = p_subject_id AND st.is_active = true
        AND NOT EXISTS (SELECT 1 FROM mapped)
    ),
    ordered AS (
      SELECT e.id AS topic_id, e.topic_name, e.chapter_number,
             COALESCE(sq.position,
                      10000 + (row_number() OVER (ORDER BY e.display_order NULLS LAST, e.chapter_number NULLS LAST, e.topic_name))::int
             ) AS position
      FROM effective e
      LEFT JOIN public.syllabus_sequence sq
        ON sq.class_id = p_class_id AND sq.subject_id = p_subject_id AND sq.topic_id = e.id
    )
    SELECT jsonb_agg(jsonb_build_object(
      'topic_id', o.topic_id,
      'topic_name', o.topic_name,
      'chapter_number', o.chapter_number,
      'position', o.position,
      'status', CASE
        WHEN EXISTS (SELECT 1 FROM public.syllabus_progress_events e
                     WHERE e.class_id = p_class_id AND e.subject_id = p_subject_id
                       AND e.topic_id = o.topic_id AND e.action = 'completed') THEN 'completed'
        WHEN EXISTS (SELECT 1 FROM public.syllabus_progress_events e
                     WHERE e.class_id = p_class_id AND e.subject_id = p_subject_id
                       AND e.topic_id = o.topic_id AND e.action = 'partial') THEN 'partial'
        ELSE 'untouched' END,
      'action_on_date', CASE WHEN p_date IS NULL THEN NULL ELSE (
        SELECT e.action FROM public.syllabus_progress_events e
        WHERE e.class_id = p_class_id AND e.subject_id = p_subject_id
          AND e.topic_id = o.topic_id AND e.date = p_date
      ) END
    ) ORDER BY o.position)
    FROM ordered o
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.syllabus_progress_state(uuid, uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.syllabus_progress_state(uuid, uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4.5 record_syllabus_progress — THE single write path for jar entries.
-- Event upsert + best-effort coverage dual-write (tt_lesson_plans done row on
-- a free slot of that class+subject+date) in ONE transaction (enterprise
-- rule 6). SECURITY DEFINER ⇒ explicit permission re-check (same tri-clause
-- as the tables' RLS). Institution derived from the class row, never client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_syllabus_progress(
  p_class_id uuid, p_subject_id uuid, p_topic_id uuid,
  p_date date, p_action text, p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_inst  uuid;
  v_ay    text;
  v_slot  uuid;
  v_event uuid;
  v_lp    boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'You must be signed in.'; END IF;
  IF p_action NOT IN ('completed','partial') OR p_source NOT IN ('checkout','checkin','correction') THEN
    RAISE EXCEPTION 'Invalid progress entry.';
  END IF;

  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'Class not found.'; END IF;
  IF v_inst IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'You are not allowed to record syllabus progress for this class.';
  END IF;

  IF NOT (
    public.tt_user_can_edit_class_slots(v_uid, p_class_id)
    OR EXISTS (SELECT 1 FROM public.class_assignments ca
               WHERE ca.user_id = v_uid AND ca.role = 'teacher' AND ca.class_id = p_class_id)
    OR EXISTS (SELECT 1 FROM public.tt_slots s
               WHERE s.teacher_id = v_uid AND s.class_id = p_class_id AND s.subject_id = p_subject_id)
  ) THEN
    RAISE EXCEPTION 'You are not allowed to record syllabus progress for this class.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.syllabus_topics st
                 WHERE st.id = p_topic_id AND st.subject_id = p_subject_id) THEN
    RAISE EXCEPTION 'That chapter does not belong to this subject.';
  END IF;

  INSERT INTO public.syllabus_progress_events
    (institution_id, class_id, subject_id, topic_id, date, action, source, recorded_by)
  VALUES (v_inst, p_class_id, p_subject_id, p_topic_id, p_date, p_action, p_source, v_uid)
  ON CONFLICT (class_id, subject_id, topic_id, date)
  DO UPDATE SET action = EXCLUDED.action, source = EXCLUDED.source,
                recorded_by = EXCLUDED.recorded_by, updated_at = now()
  RETURNING id INTO v_event;

  -- Coverage dual-write (best-effort — never blocks the event write): upgrade
  -- or create ONE tt_lesson_plans done row on a slot of this class+subject on
  -- p_date's weekday that doesn't already carry a done row for p_date.
  IF p_action = 'completed' THEN
    BEGIN
      SELECT ay.code INTO v_ay FROM public.cal_academic_years ay
      WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;

      IF v_ay IS NOT NULL THEN
        SELECT s.id INTO v_slot
        FROM public.tt_slots s
        WHERE s.class_id = p_class_id AND s.subject_id = p_subject_id
          AND s.academic_year = v_ay
          AND s.slot_type IN ('theory','practical')
          AND s.day = public.tt_dow_to_text(p_date)
          AND NOT EXISTS (SELECT 1 FROM public.tt_lesson_plans lp
                          WHERE lp.slot_id = s.id AND lp.date = p_date AND lp.status = 'done')
        ORDER BY s.id
        LIMIT 1;

        IF v_slot IS NOT NULL THEN
          INSERT INTO public.tt_lesson_plans
            (slot_id, institution_id, class_id, subject_id, owner_teacher_id, created_by,
             date, session_type, status, topic_id, updated_by, updated_at)
          VALUES (v_slot, v_inst, p_class_id, p_subject_id, v_uid, v_uid,
                  p_date, 'teaching', 'done', p_topic_id, v_uid, now())
          ON CONFLICT (slot_id, date)
          DO UPDATE SET status = 'done', session_type = 'teaching',
                        topic_id = EXCLUDED.topic_id, updated_by = EXCLUDED.updated_by, updated_at = now();
          v_lp := true;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_lp := false;  -- swallow: the event row above is the source of truth
    END;
  END IF;

  RETURN jsonb_build_object('event_id', v_event, 'lesson_plan_written', v_lp);
END;
$$;

REVOKE ALL ON FUNCTION public.record_syllabus_progress(uuid, uuid, uuid, date, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_syllabus_progress(uuid, uuid, uuid, date, text, text) TO authenticated;
