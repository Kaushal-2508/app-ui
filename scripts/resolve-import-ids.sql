-- Resolve subject + chapter id for Class 9 English at Alliance.
-- The class_group / institution / grade ids are unchanged from prior imports.

WITH alliance AS (
  SELECT id FROM institutions WHERE name ILIKE '%Alliance%International%'
),
class9_group AS (
  -- Same Class 9 class_group used previously
  SELECT id FROM class_groups WHERE id = '41e0a701-bdda-403b-bf4d-003aaffa605b'
),
mapped_english_subjects AS (
  -- English-named subjects mapped to the Class 9 class_group
  SELECT DISTINCT us.id, us.name, us.code
  FROM subject_class_group_mappings scgm
  JOIN universal_subjects us ON us.id = scgm.subject_id
  WHERE scgm.class_group_id IN (SELECT id FROM class9_group)
    AND us.name ILIKE 'English%'
)
-- Subject candidates
SELECT 'subject' AS kind, id::text AS id, name AS detail
FROM mapped_english_subjects
UNION ALL
-- Chapter candidates (for whichever English subject is mapped to Class 9)
SELECT 'chapter', st.id::text, st.topic_name
FROM syllabus_topics st
WHERE st.subject_id IN (SELECT id FROM mapped_english_subjects)
  AND st.grade_level_id = 'd9ec752e-e972-447c-b099-ccf502d554ab'
  AND (st.institution_id IN (SELECT id FROM alliance) OR st.institution_id IS NULL)
  AND (st.topic_name ILIKE '%Grandmother%' OR st.topic_name ILIKE 'Chapter 1%')
ORDER BY kind, detail;
