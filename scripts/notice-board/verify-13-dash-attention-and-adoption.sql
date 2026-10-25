-- Final gate on everything this change touched. Returns one row per assertion
-- with an explicit PASS/FAIL, so a silent regression cannot read as success.
CREATE TEMP TABLE _r(check_name text, want text, got text, verdict text) ON COMMIT DROP;
DO $$
DECLARE
  _admin uuid := 'ede067c9-6f51-4792-977e-77349424276d';
  _cls uuid; _n int; _j jsonb; _err text;
  _att_all int; _att_cls int; _ad_all int; _ad_cls int;
  _dupes text;
BEGIN
  -- No ambiguous overloads anywhere in the dash_* surface: two candidates that
  -- both accept a call is the failure that emptied the attendance trend.
  SELECT string_agg(proname || ' x' || n, ', ') INTO _dupes FROM (
    SELECT p.proname, count(*) AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
     WHERE ns.nspname='public' AND p.proname LIKE 'dash%'
     GROUP BY p.proname HAVING count(*) > 1) q;

  SELECT c.id INTO _cls FROM classes c
   WHERE c.institution_id = (SELECT institution_id FROM profiles WHERE id=_admin)
     AND EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.class_id=c.id AND ca.role::text='student')
   ORDER BY c.name LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',_admin,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT (public.dash_students_attention(NULL::jsonb,'{}'::jsonb,6,0)->>'total')::int INTO _att_all;
    SELECT (public.dash_students_attention(NULL::jsonb,jsonb_build_object('class_id',_cls),6,0)->>'total')::int INTO _att_cls;
    SELECT (public.dash_student_portal_adoption(NULL,8)->>'total')::int INTO _ad_all;
    SELECT (public.dash_student_portal_adoption(NULL,8,_cls)->>'total')::int INTO _ad_cls;
  EXCEPTION WHEN others THEN _err := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;

  INSERT INTO _r VALUES ('runs as a real admin', 'no error', coalesce(_err,'no error'),
    CASE WHEN _err IS NULL THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('no ambiguous dash_* overloads', 'none', coalesce(_dupes,'none'),
    CASE WHEN _dupes IS NULL THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('attention list is populated', '> 0', coalesce(_att_all::text,'-'),
    CASE WHEN coalesce(_att_all,0) > 0 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('attention class filter narrows', '< school total',
    coalesce(_att_cls::text,'-') || ' of ' || coalesce(_att_all::text,'-'),
    CASE WHEN _att_cls IS NOT NULL AND _att_all IS NOT NULL AND _att_cls < _att_all THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('adoption is populated', '> 0', coalesce(_ad_all::text,'-'),
    CASE WHEN coalesce(_ad_all,0) > 0 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('adoption class filter narrows', '< school total',
    coalesce(_ad_cls::text,'-') || ' of ' || coalesce(_ad_all::text,'-'),
    CASE WHEN _ad_cls IS NOT NULL AND _ad_all IS NOT NULL AND _ad_cls < _ad_all THEN 'PASS' ELSE 'FAIL' END);

  -- Cross-institution guard: a class from another school must raise, not
  -- quietly return zeroes that read as "nobody here has signed in".
  SELECT c.id INTO _cls FROM classes c
   WHERE c.institution_id <> (SELECT institution_id FROM profiles WHERE id=_admin) LIMIT 1;
  _err := NULL;
  BEGIN
    PERFORM public.dash_student_portal_adoption(NULL, 8, _cls);
  EXCEPTION WHEN others THEN _err := SQLERRM;
  END;
  INSERT INTO _r VALUES ('adoption rejects a foreign class', 'raises', coalesce(_err,'RETURNED DATA'),
    CASE WHEN _err IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  -- anon must not reach either scorer.
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN ('dash_score_students','dash_score_students_scoped',
                                               'dash_student_portal_adoption')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  INSERT INTO _r VALUES ('anon cannot execute the scorers', '0', _n::text,
    CASE WHEN _n = 0 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN ('dash_score_students','dash_score_students_scoped',
                                               'dash_student_portal_adoption')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  INSERT INTO _r VALUES ('authenticated still can', '3', _n::text,
    CASE WHEN _n = 3 THEN 'PASS' ELSE 'FAIL' END);

  -- The scoped scorer carries the same relaxed gate, or the coordinator and
  -- teacher snapshot keeps the empty card.
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='dash_score_students_scoped'
     AND pg_get_functiondef(p.oid) LIKE '%coalesce(att_days,0)>=10 OR coalesce(exam_n,0)>=2%';
  INSERT INTO _r VALUES ('scoped scorer relaxed too', '1', _n::text,
    CASE WHEN _n = 1 THEN 'PASS' ELSE 'FAIL' END);
END $$;
SELECT check_name, want, got, verdict FROM _r;
