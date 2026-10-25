-- Coordinator Console, phase 1b: the three functions that carry no wing axis.
--
-- 20260922100000 clamped every dash5_* function that already had a p_wing_id or
-- a p_class_id to argue about. These three have neither: they were written as
-- whole-school rollups. Each is edited here to ask dash5_caller_wing() who is
-- calling, exactly as the mechanical pass does, so an admin sees no change at
-- all and a coordinator sees their wing.
--
-- Each edit is applied to the LIVE definition read back from pg_get_functiondef
-- and RAISES if an anchor it expects is missing, rather than silently doing
-- nothing. A scope edit that no-ops is the failure mode that matters here: it
-- leaves the function returning the whole school to a coordinator while the
-- migration log reads as a success.
--
-- Multi-line anchors are assembled with chr(10), never written across lines in
-- this file. pg_get_functiondef returns LF-only source, so a literal that spans
-- lines here would stop matching the day anyone normalises the file to CRLF,
-- and it would stop matching silently.
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

/* ------------------------------------------------------ filter_options ---- */

-- Drives every wing / class / subject picker on the page. Left unscoped, a
-- coordinator's pickers would list the whole school and the first pick would
-- raise from dash5_scope_wing: an error where an empty list was the truth.
DO $do$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'dash5_filter_options';
  IF src IS NULL THEN RAISE EXCEPTION 'dash5_filter_options is missing'; END IF;
  src := replace(src, chr(13), '');

  src := replace(src,
    'DECLARE v_inst uuid; v_out jsonb;',
    'DECLARE v_inst uuid; v_out jsonb; v_wing uuid;');

  src := replace(src,
    'v_inst := public.dash_resolve_institution(p_institution_id);',
    'v_inst := public.dash5_resolve_institution(p_institution_id);' || chr(10) ||
    '  v_wing := public.dash5_caller_wing(v_inst);');

  -- wings: a coordinator has exactly the one
  src := replace(src,
    'WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE), ''[]''::jsonb),',
    'WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE' || chr(10) ||
    '         AND (v_wing IS NULL OR w.id = v_wing)), ''[]''::jsonb),');

  -- classes: only those mapped to it. A class mapped to no wing has wing_id
  -- NULL and is correctly excluded, because it belongs to nobody's wing.
  src := replace(src,
    'WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE), ''[]''::jsonb),',
    'WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE' || chr(10) ||
    '         AND (v_wing IS NULL OR m.wing_id = v_wing)), ''[]''::jsonb),');

  -- subjects: those actually taught in the wing's classes
  src := replace(src,
    'WHERE scm.institution_id = v_inst',
    'WHERE scm.institution_id = v_inst' || chr(10) ||
    '             AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings wm' || chr(10) ||
    '                   WHERE wm.class_id = scm.class_id AND wm.wing_id = v_wing))');

  IF position('v_wing := public.dash5_caller_wing(v_inst);' IN src) = 0
     OR position('v_wing IS NULL OR w.id = v_wing' IN src) = 0
     OR position('v_wing IS NULL OR m.wing_id = v_wing' IN src) = 0
     OR position('wm.wing_id = v_wing' IN src) = 0 THEN
    RAISE EXCEPTION 'dash5_filter_options: a scope anchor was not found';
  END IF;
  EXECUTE src;
END
$do$;

/* --------------------------------------------------- attendance_series ---- */

