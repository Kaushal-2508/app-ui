-- 20260706171000_scoped_flags_review_fixes.sql
-- Adversarial-review tightenings to the tt_slots teacher-visibility clause added
-- in 20260706170000 (both strictly reduce exposure, no new visibility):
--   * Filter tt_slots to slot_type IN ('theory','practical') AND subject_id NOT
--     NULL — the exact slots SY1/A7 are computed from. Removes reliance on the
--     app-only convention that non-academic slots null out teacher_id (rollover
--     copies teacher_id verbatim, so a legacy supervisory row could otherwise
--     expose an unrelated teacher flag to a coordinator).
--   * Fail CLOSED on a NULL active AY (mirrors dash_evaluate_syllabus_flags,
--     which returns early when no AY is active): the previous `v_ay IS NULL OR`
--     was fail-open (matched any year) during a pre-rollover AY gap. Now: no
--     active AY -> tt_slots clause contributes nothing, class_assignments only.
--   * Belt-and-suspenders s.institution_id = v_inst (mirrors tt_slots RLS).
-- Everything else byte-identical to 20260706170000.

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
           OR (v_ay IS NOT NULL AND EXISTS(SELECT 1 FROM tt_slots s
                 WHERE s.teacher_id::text=df.subject_key AND s.class_id = ANY(v_classes)
                   AND s.institution_id = v_inst AND s.academic_year = v_ay
                   AND s.slot_type IN ('theory','practical') AND s.subject_id IS NOT NULL))
          )) );
  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.dash_scoped_get_flags() TO authenticated;
