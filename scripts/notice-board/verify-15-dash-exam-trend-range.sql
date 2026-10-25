-- Proves the five windows resolve to the dates their labels claim, that the
-- exam trend actually narrows across them, and that NULL still means "no date
-- restriction" so every pre-existing caller is untouched.
CREATE TEMP TABLE _r(check_name text, want text, got text, verdict text) ON COMMIT DROP;
DO $$
DECLARE
  _admin uuid := 'ede067c9-6f51-4792-977e-77349424276d';
  _inst uuid; _tz text; _today date; _err text; _dupes text; _n int;
  _f date; _t date;
  _n_null int; _n_tm int; _n_1m int; _n_3m int; _n_6m int; _n_ay int; _n_junk int;
  _ay_start date; _ay_end date;
BEGIN
  SELECT institution_id INTO _inst FROM profiles WHERE id=_admin;
  SELECT timezone INTO _tz FROM institutions WHERE id=_inst;
  _today := (now() AT TIME ZONE COALESCE(_tz,'Asia/Kolkata'))::date;

  SELECT string_agg(proname||' x'||n, ', ') INTO _dupes FROM (
    SELECT p.proname, count(*) n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
     WHERE ns.nspname='public' AND p.proname LIKE 'dash%' GROUP BY p.proname HAVING count(*)>1) q;
  INSERT INTO _r VALUES ('no ambiguous dash_* overloads','none',coalesce(_dupes,'none'),
    CASE WHEN _dupes IS NULL THEN 'PASS' ELSE 'FAIL' END);

  -- Window boundaries, each against what its label promises.
  SELECT w.from_date, w.to_date INTO _f, _t FROM public.dash_range_window('tm', _inst) w;
  INSERT INTO _r VALUES ('tm starts on the 1st of this month',
    date_trunc('month',_today)::date::text, _f::text,
    CASE WHEN _f = date_trunc('month',_today)::date AND _t = _today THEN 'PASS' ELSE 'FAIL' END);

  SELECT w.from_date, w.to_date INTO _f, _t FROM public.dash_range_window('1m', _inst) w;
  INSERT INTO _r VALUES ('1m starts one month back',
    (_today - INTERVAL '1 month')::date::text, _f::text,
    CASE WHEN _f = (_today - INTERVAL '1 month')::date THEN 'PASS' ELSE 'FAIL' END);

  SELECT w.from_date INTO _f FROM public.dash_range_window('3m', _inst) w;
  INSERT INTO _r VALUES ('3m starts three months back',
    (_today - INTERVAL '3 months')::date::text, _f::text,
    CASE WHEN _f = (_today - INTERVAL '3 months')::date THEN 'PASS' ELSE 'FAIL' END);

  SELECT w.from_date INTO _f FROM public.dash_range_window('6m', _inst) w;
  INSERT INTO _r VALUES ('6m starts six months back',
    (_today - INTERVAL '6 months')::date::text, _f::text,
    CASE WHEN _f = (_today - INTERVAL '6 months')::date THEN 'PASS' ELSE 'FAIL' END);

  SELECT ay.starts_on::date, ay.ends_on::date INTO _ay_start, _ay_end
    FROM cal_academic_years ay WHERE ay.institution_id=_inst
   ORDER BY (_today BETWEEN ay.starts_on::date AND ay.ends_on::date) DESC,
            ay.is_active DESC, ay.starts_on::date DESC LIMIT 1;
  SELECT w.from_date, w.to_date INTO _f, _t FROM public.dash_range_window('ay', _inst) w;
  INSERT INTO _r VALUES ('ay matches the academic year, clamped to today',
    coalesce(_ay_start::text,'(none)')||' to '||LEAST(coalesce(_ay_end,_today),_today)::text,
    _f::text||' to '||_t::text,
    CASE WHEN _f = coalesce(_ay_start,(_today - INTERVAL '1 year')::date)
          AND _t = LEAST(coalesce(_ay_end,_today),_today) THEN 'PASS' ELSE 'FAIL' END);

  -- An unrecognised token from a stale client must narrow, never raise.
  _err := NULL;
  BEGIN
    SELECT w.from_date INTO _f FROM public.dash_range_window('nonsense', _inst) w;
  EXCEPTION WHEN others THEN _err := SQLERRM; END;
  INSERT INTO _r VALUES ('junk range falls back to 3m, no exception',
    (_today - INTERVAL '3 months')::date::text, coalesce(_f::text, 'RAISED: '||coalesce(_err,'?')),
    CASE WHEN _err IS NULL AND _f = (_today - INTERVAL '3 months')::date THEN 'PASS' ELSE 'FAIL' END);

  -- The chart itself, through the real caller path.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',_admin,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    _n_null := jsonb_array_length(public.dash_exam_trend(8));
    _n_tm   := jsonb_array_length(public.dash_exam_trend(8, NULL, NULL, 'tm'));
    _n_1m   := jsonb_array_length(public.dash_exam_trend(8, NULL, NULL, '1m'));
    _n_3m   := jsonb_array_length(public.dash_exam_trend(8, NULL, NULL, '3m'));
    _n_6m   := jsonb_array_length(public.dash_exam_trend(8, NULL, NULL, '6m'));
    _n_ay   := jsonb_array_length(public.dash_exam_trend(8, NULL, NULL, 'ay'));
    _n_junk := jsonb_array_length(public.dash_exam_trend(8, NULL, NULL, 'nonsense'));
  EXCEPTION WHEN others THEN _err := SQLSTATE||' '||SQLERRM;
  END;
  RESET ROLE;

  INSERT INTO _r VALUES ('runs as a real admin','no error',coalesce(_err,'no error'),
    CASE WHEN _err IS NULL THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('NULL range = unrestricted (old behaviour)','8',coalesce(_n_null::text,'-'),
    CASE WHEN _n_null = 8 THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('bars per window (tm/1m/3m/6m/ay)','monotonic, non-decreasing',
    coalesce(_n_tm::text,'-')||' / '||coalesce(_n_1m::text,'-')||' / '||coalesce(_n_3m::text,'-')
      ||' / '||coalesce(_n_6m::text,'-')||' / '||coalesce(_n_ay::text,'-'),
    CASE WHEN _n_tm <= _n_1m AND _n_1m <= _n_3m AND _n_3m <= _n_6m THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('a narrow window really is narrower','tm < ay',
    coalesce(_n_tm::text,'-')||' < '||coalesce(_n_ay::text,'-'),
    CASE WHEN _n_tm < _n_ay THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO _r VALUES ('junk range = 3m through the RPC too',coalesce(_n_3m::text,'-'),
    coalesce(_n_junk::text,'-'),
    CASE WHEN _n_junk = _n_3m THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN ('dash_range_window','dash_exam_trend')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  INSERT INTO _r VALUES ('anon cannot execute either','0',_n::text,
    CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL' END);
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN ('dash_range_window','dash_exam_trend')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  INSERT INTO _r VALUES ('authenticated still can','2',_n::text,
    CASE WHEN _n=2 THEN 'PASS' ELSE 'FAIL' END);
END $$;
SELECT check_name, want, got, verdict FROM _r;
