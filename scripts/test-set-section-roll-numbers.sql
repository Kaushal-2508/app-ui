-- Acceptance suite for set_section_roll_numbers (20261007160000), including
-- the Update Roll Number sheet's Auto assign (case 11).
-- Runs as a real Alliance admin and student against Class 9 A under
-- authenticated, then rolls everything back. Assertions RECORD, never raise.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-set-section-roll-numbers.sql -OutFile "$env:TEMP\roll.json"
BEGIN;

CREATE TEMP TABLE t_out(n serial, result text, label text, detail text);
GRANT ALL ON t_out TO PUBLIC;
GRANT USAGE ON SEQUENCE t_out_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.chk(p_pass boolean, p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $chk$
BEGIN
  INSERT INTO t_out(result, label, detail)
  VALUES (CASE WHEN coalesce(p_pass, false) THEN 'PASS' ELSE 'FAIL' END, p_label, p_detail);
END $chk$;

CREATE FUNCTION pg_temp.as_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $as$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $as$;

CREATE FUNCTION pg_temp.as_owner()
RETURNS void LANGUAGE plpgsql AS $ow$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
END $ow$;

-- Roll number of one student, read as the owner.
CREATE FUNCTION pg_temp.roll(p_id uuid)
RETURNS text LANGUAGE sql AS $r$ SELECT roll_number FROM public.profiles WHERE id = p_id $r$;

DO $test$
DECLARE
  v_inst uuid; v_class uuid; v_other_class uuid; v_admin uuid; v_student uuid;
  v_ek1 uuid; v_ek2 uuid; v_falak uuid; v_gk1 uuid; v_gk2 uuid; v_hark uuid;
  v_outsider uuid; v_free text;
  v_n int; v_audit_before int; v_audit_after int; v_state text; v_msg text;
BEGIN
  SELECT c.id, c.institution_id INTO v_class, v_inst
  FROM public.classes c
  JOIN public.class_groups g ON g.id = c.class_group_id
  JOIN public.institutions i ON i.id = c.institution_id
  WHERE i.name ILIKE 'Alliance International%' AND g.name = 'Class 9' AND c.section = 'A' AND c.is_active
  LIMIT 1;

  SELECT ur.user_id INTO v_admin
  FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'school_admin' AND p.institution_id = v_inst AND p.is_active
  LIMIT 1;

  -- The six students of the 2026-10-07 report, found by name (a repeated
  -- name is ordered by id), never by their current numbers, which change.
  SELECT p.id INTO v_ek1 FROM public.class_assignments ca JOIN public.profiles p ON p.id = ca.user_id
   WHERE ca.class_id = v_class AND ca.role = 'student' AND p.full_name = 'EKAMJOT KAUR' ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_ek2 FROM public.class_assignments ca JOIN public.profiles p ON p.id = ca.user_id
   WHERE ca.class_id = v_class AND ca.role = 'student' AND p.full_name = 'EKAMJOT KAUR' ORDER BY p.id OFFSET 1 LIMIT 1;
  SELECT p.id INTO v_falak FROM public.class_assignments ca JOIN public.profiles p ON p.id = ca.user_id
   WHERE ca.class_id = v_class AND ca.role = 'student' AND p.full_name = 'FALAK' ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_gk1 FROM public.class_assignments ca JOIN public.profiles p ON p.id = ca.user_id
   WHERE ca.class_id = v_class AND ca.role = 'student' AND p.full_name = 'GURNOOR KAUR' ORDER BY p.id LIMIT 1;
  SELECT p.id INTO v_gk2 FROM public.class_assignments ca JOIN public.profiles p ON p.id = ca.user_id
   WHERE ca.class_id = v_class AND ca.role = 'student' AND p.full_name = 'GURNOOR KAUR' ORDER BY p.id OFFSET 1 LIMIT 1;
  SELECT p.id INTO v_hark FROM public.class_assignments ca JOIN public.profiles p ON p.id = ca.user_id
   WHERE ca.class_id = v_class AND ca.role = 'student' AND p.full_name = 'HARKIRAT KAUR' ORDER BY p.id LIMIT 1;
  v_student := v_ek1;

  -- Deterministic start (rolled back with everything else): park every
  -- classmate on 101+, then put the six on the reported chain 5,6,7,8,9 + 11.
  UPDATE public.profiles p SET roll_number = (100 + x.rn)::text
  FROM (SELECT ca.user_id, row_number() OVER (ORDER BY ca.user_id) AS rn
        FROM public.class_assignments ca
        WHERE ca.class_id = v_class AND ca.role = 'student') x
  WHERE p.id = x.user_id;
  UPDATE public.profiles SET roll_number = '5'  WHERE id = v_ek1;
  UPDATE public.profiles SET roll_number = '6'  WHERE id = v_ek2;
  UPDATE public.profiles SET roll_number = '7'  WHERE id = v_falak;
  UPDATE public.profiles SET roll_number = '8'  WHERE id = v_gk1;
  UPDATE public.profiles SET roll_number = '9'  WHERE id = v_gk2;
  UPDATE public.profiles SET roll_number = '11' WHERE id = v_hark;

  -- A student of the same school in a different section.
  SELECT ca.user_id, ca.class_id INTO v_outsider, v_other_class
  FROM public.class_assignments ca JOIN public.classes c ON c.id = ca.class_id
  WHERE c.institution_id = v_inst AND ca.class_id <> v_class AND ca.role = 'student'
  LIMIT 1;

  PERFORM pg_temp.chk(v_class IS NOT NULL AND v_admin IS NOT NULL
    AND v_ek1 IS NOT NULL AND v_ek2 IS NOT NULL AND v_falak IS NOT NULL
    AND v_gk1 IS NOT NULL AND v_gk2 IS NOT NULL AND v_hark IS NOT NULL,
    '0 fixtures: section, admin and the six students found',
    format('class=%s admin=%s', v_class, v_admin));

  -- 1. The exact shift that failed: 5,6,7,8,9 -> 6,7,8,9,10 (10 is free).
  SELECT count(*) INTO v_audit_before FROM public.system_audit_logs
   WHERE metadata->>'source' = 'set_section_roll_numbers';
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    v_n := public.set_section_roll_numbers(v_class, jsonb_build_array(
      jsonb_build_object('student_id', v_ek1,   'roll_number', '6'),
      jsonb_build_object('student_id', v_ek2,   'roll_number', '7'),
      jsonb_build_object('student_id', v_falak, 'roll_number', '8'),
      jsonb_build_object('student_id', v_gk1,   'roll_number', '9'),
      jsonb_build_object('student_id', v_gk2,   'roll_number', '10')));
    v_msg := NULL;
  EXCEPTION WHEN OTHERS THEN v_n := -1; v_msg := SQLERRM;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_n = 5, '1a shift of five saves in one call', coalesce(v_msg, 'returned ' || v_n));
  PERFORM pg_temp.chk(pg_temp.roll(v_ek1) = '6' AND pg_temp.roll(v_ek2) = '7' AND pg_temp.roll(v_falak) = '8'
    AND pg_temp.roll(v_gk1) = '9' AND pg_temp.roll(v_gk2) = '10',
    '1b every student holds the new number',
    concat_ws(',', pg_temp.roll(v_ek1), pg_temp.roll(v_ek2), pg_temp.roll(v_falak), pg_temp.roll(v_gk1), pg_temp.roll(v_gk2)));
  SELECT count(*) INTO v_audit_after FROM public.system_audit_logs
   WHERE metadata->>'source' = 'set_section_roll_numbers';
  PERFORM pg_temp.chk(v_audit_after - v_audit_before = 5, '1c five audit rows written',
    (v_audit_after - v_audit_before)::text);
  PERFORM pg_temp.chk(EXISTS (
      SELECT 1 FROM public.system_audit_logs
      WHERE entity_id = v_gk2 AND actor_id = v_admin AND action = 'student_details_updated'
        AND old_values->>'roll_number' = '9' AND new_values->>'roll_number' = '10'),
    '1d audit row carries actor, before and after');

  -- 2. A straight swap (6 <-> 7).
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    v_n := public.set_section_roll_numbers(v_class, jsonb_build_array(
      jsonb_build_object('student_id', v_ek1, 'roll_number', '7'),
      jsonb_build_object('student_id', v_ek2, 'roll_number', '6')));
    v_msg := NULL;
  EXCEPTION WHEN OTHERS THEN v_n := -1; v_msg := SQLERRM;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_n = 2 AND pg_temp.roll(v_ek1) = '7' AND pg_temp.roll(v_ek2) = '6',
    '2 a swap saves', coalesce(v_msg, 'returned ' || v_n));

  -- 3. A real clash with an untouched classmate is refused and changes nothing.
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    v_n := public.set_section_roll_numbers(v_class, jsonb_build_array(
      jsonb_build_object('student_id', v_falak, 'roll_number', '99'),
      jsonb_build_object('student_id', v_gk1,   'roll_number', pg_temp.roll(v_hark))));
    v_state := NULL;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_state = '23505' AND v_msg LIKE '%HARKIRAT KAUR%',
    '3a clash refused with 23505 naming the holder', coalesce(v_msg, 'no error'));
  PERFORM pg_temp.chk(pg_temp.roll(v_falak) = '8' AND pg_temp.roll(v_gk1) = '9',
    '3b refused save is all or nothing (the clean row was not written either)');

  -- 4. Two changed students given the same number are refused.
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    v_n := public.set_section_roll_numbers(v_class, jsonb_build_array(
      jsonb_build_object('student_id', v_falak, 'roll_number', '98'),
      jsonb_build_object('student_id', v_gk1,   'roll_number', '98')));
    v_state := NULL;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_state = '23505', '4 two new duplicates in one save are refused', coalesce(v_state, 'no error'));

  -- 5. Blank clears the number.
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    v_n := public.set_section_roll_numbers(v_class, jsonb_build_array(
      jsonb_build_object('student_id', v_falak, 'roll_number', '  ')));
    v_msg := NULL;
  EXCEPTION WHEN OTHERS THEN v_n := -1; v_msg := SQLERRM;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_n = 1 AND pg_temp.roll(v_falak) IS NULL, '5 blank clears the number',
    coalesce(v_msg, 'returned ' || v_n));

  -- 6. A student from another section is refused.
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    v_n := public.set_section_roll_numbers(v_class, jsonb_build_array(
      jsonb_build_object('student_id', v_outsider, 'roll_number', '97')));
    v_state := NULL;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_state = '22023' AND v_msg LIKE '%no longer in this section%',
    '6 a student outside the section is refused', coalesce(v_msg, 'no error'));

  -- 7. A student account has no authority.
  PERFORM pg_temp.as_user(v_student);
  BEGIN
    v_n := public.set_section_roll_numbers(v_class, jsonb_build_array(
      jsonb_build_object('student_id', v_ek2, 'roll_number', '96')));
    v_state := NULL;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_state = '42501', '7 a student caller is refused', coalesce(v_state, 'no error'));

  -- 8. No signed-in caller fails closed.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    v_n := public.set_section_roll_numbers(v_class, jsonb_build_array(
      jsonb_build_object('student_id', v_ek2, 'roll_number', '96')));
    v_state := NULL;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_state = '42501', '8 a NULL caller is refused', coalesce(v_state, 'no error'));

  -- 9. Unchanged numbers are not rewritten or audited.
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    v_n := public.set_section_roll_numbers(v_class, jsonb_build_array(
      jsonb_build_object('student_id', v_gk2, 'roll_number', '10')));
    v_msg := NULL;
  EXCEPTION WHEN OTHERS THEN v_n := -1; v_msg := SQLERRM;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_n = 0, '9 an unchanged number writes nothing', coalesce(v_msg, 'returned ' || v_n));

  -- 11. Auto assign: the whole section renumbered 1..N by name in one call,
  -- whatever numbers (and duplicates) it held before.
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    SELECT public.set_section_roll_numbers(v_class, jsonb_agg(
             jsonb_build_object('student_id', x.id, 'roll_number', x.rn::text) ORDER BY x.rn))
    INTO v_n
    FROM (
      SELECT p.id, row_number() OVER (ORDER BY lower(p.full_name), p.roll_number, p.id) AS rn
      FROM public.class_assignments ca JOIN public.profiles p ON p.id = ca.user_id
      WHERE ca.class_id = v_class AND ca.role = 'student'
    ) x;
    v_msg := NULL;
  EXCEPTION WHEN OTHERS THEN v_n := -1; v_msg := SQLERRM;
  END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_n >= 0 AND NOT EXISTS (
      SELECT 1 FROM public.class_assignments ca JOIN public.profiles p ON p.id = ca.user_id
      WHERE ca.class_id = v_class AND ca.role = 'student'
      GROUP BY p.roll_number HAVING count(*) > 1),
    '11 whole-section alphabetical renumbering saves with no duplicates left',
    coalesce(v_msg, 'changed ' || v_n));
END
$test$;

-- 10. Grants: anon cannot execute; authenticated can.
INSERT INTO t_out(result, label, detail)
SELECT CASE WHEN NOT has_function_privilege('anon', 'public.set_section_roll_numbers(uuid, jsonb)', 'EXECUTE')
             AND has_function_privilege('authenticated', 'public.set_section_roll_numbers(uuid, jsonb)', 'EXECUTE')
            THEN 'PASS' ELSE 'FAIL' END,
       '10 anon has no EXECUTE, authenticated does',
       (SELECT proacl::text FROM pg_proc WHERE oid = 'public.set_section_roll_numbers(uuid, jsonb)'::regprocedure);

SELECT result, label, detail FROM t_out ORDER BY n;

ROLLBACK;
