-- =============================================================================
-- STAGE 2 (destructive, reversible): remove History / Civics / Geography from
-- the ACTIVE Class 6/7/8 groups at Alliance, so only "Social Science" remains.
--
-- Deletes the 9 subject_class_group_mappings rows; the SECURITY DEFINER trigger
-- fans the delete out to legacy subject_class_mappings. The GLOBAL subject rows
-- and their chapters are NOT touched (other schools keep them). Inactive/legacy
-- duplicate groups are intentionally left alone (historical AY).
--
-- Every removed mapping is logged to salci_backups.social_science_merge_20260617
-- (kind='unmap_scgm') -> rollback = re-INSERT subject_class_group_mappings
-- (subject_id, class_group_id) for each logged row.
-- =============================================================================

-- 1) Backup the mappings we are about to delete (only ones that still exist).
INSERT INTO salci_backups.social_science_merge_20260617
  (kind, source_subject, class_group_id, note)
SELECT 'unmap_scgm', m.subject_id, m.class_group_id,
       'removed History/Civics/Geography from active Class 6/7/8'
FROM subject_class_group_mappings m
JOIN (VALUES
  ('90dc57bb-694f-49d3-9df9-5c3ca91dafc7'::uuid,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid), -- C6 History
  ('a038b9c1-f0fc-4a6e-bcd0-c6bafe9ebbcf'::uuid,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid), -- C6 Civics
  ('0d57ddf5-5fbc-46bf-b0f8-16d42f1fbd4c'::uuid,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid), -- C6 Geography
  ('9d88088f-b314-404c-86a4-d68117dea7da'::uuid,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid), -- C7 History
  ('9c1af94d-5c92-47a9-814d-b37f260ec04f'::uuid,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid), -- C7 Civics
  ('f7e27e1c-7c77-4ddd-b09a-11b8cea09f9a'::uuid,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid), -- C7 Geography
  ('bc99f893-2277-4019-af80-d9b74d102707'::uuid,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid), -- C8 History
  ('832e9141-37d6-4ede-98c6-0f81ddca6a0a'::uuid,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid), -- C8 Civics
  ('58d41ba9-936e-43e6-b2c8-b0697b678ef2'::uuid,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid)  -- C8 Geography
) AS p(src,grp) ON m.subject_id = p.src AND m.class_group_id = p.grp;

-- 2) Delete the mappings (trigger fans out to subject_class_mappings).
DELETE FROM subject_class_group_mappings m
USING (VALUES
  ('90dc57bb-694f-49d3-9df9-5c3ca91dafc7'::uuid,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
  ('a038b9c1-f0fc-4a6e-bcd0-c6bafe9ebbcf'::uuid,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
  ('0d57ddf5-5fbc-46bf-b0f8-16d42f1fbd4c'::uuid,'d72b5605-76ba-4108-b6b0-dceadbd1722d'::uuid),
  ('9d88088f-b314-404c-86a4-d68117dea7da'::uuid,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
  ('9c1af94d-5c92-47a9-814d-b37f260ec04f'::uuid,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
  ('f7e27e1c-7c77-4ddd-b09a-11b8cea09f9a'::uuid,'11b421bc-5be1-4294-a117-c80209ea70ac'::uuid),
  ('bc99f893-2277-4019-af80-d9b74d102707'::uuid,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid),
  ('832e9141-37d6-4ede-98c6-0f81ddca6a0a'::uuid,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid),
  ('58d41ba9-936e-43e6-b2c8-b0697b678ef2'::uuid,'95b8bc81-1f6b-4a5c-845b-a3afb375fa3a'::uuid)
) AS p(src,grp)
WHERE m.subject_id = p.src AND m.class_group_id = p.grp;
