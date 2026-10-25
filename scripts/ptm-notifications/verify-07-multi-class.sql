-- Task 7: multi-class PTM + retired booking notification.
-- Structural assertions first (read-only, RAISE NOTICE + a trailing SELECT
-- since RAISE NOTICE is not part of what the SQL runner returns), then a
-- behavioural block that writes real rows and rolls itself back via the
-- terminating RAISE EXCEPTION trick used by the earlier PTM verify scripts.

-- ── 1. ptm_schedule_classes: table, UNIQUE, index, RLS ──────────────────
DO $$
BEGIN
  IF to_regclass('public.ptm_schedule_classes') IS NULL THEN
    RAISE EXCEPTION 'FAIL: table ptm_schedule_classes is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ptm_schedule_classes_uniq' AND contype = 'u') THEN
    RAISE EXCEPTION 'FAIL: the (ptm_id, class_id) UNIQUE is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND tablename = 'ptm_schedule_classes'
                    AND indexdef ILIKE '%(class_id)%') THEN
    RAISE EXCEPTION 'FAIL: idx_ptm_schedule_classes_class is missing (CLAUDE.md 23: every new FK gets an index)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'ptm_schedule_classes'
                    AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'FAIL: RLS is not enabled on ptm_schedule_classes';
  END IF;
  RAISE NOTICE 'PASS: ptm_schedule_classes structurally sound';
END $$;

SELECT 'PASS: ptm_schedule_classes structurally sound' AS result;

-- ── 2. New functions: exist, SECURITY DEFINER, pinned search_path, ──────
--       not executable by anon or PUBLIC.
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(t.fn, ', ') INTO v_missing
    FROM (VALUES ('ptm_includes_user_class'),
                 ('ptm_class_rows_readable'),
                 ('create_ptm_schedule')) AS t(fn)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = t.fn
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: missing function(s): %', v_missing;
  END IF;

  SELECT string_agg(t.fn, ', ') INTO v_missing
    FROM (VALUES ('ptm_includes_user_class'),
                 ('ptm_class_rows_readable'),
                 ('create_ptm_schedule')) AS t(fn)
   WHERE EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = t.fn
        AND (NOT p.prosecdef
             OR coalesce(array_to_string(p.proconfig, ','), '') NOT ILIKE '%search_path%')
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: not SECURITY DEFINER with a pinned search_path: %', v_missing;
  END IF;

  SELECT string_agg(t.fn, ', ') INTO v_missing
    FROM (VALUES ('ptm_includes_user_class'),
                 ('ptm_class_rows_readable'),
                 ('create_ptm_schedule')) AS t(fn)
   WHERE EXISTS (
     SELECT 1 FROM information_schema.routine_privileges
      WHERE routine_schema = 'public' AND routine_name = t.fn
        AND grantee IN ('anon', 'PUBLIC')
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: still executable by anon/PUBLIC: %', v_missing;
  END IF;

  RAISE NOTICE 'PASS: new PTM functions present, SECURITY DEFINER, locked down';
END $$;

SELECT 'PASS: new PTM functions present, SECURITY DEFINER, locked down' AS result;

-- ── 3. Booking notification retired, teacher_id nullable ───────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
              WHERE tg.tgname = 'tg_ptm_notify_booking' AND c.relname = 'ptm_bookings'
                AND NOT tg.tgisinternal) THEN
    RAISE EXCEPTION 'FAIL: tg_ptm_notify_booking still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'tg_ptm_notify_booking') THEN
    RAISE EXCEPTION 'FAIL: tg_ptm_notify_booking() function still exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ptm_bookings'
                    AND column_name = 'teacher_id' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'FAIL: ptm_bookings.teacher_id is still NOT NULL';
  END IF;
  RAISE NOTICE 'PASS: booking notification retired, teacher_id nullable';
END $$;

SELECT 'PASS: booking notification retired, teacher_id nullable' AS result;

