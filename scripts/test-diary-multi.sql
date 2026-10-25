-- diary_write_entries acceptance suite (migration 20261001120000). Runs as a real
-- teacher, admin and students against real prod rows under RLS, then rolls
-- everything back. Assertions RECORD instead of raising.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-diary-multi.sql -OutFile "$env:TEMP\diary.json"
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

DO $test$
DECLARE
  v_inst uuid; v_teacher uuid; v_class uuid; v_admin uuid; v_out uuid;
  v_s uuid[]; v_ids uuid[]; v_ids2 uuid[]; v_ret uuid[];
  v_n int; v_m int; v_txt text; v_t0 timestamptz; v_ms numeric;
  v_big uuid[]; v_big_ids uuid[];
BEGIN
  -- ── cast: an Alliance subject teacher with 3+ students they may write for ──
  SELECT i.id INTO v_inst FROM public.institutions i WHERE i.name = 'Alliance International School';
  SELECT ca.user_id, ca.class_id INTO v_teacher, v_class
    FROM public.class_assignments ca
    JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
    JOIN public.profiles p ON p.id = ca.user_id AND p.is_active IS NOT FALSE AND p.institution_id = v_inst
   WHERE ca.role = 'teacher' AND ca.subject_id IS NOT NULL
     AND public.has_role(ca.user_id, 'teacher')
     AND NOT public.is_institution_admin(ca.user_id, v_inst)
     AND NOT public.has_role(ca.user_id, 'coordinator')
     AND (SELECT count(*) FROM public.class_assignments s
           WHERE s.class_id = ca.class_id AND s.role = 'student'
             AND public.diary_can_write_for(ca.class_id, s.user_id, ca.user_id)) >= 3
   ORDER BY ca.user_id, ca.class_id LIMIT 1;
  SELECT array_agg(x.user_id ORDER BY x.user_id) INTO v_s FROM (
    SELECT s.user_id FROM public.class_assignments s
     WHERE s.class_id = v_class AND s.role = 'student'
       AND public.diary_can_write_for(v_class, s.user_id, v_teacher)
     ORDER BY s.user_id LIMIT 3) x;
  SELECT s.user_id INTO v_out FROM public.class_assignments s
    JOIN public.classes c ON c.id = s.class_id AND c.institution_id = v_inst
   WHERE s.role = 'student' AND s.class_id <> v_class
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments x WHERE x.user_id = s.user_id AND x.class_id = v_class)
   ORDER BY s.user_id LIMIT 1;
  SELECT p.id INTO v_admin FROM public.profiles p
   WHERE p.institution_id = v_inst AND public.is_institution_admin(p.id, v_inst) AND NOT public.is_super_admin(p.id)
   ORDER BY p.id LIMIT 1;
  v_ids := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  PERFORM pg_temp.chk(v_teacher IS NOT NULL AND array_length(v_s, 1) = 3 AND v_out IS NOT NULL AND v_admin IS NOT NULL,
    'cast found (subject teacher, 3 students, an outsider, admin)', format('teacher=%s class=%s', v_teacher, v_class));

  -- ── grants ──
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.diary_write_entries(uuid[],uuid,uuid[],text,text,text,date)', 'EXECUTE'),
    'anon cannot call diary_write_entries');
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.diary_write_entries(uuid[],uuid,uuid[],text,text,text,date)', 'EXECUTE'),
    'signed-in users can call diary_write_entries');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.notice_class_students(uuid[])', 'EXECUTE')
                  AND has_function_privilege('authenticated', 'public.notice_class_students(uuid[])', 'EXECUTE'),
    'notice_class_students: anon off, signed-in on');

  -- ── the happy path ──
  PERFORM pg_temp.as_user(v_teacher);
  v_t0 := clock_timestamp();
  v_ret := public.diary_write_entries(v_ids, v_class, v_s, 'homework', '  Suite multi  ', 'Read chapter 3', (now() AT TIME ZONE 'Asia/Kolkata')::date + 2);
  PERFORM pg_temp.as_owner();
  SELECT count(*), count(DISTINCT d.student_id) INTO v_n, v_m FROM public.diary_entries d
   WHERE d.id = ANY(v_ids) AND d.class_id = v_class AND d.created_by = v_teacher AND d.kind = 'homework'
     AND d.title = 'Suite multi' AND d.student_id = v_s[array_position(v_ids, d.id)];
  PERFORM pg_temp.chk(v_ret = v_ids AND v_n = 3 AND v_m = 3, 'three students get one copy each, in input order', format('%s rows, %s students', v_n, v_m));
  SELECT count(*) INTO v_n FROM public.notifications nt
   WHERE nt.type = 'diary_homework' AND (nt.metadata->>'entry_id')::uuid = ANY(v_ids);
  SELECT count(*) INTO v_m FROM public.notifications nt
   WHERE nt.type = 'diary_homework' AND (nt.metadata->>'entry_id')::uuid = ANY(v_ids)
     AND nt.user_id = v_s[array_position(v_ids, (nt.metadata->>'entry_id')::uuid)];
  PERFORM pg_temp.chk(v_n = 3 AND v_m = 3, 'each student gets exactly one bell row, for their own copy', format('%s rows, %s matched', v_n, v_m));

  -- ── idempotent retry ──
  PERFORM pg_temp.as_user(v_teacher);
  PERFORM public.diary_write_entries(v_ids, v_class, v_s, 'homework', 'Suite multi', 'Read chapter 3', NULL);
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.diary_entries WHERE id = ANY(v_ids);
  SELECT count(*) INTO v_m FROM public.notifications nt WHERE (nt.metadata->>'entry_id')::uuid = ANY(v_ids);
  PERFORM pg_temp.chk(v_n = 3 AND v_m = 3, 'a retry with the same ids writes and notifies nothing twice', format('%s rows, %s bells', v_n, v_m));

  -- ── each student reads only their own copy ──
  PERFORM pg_temp.as_user(v_s[1]);
  SELECT count(*), max(student_id::text) INTO v_n, v_txt FROM public.diary_entries WHERE id = ANY(v_ids);
  PERFORM pg_temp.chk(v_n = 1 AND v_txt = v_s[1]::text, 'a student sees their own copy, not the others''', format('%s visible', v_n));

  -- ── all or nothing, and the refusal names who ──
  v_ids2 := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  PERFORM pg_temp.as_user(v_teacher);
  BEGIN
    PERFORM public.diary_write_entries(v_ids2, v_class, ARRAY[v_s[1], v_s[2], v_out], 'note', 'Suite refused', 'x', NULL);
    v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM;
  END;
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.diary_entries WHERE id = ANY(v_ids2);
  PERFORM pg_temp.chk(v_n = 0, 'one refused student means nobody gets it', format('%s rows', v_n));
  PERFORM pg_temp.chk(v_txt LIKE 'You can''t write for 1 of these students: %'
                      AND v_txt LIKE '%' || coalesce(nullif(btrim((SELECT full_name FROM public.profiles WHERE id = v_out)), ''), 'a student') || '%'
                      AND length(v_txt) <= 160,
    'the refusal names the student and fits a toast', v_txt);

  -- ── validation ──
  PERFORM pg_temp.as_user(v_teacher);
  BEGIN PERFORM public.diary_write_entries(ARRAY[]::uuid[], v_class, ARRAY[]::uuid[], 'note', 't', 'b', NULL); v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Choose at least one student.', 'no students is refused', v_txt);
  BEGIN PERFORM public.diary_write_entries(ARRAY[gen_random_uuid()], v_class, v_s[1:2], 'note', 't', 'b', NULL); v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE 'Each student needs its own entry%', 'ids and students of different length are refused', v_txt);
  BEGIN PERFORM public.diary_write_entries(ARRAY[gen_random_uuid(), gen_random_uuid()], v_class, ARRAY[v_s[1], v_s[1]], 'note', 't', 'b', NULL); v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE 'A student is listed twice%', 'a repeated student is refused', v_txt);
  v_txt := gen_random_uuid()::text;
  BEGIN PERFORM public.diary_write_entries(ARRAY[v_txt::uuid, v_txt::uuid], v_class, v_s[1:2], 'note', 't', 'b', NULL); v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE 'Each student needs its own entry%', 'a repeated entry id is refused', v_txt);
  SELECT array_agg(gen_random_uuid()), array_agg(gen_random_uuid()) INTO v_big, v_big_ids FROM generate_series(1, 201);
  BEGIN PERFORM public.diary_write_entries(v_big_ids, v_class, v_big, 'note', 't', 'b', NULL); v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE 'Choose 200 students or fewer%', 'more than 200 students is refused', v_txt);
  BEGIN PERFORM public.diary_write_entries(ARRAY[gen_random_uuid(), gen_random_uuid()], v_class, v_s[1:2], 'note', '', 'b', NULL); v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'The entry needs a title.', 'content rules of the single write still apply', v_txt);
  BEGIN PERFORM public.diary_write_entries(ARRAY[gen_random_uuid(), gen_random_uuid()], v_class, v_s[1:2], 'note', 't', 'b', current_date); v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Only homework entries take a due date.', 'a due date only on homework', v_txt);

  -- ── who may call it ──
  PERFORM pg_temp.as_user(v_s[1]);
  BEGIN PERFORM public.diary_write_entries(ARRAY[gen_random_uuid(), gen_random_uuid()], v_class, v_s[2:3], 'note', 't', 'b', NULL); v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE 'You can''t write for 2 of these students%', 'a student cannot write for classmates', v_txt);
  PERFORM pg_temp.as_owner();
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.diary_write_entries(ARRAY[gen_random_uuid(), gen_random_uuid()], v_class, v_s[1:2], 'note', 't', 'b', NULL); v_txt := 'written';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(v_txt = 'You must be signed in.', 'no user, no write', v_txt);
  PERFORM pg_temp.as_user(v_admin);
  v_ids2 := ARRAY[gen_random_uuid(), gen_random_uuid()];
  PERFORM public.diary_write_entries(v_ids2, v_class, v_s[1:2], 'appreciation', 'Suite admin', 'Well done', NULL);
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.diary_entries WHERE id = ANY(v_ids2);
  PERFORM pg_temp.chk(v_n = 2, 'a school admin writes for several students', format('%s rows', v_n));

  -- ── a whole class at once, timed (well inside the 8 s statement timeout) ──
  SELECT array_agg(s.user_id ORDER BY s.user_id), array_agg(gen_random_uuid()) INTO v_big, v_big_ids
    FROM (SELECT DISTINCT s.user_id FROM public.class_assignments s
           WHERE s.class_id = v_class AND s.role = 'student'
             AND public.diary_can_write_for(v_class, s.user_id, v_teacher)) s;
  PERFORM pg_temp.as_user(v_teacher);
  v_t0 := clock_timestamp();
  PERFORM public.diary_write_entries(v_big_ids, v_class, v_big, 'reminder', 'Suite all', 'Bring the form', NULL);
  v_ms := round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.diary_entries WHERE id = ANY(v_big_ids);
  PERFORM pg_temp.chk(v_n = array_length(v_big, 1) AND v_ms < 3000,
    'every student of the class in one call, under 3 s', format('%s students, %s ms', v_n, v_ms));
END
$test$;

SELECT json_agg(json_build_object('n', n, 'r', result, 'label', label, 'detail', detail) ORDER BY n) AS result
FROM t_out;

ROLLBACK;
