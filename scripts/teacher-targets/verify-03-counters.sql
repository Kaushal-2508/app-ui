DO $$
DECLARE
  r record;
  n int;
  v_teacher uuid;
  v_institution uuid;
  v_expected int;
  v_actual int;
BEGIN
  -- RENAME (fixed 2026-09-15, before Task 4 ships): these four functions were
  -- originally named tt_target_interval, tt_target_periods,
  -- tt_count_exams_published, tt_count_homework_published. `tt_` is already
  -- the Timetable module's namespace and CLAUDE.md 7 routes any `tt_*` match
  -- to the `timetable-module` skill, so a future agent opening one of these
  -- would load the wrong subsystem's context. Renamed to tgt_interval /
  -- tgt_periods / tgt_count_exams_published / tgt_count_homework_published;
  -- this script checks the new names only - the old ones must no longer
  -- exist at all (checked further down).
  --
  -- STRENGTHENED (lesson from verify-01/verify-02 reviews): name-only existence
  -- checks (pg_proc.proname alone) would still PASS for a same-named function
  -- with the wrong argument list, return type or volatility. Pin identity via
  -- pg_get_function_identity_arguments()/pg_get_function_result() and the
  -- documented volatility/SECURITY DEFINER flags for every object this
  -- migration is supposed to create, not just tgt_periods.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname='public' AND p.proname='tgt_interval'
      AND pg_get_function_identity_arguments(p.oid) = '_unit text, _n integer'
      AND p.prorettype = 'interval'::regtype
      AND p.provolatile = 'i'          -- IMMUTABLE
      AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_interval(text, integer) is missing, or is not an IMMUTABLE function returning interval';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname='public' AND p.proname='tgt_periods'
      AND pg_get_function_identity_arguments(p.oid)
          = '_starts_on date, _ends_on date, _unit text, _n integer, _upto date'
      AND pg_get_function_result(p.oid)
          = 'TABLE(period_index integer, period_start date, period_end date)'
      AND p.provolatile = 'i'          -- IMMUTABLE
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_periods is missing, or does not have the documented (date,date,text,integer,date) -> TABLE(period_index integer, period_start date, period_end date) signature at IMMUTABLE volatility';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname='public' AND p.proname='tgt_count_exams_published'
      AND pg_get_function_identity_arguments(p.oid)
          = '_teacher uuid, _institution uuid, _from date, _to date'
      AND p.prorettype = 'integer'::regtype
      AND p.provolatile = 's'          -- STABLE
      AND p.prosecdef                  -- SECURITY DEFINER
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_count_exams_published(uuid, uuid, date, date) is missing, or is not a STABLE SECURITY DEFINER function returning integer';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname='public' AND p.proname='tgt_count_homework_published'
      AND pg_get_function_identity_arguments(p.oid)
          = '_teacher uuid, _institution uuid, _from date, _to date, _tz text'
      AND p.prorettype = 'integer'::regtype
      AND p.provolatile = 's'          -- STABLE
      AND p.prosecdef                  -- SECURITY DEFINER
  ) THEN
    RAISE EXCEPTION 'FAIL: tgt_count_homework_published(uuid, uuid, date, date, text) is missing, or is not a STABLE SECURITY DEFINER function returning integer';
  END IF;

  -- The rename must have actually DROPPED the old tt_-named functions, not
  -- just added new ones alongside them - a stale duplicate with the old name
  -- and the old grants is exactly the kind of thing that gets called by
  -- accident later.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('tt_target_interval','tt_target_periods',
                        'tt_count_exams_published','tt_count_homework_published')
  ) THEN
    RAISE EXCEPTION 'FAIL: an old tt_-named function (tt_target_interval / tt_target_periods / tt_count_exams_published / tt_count_homework_published) still exists - the rename to tgt_ must DROP the old function, not merely add the new one alongside it';
  END IF;

  -- indexname alone would still PASS for a rebuilt index on the wrong columns;
  -- check indexdef for the exact (created_by, status) pair (same pattern as
  -- verify-01's idx_homework_assignments_creator_published check).
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='exams' AND indexname='idx_exams_created_by_status'
      AND indexdef LIKE '%(created_by, status)%'
  ) THEN
    RAISE EXCEPTION 'FAIL: idx_exams_created_by_status is missing or does not index (created_by, status)';
  END IF;

  -- Rolling from day 1: weekly from 15 Sep gives 15-21, 22-28, ...
  SELECT count(*) INTO n
  FROM public.tgt_periods('2026-09-15','2026-10-12','week',1,'2026-10-12');
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL: weekly 15 Sep to 12 Oct gave % periods, expected 4', n; END IF;

  SELECT * INTO r FROM public.tgt_periods('2026-09-15','2026-10-12','week',1,'2026-10-12')
   WHERE period_index = 1;
  IF r.period_start <> DATE '2026-09-15' OR r.period_end <> DATE '2026-09-21' THEN
    RAISE EXCEPTION 'FAIL: period 1 was % to %, expected 2026-09-15 to 2026-09-21',
      r.period_start, r.period_end;
  END IF;

  -- 15-day cadence is the case no calendar-aligned engine can express.
  SELECT * INTO r FROM public.tgt_periods('2026-09-15','2026-10-14','day',15,'2026-10-14')
   WHERE period_index = 2;
  IF r.period_start <> DATE '2026-09-30' THEN
    RAISE EXCEPTION 'FAIL: 15-day period 2 started %, expected 2026-09-30', r.period_start;
  END IF;

  -- The final period is CLIPPED at ends_on, never allowed to run past it.
  SELECT max(period_end) INTO r FROM public.tgt_periods('2026-09-15','2026-10-10','month',1,'2026-12-31');
  IF r.max > DATE '2026-10-10' THEN
    RAISE EXCEPTION 'FAIL: last period ran past ends_on';
  END IF;

  -- A one-off (no cadence) is exactly one period spanning the whole range.
  SELECT count(*) INTO n FROM public.tgt_periods('2026-09-01','2026-09-30',NULL,NULL,'2026-09-30');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: one-off gave % periods, expected 1', n; END IF;

  -- STRENGTHENED: the exact month-clamp contract Task 8's TypeScript
  -- reimplementation must match. Postgres clamps 31 Jan + 1 month to 28 Feb
  -- (2026 is not a leap year), so period 1's end (the day before period 2's
  -- clamped start) must be 27 Feb, not run into March.
  SELECT * INTO r FROM public.tgt_periods('2026-01-31','2026-04-30','month',1,'2026-04-30')
   WHERE period_index = 1;
  IF r.period_end <> DATE '2026-02-27' THEN
    RAISE EXCEPTION 'FAIL: 31 Jan + 1 month period ended %, expected 2026-02-27 (Postgres clamps 31 Jan + 1 month to 28 Feb, so period 1 ends the day before)', r.period_end;
  END IF;
  SELECT * INTO r FROM public.tgt_periods('2026-01-31','2026-04-30','month',1,'2026-04-30')
   WHERE period_index = 2;
  IF r.period_start <> DATE '2026-02-28' THEN
    RAISE EXCEPTION 'FAIL: 31 Jan + 1 month period 2 started %, expected clamped 2026-02-28', r.period_start;
  END IF;

  -- FIX (review round 2, 2026-09-15): the two checks immediately above (period
  -- 1 end, period 2 start) do NOT distinguish the fresh-from-anchor contract
  -- this function implements from a chained implementation that repeatedly
  -- adds one interval to the PREVIOUS period's already-clamped boundary -
  -- both algorithms produce IDENTICAL values there, because only one interval
  -- step has been applied by that point (Jan 31 + 1 month = Feb 28 either
  -- way). The two algorithms first disagree at period 2's END and period 3's
  -- START: fresh-from-anchor computes period 3's start as
  -- _starts_on + 2*interval = 2026-01-31 + 2 months = 2026-03-31 (day 31
  -- carried straight through, since March has 31 days - no clamp needed); a
  -- chained implementation computes it as period 2's clamped start (Feb 28)
  -- plus one more month = 2026-03-28 instead. A future "tidy-up" that
  -- simplifies the loop from `_starts_on + (v_i-1)*v_iv` to a running
  -- `v_s := v_s + v_iv` would still pass every assertion above and only be
  -- caught here. If this pair of checks fails while the two above still pass,
  -- that IS the bug: the loop stopped computing fresh from the anchor.
  IF r.period_end <> DATE '2026-03-30' THEN
    RAISE EXCEPTION 'FAIL: 31 Jan + 1 month period 2 ended %, expected 2026-03-30 (fresh-from-anchor: 2026-01-31 + 2 months - 1 day); 2026-03-27 would mean the loop is chaining from period 2''s clamped start instead', r.period_end;
  END IF;
  SELECT * INTO r FROM public.tgt_periods('2026-01-31','2026-04-30','month',1,'2026-04-30')
   WHERE period_index = 3;
  IF r.period_start <> DATE '2026-03-31' THEN
    RAISE EXCEPTION 'FAIL: 31 Jan + 1 month period 3 started %, expected 2026-03-31 (fresh-from-anchor: 2026-01-31 + 2 months, day 31 carried through since March has 31 days); 2026-03-28 would mean the loop is chaining from period 2''s clamped start (2026-02-28) instead of the original anchor', r.period_start;
  END IF;

  -- STRENGTHENED: the 500-period safety cap must actually bound a long daily
  -- range rather than being dead code.
  SELECT count(*) INTO n FROM public.tgt_periods('2020-01-01','2026-09-15','day',1,'2026-09-15');
  IF n <> 500 THEN
    RAISE EXCEPTION 'FAIL: the 500-period safety cap did not bound a long daily range (got % periods, expected 500)', n;
  END IF;

  -- STRENGTHENED: behavioral proof for the two counters against real rows,
  -- not just their existence. Read-only (no INSERT/rollback needed): find a
  -- teacher who already has at least one row the function is supposed to
  -- count, independently compute the expected count with the exact predicate
  -- documented in the migration, and require the function to agree AND the
  -- expected count to be nonzero (count(*)-first, so an empty database FAILS
  -- loudly instead of vacuously matching 0 = 0).
  SELECT e.created_by, e.institution_id INTO v_teacher, v_institution
  FROM public.exams e
  WHERE e.status IN ('published','active','completed')
  GROUP BY e.created_by, e.institution_id
  LIMIT 1;

  IF v_teacher IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify tgt_count_exams_published - no published/active/completed exam exists in this database to test against; the assertion was SKIPPED, not satisfied';
  END IF;

  SELECT count(*)::int INTO v_expected
  FROM public.exams e
  WHERE e.created_by = v_teacher AND e.institution_id = v_institution
    AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
        BETWEEN DATE '1900-01-01' AND DATE '2100-01-01';

  SELECT public.tgt_count_exams_published(v_teacher, v_institution, DATE '1900-01-01', DATE '2100-01-01')
    INTO v_actual;

  IF v_expected = 0 THEN
    RAISE EXCEPTION 'FAIL: expected-count probe for tgt_count_exams_published found 0 rows even though a matching exam was located; the test is broken, not the function';
  END IF;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'FAIL: tgt_count_exams_published returned % but a direct count of the same rows is %', v_actual, v_expected;
  END IF;

  v_teacher := NULL; v_institution := NULL;
  SELECT h.created_by, h.institution_id INTO v_teacher, v_institution
  FROM public.homework_assignments h
  WHERE h.status IN ('published','checked') AND h.published_at IS NOT NULL
  GROUP BY h.created_by, h.institution_id
  LIMIT 1;

  IF v_teacher IS NULL THEN
    RAISE EXCEPTION 'FAIL: cannot verify tgt_count_homework_published - no published/checked homework with a published_at exists in this database to test against; the assertion was SKIPPED, not satisfied';
  END IF;

  SELECT count(*)::int INTO v_expected
  FROM public.homework_assignments h
  WHERE h.created_by = v_teacher AND h.institution_id = v_institution
    AND h.status IN ('published','checked')
    AND h.published_at IS NOT NULL
    AND h.published_at >= (DATE '1900-01-01'::timestamp AT TIME ZONE 'Asia/Kolkata')
    AND h.published_at <  ((DATE '2100-01-01' + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');

  SELECT public.tgt_count_homework_published(v_teacher, v_institution, DATE '1900-01-01', DATE '2100-01-01', 'Asia/Kolkata')
    INTO v_actual;

  IF v_expected = 0 THEN
    RAISE EXCEPTION 'FAIL: expected-count probe for tgt_count_homework_published found 0 rows even though a matching homework was located; the test is broken, not the function';
  END IF;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'FAIL: tgt_count_homework_published returned % but a direct count of the same rows is %', v_actual, v_expected;
  END IF;

  -- STRENGTHENED (post-review, 2026-09-15): the coordinator's fix closed a
  -- live cross-tenant leak - the original REVOKE list omitted `authenticated`,
  -- which Supabase grants by default on every new public function, leaving
  -- tgt_count_exams_published / tgt_count_homework_published (SECURITY DEFINER,
  -- no caller-identity check on `_teacher`/`_institution`) directly callable
  -- by any signed-in user for any teacher/institution. Prove that hole is
  -- closed, while tgt_periods (pure date arithmetic over caller-supplied
  -- inputs, no table read, no leak) keeps its authenticated grant.
  --
  -- Non-vacuous the way verify-02's coordinator-population check is: first
  -- confirm the privilege catalog actually has rows for these 4 functions at
  -- all (every function always carries at least an owner/service_role-style
  -- grant), so a typo'd function name or wrong schema can't make the negative
  -- checks below pass by finding nothing to examine.
  SELECT count(*) INTO n
  FROM information_schema.routine_privileges
  WHERE routine_schema='public'
    AND routine_name IN ('tgt_interval','tgt_periods',
                         'tgt_count_exams_published','tgt_count_homework_published');
  IF n = 0 THEN
    RAISE EXCEPTION 'FAIL: information_schema.routine_privileges has no rows at all for the 4 tgt_ functions this migration creates - the grant checks below would pass vacuously, not because the grants are actually correct';
  END IF;

  -- tgt_periods is the one function clients ARE meant to call directly
  -- (Task 8's UI preview needs server-truth period boundaries): it must have
  -- authenticated, and must not have anon/PUBLIC.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema='public' AND routine_name='tgt_periods'
      AND grantee='authenticated' AND privilege_type='EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated lacks EXECUTE on tgt_periods - clients need server-truth period boundaries';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema='public' AND routine_name='tgt_periods'
      AND grantee IN ('anon','PUBLIC')
  ) THEN
    RAISE EXCEPTION 'FAIL: anon or PUBLIC holds EXECUTE on tgt_periods';
  END IF;

  -- tgt_interval / tgt_count_exams_published / tgt_count_homework_published
  -- are server-only: no client (anon, PUBLIC, or authenticated) may hold
  -- EXECUTE. Scoped to an explicit function list. These names no longer share
  -- the `tt_` prefix at all (that was the whole point of the rename), so a
  -- `LIKE 'tgt_%'` wildcard would be safe today - but an explicit list still
  -- checks identity, not name-shape, and costs nothing. For context: the
  -- OLD `tt_` names would have collided with ~20 pre-existing Timetable-module
  -- functions (tt_assign_substitute, tt_set_publish_status,
  -- tt_lesson_plan_export, etc.) that still carry anon/PUBLIC EXECUTE - that
  -- is standing debt tracked separately in security-audit-2026-07-07.md, from
  -- well before this feature existed, NOT something this module introduced or
  -- is responsible for fixing.
  IF EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE routine_schema='public'
      AND routine_name IN ('tgt_interval','tgt_count_exams_published','tgt_count_homework_published')
      AND grantee IN ('anon','PUBLIC','authenticated')
  ) THEN
    RAISE EXCEPTION 'FAIL: anon, PUBLIC, or authenticated holds EXECUTE on tgt_interval / tgt_count_exams_published / tgt_count_homework_published - these are server-only (SECURITY DEFINER with no caller-identity check; Task 6''s evaluator runs as their own definer, so no client grant is ever needed)';
  END IF;

  RAISE NOTICE 'PASS: verify-03 counters';
END $$;
