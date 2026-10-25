-- Student roster: data repair + a standing drift check (2026-09-05)
-- ============================================================================
-- Companion to 20260905190000_one_canonical_student_roster.sql. That migration
-- made every surface read ONE definition; this one repairs the data that had
-- already drifted and leaves behind a check so the drift is visible next time.
--
-- Part 1 repairs students who were assigned to a class but whose
-- profiles.institution_id was NULL, which made them invisible to every
-- institution-scoped query. 7 profiles were fixed:
--   Alliance International School - GURBAAZ SINGH (Nursery Orange),
--     KESHAVDEEP (Class 2 C, 6 exam results), MANSEHAJ SINGH (Class 4 A,
--     17 exam results), PURVA THAKUR (Pre Nursery A)
--   Vanshika Testing School - ujjwal, Gfdg, student1234
-- Only students whose classes all sit in ONE institution are touched, so the
-- school is never a guess. Rollback manifest:
--   salci_backups.profiles_null_institution_20260905
--
-- Part 2 adds student_roster_anomalies(), a read-only report. After this
-- migration kinds A, B and D are empty platform-wide.

-- The 4 Alliance students whose profiles.institution_id was NULL. Each is
-- assigned to exactly one Alliance class and carries an ais*@temp.local import
-- address; two of them already have live exam results. A NULL institution
-- makes them invisible to every institution-scoped query, so this is a real
-- data defect, not a display quirk. Rollback manifest kept.
CREATE SCHEMA IF NOT EXISTS salci_backups;

CREATE TABLE IF NOT EXISTS salci_backups.profiles_null_institution_20260905 AS
SELECT p.id, p.full_name, p.institution_id AS old_institution_id, now() AS captured_at
  FROM public.profiles p
 WHERE p.institution_id IS NULL
   AND EXISTS (SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = p.id AND ur.role::text = 'student')
   AND EXISTS (SELECT 1 FROM public.class_assignments ca
                WHERE ca.user_id = p.id AND ca.role = 'student');

-- Only where the student's classes all belong to ONE institution, so there is
-- never a guess about which school they are.
UPDATE public.profiles p
   SET institution_id = t.inst, updated_at = now()
  FROM (
    SELECT ca.user_id, (array_agg(DISTINCT c.institution_id))[1] AS inst  -- no min(uuid) in this PG
      FROM public.class_assignments ca
      JOIN public.classes c ON c.id = ca.class_id
     WHERE ca.role = 'student'
     GROUP BY ca.user_id
    HAVING count(DISTINCT c.institution_id) = 1
  ) t
 WHERE p.id = t.user_id
   AND p.institution_id IS NULL
   AND EXISTS (SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = p.id AND ur.role::text = 'student');


-- ── Part 2: the standing check ─────────────────────────────────────────────
-- A standing check for the drift that produced 253-vs-252. Read-only; run it
-- from scripts/run-sql.ps1 any time a student total looks wrong.
CREATE OR REPLACE FUNCTION public.student_roster_anomalies()
RETURNS TABLE (
  kind text,
  institution text,
  student_id uuid,
  student_name text,
  detail text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- A: in a class, but the profile carries no institution. Invisible to every
  --    institution-scoped query that still reads profiles.institution_id.
  SELECT 'no_institution_on_profile',
         i.name, p.id, p.full_name,
         'Assigned to a class in ' || i.name || ' but profiles.institution_id is NULL'
    FROM public.class_assignments ca
    JOIN public.classes c ON c.id = ca.class_id
    JOIN public.institutions i ON i.id = c.institution_id
    JOIN public.profiles p ON p.id = ca.user_id
   WHERE ca.role = 'student' AND p.institution_id IS NULL

  UNION ALL
  -- B: profile says the student belongs to a DIFFERENT school than their class.
  SELECT 'institution_mismatch',
         i.name, p.id, p.full_name,
         'Class is in ' || i.name || ' but the profile says ' || COALESCE(i2.name, 'NULL')
    FROM public.class_assignments ca
    JOIN public.classes c ON c.id = ca.class_id
    JOIN public.institutions i ON i.id = c.institution_id
    JOIN public.profiles p ON p.id = ca.user_id
    LEFT JOIN public.institutions i2 ON i2.id = p.institution_id
   WHERE ca.role = 'student'
     AND p.institution_id IS NOT NULL
     AND p.institution_id <> c.institution_id

  UNION ALL
  -- C: a student ACCOUNT with no class. Not counted by the canonical roster,
  --    which is correct, but usually means a duplicate or an unfinished setup.
  SELECT 'account_without_a_class',
         i.name, p.id, p.full_name,
         'Active student account in ' || i.name || ' with no class assignment'
    FROM public.profiles p
    JOIN public.institutions i ON i.id = p.institution_id
   WHERE p.is_active IS NOT FALSE
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = p.id AND ur.role::text = 'student')
     AND NOT EXISTS (SELECT 1 FROM public.class_assignments ca
                      WHERE ca.user_id = p.id AND ca.role = 'student')

  UNION ALL
  -- D: a student in classes belonging to two different schools.
  SELECT 'student_in_two_schools',
         string_agg(DISTINCT i.name, ' + '), p.id, p.full_name,
         'Assigned to classes in more than one institution'
    FROM public.class_assignments ca
    JOIN public.classes c ON c.id = ca.class_id
    JOIN public.institutions i ON i.id = c.institution_id
    JOIN public.profiles p ON p.id = ca.user_id
   WHERE ca.role = 'student'
   GROUP BY p.id, p.full_name
  HAVING count(DISTINCT c.institution_id) > 1
$function$;

COMMENT ON FUNCTION public.student_roster_anomalies() IS
  'Read-only drift report for the student roster. Empty result = every student total on every surface will agree. Non-empty = the data that once put 253 and 252 on the same dashboard is back.';

REVOKE ALL ON FUNCTION public.student_roster_anomalies() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_roster_anomalies() FROM anon;
GRANT EXECUTE ON FUNCTION public.student_roster_anomalies() TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_roster_anomalies() TO service_role;
