-- 20260706150000_syllabus_phase3.sql
-- Phase 3 (spec section 7 + deferred items):
--   A. Widen dashboard_flags.category CHECK (+'syllabus').
--   B. dash_evaluate_syllabus_flags -- standalone SY1 evaluator (>3 unresolved
--      syllabus days per teacher, 60-day window). Same flags table + identity
--      as dash_evaluate_flags; deliberately NOT a rewrite of the big evaluator.
--      Kicked from useEvaluateFlagsOnOpen alongside the main one.
--   C. dash_syllabus_coverage_build: done-CTE UNION with completed jar events.
--   D. Cleanup drops (zero frontend refs): old pending RPC + pacing table.

-- A ---------------------------------------------------------------------
ALTER TABLE public.dashboard_flags DROP CONSTRAINT IF EXISTS dashboard_flags_category_check;
ALTER TABLE public.dashboard_flags ADD CONSTRAINT dashboard_flags_category_check
  CHECK (category IN ('attendance','exams','adoption','syllabus'));

-- B ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_evaluate_syllabus_flags(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay text; v_start date; v_end date;
  v_detected int := 0; v_resolved int := 0;
BEGIN
  v_inst := COALESCE(p_institution_id, public.dash_resolve_institution());
  SELECT COALESCE(i.timezone,'Asia/Kolkata') INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT ay.code, GREATEST(ay.starts_on, v_today - 60) INTO v_ay, v_start
  FROM cal_academic_years ay WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
  v_end := v_today - 1;
  IF v_ay IS NULL OR v_start > v_end THEN
    RETURN jsonb_build_object('detected', 0, 'resolved', 0);
  END IF;

  DROP TABLE IF EXISTS _sy;
  CREATE TEMP TABLE _sy ON COMMIT DROP AS
  WITH dd AS (SELECT d::date AS d FROM generate_series(v_start, v_end, interval '1 day') g(d)),
  slots AS (
    SELECT DISTINCT s.teacher_id, s.class_id, s.subject_id, s.day, cs.structure_id
    FROM tt_slots s
    JOIN tt_class_structure cs ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    WHERE s.institution_id = v_inst AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical')
      AND s.subject_id IS NOT NULL AND s.teacher_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM syllabus_topics st WHERE st.subject_id = s.subject_id AND st.is_active = true)
  ),
  occ AS (
    SELECT DISTINCT sl.teacher_id, sl.class_id, sl.subject_id, dd.d
    FROM slots sl
    JOIN tt_period_structures ps ON ps.id = sl.structure_id
    JOIN dd ON public.tt_dow_to_text(dd.d) = sl.day AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE NOT EXISTS (
      SELECT 1 FROM cal_events ce
      WHERE ce.institution_id = v_inst AND ce.academic_year = v_ay
        AND ce.kind IN ('holiday','exam_block') AND dd.d BETWEEN ce.starts_on AND ce.ends_on)
  ),
  unfilled AS (
    SELECT o.teacher_id, o.d FROM occ o
    WHERE NOT EXISTS (SELECT 1 FROM syllabus_progress_events e
      WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d)
  )
  SELECT u.teacher_id, count(DISTINCT u.d)::int AS n
  FROM unfilled u GROUP BY u.teacher_id HAVING count(DISTINCT u.d) > 3;

  INSERT INTO dashboard_flags (institution_id, flag_code, category, severity, subject_type, subject_key,
                               title, description, metric_value, link_url, status, first_detected_at, last_evaluated_at)
  SELECT v_inst, 'SY1', 'syllabus', 'warning', 'teacher', sy.teacher_id::text,
         'Syllabus logging is behind',
         COALESCE(p.full_name, p.email, 'A teacher') || ' has ' || sy.n || ' recent school days with unlogged syllabus progress.',
         sy.n, '/school/timetable', 'red', now(), now()
  FROM _sy sy LEFT JOIN profiles p ON p.id = sy.teacher_id
  ON CONFLICT (institution_id, flag_code, subject_key) WHERE resolved_at IS NULL
  DO UPDATE SET last_evaluated_at = now(), metric_value = EXCLUDED.metric_value, description = EXCLUDED.description;

  SELECT count(*) INTO v_detected FROM _sy;

  UPDATE dashboard_flags df SET resolved_at = now()
  WHERE df.institution_id = v_inst AND df.resolved_at IS NULL AND df.flag_code = 'SY1'
    AND NOT EXISTS (SELECT 1 FROM _sy s WHERE s.teacher_id::text = df.subject_key);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object('detected', v_detected, 'resolved', v_resolved);
END $$;

