-- Syllabus Coverage analytics for the admin Command Center + the coordinator/teacher
-- scoped snapshot. Read-only, additive: no tables/columns added, nothing dropped or renamed.
--
-- Metric (single source of truth for all three views):
--   Syllabus Coverage for a (class-section, subject)
--     = DISTINCT syllabus_topics (chapters) marked done via tt_lesson_plans
--       / total syllabus_topics applicable to that subject + class-group
--     expressed 0-100, rounded.
--   * "done" mirrors the canonical coverage library (src/lib/syllabusCoverage.ts):
--     a tt_lesson_plans row with status='done' AND session_type='teaching'. The chapter is
--     COALESCE(topic_id -> syllabus_topics, chapter_topics.chapter_id via chapter_topic_id),
--     matching tt_lesson_plan_export. Binary; no pacing/expected_hours fractions.
--   * The subject is ONE entity: coverage aggregates EVERY teacher's done-marks for the
--     (class, subject). It is never split per teacher.
--   * Denominator mirrors tt_lesson_plan_export exactly: class-group mapped chapters
--     (topic_class_mappings -> syllabus_topics) when any exist for the subject, else all
--     active syllabus_topics for the subject. Institution-scoped + global topics
--     (institution_id IS NULL) included; other institutions' topics excluded (SECURITY
--     DEFINER bypasses RLS, so the filter is explicit here).
--
-- Scope is resolved SERVER-SIDE: admin -> whole institution; coordinator -> wing classes
-- (wing_assignments x wing_class_mappings); teacher -> only the (class, subject) combos the
-- teacher is scheduled for in tt_slots (per spec, NOT class_assignments). The shared
-- dash_resolve_scoped_classes() is deliberately NOT modified (it feeds every other scoped
-- panel); this RPC resolves teacher scope itself.

-- ============ shared rollup core (internal: NOT granted to authenticated) ============
-- Builds the coverage payload for a pre-authorised institution + class-set. Kept private so a
-- client cannot pass an arbitrary institution/class-set; only the two SECURITY DEFINER wrappers
-- (which run as the owner) invoke it after resolving + authorising scope.
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

-- ============ institution scope (admin Command Center) ============
CREATE OR REPLACE FUNCTION public.dash_syllabus_coverage(
  p_class_group_id uuid DEFAULT NULL,
  p_class_id uuid DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_teacher_id uuid DEFAULT NULL,
  p_institution_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid;
  v_class_ids uuid[];
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);  -- admin-only; RAISES otherwise
  SELECT array_agg(id) INTO v_class_ids FROM classes
  WHERE institution_id = v_inst AND COALESCE(is_active, true);
  RETURN public.dash_syllabus_coverage_build(
    v_inst, COALESCE(v_class_ids, ARRAY[]::uuid[]),
    NULL, 'institution', p_class_group_id, p_class_id, p_subject_id, p_teacher_id);
END $$;

-- ============ scoped (coordinator wing / teacher tt_slots) ============
CREATE OR REPLACE FUNCTION public.dash_scoped_syllabus_coverage(
  p_class_group_id uuid DEFAULT NULL,
  p_class_id uuid DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_teacher_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    SELECT array_agg(DISTINCT s.class_id) INTO v_class_ids
    FROM tt_slots s
    JOIN classes c ON c.id = s.class_id AND c.institution_id = v_inst AND COALESCE(c.is_active, true)
    WHERE s.teacher_id = v_uid;
    v_combo_teacher := v_uid;
    v_scope := 'teacher';
  ELSE
    RAISE EXCEPTION 'dashboard: not authorized for the scoped dashboard';
  END IF;

  RETURN public.dash_syllabus_coverage_build(
    v_inst, COALESCE(v_class_ids, ARRAY[]::uuid[]),
    v_combo_teacher, v_scope, p_class_group_id, p_class_id, p_subject_id, p_teacher_id);
END $$;

GRANT EXECUTE ON FUNCTION public.dash_syllabus_coverage(uuid, uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_scoped_syllabus_coverage(uuid, uuid, uuid, uuid) TO authenticated;
