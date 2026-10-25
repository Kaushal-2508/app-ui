-- Admissions acceptance suite (migration 20261012120000). Runs as a real admin,
-- teacher and student of Product Testing School under RLS, then rolls everything
-- back. Assertions RECORD instead of raising.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/test-admissions.sql -OutFile "$env:TEMP\admissions.json"
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
  v_inst uuid; v_admin uuid; v_t1 uuid; v_t2 uuid; v_stu uuid; v_class uuid; v_group uuid; v_other_inst uuid; v_other_admin uuid;
  v_other_group uuid; v_js jsonb; v_n int; v_m int; v_txt text; v_state text; v_hint text;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_ref text; v_ref2 text; v_path text; v_new uuid; v_new2 uuid; v_num text;
  v_code text; v_year text; v_foreign_num text;
BEGIN
  -- ── 0. cast ──────────────────────────────────────────────────────────────
  SELECT i.id, i.code INTO v_inst, v_code FROM public.institutions i WHERE i.name = 'Product Testing School';
  SELECT p.id INTO v_admin FROM public.profiles p
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE AND public.is_institution_admin(p.id, v_inst) LIMIT 1;
  SELECT p.id INTO v_t1 FROM public.profiles p
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE AND public.has_role(p.id, 'teacher')
     AND NOT public.is_institution_admin(p.id, v_inst) AND NOT public.has_role(p.id, 'coordinator')
     AND NOT public.has_role(p.id, 'student')
   ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO v_t2 FROM public.profiles p
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE AND public.has_role(p.id, 'teacher')
     AND NOT public.is_institution_admin(p.id, v_inst) AND NOT public.has_role(p.id, 'coordinator')
     AND NOT public.has_role(p.id, 'student') AND p.id <> v_t1
   ORDER BY p.created_at LIMIT 1;
  SELECT p.id INTO v_stu FROM public.profiles p
   WHERE p.institution_id = v_inst AND p.is_active IS NOT FALSE AND public.has_role(p.id, 'student') LIMIT 1;
  SELECT c.id, c.class_group_id INTO v_class, v_group FROM public.classes c
   JOIN public.class_groups g ON g.id = c.class_group_id AND g.is_active
   WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE ORDER BY c.created_at LIMIT 1;
  SELECT i.id INTO v_other_inst FROM public.institutions i
   WHERE i.id <> v_inst AND NOT i.is_system AND EXISTS (SELECT 1 FROM public.class_groups g WHERE g.institution_id = i.id)
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.institution_id = i.id AND public.is_institution_admin(p.id, i.id))
   ORDER BY i.created_at LIMIT 1;
  SELECT p.id INTO v_other_admin FROM public.profiles p
   WHERE p.institution_id = v_other_inst AND public.is_institution_admin(p.id, v_other_inst) LIMIT 1;
  SELECT g.id INTO v_other_group FROM public.class_groups g WHERE g.institution_id = v_other_inst LIMIT 1;
  SELECT p.admission_number INTO v_foreign_num FROM public.profiles p
   WHERE p.institution_id <> v_inst AND coalesce(p.admission_number, '') <> '' LIMIT 1;
  v_year := '2031-32';
  PERFORM pg_temp.chk(v_inst IS NOT NULL AND v_admin IS NOT NULL AND v_t1 IS NOT NULL AND v_t2 IS NOT NULL
                      AND v_stu IS NOT NULL AND v_class IS NOT NULL AND v_other_admin IS NOT NULL
                      AND v_other_group IS NOT NULL AND v_foreign_num IS NOT NULL,
    'cast: school, admin, two teachers, a student, a class, another school', format('%s %s %s %s %s %s', v_inst, v_admin, v_t1, v_stu, v_class, v_other_admin));

  -- ── 1. who may work it ───────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_t1);
  BEGIN PERFORM public.admission_get_settings(v_inst); v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'a teacher who is not named is refused', v_state);
  PERFORM pg_temp.chk(public.is_admissions_staff(v_t1) = false, 'is_admissions_staff: false for an unnamed teacher');
  BEGIN PERFORM 1 FROM public.admission_settings LIMIT 0; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = 'ok', 'the frontend probe reads the table without an error', v_state);
  SELECT count(*) INTO v_m FROM public.classes c WHERE c.institution_id = v_inst;
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.classes c WHERE c.institution_id = v_inst;
  PERFORM pg_temp.chk(v_m < v_n, 'before being named, the teacher sees only their own sections', format('%s of %s', v_m, v_n));
  PERFORM pg_temp.as_user(v_admin);
  v_js := public.admission_get_settings(v_inst);
  PERFORM pg_temp.chk((v_js->>'registration_fee_rupees')::int = 1000 AND jsonb_array_length(v_js->'document_checklist') = 9
                      AND v_js->>'admission_number_prefix' IS NULL AND (v_js->>'next_admission_seq')::int = 1
                      AND (v_js->>'enquiry_form_enabled')::boolean AND v_js->'form_schema' = '[]'::jsonb,
    'first read makes the defaults: Rs 1000, nine certificates, no prefix', left(v_js::text, 200));
  v_js := public.admission_staff_options(v_inst);
  PERFORM pg_temp.chk(v_js @> jsonb_build_array(jsonb_build_object('user_id', v_t1))
                      AND NOT v_js @> jsonb_build_array(jsonb_build_object('user_id', v_stu))
                      AND NOT v_js @> jsonb_build_array(jsonb_build_object('user_id', v_admin)),
    'staff options: teachers yes, students and admins no', format('%s options', jsonb_array_length(v_js)));
  BEGIN PERFORM public.admission_set_staff(v_inst, ARRAY[v_t1, v_stu]); v_state := 'saved';
  EXCEPTION WHEN OTHERS THEN v_state := SQLERRM; END;
  PERFORM pg_temp.chk(v_state LIKE '1 of the people chosen are not staff%', 'naming a student as staff is refused', v_state);
  PERFORM public.admission_set_staff(v_inst, ARRAY[v_t1]);
  v_js := public.admission_list_staff(v_inst);
  PERFORM pg_temp.chk(jsonb_array_length(v_js) = 1 AND v_js->0->>'user_id' = v_t1::text AND v_js->0->>'role' = 'Teacher',
    'the named teacher is listed as staff', left(v_js::text, 200));
  PERFORM pg_temp.chk(public.is_admissions_staff(v_t1) = true, 'an admin may ask about a colleague');
  PERFORM pg_temp.as_user(v_t1);
  PERFORM pg_temp.chk(public.is_admissions_staff(v_t1) = true, 'is_admissions_staff: true once named');
  SELECT count(*) INTO v_m FROM public.classes c WHERE c.institution_id = v_inst;
  PERFORM pg_temp.chk(v_m = v_n, 'admissions staff see every section of the school', format('%s of %s', v_m, v_n));
  BEGIN PERFORM public.admission_set_settings(v_inst, '{"registration_fee_rupees": 1}'::jsonb); v_state := 'saved';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'staff may not change the settings', v_state);
  PERFORM pg_temp.as_user(v_stu);
  PERFORM pg_temp.chk(public.is_admissions_staff(v_t1) = false, 'a student asking about staff gets false');
  BEGIN PERFORM public.admission_set_staff(v_inst, ARRAY[v_stu]); v_state := 'saved';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'a student cannot name staff', v_state);
  PERFORM pg_temp.as_user(v_other_admin);
  BEGIN PERFORM public.admission_get_settings(v_inst); v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'another school''s admin is refused', v_state);

  -- ── 2. settings ──────────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_admin);
  BEGIN
    PERFORM public.admission_set_settings(v_inst, '{"form_schema": [{"id":"q1","label":"Transport","type":"choice","required":true,"options":["Bus"],"ask_at":["public"],"help":null}]}'::jsonb);
    v_hint := 'saved';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; END;
  PERFORM pg_temp.chk(v_hint = 'admission_form_schema_invalid' AND v_txt LIKE '"Transport": add at least two%',
    'a Pick one question with one option is refused, named', v_txt);
  BEGIN
    PERFORM public.admission_set_settings(v_inst, '{"document_checklist": [{"key":"tc","label":"TC"},{"key":"tc","label":"TC again"}]}'::jsonb);
    v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE '"TC again" is in the list twice.', 'a certificate key twice is refused', v_txt);
  v_js := public.admission_set_settings(v_inst, jsonb_build_object(
    'registration_fee_rupees', 1500, 'admission_number_prefix', 'ADTEST/', 'next_admission_seq', 7,
    'form_schema', jsonb_build_array(
      jsonb_build_object('id', 'q_bus', 'label', ' Needs the bus? ', 'type', 'yes_no', 'required', true, 'options', '[]'::jsonb, 'ask_at', jsonb_build_array('public', 'enquiry'), 'help', ''),
      jsonb_build_object('id', 'q_house', 'label', 'House', 'type', 'choice', 'required', false, 'options', jsonb_build_array('Red', ' Blue ', ''), 'ask_at', jsonb_build_array('admission'), 'help', 'Pick one'))));
  PERFORM pg_temp.chk((v_js->>'registration_fee_rupees')::int = 1500 AND v_js->>'admission_number_prefix' = 'ADTEST/'
                      AND (v_js->>'next_admission_seq')::int = 7
                      AND v_js->'form_schema'->0->>'label' = 'Needs the bus?'
                      AND v_js->'form_schema'->0->'ask_at' = '["enquiry", "public"]'::jsonb
                      AND v_js->'form_schema'->0->'help' = 'null'::jsonb
                      AND v_js->'form_schema'->1->'options' = '["Red", "Blue"]'::jsonb,
    'settings saved and normalised: trimmed, blank options dropped, ask_at in order', left(v_js::text, 300));

  -- ── 3. enquiries ─────────────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_t1);
  BEGIN PERFORM public.admission_create_enquiry(v_inst, jsonb_build_object('student_name', 'Suite Child', 'parent_name', 'Suite Parent',
    'parent_phone', '12345', 'applying_for_label', 'Class 5', 'academic_year_label', v_year)); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Enter the parent''s 10-digit mobile number.', 'a short phone is refused', v_txt);
  BEGIN PERFORM public.admission_create_enquiry(v_inst, jsonb_build_object('student_name', 'Suite Child', 'parent_name', 'Suite Parent',
    'parent_phone', '9000000001', 'class_group_id', v_other_group, 'academic_year_label', v_year)); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'That class is not one of this school''s.', 'another school''s class is refused', v_txt);
  BEGIN PERFORM public.admission_create_enquiry(v_inst, jsonb_build_object('student_name', 'Suite Child', 'parent_name', 'Suite Parent',
    'parent_phone', '9000000001', 'applying_for_label', 'Class 5', 'academic_year_label', v_year, 'source', 'public_form')); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Choose how the parent reached the school.', 'the desk cannot claim the online form', v_txt);
  v_js := public.admission_create_enquiry(v_inst, jsonb_build_object(
    'student_name', 'Suite Child', 'parent_name', 'Suite Parent', 'parent_phone', '90000 00001', 'parent_email', 'Parent@Example.com',
    'class_group_id', v_group, 'applying_for_label', NULL, 'academic_year_label', v_year, 'source', 'phone',
    'date_of_birth', '2020-05-04', 'gender', 'female', 'message', E'Line one\nLine two',
    'form', jsonb_build_object('custom', jsonb_build_object('q_bus', 'yes'), 'junk', 'x')));
  v_e1 := (v_js->>'id')::uuid; v_ref := v_js->>'reference_no';
  PERFORM pg_temp.chk(v_e1 IS NOT NULL AND v_ref ~ '^ENQ-\d{4}-\d{4}$', 'an enquiry is saved with a reference', v_ref);
  v_js := public.admission_create_enquiry(v_inst, jsonb_build_object(
    'student_name', 'suite child', 'parent_name', 'Suite Parent', 'parent_phone', '9000000001',
    'applying_for_label', 'Class 5', 'academic_year_label', v_year));
  PERFORM pg_temp.chk((v_js->>'id')::uuid = v_e1, 'a double tap returns the same enquiry');
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.admission_enquiries WHERE institution_id = v_inst AND academic_year_label = v_year;
  PERFORM pg_temp.chk(v_n = 1, 'one row after the double tap', format('%s', v_n));
  PERFORM pg_temp.chk((SELECT parent_phone = '9000000001' AND parent_email = 'parent@example.com' AND form = '{"custom": {"q_bus": "yes"}}'::jsonb
                              AND message = E'Line one\nLine two'
                              AND applying_for_label = (SELECT g.name FROM public.class_groups g WHERE g.id = v_group)
                         FROM public.admission_enquiries WHERE id = v_e1),
    'stored: phone digits, email lower-case, unknown form keys dropped, line breaks kept, class from the group');
  PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.admission_notes WHERE enquiry_id = v_e1 AND kind = 'stage' AND body = 'Enquiry received.'),
    'the timeline starts with "Enquiry received."');
  PERFORM pg_temp.as_user(v_t1);
  v_js := public.admission_create_enquiry(v_inst, jsonb_build_object(
    'student_name', 'Suite Sibling', 'parent_name', 'Suite Parent', 'parent_phone', '9000000001',
    'applying_for_label', 'Class 2', 'academic_year_label', v_year, 'source', 'walk_in'));
  v_e2 := (v_js->>'id')::uuid;
  v_js := public.admission_create_enquiry(v_inst, jsonb_build_object(
    'student_name', 'Suite Third', 'parent_name', 'Other Parent', 'parent_phone', '9000000003',
    'applying_for_label', 'Class 3', 'academic_year_label', v_year));
  v_e3 := (v_js->>'id')::uuid;
  -- One transaction gives every row the same now(); spread them as separate calls would.
  PERFORM pg_temp.as_owner();
  UPDATE public.admission_enquiries SET created_at = now() - interval '3 minutes' WHERE id = v_e1;
  UPDATE public.admission_enquiries SET created_at = now() - interval '2 minutes' WHERE id = v_e2;
  UPDATE public.admission_enquiries SET created_at = now() - interval '1 minute' WHERE id = v_e3;
  PERFORM pg_temp.as_user(v_t1);

  -- ── 4. reads ─────────────────────────────────────────────────────────────
  v_js := public.admission_pipeline(v_inst, NULL, NULL, v_year, NULL, 50, 0);
  PERFORM pg_temp.chk(jsonb_array_length(v_js) = 3 AND v_js->0->>'id' = v_e3::text,
    'pipeline: the year''s three, newest first', format('%s rows', jsonb_array_length(v_js)));
  v_js := public.admission_pipeline(v_inst, NULL, NULL, v_year, '00001', 50, 0);
  PERFORM pg_temp.chk(jsonb_array_length(v_js) = 2, 'search by phone digits finds both siblings', format('%s', jsonb_array_length(v_js)));
  v_js := public.admission_pipeline(v_inst, NULL, NULL, v_year, 'sibling', 50, 0);
  PERFORM pg_temp.chk(jsonb_array_length(v_js) = 1 AND v_js->0->'other_enquiries'->0->>'id' = v_e1::text,
    'search by name; the sibling row names the other enquiry from the same phone', left(v_js::text, 200));
  v_js := public.admission_pipeline(v_inst, NULL, NULL, v_year, '100%', 50, 0);
  PERFORM pg_temp.chk(jsonb_array_length(v_js) = 0, 'a % in the search is a literal, not a wildcard');
  v_js := public.admission_pipeline(v_inst, NULL, NULL, v_year, NULL, 2, 2);
  PERFORM pg_temp.chk(jsonb_array_length(v_js) = 1 AND v_js->0->>'id' = v_e1::text, 'pages: limit 2 offset 2 gives the last one');
  v_js := public.admission_stage_counts(v_inst, v_year);
  PERFORM pg_temp.chk(v_js = '{"enquiry": 3, "registered": 0, "admitted": 0, "dropped": 0}'::jsonb, 'stage counts for the year', v_js::text);
  v_js := public.admission_enquiry_detail(v_e1);
  PERFORM pg_temp.chk(v_js->>'reference_no' = v_ref AND jsonb_array_length(v_js->'notes') = 1 AND v_js->'documents' = '[]'::jsonb
                      AND v_js->'form'->'custom'->>'q_bus' = 'yes' AND v_js ? 'registration',
    'detail: the row, its notes, no documents before registration', left(v_js::text, 200));
  PERFORM pg_temp.as_user(v_other_admin);
  BEGIN PERFORM public.admission_enquiry_detail(v_e1); v_state := 'read';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'another school''s admin cannot open the enquiry', v_state);
  PERFORM pg_temp.as_user(v_stu);
  SELECT count(*) INTO v_n FROM public.admission_enquiries;
  PERFORM pg_temp.chk(v_n = 0, 'a student reads no enquiry row', format('%s', v_n));
  PERFORM pg_temp.as_user(v_t2);
  SELECT count(*) INTO v_n FROM public.admission_enquiries;
  PERFORM pg_temp.chk(v_n = 0, 'an unnamed teacher reads no enquiry row', format('%s', v_n));
  PERFORM pg_temp.as_user(v_t1);
  SELECT count(*) INTO v_n FROM public.admission_enquiries WHERE academic_year_label = v_year;
  PERFORM pg_temp.chk(v_n = 3, 'named staff read their school''s rows', format('%s', v_n));

  -- ── 5. edits ─────────────────────────────────────────────────────────────
  PERFORM public.admission_update_enquiry(v_e1, jsonb_build_object('next_follow_up_on', '2031-04-02', 'assigned_to', v_t1,
    'form', jsonb_build_object('father_name', 'Suite Father')));
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((SELECT next_follow_up_on = '2031-04-02' AND assigned_to = v_t1
                              AND form = '{"custom": {"q_bus": "yes"}, "father_name": "Suite Father"}'::jsonb
                         FROM public.admission_enquiries WHERE id = v_e1)
                      AND (SELECT count(*) FROM public.admission_notes WHERE enquiry_id = v_e1 AND kind = 'follow_up') = 2,
    'an edit merges the form at the top level and notes the follow-up and the handler');
  PERFORM pg_temp.as_user(v_t1);
  BEGIN PERFORM public.admission_update_enquiry(v_e1, jsonb_build_object('assigned_to', v_t2)); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'That person does not work on admissions.', 'only admissions staff can be the handler', v_txt);
  PERFORM public.admission_add_note(v_e1, 'Called back');
  PERFORM public.admission_add_note(v_e1, 'Called back');
  PERFORM pg_temp.as_owner();
  SELECT count(*) INTO v_n FROM public.admission_notes WHERE enquiry_id = v_e1 AND body = 'Called back';
  PERFORM pg_temp.chk(v_n = 1, 'a double-tapped note is posted once', format('%s', v_n));

  -- ── 6. registration and certificates ─────────────────────────────────────
  PERFORM pg_temp.as_user(v_t1);
  BEGIN PERFORM public.admission_set_documents(v_e1, '[{"doc_key":"photos","collected":true}]'::jsonb); v_hint := 'saved';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; END;
  PERFORM pg_temp.chk(v_hint = 'admission_wrong_stage' AND v_txt = 'Register this enquiry first.', 'certificates wait for registration', v_txt);
  PERFORM public.admission_register(v_e1, 1500, 'upi', ' R-77 ', ((now() AT TIME ZONE 'Asia/Kolkata')::date), NULL);
  BEGIN PERFORM public.admission_register(v_e1, 1500, 'upi', 'R-78', ((now() AT TIME ZONE 'Asia/Kolkata')::date), NULL); v_hint := 'saved';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; END;
  PERFORM pg_temp.chk(v_hint = 'admission_wrong_stage' AND v_txt = 'This enquiry is already registered.', 'a second registration is refused', v_txt);
  BEGIN PERFORM public.admission_register(v_e2, 1500, 'crypto', 'R-79', ((now() AT TIME ZONE 'Asia/Kolkata')::date), NULL); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Choose how the fee was paid.', 'an unknown payment mode is refused', v_txt);
  v_js := public.admission_enquiry_detail(v_e1);
  PERFORM pg_temp.chk(v_js->>'stage' = 'registered' AND v_js->'registration'->>'receipt_no' = 'R-77'
                      AND (v_js->'registration'->>'fee_rupees')::int = 1500
                      AND jsonb_array_length(v_js->'documents') = 9 AND v_js->'documents'->0->>'doc_key' = 'birth_certificate'
                      AND (v_js->>'documents_total')::int = 9 AND (v_js->>'documents_collected')::int = 0,
    'registered: the fee recorded, the nine certificates seeded in list order', left(v_js::text, 200));
  PERFORM public.admission_set_documents(v_e1, '[{"doc_key":"photos","collected":true},{"doc_key":"report_card","collected":true},{"doc_key":"nope","collected":true}]'::jsonb);
  v_js := public.admission_enquiry_detail(v_e1);
  PERFORM pg_temp.chk((v_js->>'documents_collected')::int = 2 AND (v_js->>'documents_total')::int = 9, 'ticks saved; an unknown key ignored');

  -- scans
  v_path := v_inst::text || '/' || v_e1::text || '/photos.jpg';
  BEGIN PERFORM public.admission_set_document_file(v_e1, 'photos', v_path, 'photo.jpg', 2048); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'The upload did not finish. Try again.', 'recording a file that is not in storage is refused', v_txt);
  BEGIN PERFORM public.admission_set_document_file(v_e1, 'photos', v_other_inst::text || '/' || v_e1::text || '/photos.jpg', 'photo.jpg', 2048); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt LIKE 'That file is not stored where%', 'a path outside the enquiry''s folder is refused', v_txt);
  PERFORM pg_temp.as_owner();
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('admission-documents', v_path, v_t1, '{"size": 2048}'::jsonb);
  PERFORM pg_temp.as_user(v_t1);
  PERFORM public.admission_set_document_file(v_e1, 'photos', v_path, 'photo.jpg', 2048);
  SELECT count(*) INTO v_n FROM storage.objects o WHERE o.bucket_id = 'admission-documents' AND o.name = v_path;
  PERFORM pg_temp.chk(v_n = 1, 'staff can see the scan through the storage policy');
  PERFORM pg_temp.as_user(v_stu);
  SELECT count(*) INTO v_n FROM storage.objects o WHERE o.bucket_id = 'admission-documents' AND o.name = v_path;
  PERFORM pg_temp.chk(v_n = 0, 'a student cannot see the scan', format('%s', v_n));
  PERFORM pg_temp.as_user(v_t2);
  SELECT count(*) INTO v_n FROM storage.objects o WHERE o.bucket_id = 'admission-documents' AND o.name = v_path;
  PERFORM pg_temp.chk(v_n = 0, 'an unnamed teacher cannot see the scan', format('%s', v_n));
  PERFORM pg_temp.as_user(v_t1);
  v_js := public.admission_enquiry_detail(v_e1);
  SELECT d INTO v_js FROM jsonb_array_elements(v_js->'documents') d WHERE d->>'doc_key' = 'photos';
  PERFORM pg_temp.chk(v_js->>'file_path' = v_path AND v_js->>'file_name' = 'photo.jpg' AND (v_js->>'collected')::boolean,
    'the scan is recorded and the certificate ticked', left(v_js::text, 200));
  PERFORM public.admission_remove_document_file(v_e1, 'photos');
  PERFORM public.admission_remove_document_file(v_e1, 'photos');
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((SELECT file_path IS NULL AND collected FROM public.admission_documents WHERE enquiry_id = v_e1 AND doc_key = 'photos')
                      AND (SELECT count(*) FROM public.admission_document_trash WHERE object_path = v_path AND done_at IS NULL) = 1,
    'remove: the row is cleared, the tick stays, the object is queued once for deletion');
  v_js := (SELECT jsonb_agg(to_jsonb(x)) FROM public.admission_docs_trash_pending(10) x);
  PERFORM pg_temp.chk(v_js @> jsonb_build_array(jsonb_build_object('object_path', v_path)), 'the sweeper is handed the queued path', left(v_js::text, 200));

  -- ── 7. drop and reopen ───────────────────────────────────────────────────
  PERFORM pg_temp.as_user(v_t1);
  BEGIN PERFORM public.admission_drop(v_e3, '  '); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Say why the enquiry is dropped.', 'a drop needs a reason', v_txt);
  PERFORM public.admission_drop(v_e3, 'Moved city');
  BEGIN PERFORM public.admission_drop(v_e3, 'Again'); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'This enquiry is already dropped.', 'dropping twice is refused', v_txt);
  BEGIN PERFORM public.admission_register(v_e3, 100, 'cash', 'R1', ((now() AT TIME ZONE 'Asia/Kolkata')::date), NULL); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'This enquiry was dropped. Reopen it first.', 'a dropped enquiry cannot be registered', v_txt);
  PERFORM public.admission_reopen(v_e3);
  v_js := public.admission_stage_counts(v_inst, v_year);
  PERFORM pg_temp.chk(v_js = '{"enquiry": 2, "registered": 1, "admitted": 0, "dropped": 0}'::jsonb, 'reopen puts it back as an enquiry', v_js::text);

  -- ── 8. admission ─────────────────────────────────────────────────────────
  PERFORM pg_temp.as_owner();
  BEGIN PERFORM public.admission_admit_check(v_e2, v_t1, v_class, 'X1', false); v_txt := 'ok';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Register this enquiry first.', 'admit check: only a registered enquiry', v_txt);
  BEGIN PERFORM public.admission_admit_check(v_e1, v_t2, v_class, 'X1', false); v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = '42501', 'admit check: the actor must be admissions staff', v_state);
  BEGIN PERFORM public.admission_admit_check(v_e1, v_t1, v_class, v_foreign_num, false); v_hint := 'ok';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_txt = MESSAGE_TEXT; END;
  PERFORM pg_temp.chk(v_hint = 'admission_number_taken' AND v_txt LIKE '%already used by another school on SALCI%'
                      AND v_txt NOT LIKE '%' || (SELECT full_name FROM public.profiles WHERE lower(admission_number) = lower(v_foreign_num) LIMIT 1) || '%',
    'a number held in another school is refused without naming the child', v_txt);
  v_js := public.admission_admit_check(v_e1, v_t1, v_class, NULL, true);
  PERFORM pg_temp.chk(v_js->>'admission_number' = 'ADTEST/007', 'auto: prefix plus the next number, padded', v_js::text);

  v_new := gen_random_uuid();
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', v_new, 'authenticated', 'authenticated',
          'adm.suite' || substr(replace(v_new::text, '-', ''), 1, 12) || '@temp.local', '', now(),
          '{}'::jsonb, '{"full_name": "Suite Child"}'::jsonb, now(), now());
  v_js := public.admission_admit_tx(v_e1, v_new, v_t1, jsonb_build_object(
    'full_name', 'Suite Child Kumar', 'date_of_birth', '2020-05-04', 'gender', 'female',
    'guardian_name', 'Suite Parent', 'guardian_phone', '9000000001', 'guardian_email', NULL,
    'class_id', v_class, 'admission_number', 'ADTEST/007', 'admission_number_is_auto', true,
    'admitted_on', '2031-04-01', 'previous_school', 'Little Steps',
    'form', jsonb_build_object('blood_group', 'B+', 'father_name', 'Suite Father', 'mother_name', 'Suite Mother',
                               'address', E'12 Road\nCity', 'custom', jsonb_build_object('q_bus', 'yes', 'q_house', 'Red')),
    'documents', '[{"doc_key":"birth_certificate","collected":true},{"doc_key":"photos","collected":false}]'::jsonb));
  PERFORM pg_temp.chk(v_js->>'admission_number' = 'ADTEST/007' AND v_js->>'profile_id' = v_new::text, 'admitted with the auto number', v_js::text);
  PERFORM pg_temp.chk((SELECT institution_id = v_inst AND admission_number = 'ADTEST/007' AND full_name = 'Suite Child Kumar'
                              AND must_reset_password AND coalesce(phone, '') = '' FROM public.profiles WHERE id = v_new),
    'the profile: school, number, name, reset on first login, no phone');
  PERFORM pg_temp.chk(public.has_role(v_new, 'student')
                      AND EXISTS (SELECT 1 FROM public.class_assignments WHERE user_id = v_new AND class_id = v_class AND role = 'student'),
    'the student role and the section');
  PERFORM pg_temp.chk((SELECT date_of_birth = '2020-05-04' AND guardian_phone = '9000000001' AND gender = 'female' AND blood_group = 'B+'
                              AND father_name = 'Suite Father' AND mother_name = 'Suite Mother' AND address = E'12 Road\nCity'
                         FROM public.student_personal_details WHERE profile_id = v_new),
    'personal details carry the physical form');
  PERFORM pg_temp.chk((SELECT stage = 'admitted' AND student_profile_id = v_new AND admission_number = 'ADTEST/007'
                              AND admitted_on = '2031-04-01' AND form->'custom' = '{"q_bus": "yes", "q_house": "Red"}'::jsonb
                              AND form->>'father_name' = 'Suite Father' AND previous_school = 'Little Steps'
                         FROM public.admission_enquiries WHERE id = v_e1),
    'the enquiry: admitted, linked, the answers merged');
  PERFORM pg_temp.chk((SELECT collected FROM public.admission_documents WHERE enquiry_id = v_e1 AND doc_key = 'birth_certificate')
                      AND NOT (SELECT collected FROM public.admission_documents WHERE enquiry_id = v_e1 AND doc_key = 'photos'),
    'the admit form''s ticks are applied');
  PERFORM pg_temp.chk((SELECT next_admission_seq FROM public.admission_settings WHERE institution_id = v_inst) = 8,
    'the next auto number moves on', format('%s', (SELECT next_admission_seq FROM public.admission_settings WHERE institution_id = v_inst)));
  PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.notifications WHERE type = 'admission_admitted' AND user_id = v_admin
                               AND (metadata->>'enquiry_id')::uuid = v_e1),
    'the school''s admin is told');
  BEGIN PERFORM public.admission_admit_tx(v_e1, v_new, v_t1, '{}'::jsonb); v_txt := 'ok';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'This child is already admitted.', 'admitting twice is refused', v_txt);

  -- a typed number someone in this school holds is refused, naming them
  PERFORM pg_temp.as_user(v_t1);
  PERFORM public.admission_register(v_e2, 1500, 'cash', 'R-80', ((now() AT TIME ZONE 'Asia/Kolkata')::date), NULL);
  PERFORM pg_temp.as_owner();
  BEGIN PERFORM public.admission_admit_check(v_e2, v_t1, v_class, 'adtest/007', false); v_txt := 'ok';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Admission number adtest/007 is already with Suite Child Kumar.', 'a number in this school names its holder', v_txt);
  v_new2 := gen_random_uuid();
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', v_new2, 'authenticated', 'authenticated',
          'adm.suite' || substr(replace(v_new2::text, '-', ''), 1, 12) || '@temp.local', '', now(),
          '{}'::jsonb, '{"full_name": "Suite Sibling"}'::jsonb, now(), now());
  BEGIN PERFORM public.admission_admit_tx(v_e2, v_new, v_t1, jsonb_build_object(
    'full_name', 'Suite Sibling', 'date_of_birth', '2022-01-01', 'gender', 'male', 'guardian_name', 'Suite Parent',
    'guardian_phone', '9000000001', 'class_id', v_class, 'admission_number', 'ADTEST/900', 'admission_number_is_auto', false)); v_txt := 'ok';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'That sign-in account is already in use.', 'an account that already has a role cannot be reused', v_txt);
  v_js := public.admission_admit_tx(v_e2, v_new2, v_t1, jsonb_build_object(
    'full_name', 'Suite Sibling', 'date_of_birth', '2022-01-01', 'gender', 'male', 'guardian_name', 'Suite Parent',
    'guardian_phone', '9000000001', 'class_id', v_class, 'admission_number', 'ADTEST/008', 'admission_number_is_auto', false));
  PERFORM pg_temp.chk(v_js->>'admission_number' = 'ADTEST/008'
                      AND (SELECT next_admission_seq FROM public.admission_settings WHERE institution_id = v_inst) = 9,
    'a sibling with the same guardian phone is admitted; typing the next auto number moves it on', v_js::text);
  PERFORM pg_temp.as_user(v_t1);
  BEGIN PERFORM public.admission_update_enquiry(v_e1, jsonb_build_object('student_name', 'Renamed')); v_hint := 'saved';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; END;
  PERFORM pg_temp.chk(v_hint = 'admission_wrong_stage', 'an admitted enquiry''s facts are frozen', v_hint);
  PERFORM public.admission_update_enquiry(v_e1, jsonb_build_object('next_follow_up_on', NULL, 'student_name', 'Suite Child Kumar'));
  PERFORM pg_temp.chk((SELECT next_follow_up_on IS NULL FROM public.admission_enquiries WHERE id = v_e1), 'but its follow-up can still change');
  BEGIN PERFORM public.admission_drop(v_e1, 'x'); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'This child is already admitted.', 'an admitted child cannot be dropped', v_txt);

  -- ── 9. the public form ───────────────────────────────────────────────────
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(public.admission_public_context('NO-SUCH-SCHOOL') IS NULL, 'context: an unknown code is nothing');
  v_js := public.admission_public_context(lower(v_code));
  PERFORM pg_temp.chk(v_js->>'enabled' = 'false' AND v_js->'classes' = '[]'::jsonb, 'context: off while the admissions feature is off', left(v_js::text, 200));
  BEGIN PERFORM public.admission_public_submit(v_code, repeat('a', 64), '{}'::jsonb); v_hint := 'saved';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; END;
  PERFORM pg_temp.chk(v_hint = 'admission_form_closed', 'submit: refused while off', v_hint);
  INSERT INTO public.institution_features (institution_id, feature_id, is_enabled) VALUES (v_inst, 'admissions', true);
  v_js := public.admission_public_context(v_code);
  PERFORM pg_temp.chk(v_js->>'enabled' = 'true' AND jsonb_array_length(v_js->'classes') > 0
                      AND jsonb_array_length(v_js->'academic_years') = 3
                      AND jsonb_array_length(v_js->'questions') = 1 AND v_js->'questions'->0->>'id' = 'q_bus'
                      AND v_js->'questions'->0->'ask_at' = '["public"]'::jsonb
                      AND NOT v_js::text LIKE '%' || v_admin::text || '%',
    'context: classes, three years, only the online questions', left(v_js::text, 300));
  v_year := v_js->'academic_years'->>1;
  BEGIN PERFORM public.admission_public_submit(v_code, repeat('b', 64), jsonb_build_object(
    'student_name', 'Web Child', 'parent_name', 'Web Parent', 'parent_phone', '9100000001', 'applying_for', 'Class 1',
    'academic_year', v_year)); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Answer "Needs the bus?".', 'submit: a required question must be answered', v_txt);
  BEGIN PERFORM public.admission_public_submit(v_code, repeat('b', 64), jsonb_build_object(
    'student_name', 'Web Child', 'parent_name', 'Web Parent', 'parent_phone', '9100000001', 'applying_for', 'Class 1',
    'academic_year', v_year, 'answers', jsonb_build_object('q_bus', 'maybe'))); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Answer yes or no to "Needs the bus?".', 'submit: a yes/no answer in shape', v_txt);
  BEGIN PERFORM public.admission_public_submit(v_code, repeat('b', 64), jsonb_build_object(
    'student_name', 'Web Child', 'parent_name', 'Web Parent', 'parent_phone', '9100000001', 'applying_for', 'Class 1',
    'academic_year', '2040-41', 'answers', jsonb_build_object('q_bus', 'no'))); v_txt := 'saved';
  EXCEPTION WHEN OTHERS THEN v_txt := SQLERRM; END;
  PERFORM pg_temp.chk(v_txt = 'Choose the academic year.', 'submit: only the offered years', v_txt);
  v_js := public.admission_public_submit(v_code, repeat('b', 64), jsonb_build_object(
    'student_name', 'Web Child', 'parent_name', 'Web Parent', 'parent_phone', '9100000001', 'class_group_id', v_group,
    'applying_for', 'ignored', 'academic_year', v_year, 'answers', jsonb_build_object('q_bus', 'no', 'q_house', 'Red', 'other', 'x'),
    'admin_note', 'should be ignored'));
  v_ref2 := v_js->>'reference_no';
  PERFORM pg_temp.chk(v_ref2 ~ '^ENQ-\d{4}-\d{4}$'
                      AND (SELECT source = 'public_form' AND created_by IS NULL AND form = '{"custom": {"q_bus": "no"}}'::jsonb
                                  AND applying_for_label = (SELECT g.name FROM public.class_groups g WHERE g.id = v_group)
                             FROM public.admission_enquiries WHERE institution_id = v_inst AND reference_no = v_ref2),
    'submit: saved from the online form, only public answers kept, class from the list', v_ref2);
  v_js := public.admission_public_submit(v_code, repeat('b', 64), jsonb_build_object(
    'student_name', 'web child', 'parent_name', 'Web Parent', 'parent_phone', '9100000001', 'applying_for', 'Class 1',
    'academic_year', v_year, 'answers', jsonb_build_object('q_bus', 'no')));
  PERFORM pg_temp.chk(v_js->>'reference_no' = v_ref2, 'submit: a double submit returns the first reference');
  PERFORM pg_temp.as_user(v_t1);
  PERFORM public.admission_update_enquiry((SELECT id FROM public.admission_enquiries WHERE institution_id = v_inst AND reference_no = v_ref2),
                                          jsonb_build_object('source', 'other', 'previous_school', 'Edited'));
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk((SELECT source = 'public_form' AND previous_school = 'Edited' FROM public.admission_enquiries
                        WHERE institution_id = v_inst AND reference_no = v_ref2),
    'an edit keeps an online-form enquiry''s source');
  PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM public.notifications WHERE type = 'admission_enquiry_received' AND user_id = v_t1)
                      AND EXISTS (SELECT 1 FROM public.notifications WHERE type = 'admission_enquiry_received' AND user_id = v_admin)
                      AND NOT EXISTS (SELECT 1 FROM public.notifications WHERE type = 'admission_enquiry_received' AND user_id = v_t2),
    'submit: the admin and the named staff are told, nobody else');
  FOR v_n IN 2..5 LOOP
    PERFORM public.admission_public_submit(v_code, repeat('b', 64), jsonb_build_object(
      'student_name', 'Web Child ' || v_n, 'parent_name', 'Web Parent', 'parent_phone', '910000000' || v_n, 'applying_for', 'Class 1',
      'academic_year', v_year, 'answers', jsonb_build_object('q_bus', 'no')));
  END LOOP;
  BEGIN PERFORM public.admission_public_submit(v_code, repeat('b', 64), jsonb_build_object(
    'student_name', 'Web Child 6', 'parent_name', 'Web Parent', 'parent_phone', '9100000006', 'applying_for', 'Class 1',
    'academic_year', v_year, 'answers', jsonb_build_object('q_bus', 'no'))); v_hint := 'saved';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; END;
  PERFORM pg_temp.chk(v_hint = 'admission_rate_limited', 'submit: the sixth in ten minutes from one connection is refused', v_hint);
  v_js := public.admission_public_submit(v_code, repeat('c', 64), jsonb_build_object(
    'student_name', 'Web Child 7', 'parent_name', 'Web Parent', 'parent_phone', '9100000007', 'applying_for', 'Class 1',
    'academic_year', v_year, 'answers', jsonb_build_object('q_bus', 'yes')));
  PERFORM pg_temp.chk(v_js ? 'reference_no', 'submit: another connection still gets through');
  PERFORM pg_temp.as_user(v_admin);
  PERFORM public.admission_set_settings(v_inst, '{"enquiry_form_enabled": false}'::jsonb);
  PERFORM pg_temp.as_owner();
  v_js := public.admission_public_context(v_code);
  PERFORM pg_temp.chk(v_js->>'enabled' = 'false', 'context: off when the school switches the form off');

  -- ── 10. grants ───────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM information_schema.routine_privileges rp
   WHERE rp.routine_schema = 'public' AND rp.grantee = 'anon'
     AND (rp.routine_name LIKE 'admission%' OR rp.routine_name LIKE '\_admission%' OR rp.routine_name = 'is_admissions_staff');
  PERFORM pg_temp.chk(v_n = 0, 'anon can execute none of them', format('%s', v_n));
  SELECT string_agg(DISTINCT rp.routine_name, ', ') INTO v_txt FROM information_schema.routine_privileges rp
   WHERE rp.routine_schema = 'public' AND rp.grantee = 'authenticated'
     AND rp.routine_name IN ('admission_admit_tx', 'admission_admit_check', 'admission_public_context', 'admission_public_submit',
                             '_admissions_can', '_admissions_admin', 'admission_docs_trash_pending', 'admission_docs_trash_result',
                             'admission_docs_sweep_kick', '_admission_trash');
  PERFORM pg_temp.chk(v_txt IS NULL, 'the service-only ones are not callable from the browser', coalesce(v_txt, ''));
  PERFORM pg_temp.chk((SELECT public = false AND file_size_limit = 10485760 AND NOT ('image/svg+xml' = ANY (allowed_mime_types))
                         AND 'application/pdf' = ANY (allowed_mime_types) FROM storage.buckets WHERE id = 'admission-documents'),
    'the scan bucket is private, 10 MB, photos and PDF, no SVG');
  -- 2026-10-12 outage guards: a table whose PK holds FKs to two tables is a PostgREST
  -- junction, and a junction between profiles and institutions breaks every embed
  -- between them (PGRST201); a policy calling a function authenticated cannot run errors.
  SELECT string_agg(f1.conrelid::regclass::text, ', ') INTO v_txt
    FROM pg_constraint f1
    JOIN pg_constraint f2 ON f2.conrelid = f1.conrelid AND f2.contype = 'f' AND f1.conname < f2.conname
    JOIN pg_constraint pk ON pk.conrelid = f1.conrelid AND pk.contype = 'p'
   WHERE f1.contype = 'f' AND f1.connamespace = 'public'::regnamespace
     AND f1.conkey <@ pk.conkey AND f2.conkey <@ pk.conkey
     AND (f1.conrelid::regclass::text LIKE 'admission%'
          OR ARRAY[f1.confrelid, f2.confrelid] @> ARRAY['public.profiles'::regclass::oid, 'public.institutions'::regclass::oid]);
  PERFORM pg_temp.chk(v_txt IS NULL, 'no admissions table is a PostgREST junction; nothing joins profiles and institutions', coalesce(v_txt, ''));
  SELECT string_agg(p.tablename || '.' || p.policyname || ' -> ' || f.proname, ', ') INTO v_txt
    FROM pg_policies p
    JOIN pg_proc f ON (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ ('\m' || f.proname || '\(')
    JOIN pg_namespace fn ON fn.oid = f.pronamespace AND fn.nspname = 'public'
   WHERE p.schemaname IN ('public', 'storage')
     AND (p.roles @> ARRAY['authenticated']::name[] OR p.roles @> ARRAY['public']::name[])
     AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE');
  PERFORM pg_temp.chk(v_txt IS NULL, 'no policy calls a function the browser cannot run', coalesce(v_txt, ''));
  PERFORM pg_temp.as_user(v_stu);
  BEGIN SELECT count(*) INTO v_n FROM public.admissions_overrides; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = 'ok' AND v_n = 0, 'a student reads admissions_overrides without an error, and sees nothing', v_state);
  PERFORM pg_temp.as_user(v_admin);
  BEGIN SELECT count(*) INTO v_n FROM public.admissions_overrides WHERE institution_id = v_inst; v_state := 'ok';
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  PERFORM pg_temp.chk(v_state = 'ok' AND v_n = 1, 'the admin reads the school''s named staff directly', format('%s %s', v_state, v_n));
  PERFORM pg_temp.as_owner();
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM dua.registry_gaps()) AND NOT EXISTS (SELECT 1 FROM dua.unclassified_sensitive_columns()),
    'the deleted-user archive has no gaps');
END
$test$;

SELECT result, label, detail FROM t_out ORDER BY n;
ROLLBACK;
