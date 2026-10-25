-- Who marked each class's attendance on a given day, with their names.
--
-- The "Mark Class" tiles used to fetch every attendance_records row for every
-- visible class (select class_id, marked_by ... where date = today) and reduce
-- them in the browser to a per-class "marked by me / marked by someone else"
-- pair. Two problems:
--
--   1. It could only ever say "Marked by another teacher". marked_by is an FK
--      to auth.users, not profiles, so PostgREST cannot embed the marker's
--      name and the client had nothing to show.
--   2. It was unbounded. An admin's institution-wide view pulls one row per
--      student per day; Alliance writes ~1,340 a day, past PostgREST's silent
--      1000-row cap, so the classes past the cap read as "Pending" (§23).
--
-- This aggregates server-side: one row per (class, marker) with the marker's
-- profile name and how many records they wrote, ordered so the person who
-- marked most of the class comes first.
--
-- SECURITY INVOKER on purpose. It runs under the caller's own RLS: teachers
-- see only classes they are assigned to (is_teacher_for_class), coordinators
-- and admins their institution, and a name resolves only when the caller may
-- already read that profile ("Users can view profiles in same institution").
-- Nothing here escalates. Do NOT convert to SECURITY DEFINER without adding
-- an institution guard.
CREATE OR REPLACE FUNCTION public.attendance_class_markers(_class_ids uuid[], _date date)
RETURNS TABLE (
  class_id uuid,
  marked_by uuid,
  marker_name text,
  record_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT
    ar.class_id,
    ar.marked_by,
    p.full_name AS marker_name,
    count(*)::integer AS record_count
  FROM attendance_records ar
  LEFT JOIN profiles p ON p.id = ar.marked_by
  WHERE ar.class_id = ANY (_class_ids)
    AND ar.date = _date
  GROUP BY ar.class_id, ar.marked_by, p.full_name
  ORDER BY ar.class_id, count(*) DESC, p.full_name;
$function$;

COMMENT ON FUNCTION public.attendance_class_markers(uuid[], date) IS
  'One row per (class, marker) for the given date: who wrote attendance records for the class, their profile name, and how many rows. Feeds the Mark Class tiles and the marker lock banner. SECURITY INVOKER: caller''s RLS on attendance_records and profiles applies.';

-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE broadly on every new
-- public function. BOTH revokes are required and neither implies the other
-- (§26): revoking from anon by name leaves the PUBLIC grant, which anon is a
-- member of; revoking from PUBLIC leaves a direct anon grant if one exists.
REVOKE ALL ON FUNCTION public.attendance_class_markers(uuid[], date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attendance_class_markers(uuid[], date) FROM anon;
GRANT EXECUTE ON FUNCTION public.attendance_class_markers(uuid[], date) TO authenticated;
