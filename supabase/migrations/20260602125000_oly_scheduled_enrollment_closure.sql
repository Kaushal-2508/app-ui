-- Scheduled enrollment closure: a future "last enrollment date" + helpers.
-- Concurrency target (CLAUDE.md §23): both RPCs SECURITY DEFINER set search_path = public.
-- oly_advance_scheduled_closures is a cron-only sweep (service_role grant only).
-- oly_enrollment_is_open is the single open-check gate used by every enrollment entry point.

alter table public.oly_schools
  add column if not exists enrollment_closes_at timestamptz;

-- Read-only: is enrollment currently open for this school?
-- Open = status is enrollment_open AND (no scheduled close OR the scheduled close is still in the future).
create or replace function public.oly_enrollment_is_open(p_oly_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select s.status = 'enrollment_open'
     and (s.enrollment_closes_at is null or now() < s.enrollment_closes_at)
  from public.oly_schools s where s.id = p_oly_school_id;
$$;
grant execute on function public.oly_enrollment_is_open(uuid) to authenticated, service_role;

-- Daily cron pass: flip schools past their scheduled close to enrollment_closed.
-- Service-role only — never callable from the client.
create or replace function public.oly_advance_scheduled_closures()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.oly_schools
     set status = 'enrollment_closed', updated_at = now()
   where status = 'enrollment_open'
     and enrollment_closes_at is not null
     and enrollment_closes_at <= now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'advanced', v_n);
end;
$$;
revoke execute on function public.oly_advance_scheduled_closures() from authenticated, public;
grant execute on function public.oly_advance_scheduled_closures() to service_role;

-- Extend audit-log actions (DROP + recreate with the cumulative set from
-- Phase 3a + 3b + 5a + 5b — see 20260527004820 — plus the 2 new closure actions).
-- NEVER drop a prior action; this list must remain a superset of every earlier one.
alter table public.oly_audit_log drop constraint if exists oly_audit_log_action_check;
alter table public.oly_audit_log add constraint oly_audit_log_action_check
  check (action in (
    'student_enrolled_cash','student_edited','student_removed',
    'enrollment_closed','teacher_created','teacher_assigned','teacher_unassigned',
    'batch_draft_generated','batches_locked','batch_pin_regenerated',
    'batch_rescheduled','credentials_pdf_generated','absentees_batch_created',
    'results_published','result_pdf_generated','certificate_pdf_generated','results_email_sent',
    'campaign_archived','impersonation_started','dormancy_pass_completed','passport_entry_created',
    'enrollment_close_scheduled','enrollment_close_cancelled'
  ));
