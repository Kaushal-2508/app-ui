-- Exercises the five blueprint RPCs as a real admin, against real data.
--
-- Read-only, so nothing needs cleaning up. Results come back as ROWS -- the
-- Management API returns an empty body on a SQL error, which makes a RAISE
-- invisible.

CREATE TEMP TABLE _d(check_name text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  _inst   uuid;
  _admin  uuid;
  _j      jsonb;
  _n      integer;
  _real_students integer;
  _real_classes  integer;
BEGIN
  SELECT id INTO _inst FROM public.institutions WHERE name = 'Salci National School';
  SELECT ur.user_id INTO _admin FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role::text IN ('school_admin','super_school_admin')
     AND p.institution_id = _inst LIMIT 1;

  INSERT INTO _d VALUES ('fixture', _inst IS NOT NULL AND _admin IS NOT NULL,
    'inst=' || coalesce(left(_inst::text,8),'-'));
  IF _inst IS NULL OR _admin IS NULL THEN RETURN; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated')::text, true);

  -- ---- 1. roster counts --------------------------------------------------
  _j := public.dash_admin_roster_counts();

  SELECT count(DISTINCT p.id) INTO _real_students
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
   WHERE p.institution_id = _inst AND p.is_active IS NOT FALSE;

  SELECT count(*) INTO _real_classes
    FROM public.classes WHERE institution_id = _inst AND is_active IS NOT FALSE;

  INSERT INTO _d VALUES
    ('roster_students_match',
     (_j->'students'->>'count')::int = _real_students,
     'rpc=' || (_j->'students'->>'count') || ' actual=' || _real_students),
    ('roster_classes_match',
     (_j->'classes'->>'count')::int = _real_classes,
     'rpc=' || (_j->'classes'->>'count') || ' actual=' || _real_classes),
    ('roster_staff_non_zero',
     (_j->'staff'->>'count')::int > 0, (_j->'staff'->>'count') || ' staff'),
    ('roster_wings_present',
     (_j->'classes'->>'wings') IS NOT NULL, (_j->'classes'->>'wings') || ' wings'),
    -- unmarked attendance must report marked=false, NOT a fake 0%
    ('roster_unmarked_is_null_not_zero',
     CASE WHEN (_j->'students_present'->>'marked')::boolean
          THEN (_j->'students_present'->>'pct') IS NOT NULL
          ELSE (_j->'students_present'->>'pct') IS NULL END,
     'marked=' || (_j->'students_present'->>'marked')
       || ' pct=' || coalesce(_j->'students_present'->>'pct','NULL'));

  -- ---- 2. portal adoption -------------------------------------------------
  _j := public.dash_student_portal_adoption();
  INSERT INTO _d VALUES
    ('adoption_total_matches_roster',
     (_j->>'total')::int = _real_students,
     'rpc=' || (_j->>'total') || ' actual=' || _real_students),
    ('adoption_never_within_total',
     (_j->>'never_signed_in')::int <= (_j->>'total')::int,
     (_j->>'never_signed_in') || ' never of ' || (_j->>'total')),
    ('adoption_active_within_total',
     (_j->>'active_30d')::int <= (_j->>'total')::int
     AND (_j->>'active_7d')::int <= (_j->>'active_30d')::int,
     '7d=' || (_j->>'active_7d') || ' 30d=' || (_j->>'active_30d')),
    ('adoption_never_list_is_array',
     jsonb_typeof(_j->'never_list') = 'array',
     jsonb_array_length(_j->'never_list') || ' listed');

  -- ---- 3. wing performance ------------------------------------------------
  SELECT count(*) INTO _n FROM public.dash_wing_performance();
  INSERT INTO _d VALUES
    ('wing_rows_match_wings',
     _n = (SELECT count(*) FROM public.wings
            WHERE institution_id=_inst AND is_active IS NOT FALSE),
     _n || ' wing rows'),
    -- no-data must be NULL, never 0: "unscored" and "scored zero" differ
    ('wing_no_data_is_null',
     NOT EXISTS (SELECT 1 FROM public.dash_wing_performance()
                  WHERE classes = 0 AND avg_pct IS NOT NULL), ''),
    ('wing_pct_in_range',
     NOT EXISTS (SELECT 1 FROM public.dash_wing_performance()
                  WHERE avg_pct IS NOT NULL AND (avg_pct < 0 OR avg_pct > 100)), '');

  -- ---- 4. attendance compliance -------------------------------------------
  SELECT count(*) INTO _n FROM public.dash_attendance_compliance(NULL, 14);
  INSERT INTO _d VALUES
    ('compliance_covers_all_classes', _n = _real_classes,
     _n || ' rows vs ' || _real_classes || ' classes'),
    -- weekdays only: 14 calendar days must not expect 14 school days
    ('compliance_expected_excludes_sundays',
     (SELECT DISTINCT days_expected FROM public.dash_attendance_compliance(NULL,14) LIMIT 1) BETWEEN 10 AND 13,
     'expected=' || (SELECT DISTINCT days_expected FROM public.dash_attendance_compliance(NULL,14) LIMIT 1)),
    ('compliance_marked_never_exceeds_expected',
     NOT EXISTS (SELECT 1 FROM public.dash_attendance_compliance(NULL,14)
                  WHERE days_marked > days_expected), ''),
    ('compliance_worst_first',
     (SELECT pct FROM public.dash_attendance_compliance(NULL,14) LIMIT 1) IS NOT DISTINCT FROM
     (SELECT min(pct) FROM public.dash_attendance_compliance(NULL,14)), 'lowest row is first');

  -- ---- 5. recent events ---------------------------------------------------
  SELECT count(*) INTO _n FROM public.dash_recent_events();
  INSERT INTO _d VALUES
    ('events_returns_without_error', true, _n || ' events'),
    ('events_upcoming_first',
     NOT EXISTS (
       SELECT 1 FROM (
         SELECT is_upcoming, row_number() OVER () AS rn
           FROM public.dash_recent_events(NULL, 30)
       ) t
       WHERE t.is_upcoming
         AND t.rn > (SELECT min(rn) FROM (
               SELECT is_upcoming, row_number() OVER () AS rn
                 FROM public.dash_recent_events(NULL, 30)) u
             WHERE NOT u.is_upcoming)), 'no past event precedes an upcoming one');

  -- ---- grants -------------------------------------------------------------
  INSERT INTO _d VALUES
    ('no_anon_grants',
     (SELECT count(*) FROM information_schema.routine_privileges
       WHERE routine_schema='public' AND grantee='anon'
         AND routine_name IN ('dash_admin_roster_counts','dash_student_portal_adoption',
                              'dash_wing_performance','dash_attendance_compliance',
                              'dash_recent_events')) = 0, '');
END $$;

SELECT check_name, ok, detail FROM _d ORDER BY check_name;
