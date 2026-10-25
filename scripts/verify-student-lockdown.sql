-- Proves the student profile lockdown is safe BEFORE it is applied for real.
--
-- The danger the plan names: once "Users can update own profile" excludes
-- students, a student mid forced-password-reset can no longer clear
-- must_reset_password, so the reset screen loops forever. A browser click
-- through tests one path once; this tests the mechanism under REAL RLS by
-- assuming the `authenticated` role with a forged JWT claim, which is the only
-- way a policy is actually exercised from SQL.
--
-- Applies the policy, asserts, and ROLLS BACK. Leaves nothing behind.
-- Run via scripts/run-sql.ps1. Results come back as a table because the
-- Management API discards RAISE NOTICE/WARNING.
BEGIN;

CREATE TEMP TABLE _lock_results(seq int, label text, status text) ON COMMIT DROP;

DO $suite$
DECLARE
  v_inst    uuid := gen_random_uuid();
  v_stu     uuid := gen_random_uuid();
  v_teach   uuid := gen_random_uuid();
  v_emp     uuid := gen_random_uuid();
  v_rows    int;
  v_flag    boolean;
  v_onb     boolean;
  v_name    text;
  v_fails   int := 0;
  -- captured results, written to the temp table only after RESET ROLE
  r1 text; r2 text; r3 text; r4 text; r5 text; r6 text; r7 text;
BEGIN
  -- ---------- fixtures (as superuser) ----------
  -- profiles.id FKs auth.users and handle_new_user pre-creates the profiles
  -- row, so seed auth.users then UPDATE profiles. Never bare-INSERT profiles.
  INSERT INTO public.institutions (id, name, code)
  VALUES (v_inst, 'ZZ Lockdown Inst', 'ZZLOCK');

  INSERT INTO auth.users (id, email) VALUES
    (v_stu,   'zz.lock.stu@test.invalid'),
    (v_teach, 'zz.lock.teach@test.invalid'),
    (v_emp,   'zz.lock.emp@test.invalid');

  UPDATE public.profiles SET institution_id = v_inst, full_name = 'ZZ Student',
         must_reset_password = true, onboarding_completed = false
   WHERE id = v_stu;
  UPDATE public.profiles SET institution_id = v_inst, full_name = 'ZZ Teacher',
         must_reset_password = true
   WHERE id = v_teach;
  UPDATE public.profiles SET institution_id = v_inst, full_name = 'ZZ Employee',
         must_reset_password = true
   WHERE id = v_emp;

  INSERT INTO public.user_roles (user_id, role, institution_id) VALUES
    (v_stu,   'student',  v_inst),
    (v_teach, 'teacher',  v_inst),
    (v_emp,   'employee', v_inst);

  -- ---------- apply the policy under test ----------
  DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
  CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    id = (SELECT auth.uid())
    AND NOT public.has_role((SELECT auth.uid()), 'student')
  )
  WITH CHECK (
    id = (SELECT auth.uid())
    AND NOT public.has_role((SELECT auth.uid()), 'student')
  );

  -- ---------- become a real RLS-subject caller ----------
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 1. STUDENT direct self-edit must be blocked. RLS USING failure affects
  --    zero rows and raises nothing, which is exactly why the form had to be
  --    hidden rather than left to error.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stu::text, 'role', 'authenticated')::text, true);
  UPDATE public.profiles SET full_name = 'HACKED' WHERE id = v_stu;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  r1 := CASE WHEN v_rows = 0 THEN 'ok' ELSE 'FAIL rows=' || v_rows END;

  -- 2. THE CRITICAL ONE: a student mid forced-reset must still be able to
  --    clear the flag through the RPC, or they are locked out of the product.
  PERFORM public.clear_password_reset_flag();
  SELECT must_reset_password INTO v_flag FROM public.profiles WHERE id = v_stu;
  r2 := CASE WHEN v_flag IS FALSE THEN 'ok'
             ELSE 'FAIL must_reset_password=' || coalesce(v_flag::text,'null') END;

  -- 3. The guided-tour write must also survive, or the tour replays forever.
  PERFORM public.mark_onboarding_complete(NULL);
  SELECT onboarding_completed INTO v_onb FROM public.profiles WHERE id = v_stu;
  r3 := CASE WHEN v_onb IS TRUE THEN 'ok'
             ELSE 'FAIL onboarding_completed=' || coalesce(v_onb::text,'null') END;

  -- 4. REGRESSION GUARD: a TEACHER must keep self-edit. This is why the policy
  --    is replaced rather than dropped, since no other policy covers staff.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_teach::text, 'role', 'authenticated')::text, true);
  UPDATE public.profiles SET full_name = 'ZZ Teacher Renamed' WHERE id = v_teach;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  SELECT full_name INTO v_name FROM public.profiles WHERE id = v_teach;
  r4 := CASE WHEN v_rows = 1 AND v_name = 'ZZ Teacher Renamed' THEN 'ok'
             ELSE 'FAIL rows=' || v_rows || ' name=' || coalesce(v_name,'null') END;

  -- 5. A teacher's forced reset must still work too.
  PERFORM public.clear_password_reset_flag();
  SELECT must_reset_password INTO v_flag FROM public.profiles WHERE id = v_teach;
  r5 := CASE WHEN v_flag IS FALSE THEN 'ok'
             ELSE 'FAIL must_reset_password=' || coalesce(v_flag::text,'null') END;

  -- 6. EMPLOYEE keeps self-edit as well (the other role with no fallback policy).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_emp::text, 'role', 'authenticated')::text, true);
  UPDATE public.profiles SET full_name = 'ZZ Employee Renamed' WHERE id = v_emp;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  r6 := CASE WHEN v_rows = 1 THEN 'ok' ELSE 'FAIL rows=' || v_rows END;

  -- 7. A student must not be able to edit ANOTHER user either (unchanged, but
  --    cheap to pin so a future policy edit cannot quietly widen it).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stu::text, 'role', 'authenticated')::text, true);
  UPDATE public.profiles SET full_name = 'HACKED2' WHERE id = v_teach;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  r7 := CASE WHEN v_rows = 0 THEN 'ok' ELSE 'FAIL rows=' || v_rows END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  EXECUTE 'RESET ROLE';

  -- ---------- report (back as superuser) ----------
  INSERT INTO _lock_results VALUES
    (1, 'student direct self-edit is BLOCKED',                r1),
    (2, 'student CAN clear forced-reset via RPC (loop test)', r2),
    (3, 'student CAN mark onboarding complete via RPC',       r3),
    (4, 'teacher KEEPS direct self-edit',                     r4),
    (5, 'teacher CAN clear forced-reset via RPC',             r5),
    (6, 'employee KEEPS direct self-edit',                    r6),
    (7, 'student cannot edit another user',                   r7);

  SELECT count(*) INTO v_fails FROM _lock_results WHERE status <> 'ok';
  INSERT INTO _lock_results VALUES
    (99, 'SUMMARY', CASE WHEN v_fails = 0
                         THEN 'ALL LOCKDOWN ASSERTIONS PASSED'
                         ELSE v_fails || ' ASSERTION(S) FAILED' END);

  -- Fail loud: a suite that returns HTTP 201 while red reads as success.
  IF v_fails > 0 THEN
    RAISE EXCEPTION '% lockdown assertion(s) FAILED', v_fails;
  END IF;
END $suite$;

SELECT seq, label, status FROM _lock_results ORDER BY seq;

ROLLBACK;
