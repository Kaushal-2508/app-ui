-- PTM follow-up to 20260928180000: close the direct-write paths once the new
-- frontend (every write through the RPCs) is live.
--
-- APPLIED 2026-09-28 after the PTM release (0462462b) was live; verified:
-- direct student inserts refused, bookings read-only, 90/90 suite after.
-- SHIP ORDER (CLAUDE.md §2): apply only AFTER the release that retired
-- PTMBookingDialog / PTMSchedulePanel. Before it, the legacy dialog inserted
-- bookings directly (with no class) and the legacy panel updated
-- ptm_schedules directly, and both would start failing.
--
--  * ptmb_insert let any student in the school book ANY PTM at ANY time, even
--    one not for their class; ptmb_update let the student, the named teacher
--    or an admin rewrite a booking. Writes now go only through
--    book_ptm_slot / cancel_ptm_booking / set_ptm_booking_attended.
--  * ptm_update was admin-only on the institution; it now follows the same
--    rule as the RPCs (can_manage_ptm), so a direct PostgREST update is held
--    to the creator-and-higher rule too.
--  * ptm_bookings.class_id becomes NOT NULL (every booking belongs to a class;
--    the RPC always sets it). Any row the legacy dialog wrote after the main
--    migration is backfilled first.

UPDATE public.ptm_bookings b
   SET class_id = sub.class_id
  FROM (
    SELECT b2.id,
           COALESCE(
             (SELECT min(ca.class_id::text)::uuid FROM public.class_assignments ca
               WHERE ca.user_id = b2.parent_id AND ca.role = 'student' HAVING count(*) = 1),
             (SELECT min(sc.class_id::text)::uuid FROM public.ptm_schedule_classes sc
               WHERE sc.ptm_id = b2.ptm_id HAVING count(*) = 1)
           ) AS class_id
      FROM public.ptm_bookings b2
     WHERE b2.class_id IS NULL
  ) sub
 WHERE sub.id = b.id AND sub.class_id IS NOT NULL;

-- A booking whose class cannot be resolved cannot be shown on any grid; keep
-- the history in salci_backups, then drop it so NOT NULL can land.
CREATE SCHEMA IF NOT EXISTS salci_backups;
CREATE TABLE IF NOT EXISTS salci_backups.ptm_bookings_unresolved_20260928 AS
  SELECT * FROM public.ptm_bookings WHERE false;
INSERT INTO salci_backups.ptm_bookings_unresolved_20260928
  SELECT * FROM public.ptm_bookings WHERE class_id IS NULL;
REVOKE ALL ON salci_backups.ptm_bookings_unresolved_20260928 FROM anon, authenticated;
DELETE FROM public.ptm_bookings WHERE class_id IS NULL;
-- Rollback: INSERT INTO public.ptm_bookings SELECT * FROM salci_backups.ptm_bookings_unresolved_20260928;
--           (after ALTER COLUMN class_id DROP NOT NULL)

ALTER TABLE public.ptm_bookings ALTER COLUMN class_id SET NOT NULL;

DROP POLICY IF EXISTS "ptmb_insert" ON public.ptm_bookings;
DROP POLICY IF EXISTS "ptmb_update" ON public.ptm_bookings;

DROP POLICY IF EXISTS "ptm_update" ON public.ptm_schedules;
CREATE POLICY "ptm_update" ON public.ptm_schedules
  FOR UPDATE TO authenticated
  USING (public.can_manage_ptm((select auth.uid()), id))
  WITH CHECK (public.can_manage_ptm((select auth.uid()), id));
