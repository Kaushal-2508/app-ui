-- Admin Dashboard v5: the staff line on the attendance trend measures the
-- TEACHER ROSTER, not the people who happened to check in.
--
-- THE BUG, as it looked on screen: the staff line sat pinned at a flat 100%
-- for every one of the last twenty days, while the student line moved between
-- 80% and 100%. It was not a rendering fault. The denominator was
-- count(staff_attendance_records) for the day, and at Alliance that table only
-- ever holds check-INS: across the last 30 days it has 0 rows with status
-- 'absent' and 0 with 'leave'. So the fraction was
--
--     everyone who checked in / everyone who checked in  =  100%, always.
--
-- The line could not have said anything else. On 16 Sept it drew 100% from
-- 79 of 79, while 90 teachers were on the roster: the 11 who never checked in
-- were invisible because a no-show writes no row.
--
-- WHAT IT MEASURES NOW (Tushar's call, 2026-09-18):
--   numerator   teachers who checked in that day (status present or late)
--   denominator teachers ON THE ROSTER that day
--
-- Both ends are narrowed to the teacher role. That matters: on 16 Sept one of
-- the 79 check-ins was an admin, so leaving the numerator alone while the
-- denominator counted teachers would have mixed two populations and, on a day
-- when enough non-teachers check in, could push the line past 100%.
--
-- Same day, before and after:  79/79 = 100.0%   ->   78/90 = 86.7%
--
-- The roster is computed AS OF each day (created_at <= that date, in the
-- institution's own timezone per CLAUDE.md 24), so someone who joined last
-- week is not counted absent for the fortnight before they existed. Three of
-- Alliance's staff joined inside the current window.
--
-- No new index: staff_attendance_records(institution_id, date),
-- profiles(institution_id) and user_roles(user_id, role, institution_id) all
-- already exist, and the roster cross join is 20 days x 90 teachers.
--
-- Plain ASCII: prod SQL goes through PowerShell, which mangles anything else.

CREATE OR REPLACE FUNCTION public.dash5_attendance_series(
  p_days int DEFAULT 20, p_institution_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inst uuid; v_tz text; v_out jsonb;
  v_n int := LEAST(GREATEST(COALESCE(p_days, 20), 1), 90);
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT COALESCE(timezone, 'Asia/Kolkata') INTO v_tz FROM institutions WHERE id = v_inst;

  WITH d AS (
    -- Days the school actually took a register. Calendar days would draw
    -- Sundays and holidays as a collapse to zero.
    SELECT DISTINCT ar.date FROM attendance_records ar
     WHERE ar.institution_id = v_inst
     ORDER BY ar.date DESC LIMIT v_n
  ),
  stu AS (
    -- Students keep their old denominator: the share present OF THOSE MARKED.
    -- A student with no row was not registered rather than absent, and the
    -- card says so under the chart.
    SELECT ar.date,
           count(*) FILTER (WHERE ar.status IN ('present','late'))::int present,
           count(*)::int total
      FROM attendance_records ar JOIN d ON d.date = ar.date
     WHERE ar.institution_id = v_inst
     GROUP BY 1
  ),
  tch AS (
    -- The teaching roster. DISTINCT because a teacher who also holds another
    -- role has two user_roles rows and must still count once.
    SELECT DISTINCT p.id,
           COALESCE((p.created_at AT TIME ZONE v_tz)::date, DATE '1900-01-01') AS joined
      FROM profiles p
      JOIN user_roles ur ON ur.user_id = p.id
     WHERE p.institution_id = v_inst
       AND p.is_active IS NOT FALSE
       AND ur.role::text = 'teacher'
  ),
  ins AS (
    -- Check-ins, narrowed to that same roster.
    SELECT d.date,
           count(sr.id) FILTER (WHERE sr.status IN ('present','late'))::int present
      FROM d
      LEFT JOIN staff_attendance_records sr
             ON sr.date = d.date
            AND sr.institution_id = v_inst
            AND EXISTS (SELECT 1 FROM tch WHERE tch.id = sr.staff_id)
     GROUP BY d.date
  ),
  roll AS (
    SELECT d.date, count(*) FILTER (WHERE t.joined <= d.date)::int total
      FROM d CROSS JOIN tch t
     GROUP BY d.date
  )
  SELECT jsonb_build_object(
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', d.date,
        'student_pct', CASE WHEN s.total > 0 THEN round(s.present*100.0/s.total, 1) END,
        'staff_pct',   CASE WHEN r.total > 0 THEN round(i.present*100.0/r.total, 1) END,
        'student_total', COALESCE(s.total, 0),
        -- staff_total is now the ROSTER, not the number marked. The card's
        -- tooltip reads "N of M teachers checked in" off these two.
        'staff_total',   COALESCE(r.total, 0),
        'staff_present', COALESCE(i.present, 0)
      ) ORDER BY d.date)
      FROM d
      LEFT JOIN stu  s ON s.date = d.date
      LEFT JOIN ins  i ON i.date = d.date
      LEFT JOIN roll r ON r.date = d.date), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_attendance_series(int,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_attendance_series(int,uuid) TO authenticated, service_role;
