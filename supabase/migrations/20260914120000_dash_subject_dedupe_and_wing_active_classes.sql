-- Two Command Center cards were reporting shapes the school does not recognise.
-- Found by replaying every dash_* RPC as a real Alliance admin (1,545 students,
-- 53 active classes) instead of against the demo seed, where neither shows.
--
-- 1. "Subjects by performance" listed 152 rows for a school that teaches ~39
--    subjects. `universal_subjects` carries one row per subject PER GRADE, so
--    Alliance holds 16 rows named Punjabi, 13 English, 11 Mathematics. Grouping
--    on us.id therefore ranked grade-slices, not subjects: the top of the list
--    was whichever slice had the fewest results, and the card offered "Load more
--    subjects (146 left)". The heatmap already dedupes on
--    initcap(lower(btrim(name))); this applies the same key.
--
-- 2. "Coordinators by wing performance" said 42 + 18 + 18 + 29 = 107 classes on
--    a page whose roster tile said 53. wing_class_mappings still maps archived
--    sections (Alliance: 113 classes, 53 active), and the count included them.
--    Verified against prod: restricting to active classes changes ONLY the
--    count -- the four student counts and all four averages are identical
--    before and after, because every student of an archived section is also on
--    an active one.
--
-- Neither signature changes, so src/integrations/supabase/types.ts is unaffected
-- and CREATE OR REPLACE preserves the existing grants (verified via pg_proc.proacl).

/* ------------------------------------------------------------------ 1 ------ */

CREATE OR REPLACE FUNCTION public.dash_school_subject_performance(
  p_institution_id uuid DEFAULT NULL
)
RETURNS TABLE(subject_id uuid, subject_name text, school_avg numeric, results integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  WITH res AS (
    SELECT us.id                              AS us_id,
           btrim(us.name)                     AS raw_name,
           initcap(lower(btrim(us.name)))     AS norm_name,
           fr.percentage                      AS pct
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
      JOIN exam_subjects es ON es.exam_id = e.id
      JOIN universal_subjects us ON us.id = es.subject_id
     WHERE e.institution_id = v_inst
       AND e.status IN ('published','active','completed')
       AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
           BETWEEN v_ay_start AND v_ay_end
  ),
  per_row AS (
    SELECT norm_name, us_id, min(raw_name) AS raw_name, count(*) AS n
      FROM res
     GROUP BY norm_name, us_id
  ),
  -- The merged row still has to link somewhere, and the detail page keys on one
  -- universal_subjects id. The slice carrying the most results is the closest
  -- thing to "the" subject; today the link lands on whichever slice sorted
  -- first, which is by construction the smallest and least representative.
  pick AS (
    SELECT DISTINCT ON (norm_name) norm_name, us_id, raw_name
      FROM per_row
     ORDER BY norm_name, n DESC, us_id
  )
  SELECT pick.us_id,
         pick.raw_name,
         round(avg(res.pct), 1),
         count(*)::int
    FROM res
    JOIN pick ON pick.norm_name = res.norm_name
   GROUP BY pick.us_id, pick.raw_name
   ORDER BY 3 ASC, 2;
END
$function$;

/* ------------------------------------------------------------------ 2 ------ */

CREATE OR REPLACE FUNCTION public.dash_wing_performance(
  p_institution_id uuid DEFAULT NULL
)
RETURNS TABLE(
  wing_id uuid, wing_name text, coordinators text,
  classes integer, students integer, avg_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  RETURN QUERY
  WITH roster AS (
    -- The one definition of a student (CLAUDE.md, canonical roster). Never
    -- hand-count class_assignments here again.
    SELECT student_id FROM public.institution_student_ids(v_inst)
  ),
  wc AS (
    -- Active sections only. wing_class_mappings outlives a section, so an
    -- archived class stays mapped forever and used to be counted forever.
    SELECT m.wing_id AS w_id, m.class_id AS c_id
      FROM wing_class_mappings m
      JOIN wings w2 ON w2.id = m.wing_id AND w2.institution_id = v_inst
      JOIN classes c ON c.id = m.class_id AND c.is_active IS NOT FALSE
  )
  SELECT w.id,
         w.name,
         (SELECT string_agg(coalesce(p.full_name, p.email), ', ')
            FROM wing_assignments wa
            JOIN profiles p ON p.id = wa.user_id
            JOIN user_roles ur ON ur.user_id = p.id AND ur.role::text = 'coordinator'
           WHERE wa.wing_id = w.id AND p.is_active IS NOT FALSE),
         (SELECT count(*)::int FROM wc WHERE wc.w_id = w.id),
         (SELECT count(DISTINCT ca.user_id)::int
            FROM wc
            JOIN class_assignments ca ON ca.class_id = wc.c_id AND ca.role::text = 'student'
            JOIN roster r ON r.student_id = ca.user_id
           WHERE wc.w_id = w.id),
         (SELECT round(avg(fr.percentage), 1)
            FROM wc
            JOIN class_assignments ca ON ca.class_id = wc.c_id AND ca.role::text = 'student'
            JOIN student_exam_attempts a ON a.student_id = ca.user_id
            JOIN final_results fr ON fr.attempt_id = a.id
            JOIN exams e ON e.id = a.exam_id
           WHERE wc.w_id = w.id
             AND e.institution_id = v_inst
             AND e.status IN ('published','active','completed')
             AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
                 BETWEEN v_ay_start AND v_ay_end)
    FROM wings w
   WHERE w.institution_id = v_inst AND w.is_active IS NOT FALSE
   ORDER BY 6 ASC NULLS LAST, w.name;
END
$function$;

-- Supabase's default privileges hand EXECUTE to anon on every new function, and
-- REVOKE FROM PUBLIC does not strip it. CREATE OR REPLACE keeps the existing
-- ACL, but state it explicitly so a future CREATE (not REPLACE) cannot widen it.
REVOKE EXECUTE ON FUNCTION public.dash_school_subject_performance(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dash_wing_performance(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash_school_subject_performance(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.dash_wing_performance(uuid) TO authenticated, service_role;
