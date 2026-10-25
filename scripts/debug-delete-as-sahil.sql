-- Step-by-step RLS evaluation for Sahil's delete attempt on Chapter 9: Unyielding.
-- Each step is its own statement so the CLI returns each result separately.

BEGIN;

SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claim.sub', 'ba219b8a-c17f-46af-b642-be52f18c80ff', true);
SELECT set_config('request.jwt.claims', '{"sub":"ba219b8a-c17f-46af-b642-be52f18c80ff","role":"authenticated"}', true);

-- Step A: confirm we're running as Sahil
SELECT 'step_A_auth_uid' AS check_name, auth.uid() AS uid_value, current_user AS pg_role;

-- Step B: row visibility to Sahil
SELECT 'step_B_visible' AS check_name,
       COUNT(*) AS row_count
FROM public.syllabus_topics
WHERE id = 'e7f15a92-3fd2-46f3-b661-9060b077f73b';

-- Step C: predicate evaluation against the row
SELECT 'step_C_predicates' AS check_name,
       (institution_id IS NOT NULL)                                    AS inst_not_null,
       institution_id                                                  AS row_inst,
       public.get_user_institution(auth.uid())                          AS caller_inst,
       (institution_id = public.get_user_institution(auth.uid()))       AS inst_match,
       EXISTS (
         SELECT 1 FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()
         AND ur.role = ANY (ARRAY[
           'school_admin'::public.app_role,
           'super_school_admin'::public.app_role,
           'coordinator'::public.app_role
         ])
       ) AS role_ok
FROM public.syllabus_topics
WHERE id = 'e7f15a92-3fd2-46f3-b661-9060b077f73b';

-- Step D: attempt the DELETE under RLS
DELETE FROM public.syllabus_topics
WHERE id = 'e7f15a92-3fd2-46f3-b661-9060b077f73b'
RETURNING 'step_D_deleted_rows' AS check_name, id, topic_name;

ROLLBACK;
