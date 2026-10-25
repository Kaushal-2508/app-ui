-- Phase 5b — Olympiad dormancy + super admin polish: archive table, impersonation log, 3 RPCs, daily cron
-- Concurrency target: nightly cron sweeps thousands of students; storage purge batched in edge function.
-- All FKs indexed per CLAUDE.md §23.1.
-- All RPCs SECURITY DEFINER set search_path per CLAUDE.md §23.1.
-- All RLS policies go through public.is_super_admin(auth.uid()) — no inline cross-table EXISTS.
-- pg_cron entry mirrors Phase 3b reminders cron (uses current_setting('app.cron_secret', true)).

-- =========================================================================
-- 1. oly_results_archive — anonymized long-term retention
-- =========================================================================
create table public.oly_results_archive (
  id uuid primary key default gen_random_uuid(),
  -- Anonymized identifiers — roll number and school code are operational identifiers, not PII
  roll_number text not null,
  school_short_code text not null,
  class_label text not null,
  campaign_year smallint not null,
  -- Scoring data
  subject_ids uuid[] not null,
  total_marks_obtained numeric not null,
  total_max_marks numeric not null,
  percentage numeric(5,2) not null,
  subject_scores jsonb not null,
  certificate_tier text not null,
  certificate_id text not null,
  class_rank integer,
  school_rank integer,
  total_time_seconds integer,
  archived_at timestamptz not null default now()
);
create index idx_ora_school_year on public.oly_results_archive(school_short_code, campaign_year);
create index idx_ora_tier on public.oly_results_archive(certificate_tier);
create index idx_ora_archived_at on public.oly_results_archive(archived_at);

alter table public.oly_results_archive enable row level security;
create policy "super_admin all" on public.oly_results_archive for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- =========================================================================
-- 2. oly_impersonation_log — audit trail for super-admin impersonation sessions
-- =========================================================================
create table public.oly_impersonation_log (
  id uuid primary key default gen_random_uuid(),
  super_admin_id uuid not null references public.profiles(id) on delete set null,
  impersonated_user_id uuid references public.profiles(id) on delete set null,
  oly_school_id uuid references public.oly_schools(id) on delete set null,
  reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index idx_oil_super on public.oly_impersonation_log(super_admin_id);
create index idx_oil_target on public.oly_impersonation_log(impersonated_user_id);
create index idx_oil_school on public.oly_impersonation_log(oly_school_id);
create index idx_oil_created_at on public.oly_impersonation_log(created_at);

alter table public.oly_impersonation_log enable row level security;
create policy "super_admin all" on public.oly_impersonation_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));

-- =========================================================================
-- 3. Audit log action enum extension — add 4 new actions for Phase 5b
-- Must happen BEFORE any RPC inserts use the new action values.
-- oly_audit_log.action is a CHECK constraint (not a postgres ENUM), so we
-- DROP + recreate with the cumulative set from Phase 3a + 3b + 5a + 5b.
-- =========================================================================
alter table public.oly_audit_log drop constraint if exists oly_audit_log_action_check;
alter table public.oly_audit_log add constraint oly_audit_log_action_check
  check (action in (
    'student_enrolled_cash','student_edited','student_removed',
    'enrollment_closed','teacher_created','teacher_assigned','teacher_unassigned',
    'batch_draft_generated','batches_locked','batch_pin_regenerated',
    'batch_rescheduled','credentials_pdf_generated','absentees_batch_created',
    'results_published','result_pdf_generated','certificate_pdf_generated','results_email_sent',
    'campaign_archived','impersonation_started','dormancy_pass_completed','passport_entry_created'
  ));

