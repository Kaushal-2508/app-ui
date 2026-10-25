-- dash5_tree_targets: stop re-running the per-teacher publication counts per map row
-- (Command Center tree + Coordinator Console tree, the "Papers conducted" /
-- "Homework" target columns). Applied to prod 2026-09-23 via scripts/run-sql.ps1.
--
-- CAUSE. The "yr" CTE (tgt_count_exams_published + tgt_count_homework_published
-- for every teacher) is referenced once, so Postgres inlined it into "joined".
-- "map" is estimated at 1 row (class_assignments.role::text = 'teacher' defeats
-- the stats; actual 119 rows at Alliance wings level), so the planner put the
-- inlined yr subquery on the INNER side of a Nested Loop Left Join with no
-- Materialize node and rescanned it once per map row. Every rescan re-evaluated
-- both SECURITY DEFINER SQL functions for each teacher it walked past:
--   Subquery Scan on u ... rows=41 loops=119, Rows Removed by Join Filter: 4722
--   Buffers: shared hit=856694 of 859015 for the whole statement
-- i.e. ~4,841 calls of each function instead of 86.
--
-- FIX. yr is AS MATERIALIZED, so each teacher is counted exactly once, and it
-- only counts teachers that can reach a row (joined already drops NULL row_ids,
-- so the dropped teachers never contributed). map / per_teacher / joined were
-- already materialized implicitly (referenced more than once); the keyword is
-- now explicit so a later edit cannot silently inline them. Nothing else moved:
-- same signature, return shape, SECURITY DEFINER, STABLE, search_path, plpgsql,
-- same tgt_* calls (Teacher Targets stays the single source of the counting
-- rules), same wing/class clamping. CREATE OR REPLACE keeps the existing ACL
-- (EXECUTE: authenticated, service_role, postgres; not anon).
--
-- MEASURED on prod 2026-09-23 (pg_temp candidate, BEGIN..ROLLBACK):
--   Alliance admin, wings           1648 ms / 2177 ms  ->  82 ms (cold) ; EXPLAIN body 1755 -> 65.7 ms
--   Alliance coord Middle, wings    2199 ms            ->  57 ms
--   Alliance coord Senior, wings    2139 ms            ->  54 ms
--   Alliance coord Middle, classes   590 ms            ->  17 ms   (coordinator's default view)
--   Alliance coord Senior, classes  1236 ms            ->  22 ms
--   Alliance admin, classes Senior  1299 ms            ->  20 ms
--   Salci National admin, wings      205 ms            ->  20 ms
-- Output md5-identical in all 54 scenarios run (Alliance admin + both
-- coordinators, Salci National admin + both coordinators, Vidyabodhini admin +
-- both coordinators; wings / classes with and without a wing / subjects with a
-- class / subjects with no class / unknown level; and every refusal: other
-- wing, other wing's class, class of another school, another institution).
--
-- KNOWN, DELIBERATELY UNCHANGED: at level 'wings' the map CTE ignores p_wing_id,
-- so a coordinator calling the RPC directly with p_level='wings' receives every
-- wing's row and the whole-school total, exactly like an admin. The UI never
-- asks for it (a coordinator's tree starts at 'classes' inside their wing), but
-- it is outside the dash5_caller_wing() contract and should be fixed on its own.

CREATE OR REPLACE FUNCTION public.dash5_tree_targets(p_level text DEFAULT 'wings'::text, p_wing_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid, p_institution_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_level text; v_out jsonb;
BEGIN
  v_inst := public.dash5_resolve_institution(p_institution_id);
  p_wing_id := public.dash5_scope_wing(v_inst, p_wing_id);
  p_class_id := public.dash5_scope_class(v_inst, p_class_id, false);
  v_level := CASE WHEN p_level IN ('wings','classes','subjects') THEN p_level ELSE 'wings' END;

  IF p_class_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dash5: class not in institution';
  END IF;

  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end
    FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today + INTERVAL '1 day')::date;

  WITH
  -- Every live teacher target, with its current period resolved. A target whose
  -- window does not contain today has no open period and drops out here.
  tg AS (
    SELECT t.owner_id AS teacher_id, t.metric,
           (op->>'target_value')::int   AS target_value,
           (op->>'achieved_value')::int AS achieved_value,
           (op->>'period_start')::date  AS period_start,
           (op->>'period_end')::date    AS period_end
      FROM teacher_targets t
      CROSS JOIN LATERAL public.tgt_open_period(t.id) op
     WHERE t.institution_id = v_inst
       AND t.scope = 'teacher'
       AND t.status = 'active'
       AND op IS NOT NULL
  ),
  -- One row per teacher per metric. A teacher holding two live targets on the
  -- same metric (an admin direct one plus a wing split) is a case the targets
  -- feature deliberately allows, so both are summed rather than one picked.
  per_teacher AS MATERIALIZED (
    SELECT teacher_id, metric,
           sum(target_value)::int   AS target_value,
           sum(achieved_value)::int AS achieved_value,
           min(period_start)        AS period_start,
           max(period_end)          AS period_end
      FROM tg GROUP BY 1, 2
  ),
  -- Which teachers belong to which row at the level being drawn.
  map AS MATERIALIZED (
    SELECT DISTINCT
           CASE v_level
             WHEN 'wings'    THEN m.wing_id
             WHEN 'classes'  THEN ca.class_id
             ELSE ca.subject_id
           END AS row_id,
           ca.user_id AS teacher_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id
                    AND c.institution_id = v_inst
                    AND c.is_active IS NOT FALSE
      LEFT JOIN wing_class_mappings m ON m.class_id = ca.class_id
     WHERE ca.role::text = 'teacher'
       AND (v_level <> 'classes'  OR p_wing_id IS NULL OR m.wing_id = p_wing_id)
       AND (v_level <> 'subjects' OR ca.class_id = p_class_id)
       AND (v_level <> 'subjects' OR ca.subject_id IS NOT NULL)
  ),
  -- Fallback numerator: this year's publications, for a teacher with no target.
  -- MATERIALIZED is load-bearing (2026-09-23). Referenced once, this CTE used
  -- to be inlined into "joined"; the planner estimates "map" at 1 row, so it
  -- put the inlined subquery on the inner side of a nested loop and rescanned
  -- it for every map row, re-running both tgt_count_* calls per rescan.
  -- Alliance, wings level: 119 rescans, ~4,800 calls of each function instead
  -- of 86, 1.65s. Materialized, each teacher is counted exactly once. Only
  -- teachers that can reach a row are counted: "joined" drops NULL row_ids,
  -- so a teacher seen only there never contributed anything.
  yr AS MATERIALIZED (
    SELECT u.teacher_id,
           public.tgt_count_exams_published(u.teacher_id, v_inst, v_ay_start, v_today) AS exams_ytd,
           public.tgt_count_homework_published(u.teacher_id, v_inst, v_ay_start, v_today, v_tz) AS hw_ytd
      FROM (SELECT DISTINCT map.teacher_id FROM map WHERE map.row_id IS NOT NULL) u
  ),
  joined AS MATERIALIZED (
    SELECT map.row_id, map.teacher_id,
           COALESCE(e.target_value, 0)   AS e_target,
           COALESCE(e.achieved_value, 0) AS e_done,
           COALESCE(h.target_value, 0)   AS h_target,
           COALESCE(h.achieved_value, 0) AS h_done,
           (e.teacher_id IS NOT NULL)    AS e_has,
           (h.teacher_id IS NOT NULL)    AS h_has,
           yr.exams_ytd, yr.hw_ytd
      FROM map
      LEFT JOIN per_teacher e ON e.teacher_id = map.teacher_id AND e.metric = 'exams_published'
      LEFT JOIN per_teacher h ON h.teacher_id = map.teacher_id AND h.metric = 'homework_published'
      LEFT JOIN yr ON yr.teacher_id = map.teacher_id
     WHERE map.row_id IS NOT NULL
  ),
  -- Each teacher counted ONCE per row, even when they teach the row twice.
  agg AS (
    SELECT j.row_id,
           sum(j.e_target)::int e_target,
           -- With a target, the period figure. Without one, the year's total,
           -- which is what "done / 0" is meant to say.
           sum(CASE WHEN j.e_has THEN j.e_done ELSE COALESCE(j.exams_ytd, 0) END)::int e_done,
           sum(j.h_target)::int h_target,
           sum(CASE WHEN j.h_has THEN j.h_done ELSE COALESCE(j.hw_ytd, 0) END)::int h_done,
           count(*) FILTER (WHERE j.e_has)::int e_teachers,
           count(*) FILTER (WHERE j.h_has)::int h_teachers,
           -- Always carried, target or not, so the cell can keep a sense of
           -- scale on its second line either way.
           sum(COALESCE(j.exams_ytd, 0))::int e_ytd,
           sum(COALESCE(j.hw_ytd, 0))::int h_ytd,
           count(*)::int teachers
      FROM joined j GROUP BY 1
  ),
  -- The footer counts every teacher in scope exactly once, so it is NOT the
  -- sum of the rows above it whenever a teacher appears in more than one.
  tot AS (
    SELECT sum(z.e_target)::int e_target, sum(z.e_done)::int e_done,
           sum(z.h_target)::int h_target, sum(z.h_done)::int h_done,
           sum(z.e_ytd)::int e_ytd, sum(z.h_ytd)::int h_ytd,
           count(*) FILTER (WHERE z.e_has)::int e_teachers,
           count(*) FILTER (WHERE z.h_has)::int h_teachers,
           count(*)::int teachers
      FROM (
        SELECT DISTINCT ON (j.teacher_id)
               j.teacher_id, j.e_target, j.h_target, j.e_has, j.h_has,
               COALESCE(j.exams_ytd, 0) e_ytd, COALESCE(j.hw_ytd, 0) h_ytd,
               CASE WHEN j.e_has THEN j.e_done ELSE COALESCE(j.exams_ytd, 0) END e_done,
               CASE WHEN j.h_has THEN j.h_done ELSE COALESCE(j.hw_ytd, 0) END h_done
          FROM joined j ORDER BY j.teacher_id
      ) z
  )
  SELECT jsonb_build_object(
    'level', v_level,
    'has_targets', (SELECT count(*) > 0 FROM per_teacher),
    'period', (SELECT jsonb_build_object('start', min(period_start), 'end', max(period_end))
                 FROM per_teacher),
    'rows', COALESCE((
      SELECT jsonb_object_agg(a.row_id::text, jsonb_build_object(
               'exams', jsonb_build_object('done', a.e_done, 'target', a.e_target,
                                           'ytd', a.e_ytd, 'teachers', a.e_teachers),
               'homework', jsonb_build_object('done', a.h_done, 'target', a.h_target,
                                              'ytd', a.h_ytd, 'teachers', a.h_teachers),
               'teachers', a.teachers))
        FROM agg a), '{}'::jsonb),
    'total', COALESCE((
      SELECT jsonb_build_object(
               'exams', jsonb_build_object('done', t.e_done, 'target', t.e_target,
                                           'ytd', t.e_ytd, 'teachers', t.e_teachers),
               'homework', jsonb_build_object('done', t.h_done, 'target', t.h_target,
                                              'ytd', t.h_ytd, 'teachers', t.h_teachers),
               'teachers', t.teachers)
        FROM tot t), '{}'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;
