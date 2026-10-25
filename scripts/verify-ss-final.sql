WITH src(subject_id, grp) AS (VALUES
  ('90dc57bb-694f-49d3-9df9-5c3ca91dafc7'::uuid,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
  ('a038b9c1-f0fc-4a6e-bcd0-c6bafe9ebbcf'::uuid,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
  ('0d57ddf5-5fbc-46bf-b0f8-16d42f1fbd4c'::uuid,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
  ('9d88088f-b314-404c-86a4-d68117dea7da'::uuid,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
  ('9c1af94d-5c92-47a9-814d-b37f260ec04f'::uuid,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
  ('f7e27e1c-7c77-4ddd-b09a-11b8cea09f9a'::uuid,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
  ('bc99f893-2277-4019-af80-d9b74d102707'::uuid,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid),
  ('832e9141-37d6-4ede-98c6-0f81ddca6a0a'::uuid,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid),
  ('58d41ba9-936e-43e6-b2c8-b0697b678ef2'::uuid,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid)
)
SELECT 'scgm remaining for the 9 pairs (want 0)' AS metric, count(*)::text AS val
  FROM subject_class_group_mappings m JOIN src s ON s.subject_id=m.subject_id AND s.grp=m.class_group_id
UNION ALL
SELECT 'scm leftover in active sections (want 0)', count(*)::text
  FROM subject_class_mappings scm
  WHERE scm.subject_id IN (SELECT subject_id FROM src)
    AND scm.class_id IN (SELECT id FROM classes WHERE class_group_id IN (SELECT grp FROM src))
UNION ALL
SELECT 'backup unmap_scgm rows (want 9)', count(*)::text
  FROM salci_backups.social_science_merge_20260617 WHERE kind='unmap_scgm'
ORDER BY metric;
