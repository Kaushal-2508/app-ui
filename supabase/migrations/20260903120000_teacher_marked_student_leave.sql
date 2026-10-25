-- Teacher-marked student leave (2026-09-03)
-- ============================================================================
-- A student can now get leave two ways: by applying for it (the existing
-- `leave_requests` flow), or by a teacher marking it straight from the daily
-- attendance roster. Both land in the same place, so downstream code cannot
-- tell them apart: an approved `leave_requests` row plus an
-- `attendance_records` row with the new `leave` status.
--
-- This SUPERSEDES locked decision #2 of
-- docs/superpowers/specs/2026-07-06-late-removal-and-student-leave-workflow-design.md
-- ("approved leave marks the day as `present`"). Product call 2026-09-03:
-- leave becomes its own status so the roster can show it as a third state and
-- it drops out of the attendance percentage instead of inflating it. The
-- dash_* aggregates are amended in the same apply so no dashboard number
-- changes (see part 8) - only the student-facing
-- present/(present+absent) percentage moves, which is the intent.

-- ── 1. `leave` becomes a legal student attendance status ────────────────────
-- 'late' was deliberately removed from this plane in 2026-07 and stays out.
ALTER TABLE public.attendance_records
  DROP CONSTRAINT attendance_records_status_check;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_status_check
  CHECK (status IN ('present','absent','leave','sick','casual','holiday'));

-- ── 2. Tell a teacher-marked leave from a student's application ─────────────
-- Nothing in the schema could distinguish them before, so the student's own
-- "My leave requests" list would show a leave they never applied for with no
-- explanation. `reviewed_by` already records WHO approved it; `source`
-- records who started it.
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'student';
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_source_check;
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_source_check CHECK (source IN ('student','staff'));

-- Every pre-existing row is a student application (the only INSERT path that
-- existed), which the column default already gives them.

-- Supports the "is this date already covered by an approved leave?" probe that
-- runs once per leave-marked student on every roster save.
CREATE INDEX IF NOT EXISTS idx_leave_requests_student_dates
  ON public.leave_requests (student_id, status, start_date, end_date);

-- ── 3. Let an authorized leave decision escape the roster edit window ───────
-- THE BUG THIS FIXES: `enforce_student_attendance_edit_window` fires inside
-- `review_student_leave` too, because SECURITY DEFINER does not change
-- auth.uid(). Since the trigger landed (2026-08-11) a teacher or coordinator
-- approving a leave for tomorrow hit "Attendance cannot be marked for a
-- future date", and one older than the window hit "Attendance older than N
-- days...", aborting the WHOLE decision - the leave_requests update, every
-- attendance row and the notification. ApplyLeaveSheet's `min={TODAY()}`
-- makes future-dated leave the encouraged student flow, so this was reachable
-- with the pending requests sitting in prod right now.
--
-- A leave decision is legitimately retroactive and forward-dated, and it must
-- be able to update a row another teacher marked. The two leave RPCs raise
-- this transaction-local flag before writing. Nothing reachable over
-- PostgREST can set a GUC, so a client cannot forge it, and the flag relaxes
-- only the window - never the authority checks in the RPCs themselves.
CREATE OR REPLACE FUNCTION public.enforce_student_attendance_edit_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _today date;
  _window_days integer;
