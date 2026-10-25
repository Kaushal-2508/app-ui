CREATE TEMP TABLE _r(check_name text, want text, got text, verdict text) ON COMMIT DROP;
DO $$
DECLARE
  _admin uuid := 'ede067c9-6f51-4792-977e-77349424276d';
  _inst uuid; _cls uuid; _cls_name text; _foreign uuid; _n int; _err text; _dupes text;
  _d_all jsonb; _d_cls jsonb;
  _t_all jsonb; _t_cls jsonb;
  _b_all int; _b_cls int;
  _et_all jsonb; _et_cls jsonb;
BEGIN
  SELECT institution_id INTO _inst FROM profiles WHERE id=_admin;

  -- No ambiguous overloads left anywhere on the dash_* surface.
  SELECT string_agg(proname||' x'||n, ', ') INTO _dupes FROM (
    SELECT p.proname, count(*) n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
     WHERE ns.nspname='public' AND p.proname LIKE 'dash%' GROUP BY p.proname HAVING count(*)>1) q;

  -- A class that actually has both students and a teacher, so every card has
  -- something to show rather than a vacuous pass.
  SELECT c.id, c.name||coalesce(' '||c.section,'') INTO _cls, _cls_name
    FROM classes c
   WHERE c.institution_id=_inst
     AND EXISTS (SELECT 1 FROM class_assignments ca WHERE ca.class_id=c.id AND ca.role::text='teacher')
     AND EXISTS (SELECT 1 FROM student_exam_attempts a
                  JOIN final_results fr ON fr.attempt_id=a.id WHERE a.class_id=c.id)
   ORDER BY c.name LIMIT 1;

  SELECT c.id INTO _foreign FROM classes c WHERE c.institution_id<>_inst LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',_admin,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    _d_all := public.dash_student_distribution();
    _d_cls := public.dash_student_distribution(NULL, _cls);
    _t_all := public.dash_teachers_table('{}'::jsonb, 24, 0);
    _t_cls := public.dash_teachers_table(jsonb_build_object('class_id', _cls), 24, 0);
    SELECT count(*) INTO _b_all FROM public.dash_students_in_band('needs_help', 200);
    SELECT count(*) INTO _b_cls FROM public.dash_students_in_band('needs_help', 200, NULL, NULL, NULL, _cls);
    _et_all := public.dash_exam_trend(8);
    _et_cls := public.dash_exam_trend(8, NULL, _cls);
  EXCEPTION WHEN others THEN _err := SQLSTATE||' '||SQLERRM;
  END;
  RESET ROLE;

  INSERT INTO _r VALUES ('runs as a real admin','no error',coalesce(_err,'no error'),
    CASE WHEN _err IS NULL THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('no ambiguous dash_* overloads','none',coalesce(_dupes,'none'),
    CASE WHEN _dupes IS NULL THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('test class', _cls_name, _cls_name, 'INFO');

  INSERT INTO _r VALUES ('donut school-wide','total > 0',
    coalesce((_d_all->>'total')||' total, '||(_d_all->>'evaluated')||' evaluated','-'),
    CASE WHEN coalesce((_d_all->>'total')::int,0) > 0 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('donut narrows to the class','smaller total',
    coalesce((_d_cls->>'total')||' total, '||(_d_cls->>'evaluated')||' evaluated','-'),
    CASE WHEN (_d_cls->>'total')::int > 0 AND (_d_cls->>'total')::int < (_d_all->>'total')::int
         THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('donut bands still sum to evaluated','equal',
    ((_d_cls->>'doing_well')::int + (_d_cls->>'catching_up')::int + (_d_cls->>'needs_help')::int)::text
      ||' vs '||(_d_cls->>'evaluated'),
    CASE WHEN (_d_cls->>'doing_well')::int + (_d_cls->>'catching_up')::int + (_d_cls->>'needs_help')::int
              = (_d_cls->>'evaluated')::int THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO _r VALUES ('band list matches the donut segment',
    coalesce(_d_cls->>'needs_help','-'), coalesce(_b_cls::text,'-'),
    CASE WHEN _b_cls = (_d_cls->>'needs_help')::int THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('band list narrows','< school-wide',
    coalesce(_b_cls::text,'-')||' of '||coalesce(_b_all::text,'-'),
    CASE WHEN _b_cls IS NOT NULL AND _b_all IS NOT NULL AND _b_cls <= _b_all THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO _r VALUES ('staff school-wide','> 0', coalesce(_t_all->>'total','-'),
    CASE WHEN coalesce((_t_all->>'total')::int,0) > 0 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('staff narrows to the class','< school total',
    coalesce((_t_cls->>'total')||' of '||(_t_all->>'total'),'-'),
    CASE WHEN (_t_cls->>'total')::int > 0 AND (_t_cls->>'total')::int < (_t_all->>'total')::int
         THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('staff rows match staff total','equal',
    jsonb_array_length(_t_cls->'rows')::text||' vs '||(_t_cls->>'total'),
    CASE WHEN jsonb_array_length(_t_cls->'rows') = (_t_cls->>'total')::int THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO _r VALUES ('exam trend narrows','different from school-wide',
    CASE WHEN _et_all::text = _et_cls::text THEN 'IDENTICAL' ELSE 'different' END,
    CASE WHEN _et_all::text <> _et_cls::text THEN 'PASS' ELSE 'FAIL' END);

  -- Cross-institution guards on all three new class parameters.
  _err := NULL;
  BEGIN PERFORM public.dash_student_distribution(NULL, _foreign);
  EXCEPTION WHEN others THEN _err := SQLERRM; END;
  INSERT INTO _r VALUES ('donut rejects a foreign class','raises',coalesce(_err,'RETURNED DATA'),
    CASE WHEN _err IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  _err := NULL;
  BEGIN PERFORM public.dash_teachers_table(jsonb_build_object('class_id', _foreign), 5, 0);
  EXCEPTION WHEN others THEN _err := SQLERRM; END;
  INSERT INTO _r VALUES ('staff rejects a foreign class','raises',coalesce(_err,'RETURNED DATA'),
    CASE WHEN _err IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  _err := NULL;
  BEGIN PERFORM * FROM public.dash_students_in_band('needs_help', 10, NULL, NULL, NULL, _foreign);
  EXCEPTION WHEN others THEN _err := SQLERRM; END;
  INSERT INTO _r VALUES ('band rejects a foreign class','raises',coalesce(_err,'RETURNED DATA'),
    CASE WHEN _err IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  -- anon locked out of everything touched this round.
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND p.proname IN ('dash_student_distribution','dash_teachers_table',
                       'dash_students_in_band','dash_exam_trend')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  INSERT INTO _r VALUES ('anon cannot execute any of the four','0',_n::text,
    CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public'
     AND p.proname IN ('dash_student_distribution','dash_teachers_table',
                       'dash_students_in_band','dash_exam_trend')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  INSERT INTO _r VALUES ('authenticated still can','4',_n::text,
    CASE WHEN _n=4 THEN 'PASS' ELSE 'FAIL' END);
END $$;
SELECT check_name, want, got, verdict FROM _r;

-- ── non-vacuous re-check of the donut/list coupling ─────────────────────────
-- The round-3 run asserted "band list matches the donut segment" on a class
-- where the segment was 0, so 0 = 0 passed without exercising anything. This
-- picks the class with the MOST students below 50% and checks every band there,
-- so the coupling between the donut's counts and the list behind them is
-- actually tested.
CREATE TEMP TABLE _r(check_name text, want text, got text, verdict text) ON COMMIT DROP;
DO $$
DECLARE
  _admin uuid := 'ede067c9-6f51-4792-977e-77349424276d';
  _inst uuid; _cls uuid; _cls_name text; _err text;
  _d jsonb; _nh int; _cu int; _dw int; _tot int;
BEGIN
  SELECT institution_id INTO _inst FROM profiles WHERE id=_admin;

  SELECT l.class_id INTO _cls FROM (
    SELECT DISTINCT ON (a.student_id) a.student_id, a.class_id, fr.percentage
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id AND e.institution_id = _inst
       AND e.status IN ('published','active','completed')
     ORDER BY a.student_id, coalesce(fr.finalized_at, fr.created_at) DESC) l
   WHERE l.percentage < 50
   GROUP BY l.class_id ORDER BY count(*) DESC LIMIT 1;
  SELECT c.name||coalesce(' '||c.section,'') INTO _cls_name FROM classes c WHERE c.id=_cls;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',_admin,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    _d := public.dash_student_distribution(NULL, _cls);
    SELECT count(*) INTO _nh FROM public.dash_students_in_band('needs_help',  200, NULL, NULL, NULL, _cls);
    SELECT count(*) INTO _cu FROM public.dash_students_in_band('catching_up', 200, NULL, NULL, NULL, _cls);
    SELECT count(*) INTO _dw FROM public.dash_students_in_band('doing_well',  200, NULL, NULL, NULL, _cls);
  EXCEPTION WHEN others THEN _err := SQLSTATE||' '||SQLERRM;
  END;
  RESET ROLE;

  INSERT INTO _r VALUES ('runs','no error',coalesce(_err,'no error'),
    CASE WHEN _err IS NULL THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('class under test', _cls_name, _cls_name, 'INFO');
  INSERT INTO _r VALUES ('needs_help segment is non-zero','> 0', coalesce(_d->>'needs_help','-'),
    CASE WHEN coalesce((_d->>'needs_help')::int,0) > 0 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('needs_help list = segment', coalesce(_d->>'needs_help','-'), coalesce(_nh::text,'-'),
    CASE WHEN _nh = (_d->>'needs_help')::int THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('catching_up list = segment', coalesce(_d->>'catching_up','-'), coalesce(_cu::text,'-'),
    CASE WHEN _cu = (_d->>'catching_up')::int THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('doing_well list = segment', coalesce(_d->>'doing_well','-'), coalesce(_dw::text,'-'),
    CASE WHEN _dw = (_d->>'doing_well')::int THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('three lists = evaluated', coalesce(_d->>'evaluated','-'),
    coalesce((_nh+_cu+_dw)::text,'-'),
    CASE WHEN _nh+_cu+_dw = (_d->>'evaluated')::int THEN 'PASS' ELSE 'FAIL' END);
END $$;
SELECT check_name, want, got, verdict FROM _r;
