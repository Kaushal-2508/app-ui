-- Admissions follow-up (applied on prod 2026-10-12 ~11:25 UTC, the fix for the
-- outage that 20261012120000 caused at 10:17 UTC).
--
-- 1. admissions_overrides had PRIMARY KEY (user_id, institution_id), two FKs to
--    profiles and institutions. PostgREST reads a table whose PK holds FKs to two
--    tables as a many-to-many junction, so every profiles <-> institutions embed
--    (the sidebar user, the profile page, the student sheet) found two
--    relationships and failed with PGRST201 for every user. It now has a surrogate
--    id key; (user_id, institution_id) stays UNIQUE, which admission_set_staff's
--    ON CONFLICT uses.
-- 2. Its SELECT policy called _admissions_admin, which authenticated may not
--    execute, so a direct read errored (42501). It now calls _admissions_admin_me().
-- Idempotent: re-running it on the fixed table changes nothing.

DO $key$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'admissions_overrides' AND column_name = 'id') THEN
    ALTER TABLE public.admissions_overrides DROP CONSTRAINT IF EXISTS admissions_overrides_pkey;
    ALTER TABLE public.admissions_overrides ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE public.admissions_overrides ADD CONSTRAINT admissions_overrides_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admissions_overrides_user_institution_key') THEN
    ALTER TABLE public.admissions_overrides
      ADD CONSTRAINT admissions_overrides_user_institution_key UNIQUE (user_id, institution_id);
  END IF;
END
$key$;

UPDATE dua.table_registry
   SET notes = 'PK is id; (user_id, institution_id) is UNIQUE. Added 2026-10-12 with the admissions module.'
 WHERE table_name = 'public.admissions_overrides';

CREATE OR REPLACE FUNCTION public._admissions_admin_me()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._admissions_admin((SELECT auth.uid()), public.get_user_institution((SELECT auth.uid())));
$$;
REVOKE ALL ON FUNCTION public._admissions_admin_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._admissions_admin_me() TO authenticated, service_role;

DROP POLICY IF EXISTS admissions_overrides_select ON public.admissions_overrides;
CREATE POLICY admissions_overrides_select ON public.admissions_overrides FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR ((SELECT public._admissions_admin_me())
             AND institution_id = (SELECT public.get_user_institution((SELECT auth.uid())))));

NOTIFY pgrst, 'reload schema';
