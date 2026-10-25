-- =============================================================
-- Optional-group periods reach the syllabus, coverage and cover systems
-- -------------------------------------------------------------
-- Companion to 20260910160000, which made a basket period an ordinary
-- period for its teacher (one lesson plan per subject). This migration
-- fixes the READERS: every period-discovery query in the platform defined
-- "a teaching period" as
--       slot_type IN ('theory','practical') AND subject_id IS NOT NULL
-- and the teacher as tt_slots.teacher_id. A basket period is slot_type
-- 'free' with subject_id and teacher_id NULL (its subjects and their
-- teachers live in optional_group_subjects x class_assignments), so it
-- failed all three tests and was invisible to:
--
--   * teacher_pending_syllabus_days  -> the check-out gate told a teacher
--     of an optional subject "Nothing to log today. You're all set."
--   * dash_evaluate_syllabus_flags   -> the SY1 principal flag could never
--     name them (LOCKSTEP partner of the above; both are patched here, and
--     the OR-predicate they share is untouched)
--   * dash_syllabus_coverage_build   -> optional subjects were absent from
--     the coverage denominator entirely, not shown as 0%, so a school could
--     read "92% covered" with electives silently excluded
--   * dash_scoped_syllabus_coverage  -> a teacher whose whole load is
--     optional resolved to an empty scope and a blank panel
--   * teacher_/class_projection_for_range -> no chapter projection, and a
--     recorded chapter never surfaced on the week grid
--   * the attendance pass + auto-sub -> an absent optional teacher was
--     never marked absent and no cover was raised, so the class read as
--     covered while nobody was in the room
--
-- Every function below is its live prod definition with ONLY the marked
-- predicate swapped; bodies are otherwise byte-identical.
--
-- Checked in prod first: 0 slots carry a subject outside theory/practical
-- and 0 slots carry a teacher without a subject, so routing through the
-- view below drops nothing that exists today. The two attendance functions
-- deliberately keep their original arm verbatim and gain a UNION arm
-- instead, because a regression there means an unrecorded absence.
-- =============================================================

-- -------------------------------------------------------------
-- One row per (period, subject, teacher) actually delivered.
-- Ordinary slots pass through; a basket period expands to one row per
-- subject in the basket and per teacher of that subject in that class.
--
-- NOT a client surface: it is read only by the SECURITY DEFINER functions
-- below, so it is revoked from anon and authenticated. If a client ever
-- needs it, expose a DEFINER function instead of granting this view.
-- -------------------------------------------------------------
DROP VIEW IF EXISTS public.tt_effective_periods;

CREATE VIEW public.tt_effective_periods AS
  SELECT s.id, s.id AS slot_id, s.institution_id, s.class_id, s.period_slot_id,
         s.day, s.academic_year, s.slot_type, s.subject_id, s.teacher_id,
         s.resource_id, s.optional_group_id,
         false AS from_optional_group
  FROM public.tt_slots s
  WHERE s.slot_type IN ('theory','practical')
    AND s.subject_id IS NOT NULL
  UNION ALL
  SELECT s.id, s.id AS slot_id, s.institution_id, s.class_id, s.period_slot_id,
         s.day, s.academic_year, s.slot_type, ogs.subject_id, ca.user_id,
         s.resource_id, s.optional_group_id,
         true AS from_optional_group
  FROM public.tt_slots s
  JOIN public.optional_group_subjects ogs ON ogs.group_id = s.optional_group_id
  -- LEFT JOIN so a basket subject with no teacher assigned still counts
  -- toward coverage; it simply has no teacher to flag or roster.
  LEFT JOIN public.class_assignments ca ON ca.class_id = s.class_id
       AND ca.subject_id = ogs.subject_id AND ca.role = 'teacher'
  WHERE s.optional_group_id IS NOT NULL;

COMMENT ON VIEW public.tt_effective_periods IS
  'One row per (period, subject, teacher) actually delivered. Ordinary academic slots pass through; an optional-group (basket) period expands to one row per subject in the basket and per teacher of that subject in that class. Use this instead of tt_slots in any query that asks "which teaching periods exist" - filtering tt_slots on slot_type/subject_id/teacher_id silently excludes every basket period. Not granted to clients.';

