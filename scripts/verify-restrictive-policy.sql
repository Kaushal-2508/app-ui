-- Verify the new RESTRICTIVE SELECT policy on syllabus_topics filters
-- "The Best Christmas Present in the World" (topic_id 56472755-…) out
-- when Sahil queries it. As service_role (the CLI default) the row
-- IS visible; under Sahil's authenticated context it must NOT be.

BEGIN;

-- Step A: as service_role (no RLS) — should return the row
SELECT 'service_role_view' AS check_name, id, topic_name
FROM public.syllabus_topics
WHERE id = '56472755-3de9-469b-94bc-8a8e8edc09f0';

-- Step B: switch to authenticated as Sahil — should return 0 rows
SET LOCAL role = 'authenticated';
SELECT set_config('request.jwt.claim.sub', 'ba219b8a-c17f-46af-b642-be52f18c80ff', true);
SELECT set_config('request.jwt.claims', '{"sub":"ba219b8a-c17f-46af-b642-be52f18c80ff","role":"authenticated"}', true);

SELECT 'sahil_view' AS check_name, id, topic_name
FROM public.syllabus_topics
WHERE id = '56472755-3de9-469b-94bc-8a8e8edc09f0';

ROLLBACK;