REVOKE ALL ON FUNCTION public.dash_evaluate_syllabus_flags(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.dash_evaluate_syllabus_flags(uuid) TO authenticated;

-- C ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dash_syllabus_coverage_build(
  p_inst uuid,
  p_class_ids uuid[],
  p_combo_teacher uuid,        -- restrict combos to this teacher's slots (teacher scope); NULL = no restriction
  p_scope_label text,
  p_class_group_id uuid,
  p_class_id uuid,
  p_subject_id uuid,
  p_teacher_id uuid            -- optional teacher FILTER (admin/coordinator narrowing)
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tz text;
  v_today date;
  v_ay_code text;
  v_rows jsonb;
  v_cov int;
  v_tot int;
  v_combos int;
  v_full int;
  v_none int;
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT code INTO v_ay_code FROM cal_academic_years
  WHERE institution_id = p_inst
  ORDER BY (v_today BETWEEN starts_on AND ends_on) DESC, is_active DESC, starts_on DESC
  LIMIT 1;

  WITH combos AS (
    -- one row per (section, subject) actually scheduled this academic year, in scope
    SELECT DISTINCT s.class_id, s.subject_id, c.class_group_id,
           COALESCE(cg.name, c.name) AS class_name, c.section
    FROM tt_slots s
    JOIN classes c ON c.id = s.class_id AND c.institution_id = p_inst
    LEFT JOIN class_groups cg ON cg.id = c.class_group_id
    WHERE s.class_id = ANY(p_class_ids)
      AND s.academic_year = v_ay_code
      AND s.subject_id IS NOT NULL
      AND (p_combo_teacher IS NULL OR s.teacher_id = p_combo_teacher)
      AND (p_teacher_id IS NULL OR s.teacher_id = p_teacher_id)
      AND (p_class_id IS NULL OR s.class_id = p_class_id)
      AND (p_class_group_id IS NULL OR c.class_group_id = p_class_group_id)
      AND (p_subject_id IS NULL OR s.subject_id = p_subject_id)
  ),
  cg_subj AS (SELECT DISTINCT class_group_id, subject_id FROM combos),
  -- denominator chapter set: class-group mapped chapters if any exist for the subject,
  -- else all active subject chapters. Institution-scoped + global (institution_id IS NULL).
  chapter_set AS (
    SELECT cs.class_group_id, cs.subject_id, st.id AS chapter_id
    FROM cg_subj cs
    JOIN syllabus_topics st ON st.is_active AND st.subject_id = cs.subject_id
      AND (st.institution_id IS NULL OR st.institution_id = p_inst)
      AND (
        EXISTS (SELECT 1 FROM topic_class_mappings tcm
                WHERE tcm.class_group_id = cs.class_group_id AND tcm.topic_id = st.id)
        OR NOT EXISTS (
          SELECT 1 FROM topic_class_mappings t2 JOIN syllabus_topics s2 ON s2.id = t2.topic_id
          WHERE t2.class_group_id = cs.class_group_id AND s2.is_active AND s2.subject_id = cs.subject_id
            AND (s2.institution_id IS NULL OR s2.institution_id = p_inst))
      )
  ),
  totals AS (SELECT class_group_id, subject_id, count(*) AS total FROM chapter_set GROUP BY 1, 2),
  -- distinct chapters marked done (teaching) per (class, subject), across ALL teachers
  done AS (
    SELECT lp.class_id, lp.subject_id, COALESCE(lp.topic_id, ct.chapter_id) AS chapter_id
    FROM tt_lesson_plans lp
    LEFT JOIN chapter_topics ct ON ct.id = lp.chapter_topic_id
    WHERE lp.class_id = ANY(p_class_ids)
      AND lp.status = 'done' AND lp.session_type = 'teaching'
      AND COALESCE(lp.topic_id, ct.chapter_id) IS NOT NULL
    UNION
    -- Two-timeline jar (Phase 3): chapters completed at check-out/check-in also
    -- count -- closes the "more chapters than free periods that day" gap.
    SELECT e.class_id, e.subject_id, e.topic_id
    FROM syllabus_progress_events e
    WHERE e.class_id = ANY(p_class_ids) AND e.action = 'completed'
  ),
  covered AS (
    SELECT cb.class_id, cb.subject_id, count(DISTINCT d.chapter_id) AS covered
    FROM combos cb
    JOIN done d ON d.class_id = cb.class_id AND d.subject_id = cb.subject_id
    JOIN chapter_set cs ON cs.class_group_id = cb.class_group_id
      AND cs.subject_id = cb.subject_id AND cs.chapter_id = d.chapter_id
    GROUP BY 1, 2
  ),
  final AS (
    SELECT cb.class_id, cb.class_group_id, cb.class_name, cb.section, cb.subject_id,
           us.name AS subject_name,
           COALESCE(cov.covered, 0) AS covered,
           COALESCE(t.total, 0) AS total,
           CASE WHEN COALESCE(t.total, 0) > 0
                THEN round(COALESCE(cov.covered, 0) * 100.0 / t.total)::int END AS pct
    FROM combos cb
    LEFT JOIN totals t ON t.class_group_id = cb.class_group_id AND t.subject_id = cb.subject_id
    LEFT JOIN covered cov ON cov.class_id = cb.class_id AND cov.subject_id = cb.subject_id
    LEFT JOIN universal_subjects us ON us.id = cb.subject_id
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'class_id', class_id,
      'class_group_id', class_group_id,
      'class_label', class_name || COALESCE(' ' || NULLIF(section, ''), ''),
      'subject_id', subject_id,
      'subject_name', COALESCE(subject_name, 'Unknown subject'),
      'covered', covered,
      'total', total,
      'pct', pct
    ) ORDER BY (pct IS NULL), pct ASC, class_name, section, subject_name), '[]'::jsonb),
    COALESCE(sum(covered), 0)::int,
    COALESCE(sum(total), 0)::int,
    count(*)::int,
    count(*) FILTER (WHERE total > 0 AND covered >= total)::int,
    count(*) FILTER (WHERE total > 0 AND covered = 0)::int
  INTO v_rows, v_cov, v_tot, v_combos, v_full, v_none
  FROM final;

  RETURN jsonb_build_object(
    'scope', p_scope_label,
    'academic_year', v_ay_code,
    'generated_on', to_char(v_today, 'DD Mon YYYY'),
    'summary', jsonb_build_object(
      'combos', v_combos,
      'covered', v_cov,
      'total', v_tot,
      'pct', CASE WHEN v_tot > 0 THEN round(v_cov * 100.0 / v_tot)::int END,
      'fully_covered', v_full,
      'not_started', v_none
    ),
    'rows', v_rows
  );
END $$;

-- D ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.teacher_pending_lesson_days(boolean);
DROP TABLE IF EXISTS public.tt_chapter_pacing;