REVOKE ALL ON public.tt_effective_periods FROM PUBLIC;
REVOKE ALL ON public.tt_effective_periods FROM anon;
REVOKE ALL ON public.tt_effective_periods FROM authenticated;

-- Supports the basket arm's join (and the same lookup in both attendance
-- functions). CLAUDE.md section 23: new join paths get an index.
CREATE INDEX IF NOT EXISTS idx_class_assignments_class_subject_role
  ON public.class_assignments (class_id, subject_id, role);

CREATE OR REPLACE FUNCTION public.teacher_pending_syllabus_days(p_include_today boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT 1 FROM public.tt_effective_periods s
    WHERE s.teacher_id = v_uid AND s.academic_year = v_ay
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
    FROM public.tt_effective_periods s
    JOIN public.classes c              ON c.id = s.class_id
    JOIN public.universal_subjects us  ON us.id = s.subject_id
    JOIN public.tt_class_structure cs  ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    WHERE s.teacher_id = v_uid
      AND s.academic_year = v_ay
      -- Trap-freedom: a subject with no active chapters can never be filled --
      -- never demand it. (Chapter-set resolution falls back to all active
      -- subject topics, so "has any chapter" <=> this EXISTS.)
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
           (
             EXISTS (
               SELECT 1 FROM public.syllabus_progress_events e
               WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d
             )
             -- A chapterless period (surprise test, activity) logged as a note
             -- resolves the group too. Without this the teacher cannot check
             -- out, and the only escape is to falsify a chapter completion.
             -- KEEP IN LOCKSTEP with dash_evaluate_syllabus_flags below.
             OR EXISTS (
               SELECT 1 FROM public.tt_lesson_plans lp
               WHERE lp.class_id = o.class_id AND lp.subject_id = o.subject_id
                 AND lp.date = o.d AND lp.is_note_only
             )
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
    'unresolved_day_count', (SELECT count(*) FROM pending),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(p.d, 'YYYY-MM-DD'),
        'is_today', (p.d = v_today),
        'groups', p.groups) ORDER BY p.d)
      FROM (SELECT * FROM pending ORDER BY (d = v_today) DESC, d ASC LIMIT 30) p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dash_evaluate_syllabus_flags(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay text; v_ay_end date; v_start date; v_end date;
  v_detected int := 0; v_resolved int := 0;
BEGIN
  -- Always authorize: dash_resolve_institution re-checks user_roles even when
  -- an explicit institution id is supplied (mirrors dash_evaluate_flags).
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT COALESCE(i.timezone,'Asia/Kolkata') INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT ay.code, GREATEST(ay.starts_on, v_today - 60), ay.ends_on INTO v_ay, v_start, v_ay_end
  FROM cal_academic_years ay WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
  -- Clamp to the AY end: a lapsed-but-still-active year (pre-rollover weeks)
  -- must not accrue unfilled days, or the whole staff gets falsely flagged.
  v_end := LEAST(v_today - 1, v_ay_end);
  IF v_ay IS NULL OR v_start > v_end THEN
    RETURN jsonb_build_object('detected', 0, 'resolved', 0);
  END IF;

  DROP TABLE IF EXISTS _sy;
  CREATE TEMP TABLE _sy ON COMMIT DROP AS
  WITH dd AS (SELECT d::date AS d FROM generate_series(v_start, v_end, interval '1 day') g(d)),
  slots AS (
    SELECT DISTINCT s.teacher_id, s.class_id, s.subject_id, s.day, cs.structure_id
    FROM public.tt_effective_periods s
    JOIN tt_class_structure cs ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    WHERE s.institution_id = v_inst AND s.academic_year = v_ay
      AND s.teacher_id IS NOT NULL
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
      -- KEEP IN LOCKSTEP with teacher_pending_syllabus_days above. A teacher who
      -- resolved a day by logging a note must not still be SY1-flagged to their
      -- principal for a day the product told them was done.
      AND NOT EXISTS (SELECT 1 FROM tt_lesson_plans lp
        WHERE lp.class_id = o.class_id AND lp.subject_id = o.subject_id
          AND lp.date = o.d AND lp.is_note_only)
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
END $function$;

CREATE OR REPLACE FUNCTION public.dash_syllabus_coverage_build(p_inst uuid, p_class_ids uuid[], p_combo_teacher uuid, p_scope_label text, p_class_group_id uuid, p_class_id uuid, p_subject_id uuid, p_teacher_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    FROM public.tt_effective_periods s
    JOIN classes c ON c.id = s.class_id AND c.institution_id = p_inst
    LEFT JOIN class_groups cg ON cg.id = c.class_group_id
    WHERE s.class_id = ANY(p_class_ids)
      AND s.academic_year = v_ay_code
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
    UNION ALL
    -- Two-timeline jar: chapters completed at check-out/check-in also count.
    -- UNION ALL: the consumer already count(DISTINCT)s, dedup here is waste.
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
END $function$;

CREATE OR REPLACE FUNCTION public.dash_scoped_syllabus_coverage(p_class_group_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_subject_id uuid DEFAULT NULL::uuid, p_teacher_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_inst uuid;
  v_class_ids uuid[];
  v_combo_teacher uuid := NULL;
  v_scope text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);
  IF v_inst IS NULL THEN RAISE EXCEPTION 'dashboard: no institution context'; END IF;

  -- Role precedence admin > coordinator > teacher (mirrors the scoped dashboard).
  IF EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_uid
             AND role IN ('school_admin', 'super_school_admin', 'super_admin')) THEN
    SELECT array_agg(id) INTO v_class_ids FROM classes
    WHERE institution_id = v_inst AND COALESCE(is_active, true);
    v_scope := 'institution';
  ELSIF EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_uid AND role = 'coordinator') THEN
    SELECT array_agg(DISTINCT m.class_id) INTO v_class_ids
    FROM wing_assignments wa
    JOIN wing_class_mappings m ON m.wing_id = wa.wing_id
    JOIN classes c ON c.id = m.class_id AND c.institution_id = v_inst AND COALESCE(c.is_active, true)
    WHERE wa.user_id = v_uid;
    v_scope := 'coordinator';
  ELSIF EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_uid AND role = 'teacher') THEN
    -- teacher scope derives from tt_slots (the classes the teacher is scheduled in); combos are
    -- then restricted to that teacher's (class, subject) pairs. Coverage values still aggregate
    -- every teacher's done-marks for the subject (full subject coverage, not a per-teacher slice).
    SELECT array_agg(DISTINCT x.class_id) INTO v_class_ids
    FROM (
      SELECT s.class_id
      FROM tt_slots s
      JOIN classes c ON c.id = s.class_id AND c.institution_id = v_inst AND COALESCE(c.is_active, true)
      WHERE s.teacher_id = v_uid
      UNION
      -- Optional-group (basket) periods carry no teacher of their own, so a
      -- teacher whose whole load is optional resolved to an EMPTY scope and
      -- got a blank coverage panel.
      SELECT s.class_id
      FROM tt_slots s
      JOIN classes c ON c.id = s.class_id AND c.institution_id = v_inst AND COALESCE(c.is_active, true)
      JOIN optional_group_subjects ogs ON ogs.group_id = s.optional_group_id
      JOIN class_assignments ca ON ca.class_id = s.class_id
           AND ca.subject_id = ogs.subject_id AND ca.role = 'teacher' AND ca.user_id = v_uid
      WHERE s.optional_group_id IS NOT NULL
    ) x;
    v_combo_teacher := v_uid;
    v_scope := 'teacher';
  ELSE
    RAISE EXCEPTION 'dashboard: not authorized for the scoped dashboard';
  END IF;

  RETURN public.dash_syllabus_coverage_build(
    v_inst, COALESCE(v_class_ids, ARRAY[]::uuid[]),
    v_combo_teacher, v_scope, p_class_group_id, p_class_id, p_subject_id, p_teacher_id);
