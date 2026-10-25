-- Dashboard rebuild Phase 3 — Task 3
-- Flag -> task action RPCs (principal-initiated). assigner NULL or != assignee to satisfy
-- task_assignments' no_self_assignment CHECK. Cancel DELETEs the task (FKs cascade) and
-- reverts the flag to red.

CREATE OR REPLACE FUNCTION public.dash_create_task_from_flag(p_flag_id uuid, p_assignee_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flag dashboard_flags; v_inst uuid; v_assignee uuid; v_assigner uuid; v_task uuid;
        v_ttype task_type; v_prio int;
BEGIN
  SELECT * INTO v_flag FROM dashboard_flags WHERE id = p_flag_id;
  IF v_flag.id IS NULL THEN RAISE EXCEPTION 'dashboard: flag not found'; END IF;
  v_inst := public.dash_resolve_institution(v_flag.institution_id);  -- authorizes caller
  IF v_flag.task_id IS NOT NULL THEN RETURN v_flag.task_id; END IF;  -- already actioned

  v_assignee := COALESCE(p_assignee_id, public.resolve_flag_assignee(v_inst, v_flag.subject_type, v_flag.subject_key));
  v_assigner := auth.uid();
  IF v_assigner = v_assignee THEN v_assigner := NULL; END IF;
  v_ttype := CASE WHEN v_flag.category='exams' THEN 'exam_related'::task_type
                  WHEN v_flag.category='attendance' THEN 'student_support'::task_type
                  ELSE 'administrative'::task_type END;
  v_prio := CASE v_flag.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END;

  INSERT INTO tasks (institution_id,title,description,task_type,priority,status,due_date)
    VALUES (v_inst, v_flag.title, v_flag.description, v_ttype, v_prio, 'open', (CURRENT_DATE+3)::timestamptz)
    RETURNING id INTO v_task;
  IF v_assignee IS NOT NULL THEN
    INSERT INTO task_assignments (task_id,assignee_id,assigner_id) VALUES (v_task, v_assignee, v_assigner);
    INSERT INTO notifications (user_id,title,message,type,link,metadata)
      VALUES (v_assignee,'New task from dashboard', v_flag.title,'task_assigned','/tasks',
              jsonb_build_object('task_id',v_task,'flag_id',v_flag.id));
  END IF;
  UPDATE dashboard_flags SET status='amber', task_id=v_task, assignee_id=v_assignee, auto_created=false
    WHERE id = p_flag_id;
  RETURN v_task;
END $$;

CREATE OR REPLACE FUNCTION public.dash_reassign_flag_task(p_flag_id uuid, p_assignee_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flag dashboard_flags; v_inst uuid; v_assigner uuid;
BEGIN
  SELECT * INTO v_flag FROM dashboard_flags WHERE id = p_flag_id;
  IF v_flag.id IS NULL OR v_flag.task_id IS NULL THEN RAISE EXCEPTION 'dashboard: flag has no task'; END IF;
  v_inst := public.dash_resolve_institution(v_flag.institution_id);
  v_assigner := auth.uid();
  IF v_assigner = p_assignee_id THEN v_assigner := NULL; END IF;
  UPDATE task_assignments SET assignee_id = p_assignee_id, assigner_id = v_assigner WHERE task_id = v_flag.task_id;
  UPDATE dashboard_flags SET assignee_id = p_assignee_id WHERE id = p_flag_id;
  INSERT INTO notifications (user_id,title,message,type,link,metadata)
    VALUES (p_assignee_id,'Task reassigned to you', v_flag.title,'task_assigned','/tasks',
            jsonb_build_object('task_id',v_flag.task_id,'flag_id',v_flag.id));
END $$;

CREATE OR REPLACE FUNCTION public.dash_cancel_flag_task(p_flag_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_flag dashboard_flags; v_inst uuid;
BEGIN
  SELECT * INTO v_flag FROM dashboard_flags WHERE id = p_flag_id;
  IF v_flag.id IS NULL THEN RAISE EXCEPTION 'dashboard: flag not found'; END IF;
  v_inst := public.dash_resolve_institution(v_flag.institution_id);
  IF v_flag.task_id IS NOT NULL THEN
    DELETE FROM tasks WHERE id = v_flag.task_id;  -- cascades assignments/evidence/etc.
  END IF;
  UPDATE dashboard_flags SET status='red', task_id=NULL, auto_created=false, assignee_id=NULL
    WHERE id = p_flag_id;
END $$;

GRANT EXECUTE ON FUNCTION public.dash_create_task_from_flag(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_reassign_flag_task(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_cancel_flag_task(uuid) TO authenticated;
