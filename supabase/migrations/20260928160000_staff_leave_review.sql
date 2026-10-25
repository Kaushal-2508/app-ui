-- Staff leave: decide one rung up, and make an approval reach attendance.
--
-- Contract: docs/superpowers/specs/2026-09-26-staff-leave-workflow-design.md
-- (Naman's frontend on naman-erp calls review_staff_leave and probes for it
-- with p_decision = 'probe'). Differences from the spec's draft, all
-- deliberate:
--   * Leave days are the school's WORKING days only: the weekdays in the
--     institution's period structures (Mon to Sat when it has none), minus
--     cal_events holidays. The draft wrote a row for every calendar date, so a
--     Monday-to-Monday leave charged the balance 8 days and put "On leave" on
--     Sundays. The attendance pass never marks anyone on those days either.
--   * Balances move by the days actually written, not the calendar span, so
--     approve-then-overturn always gives back exactly what it took.
--   * Deciding the status a request already has is a no-op, so a double
--     submit or a stale second click can never charge the balance twice.
--   * Overturning an approval turns the leave's PAST days back to absent (the
--     person did not come and the leave no longer covers it) and removes the
--     rows for today and later, which the attendance pass then owns again.
--   * A coordinator reviewer must hold the coordinator role in the school,
--     not just a wing_assignments row (is_coordinator_for_class checks
--     neither, CLAUDE.md skill teacher-authority-scope).
--   * The request row is locked for the decision, so two reviewers deciding
--     at once serialise instead of both applying.
-- "Admins full access staff leave requests" is left as it is here: the live
-- HR & Payroll panel still approves with a direct UPDATE. It is narrowed to
-- SELECT in a follow-up migration once the frontend that moves that panel
-- onto this RPC is deployed (CLAUDE.md §2 ship order).

-- ── 1. The school's working days in a window ─────────────────────────────
CREATE OR REPLACE FUNCTION public._staff_leave_workdays(p_institution uuid, p_from date, p_to date)
RETURNS SETOF date
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH wd AS (
    SELECT COALESCE(
      (SELECT array_agg(DISTINCT d)
         FROM public.tt_period_structures ps, unnest(ps.working_days) d
        WHERE ps.institution_id = p_institution),
      ARRAY['monday','tuesday','wednesday','thursday','friday','saturday']
    ) AS days
  )
  SELECT g::date
    FROM wd, generate_series(p_from, p_to, interval '1 day') g
   WHERE public.tt_dow_to_text(g::date) = ANY (wd.days)
     AND NOT EXISTS (
       SELECT 1 FROM public.cal_events e
        WHERE e.institution_id = p_institution
          AND e.kind = 'holiday'
          AND g::date BETWEEN e.starts_on AND e.ends_on)
   ORDER BY 1;
$$;

