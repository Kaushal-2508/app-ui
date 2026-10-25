-- Notice Board phase 6: private attachments + feature-flag rename.
--
-- circular-attachments is a PUBLIC bucket whose read policy is
--   USING (bucket_id = 'circular-attachments')
-- i.e. no membership check at all, so any attachment was world-readable by URL.
-- The new bucket is private and its read policy runs the same can_view_notice
-- helper the table uses, so an attachment is exactly as visible as its notice.
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('notice-attachments', 'notice-attachments', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Paths are {notice_id}/{uuid}-{filename}. The notice id is generated
-- client-side so files can be uploaded before the notice row exists, which is
-- also what makes publish_notice idempotent.
DROP POLICY IF EXISTS notice_attachments_insert ON storage.objects;
DROP POLICY IF EXISTS notice_attachments_select ON storage.objects;
DROP POLICY IF EXISTS notice_attachments_delete ON storage.objects;

CREATE POLICY notice_attachments_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'notice-attachments'
              AND public.can_publish_notices((SELECT auth.uid())));

CREATE POLICY notice_attachments_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'notice-attachments'
         AND public.can_view_notice(public.notice_id_from_path(name), (SELECT auth.uid())));

CREATE POLICY notice_attachments_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'notice-attachments'
         AND public.notice_can_oversee(public.notice_id_from_path(name), (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- attachment_urls -> attachments
--
-- attachment_urls has a DUAL SHAPE in prod: an array of public URLs on one row
-- and an empty object {} on the two seed rows, so every read must guard with
-- jsonb_typeof(...) = 'array' -- treating {} as an array raises and aborts.
--
-- Exactly one real attachment exists, on a test notice titled "ewj", and its
-- bytes live in the old public bucket. Moving bytes between buckets needs the
-- Storage API, not a storage.objects row update (a row update desyncs the
-- record from the file), so rather than run that dance for one junk file the
-- entry is preserved as {legacy_url, name} and NoticeDetail renders any entry
-- carrying legacy_url as a plain anchor instead of minting a signed URL.
-- ---------------------------------------------------------------------------
UPDATE public.notices n
   SET attachments = COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'legacy_url', u,
                  'name', regexp_replace(
                            replace(split_part(u, '/', array_length(string_to_array(u,'/'),1)), '%20', ' '),
                            '^\d+-', '')
                ))
           FROM jsonb_array_elements_text(n.attachment_urls) AS t(u)
       ), '[]'::jsonb)
-- Guard on jsonb_typeof ALONE. Pairing it with
--   AND jsonb_array_length(n.attachment_urls) > 0
-- fails with 22023 "cannot get array length of a non-array": SQL does not
-- guarantee short-circuit evaluation of AND, so the length call still reaches
-- the {} rows. The length test is redundant anyway -- jsonb_agg over an empty
-- array returns NULL, which the COALESCE above already turns into '[]'.
 WHERE jsonb_typeof(n.attachment_urls) = 'array';

ALTER TABLE public.notices DROP COLUMN attachment_urls;

ALTER TABLE public.notices
  ADD CONSTRAINT notices_attachments_is_array CHECK (jsonb_typeof(attachments) = 'array');

-- ---------------------------------------------------------------------------
-- Feature flag. institution_features.feature_id has no CHECK constraint
-- (verified against pg_constraint), so this is a plain UPDATE of 12 rows.
-- ---------------------------------------------------------------------------
UPDATE public.institution_features
   SET feature_id = 'notice_board'
 WHERE feature_id = 'circulars';

COMMIT;
