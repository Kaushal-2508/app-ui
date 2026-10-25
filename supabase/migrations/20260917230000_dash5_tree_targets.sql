-- Admin Dashboard v5: the Teacher Targets denominator for the performance tree.
--
-- The "Papers conducted" and "Homework submitted" columns used a denominator the
-- dashboard invented for itself. There is a real one now: the Teacher Targets
-- feature (teacher_targets, shipped 2026-09-17).
--
-- HOW TARGETS ACTUALLY WORK, because the mapping is not obvious:
--   * `scope` is only 'wing' or 'teacher'. There is NO class target and NO
--     subject target.
--   * A wing target is a POOL owned by one coordinator. It carries no progress
--     of its own; the coordinator splits it into teacher targets, and those
--     children are where achievement is counted.
--   * A teacher target is ONE TOTAL for that teacher across everything they
--     teach. It is not per class and not per subject.
--   * `tgt_open_period(id)` returns the current period's target and a LIVE
--     achieved count, and returns NULL for a wing-scope row.
--
-- So every level's denominator resolves to the same thing: the sum of the
-- current open period over a SET OF TEACHERS. Which teachers is all that
-- changes.
--
--   subject row -> the teacher(s) assigned to that (class, subject)
--   class row   -> the distinct teachers assigned to that class
--   wing row    -> the distinct teachers assigned to any class in that wing
--
-- THE CONSEQUENCE, which the card states out loud rather than hiding: because a
-- teacher's target is one total, it counts in full against every class and
-- subject they touch. Subject rows therefore do not sum to their class, and
-- class rows do not sum to their wing. The alternative was inventing a split
-- nobody set, which would be worse.
--
-- With no target, the row reports the year's publications against 0, which is
-- the format Tushar asked for.
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

CREATE OR REPLACE FUNCTION public.dash5_tree_targets(
  p_level    text DEFAULT 'wings',
  p_wing_id  uuid DEFAULT NULL,
  p_class_id uuid DEFAULT NULL,
  p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_level text; v_out jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
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
  per_teacher AS (
    SELECT teacher_id, metric,
           sum(target_value)::int   AS target_value,
           sum(achieved_value)::int AS achieved_value,
           min(period_start)        AS period_start,
           max(period_end)          AS period_end
      FROM tg GROUP BY 1, 2
  ),
  -- Which teachers belong to which row at the level being drawn.
  map AS (
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
  yr AS (
    SELECT u.teacher_id,
           public.tgt_count_exams_published(u.teacher_id, v_inst, v_ay_start, v_today) AS exams_ytd,
           public.tgt_count_homework_published(u.teacher_id, v_inst, v_ay_start, v_today, v_tz) AS hw_ytd
      FROM (SELECT DISTINCT map.teacher_id FROM map) u
  ),
  joined AS (
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

REVOKE EXECUTE ON FUNCTION public.dash5_tree_targets(text,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_tree_targets(text,uuid,uuid,uuid) TO authenticated, service_role;
