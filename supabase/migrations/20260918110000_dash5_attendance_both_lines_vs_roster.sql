-- Admin Dashboard v5: BOTH lines on the attendance trend now measure their
-- full roster, not the people who happened to be marked.
--
-- 20260918100000 did this for teachers. Tushar asked for the same on students
-- (2026-09-18), so the card is one consistent question:
--
--     of everyone on the roll that day, how many were confirmed present?
--
--   students  present or late / every student on the roll that day
--   teachers  checked in      / every teacher on the roll that day
--
-- The student roll is public.institution_student_ids(), which is THE canonical
-- definition of "a student of this school" (assigned to one of its classes,
-- role student, active profile). Never hand-roll a student count: two
-- definitions on one screen is the defect that migration 20260905190000
-- existed to end.
--
-- WHAT THIS CHANGES, said plainly, because the numbers move a long way. The
-- old denominator was the number of attendance_records rows for the day, so a
-- class that had not taken its register simply was not in the fraction. The
-- new denominator is the whole roll, so an unmarked class counts against the
-- day. At Alliance:
--
--   date        marked   present   roll    old      new
--   2026-09-09    1471      1393   1545   94.7%   90.2%
--   2026-09-11    1410      1198   1545   85.0%   77.5%
--   2026-09-15     485       465   1545   95.9%   30.1%
--   2026-09-18      57        57   1545   100.0%   3.7%
--
-- A full day of registers barely moves (94.7 -> 90.2). A day where half the
-- school never marked collapses, and today, taken mid-morning with two classes
-- marked, reads 3.7%. That is the honest reading of the question above, but it
-- means a LOW POINT NOW MEANS "the register was not taken", not "the children
-- were away". So student_marked is carried in the payload and the card prints
-- it beside the percentage; without it a reader cannot tell the two apart.
--
-- Both numerator and denominator are narrowed to the same roll, so a record
-- belonging to someone outside it can never push a line past 100%.
--
-- Rosters are computed AS OF each day (created_at <= that date in the
-- institution's own timezone, CLAUDE.md 24), so a pupil who joined last week
-- is not counted absent for the fortnight before they existed.
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
  -- ----------------------------------------------------------------- rolls --
  stu_roll AS MATERIALIZED (
    SELECT s.student_id AS id,
           COALESCE((p.created_at AT TIME ZONE v_tz)::date, DATE '1900-01-01') AS joined
      FROM public.institution_student_ids(v_inst) s
      JOIN profiles p ON p.id = s.student_id
  ),
  tch_roll AS MATERIALIZED (
    -- DISTINCT because a teacher who also holds another role has two
    -- user_roles rows and must still count once.
    SELECT DISTINCT p.id,
           COALESCE((p.created_at AT TIME ZONE v_tz)::date, DATE '1900-01-01') AS joined
      FROM profiles p
      JOIN user_roles ur ON ur.user_id = p.id
     WHERE p.institution_id = v_inst
       AND p.is_active IS NOT FALSE
       AND ur.role::text = 'teacher'
  ),
  -- ------------------------------------------------------------- numerators --
  stu AS (
    SELECT d.date,
           count(ar.id) FILTER (WHERE ar.status IN ('present','late'))::int present,
           count(ar.id)::int marked
      FROM d
      LEFT JOIN attendance_records ar
             ON ar.date = d.date
            AND ar.institution_id = v_inst
            AND EXISTS (SELECT 1 FROM stu_roll r WHERE r.id = ar.student_id)
     GROUP BY d.date
  ),
  ins AS (
    SELECT d.date,
           count(sr.id) FILTER (WHERE sr.status IN ('present','late'))::int present,
           count(sr.id)::int marked
      FROM d
      LEFT JOIN staff_attendance_records sr
             ON sr.date = d.date
            AND sr.institution_id = v_inst
            AND EXISTS (SELECT 1 FROM tch_roll r WHERE r.id = sr.staff_id)
     GROUP BY d.date
  ),
  -- ----------------------------------------------------------- denominators --
  roll AS (
    SELECT d.date,
           (SELECT count(*) FROM stu_roll r WHERE r.joined <= d.date)::int students,
           (SELECT count(*) FROM tch_roll r WHERE r.joined <= d.date)::int teachers
      FROM d
  )
  SELECT jsonb_build_object(
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', d.date,
        'student_pct',   CASE WHEN k.students > 0 THEN round(s.present*100.0/k.students, 1) END,
        'staff_pct',     CASE WHEN k.teachers > 0 THEN round(i.present*100.0/k.teachers, 1) END,
        -- *_total is the ROLL. *_present and *_marked are what the card needs
        -- to say why a day is low: 465 present of 1545 on the roll, but only
        -- 485 marked, is a register that was never taken.
        'student_total',   COALESCE(k.students, 0),
        'student_present', COALESCE(s.present, 0),
        'student_marked',  COALESCE(s.marked, 0),
        'staff_total',     COALESCE(k.teachers, 0),
        'staff_present',   COALESCE(i.present, 0),
        'staff_marked',    COALESCE(i.marked, 0)
      ) ORDER BY d.date)
      FROM d
      LEFT JOIN stu  s ON s.date = d.date
      LEFT JOIN ins  i ON i.date = d.date
      LEFT JOIN roll k ON k.date = d.date), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.dash5_attendance_series(int,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dash5_attendance_series(int,uuid) TO authenticated, service_role;
