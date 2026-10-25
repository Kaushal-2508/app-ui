-- =============================================================
-- Exam slot booking: two live exams may never overlap for the same section.
-- Design: docs/superpowers/specs/2026-09-28-exam-slot-booking-design.md
-- -------------------------------------------------------------
-- The bug: two teachers (Hindi and English, say) could both publish an exam for
-- Class 8 A at 14:00, and a student cannot sit both. Nothing checked. Prod on
-- 2026-09-28 held 56 historical overlapping pairs (8 with the exact same start),
-- all in the past, so this ships with no cleanup and never re-checks old rows.
--
-- What this adds:
--   1. exam_slot_occupied_until()      how long an exam holds its students.
--   2. exam_slot_subjects_are_alternatives()  two exams on subjects of ONE
--      optional group run side by side on purpose (each student takes at most
--      one subject per group), so they never clash with each other.
--   3. can_view_class_exam_slots()     who may SEE a section's booked times:
--      its teachers (any class_assignments teacher row, the same set the exam
--      class picker offers), its wing coordinator, its school admins.
--   4. get_exam_slot_bookings()        the ONLY read path for the publish sheet.
--      RLS already lets every member of a school read every exam row, students
--      included, so "only that class's teachers see its bookings" cannot rest on
--      RLS. This DEFINER RPC filters by the caller's authority per section.
--   5. A race-safe guard: triggers on exams, exam_classes, exam_subjects and
--      hybrid_exam_settings. A per-section advisory lock serialises every writer
--      that could book a section, then the overlap check runs in a fresh
--      statement, so two teachers publishing in the same second cannot both win.
--
-- An exclusion constraint is not possible here: the window lives on exams, the
-- section on exam_classes, and btree_gist is not installed.
--
-- The rule (half-open, so back-to-back exams are fine):
--   an exam holds [start_time, occupied_until) for every section it is linked to
--   while it is live: status published/active (completed also blocks others),
--   exam_mode online/hybrid, start_time set. Offline exams (every results-only
--   exam is offline) carry a date only and never book a time.
--
-- Hardening from review (2026-09-28), each a way round the guard:
--   * is_results_only is NOT an exemption: students can sit a results-only row
--     whose mode is online, so flipping the flag must not free its slot.
--   * an online/hybrid exam cannot go live, or stay live, without a start_time
--     (it would be sittable yet book nothing). 8 legacy rows are untouched.
--   * a section of another school can never be linked to an exam: the
--     exam_classes INSERT policy never compared institutions, and with this
--     guard that became a cross-school timetable oracle.
--   * subject UPDATEs, a direct delete of an exam's last subject, and moving a
--     hybrid settings row onto another exam are all re-checked.
--   * the child-row re-check locks the exam row, so it cannot race a publish.
-- =============================================================

-- 1. Occupancy -----------------------------------------------------------------

