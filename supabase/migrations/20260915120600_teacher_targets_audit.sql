-- Teacher Targets, part 7 of 7: audit coverage.
--
-- tg_audit_row (20260914140000) already handles TG_OP = 'UPDATE' in its body
-- (v_old := to_jsonb(OLD); v_new := to_jsonb(NEW)) -- it has simply never had
-- an UPDATE trigger attached to any table, because no table so far has needed
-- one. No change to the function itself is needed here.
--
-- teacher_targets and teacher_target_periods did not exist when 20260914140000
-- ran (they were created afterwards, in 20260915120100), so neither table has
-- INSERT/DELETE audit coverage yet either. This migration adds all three arms
-- in one place, copying the exact FOR EACH ROW shape 20260914140000 uses for
-- every other table (a plain per-row AFTER trigger reading NEW/OLD directly --
-- NOT a statement-level trigger with REFERENCING NEW TABLE/OLD TABLE, which
-- tg_audit_row's body could not consume: it reads NEW/OLD directly, which are
-- only bound inside a FOR EACH ROW trigger, and a bare REFERENCING clause on a
-- FOR EACH STATEMENT trigger with a column list raises 0A000 besides):
--   * INSERT + DELETE on teacher_targets
--   * INSERT + DELETE on teacher_target_periods
--   * UPDATE on teacher_targets ONLY -- this is the new arm. Targets are the
--     first feature here where the EDIT is the contentious event: "who
--     changed the number from 4 to 2" must be answerable.
--
-- teacher_target_periods gets NO UPDATE trigger. tgt_evaluate_targets
-- (20260915120500) rewrites every OPEN ledger row nightly via its
-- ON CONFLICT ... DO UPDATE; auditing that would drown the one edit that
-- actually matters (an admin/coordinator changing a target's number) under a
-- nightly flood of routine recomputation noise.
--
-- Neither table carries a natural name column (no title/name/label), so both
-- use '' for TG_ARGV[1], the same convention 20260914140000 used for
-- wing_assignments/wing_class_mappings -- the row stays identifiable by id
-- and the full old/new JSON payload.

DROP TRIGGER IF EXISTS zzz_audit_ins ON public.teacher_targets;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.teacher_targets;
DROP TRIGGER IF EXISTS zzz_audit_upd ON public.teacher_targets;

CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.teacher_targets
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Teacher target', '');

CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.teacher_targets
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Teacher target', '');

CREATE TRIGGER zzz_audit_upd AFTER UPDATE ON public.teacher_targets
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Teacher target', '');

DROP TRIGGER IF EXISTS zzz_audit_ins ON public.teacher_target_periods;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.teacher_target_periods;

CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.teacher_target_periods
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Teacher target period', '');

CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.teacher_target_periods
  FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Teacher target period', '');

-- Explicitly NOT attached, on purpose (see header): no zzz_audit_upd on
-- teacher_target_periods. If one is ever added later, drop it here first.
DROP TRIGGER IF EXISTS zzz_audit_upd ON public.teacher_target_periods;