-- The trend line. Three things have to narrow together or the percentages lie:
-- the days a register was taken, the student roll (the denominator) and the
-- staff roll. Narrowing the numerator alone would divide the wing's present
-- students by the whole school's roll and draw the wing at 12%.
DO $do$
DECLARE src text; a text; b text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'dash5_attendance_series';
  IF src IS NULL THEN RAISE EXCEPTION 'dash5_attendance_series is missing'; END IF;
  src := replace(src, chr(13), '');

  src := replace(src,
    '  v_inst uuid; v_tz text; v_out jsonb;',
    '  v_inst uuid; v_tz text; v_out jsonb; v_wing uuid;');

  src := replace(src,
    'v_inst := public.dash_resolve_institution(p_institution_id);',
    'v_inst := public.dash5_resolve_institution(p_institution_id);' || chr(10) ||
    '  v_wing := public.dash5_caller_wing(v_inst);');

  -- the days a register was taken IN THIS WING
  a := '     WHERE ar.institution_id = v_inst' || chr(10)
    || '     ORDER BY ar.date DESC LIMIT v_n';
  b := '     WHERE ar.institution_id = v_inst' || chr(10)
    || '       AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings wm' || chr(10)
    || '             WHERE wm.class_id = ar.class_id AND wm.wing_id = v_wing))' || chr(10)
    || '     ORDER BY ar.date DESC LIMIT v_n';
  IF position(a IN src) = 0 THEN
    RAISE EXCEPTION 'dash5_attendance_series: the register-days anchor was not found';
  END IF;
  src := replace(src, a, b);

  -- the student roll: the canonical roster, narrowed to the wing's classes
  a := '      JOIN profiles p ON p.id = s.student_id';
  b := '      JOIN profiles p ON p.id = s.student_id' || chr(10)
    || '     WHERE v_wing IS NULL OR EXISTS (SELECT 1 FROM class_assignments ca' || chr(10)
    || '             JOIN wing_class_mappings wm ON wm.class_id = ca.class_id' || chr(10)
    || '                                        AND wm.wing_id = v_wing' || chr(10)
    || '            WHERE ca.user_id = s.student_id AND ca.role::text = ''student'')';
  IF position(a IN src) = 0 THEN
    RAISE EXCEPTION 'dash5_attendance_series: the student-roll anchor was not found';
  END IF;
  src := replace(src, a, b);

  -- the staff roll: teachers who actually take a class in the wing
  a := '       AND ur.role::text = ''teacher''';
  b := '       AND ur.role::text = ''teacher''' || chr(10)
    || '       AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM class_assignments ca' || chr(10)
    || '             JOIN wing_class_mappings wm ON wm.class_id = ca.class_id' || chr(10)
    || '                                        AND wm.wing_id = v_wing' || chr(10)
    || '            WHERE ca.user_id = p.id AND ca.role::text = ''teacher''))';
  IF position(a IN src) = 0 THEN
    RAISE EXCEPTION 'dash5_attendance_series: the staff-roll anchor was not found';
  END IF;
  src := replace(src, a, b);

  IF position('v_wing := public.dash5_caller_wing(v_inst);' IN src) = 0 THEN
    RAISE EXCEPTION 'dash5_attendance_series: the resolver anchor was not found';
  END IF;
  EXECUTE src;
END
$do$;

/* -------------------------------------------------------- needs_by_wing --- */

-- Already partitioned by wing internally, so the honest edit is to drop the
-- other wings from the result rather than to re-derive it. A coordinator's call
-- therefore computes the whole school and returns one row of it: about a second
-- of work discarded, once per page load behind a 60s staleTime. Pushing the
-- wing down through its six CTEs would buy that second at the price of a second
-- implementation of the same rollup to keep in step, which is exactly how this
-- dashboard's KPI and the table under it disagreed once before.
DO $do$
DECLARE src text; a text; b text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'dash5_needs_by_wing';
  IF src IS NULL THEN RAISE EXCEPTION 'dash5_needs_by_wing is missing'; END IF;
  src := replace(src, chr(13), '');

  src := replace(src,
    '  v_inst uuid; v_out jsonb; v_pace numeric;',
    '  v_inst uuid; v_out jsonb; v_pace numeric; v_wing uuid;');

  src := replace(src,
    'v_inst := public.dash_resolve_institution(p_institution_id);',
    'v_inst := public.dash5_resolve_institution(p_institution_id);' || chr(10) ||
    '  v_wing := public.dash5_caller_wing(v_inst);');

  -- `total` is recomputed from the rows that survive, never carried over: the
  -- card prints it beside the list, and "14 items" above one wing's four is the
  -- kind of mismatch that makes a principal stop trusting the page.
  a := '  RETURN v_out;' || chr(10) || 'END';
  b := '  IF v_wing IS NOT NULL THEN' || chr(10)
    || '    v_out := jsonb_set(v_out, ''{wings}'', COALESCE((' || chr(10)
    || '      SELECT jsonb_agg(e) FROM jsonb_array_elements(v_out->''wings'') e' || chr(10)
    || '       WHERE (e->>''wing_id'')::uuid = v_wing), ''[]''::jsonb));' || chr(10)
    || '    v_out := jsonb_set(v_out, ''{total}'', to_jsonb(COALESCE((' || chr(10)
    || '      SELECT sum((e->>''count'')::int)::int' || chr(10)
    || '        FROM jsonb_array_elements(v_out->''wings'') e), 0)));' || chr(10)
    || '  END IF;' || chr(10) || chr(10)
    || '  RETURN v_out;' || chr(10) || 'END';
  IF position(a IN src) = 0 THEN
    RAISE EXCEPTION 'dash5_needs_by_wing: the return anchor was not found';
  END IF;
  src := replace(src, a, b);

  IF position('v_wing := public.dash5_caller_wing(v_inst);' IN src) = 0 THEN
    RAISE EXCEPTION 'dash5_needs_by_wing: the resolver anchor was not found';
  END IF;
  EXECUTE src;
END
$do$;
