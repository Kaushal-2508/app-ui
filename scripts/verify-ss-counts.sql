SELECT 'C6 Social Science chapters' AS metric, count(*)::text AS val
  FROM syllabus_topics WHERE subject_id='38147008-dfd1-4a3a-9790-b470bb96e3e0' AND is_active
UNION ALL SELECT 'C7 Social Science chapters', count(*)::text
  FROM syllabus_topics WHERE subject_id='115136e0-a58c-4a00-8120-2317a5d5b7ea' AND is_active
UNION ALL SELECT 'C8 Social Science chapters', count(*)::text
  FROM syllabus_topics WHERE subject_id='2852f766-52d1-47db-bd3e-66ed8b22e3d5' AND is_active
UNION ALL SELECT 'backup: chapters inserted', count(*)::text
  FROM salci_backups.social_science_merge_20260617 WHERE kind='chapter'
UNION ALL SELECT 'backup: tcm inserted', count(*)::text
  FROM salci_backups.social_science_merge_20260617 WHERE kind='tcm'
UNION ALL SELECT 'backup: materials inserted', count(*)::text
  FROM salci_backups.social_science_merge_20260617 WHERE kind='material'
UNION ALL SELECT 'leftover corrupt names in SS targets (should be 0)', count(*)::text
  FROM syllabus_topics
  WHERE subject_id IN ('38147008-dfd1-4a3a-9790-b470bb96e3e0','115136e0-a58c-4a00-8120-2317a5d5b7ea','2852f766-52d1-47db-bd3e-66ed8b22e3d5')
    AND is_active
    AND (topic_name LIKE '%'||chr(65533)||'%' OR topic_name ~ 'Class \d')
ORDER BY metric;
