-- Lesson-plan delivery export for coordinators + admins (Timetable tab).
-- Read-only SECURITY DEFINER. Scope is resolved SERVER-SIDE from the caller's role +
-- wing assignment by reusing public.tt_user_can_edit_class_slots(user, class)
-- (super_admin -> all; school_admin/super_school_admin -> their institution;
-- coordinator -> wing classes via wing_class_mappings x wing_assignments).
-- One implementation, scope-driven — admin differs only by having no wing restriction.
-- No schema changes; reads tt_slots / tt_lesson_plans / tt_substitutions /
-- staff_attendance_records / syllabus_topics / topic_class_mappings / chapter_topics.

-- Scoped filter options for the export dialog dropdowns (in-scope only).
CREATE OR REPLACE FUNCTION public.tt_lesson_plan_export_filters(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_super boolean;
  v_is_admin boolean;
  v_inst uuid;
  v_ay_code text;
  v_class_ids uuid[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_is_super := has_role(v_uid, 'super_admin');
  v_is_admin := v_is_super OR has_role(v_uid, 'school_admin') OR has_role(v_uid, 'super_school_admin');
  v_inst := CASE WHEN v_is_super THEN COALESCE(p_institution_id, get_user_institution(v_uid))
                 ELSE get_user_institution(v_uid) END;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'no institution context'; END IF;
  IF NOT (v_is_admin OR has_role(v_uid, 'coordinator')) THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT code INTO v_ay_code FROM cal_academic_years
  WHERE institution_id = v_inst
  ORDER BY ((now()::date) BETWEEN starts_on AND ends_on) DESC, is_active DESC, starts_on DESC LIMIT 1;

  SELECT array_agg(c.id) INTO v_class_ids
  FROM classes c
  WHERE c.institution_id = v_inst AND COALESCE(c.is_active, true)
    AND public.tt_user_can_edit_class_slots(v_uid, c.id);

  RETURN jsonb_build_object(
    'academic_year', v_ay_code,
    'class_groups', (
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', cg.id, 'name', cg.name)), '[]'::jsonb)
      FROM classes c JOIN class_groups cg ON cg.id = c.class_group_id
      WHERE c.id = ANY(v_class_ids)),
    'sections', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
                'id', c.id, 'class', COALESCE(cg.name, c.name), 'section', c.section,
                'class_group_id', c.class_group_id) ORDER BY COALESCE(cg.name, c.name), c.section), '[]'::jsonb)
      FROM classes c LEFT JOIN class_groups cg ON cg.id = c.class_group_id
      WHERE c.id = ANY(v_class_ids)),
    'teachers', (
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', p.id, 'name', p.full_name)), '[]'::jsonb)
      FROM tt_slots s JOIN profiles p ON p.id = s.teacher_id
      WHERE s.class_id = ANY(v_class_ids) AND s.teacher_id IS NOT NULL AND s.academic_year = v_ay_code),
    'subjects', (
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', us.id, 'name', us.name)), '[]'::jsonb)
      FROM tt_slots s JOIN universal_subjects us ON us.id = s.subject_id
      WHERE s.class_id = ANY(v_class_ids) AND s.subject_id IS NOT NULL AND s.academic_year = v_ay_code)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.tt_lesson_plan_export_filters(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.tt_lesson_plan_export(
  p_period text DEFAULT 'month',       -- 'week' | 'month' | 'year'
  p_class_group_id uuid DEFAULT NULL,  -- "class" filter
  p_class_id uuid DEFAULT NULL,        -- "section" filter
  p_teacher_id uuid DEFAULT NULL,
  p_subject_id uuid DEFAULT NULL,
  p_institution_id uuid DEFAULT NULL   -- super_admin managing-institution only
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_super boolean;
  v_is_admin boolean;
  v_inst uuid;
  v_tz text;
  v_today date;
  v_from date;
  v_to date;
  v_ay_code text; v_ay_start date; v_ay_end date;
  v_period_label text;
  v_class_ids uuid[];
  v_inst_name text;
  v_delivery jsonb;
  v_chapter jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_is_super := has_role(v_uid, 'super_admin');
  v_is_admin := v_is_super OR has_role(v_uid, 'school_admin') OR has_role(v_uid, 'super_school_admin');
  v_inst := CASE WHEN v_is_super THEN COALESCE(p_institution_id, get_user_institution(v_uid))
                 ELSE get_user_institution(v_uid) END;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'no institution context'; END IF;
  IF NOT (v_is_admin OR has_role(v_uid, 'coordinator')) THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT timezone, name INTO v_tz, v_inst_name FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT code, starts_on, ends_on INTO v_ay_code, v_ay_start, v_ay_end
  FROM cal_academic_years WHERE institution_id = v_inst
  ORDER BY (v_today BETWEEN starts_on AND ends_on) DESC, is_active DESC, starts_on DESC LIMIT 1;

  IF p_period = 'week' THEN
    v_from := date_trunc('week', v_today)::date; v_to := v_today; v_period_label := 'This week';
  ELSIF p_period = 'year' THEN
    v_from := COALESCE(v_ay_start, date_trunc('year', v_today)::date);
    v_to := COALESCE(v_ay_end, v_today); v_period_label := 'Academic year ' || COALESCE(v_ay_code, '');
  ELSE
    v_from := date_trunc('month', v_today)::date; v_to := v_today; v_period_label := 'This month';
  END IF;

  -- Resolve the in-scope sections ONCE, reusing the shared scope helper + optional filters.
  SELECT array_agg(c.id) INTO v_class_ids
  FROM classes c
  WHERE c.institution_id = v_inst AND COALESCE(c.is_active, true)
    AND public.tt_user_can_edit_class_slots(v_uid, c.id)
    AND (p_class_id IS NULL OR c.id = p_class_id)
    AND (p_class_group_id IS NULL OR c.class_group_id = p_class_group_id);

  -- ===== Sheet 1: delivery log — every PAST weekday occurrence of each academic slot =====
  WITH base_slots AS (
    SELECT s.id AS slot_id, s.class_id, s.subject_id, s.teacher_id, s.day,
           ps.label AS period_label, ps.period_number,
           COALESCE(cg.name, c.name) AS class_name, c.section
    FROM tt_slots s
    JOIN classes c ON c.id = s.class_id
    LEFT JOIN class_groups cg ON cg.id = c.class_group_id
    JOIN tt_period_slots ps ON ps.id = s.period_slot_id
    WHERE s.class_id = ANY(v_class_ids)
      AND s.academic_year = v_ay_code
      AND s.teacher_id IS NOT NULL AND s.subject_id IS NOT NULL
      AND (p_teacher_id IS NULL OR s.teacher_id = p_teacher_id)
      AND (p_subject_id IS NULL OR s.subject_id = p_subject_id)
  ),
  dates AS (
    SELECT d::date AS dt
    FROM generate_series(v_from, LEAST(v_to, v_today), interval '1 day') d
    WHERE d::date < v_today
  ),
  occ AS (
    SELECT bs.*, dt.dt AS slot_date
    FROM base_slots bs
    JOIN dates dt ON lower(trim(to_char(dt.dt, 'FMday'))) = bs.day
  ),
  rows AS (
    SELECT
      tp.full_name AS teacher, o.class_name, o.section, us.name AS subject,
      o.slot_date,
      COALESCE(o.period_label, 'Period ' || o.period_number) AS period,
      COALESCE(st_direct.topic_name, st_via_ct.topic_name) AS chapter,
      lp.note AS teacher_note,
      (lp.id IS NOT NULL) AS filled,
      subt.full_name AS substitute_name,
      sa.status AS att_status
    FROM occ o
    LEFT JOIN tt_lesson_plans lp ON lp.slot_id = o.slot_id AND lp.date = o.slot_date
    LEFT JOIN syllabus_topics st_direct ON st_direct.id = lp.topic_id
    LEFT JOIN chapter_topics ct ON ct.id = lp.chapter_topic_id
    LEFT JOIN syllabus_topics st_via_ct ON st_via_ct.id = ct.chapter_id
    LEFT JOIN tt_substitutions subs ON subs.slot_id = o.slot_id AND subs.date = o.slot_date
         AND subs.status IN ('assigned', 'completed') AND subs.substitute_teacher_id IS NOT NULL
    LEFT JOIN profiles subt ON subt.id = subs.substitute_teacher_id
    LEFT JOIN profiles tp ON tp.id = o.teacher_id
    LEFT JOIN universal_subjects us ON us.id = o.subject_id
    LEFT JOIN staff_attendance_records sa ON sa.staff_id = o.teacher_id AND sa.date = o.slot_date AND sa.institution_id = v_inst
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'teacher', COALESCE(teacher, '—'),
    'class', class_name, 'section', COALESCE(section, ''),
    'subject', COALESCE(subject, '—'),
    'date', to_char(slot_date, 'DD Mon YYYY'),
    'period', period,
    'chapter', chapter,
    'notes', NULLIF(btrim(concat_ws(' · ',
                NULLIF(btrim(coalesce(teacher_note, '')), ''),
                CASE WHEN substitute_name IS NOT NULL THEN 'Covered by ' || substitute_name END), ' · '), ''),
    'fill_status', CASE WHEN filled THEN 'Filled' ELSE 'Not Filled' END,
    'present', CASE
                 WHEN substitute_name IS NOT NULL THEN 'Substitute'
                 WHEN att_status = 'present' THEN 'Present'
                 WHEN att_status = 'late' THEN 'Present (late)'
                 WHEN att_status = 'absent' THEN 'Absent'
                 WHEN att_status = 'on_leave' THEN 'On leave'
                 WHEN att_status = 'holiday' THEN 'Holiday'
                 ELSE 'No record' END
  ) ORDER BY teacher, class_name, section, subject, slot_date, period), '[]'::jsonb)
  INTO v_delivery FROM rows;

  -- ===== Sheet 2: chapter delivery percentage (cumulative to today; ignores period) =====
  WITH combos AS (
    SELECT DISTINCT s.teacher_id, s.class_id, s.subject_id, c.class_group_id,
           COALESCE(cg.name, c.name) AS class_name, c.section
    FROM tt_slots s
    JOIN classes c ON c.id = s.class_id
    LEFT JOIN class_groups cg ON cg.id = c.class_group_id
    WHERE s.class_id = ANY(v_class_ids)
      AND s.academic_year = v_ay_code
      AND s.teacher_id IS NOT NULL AND s.subject_id IS NOT NULL
      AND (p_teacher_id IS NULL OR s.teacher_id = p_teacher_id)
      AND (p_subject_id IS NULL OR s.subject_id = p_subject_id)
  ),
  cg_subj AS (SELECT DISTINCT class_group_id, subject_id FROM combos),
  -- denominator chapter set: class-group mapped chapters if any exist for the subject, else all active subject chapters
  chapter_set AS (
    SELECT cs.class_group_id, cs.subject_id, st.id AS chapter_id
    FROM cg_subj cs
    JOIN syllabus_topics st ON st.is_active AND st.subject_id = cs.subject_id
      AND (
        EXISTS (SELECT 1 FROM topic_class_mappings tcm WHERE tcm.class_group_id = cs.class_group_id AND tcm.topic_id = st.id)
        OR NOT EXISTS (
          SELECT 1 FROM topic_class_mappings t2 JOIN syllabus_topics s2 ON s2.id = t2.topic_id
          WHERE t2.class_group_id = cs.class_group_id AND s2.is_active AND s2.subject_id = cs.subject_id)
      )
  ),
  totals AS (SELECT class_group_id, subject_id, count(*) AS total FROM chapter_set GROUP BY 1, 2),
  delivered AS (
    SELECT lp.class_id, lp.subject_id, slot.teacher_id,
           COALESCE(lp.topic_id, ct.chapter_id) AS chapter_id
    FROM tt_lesson_plans lp
    JOIN tt_slots slot ON slot.id = lp.slot_id
    LEFT JOIN chapter_topics ct ON ct.id = lp.chapter_topic_id
    LEFT JOIN staff_attendance_records sa ON sa.staff_id = slot.teacher_id AND sa.date = lp.date AND sa.institution_id = v_inst
    LEFT JOIN tt_substitutions subs ON subs.slot_id = lp.slot_id AND subs.date = lp.date
         AND subs.status IN ('assigned', 'completed') AND subs.substitute_teacher_id IS NOT NULL
    WHERE lp.class_id = ANY(v_class_ids)
      AND lp.date < v_today
      AND COALESCE(lp.topic_id, ct.chapter_id) IS NOT NULL
      AND (sa.status IN ('present', 'late') OR subs.id IS NOT NULL)
      AND (p_teacher_id IS NULL OR slot.teacher_id = p_teacher_id)
      AND (p_subject_id IS NULL OR lp.subject_id = p_subject_id)
  ),
  delivered_in_set AS (
    SELECT cb.teacher_id, cb.class_id, cb.subject_id, count(DISTINCT d.chapter_id) AS delivered
    FROM combos cb
    JOIN delivered d ON d.teacher_id = cb.teacher_id AND d.class_id = cb.class_id AND d.subject_id = cb.subject_id
    JOIN chapter_set cs ON cs.class_group_id = cb.class_group_id AND cs.subject_id = cb.subject_id AND cs.chapter_id = d.chapter_id
    GROUP BY 1, 2, 3
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'teacher', COALESCE(tp.full_name, '—'),
    'class', cb.class_name, 'section', COALESCE(cb.section, ''),
    'subject', COALESCE(us.name, '—'),
    'chapters_delivered', COALESCE(dis.delivered, 0),
    'total_chapters', COALESCE(t.total, 0),
    'percentage', CASE WHEN COALESCE(t.total, 0) > 0
                       THEN round(COALESCE(dis.delivered, 0) * 100.0 / t.total)::int
                       ELSE NULL END
  ) ORDER BY tp.full_name, cb.class_name, cb.section, us.name), '[]'::jsonb)
  INTO v_chapter
  FROM combos cb
  LEFT JOIN totals t ON t.class_group_id = cb.class_group_id AND t.subject_id = cb.subject_id
  LEFT JOIN delivered_in_set dis ON dis.teacher_id = cb.teacher_id AND dis.class_id = cb.class_id AND dis.subject_id = cb.subject_id
  LEFT JOIN profiles tp ON tp.id = cb.teacher_id
  LEFT JOIN universal_subjects us ON us.id = cb.subject_id;

  RETURN jsonb_build_object(
    'meta', jsonb_build_object(
      'period', p_period, 'period_label', v_period_label,
      'from', to_char(v_from, 'DD Mon YYYY'), 'to', to_char(LEAST(v_to, v_today), 'DD Mon YYYY'),
      'generated_on', to_char(v_today, 'DD Mon YYYY'), 'academic_year', v_ay_code,
      'institution', v_inst_name,
      'scope', CASE WHEN v_is_admin THEN 'institution' ELSE 'coordinator' END
    ),
    'delivery_log', v_delivery,
    'chapter_delivery', v_chapter
  );
END $$;

GRANT EXECUTE ON FUNCTION public.tt_lesson_plan_export(text, uuid, uuid, uuid, uuid, uuid) TO authenticated;