-- ── 4. tg_ptm_notify_scheduled is a deferred constraint trigger ─────────
DO $$
DECLARE v_deferrable boolean; v_initdeferred boolean;
BEGIN
  SELECT tg.tgdeferrable, tg.tginitdeferred INTO v_deferrable, v_initdeferred
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
   WHERE tg.tgname = 'tg_ptm_notify_scheduled' AND c.relname = 'ptm_schedules'
     AND NOT tg.tgisinternal;
  IF v_deferrable IS NULL THEN
    RAISE EXCEPTION 'FAIL: tg_ptm_notify_scheduled is missing';
  END IF;
  IF NOT v_deferrable OR NOT v_initdeferred THEN
    RAISE EXCEPTION 'FAIL: tg_ptm_notify_scheduled is not DEFERRABLE INITIALLY DEFERRED (deferrable=%, initdeferred=%)',
      v_deferrable, v_initdeferred;
  END IF;
  -- tg_ptm_notify_changed must stay a normal (non-deferred) trigger.
  IF EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
              WHERE tg.tgname = 'tg_ptm_notify_changed' AND c.relname = 'ptm_schedules'
                AND tg.tgdeferrable) THEN
    RAISE EXCEPTION 'FAIL: tg_ptm_notify_changed must not be deferrable';
  END IF;
  RAISE NOTICE 'PASS: tg_ptm_notify_scheduled is a deferred constraint trigger';
END $$;

SELECT 'PASS: tg_ptm_notify_scheduled is a deferred constraint trigger' AS result;

-- ── 5+6. Behavioural: the deferred trigger sees the junction rows ───────
-- Runs as a real school admin (request.jwt.claims + SET LOCAL ROLE, the
-- pattern already used across scripts/notice-board and
-- scripts/test-student-leave.sql), writes two real PTMs, forces the
-- deferred trigger to fire NOW (SET CONSTRAINTS ALL IMMEDIATE) instead of
-- waiting for a COMMIT that never happens, asserts, then rolls everything
-- back via the terminating RAISE EXCEPTION.
DO $$
DECLARE
  v_inst           uuid;
  v_admin          uuid;
  v_two_classes    uuid[];
  v_class1         uuid;
  v_class2         uuid;
  v_ptm_two        uuid;
  v_ptm_school     uuid;
  v_two_actual     int;
  v_two_expected   int;
  v_school_actual  int;
  v_school_expected int;
  v_student_in     uuid;
  v_student_out    uuid;
  v_visible_in     boolean;
  v_visible_out    boolean;
