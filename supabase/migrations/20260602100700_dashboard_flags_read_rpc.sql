-- Dashboard rebuild Phase 1 — Task 15
-- Flags read RPC. Returns [] until the Phase 3 evaluator populates dashboard_flags.

CREATE OR REPLACE FUNCTION public.dash_get_flags(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'flag_code', flag_code, 'category', category, 'severity', severity,
           'status', status, 'subject_type', subject_type, 'subject_key', subject_key,
           'title', title, 'description', description, 'metric_value', metric_value,
           'context', context, 'link_url', link_url, 'assignee_id', assignee_id,
           'task_id', task_id, 'auto_created', auto_created, 'first_detected_at', first_detected_at)
           ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                    first_detected_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM dashboard_flags WHERE institution_id = v_inst AND resolved_at IS NULL;
  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.dash_get_flags(uuid) TO authenticated;