-- end_time is the last possible finish for exams saved by the current flow
-- (start + late entry + duration). Corrections, from how students are actually
-- let in and timed:
--   * late entry NULL or 0 means "no dedicated join window": student_eligible_exams
--     then lets students join until end_time (20260630140000).
--       - ONLINE: exam_attempt_remaining_seconds caps every attempt at end_time,
--         so nobody writes past it: the exam ends at end_time.
--       - HYBRID: the attempt timer runs started_at + duration with no end cap,
--         so a late joiner runs until end_time + duration.
--       - no end_time at all: no cap either, so + duration.
--   * a hybrid exam then gives each student a phone upload window counted from
--     their own submission (hybrid_close_expired_upload_windows, default 5 min).
-- src/lib/examSlots.ts mirrors this for the sheet's preview. Keep them identical.
CREATE OR REPLACE FUNCTION public.exam_slot_occupied_until(
  _start timestamptz,
  _end timestamptz,
  _late_entry_minutes integer,
  _duration_minutes integer,
  _mode public.exam_mode,
  _grace_minutes integer
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _start IS NULL THEN NULL
    ELSE GREATEST(
      _start + interval '1 minute',
      COALESCE(
        _end,
        _start + make_interval(mins => COALESCE(_late_entry_minutes, 0) + COALESCE(_duration_minutes, 0))
      )
      + CASE
          WHEN COALESCE(_late_entry_minutes, 0) > 0 THEN interval '0'
          WHEN _mode = 'hybrid' OR _end IS NULL THEN make_interval(mins => COALESCE(_duration_minutes, 0))
          ELSE interval '0'
        END
      + CASE
          WHEN _mode = 'hybrid' THEN make_interval(mins => COALESCE(_grace_minutes, 5))
          ELSE interval '0'
        END
    )
  END
$$;

COMMENT ON FUNCTION public.exam_slot_occupied_until(timestamptz, timestamptz, integer, integer, public.exam_mode, integer) IS
  'When an exam stops holding its students: end_time (+ duration with no late-entry window for hybrid or a NULL end_time; online attempts are capped at end_time), + upload grace for hybrid. Mirrored in src/lib/examSlots.ts. See 20260928170000.';

-- Is this exam trying to hold a slot right now? Only a LIVE exam books a time.
-- completed is not here on purpose: moving published -> completed (validating
-- results) must never re-check, or the 56 legacy overlaps would block it. A
-- completed exam still blocks OTHER exams (see _exam_slot_bookings).
-- is_results_only is deliberately not a term: every real results-only exam is
-- offline, and an online one is still sittable, so the flag must not free a slot.
CREATE OR REPLACE FUNCTION public._exam_slot_is_live(
  _status public.exam_status,
  _mode public.exam_mode,
  _start timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _status IN ('published', 'active')
     AND _mode IN ('online', 'hybrid')
     AND _start IS NOT NULL
$$;

-- 2. Optional-group alternatives --------------------------------------------------

-- TRUE when every subject of both exams sits in ONE optional group of the
-- section's class group and the two exams share no subject: no student takes
-- both, so the school may run them in the same period (Maths vs Biology,
-- Economics vs Punjabi at Alliance). Subject names and
-- subject_class_group_mappings.is_optional are NOT signals: Punjabi vs Hindi in
-- Class 8 B is compulsory, and 16 of the legacy pairs had both flagged optional
-- without sharing a group.
CREATE OR REPLACE FUNCTION public.exam_slot_subjects_are_alternatives(
  _class_id uuid,
  _subjects_a uuid[],
  _subjects_b uuid[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(cardinality(_subjects_a), 0) > 0
     AND COALESCE(cardinality(_subjects_b), 0) > 0
     AND NOT (_subjects_a && _subjects_b)
     AND EXISTS (
       SELECT 1
       FROM public.classes c
       JOIN public.optional_groups g ON g.class_group_id = c.class_group_id
       WHERE c.id = _class_id
         AND NOT EXISTS (
           SELECT 1
           FROM unnest(_subjects_a || _subjects_b) AS s(subject_id)
           WHERE NOT EXISTS (
             SELECT 1
             FROM public.optional_group_subjects ogs
             WHERE ogs.group_id = g.id
               AND ogs.subject_id = s.subject_id
           )
         )
     )
$$;

-- 3. Who may see a section's booked times -----------------------------------------

-- Deliberately NOT subject-scoped (teacher_controls_student is for student data):
-- the Hindi teacher of 9 A must see the English teacher's 9 A exam, or the
-- feature cannot work. The teacher branch is any role='teacher' row on the
-- section, subject or not, which is exactly what useExamClassHierarchy offers in
-- the exam class picker. Never use is_assigned_to_class here: it matches
-- role='student' rows. is_coordinator_for_class checks neither role nor
-- institution (7 wing assignees lack the role), so both are ANDed in. The admin
-- branch reads user_roles.institution_id directly because has_role_at_institution
-- treats a NULL institution as a wildcard.
CREATE OR REPLACE FUNCTION public.can_view_class_exam_slots(_user_id uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.classes c
       WHERE c.id = _class_id
         AND COALESCE(c.is_active, true)
         AND (
           public.has_role(_user_id, 'super_admin')
           OR EXISTS (
             SELECT 1
             FROM public.user_roles ur
             WHERE ur.user_id = _user_id
               AND ur.role IN ('school_admin', 'super_school_admin')
               AND ur.institution_id = c.institution_id
           )
           OR (
             c.institution_id = public.get_user_institution(_user_id)
             AND (
               (public.has_role(_user_id, 'coordinator') AND public.is_coordinator_for_class(_user_id, c.id))
               OR (public.has_role(_user_id, 'teacher') AND public.is_teacher_for_class(_user_id, c.id))
             )
           )
         )
     )
$$;

-- 4. The booked set -----------------------------------------------------------------

-- Every exam holding a slot on any of _class_ids that overlaps [_from, _to).
-- Driven from idx_exam_classes_class, then exams_pkey (exams has no start_time
-- index; callers bound the class list). Shared by the guard and the RPC so the
-- two can never disagree about what is booked. A link to another school's
-- section never books it (and so never shows up, or leaks a name, there).
CREATE OR REPLACE FUNCTION public._exam_slot_bookings(
  _class_ids uuid[],
  _from timestamptz,
  _to timestamptz,
  _exclude_exam_id uuid
)
RETURNS TABLE (
  class_id uuid,
  exam_id uuid,
  starts_at timestamptz,
  occupied_until timestamptz,
  subject_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ec.class_id, e.id, e.start_time, occ.until, COALESCE(sub.ids, '{}'::uuid[])
  FROM public.exam_classes ec
  JOIN public.exams e ON e.id = ec.exam_id
  JOIN public.classes c ON c.id = ec.class_id AND c.institution_id = e.institution_id
  LEFT JOIN public.hybrid_exam_settings h ON h.exam_id = e.id
  CROSS JOIN LATERAL (
    SELECT public.exam_slot_occupied_until(
      e.start_time, e.end_time, e.late_entry_minutes, e.duration_minutes, e.exam_mode, h.grace_window_minutes
    ) AS until
  ) occ
  LEFT JOIN LATERAL (
    SELECT array_agg(es.subject_id ORDER BY es.subject_id) AS ids
    FROM public.exam_subjects es
    WHERE es.exam_id = e.id
  ) sub ON true
  WHERE ec.class_id = ANY (_class_ids)
    AND e.id IS DISTINCT FROM _exclude_exam_id
    AND e.status IN ('published', 'active', 'completed')
    AND e.exam_mode IN ('online', 'hybrid')
    AND e.start_time IS NOT NULL
    AND e.start_time < _to
    AND occ.until > _from
$$;

-- 5. The guard -------------------------------------------------------------------------

-- Raises when [_start, _until) overlaps a booked slot on any of _class_ids.
-- Windows that are already over are never checked, which is what keeps the
-- historical overlaps (and every ordinary edit of a past exam) untouched.
CREATE OR REPLACE FUNCTION public._exam_slot_assert_free(
  _exam_id uuid,
  _start timestamptz,
  _until timestamptz,
  _class_ids uuid[],
  _subject_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_class uuid;
  v_hit record;
  v_label text;
  v_tz text;
  v_what text;
BEGIN
  IF _start IS NULL OR _until IS NULL OR _until <= now()
     OR COALESCE(cardinality(_class_ids), 0) = 0 THEN
    RETURN;
  END IF;

  -- Serialise every writer that could book these sections. Sorted, so two
  -- multi-section publishes take their locks in the same order and cannot
  -- deadlock. Released at commit, after the commit is visible.
  FOR v_class IN SELECT DISTINCT x FROM unnest(_class_ids) AS x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('exam_slot:' || v_class::text, 0));
  END LOOP;

  -- A new statement in a VOLATILE function takes a fresh READ COMMITTED
  -- snapshot, so this sees a rival publish that committed while we waited.
  SELECT b.class_id, b.exam_id, b.starts_at, b.occupied_until
  INTO v_hit
  FROM public._exam_slot_bookings(_class_ids, _start, _until, _exam_id) b
  WHERE NOT public.exam_slot_subjects_are_alternatives(b.class_id, COALESCE(_subject_ids, '{}'::uuid[]), b.subject_ids)
  ORDER BY b.starts_at, b.class_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- exam_classes INSERT RLS lets any teacher of the school link any section of
  -- that school to a draft, so the message must not describe a section the
  -- caller has no authority over: details only for someone who may see it
  -- anyway. (Another school's section can never be linked at all:
  -- exam_classes_same_school below.)
  IF NOT public.can_view_class_exam_slots(auth.uid(), v_hit.class_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Time clash: one of the selected classes already has an exam at this time. Pick another time.',
      HINT = 'exam_slot_conflict';
  END IF;

  SELECT left(c.name || CASE WHEN COALESCE(c.section, '') <> '' THEN ' - ' || c.section ELSE '' END, 36),
         COALESCE(NULLIF(i.timezone, ''), 'Asia/Kolkata')
  INTO v_label, v_tz
  FROM public.classes c
  JOIN public.institutions i ON i.id = c.institution_id
  WHERE c.id = v_hit.class_id;

  SELECT CASE
           WHEN e.created_by IS NOT NULL AND e.created_by = auth.uid() THEN 'your exam'
           ELSE COALESCE(
             left((SELECT string_agg(us.name, ', ' ORDER BY us.name)
                   FROM public.exam_subjects es
                   JOIN public.universal_subjects us ON us.id = es.subject_id
                   WHERE es.exam_id = e.id), 36),
             'another exam')
         END
  INTO v_what
  FROM public.exams e
  WHERE e.id = v_hit.exam_id;

  -- At most ~150 characters and free of the words translateError treats as
  -- technical, so toastError shows it verbatim (src/lib/errorMessages.ts).
  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = format(
      'Time clash: %s already has %s from %s to %s on %s. Pick another time.',
      COALESCE(v_label, 'a selected class'),
      COALESCE(v_what, 'another exam'),
      to_char(v_hit.starts_at AT TIME ZONE v_tz, 'HH24:MI'),
      to_char(v_hit.occupied_until AT TIME ZONE v_tz, 'HH24:MI'),
      to_char(v_hit.starts_at AT TIME ZONE v_tz, 'FMDD Mon')
    ),
    HINT = 'exam_slot_conflict',
    DETAIL = json_build_object(
      'class_id', v_hit.class_id,
      'exam_id', v_hit.exam_id,
      'starts_at', v_hit.starts_at,
      'occupied_until', v_hit.occupied_until
    )::text;
END;
$$;

-- Re-check a live exam after one of its child rows changed.
CREATE OR REPLACE FUNCTION public._exam_slot_recheck(_exam_id uuid, _class_ids uuid[])
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam record;
  v_classes uuid[];
  v_subjects uuid[];
BEGIN
  -- FOR SHARE: a concurrent publish or reschedule of this exam holds its row
  -- (FOR NO KEY UPDATE), so this waits for it and then reads the committed
  -- status and times. Without it, a class link racing the publish read the
  -- exam as a draft and returned before any lock or check. OF x: the nullable
  -- side of an outer join cannot be locked.
  SELECT x.id, x.status, x.exam_mode, x.start_time, x.end_time,
         x.late_entry_minutes, x.duration_minutes, h.grace_window_minutes AS grace
  INTO v_exam
  FROM public.exams x
  LEFT JOIN public.hybrid_exam_settings h ON h.exam_id = x.id
  WHERE x.id = _exam_id
  FOR SHARE OF x;

  -- NOT FOUND covers a cascade from an exam being deleted.
  IF NOT FOUND OR NOT public._exam_slot_is_live(v_exam.status, v_exam.exam_mode, v_exam.start_time) THEN
    RETURN;
  END IF;

  v_classes := COALESCE(
    _class_ids,
    (SELECT array_agg(DISTINCT ec.class_id) FROM public.exam_classes ec WHERE ec.exam_id = _exam_id)
  );
  IF v_classes IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(es.subject_id) INTO v_subjects
  FROM public.exam_subjects es
  WHERE es.exam_id = _exam_id;

  PERFORM public._exam_slot_assert_free(
    _exam_id,
    v_exam.start_time,
    public.exam_slot_occupied_until(
      v_exam.start_time, v_exam.end_time, v_exam.late_entry_minutes,
      v_exam.duration_minutes, v_exam.exam_mode, v_exam.grace),
    v_classes,
    v_subjects
  );
END;
$$;

-- exams: the publish flip (useSaveExam writes it LAST, after every child row,
-- so the sections and subjects are already there), a reschedule of a live exam,
-- or a direct INSERT as published (RLS does not stop one).
CREATE OR REPLACE FUNCTION public.tg_exams_slot_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grace integer;
  v_classes uuid[];
  v_subjects uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A user-delete cascade (created_by/published_by SET NULL) is not an edit
    -- (CLAUDE.md §21). It never changes the window, so this is belt and braces.
    IF public.is_user_delete_cascade_update(TG_RELID, to_jsonb(OLD), to_jsonb(NEW)) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- A live online/hybrid exam with no start time is sittable (the student view
  -- then gates on end_time or the date) yet books nothing, so it may neither go
  -- live without one nor lose it while live. The 8 legacy live rows that
  -- already have none are left as they are: only a transition raises.
  IF NEW.status IN ('published', 'active') AND NEW.exam_mode IN ('online', 'hybrid')
     AND NEW.start_time IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Pick a start time before publishing this exam.';
    END IF;
    IF NOT (OLD.status IN ('published', 'active') AND OLD.exam_mode IN ('online', 'hybrid')
            AND OLD.start_time IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Pick a start time before publishing this exam.';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public._exam_slot_is_live(NEW.status, NEW.exam_mode, NEW.start_time) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Already holding exactly this slot: nothing to check. useSaveExam and
    -- useUpdateExam SET every schedule column on every save, so compare values.
    IF public._exam_slot_is_live(OLD.status, OLD.exam_mode, OLD.start_time)
       AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
       AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time
       AND NEW.late_entry_minutes IS NOT DISTINCT FROM OLD.late_entry_minutes
       AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes
       AND NEW.exam_mode IS NOT DISTINCT FROM OLD.exam_mode THEN
      RETURN NEW;
    END IF;
  END IF;

  -- No sections yet (a direct INSERT): the exam_classes trigger checks each
  -- section as it is linked.
  SELECT array_agg(DISTINCT ec.class_id) INTO v_classes
  FROM public.exam_classes ec
  WHERE ec.exam_id = NEW.id;
  IF v_classes IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT h.grace_window_minutes INTO v_grace
  FROM public.hybrid_exam_settings h
  WHERE h.exam_id = NEW.id;

  SELECT array_agg(es.subject_id) INTO v_subjects
  FROM public.exam_subjects es
  WHERE es.exam_id = NEW.id;

  PERFORM public._exam_slot_assert_free(
    NEW.id,
    NEW.start_time,
    public.exam_slot_occupied_until(
      NEW.start_time, NEW.end_time, NEW.late_entry_minutes, NEW.duration_minutes, NEW.exam_mode, v_grace),
    v_classes,
    v_subjects
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exams_slot_guard ON public.exams;
CREATE TRIGGER exams_slot_guard
  BEFORE INSERT OR UPDATE OF status, start_time, end_time, late_entry_minutes, duration_minutes, exam_mode
  ON public.exams
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_exams_slot_guard();

-- exam_classes, same school only, drafts included. The INSERT policy
-- "Teachers can manage exam classes" passes on is_exam_creator alone and never
-- compares institutions, so a teacher could link another school's section to
-- their own exam: with the guard below that became a way to read that school's
-- timetable (clash / no clash) and to book its section. Refused unconditionally,
-- before anything looks at the other school's bookings. 0 such rows in prod.
CREATE OR REPLACE FUNCTION public.tg_exam_classes_same_school()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.classes c
    JOIN public.exams e ON e.id = NEW.exam_id
    WHERE c.id = NEW.class_id
      AND c.institution_id IS DISTINCT FROM e.institution_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This class belongs to another school.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exam_classes_same_school ON public.exam_classes;
CREATE TRIGGER exam_classes_same_school
  BEFORE INSERT OR UPDATE OF class_id, exam_id
  ON public.exam_classes
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_exam_classes_same_school();

-- exam_classes: a section added to an exam that is already live. AFTER, not
-- BEFORE: an upsert with ON CONFLICT DO NOTHING fires BEFORE INSERT even for the
-- rows it then skips, and AFTER fires only for rows really written. It re-checks
-- the exam's WHOLE section set (an AFTER ROW trigger sees every row the
-- statement wrote), so the advisory locks are always taken in one sorted order;
-- locking only the new row's section, row by row in payload order, could
-- deadlock against a publish locking the same sections sorted.
CREATE OR REPLACE FUNCTION public.tg_exam_classes_slot_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.class_id IS NOT DISTINCT FROM OLD.class_id
     AND NEW.exam_id IS NOT DISTINCT FROM OLD.exam_id THEN
    RETURN NULL;
  END IF;
  PERFORM public._exam_slot_recheck(NEW.exam_id, NULL);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS exam_classes_slot_guard ON public.exam_classes;
CREATE TRIGGER exam_classes_slot_guard
  AFTER INSERT OR UPDATE OF class_id, exam_id
  ON public.exam_classes
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_exam_classes_slot_guard();

-- exam_subjects: the subject set decides the optional-group exemption, so any
-- change that can end one on a live exam is re-checked:
--   * INSERT or UPDATE (a new subject, a subject swapped, a row moved in);
--   * a DIRECT delete of an exam's LAST subject (a subset of one group stays
--     inside it and stays disjoint, so only the last one going matters; an exam
--     with no subjects is shown to every student of the section).
-- A delete arriving by cascade (a subject or the exam itself being deleted) is
-- never checked: a clash raised there would block an unrelated admin delete.
-- The cascade is recognised by its parent being gone already: the subject row
-- (checked here) or the exam row (_exam_slot_recheck finds nothing).
-- pg_trigger_depth() does NOT tell them apart: the dry run showed an FK
-- cascade's AFTER trigger firing at depth 1, exactly like a direct delete.
CREATE OR REPLACE FUNCTION public.tg_exam_subjects_slot_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.universal_subjects us WHERE us.id = OLD.subject_id) THEN
      RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.exam_subjects es WHERE es.exam_id = OLD.exam_id) THEN
      PERFORM public._exam_slot_recheck(OLD.exam_id, NULL);
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.subject_id IS NOT DISTINCT FROM OLD.subject_id
       AND NEW.exam_id IS NOT DISTINCT FROM OLD.exam_id THEN
      RETURN NULL;
    END IF;
    -- A row moved out may have been the old exam's last subject.
    IF NEW.exam_id IS DISTINCT FROM OLD.exam_id
       AND NOT EXISTS (SELECT 1 FROM public.exam_subjects es WHERE es.exam_id = OLD.exam_id) THEN
      PERFORM public._exam_slot_recheck(OLD.exam_id, NULL);
    END IF;
  END IF;

  PERFORM public._exam_slot_recheck(NEW.exam_id, NULL);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS exam_subjects_slot_guard ON public.exam_subjects;
CREATE TRIGGER exam_subjects_slot_guard
  AFTER INSERT OR UPDATE OF subject_id, exam_id OR DELETE
  ON public.exam_subjects
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_exam_subjects_slot_guard();

-- hybrid_exam_settings: a longer upload window on a live hybrid exam holds its
-- students longer. A row moved onto another exam (UPDATE exam_id) brings its
-- window with it, so that is always re-checked; the "not longer" shortcut only
-- holds for the same exam.
CREATE OR REPLACE FUNCTION public.tg_hybrid_settings_slot_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.exam_id IS NOT DISTINCT FROM OLD.exam_id
     AND NEW.grace_window_minutes <= OLD.grace_window_minutes THEN
    RETURN NULL;
  END IF;
  PERFORM public._exam_slot_recheck(NEW.exam_id, NULL);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS hybrid_exam_settings_slot_guard ON public.hybrid_exam_settings;
CREATE TRIGGER hybrid_exam_settings_slot_guard
  AFTER INSERT OR UPDATE OF grace_window_minutes, exam_id
  ON public.hybrid_exam_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_hybrid_settings_slot_guard();

-- 6. The read path ----------------------------------------------------------------------

-- Booked times for the sections an exam is being scheduled into, for the
-- Schedule & publish sheet. Returns
--   { classes:  [{ class_id, name, section, authorized }],
--     bookings: [{ class_id, exam_id, is_own, title, subject_names, teacher_name,
--                  exam_mode, status, starts_at, entry_deadline, occupied_until,
--                  runs_alongside }] }
-- Sections the caller has no authority over come back authorized=false with no
-- bookings, so the sheet can say "not checked here" instead of implying free.
-- A title is returned only for the caller's own exams. _subject_ids are the
-- subjects of the exam being scheduled; runs_alongside marks bookings in the same
-- optional group, which do not clash with it.
CREATE OR REPLACE FUNCTION public.get_exam_slot_bookings(
  _class_ids uuid[],
  _from timestamptz,
  _to timestamptz,
  _exclude_exam_id uuid DEFAULT NULL,
  _subject_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_allowed uuid[];
  v_institution uuid;
  v_super boolean;
  v_classes jsonb;
  v_bookings jsonb;
BEGIN
  -- Fail closed: NULL <> x is NULL, and IF NULL skips a block.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in again to see booked exam times.';
  END IF;

  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(_class_ids, '{}'::uuid[])) AS x WHERE x IS NOT NULL);
  IF cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('classes', '[]'::jsonb, 'bookings', '[]'::jsonb);
  END IF;
  IF cardinality(v_ids) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Pick at most 50 classes to check booked exam times.';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to <= _from OR _to - _from > interval '45 days' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Pick a range of up to 45 days to check booked exam times.';
  END IF;

  v_allowed := ARRAY(SELECT x FROM unnest(v_ids) AS x WHERE public.can_view_class_exam_slots(v_uid, x));
  v_institution := public.get_user_institution(v_uid);
  v_super := public.has_role(v_uid, 'super_admin');

  -- Labels only for sections of the caller's own school (or ones they may see),
  -- so a stray id from another school reveals nothing.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'class_id', c.id,
           'name', c.name,
           'section', c.section,
           'authorized', c.id = ANY (v_allowed)
         ) ORDER BY c.name, c.section), '[]'::jsonb)
  INTO v_classes
  FROM public.classes c
  WHERE c.id = ANY (v_ids)
    AND (c.id = ANY (v_allowed) OR v_super OR c.institution_id = v_institution);

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.starts_at, t.class_id), '[]'::jsonb)
  INTO v_bookings
  FROM (
    SELECT
      b.class_id,
      b.exam_id,
      (e.created_by IS NOT NULL AND e.created_by = v_uid) AS is_own,
      CASE WHEN e.created_by = v_uid THEN e.title END AS title,
      (SELECT string_agg(us.name, ', ' ORDER BY us.name)
       FROM public.exam_subjects es
       JOIN public.universal_subjects us ON us.id = es.subject_id
       WHERE es.exam_id = e.id) AS subject_names,
      CASE WHEN e.created_by = v_uid THEN NULL ELSE p.full_name END AS teacher_name,
      e.exam_mode::text AS exam_mode,
      e.status::text AS status,
      b.starts_at,
      CASE
        WHEN COALESCE(e.late_entry_minutes, 0) > 0
          THEN e.start_time + make_interval(mins => e.late_entry_minutes)
        ELSE e.end_time
      END AS entry_deadline,
      b.occupied_until,
      public.exam_slot_subjects_are_alternatives(
        b.class_id, COALESCE(_subject_ids, '{}'::uuid[]), b.subject_ids) AS runs_alongside
    FROM public._exam_slot_bookings(v_allowed, _from, _to, _exclude_exam_id) b
    JOIN public.exams e ON e.id = b.exam_id
    LEFT JOIN public.profiles p ON p.id = e.created_by
    ORDER BY b.starts_at, b.class_id
    LIMIT 500
  ) t;

  RETURN jsonb_build_object('classes', v_classes, 'bookings', v_bookings);
