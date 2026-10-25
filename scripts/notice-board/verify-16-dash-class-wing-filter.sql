-- Wing filter on the class ranking. Deliberately exercises THREE wings: one
-- with classes and results, the one with zero mappings (an empty result that
-- must not look like a failure), and a wing from another institution (which
-- must raise rather than return nothing).
CREATE TEMP TABLE _r(check_name text, want text, got text, verdict text) ON COMMIT DROP;
DO $$
DECLARE
  _admin uuid := 'ede067c9-6f51-4792-977e-77349424276d';
  _inst uuid; _err text; _dupes text; _n int;
  _w_big uuid; _w_big_name text; _w_big_mapped int;
  _w_empty uuid; _w_empty_name text;
  _w_foreign uuid;
  _all int; _big int; _empty int; _sum int;
  _overlap int;
BEGIN
  SELECT institution_id INTO _inst FROM profiles WHERE id=_admin;

  SELECT string_agg(proname||' x'||n, ', ') INTO _dupes FROM (
    SELECT p.proname, count(*) n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
     WHERE ns.nspname='public' AND p.proname LIKE 'dash%' GROUP BY p.proname HAVING count(*)>1) q;
  INSERT INTO _r VALUES ('no ambiguous dash_* overloads','none',coalesce(_dupes,'none'),
    CASE WHEN _dupes IS NULL THEN 'PASS' ELSE 'FAIL' END);

  SELECT w.id, w.name, count(m.class_id) INTO _w_big, _w_big_name, _w_big_mapped
    FROM wings w LEFT JOIN wing_class_mappings m ON m.wing_id=w.id
   WHERE w.institution_id=_inst AND w.is_active IS NOT FALSE
   GROUP BY w.id, w.name ORDER BY count(m.class_id) DESC LIMIT 1;

  SELECT w.id, w.name INTO _w_empty, _w_empty_name
    FROM wings w WHERE w.institution_id=_inst AND w.is_active IS NOT FALSE
     AND NOT EXISTS (SELECT 1 FROM wing_class_mappings m WHERE m.wing_id=w.id) LIMIT 1;

  SELECT w.id INTO _w_foreign FROM wings w WHERE w.institution_id <> _inst LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',_admin,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO _all   FROM public.dash_class_performance();
    SELECT count(*) INTO _big   FROM public.dash_class_performance(NULL, _w_big);
    IF _w_empty IS NOT NULL THEN
      SELECT count(*) INTO _empty FROM public.dash_class_performance(NULL, _w_empty);
    END IF;
    -- Every class the wing filter returns must actually be mapped to that wing.
    SELECT count(*) INTO _overlap
      FROM public.dash_class_performance(NULL, _w_big) cp
     WHERE NOT EXISTS (SELECT 1 FROM wing_class_mappings m
                        WHERE m.class_id = cp.class_id AND m.wing_id = _w_big);
    -- No duplicate rows: a class mapped to two wings must not rank twice.
    SELECT count(*) - count(DISTINCT class_id) INTO _sum
      FROM public.dash_class_performance();
  EXCEPTION WHEN others THEN _err := SQLSTATE||' '||SQLERRM;
  END;
  RESET ROLE;

  INSERT INTO _r VALUES ('runs as a real admin','no error',coalesce(_err,'no error'),
    CASE WHEN _err IS NULL THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('all wings (unfiltered)','> 0',coalesce(_all::text,'-'),
    CASE WHEN coalesce(_all,0) > 0 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('largest wing: '||coalesce(_w_big_name,'?'),
    '0 < n < '||coalesce(_all::text,'?'), coalesce(_big::text,'-'),
    CASE WHEN _big > 0 AND _big < _all THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('every returned class is in that wing','0 strays',coalesce(_overlap::text,'-'),
    CASE WHEN _overlap = 0 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('no class ranked twice','0 duplicates',coalesce(_sum::text,'-'),
    CASE WHEN _sum = 0 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('unmapped wing ('||coalesce(_w_empty_name,'none exists')||')','0 rows, no error',
    coalesce(_empty::text,'n/a'),
    CASE WHEN _w_empty IS NULL OR _empty = 0 THEN 'PASS' ELSE 'FAIL' END);

  _err := NULL;
  BEGIN PERFORM * FROM public.dash_class_performance(NULL, _w_foreign);
  EXCEPTION WHEN others THEN _err := SQLERRM; END;
  INSERT INTO _r VALUES ('rejects a foreign wing','raises',coalesce(_err,'RETURNED DATA'),
    CASE WHEN _err IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='dash_class_performance'
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  INSERT INTO _r VALUES ('anon cannot execute','0',_n::text,
    CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname='dash_class_performance'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  INSERT INTO _r VALUES ('authenticated still can','1',_n::text,
    CASE WHEN _n=1 THEN 'PASS' ELSE 'FAIL' END);
END $$;
SELECT check_name, want, got, verdict FROM _r;
