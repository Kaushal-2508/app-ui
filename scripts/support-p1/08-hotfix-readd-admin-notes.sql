-- ============================================================================
-- HOTFIX, 2026-08-31: re-add reported_issues.admin_notes, EMPTY, temporarily.
--
-- WHY THIS EXISTS
--
-- Migration 20260831120000 section 6 dropped public.reported_issues.admin_notes
-- to close a confidentiality bug. The DROP was correct. The SEQUENCING was not:
-- a column drop has to TRAIL the frontend deploy that stops selecting it, never
-- lead it.
--
-- The deployed frontend is origin/main (5027330), which still carries an
-- explicit column list naming admin_notes:
--   src/hooks/useReportedIssues.ts:62  "... status, admin_notes, task_id, ..."
-- and errors are rethrown at :80 (`if (error) throw error;`). PostgREST answers
-- 400 for an unknown column, so /admin/issues throws for every super admin who
-- opens it. The corrected frontend exists on local main but is 20 commits
-- unpushed, so it is not deployed.
--
-- WHY THIS DOES NOT REOPEN THE LEAK
--
-- The confidentiality fix was two independent changes, and only one is undone:
--   1. The 14 populated notes were MIGRATED into support_messages with
--      is_internal = true. They are NOT restored here. The column comes back
--      empty and stays empty: nothing writes it any more, because the live
--      set_support_ticket_status and resolve_support_task were rewritten to
--      write support_messages instead.
--   2. The reported_issues SELECT policy was NARROWED to super admin only
--      (same migration, section 6). That is untouched. A reporter cannot read
--      any column of this table, admin_notes included.
-- So the reachable state is: an empty column readable only by super admins.
--
-- REMOVAL
--
-- Drop this column again ONLY after the corrected frontend is actually
-- deployed, i.e. after origin/main contains a useReportedIssues.ts whose
-- ISSUE_COLUMNS omits admin_notes. Verify with:
--   git show origin/main:src/hooks/useReportedIssues.ts | grep admin_notes
-- and expect no match. Then:
--   ALTER TABLE public.reported_issues DROP COLUMN admin_notes;
-- ============================================================================

ALTER TABLE public.reported_issues
  ADD COLUMN IF NOT EXISTS admin_notes text;

COMMENT ON COLUMN public.reported_issues.admin_notes IS
  'DEPRECATED and intentionally empty. Re-added 2026-08-31 only so the deployed frontend (origin/main 5027330), whose explicit column list still names it, does not 400. Internal notes live in support_messages with is_internal = true. Nothing writes this column. Drop it once the corrected frontend is deployed.';
