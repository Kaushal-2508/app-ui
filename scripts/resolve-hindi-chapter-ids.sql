-- Resolve Hindi subject + Class 9 chapter ids at Alliance.
-- Run this in Supabase SQL editor (or `npx supabase db query --linked --file ...`)
-- and share the output so we can wire each chapter's UUID into the import builder.
--
-- The class_group / institution / grade ids are unchanged from prior imports:
--   institution_id  = 8af718c6-ca11-482b-9d6b-832f2b767928 (Alliance International)
--   class_group_id  = 41e0a701-bdda-403b-bf4d-003aaffa605b (Class 9)
--   grade_level_id  = d9ec752e-e972-447c-b099-ccf502d554ab (Grade 9)

WITH alliance AS (
  SELECT id FROM institutions WHERE name ILIKE '%Alliance%International%'
),
class9_group AS (
  SELECT id FROM class_groups WHERE id = '41e0a701-bdda-403b-bf4d-003aaffa605b'
),
mapped_hindi_subjects AS (
  -- Hindi-named subjects mapped to the Class 9 class_group
  SELECT DISTINCT us.id, us.name, us.code
  FROM subject_class_group_mappings scgm
  JOIN universal_subjects us ON us.id = scgm.subject_id
  WHERE scgm.class_group_id IN (SELECT id FROM class9_group)
    AND (us.name ILIKE 'Hindi%' OR us.name_hindi IS NOT NULL AND us.name ILIKE '%hindi%')
)
SELECT 'subject' AS kind, id::text AS id, name AS detail
FROM mapped_hindi_subjects
UNION ALL
-- Chapter candidates 1..5 (filter on chapter_number; fall back to topic_name LIKE 'Chapter %')
SELECT 'chapter',
       st.id::text,
       COALESCE('Ch ' || st.chapter_number::text || ' — ', '') || st.topic_name
FROM syllabus_topics st
WHERE st.subject_id IN (SELECT id FROM mapped_hindi_subjects)
  AND st.grade_level_id = 'd9ec752e-e972-447c-b099-ccf502d554ab'
  AND (st.institution_id IN (SELECT id FROM alliance) OR st.institution_id IS NULL)
  AND (
    st.chapter_number BETWEEN 1 AND 5
    OR st.topic_name ~* '^(chapter|पाठ)\s*[1-5]\b'
  )
ORDER BY kind, detail;
