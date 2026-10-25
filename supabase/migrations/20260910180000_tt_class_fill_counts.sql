-- =============================================================
-- tt_class_fill_counts - server-side "cells filled" per class
-- -------------------------------------------------------------
-- The timetable class list used to SELECT every tt_slots row for the
-- academic year and count them in the browser. PostgREST silently caps a
-- request at 1000 rows and BOTH live schools are already past it
-- (Alliance International School 1484, Salci National School 1129 for
-- 2026-27), so whichever classes fell beyond the cap reported
-- "0 / N cells filled" and read as never set up. CLAUDE.md section 23:
-- aggregate server-side, never fetch rows to count them.
--
-- Scoped to the caller's own institution (super admins excepted) so this
-- cannot be used to probe another school's timetable shape. Read-only.
-- =============================================================

CREATE OR REPLACE FUNCTION public.tt_class_fill_counts(
  _class_ids uuid[], _academic_year text
)
RETURNS TABLE(class_id uuid, filled integer, last_edit timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT s.class_id, count(*)::integer AS filled, max(s.updated_at) AS last_edit
  FROM public.tt_slots s
  JOIN public.classes c ON c.id = s.class_id
  WHERE s.class_id = ANY (_class_ids)
    AND s.academic_year = _academic_year
    AND (
      c.institution_id = public.get_user_institution((select auth.uid()))
      OR public.is_super_admin((select auth.uid()))
    )
  GROUP BY s.class_id;
$fn$;

COMMENT ON FUNCTION public.tt_class_fill_counts(uuid[], text) IS
  'Per-class count of filled timetable cells plus the latest edit, aggregated server-side. Replaces an unbounded client-side count that PostgREST truncated at 1000 rows.';

REVOKE ALL ON FUNCTION public.tt_class_fill_counts(uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tt_class_fill_counts(uuid[], text) FROM anon;
GRANT EXECUTE ON FUNCTION public.tt_class_fill_counts(uuid[], text) TO authenticated;