END;
$$;

COMMENT ON FUNCTION public.get_exam_slot_bookings(uuid[], timestamptz, timestamptz, uuid, uuid[]) IS
  'Booked exam times for sections the caller may see (can_view_class_exam_slots). The only read path for the Schedule & publish sheet: RLS on exams is school-wide. See 20260928170000.';

-- 7. Grants ---------------------------------------------------------------------------------
-- Supabase default privileges grant EXECUTE to anon on every new function, and
-- REVOKE FROM PUBLIC does not strip it (CLAUDE.md §26). Only the RPC is a client
-- surface; everything else is called by the DEFINER functions above.

REVOKE ALL ON FUNCTION public.exam_slot_occupied_until(timestamptz, timestamptz, integer, integer, public.exam_mode, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exam_slot_occupied_until(timestamptz, timestamptz, integer, integer, public.exam_mode, integer) FROM anon;
REVOKE ALL ON FUNCTION public.exam_slot_occupied_until(timestamptz, timestamptz, integer, integer, public.exam_mode, integer) FROM authenticated;

REVOKE ALL ON FUNCTION public._exam_slot_is_live(public.exam_status, public.exam_mode, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._exam_slot_is_live(public.exam_status, public.exam_mode, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public._exam_slot_is_live(public.exam_status, public.exam_mode, timestamptz) FROM authenticated;

REVOKE ALL ON FUNCTION public.exam_slot_subjects_are_alternatives(uuid, uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exam_slot_subjects_are_alternatives(uuid, uuid[], uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.exam_slot_subjects_are_alternatives(uuid, uuid[], uuid[]) FROM authenticated;

REVOKE ALL ON FUNCTION public.can_view_class_exam_slots(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_class_exam_slots(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.can_view_class_exam_slots(uuid, uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public._exam_slot_bookings(uuid[], timestamptz, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._exam_slot_bookings(uuid[], timestamptz, timestamptz, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._exam_slot_bookings(uuid[], timestamptz, timestamptz, uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public._exam_slot_assert_free(uuid, timestamptz, timestamptz, uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._exam_slot_assert_free(uuid, timestamptz, timestamptz, uuid[], uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public._exam_slot_assert_free(uuid, timestamptz, timestamptz, uuid[], uuid[]) FROM authenticated;

REVOKE ALL ON FUNCTION public._exam_slot_recheck(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._exam_slot_recheck(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public._exam_slot_recheck(uuid, uuid[]) FROM authenticated;

-- Trigger functions cannot be called as RPCs, and the trigger machinery does not
-- check EXECUTE when it fires them; revoked for hygiene.
REVOKE ALL ON FUNCTION public.tg_exams_slot_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_exams_slot_guard() FROM anon;
REVOKE ALL ON FUNCTION public.tg_exams_slot_guard() FROM authenticated;
REVOKE ALL ON FUNCTION public.tg_exam_classes_same_school() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_exam_classes_same_school() FROM anon;
REVOKE ALL ON FUNCTION public.tg_exam_classes_same_school() FROM authenticated;
REVOKE ALL ON FUNCTION public.tg_exam_classes_slot_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_exam_classes_slot_guard() FROM anon;
REVOKE ALL ON FUNCTION public.tg_exam_classes_slot_guard() FROM authenticated;
REVOKE ALL ON FUNCTION public.tg_exam_subjects_slot_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_exam_subjects_slot_guard() FROM anon;
REVOKE ALL ON FUNCTION public.tg_exam_subjects_slot_guard() FROM authenticated;
REVOKE ALL ON FUNCTION public.tg_hybrid_settings_slot_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_hybrid_settings_slot_guard() FROM anon;
REVOKE ALL ON FUNCTION public.tg_hybrid_settings_slot_guard() FROM authenticated;

REVOKE ALL ON FUNCTION public.get_exam_slot_bookings(uuid[], timestamptz, timestamptz, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_exam_slot_bookings(uuid[], timestamptz, timestamptz, uuid, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_exam_slot_bookings(uuid[], timestamptz, timestamptz, uuid, uuid[]) TO authenticated, service_role;