-- =========================================================================
-- 4. oly_dormancy_day30(p_campaign_id) RPC
-- Marks non-SALCI students dormant and SALCI students archived at 30 days post-publish.
-- =========================================================================
create or replace function public.oly_dormancy_day30(p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_marked_non_salci integer := 0;
  v_hidden_salci integer := 0;
begin
  -- Non-SALCI students: mark dormant at 30 days post-publish
  update public.oly_students s
     set status = 'dormant', updated_at = now()
    from public.oly_schools sc, public.oly_results r
   where s.oly_school_id = sc.id
     and r.oly_student_id = s.id
     and sc.is_existing_salci_school = false
     and s.status = 'active'
     and s.profile_id is null
     and r.published_at < now() - interval '30 days'
     and (p_campaign_id is null or s.campaign_id = p_campaign_id);
  get diagnostics v_marked_non_salci = row_count;

  -- SALCI students: status -> archived; the Olympiad sidebar gates on status='active'
  -- so this removes the tab while leaving the main SALCI account untouched.
  update public.oly_students s
     set status = 'archived', updated_at = now()
    from public.oly_schools sc, public.oly_results r
   where s.oly_school_id = sc.id
     and r.oly_student_id = s.id
     and sc.is_existing_salci_school = true
     and s.status = 'active'
     and s.profile_id is not null
     and r.published_at < now() - interval '30 days'
     and (p_campaign_id is null or s.campaign_id = p_campaign_id);
  get diagnostics v_hidden_salci = row_count;

  return jsonb_build_object(
    'ok', true,
    'non_salci_marked_dormant', v_marked_non_salci,
    'salci_archived', v_hidden_salci
  );
end;
$$;

grant execute on function public.oly_dormancy_day30(uuid) to authenticated;

-- =========================================================================
-- 5. oly_dormancy_day60(p_campaign_id) RPC
-- Copies non-SALCI dormant students (30+ days dormant = 60 days post-publish)
-- into oly_results_archive, purges PII, returns auth_user_ids + storage paths
-- for the edge function to actually delete from auth.users and storage.
-- =========================================================================
create or replace function public.oly_dormancy_day60(p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_purged integer := 0;
  v_auth_ids uuid[] := '{}';
  v_pdf_paths text[] := '{}';
  v_student record;
begin
  for v_student in
    select s.id, s.auth_user_id, s.roll_number, s.oly_school_id, s.campaign_id,
           s.class_label, s.subject_ids,
           r.id as result_id, r.total_marks_obtained, r.total_max_marks, r.percentage,
           r.subject_scores, r.certificate_tier, r.certificate_id,
           r.class_rank, r.school_rank, r.total_time_seconds,
           r.result_pdf_path, r.certificate_pdf_path,
           sc.school_short_code, c.campaign_year
      from public.oly_students s
      join public.oly_results r on r.oly_student_id = s.id
      join public.oly_schools sc on sc.id = s.oly_school_id
      join public.oly_campaigns c on c.id = sc.campaign_id
     where s.status = 'dormant'
       and s.profile_id is null
       and s.updated_at < now() - interval '30 days'
       and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  loop
    -- Insert anonymized archive (idempotent — skip if duplicate)
    insert into public.oly_results_archive (
      roll_number, school_short_code, class_label, campaign_year,
      subject_ids, total_marks_obtained, total_max_marks, percentage,
      subject_scores, certificate_tier, certificate_id,
      class_rank, school_rank, total_time_seconds
    ) values (
      v_student.roll_number, v_student.school_short_code, v_student.class_label, v_student.campaign_year,
      v_student.subject_ids, v_student.total_marks_obtained, v_student.total_max_marks, v_student.percentage,
      v_student.subject_scores, v_student.certificate_tier, v_student.certificate_id,
      v_student.class_rank, v_student.school_rank, v_student.total_time_seconds
    )
    on conflict do nothing;

    -- Collect auth user IDs + storage paths for edge-function cleanup
    if v_student.auth_user_id is not null then
      v_auth_ids := v_auth_ids || v_student.auth_user_id;
    end if;
    if v_student.result_pdf_path is not null then
      v_pdf_paths := v_pdf_paths || v_student.result_pdf_path;
    end if;
    if v_student.certificate_pdf_path is not null then
      v_pdf_paths := v_pdf_paths || v_student.certificate_pdf_path;
    end if;

    -- Purge PII fields; keep the row so audit log/refunds stay linked
    update public.oly_students
       set full_name = '[PURGED]',
           parent_name = '[PURGED]',
           parent_phone = '[PURGED]',
           parent_email = null,
           date_of_birth = '1900-01-01'::date,
           status = 'archived',
           updated_at = now()
     where id = v_student.id;

    v_purged := v_purged + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'purged', v_purged,
    'auth_user_ids_to_delete', to_jsonb(v_auth_ids),
    'storage_paths_to_delete', to_jsonb(v_pdf_paths)
  );
end;
$$;

grant execute on function public.oly_dormancy_day60(uuid) to authenticated;

-- =========================================================================
-- 6. oly_cleanup_stuck_attempts() RPC
-- Sweeps oly_attempts where the duration window expired 1+ hour ago and
-- status is still 'in_progress'. Auto-submits with reason='disconnect_exceeded'.
-- Inlined submit logic — oly_submit_attempt uses auth.uid() ownership which
-- the cron sweep cannot satisfy.
-- =========================================================================
create or replace function public.oly_cleanup_stuck_attempts()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_submitted integer := 0;
  v_attempt record;
begin
  for v_attempt in
    select id from public.oly_attempts
     where status = 'in_progress'
       and started_at + (exam_duration_seconds * interval '1 second') < now() - interval '1 hour'
  loop
    update public.oly_attempts a set
      status = 'auto_submitted_disconnect',
      submitted_at = now(),
      submit_reason = 'disconnect_exceeded',
      total_marks_obtained = coalesce((
        select sum(case when ans.selected_answer = snap.correct_answer then snap.marks else 0 end)
          from public.oly_questions_snapshot snap
          left join public.oly_answers ans on ans.oly_question_snapshot_id = snap.id
         where snap.oly_attempt_id = a.id
      ), 0),
      total_max_marks = coalesce((
        select sum(snap.marks)
          from public.oly_questions_snapshot snap
         where snap.oly_attempt_id = a.id
      ), 0)
     where a.id = v_attempt.id;

    update public.oly_attempts set
      percentage = case when total_max_marks > 0
                        then round((total_marks_obtained / total_max_marks) * 100, 2)
                        else 0 end
     where id = v_attempt.id;

    v_submitted := v_submitted + 1;
  end loop;

  return jsonb_build_object('ok', true, 'auto_submitted', v_submitted);
end;
$$;

grant execute on function public.oly_cleanup_stuck_attempts() to authenticated;

-- =========================================================================
-- 7. pg_cron job — daily dormancy pass at 4 AM IST (22:30 UTC)
-- Same app.cron_secret GUC and OLY_CRON_SECRET env var as Phase 3b reminders.
-- =========================================================================
do $$
begin
  perform cron.unschedule('oly-dormancy-pass');
exception when others then null;
end;
$$;

select cron.schedule(
  'oly-dormancy-pass',
  '30 22 * * *',  -- 22:30 UTC = 4:00 AM IST (avoids exam-day morning windows)
  $job$
  select net.http_post(
    url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/oly-dormancy-pass',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);
