-- Notice Board phase 1: rename circulars -> notices, normalise legacy values,
-- add the columns the new targeting + read-receipt model needs.
--
-- The circ_* RLS policies are deliberately NOT dropped here. Policy names are
-- independent of the table name, so they keep working after the rename; the
-- replacement set lands in 20260822100200. Dropping them now would leave the
-- table RLS-enabled with zero policies, which reads as "nobody can see
-- anything" for the window between the two migrations.
BEGIN;

ALTER TABLE public.circulars RENAME TO notices;

-- PostgREST embed syntax names FK constraints, so rename them explicitly
-- rather than leaving circulars_* names on a notices table.
ALTER TABLE public.notices RENAME CONSTRAINT circulars_pkey                 TO notices_pkey;
ALTER TABLE public.notices RENAME CONSTRAINT circulars_institution_id_fkey  TO notices_institution_id_fkey;
ALTER TABLE public.notices RENAME CONSTRAINT circulars_published_by_fkey    TO notices_published_by_fkey;
ALTER TABLE public.notices RENAME CONSTRAINT circulars_target_class_id_fkey TO notices_target_class_id_fkey;
ALTER TABLE public.notices RENAME CONSTRAINT circulars_target_wing_id_fkey  TO notices_target_wing_id_fkey;

ALTER INDEX public.idx_circulars_institution RENAME TO idx_notices_institution;
ALTER INDEX public.idx_circulars_published   RENAME TO idx_notices_published;

ALTER TRIGGER update_circulars_ts ON public.notices RENAME TO update_notices_ts;

-- Normalise legacy values BEFORE the CHECK constraints go on.
UPDATE public.notices SET scope = 'institution' WHERE scope NOT IN ('institution','wing','class');
-- target_class_id / target_wing_id are NULL on every legacy row, so the 3
-- scope='class' rows name no class at all. The old policy matched on
-- institution_id alone, so they were visible institution-wide in practice;
-- folding them into 'institution' preserves exactly what users see today
-- instead of stranding them with an empty audience.
UPDATE public.notices SET scope = 'institution' WHERE scope = 'class' AND target_class_id IS NULL;
UPDATE public.notices SET scope = 'institution' WHERE scope = 'wing'  AND target_wing_id  IS NULL;
UPDATE public.notices SET priority = 'important' WHERE priority = 'high';
UPDATE public.notices SET priority = 'normal'    WHERE priority NOT IN ('normal','important','urgent');
UPDATE public.notices SET type     = 'general'   WHERE type     NOT IN ('general','academic','event','ptm');

ALTER TABLE public.notices
  ADD COLUMN audience_roles           text[]  NOT NULL DEFAULT ARRAY['student']::text[],
  ADD COLUMN requires_acknowledgement boolean NOT NULL DEFAULT false,
  ADD COLUMN recipient_count          integer NOT NULL DEFAULT 0,
  ADD COLUMN attachments              jsonb   NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.notices.recipient_count IS
  'Snapshot written by publish_notice so a list row never runs a COUNT over notice_recipients.';
COMMENT ON COLUMN public.notices.audience_roles IS
  'Author-chosen for wing/institution scope. Under class scope publish_notice writes what it actually expanded.';

ALTER TABLE public.notices
  ADD CONSTRAINT notices_scope_check    CHECK (scope    IN ('institution','wing','class')),
  ADD CONSTRAINT notices_priority_check CHECK (priority IN ('normal','important','urgent')),
  ADD CONSTRAINT notices_type_check     CHECK (type     IN ('general','academic','event','ptm')),
  ADD CONSTRAINT notices_audience_roles_check
    CHECK (audience_roles <@ ARRAY['coordinator','teacher','student']::text[]);

COMMIT;
