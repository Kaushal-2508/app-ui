-- Final readout: which social-studies subjects each ACTIVE Class 6/7/8 group now
-- shows (History/Civics/Geography should be GONE; only Social Science remains),
-- with its live chapter count.
WITH ag(grade, grp) AS (VALUES
  (6,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
  (7,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
  (8,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid)
)
SELECT g.grade,
       us.name AS subject_name,
       CASE WHEN us.institution_id IS NULL THEN 'GLOBAL' ELSE 'INST' END AS scope,
       (SELECT count(*) FROM syllabus_topics st WHERE st.subject_id=us.id AND st.is_active) AS chapters
FROM ag g
JOIN subject_class_group_mappings m ON m.class_group_id = g.grp
JOIN universal_subjects us ON us.id = m.subject_id
WHERE us.name ~* '(civ|hist|geograph|social|econ|sst)'
ORDER BY g.grade, us.name;
