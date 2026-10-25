-- 20260706170000_scoped_flags_tt_slots.sql
-- Follow-up to the two-timeline Phase-3 review (I3): dash_scoped_get_flags's
-- teacher-flag visibility resolved a teacher ONLY via class_assignments, but
-- SY1 (syllabus) and A7 (lateness) flags key subject_key off tt_slots.teacher_id.
-- A teacher scheduled via the timetable for a coordinator's wing class WITHOUT a
-- matching class_assignments row was therefore invisible on /school/snapshot,
-- while the admin Command Center (unscoped dash_get_flags) showed the flag.
-- Fix: also make a teacher-flag visible when the teacher teaches a scoped class
-- per tt_slots (active AY). Fixes SY1 AND the pre-existing A7 in one place.
-- Body is byte-identical to the live definition except: v_ay decl + lookup, and
-- the widened teacher branch.

CREATE OR REPLACE FUNCTION public.dash_scoped_get_flags()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_inst uuid; v_classes uuid[]; v_ctext text[]; v_rows jsonb; v_ay text;
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  v_ctext := ARRAY(SELECT x::text FROM unnest(v_classes) AS x);
  SELECT ay.code INTO v_ay FROM cal_academic_years ay
    WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'flag_code',flag_code,'category',category,'severity',severity,
           'status',status,'subject_type',subject_type,'subject_key',subject_key,'title',title,'description',description,
           'metric_value',metric_value,'context',context,'link_url',link_url,'assignee_id',assignee_id,'task_id',task_id,
           'auto_created',auto_created,'first_detected_at',first_detected_at)
           ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, first_detected_at DESC),'[]'::jsonb)
    INTO v_rows FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
    AND ( (df.subject_type='class' AND df.subject_key = ANY(v_ctext))
       OR (df.subject_type='exam' AND EXISTS(SELECT 1 FROM exam_classes ec WHERE ec.exam_id::text=df.subject_key AND ec.class_id = ANY(v_classes)))
       OR (df.subject_type='student' AND EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=df.subject_key AND ca.role='student' AND ca.class_id = ANY(v_classes)))
       OR (df.subject_type='teacher' AND (
              EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=df.subject_key AND ca.role='teacher' AND ca.class_id = ANY(v_classes))
           OR EXISTS(SELECT 1 FROM tt_slots s WHERE s.teacher_id::text=df.subject_key AND s.class_id = ANY(v_classes)
                       AND (v_ay IS NULL OR s.academic_year = v_ay))
          )) );
  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.dash_scoped_get_flags() TO authenticated;