BEGIN
  -- Demo institution with a real roster, largest first. An empty one makes
  -- the test prove nothing (same guard as verify-03-timezone.sql).
  SELECT i.id INTO v_inst
    FROM public.institutions i
   WHERE i.is_demo = true
     AND (SELECT count(*) FROM public.institution_student_ids(i.id)) > 0
   ORDER BY (SELECT count(*) FROM public.institution_student_ids(i.id)) DESC
   LIMIT 1;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'SETUP: no demo institution with a roster found';
  END IF;

  SELECT ur.user_id INTO v_admin
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role IN ('school_admin', 'super_school_admin')
     AND p.institution_id = v_inst
   LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'SETUP: no school admin found in the chosen institution';
  END IF;

  -- Two real classes with students, so the class-scoped audience is
  -- non-empty and provably a proper subset of the whole school.
  SELECT array_agg(sub.class_id) INTO v_two_classes
    FROM (
      SELECT ca.class_id, count(*) AS n
        FROM public.class_assignments ca
        JOIN public.classes c ON c.id = ca.class_id
       WHERE c.institution_id = v_inst AND ca.role = 'student'
       GROUP BY ca.class_id
       ORDER BY n DESC
       LIMIT 2
    ) sub;
  IF v_two_classes IS NULL OR array_length(v_two_classes, 1) < 2 THEN
    RAISE EXCEPTION 'SETUP: chosen institution does not have two classes with students';
  END IF;
  v_class1 := v_two_classes[1];
  v_class2 := v_two_classes[2];

  -- ── Act as the admin for both writes ──────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_ptm_two := public.create_ptm_schedule(
    v_inst, 'ZZ TEST TWO-CLASS PTM', NULL, current_date + 7,
    '10:00', '13:00', 15, v_two_classes);

  v_ptm_school := public.create_ptm_schedule(
    v_inst, 'ZZ TEST SCHOOL-WIDE PTM', NULL, current_date + 7,
    '10:00', '13:00', 15, NULL);

  RESET ROLE;

  -- Force the deferred constraint trigger to run NOW, inside this same
  -- transaction, instead of waiting for a COMMIT that never happens (the
  -- whole test rolls back at the end). Without this, both PTMs above would
  -- have their notification queued for commit time and every count below
  -- would read zero.
  SET CONSTRAINTS ALL IMMEDIATE;

  -- ── 5. Two-class PTM notifies exactly that audience, and strictly
  --       fewer people than the whole school. If the trigger had fired
  --       before the junction rows existed (the bug this migration fixes),
  --       it would have treated the PTM as all-classes and this count
  --       would be EQUAL to the school-wide one, not less.
  SELECT count(*) INTO v_two_expected
    FROM public.ptm_audience(v_ptm_two) a WHERE a.user_id IS DISTINCT FROM v_admin;
  SELECT count(*) INTO v_two_actual
    FROM public.notifications WHERE metadata->>'ptm_id' = v_ptm_two::text;
  IF v_two_actual <> v_two_expected THEN
    RAISE EXCEPTION 'FAIL: two-class PTM notified % but its current audience is %',
      v_two_actual, v_two_expected;
  END IF;
  IF v_two_actual = 0 THEN
    RAISE EXCEPTION 'FAIL: two-class PTM notified nobody, the test proves nothing';
  END IF;

  -- ── 6. A NULL _class_ids PTM still reaches the full school-wide
  --       audience (unchanged behaviour).
  SELECT count(*) INTO v_school_expected
    FROM public.ptm_audience(v_ptm_school) a WHERE a.user_id IS DISTINCT FROM v_admin;
  SELECT count(*) INTO v_school_actual
    FROM public.notifications WHERE metadata->>'ptm_id' = v_ptm_school::text;
  IF v_school_actual <> v_school_expected THEN
    RAISE EXCEPTION 'FAIL: school-wide PTM notified % but its audience is %',
      v_school_actual, v_school_expected;
  END IF;
  IF v_school_actual = 0 THEN
    RAISE EXCEPTION 'FAIL: school-wide PTM notified nobody';
  END IF;

  -- The core assertion: two classes must be a strict subset of the school.
  IF v_two_actual >= v_school_actual THEN
    RAISE EXCEPTION 'FAIL: two-class audience (%) is not smaller than the school-wide audience (%) - the deferred trigger may have fired before the junction rows were written',
      v_two_actual, v_school_actual;
  END IF;

  -- ── Bonus: ptm_select actually narrows visibility for a student ──────
  -- A student assigned to one of the two classes must see the two-class
  -- PTM; a student in the same school but neither class must not.
  SELECT ca.user_id INTO v_student_in
    FROM public.class_assignments ca
   WHERE ca.class_id IN (v_class1, v_class2) AND ca.role = 'student'
   LIMIT 1;
  SELECT ur.user_id INTO v_student_out
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role = 'student' AND p.institution_id = v_inst
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments ca
                      WHERE ca.user_id = ur.user_id AND ca.class_id IN (v_class1, v_class2))
   LIMIT 1;

  IF v_student_in IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_student_in, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT EXISTS (SELECT 1 FROM public.ptm_schedules WHERE id = v_ptm_two) INTO v_visible_in;
    RESET ROLE;
    IF NOT v_visible_in THEN
      RAISE EXCEPTION 'FAIL: a student assigned to one of the two classes cannot see the PTM';
    END IF;
  END IF;

  IF v_student_out IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_student_out, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT EXISTS (SELECT 1 FROM public.ptm_schedules WHERE id = v_ptm_two) INTO v_visible_out;
    RESET ROLE;
    IF v_visible_out THEN
      RAISE EXCEPTION 'FAIL: a student outside both classes can see a class-scoped PTM';
    END IF;
  END IF;

  RAISE EXCEPTION 'PASS-ROLLBACK: two-class audience=% school-wide audience=% (rolling back)',
    v_two_actual, v_school_actual;
END $$;