BEGIN
  -- Service-role / cron writes carry no user context.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Set by review_student_leave / save_class_attendance for leave rows only.
  IF coalesce(current_setting('salci.leave_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF public.is_super_admin(_uid)
     OR public.is_institution_admin(_uid, NEW.institution_id) THEN
    RETURN NEW;
  END IF;

  SELECT (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date
    INTO _today
    FROM public.institutions i
   WHERE i.id = NEW.institution_id;
  IF _today IS NULL THEN
    _today := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  END IF;

  SELECT s.student_attendance_edit_window_days
    INTO _window_days
    FROM public.attendance_settings s
   WHERE s.institution_id = NEW.institution_id;
  _window_days := COALESCE(_window_days, 2);

  -- Messages are short and non-technical on purpose: they surface directly
  -- in the UI via toastError/isLikelyUserFriendly.
  IF NEW.date > _today THEN
    RAISE EXCEPTION 'Attendance cannot be marked for a future date.';
  END IF;

  IF NEW.date < _today - _window_days THEN
    RAISE EXCEPTION 'Attendance older than % days can only be changed by an admin.', _window_days;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.marked_by IS NOT NULL
     AND OLD.marked_by <> _uid THEN
    RAISE EXCEPTION 'Only the teacher who marked this attendance can change it.';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 4. Approving an application now writes `leave`, and stops hijacking the day
-- Two changes to the body:
--   * approved -> 'leave' (was 'present'), so both leave paths agree.
--   * marked_by stays NULL on insert and is PRESERVED on conflict. It used to
--     be stamped with the reviewer, and computeAttendanceLock locks a whole
--     class-day as "marked by another teacher" the moment ANY row carries
--     someone else's id - so approving one student's leave made the entire
--     roster read-only for the class teacher. Who decided the leave is
--     already recorded on leave_requests.reviewed_by, so nothing is lost.
CREATE OR REPLACE FUNCTION public.review_student_leave(p_request_id uuid, p_decision text, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.leave_requests%ROWTYPE;
  v_inst uuid;
  v_status text;
  v_date date;
  v_marked int := 0;
  v_skipped int := 0;
  v_is_off boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found' USING ERRCODE = 'P0002';
  END IF;

  -- Re-derive the class's TRUE institution (never trust the request's stored value).
  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = v_req.class_id;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Class not found for leave request' USING ERRCODE = 'P0002';
  END IF;

  -- The student must actually be enrolled in the class before any attendance is written.
  IF NOT public.student_in_class(v_req.student_id, v_req.class_id) THEN
    RAISE EXCEPTION 'Student is not enrolled in this class' USING ERRCODE = '42501';
  END IF;

  -- Authorize on the class's OWN class/institution (never via a caller arg or a
  -- possibly-forged stored institution_id).
  IF NOT public.can_review_student_leave(v_uid, v_req.class_id, v_inst) THEN
    RAISE EXCEPTION 'Not authorized to review this leave request' USING ERRCODE = '42501';
  END IF;

  IF (v_req.end_date - v_req.start_date) > 60 THEN
    RAISE EXCEPTION 'Leave range exceeds 60 days' USING ERRCODE = '22023';
  END IF;

  -- Authority is settled above; the roster's date window must not veto a
  -- decision on a past or future leave (see part 3).
  PERFORM set_config('salci.leave_write', 'on', true);

  UPDATE public.leave_requests
     SET status = p_decision, reviewed_by = v_uid, reviewed_at = now(),
         reviewer_notes = p_notes, updated_at = now()
   WHERE id = p_request_id;

  v_status := CASE WHEN p_decision = 'approved' THEN 'leave' ELSE 'absent' END;

  v_date := v_req.start_date;
  WHILE v_date <= v_req.end_date LOOP
    -- Skip if the date is a school holiday (calendar) or already marked holiday.
    SELECT
      EXISTS (SELECT 1 FROM public.cal_events ce
              WHERE ce.institution_id = v_inst AND ce.kind = 'holiday'
                AND v_date BETWEEN ce.starts_on AND ce.ends_on)
      OR EXISTS (SELECT 1 FROM public.attendance_records ar
              WHERE ar.class_id = v_req.class_id AND ar.student_id = v_req.student_id
                AND ar.date = v_date AND ar.status = 'holiday')
      INTO v_is_off;

    IF v_is_off THEN
      v_skipped := v_skipped + 1;
    ELSE
      INSERT INTO public.attendance_records
        (institution_id, class_id, student_id, date, status, method, marked_by, remarks)
      VALUES
        (v_inst, v_req.class_id, v_req.student_id, v_date, v_status,
         'manual', NULL,
         CASE WHEN p_decision = 'approved' THEN 'Leave approved' ELSE 'Leave rejected' END)
      ON CONFLICT (class_id, student_id, date) DO UPDATE
        SET status = EXCLUDED.status,
            marked_by = attendance_records.marked_by,
            remarks = EXCLUDED.remarks, updated_at = now();
      v_marked := v_marked + 1;
    END IF;
    v_date := v_date + 1;
  END LOOP;

  -- Lower it again immediately. set_config(..., is_local => true) lasts to the
  -- END OF THE TRANSACTION, not the end of this function, so leaving it raised
  -- would exempt any later attendance write in the same transaction from the
  -- edit window. Each PostgREST call is its own transaction today, so nothing
  -- reachable leaks - this keeps it that way if that ever changes.
  PERFORM set_config('salci.leave_write', 'off', true);

  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  VALUES (
    v_req.student_id,
    'leave_decision',
    CASE WHEN p_decision = 'approved' THEN 'Leave approved' ELSE 'Leave rejected' END,
    'Your leave from ' || v_req.start_date::text || ' to ' || v_req.end_date::text
      || CASE WHEN p_decision = 'approved' THEN ' was approved.' ELSE ' was rejected.' END
      || COALESCE(' Note: ' || NULLIF(p_notes, ''), ''),
    '/student/attendance',
    jsonb_build_object('leave_request_id', v_req.id, 'decision', p_decision)
  );

  RETURN jsonb_build_object('status', p_decision, 'dates_marked', v_marked, 'dates_skipped', v_skipped);
END;
$function$;

-- ── 5. The roster's single save: attendance + leave in one transaction ──────
-- The marking screen can now write three statuses, and a `leave` row has to
-- reach BOTH tables together. Staff hold no write policy on leave_requests
-- (all decisions go through a DEFINER RPC by design), and two dependent
-- writes must be one transaction (CLAUDE.md §9a) - so the whole class-day
-- save moves server-side instead of the client bulk-upserting attendance and
-- then poking leave separately.
--
-- Idempotent by construction: the attendance write upserts on
-- UNIQUE(class_id, student_id, date), and leave creation reuses an approved
-- row that already covers the date, so a double-tap or a retry cannot
-- duplicate a leave or a mark.
CREATE OR REPLACE FUNCTION public.save_class_attendance(
  p_class_id uuid,
  p_date date,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_inst       uuid;
  v_count      int;
  v_row        jsonb;
  v_student    uuid;
  v_status     text;
  v_type       text;
  v_reason     text;
  v_leave_id   uuid;
  v_lv_source  text;
  v_lv_start   date;
  v_lv_end     date;
  v_deleted    int;
  v_touched    int;
  v_marked     int := 0;
  v_created    int := 0;
  v_updated    int := 0;
  v_kept       int := 0;
  v_withdrawn  int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_class_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'Class and date are required' USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'No attendance to save' USING ERRCODE = '22023';
  END IF;

  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'No attendance to save' USING ERRCODE = '22023';
  END IF;
  -- Matches the roster read's .limit(500); the largest real section is far under.
  IF v_count > 500 THEN
    RAISE EXCEPTION 'Too many students in one save' USING ERRCODE = '22023';
  END IF;

  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Class not found' USING ERRCODE = 'P0002';
  END IF;

  -- Mirrors the attendance_records write policies exactly: any teacher
  -- assigned to the class (attendance is whole-class - THE documented
  -- exception to subject-scoped teacher authority, CLAUDE.md §25), plus
  -- institution and super admins. Coordinators hold SELECT only there and are
  -- excluded here for the same reason.
  IF NOT (public.is_teacher_for_class(v_uid, p_class_id)
          OR public.is_institution_admin(v_uid, v_inst)
          OR public.is_super_admin(v_uid)) THEN
    RAISE EXCEPTION 'You are not assigned to this class' USING ERRCODE = '42501';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) AS t(value) LOOP
    v_student := NULLIF(v_row->>'student_id', '')::uuid;
    v_status  := v_row->>'status';
    v_type    := NULLIF(btrim(coalesce(v_row->>'leave_type', '')), '');
    v_reason  := NULLIF(btrim(coalesce(v_row->>'reason', '')), '');

    IF v_student IS NULL THEN
      RAISE EXCEPTION 'A student is missing from the attendance list' USING ERRCODE = '22023';
    END IF;
    -- The roster only offers these three. sick/casual/holiday stay read-only
    -- here so a stray payload cannot quietly repurpose them.
    IF v_status IS NULL OR v_status NOT IN ('present','absent','leave') THEN
      RAISE EXCEPTION 'Unknown attendance status: %', coalesce(v_status, 'null') USING ERRCODE = '22023';
    END IF;
    IF v_type IS NOT NULL AND v_type NOT IN ('sick','personal','family','other') THEN
      RAISE EXCEPTION 'Unknown leave type: %', v_type USING ERRCODE = '22023';
    END IF;
    IF NOT public.student_in_class(v_student, p_class_id) THEN
      RAISE EXCEPTION 'A student on this list is no longer in the class. Reopen the roster and try again.'
        USING ERRCODE = '42501';
    END IF;

    IF v_status = 'leave' THEN
      -- Reuse a leave that already covers this date (the student applied and
      -- it was approved, or the teacher marked it earlier) instead of stacking
      -- a duplicate. There is no overlap constraint to lean on - overlap
      -- prevention is an explicit non-goal of the original design.
      SELECT lr.id, lr.source, lr.start_date, lr.end_date
        INTO v_leave_id, v_lv_source, v_lv_start, v_lv_end
        FROM public.leave_requests lr
       WHERE lr.student_id = v_student
         AND lr.status = 'approved'
         AND p_date BETWEEN lr.start_date AND lr.end_date
       ORDER BY lr.created_at DESC
       LIMIT 1;

      IF v_leave_id IS NULL THEN
        INSERT INTO public.leave_requests
          (institution_id, student_id, class_id, leave_type, start_date, end_date,
           reason, status, source, reviewed_by, reviewed_at)
        VALUES
          (v_inst, v_student, p_class_id,
           COALESCE(v_type, 'other'), p_date, p_date,
           -- reason is NOT NULL and renders verbatim to the student; the
           -- fallback only covers a payload with no reason (e.g. a day whose
           -- attendance row was already 'leave' with no matching record).
           COALESCE(v_reason, 'Marked on leave from the attendance roster'),
           'approved', 'staff', v_uid, now());
        v_created := v_created + 1;

        INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
        VALUES (
          v_student,
          'leave_decision',
          'Marked on leave',
          'Your school marked you on leave for ' || to_char(p_date, 'DD Mon YYYY') || '.',
          '/student/attendance',
          jsonb_build_object('decision', 'approved', 'source', 'staff', 'date', p_date)
        );

      ELSIF v_lv_source = 'staff' AND v_lv_start = p_date AND v_lv_end = p_date
            AND (v_type IS NOT NULL OR v_reason IS NOT NULL) THEN
        -- The teacher is CORRECTING a single-day leave this same screen
        -- created. Without this branch the re-typed type and reason were
        -- dropped on the floor behind a "saved successfully" toast, with no
        -- way to fix a wrong reason from the roster at all.
        UPDATE public.leave_requests lr
           SET leave_type  = COALESCE(v_type, lr.leave_type),
               reason      = COALESCE(v_reason, lr.reason),
               reviewed_by = v_uid,
               reviewed_at = now(),
               updated_at  = now()
         WHERE lr.id = v_leave_id
           AND (lr.leave_type <> COALESCE(v_type, lr.leave_type)
                OR lr.reason  <> COALESCE(v_reason, lr.reason));
        GET DIAGNOSTICS v_touched = ROW_COUNT;
        v_updated := v_updated + v_touched;

      ELSE
        -- A student's own application, or a multi-day leave: not this
        -- screen's to rewrite. Reported back so the caller can say so
        -- instead of implying the typed reason was stored.
        v_kept := v_kept + 1;
      END IF;
    ELSE
      -- Flipped off leave: withdraw ONLY a single-day leave that was marked
      -- here. A student's own application (or any multi-day leave) is left
      -- standing - reversing someone else's request is a decision for the
      -- Leaves list, not a side effect of tapping Present.
      DELETE FROM public.leave_requests lr
       WHERE lr.student_id = v_student
         AND lr.class_id = p_class_id
         AND lr.source = 'staff'
         AND lr.status = 'approved'
         AND lr.start_date = p_date
         AND lr.end_date = p_date;
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      v_withdrawn := v_withdrawn + v_deleted;
    END IF;

    -- NOTE: no `salci.leave_write` exemption here. The roster only ever writes
    -- the date it is showing, and that date should obey the edit window and
    -- the "only the teacher who marked this day can change it" rule exactly
    -- like a present/absent mark. The exemption exists solely for
    -- review_student_leave, which legitimately writes past and future dates.
    INSERT INTO public.attendance_records
      (institution_id, class_id, student_id, date, status, method, marked_by, remarks)
    VALUES
      (v_inst, p_class_id, v_student, p_date, v_status, 'manual', v_uid,
       CASE WHEN v_status = 'leave' THEN 'Leave marked by teacher' ELSE NULL END)
    ON CONFLICT (class_id, student_id, date) DO UPDATE
      SET status    = EXCLUDED.status,
          method    = EXCLUDED.method,
          marked_by = EXCLUDED.marked_by,
          -- Keep an approval's own note when the day is already an approved
          -- leave, so the roster can still tell the two origins apart. Clear
          -- a stale leave note when the day stops being a leave; never touch
          -- remarks written by anything else.
          remarks   = CASE
                        WHEN EXCLUDED.status = 'leave' THEN
                          CASE WHEN attendance_records.remarks = 'Leave approved'
                               THEN attendance_records.remarks
                               ELSE 'Leave marked by teacher' END
                        WHEN attendance_records.remarks IN
                             ('Leave approved','Leave rejected','Leave marked by teacher')
                          THEN NULL
                        ELSE attendance_records.remarks
                      END,
          updated_at = now();

    v_marked := v_marked + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'marked', v_marked,
    'leaves_created', v_created,
    'leaves_updated', v_updated,
    -- Leaves left exactly as they were because they are not this screen's to
    -- rewrite (a student's own application, or a multi-day leave). The caller
    -- surfaces this so a re-typed reason never looks like it was saved.
    'leaves_kept', v_kept,
    'leaves_withdrawn', v_withdrawn
  );
END;
$function$;

-- ── 6. Grants (CLAUDE.md §26: Supabase's default privileges hand `anon`
--       EXECUTE on every new public function, and REVOKE FROM PUBLIC does not
--       strip it - it has to be revoked BY NAME). The three pre-existing leave
--       functions still held anon EXECUTE; they are cleaned up here too.
REVOKE ALL ON FUNCTION public.save_class_attendance(uuid, date, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_class_attendance(uuid, date, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_class_attendance(uuid, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_class_attendance(uuid, date, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.review_student_leave(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_student_leave(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_student_leave(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_student_leave(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.can_review_student_leave(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_review_student_leave(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_review_student_leave(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_review_student_leave(uuid, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.student_in_class(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_in_class(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_in_class(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_in_class(uuid, uuid) TO service_role;

-- ── 7. Backfill: historic approved leaves become `leave` too ────────────────
-- !! APPLIED SEPARATELY, AFTER THE FRONTEND DEPLOY. Every other part of this
-- !! migration went to prod on 2026-09-03; this block did NOT. A client that
-- !! predates the deploy has no tone or label for `leave`, so flipping 44
-- !! historic rows before the new bundle is live would render those days as
-- !! blank cells on student calendars and in the reports pivot. Run this block
-- !! on its own via scripts/run-sql.ps1 once salci.org serves the new build.
-- Otherwise the same event reads as 'present' before today and 'leave' after,
-- and the student's percentage would count old leave days but not new ones.
-- Scoped by BOTH the remarks marker only review_student_leave writes AND a
-- still-standing approved request covering the date, so a day a teacher later
-- re-marked absent is untouched. Rollback manifest kept.
CREATE SCHEMA IF NOT EXISTS salci_backups;

CREATE TABLE IF NOT EXISTS salci_backups.attendance_leave_backfill_20260903 AS
SELECT ar.id, ar.status AS old_status, now() AS captured_at
  FROM public.attendance_records ar
 WHERE ar.status = 'present'
   AND ar.remarks = 'Leave approved'
   AND EXISTS (SELECT 1 FROM public.leave_requests lr
                WHERE lr.student_id = ar.student_id
                  AND lr.status = 'approved'
                  AND ar.date BETWEEN lr.start_date AND lr.end_date);

UPDATE public.attendance_records ar
   SET status = 'leave', updated_at = now()
 WHERE ar.status = 'present'
   AND ar.remarks = 'Leave approved'
   AND EXISTS (SELECT 1 FROM public.leave_requests lr
                WHERE lr.student_id = ar.student_id
                  AND lr.status = 'approved'
                  AND ar.date BETWEEN lr.start_date AND lr.end_date);


-- ── 8. Teach every attendance aggregate about `leave` ───────────────────────
-- !! SUPERSEDED 2026-09-05 by 20260905120000_leave_excluded_from_attendance_ratios.sql.
-- !! The substitution below ADDED 'leave' to each ratio numerator so that "no
-- !! dashboard number would move". That preserved the very behaviour the
-- !! product decision replaced: a student on leave still counted as present
-- !! ("Students present today: 8 of 10 - 80.0%" for 6 present / 2 absent /
-- !! 2 on leave). The later migration removes 'leave' from the numerators and
-- !! excludes leave rows from the queries entirely. Do not re-apply this part
-- !! on its own.
-- Generated from the live prod definitions (pg_get_functiondef) with ONE
-- additive substitution each, so no other logic can drift:
--
--   dash_* ratios and dash_evaluate_flags A4:
--     'present','late'  ->  'present','late','leave'
--   student summary + year report excused bucket:
--     'sick','casual'   ->  'sick','casual','leave'
--
-- Effect: every DASHBOARD number stays exactly as it is today, because an
-- approved leave used to be stored as 'present' and now counts the same way
-- here. In particular dash_evaluate_flags rule A4 counts anything NOT IN
-- ('present','late') as MISSED SCHOOL and auto-raises a truancy flag plus an
-- auto-task - without this, every school-granted leave day would read as
-- truancy the moment the feature shipped.
--
-- The STAFF plane keeps 'late' and is deliberately untouched:
-- dash_teachers_table, dash_scoped_teachers_table, tt_lesson_plan_export,
-- tt_substitutions_cancel_on_late_checkin, and the staff_attendance_records
-- half of dash_admin_roster_counts.
-- _student_attendance_summary_impl(p_uid uuid, p_range text) : 1 substitution(s)
CREATE OR REPLACE FUNCTION public._student_attendance_summary_impl(p_uid uuid, p_range text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := p_uid;
  v_inst uuid;
  v_tz text;
  v_today date;
  v_range text;
  v_from date;
  v_to date;
  v_ay_code text; v_ay_start date; v_ay_end date;
  v_present int; v_absent int; v_excused int; v_holiday int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_range := CASE WHEN p_range IN ('tm','1m','3m','6m','ay') THEN p_range ELSE '1m' END;

  v_inst := public.get_user_institution(v_uid);
  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  IF v_range = 'ay' THEN
    SELECT ay.code, ay.starts_on, ay.ends_on
      INTO v_ay_code, v_ay_start, v_ay_end
    FROM cal_academic_years ay
    WHERE ay.institution_id = v_inst
    ORDER BY (v_today BETWEEN ay.starts_on AND ay.ends_on) DESC, ay.is_active DESC, ay.starts_on DESC
    LIMIT 1;
    v_from := COALESCE(v_ay_start, (v_today - INTERVAL '1 year')::date);
    v_to   := LEAST(COALESCE(v_ay_end, v_today), v_today);
  ELSIF v_range = 'tm' THEN
    -- Calendar month to date: the same window the status-strip tile counts.
    v_from := date_trunc('month', v_today)::date;
    v_to   := v_today;
  ELSE
    v_from := (v_today - (CASE v_range
                            WHEN '3m' THEN INTERVAL '3 months'
                            WHEN '6m' THEN INTERVAL '6 months'
                            ELSE INTERVAL '1 month' END))::date;
    v_to := v_today;
  END IF;

  WITH hol AS (
    -- Every holiday DAY inside the window (multi-day holidays expanded).
    SELECT DISTINCT d::date AS day
    FROM cal_events ce
    CROSS JOIN LATERAL generate_series(ce.starts_on::date, ce.ends_on::date, INTERVAL '1 day') d
    WHERE ce.institution_id = v_inst
      AND ce.kind = 'holiday'
      AND ce.starts_on::date <= v_to
      AND ce.ends_on::date >= v_from
      AND d::date BETWEEN v_from AND v_to
  ),
  eff AS (
    SELECT CASE WHEN h.day IS NOT NULL THEN 'holiday' ELSE ar.status END AS status
    FROM attendance_records ar
    LEFT JOIN hol h ON h.day = ar.date
    WHERE ar.student_id = v_uid
      AND ar.date BETWEEN v_from AND v_to
  )
  SELECT count(*) FILTER (WHERE status = 'present'),
         count(*) FILTER (WHERE status = 'absent'),
         count(*) FILTER (WHERE status IN ('sick','casual','leave')),
         (SELECT count(*) FROM hol)
    INTO v_present, v_absent, v_excused, v_holiday
  FROM eff;

  v_present := COALESCE(v_present, 0);
  v_absent  := COALESCE(v_absent, 0);
  v_excused := COALESCE(v_excused, 0);
  v_holiday := COALESCE(v_holiday, 0);

  RETURN jsonb_build_object(
    'range', v_range,
    'from', to_char(v_from, 'YYYY-MM-DD'),
    'to', to_char(v_to, 'YYYY-MM-DD'),
    'academic_year', v_ay_code,
    'present', v_present,
    'absent', v_absent,
    'excused', v_excused,
    'holiday', v_holiday,
    'graded_days', v_present + v_absent,
    'percentage', CASE WHEN (v_present + v_absent) > 0
                       THEN round(v_present * 100.0 / (v_present + v_absent), 1) END
  );
END $function$;

-- _student_year_report_impl(p_uid uuid) : 1 substitution(s)
CREATE OR REPLACE FUNCTION public._student_year_report_impl(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := p_uid;
  v_inst      uuid;
  v_tz        text;
  v_today     date;
  v_ay_code   text;
  v_from      date;
  v_to        date;
  v_synthetic boolean := false;
  v_out       jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'no student'; END IF;

  v_inst := public.get_user_institution(v_uid);
  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT ay.code, ay.starts_on, LEAST(ay.ends_on, v_today)
    INTO v_ay_code, v_from, v_to
  FROM cal_academic_years ay
  WHERE ay.institution_id = v_inst
  ORDER BY (v_today BETWEEN ay.starts_on AND ay.ends_on) DESC, ay.is_active DESC, ay.starts_on DESC
  LIMIT 1;

  -- Only 5 of 31 institutions with students have a cal_academic_years row, so
  -- fall back to a trailing year and TELL the reader that is what happened
  -- rather than inventing a "2026-27" label.
  IF v_from IS NULL THEN
    v_from := (v_today - INTERVAL '1 year')::date;
    v_to := v_today;
    v_synthetic := true;
  END IF;

  WITH my_exams AS (
    -- One row per exam. Grouped so a re-attempt or a duplicated exam_subjects
    -- row can never weight a single test twice.
    SELECT e.id AS exam_id,
           (array_agg(a.class_id ORDER BY a.id))[1] AS class_id,
           e.title, e.exam_type,
           avg(fr.percentage)           AS my_pct,
           max(fr.total_marks_obtained) AS obtained,
           max(fr.total_max_marks)      AS out_of,
           bool_or(fr.is_pass)          AS is_pass,
           count(*) FILTER (WHERE fr.is_pass IS NULL) AS pass_unknown,
           max(COALESCE(e.published_at::date, e.scheduled_date::date,
                        a.submitted_at::date, fr.created_at::date)) AS exam_date
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
    WHERE a.student_id = v_uid AND fr.is_published = true
    GROUP BY e.id
    HAVING max(COALESCE(e.published_at::date, e.scheduled_date::date,
                        a.submitted_at::date, fr.created_at::date)) BETWEEN v_from AND v_to
    ORDER BY exam_date DESC
    LIMIT 200                                   -- Â§23 bound
  ),
  cohort AS (
    -- Everyone who sat the SAME exam in the SAME section. Aggregates only.
    SELECT m.exam_id, a.student_id, fr.percentage
    FROM my_exams m
    JOIN student_exam_attempts a ON a.exam_id = m.exam_id AND a.class_id = m.class_id
    JOIN final_results fr ON fr.attempt_id = a.id AND fr.is_published = true
    JOIN exams e ON e.id = a.exam_id AND e.status IN ('published','active','completed')
  ),
  per_exam AS (
    SELECT c.exam_id,
           round(avg(c.percentage), 1)      AS class_avg,
           max(c.percentage)                AS class_high,
           count(DISTINCT c.student_id)     AS n_students
    FROM cohort c
    GROUP BY c.exam_id
  ),
  peer_avg AS (
    -- One average per classmate across the same exams: the basis for percentile
    -- and the distribution.
    SELECT c.student_id, avg(c.percentage) AS avg_pct
    FROM cohort c
    GROUP BY c.student_id
  ),
  me AS (
    SELECT avg(my_pct) AS my_avg,
           count(*)                                   AS n_assessments,
           count(*) FILTER (WHERE is_pass)            AS pass_count,
           sum(pass_unknown)                          AS pass_unknown,
           round(stddev_samp(my_pct)::numeric, 1)     AS sd
    FROM my_exams
  ),
  subj AS (
    SELECT initcap(lower(btrim(us.name))) AS subject,
           round(avg(m.my_pct), 1)        AS student_avg,
           count(DISTINCT m.exam_id)      AS n_tests
    FROM my_exams m
    JOIN exam_subjects es ON es.exam_id = m.exam_id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE btrim(COALESCE(us.name, '')) <> ''
    GROUP BY 1
  ),
  subj_cohort AS (
    SELECT initcap(lower(btrim(us.name))) AS subject, c.student_id,
           avg(c.percentage) AS pct
    FROM cohort c
    JOIN exam_subjects es ON es.exam_id = c.exam_id
    JOIN universal_subjects us ON us.id = es.subject_id
    WHERE btrim(COALESCE(us.name, '')) <> ''
    GROUP BY 1, 2
  ),
  subj_cls AS (
    SELECT subject, round(avg(pct), 1) AS class_avg, round(max(pct), 1) AS class_high,
           count(DISTINCT student_id) AS n_students
    FROM subj_cohort GROUP BY subject
  ),
  chap AS (
    SELECT et.exam_id, st.id AS chapter_id, st.topic_name AS chapter,
           st.chapter_number, st.display_order,
           initcap(lower(btrim(us.name))) AS subject
    FROM my_exams m
    JOIN exam_topics et ON et.exam_id = m.exam_id
    JOIN syllabus_topics st ON st.id = et.topic_id AND st.is_active
    LEFT JOIN universal_subjects us ON us.id = st.subject_id
    WHERE btrim(COALESCE(st.topic_name, '')) <> ''
  ),
  chap_mine AS (
    SELECT ch.chapter_id, ch.chapter, ch.subject, ch.chapter_number, ch.display_order,
           round(avg(m.my_pct), 1)   AS student_avg,
           count(DISTINCT m.exam_id) AS n_tests
    FROM chap ch JOIN my_exams m ON m.exam_id = ch.exam_id
    GROUP BY 1,2,3,4,5
  ),
  chap_cls AS (
    SELECT ch.chapter_id, round(avg(c.percentage), 1) AS class_avg,
           count(DISTINCT c.student_id) AS n_students
    FROM chap ch JOIN cohort c ON c.exam_id = ch.exam_id
    GROUP BY 1
  ),
  hol AS (
    SELECT DISTINCT d::date AS day
    FROM cal_events ce
    CROSS JOIN LATERAL generate_series(ce.starts_on::date, ce.ends_on::date, INTERVAL '1 day') d
    WHERE ce.institution_id = v_inst AND ce.kind = 'holiday'
      AND ce.starts_on::date <= v_to AND ce.ends_on::date >= v_from
      AND d::date BETWEEN v_from AND v_to
  ),
  att AS (
    SELECT CASE WHEN h.day IS NOT NULL THEN 'holiday' ELSE ar.status END AS status
    FROM attendance_records ar
    LEFT JOIN hol h ON h.day = ar.date
    WHERE ar.student_id = v_uid AND ar.date BETWEEN v_from AND v_to
  )
  SELECT jsonb_build_object(
    'meta', jsonb_build_object(
      'academic_year', v_ay_code,
      'from', to_char(v_from, 'YYYY-MM-DD'),
      'to', to_char(v_to, 'YYYY-MM-DD'),
      'window_is_synthetic', v_synthetic,
      'generated_at', to_char((now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata')), 'YYYY-MM-DD"T"HH24:MI:SS'),
      'timezone', COALESCE(v_tz, 'Asia/Kolkata')
    ),
    'snapshot', (
      SELECT jsonb_build_object(
        'n_assessments', COALESCE(me.n_assessments, 0),
        'my_avg', round(me.my_avg, 1),
        'pass_count', COALESCE(me.pass_count, 0),
        'pass_unknown', COALESCE(me.pass_unknown, 0),
        -- Lower spread = steadier. NULL below 3 tests: a "consistency" number
        -- off two data points is noise wearing a percentage sign.
        'consistency', CASE WHEN me.n_assessments >= 3 AND me.sd IS NOT NULL
                            THEN GREATEST(0, round(100 - me.sd * 2.5))::int END,
        'class_avg', (SELECT CASE WHEN count(DISTINCT student_id) >= 3
                                  THEN round(avg(avg_pct), 1) END FROM peer_avg)
      ) FROM me
    ),
    'standing', (
      SELECT jsonb_build_object(
        'cohort_n', n,
        'percentile', CASE WHEN n >= 5 THEN pct END,
        'ahead_of',   CASE WHEN n >= 5 THEN ahead END,
        'peers',      CASE WHEN n >= 5 THEN n - 1 END,
        'topper_avg', CASE WHEN n >= 5 THEN top END,
        'histogram',  CASE WHEN n >= 5 THEN hist END
      )
      FROM (
        SELECT (SELECT count(DISTINCT student_id) FROM peer_avg) AS n,
               -- cume_dist must be computed over the WHOLE cohort and only then
               -- filtered to the caller. Filtering first leaves the window with
               -- one row, which always yields 1.0 (i.e. a bogus 100th
               -- percentile). Caught in prod testing: ahead_of said 1 of 9.
               (SELECT r.cd FROM (
                  SELECT student_id, round(cume_dist() OVER (ORDER BY avg_pct) * 100) AS cd
                  FROM peer_avg
                ) r WHERE r.student_id = v_uid) AS pct,
               -- Counted explicitly: cume_dist counts ties as <= and would
               -- over-report how many classmates the student is ahead of.
               (SELECT count(*) FROM peer_avg p
                 WHERE p.avg_pct < (SELECT avg_pct FROM peer_avg WHERE student_id = v_uid)) AS ahead,
               (SELECT round(max(avg_pct), 1) FROM peer_avg) AS top,
               (SELECT jsonb_agg(jsonb_build_object('bin', b.label, 'count', b.c) ORDER BY b.lo)
                  FROM (
                    SELECT lo, label, count(p.student_id) AS c
                    FROM (VALUES (0,'0-49'),(50,'50-59'),(60,'60-69'),(70,'70-79'),(80,'80-89'),(90,'90-100')) AS v(lo,label)
                    LEFT JOIN peer_avg p
                      ON (CASE WHEN p.avg_pct < 50 THEN 0
                               WHEN p.avg_pct < 60 THEN 50
                               WHEN p.avg_pct < 70 THEN 60
                               WHEN p.avg_pct < 80 THEN 70
                               WHEN p.avg_pct < 90 THEN 80
                               ELSE 90 END) = v.lo
                    GROUP BY lo, label
                  ) b) AS hist
      ) q
    ),
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'exam_id', m.exam_id, 'title', m.title, 'exam_type', m.exam_type,
               'exam_date', m.exam_date, 'my_pct', round(m.my_pct, 1),
               'obtained', m.obtained, 'out_of', m.out_of, 'is_pass', m.is_pass,
               'class_avg', CASE WHEN pe.n_students >= 3 THEN pe.class_avg END,
               'n_students', COALESCE(pe.n_students, 0)
             ) ORDER BY m.exam_date ASC)
      FROM my_exams m LEFT JOIN per_exam pe ON pe.exam_id = m.exam_id
    ), '[]'::jsonb),
    'subjects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'subject', s.subject, 'student_avg', s.student_avg, 'n_tests', s.n_tests,
               'class_avg',  CASE WHEN c.n_students >= 3 THEN c.class_avg END,
               'class_high', CASE WHEN c.n_students >= 5 THEN c.class_high END,
               'n_students', COALESCE(c.n_students, 0)
             ) ORDER BY (s.student_avg - COALESCE(c.class_avg, s.student_avg)) ASC, s.subject)
      FROM subj s LEFT JOIN subj_cls c USING (subject)
    ), '[]'::jsonb),
    'chapters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'chapter_id', cm.chapter_id, 'chapter', cm.chapter, 'subject', cm.subject,
               'chapter_number', cm.chapter_number,
               'student_avg', cm.student_avg, 'n_tests', cm.n_tests,
               'class_avg', CASE WHEN cc.n_students >= 3 THEN cc.class_avg END,
               'n_students', COALESCE(cc.n_students, 0)
             ) ORDER BY cm.chapter_number NULLS LAST, cm.display_order, cm.chapter)
      FROM chap_mine cm LEFT JOIN chap_cls cc USING (chapter_id)
    ), '[]'::jsonb),
    'attendance', (
      SELECT jsonb_build_object(
        'present', p, 'absent', ab, 'excused', ex, 'holiday', ho,
        'graded_days', p + ab,
        'percentage', CASE WHEN (p + ab) > 0 THEN round(p * 100.0 / (p + ab), 1) END
      ) FROM (
        SELECT count(*) FILTER (WHERE status = 'present')            AS p,
               count(*) FILTER (WHERE status = 'absent')             AS ab,
               count(*) FILTER (WHERE status IN ('sick','casual','leave'))   AS ex,
               (SELECT count(*) FROM hol)                            AS ho
        FROM att
      ) x
    ),
    'engagement', (
      SELECT jsonb_build_object(
        'points', COALESCE(sum(bd.points), 0),
        'badge_count', count(*),
        'badges', COALESCE(jsonb_agg(jsonb_build_object(
                    'name', bd.name, 'icon', bd.icon_name, 'tier', bd.tier,
                    'earned_at', ub.earned_at
                  ) ORDER BY ub.earned_at DESC) FILTER (WHERE bd.id IS NOT NULL), '[]'::jsonb)
      )
      FROM user_badges ub JOIN badge_definitions bd ON bd.id = ub.badge_id
      WHERE ub.user_id = v_uid
    ),
    'coverage', (
      SELECT jsonb_build_object(
        'n_results', (SELECT count(*) FROM my_exams),
        'n_no_subject', (SELECT count(*) FROM my_exams m
                          WHERE NOT EXISTS (SELECT 1 FROM exam_subjects es WHERE es.exam_id = m.exam_id)),
        'n_no_chapter', (SELECT count(*) FROM my_exams m
                          WHERE NOT EXISTS (SELECT 1 FROM exam_topics et WHERE et.exam_id = m.exam_id))
      )
    )
  ) INTO v_out;

  RETURN v_out;
END $function$;

-- dash_admin_digest(p_institution_id uuid) : 2 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_admin_digest(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(code text, severity text, headline text, detail text, link_url text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_students int; v_never int; v_active30 int;
  v_wk numeric; v_pwk numeric;
  v_subj text; v_subj_pct numeric;
  v_class text; v_class_pct numeric;
  v_unmarked int; v_classes int;
  v_low_notices int; v_notices int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  -- ---- 1. portal adoption ------------------------------------------------
  SELECT count(*),
         count(*) FILTER (WHERE u.last_sign_in_at IS NULL),
         count(*) FILTER (WHERE u.last_sign_in_at >= now() - INTERVAL '30 days')
    INTO v_students, v_never, v_active30
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE;

  IF v_students > 0 AND v_never > 0 THEN
    RETURN QUERY SELECT
      'portal_adoption',
      CASE WHEN v_never * 100.0 / v_students >= 50 THEN 'high'
           WHEN v_never * 100.0 / v_students >= 20 THEN 'medium'
           ELSE 'low' END,
      v_never || ' of ' || v_students || ' students have never signed in',
      'They cannot see homework, notices or results, so nothing else on this '
        || 'dashboard reaches them. Only ' || v_active30
        || ' signed in during the last 30 days.',
      '/school/students';
  END IF;

  -- ---- 2. weakest subject (>= 5 results, so one bad paper is not a trend) --
  SELECT subject_name, school_avg INTO v_subj, v_subj_pct
    FROM public.dash_school_subject_performance(v_inst)
   WHERE results >= 5
   ORDER BY school_avg ASC
   LIMIT 1;

  IF v_subj IS NOT NULL THEN
    RETURN QUERY SELECT
      'weakest_subject',
      CASE WHEN v_subj_pct < 50 THEN 'high'
           WHEN v_subj_pct < 65 THEN 'medium' ELSE 'low' END,
      v_subj || ' is your weakest subject school-wide at ' || v_subj_pct || '%',
      'Averaged across every graded exam this academic year.',
      '/school/analytics';
  END IF;

  -- ---- 3. weakest class ---------------------------------------------------
  SELECT c.name || CASE WHEN coalesce(c.section,'') <> '' THEN '-' || c.section ELSE '' END,
         round(avg(fr.percentage), 1)
    INTO v_class, v_class_pct
    FROM classes c
    JOIN class_assignments ca ON ca.class_id = c.id AND ca.role::text = 'student'
    JOIN student_exam_attempts a ON a.student_id = ca.user_id
    JOIN final_results fr ON fr.attempt_id = a.id
    JOIN exams e ON e.id = a.exam_id
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND e.status IN ('published','active','completed')
     AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
         BETWEEN v_ay_start AND v_ay_end
   GROUP BY 1
  HAVING count(*) >= 5
   ORDER BY 2 ASC
   LIMIT 1;

  IF v_class IS NOT NULL AND v_class_pct < 65 THEN
    RETURN QUERY SELECT
      'weakest_class',
      CASE WHEN v_class_pct < 50 THEN 'high' ELSE 'medium' END,
      v_class || ' is your lowest-scoring class at ' || v_class_pct || '%',
      'Sitting below the 65% band across recent exams.',
      '/school/classes';
  END IF;

  -- ---- 4. attendance week over week --------------------------------------
  SELECT round(count(*) FILTER (WHERE status IN ('present','late','leave')) * 100.0
               / NULLIF(count(*), 0), 1) INTO v_wk
    FROM attendance_records
   WHERE institution_id = v_inst AND date > v_today - 7 AND date <= v_today;
  SELECT round(count(*) FILTER (WHERE status IN ('present','late','leave')) * 100.0
               / NULLIF(count(*), 0), 1) INTO v_pwk
    FROM attendance_records
   WHERE institution_id = v_inst AND date > v_today - 14 AND date <= v_today - 7;

  IF v_wk IS NOT NULL AND v_pwk IS NOT NULL AND abs(v_wk - v_pwk) >= 1 THEN
    RETURN QUERY SELECT
      'attendance_trend',
      CASE WHEN v_wk - v_pwk <= -3 THEN 'high'
           WHEN v_wk - v_pwk <  0  THEN 'medium' ELSE 'low' END,
      'Attendance ' || CASE WHEN v_wk > v_pwk THEN 'rose ' ELSE 'dipped ' END
        || round(abs(v_wk - v_pwk), 1) || 'pp vs last week',
      'Now ' || v_wk || '%, was ' || v_pwk || '%.',
      '/school/attendance';
  END IF;

  -- ---- 5. classes not marking attendance ---------------------------------
  SELECT count(*) INTO v_classes
    FROM classes WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) INTO v_unmarked
    FROM classes c
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND NOT EXISTS (
       SELECT 1 FROM attendance_records ar
        WHERE ar.class_id = c.id
          AND ar.date > v_today - 14 AND ar.date <= v_today);

  IF v_unmarked > 0 THEN
    RETURN QUERY SELECT
      'attendance_compliance',
      CASE WHEN v_unmarked * 100.0 / GREATEST(v_classes, 1) >= 50 THEN 'high'
           ELSE 'medium' END,
      v_unmarked || ' of ' || v_classes
        || ' classes have not marked attendance in 14 days',
      'Their attendance figures elsewhere on this page are not measuring '
        || 'anything until the register is taken.',
      '/school/attendance';
  END IF;

  -- ---- 6. notices nobody opened ------------------------------------------
  SELECT count(*), count(*) FILTER (
           WHERE n.recipient_count > 0
             AND (SELECT count(*) FROM notice_recipients r
                   WHERE r.notice_id = n.id AND r.read_at IS NOT NULL)
                 * 100.0 / n.recipient_count < 40)
    INTO v_notices, v_low_notices
    FROM notices n
   WHERE n.institution_id = v_inst
     AND n.published_at >= now() - INTERVAL '30 days';

  IF v_low_notices > 0 THEN
    RETURN QUERY SELECT
      'notice_reach',
      'medium',
      v_low_notices || ' of ' || v_notices
        || ' recent notices were read by under 40% of their audience',
      'A notice with low reach did not fail to send, it failed to land.',
      '/school/notices';
  END IF;

  RETURN;
END $function$;

-- dash_admin_roster_counts(p_institution_id uuid) : 1 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_admin_roster_counts(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date;
  v_students int; v_students_new int;
  v_staff int; v_classes int; v_wings int;
  v_s_present int; v_s_total int;
  v_t_present int; v_t_total int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT count(DISTINCT p.id) INTO v_students
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE;

  -- "â² N this month" on the students tile
  SELECT count(DISTINCT p.id) INTO v_students_new
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND p.created_at >= (v_today - INTERVAL '30 days');

  SELECT count(DISTINCT p.id) INTO v_staff
    FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE
     AND ur.role::text IN ('teacher','coordinator','school_admin','super_school_admin','employee');

  SELECT count(*) INTO v_classes
    FROM classes WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) INTO v_wings
    FROM wings WHERE institution_id = v_inst AND is_active IS NOT FALSE;

  SELECT count(*) FILTER (WHERE status IN ('present','late','leave')), count(*)
    INTO v_s_present, v_s_total
    FROM attendance_records
   WHERE institution_id = v_inst AND date = v_today;

  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_t_present, v_t_total
    FROM staff_attendance_records
   WHERE institution_id = v_inst AND date = v_today;

  RETURN jsonb_build_object(
    'students', jsonb_build_object('count', v_students, 'new_30d', v_students_new),
    'staff',    jsonb_build_object('count', v_staff),
    'classes',  jsonb_build_object('count', v_classes, 'wings', v_wings),
    'students_present', jsonb_build_object(
       'present', v_s_present, 'total', v_s_total, 'marked', v_s_total > 0,
       'pct', CASE WHEN v_s_total > 0 THEN round(v_s_present*100.0/v_s_total, 1) END),
    'staff_present', jsonb_build_object(
       'present', v_t_present, 'total', v_t_total, 'marked', v_t_total > 0,
       'pct', CASE WHEN v_t_total > 0 THEN round(v_t_present*100.0/v_t_total, 1) END)
  );
END $function$;

-- dash_attendance_trend(p_days integer, p_institution_id uuid, p_class_id uuid) : 2 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_attendance_trend(p_days integer DEFAULT 30, p_institution_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_tz text; v_today date; v_points jsonb; v_all numeric;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  -- A class from another institution must not narrow the trend to nothing and
  -- look like "no attendance recorded".
  IF p_class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = p_class_id AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.date, 'present', d.present, 'total', d.total,
           'pct', CASE WHEN d.total>0 THEN round(d.present*100.0/d.total,1) END) ORDER BY d.date), '[]'::jsonb)
    INTO v_points
  FROM (
    SELECT date,
           count(*) FILTER (WHERE status IN ('present','late','leave')) AS present,
           count(*) AS total
    FROM attendance_records
    WHERE institution_id = v_inst
      AND date > v_today - p_days AND date <= v_today
      AND (p_class_id IS NULL OR class_id = p_class_id)
    GROUP BY date
  ) d;

  SELECT round((count(*) FILTER (WHERE status IN ('present','late','leave')))*100.0 / NULLIF(count(*),0), 1)
    INTO v_all
  FROM attendance_records
   WHERE institution_id = v_inst
     AND (p_class_id IS NULL OR class_id = p_class_id);

  RETURN jsonb_build_object('points', v_points, 'all_time_avg', v_all);
END $function$;

-- dash_class_performance(p_institution_id uuid, p_wing_id uuid) : 1 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_class_performance(p_institution_id uuid DEFAULT NULL::uuid, p_wing_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(class_id uuid, class_name text, students integer, avg_pct numeric, results integer, exams integer, attendance_30d numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  -- A wing from another institution must not return an empty ranking and read
  -- as "no class here has been examined".
  IF p_wing_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM wings w
                      WHERE w.id = p_wing_id AND w.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: wing not in institution';
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  SELECT c.id,
         c.name || CASE WHEN coalesce(c.section,'') <> '' THEN '-' || c.section ELSE '' END,
         (SELECT count(*)::int FROM class_assignments ca
           WHERE ca.class_id = c.id AND ca.role::text = 'student'),
         r.avg_pct,
         coalesce(r.results, 0)::int,
         coalesce(r.exams, 0)::int,
         (SELECT round(count(*) FILTER (WHERE ar.status IN ('present','late','leave')) * 100.0
                       / NULLIF(count(*), 0), 1)
            FROM attendance_records ar
           WHERE ar.class_id = c.id
             AND ar.date > v_today - 30 AND ar.date <= v_today)
    FROM classes c
    LEFT JOIN LATERAL (
      SELECT round(avg(fr.percentage), 1) AS avg_pct,
             count(*)                     AS results,
             count(DISTINCT e.id)         AS exams
        FROM final_results fr
        JOIN student_exam_attempts a ON a.id = fr.attempt_id
        JOIN exams e ON e.id = a.exam_id
       WHERE a.class_id = c.id
         AND e.institution_id = v_inst
         AND e.status IN ('published','active','completed')
         AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
             BETWEEN v_ay_start AND v_ay_end
    ) r ON true
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE
     AND (p_wing_id IS NULL
          OR EXISTS (SELECT 1 FROM wing_class_mappings m
                      WHERE m.class_id = c.id AND m.wing_id = p_wing_id))
     AND (r.results IS NULL OR r.results = 0 OR r.results >= 5)
   ORDER BY r.avg_pct ASC NULLS LAST, c.name;
END $function$;

-- dash_classes_table(p_filters jsonb, p_limit integer, p_offset integer, p_institution_id uuid) : 2 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_classes_table(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_tz text; v_today date; v_rows jsonb; v_total int;
        v_only_flagged boolean := coalesce((p_filters->>'only_flagged')::boolean, false);
        v_wing uuid := nullif(p_filters->>'wing_id','')::uuid;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  WITH joined AS (
    SELECT c.id, c.name, c.section,
           (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id) AS students,
           (SELECT round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1)
              FROM attendance_records ar WHERE ar.class_id=c.id AND ar.date>v_today-30 AND ar.date<=v_today) AS attendance_30d,
           (SELECT round(avg(fr.percentage),1)
              FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id
              JOIN exams e ON e.id=a.exam_id AND e.status IN ('published','active','completed')
                AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-60
              WHERE a.class_id=c.id) AS recent_avg,
           (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
              AND df.subject_type='class' AND df.subject_key=c.id::text) AS active_flags
    FROM classes c
    WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
      AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings m WHERE m.class_id=c.id AND m.wing_id=v_wing))
  ),
  filtered AS (SELECT * FROM joined WHERE (NOT v_only_flagged OR active_flags > 0))
  SELECT count(*) INTO v_total FROM filtered;

  WITH joined AS (
    SELECT c.id, c.name, c.section,
           (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id) AS students,
           (SELECT round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1)
              FROM attendance_records ar WHERE ar.class_id=c.id AND ar.date>v_today-30 AND ar.date<=v_today) AS attendance_30d,
           (SELECT round(avg(fr.percentage),1)
              FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id
              JOIN exams e ON e.id=a.exam_id AND e.status IN ('published','active','completed')
                AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-60
              WHERE a.class_id=c.id) AS recent_avg,
           (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
              AND df.subject_type='class' AND df.subject_key=c.id::text) AS active_flags
    FROM classes c
    WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
      AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings m WHERE m.class_id=c.id AND m.wing_id=v_wing))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'class_id', j.id, 'name', j.name || coalesce(' '||j.section,''),
           'students', j.students, 'attendance_30d', j.attendance_30d,
           'recent_avg', j.recent_avg, 'active_flags', j.active_flags)
           ORDER BY j.recent_avg ASC NULLS LAST), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT * FROM joined WHERE (NOT v_only_flagged OR active_flags > 0)
    ORDER BY recent_avg ASC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  ) j;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $function$;

-- dash_evaluate_flags(p_institution_id uuid) : 7 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_evaluate_flags(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_adopt boolean; v_age_days int; v_codes text[]; v_rec record;
  v_detected int := 0; v_resolved int := 0; v_tasks int := 0;
  v_assignee uuid; v_task uuid; v_ttype task_type;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone, (CURRENT_DATE - created_at::date), dashboard_adoption_flags_enabled
    INTO v_tz, v_age_days, v_adopt FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end, v_today)::date;

  DROP TABLE IF EXISTS _detected;
  CREATE TEMP TABLE _detected (
    flag_code text, category text, severity text, subject_type text, subject_key text,
    title text, description text, metric_value numeric, link_url text
  ) ON COMMIT DROP;

  -- ===================== EXAM FAMILY (E1-E7) =====================

  INSERT INTO _detected SELECT 'E1','exams','warning','school','school',
    'Exams are still in draft', s.n||' exams have been in draft for over a week.', s.n, '/school/exams'
  FROM (SELECT count(*) n FROM exams WHERE institution_id=v_inst AND status='draft'
        AND created_at < now()-INTERVAL '7 days') s WHERE s.n >= 5;

  INSERT INTO _detected
  SELECT 'E2','exams','critical','exam', e.id::text,
    'Results are overdue', 'Results for "'||e.title||'" still aren''t published.', NULL, '/exams/'||e.id||'/results'
  FROM exams e
  WHERE e.institution_id=v_inst AND e.status='completed'
    AND COALESCE(e.scheduled_date::date, e.created_at::date) < v_today-5
    AND NOT EXISTS (SELECT 1 FROM student_exam_attempts a JOIN final_results fr ON fr.attempt_id=a.id
                    WHERE a.exam_id=e.id AND fr.is_published);

  INSERT INTO _detected
  SELECT 'E3','exams','warning','exam', x.id::text,
    'Few students took an exam', 'Only '||round(x.rate)||'% of students attempted "'||x.title||'".',
    round(x.rate,1), '/exams/'||x.id||'/results'
  FROM (
    SELECT e.id, e.title,
      (SELECT count(*) FROM student_exam_attempts a WHERE a.exam_id=e.id AND a.is_submitted)::numeric
        / NULLIF((SELECT count(*) FROM class_assignments ca WHERE ca.role='student'
                  AND ca.class_id IN (SELECT class_id FROM exam_classes WHERE exam_id=e.id)),0) * 100 AS rate
    FROM exams e
    WHERE e.institution_id=v_inst AND e.status IN ('published','active','completed')
      AND e.availability_end IS NOT NULL
      AND e.availability_end::timestamptz < now()
      AND e.availability_end::timestamptz > now() - INTERVAL '30 days'
  ) x WHERE x.rate IS NOT NULL AND x.rate < 60;

  INSERT INTO _detected
  SELECT 'E4','exams','critical','class', a.class_id::text,
    'A class scored very low in a recent exam',
    c.name||coalesce(' '||c.section,'')||' averaged '||round(avg(fr.percentage))||'% in '||e.title||'.',
    round(avg(fr.percentage),1), '/school/class/'||a.class_id
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id=fr.attempt_id
  JOIN exams e ON e.id=a.exam_id AND e.institution_id=v_inst AND e.status IN ('published','active','completed')
       AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-30
  JOIN classes c ON c.id=a.class_id
  GROUP BY a.class_id, e.id, e.title, c.name, c.section
  HAVING avg(fr.percentage) < 40;

  INSERT INTO _detected
  SELECT 'E5','exams','warning','subject', es.subject_id::text,
    'A subject is weak across the school',
    us.name||' is averaging '||round(avg(fr.percentage))||'% across the school this year.',
    round(avg(fr.percentage),1), '/school/subject/'||es.subject_id
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id=fr.attempt_id
  JOIN exams e ON e.id=a.exam_id AND e.institution_id=v_inst AND e.status IN ('published','active','completed')
       AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) BETWEEN v_ay_start AND v_ay_end
  JOIN exam_subjects es ON es.exam_id=e.id
  JOIN universal_subjects us ON us.id=es.subject_id
  GROUP BY es.subject_id, us.name
  HAVING avg(fr.percentage) < 50 AND count(DISTINCT e.id) >= 2;

  INSERT INTO _detected SELECT 'E6','exams','warning','school','school',
    'Recheck requests are piling up', s.n||' recheck requests have been open for over a week.', s.n, '/school/rechecks'
  FROM (
    SELECT count(*) n FROM recheck_requests rr
    JOIN final_results fr ON fr.id=rr.result_id
    JOIN student_exam_attempts a ON a.id=fr.attempt_id
    JOIN exams e ON e.id=a.exam_id
    WHERE e.institution_id=v_inst AND rr.status IN ('pending','in_review') AND rr.requested_at < now()-INTERVAL '7 days'
  ) s WHERE s.n >= 3;

  INSERT INTO _detected
  SELECT 'E7','exams','info','class', c.id::text,
    'A class hasn''t had a test recently', c.name||coalesce(' '||c.section,'')||' has had no exam in the last 30 days.',
    NULL, '/school/class/'||c.id
  FROM classes c
  WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
    AND EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id)
    AND EXISTS (SELECT 1 FROM exam_classes ec JOIN exams e ON e.id=ec.exam_id
                WHERE ec.class_id=c.id AND e.status IN ('published','active','completed'))
    AND NOT EXISTS (SELECT 1 FROM exam_classes ec JOIN exams e ON e.id=ec.exam_id
                WHERE ec.class_id=c.id AND e.status IN ('published','active','completed')
                  AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-30);

  -- ===================== ATTENDANCE FAMILY (A1-A7) =====================
  -- All self-suppress via cold-start when attendance data is sparse/absent.

  -- A1: class recent (last 5 working days) attendance < 70% AND >=12pp below 30-day school baseline (Critical)
  WITH wd5 AS (SELECT DISTINCT date FROM attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 5),
  last5 AS (SELECT ar.class_id, round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1) pct
            FROM attendance_records ar WHERE ar.institution_id=v_inst AND ar.date IN (SELECT date FROM wd5) GROUP BY ar.class_id),
  base AS (SELECT round((count(*) FILTER (WHERE status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1) pct
           FROM attendance_records WHERE institution_id=v_inst AND date>v_today-30 AND date<=v_today),
  cdays AS (SELECT class_id, count(DISTINCT date) d FROM attendance_records WHERE institution_id=v_inst GROUP BY class_id),
  cstud AS (SELECT class_id, count(*) n FROM class_assignments WHERE role='student' GROUP BY class_id)
  INSERT INTO _detected
  SELECT 'A1','attendance','critical','class', l.class_id::text,
    'Class attendance is very low',
    c.name||coalesce(' '||c.section,'')||'''s attendance is '||round(l.pct)||'% recently, well below the school''s '||round(b.pct)||'%.',
    l.pct, '/school/class/'||l.class_id
  FROM last5 l CROSS JOIN base b JOIN classes c ON c.id=l.class_id
  JOIN cdays cd ON cd.class_id=l.class_id JOIN cstud cs ON cs.class_id=l.class_id
  WHERE cd.d>=14 AND cs.n>=10 AND l.pct<70 AND b.pct IS NOT NULL AND (b.pct-l.pct)>=12;

  -- A2: slipping (5-day 70-80% or >=10pp below baseline), not already A1 (Warning)
  WITH wd5 AS (SELECT DISTINCT date FROM attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 5),
  last5 AS (SELECT ar.class_id, round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1) pct
            FROM attendance_records ar WHERE ar.institution_id=v_inst AND ar.date IN (SELECT date FROM wd5) GROUP BY ar.class_id),
  base AS (SELECT round((count(*) FILTER (WHERE status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1) pct
           FROM attendance_records WHERE institution_id=v_inst AND date>v_today-30 AND date<=v_today),
  cdays AS (SELECT class_id, count(DISTINCT date) d FROM attendance_records WHERE institution_id=v_inst GROUP BY class_id),
  cstud AS (SELECT class_id, count(*) n FROM class_assignments WHERE role='student' GROUP BY class_id)
  INSERT INTO _detected
  SELECT 'A2','attendance','warning','class', l.class_id::text,
    'Class attendance is slipping',
    c.name||coalesce(' '||c.section,'')||'''s recent attendance is '||round(l.pct)||'%.', l.pct, '/school/class/'||l.class_id
  FROM last5 l CROSS JOIN base b JOIN classes c ON c.id=l.class_id
  JOIN cdays cd ON cd.class_id=l.class_id JOIN cstud cs ON cs.class_id=l.class_id
  WHERE cd.d>=14 AND cs.n>=10
    AND NOT (l.pct<70 AND b.pct IS NOT NULL AND (b.pct-l.pct)>=12)
    AND ( (l.pct>=70 AND l.pct<=80) OR (b.pct IS NOT NULL AND (b.pct-l.pct)>=10) );

  -- A3: school attendance dropped this week vs prior week (Warning)
  WITH wk AS (SELECT round((count(*) FILTER(WHERE status IN('present','late','leave')))*100.0/NULLIF(count(*),0),1) pct
              FROM attendance_records WHERE institution_id=v_inst AND date>v_today-7 AND date<=v_today),
  pwk AS (SELECT round((count(*) FILTER(WHERE status IN('present','late','leave')))*100.0/NULLIF(count(*),0),1) pct
          FROM attendance_records WHERE institution_id=v_inst AND date>v_today-14 AND date<=v_today-7),
  days AS (SELECT count(DISTINCT date) d FROM attendance_records WHERE institution_id=v_inst)
  INSERT INTO _detected SELECT 'A3','attendance','warning','school','school',
    'School attendance dropped this week', 'Attendance is about '||round(pwk.pct-wk.pct)||' points lower than last week.', wk.pct, '/school/attendance'
  FROM wk, pwk, days WHERE days.d>=14 AND wk.pct IS NOT NULL AND pwk.pct IS NOT NULL AND (pwk.pct-wk.pct)>=8;

  -- A4: student missed >=6 of last 20 working days (Warning) Ã¢ÂÂ capped to 25 most-absent
  WITH wd20 AS (SELECT DISTINCT date FROM attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 20),
  stu AS (SELECT ar.student_id, count(*) FILTER (WHERE ar.status NOT IN ('present','late','leave')) AS missed, count(*) AS days
          FROM attendance_records ar WHERE ar.institution_id=v_inst AND ar.date IN (SELECT date FROM wd20) GROUP BY ar.student_id)
  INSERT INTO _detected
  SELECT 'A4','attendance','warning','student', s.student_id::text,
    'A student has missed a lot of school', p.full_name||' has missed '||s.missed||' of the last 20 school days.', s.missed, '/school/student/'||s.student_id
  FROM stu s JOIN profiles p ON p.id=s.student_id
  WHERE s.days>=10 AND s.missed>=6
  ORDER BY s.missed DESC LIMIT 25;

  -- A5: a class whose class-teacher is marked absent today (Critical)
  WITH absent_staff AS (SELECT staff_id FROM staff_attendance_records WHERE institution_id=v_inst AND date=v_today AND status='absent')
  INSERT INTO _detected
  SELECT 'A5','attendance','critical','class', ca.class_id::text,
    'A class''s teacher is absent today', c.name||coalesce(' '||c.section,'')||'''s class teacher is marked absent today.', NULL, '/school/class/'||ca.class_id
  FROM class_assignments ca
  JOIN absent_staff a ON a.staff_id=ca.user_id
  JOIN classes c ON c.id=ca.class_id AND c.institution_id=v_inst
  WHERE ca.role='teacher' AND ca.subject_id IS NULL;

  -- A6: a class with prior marking history that missed marking on >=2 of last 3 working days (Warning)
  WITH wd3 AS (SELECT DISTINCT date FROM attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 3),
  marked AS (SELECT class_id, count(DISTINCT date) d FROM attendance_records WHERE institution_id=v_inst AND date IN (SELECT date FROM wd3) GROUP BY class_id),
  hist AS (SELECT DISTINCT class_id FROM attendance_records WHERE institution_id=v_inst)
  INSERT INTO _detected
  SELECT 'A6','attendance','warning','class', c.id::text,
    'Attendance not being marked', c.name||coalesce(' '||c.section,'')||' hasn''t had attendance marked on recent days.', NULL, '/school/attendance'
  FROM classes c
  JOIN hist h ON h.class_id=c.id
  LEFT JOIN marked m ON m.class_id=c.id
  WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
    AND (SELECT count(*) FROM wd3) = 3 AND coalesce(m.d,0) <= 1;

  -- A7: teacher late >=4 times in last 10 staff working days (Info)
  WITH wd10 AS (SELECT DISTINCT date FROM staff_attendance_records WHERE institution_id=v_inst AND date<=v_today ORDER BY date DESC LIMIT 10),
  late AS (SELECT staff_id, count(*) FILTER (WHERE status='late') AS n, count(*) AS d
           FROM staff_attendance_records WHERE institution_id=v_inst AND date IN (SELECT date FROM wd10) GROUP BY staff_id)
  INSERT INTO _detected
  SELECT 'A7','attendance','info','teacher', l.staff_id::text,
    'A teacher is often late', p.full_name||' has been late '||l.n||' times recently.', l.n, '/school/teacher/'||l.staff_id
  FROM late l JOIN profiles p ON p.id=l.staff_id
  WHERE l.d>=10 AND l.n>=4;

  -- ===================== ADOPTION (kill-switch + onboarding grace gated) =====================
  IF v_adopt AND v_age_days > 14 THEN
    INSERT INTO _detected SELECT 'AD1','adoption','critical','school','school',
      'Some classes have no teacher assigned', s.n||' classes don''t have a teacher assigned yet.', s.n, '/school/users?tab=teachers'
    FROM (SELECT count(*) n FROM classes c WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
          AND NOT EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.class_id=c.id AND ca.role='teacher')) s WHERE s.n > 0;

    INSERT INTO _detected SELECT 'AD2','adoption','warning','school','school',
      'Some classes have no students yet', s.n||' classes don''t have any students yet.', s.n, '/school/users?tab=students'
    FROM (SELECT count(*) n FROM classes c WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
          AND NOT EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.class_id=c.id AND ca.role='student')) s WHERE s.n > 0;

    INSERT INTO _detected SELECT 'AD3','adoption','warning','school','school',
      'Some teachers haven''t logged in recently', s.n||' teachers haven''t logged in this week.', s.n, '/school/users?tab=teachers'
    FROM (SELECT count(*) n FROM user_roles ur JOIN auth.users u ON u.id=ur.user_id
          WHERE ur.institution_id=v_inst AND ur.role='teacher'
            AND (u.last_sign_in_at IS NULL OR u.last_sign_in_at < now()-INTERVAL '7 days')) s WHERE s.n > 0;

    -- AD4: a feature is enabled but unused in the last 30 days (one flag per feature, subject_key=feature)
    INSERT INTO _detected SELECT 'AD4','adoption','info','school','attendance',
      'A feature is on but unused','Attendance is enabled but nothing has been recorded in the last 30 days.', NULL, '/school/attendance'
    WHERE EXISTS (SELECT 1 FROM institution_features WHERE institution_id=v_inst AND feature_id='attendance' AND is_enabled)
      AND NOT EXISTS (SELECT 1 FROM attendance_records WHERE institution_id=v_inst AND date > v_today-30);

    INSERT INTO _detected SELECT 'AD4','adoption','info','school','exams',
      'A feature is on but unused','Exams are enabled but none have been created in the last 30 days.', NULL, '/school/exams'
    WHERE EXISTS (SELECT 1 FROM institution_features WHERE institution_id=v_inst AND feature_id='exams' AND is_enabled)
      AND NOT EXISTS (SELECT 1 FROM exams WHERE institution_id=v_inst AND created_at > now()-INTERVAL '30 days');

    -- AD5: active classes with no timetable set up
    INSERT INTO _detected SELECT 'AD5','adoption','info','school','school',
      'Timetable isn''t set up for some classes', s.n||' classes don''t have a timetable yet.', s.n, '/school/timetable'
    FROM (SELECT count(*) n FROM classes c WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
          AND NOT EXISTS (SELECT 1 FROM tt_slots t WHERE t.class_id=c.id)) s WHERE s.n > 0;
  END IF;

  -- AD6: low 7-day active-user rate (extra grace)
  IF v_adopt AND v_age_days > 30 THEN
    INSERT INTO _detected
    SELECT 'AD6','adoption','info','school','school',
      'Few people are using SALCI yet', round(u.active*100.0/NULLIF(u.total,0))||'% of users logged in this week.',
      round(u.active*100.0/NULLIF(u.total,0)), '/school/users'
    FROM (SELECT count(*) FILTER (WHERE us.last_sign_in_at > now()-INTERVAL '7 days') AS active, count(*) AS total
          FROM user_roles ur JOIN auth.users us ON us.id=ur.user_id
          WHERE ur.institution_id=v_inst AND ur.role IN ('teacher','coordinator','school_admin','student')) u
    WHERE u.total > 0 AND (u.active*100.0/NULLIF(u.total,0)) < 30;
  END IF;

  -- codes this run evaluated (so resolve only touches them)
  v_codes := ARRAY['E1','E2','E3','E4','E5','E6','E7','A1','A2','A3','A4','A5','A6','A7'];
  IF v_adopt AND v_age_days > 14 THEN v_codes := v_codes || ARRAY['AD1','AD2','AD3','AD4','AD5']; END IF;
  IF v_adopt AND v_age_days > 30 THEN v_codes := v_codes || ARRAY['AD6']; END IF;

  SELECT count(*) INTO v_detected FROM _detected;

  -- (1) UPSERT (dedup within batch by identity; worst metric wins for class-low)
  INSERT INTO dashboard_flags (institution_id,flag_code,category,severity,subject_type,subject_key,
                               title,description,metric_value,link_url,status,first_detected_at,last_evaluated_at)
  SELECT v_inst,flag_code,category,severity,subject_type,subject_key,title,description,metric_value,link_url,
         'red', now(), now()
  FROM (SELECT DISTINCT ON (flag_code, subject_key) * FROM _detected
        ORDER BY flag_code, subject_key, metric_value ASC NULLS LAST) d
  ON CONFLICT (institution_id,flag_code,subject_key) WHERE resolved_at IS NULL
  DO UPDATE SET last_evaluated_at=now(), metric_value=EXCLUDED.metric_value,
                title=EXCLUDED.title, description=EXCLUDED.description;

  -- (2) RESOLVE vanished
  UPDATE dashboard_flags df SET resolved_at=now()
  WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
    AND df.flag_code = ANY(v_codes)
    AND NOT EXISTS (SELECT 1 FROM _detected d WHERE d.flag_code=df.flag_code AND d.subject_key=df.subject_key);
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  -- (3) AUTO-TASK critical reds lacking a task
  FOR v_rec IN SELECT * FROM dashboard_flags
    WHERE institution_id=v_inst AND resolved_at IS NULL AND severity='critical' AND status='red' AND task_id IS NULL
  LOOP
    v_assignee := public.resolve_flag_assignee(v_inst, v_rec.subject_type, v_rec.subject_key);
    v_ttype := CASE WHEN v_rec.category='exams' THEN 'exam_related'::task_type
                    WHEN v_rec.category='attendance' THEN 'student_support'::task_type
                    ELSE 'administrative'::task_type END;
    INSERT INTO tasks (institution_id,title,description,task_type,priority,status,due_date,auto_created)
      VALUES (v_inst, v_rec.title, v_rec.description, v_ttype, 1, 'open', (v_today+2)::timestamptz, true)
      RETURNING id INTO v_task;
    IF v_assignee IS NOT NULL THEN
      -- assigner_id stays NULL = system/auto-created (rendered "SALCI System
      -- (auto-generated)" in Task Details; user decision 2026-07-24: never
      -- display an admin on auto-assigned tasks)
      INSERT INTO task_assignments (task_id,assignee_id,assigner_id) VALUES (v_task, v_assignee, NULL);
      INSERT INTO notifications (user_id,title,message,type,link,metadata)
        VALUES (v_assignee,'New task from dashboard', v_rec.title,'task_assigned','/tasks',
                jsonb_build_object('task_id',v_task,'flag_id',v_rec.id));
    END IF;
    UPDATE dashboard_flags SET status='amber', task_id=v_task, assignee_id=v_assignee, auto_created=true WHERE id=v_rec.id;
    v_tasks := v_tasks + 1;
  END LOOP;

  -- (4) BLUE: task closed but condition still present
  UPDATE dashboard_flags df SET status='blue'
  WHERE df.institution_id=v_inst AND df.resolved_at IS NULL AND df.task_id IS NOT NULL AND df.status='amber'
    AND EXISTS (SELECT 1 FROM tasks t WHERE t.id=df.task_id AND t.status IN ('completed','rejected'));

  RETURN jsonb_build_object('detected', v_detected, 'resolved', v_resolved, 'auto_tasks', v_tasks);
END $function$;

-- dash_kpi_summary(p_institution_id uuid) : 3 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_kpi_summary(p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_present int; v_total int;
  v_wk_present int; v_wk_total int; v_pwk_present int; v_pwk_total int;
  v_avg numeric; v_prev_avg numeric; v_exams int;
  v_need int; v_flags int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  SELECT count(*) FILTER (WHERE status IN ('present','late','leave')), count(*)
    INTO v_present, v_total
  FROM attendance_records WHERE institution_id = v_inst AND date = v_today;

  SELECT count(*) FILTER (WHERE status IN ('present','late','leave')), count(*)
    INTO v_wk_present, v_wk_total
  FROM attendance_records
  WHERE institution_id = v_inst AND date > v_today - 7 AND date <= v_today;
  SELECT count(*) FILTER (WHERE status IN ('present','late','leave')), count(*)
    INTO v_pwk_present, v_pwk_total
  FROM attendance_records
  WHERE institution_id = v_inst AND date > v_today - 14 AND date <= v_today - 7;

  SELECT round(avg(fr.percentage),1), count(DISTINCT e.id) INTO v_avg, v_exams
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id = fr.attempt_id
  JOIN exams e ON e.id = a.exam_id
  WHERE e.institution_id = v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) BETWEEN v_ay_start AND v_ay_end;

  SELECT round(avg(fr.percentage),1) INTO v_prev_avg
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id = fr.attempt_id
  JOIN exams e ON e.id = a.exam_id
  WHERE e.institution_id = v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
        BETWEEN (v_ay_start - INTERVAL '1 year')::date AND (v_ay_start - INTERVAL '1 day')::date;

  SELECT count(*) INTO v_need FROM public.dash_score_students(v_inst, NULL) WHERE score >= 20;

  SELECT count(*) INTO v_flags FROM dashboard_flags WHERE institution_id = v_inst AND resolved_at IS NULL;

  RETURN jsonb_build_object(
    'attendance_today', jsonb_build_object(
       'present', v_present, 'total', v_total, 'marked', v_total > 0,
       'pct', CASE WHEN v_total > 0 THEN round(v_present*100.0/v_total,1) END,
       'week_pct',  CASE WHEN v_wk_total  > 0 THEN round(v_wk_present *100.0/v_wk_total ,1) END,
       'prev_week_pct', CASE WHEN v_pwk_total > 0 THEN round(v_pwk_present*100.0/v_pwk_total,1) END),
    'school_avg', jsonb_build_object('pct', v_avg, 'prev_pct', v_prev_avg, 'exams_count', v_exams),
    'students_need_help', jsonb_build_object('count', v_need, 'prev_count', NULL),
    'decisions_waiting', jsonb_build_object('count', v_flags)
  );
END $function$;

-- dash_scoped_attendance_trend(p_days integer) : 2 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_scoped_attendance_trend(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_classes uuid[]; v_tz text; v_today date; v_points jsonb; v_all numeric;
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  SELECT timezone INTO v_tz FROM institutions WHERE id=v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT coalesce(jsonb_agg(jsonb_build_object('date',d.date,'present',d.present,'total',d.total,
           'pct', CASE WHEN d.total>0 THEN round(d.present*100.0/d.total,1) END) ORDER BY d.date),'[]'::jsonb)
    INTO v_points FROM (
      SELECT date, count(*) FILTER (WHERE status IN ('present','late','leave')) AS present, count(*) AS total
      FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes)
        AND date>v_today-p_days AND date<=v_today GROUP BY date) d;
  SELECT round((count(*) FILTER (WHERE status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1) INTO v_all
  FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes);
  RETURN jsonb_build_object('points',v_points,'all_time_avg',v_all);
END $function$;

-- dash_scoped_classes_table(p_filters jsonb, p_limit integer, p_offset integer) : 2 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_scoped_classes_table(p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_classes uuid[]; v_tz text; v_today date; v_rows jsonb; v_total int;
        v_only_flagged boolean := coalesce((p_filters->>'only_flagged')::boolean,false);
BEGIN
  v_inst := public.get_user_institution(auth.uid()); v_classes := public.dash_resolve_scoped_classes();
  SELECT timezone INTO v_tz FROM institutions WHERE id=v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  WITH joined AS (
    SELECT c.id, c.name, c.section,
      (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id) AS students,
      (SELECT round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1)
         FROM attendance_records ar WHERE ar.class_id=c.id AND ar.date>v_today-30 AND ar.date<=v_today) AS attendance_30d,
      (SELECT round(avg(fr.percentage),1) FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id
         JOIN exams e ON e.id=a.exam_id AND e.status IN ('published','active','completed')
           AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date)>v_today-60 WHERE a.class_id=c.id) AS recent_avg,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='class' AND df.subject_key=c.id::text) AS active_flags
    FROM classes c WHERE c.id = ANY(v_classes))
  SELECT count(*) INTO v_total FROM joined WHERE (NOT v_only_flagged OR active_flags>0);
  WITH joined AS (
    SELECT c.id, c.name, c.section,
      (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id) AS students,
      (SELECT round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1)
         FROM attendance_records ar WHERE ar.class_id=c.id AND ar.date>v_today-30 AND ar.date<=v_today) AS attendance_30d,
      (SELECT round(avg(fr.percentage),1) FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id
         JOIN exams e ON e.id=a.exam_id AND e.status IN ('published','active','completed')
           AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date)>v_today-60 WHERE a.class_id=c.id) AS recent_avg,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='class' AND df.subject_key=c.id::text) AS active_flags
    FROM classes c WHERE c.id = ANY(v_classes))
  SELECT coalesce(jsonb_agg(jsonb_build_object('class_id',j.id,'name',j.name||coalesce(' '||j.section,''),
           'students',j.students,'attendance_30d',j.attendance_30d,'recent_avg',j.recent_avg,'active_flags',j.active_flags)
           ORDER BY j.recent_avg ASC NULLS LAST),'[]'::jsonb) INTO v_rows
  FROM (SELECT * FROM joined WHERE (NOT v_only_flagged OR active_flags>0) ORDER BY recent_avg ASC NULLS LAST LIMIT p_limit OFFSET p_offset) j;
  RETURN jsonb_build_object('rows',v_rows,'total',v_total);
END $function$;

-- dash_scoped_kpi_summary() : 3 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_scoped_kpi_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_classes uuid[]; v_ctext text[]; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_present int; v_total int; v_wk_present int; v_wk_total int; v_pwk_present int; v_pwk_total int;
  v_avg numeric; v_prev_avg numeric; v_exams int; v_need int; v_flags int;
BEGIN
  v_inst := public.get_user_institution(auth.uid());
  v_classes := public.dash_resolve_scoped_classes();
  v_ctext := ARRAY(SELECT x::text FROM unnest(v_classes) AS x);
  SELECT timezone INTO v_tz FROM institutions WHERE id=v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today-INTERVAL '12 months')::date;
  v_ay_end := COALESCE(v_ay_end, v_today)::date;

  SELECT count(*) FILTER (WHERE status IN ('present','late','leave')), count(*) INTO v_present, v_total
  FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes) AND date=v_today;
  SELECT count(*) FILTER (WHERE status IN ('present','late','leave')), count(*) INTO v_wk_present, v_wk_total
  FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes) AND date>v_today-7 AND date<=v_today;
  SELECT count(*) FILTER (WHERE status IN ('present','late','leave')), count(*) INTO v_pwk_present, v_pwk_total
  FROM attendance_records WHERE institution_id=v_inst AND class_id = ANY(v_classes) AND date>v_today-14 AND date<=v_today-7;

  SELECT round(avg(fr.percentage),1), count(DISTINCT e.id) INTO v_avg, v_exams
  FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id AND a.class_id = ANY(v_classes)
  JOIN exams e ON e.id=a.exam_id WHERE e.institution_id=v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) BETWEEN v_ay_start AND v_ay_end;
  SELECT round(avg(fr.percentage),1) INTO v_prev_avg
  FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id AND a.class_id = ANY(v_classes)
  JOIN exams e ON e.id=a.exam_id WHERE e.institution_id=v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date)
        BETWEEN (v_ay_start-INTERVAL '1 year')::date AND (v_ay_start-INTERVAL '1 day')::date;

  SELECT count(*) INTO v_need FROM public.dash_score_students_scoped(v_inst, v_classes, NULL) WHERE score>=20;

  SELECT count(*) INTO v_flags FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
    AND ( (df.subject_type='class' AND df.subject_key = ANY(v_ctext))
       OR (df.subject_type='exam' AND EXISTS(SELECT 1 FROM exam_classes ec WHERE ec.exam_id::text=df.subject_key AND ec.class_id = ANY(v_classes)))
       OR (df.subject_type='student' AND EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=df.subject_key AND ca.role='student' AND ca.class_id = ANY(v_classes)))
       OR (df.subject_type='teacher' AND EXISTS(SELECT 1 FROM class_assignments ca WHERE ca.user_id::text=df.subject_key AND ca.role='teacher' AND ca.class_id = ANY(v_classes))) );

  RETURN jsonb_build_object(
    'attendance_today', jsonb_build_object('present',v_present,'total',v_total,'marked',v_total>0,
       'pct', CASE WHEN v_total>0 THEN round(v_present*100.0/v_total,1) END,
       'week_pct', CASE WHEN v_wk_total>0 THEN round(v_wk_present*100.0/v_wk_total,1) END,
       'prev_week_pct', CASE WHEN v_pwk_total>0 THEN round(v_pwk_present*100.0/v_pwk_total,1) END),
    'school_avg', jsonb_build_object('pct',v_avg,'prev_pct',v_prev_avg,'exams_count',v_exams),
    'students_need_help', jsonb_build_object('count',v_need,'prev_count',NULL),
    'decisions_waiting', jsonb_build_object('count',v_flags));
END $function$;

-- dash_score_students(p_institution_id uuid, p_weights jsonb) : 2 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_score_students(p_institution_id uuid, p_weights jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(student_id uuid, class_id uuid, score integer, band text, reason text, attendance numeric, recent_pct numeric, trend text, active_flags integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text; v_today date;
  w_att   int := coalesce((p_weights->>'attendance_gap')::int, 30);
  w_quart int := coalesce((p_weights->>'bottom_quartile')::int, 30);
  w_drop  int := coalesce((p_weights->>'dropped_half')::int, 25);
  w_flags int := coalesce((p_weights->>'flag_count')::int, 15);
  v_min   int := coalesce((p_weights->>'min_score')::int, 20);
  b_red   int := coalesce((p_weights->>'band_red')::int, 55);
  b_amber int := coalesce((p_weights->>'band_amber')::int, 35);
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_institution_id;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  RETURN QUERY
  WITH roster AS (
    SELECT ca.user_id AS sid, ca.class_id AS cid
    FROM class_assignments ca
    JOIN classes c ON c.id = ca.class_id AND c.institution_id = p_institution_id
    WHERE ca.role = 'student'
  ),
  stu_att AS (
    SELECT ar.student_id AS sid,
           round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1) AS pct,
           count(*) AS days
    FROM attendance_records ar
    WHERE ar.institution_id = p_institution_id AND ar.date > v_today - 30 AND ar.date <= v_today
    GROUP BY ar.student_id
  ),
  cls_att AS (
    SELECT ar.class_id AS cid,
           round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1) AS pct
    FROM attendance_records ar
    WHERE ar.institution_id = p_institution_id AND ar.date > v_today - 30 AND ar.date <= v_today
    GROUP BY ar.class_id
  ),
  results AS (
    SELECT a.student_id AS sid, a.class_id AS cid, a.exam_id, fr.percentage,
           coalesce(fr.finalized_at, fr.created_at) AS at
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = p_institution_id AND e.status IN ('published','active','completed')
  ),
  exam_counts AS (SELECT sid, count(*) AS n FROM results GROUP BY sid),
  ranked AS (
    SELECT r.*, row_number() OVER (PARTITION BY sid ORDER BY at DESC) AS rn
    FROM results r
  ),
  recent AS (
    SELECT rk.sid, rk.cid, rk.exam_id, rk.percentage,
           percent_rank() OVER (PARTITION BY rk.exam_id, rk.cid ORDER BY rk.percentage) AS pr
    FROM ranked rk WHERE rk.rn = 1
  ),
  halves AS (
    SELECT sid, cid,
           avg(percentage) FILTER (WHERE rn <= 3) AS recent_avg,
           avg(percentage) FILTER (WHERE rn > 3) AS older_avg
    FROM ranked GROUP BY sid, cid
  ),
  cls_halves AS (
    SELECT cid,
           avg(percentage) FILTER (WHERE rn <= 3) AS cls_recent_avg,
           avg(percentage) FILTER (WHERE rn > 3) AS cls_older_avg
    FROM ranked GROUP BY cid
  ),
  flagn AS (
    SELECT subject_key AS sid_text, count(*) AS n FROM dashboard_flags
    WHERE institution_id = p_institution_id AND resolved_at IS NULL AND subject_type='student'
    GROUP BY subject_key
  ),
  scored AS (
    SELECT ro.sid, ro.cid,
      sa.pct AS att_pct, re.percentage AS rec_pct,
      sa.days AS att_days, ec.n AS exam_n,
      (sa.pct IS NOT NULL AND ca2.pct IS NOT NULL AND (ca2.pct - sa.pct) > 15)                          AS f_att,
      (re.pr IS NOT NULL AND re.pr <= 0.25)                                                              AS f_quart,
      (h.older_avg IS NOT NULL AND ch.cls_older_avg IS NOT NULL AND ch.cls_recent_avg IS NOT NULL
        AND h.older_avg >= ch.cls_older_avg AND h.recent_avg < ch.cls_recent_avg)                        AS f_drop,
      (coalesce(fn.n,0) >= 3)                                                                            AS f_flags,
      coalesce(fn.n,0) AS flag_n
    FROM roster ro
    LEFT JOIN stu_att sa ON sa.sid = ro.sid
    LEFT JOIN cls_att ca2 ON ca2.cid = ro.cid
    LEFT JOIN recent re ON re.sid = ro.sid
    LEFT JOIN halves h ON h.sid = ro.sid
    LEFT JOIN cls_halves ch ON ch.cid = ro.cid
    LEFT JOIN exam_counts ec ON ec.sid = ro.sid
    LEFT JOIN flagn fn ON fn.sid_text = ro.sid::text
  ),
  final AS (
    SELECT sid, cid, att_pct, rec_pct,
      (CASE WHEN f_att THEN w_att ELSE 0 END
       + CASE WHEN f_quart THEN w_quart ELSE 0 END
       + CASE WHEN f_drop THEN w_drop ELSE 0 END
       + CASE WHEN f_flags THEN w_flags ELSE 0 END) AS sc,
      f_att, f_quart, f_drop, flag_n, att_days, exam_n
    FROM scored
    -- EITHER kind of evidence is enough to judge on. See the header.
    WHERE coalesce(att_days,0) >= 10 OR coalesce(exam_n,0) >= 2
  )
  SELECT f.sid, f.cid, f.sc::int AS score,
    CASE WHEN f.sc >= b_red THEN 'red' WHEN f.sc >= b_amber THEN 'amber' ELSE 'yellow' END AS band,
    trim(BOTH ', ' FROM concat_ws(', ',
      CASE WHEN f.f_quart THEN 'recent marks among the lowest in class' END,
      CASE WHEN f.f_att   THEN 'attendance well below class' END,
      CASE WHEN f.f_drop  THEN 'was above average, now below' END,
      CASE WHEN f.flag_n >= 3 THEN f.flag_n || ' active flags' END
    )) AS reason,
    f.att_pct, f.rec_pct,
    CASE WHEN f.f_drop THEN 'down' ELSE 'flat' END AS trend,
    f.flag_n::int AS active_flags
  FROM final f
  WHERE f.sc >= v_min;
END $function$;

-- dash_score_students_scoped(p_institution_id uuid, p_class_ids uuid[], p_weights jsonb) : 2 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_score_students_scoped(p_institution_id uuid, p_class_ids uuid[], p_weights jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(student_id uuid, class_id uuid, score integer, band text, reason text, attendance numeric, recent_pct numeric, trend text, active_flags integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text; v_today date;
  w_att int := coalesce((p_weights->>'attendance_gap')::int,30);
  w_quart int := coalesce((p_weights->>'bottom_quartile')::int,30);
  w_drop int := coalesce((p_weights->>'dropped_half')::int,25);
  w_flags int := coalesce((p_weights->>'flag_count')::int,15);
  v_min int := coalesce((p_weights->>'min_score')::int,20);
  b_red int := coalesce((p_weights->>'band_red')::int,55);
  b_amber int := coalesce((p_weights->>'band_amber')::int,35);
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_institution_id;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  RETURN QUERY
  WITH roster AS (
    SELECT ca.user_id AS sid, ca.class_id AS cid
    FROM class_assignments ca WHERE ca.role='student' AND ca.class_id = ANY(p_class_ids)
  ),
  stu_att AS (
    SELECT ar.student_id AS sid,
           round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1) AS pct,
           count(*) AS days
    FROM attendance_records ar
    WHERE ar.institution_id=p_institution_id AND ar.class_id = ANY(p_class_ids)
      AND ar.date > v_today-30 AND ar.date <= v_today GROUP BY ar.student_id
  ),
  cls_att AS (
    SELECT ar.class_id AS cid,
           round((count(*) FILTER (WHERE ar.status IN ('present','late','leave')))*100.0/NULLIF(count(*),0),1) AS pct
    FROM attendance_records ar
    WHERE ar.institution_id=p_institution_id AND ar.class_id = ANY(p_class_ids)
      AND ar.date > v_today-30 AND ar.date <= v_today GROUP BY ar.class_id
  ),
  results AS (
    SELECT a.student_id AS sid, a.class_id AS cid, a.exam_id, fr.percentage, coalesce(fr.finalized_at,fr.created_at) AS at
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id=fr.attempt_id AND a.class_id = ANY(p_class_ids)
    JOIN exams e ON e.id=a.exam_id AND e.institution_id=p_institution_id AND e.status IN ('published','active','completed')
  ),
  exam_counts AS (SELECT sid, count(*) AS n FROM results GROUP BY sid),
  ranked AS (SELECT r.*, row_number() OVER (PARTITION BY sid ORDER BY at DESC) AS rn FROM results r),
  recent AS (SELECT rk.sid, rk.cid, rk.exam_id, rk.percentage,
             percent_rank() OVER (PARTITION BY rk.exam_id, rk.cid ORDER BY rk.percentage) AS pr
             FROM ranked rk WHERE rk.rn=1),
  halves AS (SELECT sid, cid, avg(percentage) FILTER (WHERE rn<=3) AS recent_avg,
             avg(percentage) FILTER (WHERE rn>3) AS older_avg FROM ranked GROUP BY sid, cid),
  cls_halves AS (SELECT cid, avg(percentage) FILTER (WHERE rn<=3) AS cls_recent_avg,
             avg(percentage) FILTER (WHERE rn>3) AS cls_older_avg FROM ranked GROUP BY cid),
  flagn AS (SELECT subject_key AS sid_text, count(*) AS n FROM dashboard_flags
            WHERE institution_id=p_institution_id AND resolved_at IS NULL AND subject_type='student' GROUP BY subject_key),
  scored AS (
    SELECT ro.sid, ro.cid, sa.pct AS att_pct, re.percentage AS rec_pct, sa.days AS att_days, ec.n AS exam_n,
      (sa.pct IS NOT NULL AND ca2.pct IS NOT NULL AND (ca2.pct-sa.pct)>15) AS f_att,
      (re.pr IS NOT NULL AND re.pr<=0.25) AS f_quart,
      (h.older_avg IS NOT NULL AND ch.cls_older_avg IS NOT NULL AND ch.cls_recent_avg IS NOT NULL
        AND h.older_avg>=ch.cls_older_avg AND h.recent_avg<ch.cls_recent_avg) AS f_drop,
      (coalesce(fn.n,0)>=3) AS f_flags, coalesce(fn.n,0) AS flag_n
    FROM roster ro
    LEFT JOIN stu_att sa ON sa.sid=ro.sid
    LEFT JOIN cls_att ca2 ON ca2.cid=ro.cid
    LEFT JOIN recent re ON re.sid=ro.sid
    LEFT JOIN halves h ON h.sid=ro.sid
    LEFT JOIN cls_halves ch ON ch.cid=ro.cid
    LEFT JOIN exam_counts ec ON ec.sid=ro.sid
    LEFT JOIN flagn fn ON fn.sid_text=ro.sid::text
  ),
  final AS (
    SELECT sid, cid, att_pct, rec_pct,
      (CASE WHEN f_att THEN w_att ELSE 0 END + CASE WHEN f_quart THEN w_quart ELSE 0 END
       + CASE WHEN f_drop THEN w_drop ELSE 0 END + CASE WHEN f_flags THEN w_flags ELSE 0 END) AS sc,
      f_att, f_quart, f_drop, flag_n, att_days, exam_n
    FROM scored -- EITHER kind of evidence is enough to judge on. See the header.
    WHERE coalesce(att_days,0)>=10 OR coalesce(exam_n,0)>=2
  )
  SELECT f.sid, f.cid, f.sc::int,
    CASE WHEN f.sc>=b_red THEN 'red' WHEN f.sc>=b_amber THEN 'amber' ELSE 'yellow' END,
    trim(BOTH ', ' FROM concat_ws(', ',
      CASE WHEN f.f_quart THEN 'recent marks among the lowest in class' END,
      CASE WHEN f.f_att THEN 'attendance well below class' END,
      CASE WHEN f.f_drop THEN 'was above average, now below' END,
      CASE WHEN f.flag_n>=3 THEN f.flag_n||' active flags' END)),
    f.att_pct, f.rec_pct, CASE WHEN f.f_drop THEN 'down' ELSE 'flat' END, f.flag_n::int
  FROM final f WHERE f.sc>=v_min;
END $function$;

-- dash_teacher_attendance_trend(p_days integer, p_class_id uuid) : 2 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_teacher_attendance_trend(p_days integer DEFAULT 30, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_classes uuid[]; v_tz text; v_today date; v_points jsonb; v_all numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(auth.uid());

  SELECT array_agg(DISTINCT p.class_id) INTO v_classes
    FROM public.dash_resolve_scoped_pairs() p;
  IF v_classes IS NULL THEN
    RETURN jsonb_build_object('points', '[]'::jsonb, 'all_time_avg', NULL);
  END IF;

  IF p_class_id IS NOT NULL THEN
    IF NOT (p_class_id = ANY(v_classes)) THEN
      RAISE EXCEPTION 'dashboard: class not in scope';
    END IF;
    v_classes := ARRAY[p_class_id];
  END IF;

  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.date, 'present', d.present, 'total', d.total,
           'pct', CASE WHEN d.total > 0 THEN round(d.present * 100.0 / d.total, 1) END)
         ORDER BY d.date), '[]'::jsonb)
    INTO v_points
    FROM (
      SELECT date,
             count(*) FILTER (WHERE status IN ('present','late','leave')) AS present,
             count(*) AS total
        FROM attendance_records
       WHERE institution_id = v_inst AND class_id = ANY(v_classes)
         AND date > v_today - p_days AND date <= v_today
       GROUP BY date) d;

  SELECT round((count(*) FILTER (WHERE status IN ('present','late','leave'))) * 100.0 / NULLIF(count(*), 0), 1)
    INTO v_all
    FROM attendance_records
   WHERE institution_id = v_inst AND class_id = ANY(v_classes);

  RETURN jsonb_build_object('points', v_points, 'all_time_avg', v_all);
END $function$;

-- dash_teacher_kpi_summary() : 3 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_teacher_kpi_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_classes uuid[]; v_ctext text[];
  v_pc uuid[]; v_ps uuid[];
  v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_present int; v_total int; v_wk_present int; v_wk_total int;
  v_pwk_present int; v_pwk_total int;
  v_avg numeric; v_prev_avg numeric; v_exams int; v_need int; v_flags int;
BEGIN
  v_inst := public.get_user_institution(auth.uid());

  -- Pair arrays are unnested together below; a teacher has tens of pairs at most.
  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps
    FROM public.dash_resolve_scoped_pairs() p;

  IF v_pc IS NULL THEN
    v_pc := ARRAY[]::uuid[]; v_ps := ARRAY[]::uuid[];
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_classes FROM unnest(v_pc) AS x;
  v_classes := COALESCE(v_classes, ARRAY[]::uuid[]);
  v_ctext := ARRAY(SELECT x::text FROM unnest(v_classes) AS x);

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end, v_today)::date;

  -- (c) Attendance: class-level, unchanged.
  SELECT count(*) FILTER (WHERE ar.status IN ('present','late','leave')), count(*)
    INTO v_present, v_total
    FROM attendance_records ar
    WHERE ar.institution_id = v_inst AND ar.class_id = ANY(v_classes) AND ar.date = v_today;
  SELECT count(*) FILTER (WHERE ar.status IN ('present','late','leave')), count(*)
    INTO v_wk_present, v_wk_total
    FROM attendance_records ar
    WHERE ar.institution_id = v_inst AND ar.class_id = ANY(v_classes)
      AND ar.date > v_today - 7 AND ar.date <= v_today;
  SELECT count(*) FILTER (WHERE ar.status IN ('present','late','leave')), count(*)
    INTO v_pwk_present, v_pwk_total
    FROM attendance_records ar
    WHERE ar.institution_id = v_inst AND ar.class_id = ANY(v_classes)
      AND ar.date > v_today - 14 AND ar.date <= v_today - 7;

  -- (a) Academic average, restricted to the caller's own (class, subject) pairs.
  SELECT round(avg(fr.percentage), 1), count(DISTINCT e.id)
    INTO v_avg, v_exams
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
    JOIN exam_subjects es ON es.exam_id = e.id
    WHERE e.institution_id = v_inst
      AND e.status IN ('published','active','completed')
      AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
          BETWEEN v_ay_start AND v_ay_end
      AND EXISTS (
        SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
        WHERE pr.cid = a.class_id AND (pr.sid IS NULL OR pr.sid = es.subject_id)
      );

  SELECT round(avg(fr.percentage), 1)
    INTO v_prev_avg
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id
    JOIN exam_subjects es ON es.exam_id = e.id
    WHERE e.institution_id = v_inst
      AND e.status IN ('published','active','completed')
      AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
          BETWEEN (v_ay_start - INTERVAL '1 year')::date AND (v_ay_start - INTERVAL '1 day')::date
      AND EXISTS (
        SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
        WHERE pr.cid = a.class_id AND (pr.sid IS NULL OR pr.sid = es.subject_id)
      );

  -- Students needing help stays class-level: these are the caller's own pupils,
  -- and the per-subject signal set is Phase 3 (homework / attendance / attempts).
  SELECT count(*) INTO v_need
    FROM public.dash_score_students_scoped(v_inst, v_classes, NULL)
   WHERE score >= 20
     -- Subject-scoped (policy 2026-08-26). Attendance KPIs above stay
     -- class-based on purpose - attendance is the one whole-class surface.
     AND student_id IN (SELECT r.student_id
                          FROM public.teacher_roster_student_ids(auth.uid(), v_classes) r);

  -- (b) Flags: teacher-subject flags are restricted to the caller themself.
  SELECT count(*) INTO v_flags
    FROM dashboard_flags df
    WHERE df.institution_id = v_inst AND df.resolved_at IS NULL
      AND (
           (df.subject_type = 'class' AND df.subject_key = ANY(v_ctext))
        OR (df.subject_type = 'exam' AND EXISTS (
              SELECT 1 FROM exam_classes ec
              WHERE ec.exam_id::text = df.subject_key AND ec.class_id = ANY(v_classes)))
        OR (df.subject_type = 'student' AND EXISTS (
              SELECT 1 FROM class_assignments ca
              WHERE ca.user_id::text = df.subject_key AND ca.role = 'student'
                AND ca.class_id = ANY(v_classes)))
        OR (df.subject_type = 'teacher' AND df.subject_key = auth.uid()::text)
      );

  RETURN jsonb_build_object(
    'attendance_today', jsonb_build_object(
      'present', v_present, 'total', v_total, 'marked', v_total > 0,
      'pct', CASE WHEN v_total > 0 THEN round(v_present * 100.0 / v_total, 1) END,
      'week_pct', CASE WHEN v_wk_total > 0 THEN round(v_wk_present * 100.0 / v_wk_total, 1) END,
      'prev_week_pct', CASE WHEN v_pwk_total > 0 THEN round(v_pwk_present * 100.0 / v_pwk_total, 1) END),
    'school_avg', jsonb_build_object('pct', v_avg, 'prev_pct', v_prev_avg, 'exams_count', v_exams),
    'students_need_help', jsonb_build_object('count', v_need, 'prev_count', NULL),
    'decisions_waiting', jsonb_build_object('count', v_flags));
END $function$;

-- dash_teacher_students_attention(p_limit integer) : 1 substitution(s)
CREATE OR REPLACE FUNCTION public.dash_teacher_students_attention(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid;
  v_pc uuid[]; v_ps uuid[]; v_classes uuid[]; v_rows jsonb;
  v_tz text; v_today date;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_inst := public.get_user_institution(v_uid);

  SELECT array_agg(p.class_id), array_agg(p.subject_id)
    INTO v_pc, v_ps FROM public.dash_resolve_scoped_pairs() p;
  IF v_pc IS NULL THEN
    RETURN jsonb_build_object('has_data', false, 'students', '[]'::jsonb);
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_classes FROM unnest(v_pc) AS x;

  SELECT i.timezone INTO v_tz FROM institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  WITH roster AS (
    -- The teacher's OWN students (policy 2026-08-26): subject-scoped.
    -- Dormant optional subjects still yield the whole class inside
    -- teacher_roster_student_ids, so this cannot collapse to one pupil.
    SELECT ca.user_id AS student_id,
           (array_agg(ca.class_id ORDER BY ca.class_id))[1] AS class_id
      FROM class_assignments ca
     WHERE ca.role = 'student' AND ca.class_id = ANY(v_classes)
       AND ca.user_id IN (SELECT r.student_id
                            FROM public.teacher_roster_student_ids(v_uid, v_classes) r)
     GROUP BY ca.user_id
  ),
  perf AS (
    SELECT a.student_id, round(avg(fr.percentage), 1) AS pct
      FROM student_exam_attempts a
      JOIN final_results fr ON fr.attempt_id = a.id
      JOIN exams e  ON e.id = a.exam_id AND e.institution_id = v_inst
      JOIN exam_subjects es ON es.exam_id = e.id
     WHERE EXISTS (SELECT 1 FROM unnest(v_pc, v_ps) AS pr(cid, sid)
                    WHERE pr.cid = a.class_id AND (pr.sid IS NULL OR pr.sid = es.subject_id))
     GROUP BY a.student_id
  ),
  att AS (
    SELECT ar.student_id,
           round(count(*) FILTER (WHERE ar.status IN ('present','late','leave')) * 100.0
                 / NULLIF(count(*), 0), 0) AS pct
      FROM attendance_records ar
     WHERE ar.class_id = ANY(v_classes) AND ar.date > v_today - 30
     GROUP BY ar.student_id
  ),
  hw_recent AS (
    SELECT h.id, hac.class_id,
           row_number() OVER (PARTITION BY hac.class_id
                              ORDER BY h.due_at DESC NULLS LAST, h.created_at DESC) AS rn
      FROM homework_assignments h
      JOIN homework_assignment_classes hac ON hac.homework_assignment_id = h.id
     WHERE h.created_by = v_uid AND hac.class_id = ANY(v_classes)
  ),
  hw AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE s.id IS NULL) AS missed, count(*) AS expected
      FROM roster r
      JOIN hw_recent hr ON hr.class_id = r.class_id AND hr.rn <= 5
      LEFT JOIN homework_submissions s
             ON s.homework_assignment_id = hr.id AND s.student_id = r.student_id
     GROUP BY r.student_id
  ),
  ex_recent AS (
    SELECT e.id, ec.class_id,
           row_number() OVER (PARTITION BY ec.class_id
                              ORDER BY COALESCE(e.scheduled_date, e.created_at::date) DESC) AS rn
      FROM exams e
      JOIN exam_classes ec ON ec.exam_id = e.id
     WHERE e.created_by = v_uid AND ec.class_id = ANY(v_classes)
       AND e.status IN ('published','active','completed')
  ),
  ex AS (
    SELECT r.student_id,
           count(*) FILTER (WHERE a.id IS NULL) AS skipped, count(*) AS expected
      FROM roster r
      JOIN ex_recent er ON er.class_id = r.class_id AND er.rn <= 3
      LEFT JOIN student_exam_attempts a
             ON a.exam_id = er.id AND a.student_id = r.student_id
     GROUP BY r.student_id
  ),
  scored AS (
    SELECT r.student_id, r.class_id,
           (perf.pct IS NOT NULL AND perf.pct < 50)     AS s_perf,
           (att.pct  IS NOT NULL AND att.pct  < 75)     AS s_att,
           (COALESCE(hw.missed, 0) >= 2)                AS s_hw,
           (COALESCE(ex.skipped, 0) >= 1)               AS s_ex,
           perf.pct AS perf_pct, att.pct AS att_pct,
           hw.missed, hw.expected AS hw_expected,
           ex.skipped, ex.expected AS ex_expected
      FROM roster r
      LEFT JOIN perf ON perf.student_id = r.student_id
      LEFT JOIN att  ON att.student_id  = r.student_id
      LEFT JOIN hw   ON hw.student_id   = r.student_id
      LEFT JOIN ex   ON ex.student_id   = r.student_id
  ),
  ranked AS (
    SELECT s.*, (s_perf::int + s_att::int + s_hw::int + s_ex::int) AS signals
      FROM scored s
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY signals DESC, COALESCE(perf_pct, 100) ASC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT jsonb_build_object(
             'student_id',   rk.student_id,
             'student_name', (SELECT pf.full_name FROM profiles pf WHERE pf.id = rk.student_id),
             'class_id',     rk.class_id,
             'class_name',   c.name,
             'section',      c.section,
             'severity',     CASE WHEN rk.signals >= 3 THEN 'high'
                                  WHEN rk.signals = 2  THEN 'medium'
                                  ELSE 'watch' END,
             'reasons',      (
               SELECT jsonb_agg(z) FROM (
                 SELECT 'Scoring ' || rk.perf_pct || '% in your subject' AS z WHERE rk.s_perf
                 UNION ALL
                 SELECT 'Attendance ' || rk.att_pct || '% in your classes' WHERE rk.s_att
                 UNION ALL
                 SELECT 'Missed ' || rk.missed || ' of ' || rk.hw_expected || ' homework' WHERE rk.s_hw
                 UNION ALL
                 SELECT 'Skipped ' || rk.skipped || ' of ' || rk.ex_expected || ' tests' WHERE rk.s_ex
               ) r2(z))
           ) AS x, rk.signals, rk.perf_pct
      FROM ranked rk
      JOIN classes c ON c.id = rk.class_id
     WHERE rk.signals > 0
     ORDER BY rk.signals DESC, COALESCE(rk.perf_pct, 100) ASC
     LIMIT p_limit
  ) q;

  RETURN jsonb_build_object('has_data', jsonb_array_length(v_rows) > 0, 'students', v_rows);
END $function$;
