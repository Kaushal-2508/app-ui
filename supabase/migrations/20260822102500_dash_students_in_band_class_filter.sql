-- Carry the donut's class filter into the list behind it.
--
-- The donut and this list are one interaction: tap "Needs help 3" and see those
-- three. Filtering only the chart would have "Needs help 3" open a list of the
-- fifteen the whole school has, which is worse than no filter at all -- the
-- number and the list would contradict each other on the same tap.
--
-- p_class_id is appended, so the old signature is DROPped first: CREATE OR
-- REPLACE across a different argument count adds an overload rather than
-- replacing, and PostgREST cannot resolve a call matching both.
BEGIN;

DROP FUNCTION IF EXISTS public.dash_students_in_band(text, integer, numeric, uuid, uuid);

CREATE OR REPLACE FUNCTION public.dash_students_in_band(
  p_band text,
  p_limit integer DEFAULT 50,
  p_after_pct numeric DEFAULT NULL::numeric,
  p_after_id uuid DEFAULT NULL::uuid,
  p_institution_id uuid DEFAULT NULL::uuid,
  p_class_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(student_id uuid, name text, roll text, class_name text, latest_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  IF p_band NOT IN ('doing_well','catching_up','needs_help') THEN
    RAISE EXCEPTION 'Unknown band';
  END IF;

  IF p_class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = p_class_id AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  RETURN QUERY
  WITH latest AS (
    -- Same window and same DISTINCT ON as dash_student_distribution, including
    -- the class filter, or the list would band a student on a different exam
    -- from the one the donut counted.
    SELECT DISTINCT ON (a.student_id) a.student_id, fr.percentage
      FROM final_results fr
      JOIN student_exam_attempts a ON a.id = fr.attempt_id
      JOIN exams e ON e.id = a.exam_id
       AND e.institution_id = v_inst
       AND e.status IN ('published','active','completed')
     WHERE (p_class_id IS NULL OR a.class_id = p_class_id)
     ORDER BY a.student_id, coalesce(fr.finalized_at, fr.created_at) DESC
  ),
  banded AS (
    SELECT l.student_id, l.percentage
      FROM latest l
     WHERE CASE p_band
             WHEN 'doing_well'  THEN l.percentage > 70
             WHEN 'catching_up' THEN l.percentage BETWEEN 50 AND 70
             ELSE                    l.percentage < 50
           END
  )
  -- Explicit ::text casts: profiles columns are varchar, and RETURNS TABLE
  -- declares text, which raises 42804 "structure of query does not match
  -- function result type" without them.
  SELECT b.student_id,
         coalesce(p.full_name, p.email)::text,
         p.roll_number::text,
         (SELECT string_agg(DISTINCT c.name || CASE WHEN coalesce(c.section,'') <> ''
                                                    THEN '-' || c.section ELSE '' END, ', ')
            FROM class_assignments ca
            JOIN classes c ON c.id = ca.class_id
           WHERE ca.user_id = b.student_id AND ca.role::text = 'student')::text,
         round(b.percentage, 1)::numeric
    FROM banded b
    JOIN profiles p ON p.id = b.student_id
   WHERE p.institution_id = v_inst
     -- keyset: weakest first, id as the tie-breaker
     AND (p_after_pct IS NULL OR (b.percentage, b.student_id) > (p_after_pct, p_after_id))
   ORDER BY b.percentage ASC, b.student_id ASC
   LIMIT LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
END $function$;

REVOKE EXECUTE ON FUNCTION public.dash_students_in_band(text, integer, numeric, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_students_in_band(text, integer, numeric, uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_students_in_band(text, integer, numeric, uuid, uuid, uuid) TO authenticated;

COMMIT;