-- ── 2. Who may decide whose leave ────────────────────────────────────────
-- teacher      -> any school admin, or a coordinator of a wing holding one of
--                 the teacher's classes
-- coordinator  -> a school admin
-- school admin -> another school admin
-- Never yourself. Super admins may decide anything.
CREATE OR REPLACE FUNCTION public.can_review_staff_leave(_reviewer uuid, _requester uuid, _institution uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _reviewer IS NOT NULL AND _requester IS NOT NULL AND _institution IS NOT NULL
     AND _reviewer <> _requester
     AND (
       public.is_super_admin(_reviewer)
       OR public.is_institution_admin(_reviewer, _institution)
       OR (
         -- coordinator rung: only for a requester who is neither an admin nor
         -- a coordinator, and only through a wing that holds their classes
         EXISTS (SELECT 1 FROM public.user_roles r
                  WHERE r.user_id = _reviewer AND r.institution_id = _institution
                    AND r.role = 'coordinator')
         AND NOT public.is_institution_admin(_requester, _institution)
         AND NOT EXISTS (SELECT 1 FROM public.user_roles r
                          WHERE r.user_id = _requester AND r.institution_id = _institution
                            AND r.role = 'coordinator')
         AND EXISTS (
           SELECT 1
             FROM public.class_assignments ca
             JOIN public.classes cl ON cl.id = ca.class_id AND cl.institution_id = _institution
             JOIN public.wing_class_mappings wcm ON wcm.class_id = ca.class_id
             JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
            WHERE ca.user_id = _requester AND ca.role = 'teacher'
              AND wa.user_id = _reviewer)
       )
     );
$$;

-- ── 3. Write / undo the attendance a leave covers (internal) ─────────────
CREATE OR REPLACE FUNCTION public._staff_leave_apply_days(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req    public.staff_leave_requests%ROWTYPE;
  v_marker text;
  v_date   date;
  v_marked int := 0;
  v_skipped int := 0;
BEGIN
  SELECT * INTO v_req FROM public.staff_leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('marked', 0, 'skipped', 0); END IF;
  v_marker := 'Approved leave ' || v_req.id;

  FOR v_date IN SELECT * FROM public._staff_leave_workdays(v_req.institution_id, v_req.start_date, v_req.end_date) LOOP
    -- A day the person actually worked (present / late) or a holiday row is
    -- left alone; an absent row is overwritten, because that absence is what
    -- the leave explains.
    INSERT INTO public.staff_attendance_records
           (institution_id, staff_id, date, status, auto_marked_absent, check_in_at, remarks)
    VALUES (v_req.institution_id, v_req.user_id, v_date, 'on_leave', false, NULL, v_marker)
    ON CONFLICT (staff_id, date) DO UPDATE
       SET status = 'on_leave', auto_marked_absent = false, remarks = EXCLUDED.remarks, updated_at = now()
     WHERE public.staff_attendance_records.status IN ('absent', 'on_leave');
    IF FOUND THEN v_marked := v_marked + 1; ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  -- Balances are optional (HR sets them); only the three tracked types move.
  IF v_marked > 0 AND v_req.leave_type IN ('annual', 'sick', 'casual') THEN
    UPDATE public.staff_leave_balances b
       SET annual_used = annual_used + CASE WHEN v_req.leave_type = 'annual' THEN v_marked ELSE 0 END,
           sick_used   = sick_used   + CASE WHEN v_req.leave_type = 'sick'   THEN v_marked ELSE 0 END,
           casual_used = casual_used + CASE WHEN v_req.leave_type = 'casual' THEN v_marked ELSE 0 END,
           updated_at  = now()
     WHERE b.user_id = v_req.user_id AND b.institution_id = v_req.institution_id
       AND b.academic_year = (SELECT max(academic_year) FROM public.staff_leave_balances
                               WHERE user_id = v_req.user_id AND institution_id = v_req.institution_id);
  END IF;

  RETURN jsonb_build_object('marked', v_marked, 'skipped', v_skipped);
END;
$$;

CREATE OR REPLACE FUNCTION public._staff_leave_revert_days(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_req     public.staff_leave_requests%ROWTYPE;
  v_marker  text;
  v_today   date;
  v_past    int := 0;
  v_future  int := 0;
BEGIN
  SELECT * INTO v_req FROM public.staff_leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('reverted', 0, 'removed', 0); END IF;
  v_marker := 'Approved leave ' || v_req.id;
  SELECT (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date INTO v_today
    FROM public.institutions i WHERE i.id = v_req.institution_id;

  -- Past days: they did not come and the leave no longer covers it.
  UPDATE public.staff_attendance_records
     SET status = 'absent', auto_marked_absent = false,
         remarks = 'Leave ' || v_req.id || ' not approved', updated_at = now()
   WHERE staff_id = v_req.user_id AND status = 'on_leave' AND remarks = v_marker
     AND date < v_today;
  GET DIAGNOSTICS v_past = ROW_COUNT;

  -- Today and later: hand the day back to the attendance pass.
  DELETE FROM public.staff_attendance_records
   WHERE staff_id = v_req.user_id AND status = 'on_leave' AND remarks = v_marker
     AND date >= v_today;
  GET DIAGNOSTICS v_future = ROW_COUNT;

  IF v_past + v_future > 0 AND v_req.leave_type IN ('annual', 'sick', 'casual') THEN
    UPDATE public.staff_leave_balances b
       SET annual_used = greatest(0, annual_used - CASE WHEN v_req.leave_type = 'annual' THEN v_past + v_future ELSE 0 END),
           sick_used   = greatest(0, sick_used   - CASE WHEN v_req.leave_type = 'sick'   THEN v_past + v_future ELSE 0 END),
           casual_used = greatest(0, casual_used - CASE WHEN v_req.leave_type = 'casual' THEN v_past + v_future ELSE 0 END),
           updated_at  = now()
     WHERE b.user_id = v_req.user_id AND b.institution_id = v_req.institution_id
       AND b.academic_year = (SELECT max(academic_year) FROM public.staff_leave_balances
                               WHERE user_id = v_req.user_id AND institution_id = v_req.institution_id);
  END IF;

  RETURN jsonb_build_object('reverted', v_past, 'removed', v_future);
END;
$$;

-- ── 4. The decision RPC ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.review_staff_leave(p_request_id uuid, p_decision text, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_req  public.staff_leave_requests%ROWTYPE;
  v_inst uuid;
  v_days int;
  v_res  jsonb := '{}'::jsonb;
BEGIN
  -- FIRST statement, before any read: the frontend probes for this function
  -- with p_decision = 'probe' and relies on it raising with no side effects.
  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision USING ERRCODE = '22023';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.staff_leave_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found' USING ERRCODE = 'P0002';
  END IF;

  -- The requester's real school comes from their profile, never from the
  -- request row alone.
  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_req.user_id;
  IF v_inst IS NULL OR v_inst <> v_req.institution_id THEN
    RAISE EXCEPTION 'This request does not belong to the requester''s school' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_review_staff_leave(v_uid, v_req.user_id, v_inst) THEN
    RAISE EXCEPTION 'You are not allowed to decide this leave request' USING ERRCODE = '42501';
  END IF;

  -- Same decision again: nothing to do (a double submit lands here).
  IF v_req.status = p_decision THEN
    RETURN jsonb_build_object('status', p_decision, 'unchanged', true);
  END IF;

  v_days := (v_req.end_date - v_req.start_date) + 1;
  IF v_days < 1 OR v_days > 61 THEN
    RAISE EXCEPTION 'A leave request can cover at most 60 days' USING ERRCODE = '22023';
  END IF;

  UPDATE public.staff_leave_requests
     SET status = p_decision, reviewed_by = v_uid, reviewed_at = now(),
         reviewer_notes = NULLIF(btrim(COALESCE(p_notes, '')), ''), updated_at = now()
   WHERE id = p_request_id;

  IF p_decision = 'approved' THEN
    v_res := public._staff_leave_apply_days(p_request_id);
  ELSIF v_req.status = 'approved' THEN
    -- Overturning an approval: undo exactly what it wrote.
    v_res := public._staff_leave_revert_days(p_request_id);
  END IF;

  RETURN jsonb_build_object('status', p_decision, 'unchanged', false) || v_res;
END;
$$;

-- ── 5. Grants (anon holds EXECUTE by default privileges; revoke by name) ──
REVOKE ALL ON FUNCTION public._staff_leave_workdays(uuid, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._staff_leave_workdays(uuid, date, date) FROM anon;
REVOKE ALL ON FUNCTION public._staff_leave_workdays(uuid, date, date) FROM authenticated;
REVOKE ALL ON FUNCTION public._staff_leave_apply_days(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._staff_leave_apply_days(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._staff_leave_apply_days(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public._staff_leave_revert_days(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._staff_leave_revert_days(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._staff_leave_revert_days(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.can_review_staff_leave(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_review_staff_leave(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_review_staff_leave(uuid, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.review_staff_leave(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_staff_leave(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_staff_leave(uuid, text, text) TO authenticated, service_role;

-- ── 6. Policies: no more self-UPDATE, coordinators see their wing ────────
-- The old "Staff manage own leave requests" was FOR ALL on the owner's rows:
-- a teacher could approve their own leave from the browser console, and a
-- withdraw could delete an already-approved request.
DROP POLICY IF EXISTS "Staff manage own leave requests" ON public.staff_leave_requests;

CREATE POLICY "Staff apply for own leave" ON public.staff_leave_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND status = 'pending'
    AND reviewed_by IS NULL AND reviewed_at IS NULL
    AND institution_id = public.get_user_institution((select auth.uid()))
  );

CREATE POLICY "Staff view own leave" ON public.staff_leave_requests
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY "Staff withdraw own pending leave" ON public.staff_leave_requests
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) AND status = 'pending');

CREATE POLICY "Reviewers view scoped staff leave" ON public.staff_leave_requests
  FOR SELECT TO authenticated
  USING (public.can_review_staff_leave((select auth.uid()), user_id, institution_id));

-- ── 7. Indexes (the table had only its primary key) ──────────────────────
CREATE INDEX IF NOT EXISTS staff_leave_requests_institution_status_idx
  ON public.staff_leave_requests (institution_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_leave_requests_user_idx
  ON public.staff_leave_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_leave_requests_reviewed_by_idx
  ON public.staff_leave_requests (reviewed_by);

-- ── 8. Backfill: approvals made before this RPC existed wrote no attendance ─
DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT q.id FROM public.staff_leave_requests q
     WHERE q.status = 'approved'
       AND NOT EXISTS (SELECT 1 FROM public.staff_attendance_records a
                        WHERE a.staff_id = q.user_id AND a.remarks = 'Approved leave ' || q.id)
  LOOP
    PERFORM public._staff_leave_apply_days(r.id);
  END LOOP;
END
$backfill$;
