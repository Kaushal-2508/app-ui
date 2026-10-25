-- Teacher Targets, part 1 of 7: give homework a publication timestamp.
--
-- WHY. homework_assignments has no published_at. Publishing is a bare status
-- UPDATE (src/hooks/useHomeworkSave.ts), and created_at is DRAFT-creation time.
-- A homework drafted on 28 Sep and published on 3 Oct would be counted into
-- September by any date window. exams have the same underlying gap, but a
-- DIFFERENT contract: validate_exam_status_transition FORBIDS reverting a
-- published exam back to draft, so its published_at can never be cleared once
-- set. This trigger does NOT mirror that. It fires on
-- BEFORE INSERT OR UPDATE OF status (any UPDATE that names the status column,
-- whether or not the value actually changes) and explicitly PERMITS a homework
-- to go back to draft, clearing published_at when it does. See the trade-off
-- note below the trigger function for what that costs and why it stands.
--
-- BACKFILL HONESTY. Existing rows are backfilled to created_at because that is
-- the only timestamp that exists. For a row that sat as a draft for weeks the
-- backfilled value is wrong, and nothing can recover the true date. New rows
-- are correct from here on.

ALTER TABLE public.homework_assignments
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Stamps published_at on the transition INTO a published state; the
-- `IS NULL` guard means re-saving an already-published row never moves the
-- date forward. Unlike validate_exam_status_transition (which forbids
-- reverting a published exam to draft), this trigger explicitly PERMITS a
-- homework to go back to draft, and clearing published_at on that revert is
-- intended: a homework withdrawn and later re-published reached students on
-- the re-publish date, not the original one.
--
-- TRADE-OFF (accepted, ruled 2026-09-15). Reverting to draft clears the
-- original publication date with no history kept. A later re-publish
-- re-stamps published_at to the new date, and a counting function reading
-- this column (Task 3's tt_count_homework_published) will attribute that
-- homework to the NEW period, not the one it was first published in. As of
-- this migration no current write path un-publishes a homework (publish is
-- one-directional in the UI/RPCs today), so this is LATENT, not exploitable
-- through anything that ships. If a "recall"/"unpublish" feature is ever
-- built, it MUST revisit this: either preserve published_at history across a
-- revert, or teach the counting function to look past the current column.
CREATE OR REPLACE FUNCTION public.tg_set_homework_published_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.status IN ('published','checked') AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  -- Going back to draft clears it, so a re-publish re-stamps honestly.
  IF NEW.status = 'draft' THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS set_homework_published_at ON public.homework_assignments;
CREATE TRIGGER set_homework_published_at
  BEFORE INSERT OR UPDATE OF status ON public.homework_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_set_homework_published_at();

UPDATE public.homework_assignments
SET published_at = created_at
WHERE status IN ('published','checked') AND published_at IS NULL;

-- Serves tt_count_homework_published (Task 3). published_at is indexed RAW, not
-- cast: the counter compares it against a timestamptz range so the index is
-- usable. A (published_at AT TIME ZONE tz)::date expression index is impossible
-- anyway, because timestamptz::date is STABLE, not IMMUTABLE.
CREATE INDEX IF NOT EXISTS idx_homework_assignments_creator_published
  ON public.homework_assignments (created_by, published_at)
  WHERE status IN ('published','checked');

COMMENT ON COLUMN public.homework_assignments.published_at IS
  'When this homework first reached students. Written by set_homework_published_at on the transition into published/checked; cleared on a return to draft. Rows predating 2026-09-15 were backfilled to created_at, which is draft-creation time and is wrong for long-lived drafts.';
