-- Post-apply verification: per active Class 11 group, the copied subjects with
-- chapter/material counts, per-section fanout rows, and the backup log tally.
WITH inst AS (
  SELECT id FROM institutions WHERE name ILIKE '%alliance international%' LIMIT 1
),
grp AS (
  SELECT cg.id, cg.name
  FROM class_groups cg, inst
  WHERE cg.institution_id = inst.id
    AND cg.name IN ('Class 11 Science', 'Class 11 Commerce', 'Class 11 Humanities')
    AND cg.is_active = true
),
subj AS (
  SELECT g.name AS group_name, us.id, us.name, us.code,
    (SELECT count(*) FROM syllabus_topics st WHERE st.subject_id = us.id AND st.is_active) AS chapters,
    (SELECT count(*) FROM study_materials sm
       JOIN syllabus_topics st ON st.id = sm.topic_id
      WHERE st.subject_id = us.id AND sm.is_active) AS materials,
    (SELECT count(*) FROM subject_class_mappings scm
       JOIN classes c ON c.id = scm.class_id AND c.is_active
      WHERE scm.subject_id = us.id AND c.class_group_id = g.id) AS section_fanout_rows,
    (SELECT count(*) FROM topic_class_mappings tcm
       JOIN syllabus_topics st ON st.id = tcm.topic_id
      WHERE st.subject_id = us.id AND tcm.class_group_id = g.id) AS tcm_rows
  FROM grp g
  JOIN subject_class_group_mappings scgm ON scgm.class_group_id = g.id
  JOIN universal_subjects us ON us.id = scgm.subject_id
  WHERE us.is_active = true
    AND (us.name IN ('English - Hornbill', 'English - Snapshot-11', 'Physical Education'))
),
log AS (
  SELECT kind, count(*) AS n
  FROM salci_backups.c11_syllabus_copy_20260611
  GROUP BY kind
)
SELECT json_build_object(
  'subjects', (SELECT json_agg(row_to_json(s) ORDER BY s.group_name, s.name) FROM subj s),
  'backup_log', (SELECT json_agg(row_to_json(l) ORDER BY l.kind) FROM log l)
) AS report;