END $function$;

CREATE OR REPLACE FUNCTION public.teacher_projection_for_range(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    FROM public.tt_effective_periods s
    WHERE s.teacher_id = v_uid AND s.academic_year = v_ay
  ),
  dd AS (SELECT d::date AS d FROM generate_series(v_today, v_ay_end, interval '1 day') g(d)),
  periods AS (
    SELECT s.class_id, s.subject_id, s.id AS slot_id, dd.d,
           row_number() OVER (PARTITION BY s.class_id, s.subject_id
                              ORDER BY dd.d, psl.start_time, s.id) AS rn
    FROM public.tt_effective_periods s
    JOIN grp g ON g.class_id = s.class_id AND g.subject_id = s.subject_id
    JOIN public.tt_class_structure cs ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    JOIN public.tt_period_structures ps ON ps.id = cs.structure_id
    JOIN public.tt_period_slots psl ON psl.id = s.period_slot_id
    JOIN dd ON public.tt_dow_to_text(dd.d) = s.day
           AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE s.teacher_id = v_uid AND s.academic_year = v_ay
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
$function$;

CREATE OR REPLACE FUNCTION public.class_projection_for_range(p_class_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    FROM public.tt_effective_periods s
    WHERE s.class_id = p_class_id AND s.academic_year = v_ay
  ),
  dd AS (SELECT d::date AS d FROM generate_series(v_today, v_ay_end, interval '1 day') g(d)),
  periods AS (
    SELECT s.class_id, s.subject_id, s.id AS slot_id, dd.d,
           row_number() OVER (PARTITION BY s.class_id, s.subject_id
                              ORDER BY dd.d, psl.start_time, s.id) AS rn
    FROM public.tt_effective_periods s
    JOIN grp g ON g.class_id = s.class_id AND g.subject_id = s.subject_id
    JOIN public.tt_class_structure cs ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    JOIN public.tt_period_structures ps ON ps.id = cs.structure_id
    JOIN public.tt_period_slots psl ON psl.id = s.period_slot_id
    JOIN dd ON public.tt_dow_to_text(dd.d) = s.day
           AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE s.class_id = p_class_id AND s.academic_year = v_ay
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
$function$;

CREATE OR REPLACE FUNCTION public.tt_run_attendance_pass_for_institution(p_institution_id uuid)
 RETURNS TABLE(institution_id uuid, staff_marked integer, subs_generated integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today    DATE := CURRENT_DATE;
  v_settings RECORD;
  v_tz       TEXT;
  v_marked   INT := 0;
  v_subs     INT := 0;
BEGIN
  -- Caller authorization. The cron job invokes this with no auth context
  -- (auth.uid() IS NULL) and is trusted. Otherwise require an admin or
  -- coordinator role scoped to the requested institution.
  IF auth.uid() IS NOT NULL AND NOT (
        public.has_role(auth.uid(), 'super_admin'::app_role)
     OR public.has_role(auth.uid(), 'super_school_admin'::app_role)
     OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.institution_id = p_institution_id
            AND ur.role IN ('school_admin'::app_role, 'coordinator'::app_role)
        )
  ) THEN
    RAISE EXCEPTION 'not authorized to run attendance pass for institution %', p_institution_id
      USING ERRCODE = '42501';
  END IF;

  SELECT s.staff_check_in_time,
         s.staff_late_check_in_allowed,
         s.staff_late_grace_minutes,
         s.staff_substitution_enabled,
         i.timezone
  INTO v_settings
  FROM public.attendance_settings s
  JOIN public.institutions i ON i.id = s.institution_id
  WHERE s.institution_id = p_institution_id;

  IF NOT FOUND THEN
    RETURN; -- no settings row â nothing to do
  END IF;

  v_tz := COALESCE(v_settings.timezone, 'Asia/Kolkata');

  -- Cutoff check in INSTITUTION-LOCAL time-of-day. The pre-existing cron
  -- compared (now() AT TIME ZONE 'UTC')::time to a TIME column that is
  -- stored as wall-clock â wrong for IST schools (auto-mark fired at
  -- ~14:00 IST instead of ~08:30 IST). See CLAUDE.md Â§24.
  IF (now() AT TIME ZONE v_tz)::time
       < (v_settings.staff_check_in_time
          + CASE WHEN v_settings.staff_late_check_in_allowed
                 THEN make_interval(mins => v_settings.staff_late_grace_minutes)
                 ELSE INTERVAL '0' END)
  THEN
    institution_id := p_institution_id; staff_marked := 0; subs_generated := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Holiday short-circuit (unchanged behavior).
  IF EXISTS (
    SELECT 1 FROM public.cal_events e
    WHERE e.institution_id = p_institution_id
      AND e.kind = 'holiday'
      AND v_today BETWEEN e.starts_on AND e.ends_on
  ) THEN
    institution_id := p_institution_id; staff_marked := 0; subs_generated := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Auto-mark absent for every staff member with at least one slot today
  -- and no row yet. Runs REGARDLESS of staff_substitution_enabled (the
  -- pre-existing cron coupled the two â wrong: schools that don't want
  -- auto-subs still need correct attendance).
  WITH staff_today AS (
    SELECT DISTINCT s.teacher_id AS staff_id
    FROM public.tt_slots s
    WHERE s.institution_id = p_institution_id
      AND s.day            = public.tt_dow_to_text(v_today)
      AND s.teacher_id IS NOT NULL
    UNION
    -- Optional-group (basket) periods carry no teacher of their own, so a
    -- teacher rostered only into baskets was never auto-marked absent and
    -- their class read as covered.
    SELECT DISTINCT ca.user_id AS staff_id
    FROM public.tt_slots s
    JOIN public.optional_group_subjects ogs ON ogs.group_id = s.optional_group_id
    JOIN public.class_assignments ca ON ca.class_id = s.class_id
         AND ca.subject_id = ogs.subject_id AND ca.role = 'teacher'
    WHERE s.institution_id = p_institution_id
      AND s.day            = public.tt_dow_to_text(v_today)
      AND s.optional_group_id IS NOT NULL
  ),
  inserted AS (
    INSERT INTO public.staff_attendance_records
      (institution_id, staff_id, date, status, auto_marked_absent)
    SELECT p_institution_id, st.staff_id, v_today, 'absent', TRUE
    FROM staff_today st
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_attendance_records sa
      WHERE sa.staff_id = st.staff_id AND sa.date = v_today
    )
    RETURNING staff_id
  )
  SELECT COUNT(*)::INT INTO v_marked FROM inserted;

  -- Subs only if the institution opted in.
  IF v_settings.staff_substitution_enabled THEN
    v_subs := public.tt_create_pending_subs_for_absent_staff(p_institution_id, v_today);
  END IF;

  institution_id := p_institution_id;
  staff_marked   := v_marked;
  subs_generated := v_subs;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tt_create_pending_subs_for_absent_staff(p_institution_id uuid, p_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inserted INTEGER := 0;
  v_day      TEXT := public.tt_dow_to_text(p_date);
BEGIN
  WITH absent_staff AS (
    SELECT staff_id
    FROM public.staff_attendance_records
    WHERE institution_id = p_institution_id
      AND date           = p_date
      AND status         IN ('absent','on_leave')
  ),
  inserted AS (
    INSERT INTO public.tt_substitutions
      (slot_id, date, original_teacher_id, status, source, created_by)
    SELECT x.slot_id, p_date, x.teacher_id, 'pending', 'auto', NULL
    FROM (
      SELECT s.id AS slot_id, s.teacher_id
      FROM public.tt_slots s
      JOIN absent_staff a ON a.staff_id = s.teacher_id
      WHERE s.institution_id = p_institution_id
        AND s.day            = v_day
        AND s.teacher_id IS NOT NULL
      UNION
      -- Basket periods: resolve the absent teacher through the subject she
      -- teaches inside the basket. tt_substitutions cannot yet express
      -- "cover only the Political Science half", so one pending row per
      -- period is raised for a human to sort out.
      SELECT s.id AS slot_id, ca.user_id AS teacher_id
      FROM public.tt_slots s
      JOIN public.optional_group_subjects ogs ON ogs.group_id = s.optional_group_id
      JOIN public.class_assignments ca ON ca.class_id = s.class_id
           AND ca.subject_id = ogs.subject_id AND ca.role = 'teacher'
      JOIN absent_staff a2 ON a2.staff_id = ca.user_id
      WHERE s.institution_id = p_institution_id
        AND s.day            = v_day
        AND s.optional_group_id IS NOT NULL
    ) x
    ON CONFLICT (slot_id, date) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$function$;
