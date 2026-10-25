-- Phase 5a — Olympiad publish pipeline: results, publish jobs, 4 RPCs
-- Concurrency target: 200-500 students per school × dozens of schools publishing concurrently.
-- All FKs indexed per CLAUDE.md §23.1.
-- All RPCs SECURITY DEFINER with auth.uid() ownership checks per CLAUDE.md §23.1.
-- oly_publish_initiate uses FOR UPDATE lock on oly_schools to prevent concurrent triggers.
-- oly_publish_compute_ranks uses window functions (RANK() OVER) for server-side rank computation.
-- oly_publish_compute_ranks uses ON CONFLICT (oly_student_id) DO NOTHING for idempotent re-runs.
-- oly_publish_jobs.oly_school_id is UNIQUE — one publish job per school.

-- =========================================================================
-- 1. Certificate sequence (used by oly_publish_compute_ranks for cert IDs)
-- =========================================================================
create sequence if not exists public.oly_certificate_seq start 1;

-- =========================================================================
-- 2. oly_results
-- =========================================================================
create table public.oly_results (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  oly_attempt_id uuid references public.oly_attempts(id) on delete set null,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,

  -- Aggregate scoring (copied from oly_attempts at publish so it survives even if attempt is purged)
  total_marks_obtained numeric not null default 0,
  total_max_marks numeric not null default 0,
  percentage numeric(5,2) not null default 0,
  subject_scores jsonb not null default '[]'::jsonb,  -- [{subject_id, subject_name, correct, total, marks_obtained, marks_max, percentage}]

  -- Time taken (extracted from attempt for ranking)
  total_time_seconds integer,

  -- Ranks (computed server-side via window functions)
  class_rank integer,
  class_total integer,
  school_rank integer,
  school_total integer,

  -- Certificate tier
  certificate_tier text not null check (certificate_tier in ('gold', 'silver', 'bronze', 'participation', 'absent')),
  certificate_id text not null unique,  -- format: CERT-{year}-{7-digit-seq}

  -- PDFs (stored in olympiad-receipts bucket)
  result_pdf_path text,
  certificate_pdf_path text,
  result_pdf_generated_at timestamptz,
  certificate_pdf_generated_at timestamptz,

  -- Email
  emailed_to text,
  emailed_at timestamptz,

  published_at timestamptz not null default now(),
  unique(oly_student_id)
);

create index idx_oly_results_student on public.oly_results(oly_student_id);
create index idx_oly_results_attempt on public.oly_results(oly_attempt_id);
create index idx_oly_results_school on public.oly_results(oly_school_id);
create index idx_oly_results_campaign on public.oly_results(campaign_id);
create index idx_oly_results_tier on public.oly_results(certificate_tier);
create index idx_oly_results_certificate on public.oly_results(certificate_id);

alter table public.oly_results enable row level security;

create policy "super_admin all" on public.oly_results for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_results for select
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
create policy "teacher SELECT assigned class" on public.oly_results for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_teacher_for_class(auth.uid(), s.oly_school_id, s.grade_level_id)
  ));
create policy "student SELECT own" on public.oly_results for select
  using (public.oly_student_can_read(auth.uid(), oly_student_id));

-- =========================================================================
-- 3. oly_publish_jobs
-- =========================================================================
create table public.oly_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  initiated_by uuid references public.profiles(id) on delete set null,

  status text not null default 'queued'
    check (status in ('queued', 'computing_ranks', 'generating_pdfs', 'sending_emails', 'completed', 'failed')),

  total_students integer not null default 0,
  processed_students integer not null default 0,
  failed_students integer not null default 0,
  failure_details jsonb default '[]'::jsonb,

  started_at timestamptz,
  completed_at timestamptz,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(oly_school_id)  -- one publish job per school; re-run upserts the existing row
);

create index idx_opj_school on public.oly_publish_jobs(oly_school_id);
create index idx_opj_status on public.oly_publish_jobs(status);
create index idx_opj_initiated_by on public.oly_publish_jobs(initiated_by);

create trigger oly_publish_jobs_set_updated_at before update on public.oly_publish_jobs
  for each row execute function public.oly_set_updated_at();

alter table public.oly_publish_jobs enable row level security;

create policy "super_admin all" on public.oly_publish_jobs for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_publish_jobs for select
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id));

-- =========================================================================
-- 4. Audit log enum extension
-- Must happen BEFORE any RPC inserts use the new action values.
-- =========================================================================
alter table public.oly_audit_log drop constraint if exists oly_audit_log_action_check;
alter table public.oly_audit_log add constraint oly_audit_log_action_check
  check (action in (
    'student_enrolled_cash','student_edited','student_removed',
    'enrollment_closed','teacher_created','teacher_assigned','teacher_unassigned',
    'batch_draft_generated','batches_locked','batch_pin_regenerated',
    'batch_rescheduled','credentials_pdf_generated','absentees_batch_created',
    'results_published', 'result_pdf_generated', 'certificate_pdf_generated', 'results_email_sent'
  ));

-- =========================================================================
-- 5. oly_publish_initiate(p_oly_school_id)
-- Called by school admin to atomically flip school status + create publish job.
-- FOR UPDATE lock on oly_schools prevents concurrent triggers.
-- Returns { ok, job_id, total_students }.
-- =========================================================================
create or replace function public.oly_publish_initiate(p_oly_school_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_school record;
  v_job_id uuid;
  v_total integer;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  -- Verify caller is school_admin or super_admin
  if not (public.is_super_admin(v_uid) or public.oly_is_school_admin_for(v_uid, p_oly_school_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock school row + check status (FOR UPDATE prevents concurrent publish triggers)
  select id, campaign_id, status
    into v_school
    from public.oly_schools where id = p_oly_school_id for update;
  if v_school.id is null then raise exception 'School not found'; end if;
  if v_school.status = 'results_published' then
    raise exception 'Results already published';
  end if;
  if v_school.status not in ('batches_scheduled', 'exam_in_progress') then
    raise exception 'Cannot publish from status %', v_school.status;
  end if;

  -- Count active students in this school for the job tracker
  select count(*) into v_total
    from public.oly_students s
   where s.oly_school_id = p_oly_school_id
     and s.status = 'active';

  -- Upsert job row (unique constraint on oly_school_id prevents duplicate jobs;
  -- re-running after a failure resets the job to queued)
  insert into public.oly_publish_jobs (oly_school_id, campaign_id, initiated_by, total_students, status, started_at)
    values (p_oly_school_id, v_school.campaign_id, v_uid, v_total, 'queued', now())
  on conflict (oly_school_id) do update set
    status = 'queued',
    started_at = now(),
    error = null,
    failed_students = 0,
    failure_details = '[]'::jsonb,
    processed_students = 0,
    total_students = excluded.total_students
  returning id into v_job_id;

  -- Lock the exam window — no further attempts allowed
  update public.oly_schools set status = 'results_published' where id = p_oly_school_id;

  -- Audit log — use 'results_published' (added to constraint above)
  insert into public.oly_audit_log (campaign_id, oly_school_id, actor_id, actor_role, action, after_json)
    values (
      v_school.campaign_id, p_oly_school_id, v_uid,
      case when public.is_super_admin(v_uid) then 'super_admin' else 'school_admin' end,
      'results_published',
      jsonb_build_object('job_id', v_job_id, 'total_students', v_total)
    );

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'total_students', v_total);
end;
$$;

grant execute on function public.oly_publish_initiate(uuid) to authenticated;

-- =========================================================================
-- 6. oly_publish_compute_ranks(p_oly_school_id)
-- Called by the edge function orchestrator.
-- Single window-function query computes class + school ranks and writes oly_results rows.
-- ON CONFLICT DO NOTHING makes re-runs idempotent.
-- =========================================================================
create or replace function public.oly_publish_compute_ranks(p_oly_school_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid;
  v_campaign_year integer;
  v_gold_threshold numeric;
  v_silver_threshold numeric;
  v_bronze_threshold numeric;
  v_inserted integer;
  v_absent_inserted integer;
begin
  -- Allow school_admin, super_admin, or service_role (edge function)
  if not (
    public.is_super_admin(auth.uid())
    or public.oly_is_school_admin_for(auth.uid(), p_oly_school_id)
    or current_user = 'service_role'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select campaign_id into v_campaign_id from public.oly_schools where id = p_oly_school_id;
  if v_campaign_id is null then raise exception 'School not found'; end if;

  select campaign_year, gold_threshold_percent, silver_threshold_percent, bronze_threshold_percent
    into v_campaign_year, v_gold_threshold, v_silver_threshold, v_bronze_threshold
    from public.oly_campaigns where id = v_campaign_id;

  -- Insert results for students who attempted (any terminal status)
  -- Class rank: RANK() OVER (PARTITION BY grade_level_id ORDER BY percentage DESC, time_seconds ASC)
  -- School rank: RANK() OVER (ORDER BY percentage DESC, time_seconds ASC)
  -- Ties handled by RANK() — tied students get same rank, next rank is skipped.
  -- Tie-break is time_seconds ASC so faster student ranks higher on equal score.
  with ranked as (
    select
      a.id as attempt_id,
      a.oly_student_id,
      s.oly_school_id,
      s.grade_level_id,
      a.total_marks_obtained,
      a.total_max_marks,
      a.percentage,
      a.subject_scores,
      extract(epoch from (a.submitted_at - a.started_at))::integer as time_seconds,
      -- Class rank partitioned by grade_level_id (all sections of same grade share a class rank)
      rank() over (
        partition by s.grade_level_id
        order by a.percentage desc nulls last,
                 extract(epoch from (a.submitted_at - a.started_at)) asc
      ) as class_rank,
      count(*) over (partition by s.grade_level_id) as class_total,
      -- School-wide rank
      rank() over (
        order by a.percentage desc nulls last,
                 extract(epoch from (a.submitted_at - a.started_at)) asc
      ) as school_rank,
      count(*) over () as school_total
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id
      and s.status = 'active'
      and a.status != 'in_progress'
  )
  insert into public.oly_results (
    oly_student_id, oly_attempt_id, campaign_id, oly_school_id,
    total_marks_obtained, total_max_marks, percentage, subject_scores,
    total_time_seconds,
    class_rank, class_total, school_rank, school_total,
    certificate_tier, certificate_id
  )
  select
    r.oly_student_id, r.attempt_id, v_campaign_id, r.oly_school_id,
    r.total_marks_obtained, r.total_max_marks, r.percentage, r.subject_scores,
    r.time_seconds,
    r.class_rank::integer, r.class_total::integer,
    r.school_rank::integer, r.school_total::integer,
    case
      when r.percentage >= v_gold_threshold   then 'gold'
      when r.percentage >= v_silver_threshold then 'silver'
      when r.percentage >= v_bronze_threshold then 'bronze'
      else 'participation'
    end as certificate_tier,
    'CERT-' || v_campaign_year::text || '-' || lpad(nextval('public.oly_certificate_seq')::text, 7, '0')
  from ranked r
  on conflict (oly_student_id) do nothing;

  get diagnostics v_inserted = row_count;

  -- Insert absent rows for active students with no terminal attempt
  -- (no attempt row at all, OR only an in_progress attempt)
  insert into public.oly_results (
    oly_student_id, oly_attempt_id, campaign_id, oly_school_id,
    total_marks_obtained, total_max_marks, percentage, subject_scores,
    certificate_tier, certificate_id
  )
  select
    s.id, null, v_campaign_id, s.oly_school_id,
    0, 0, 0, '[]'::jsonb,
    'absent',
    'CERT-' || v_campaign_year::text || '-' || lpad(nextval('public.oly_certificate_seq')::text, 7, '0')
  from public.oly_students s
  left join public.oly_attempts a
    on a.oly_student_id = s.id
   and a.status != 'in_progress'
  where s.oly_school_id = p_oly_school_id
    and s.status = 'active'
    and a.id is null
  on conflict (oly_student_id) do nothing;

  get diagnostics v_absent_inserted = row_count;

  return jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'absent_inserted', v_absent_inserted
  );
end;
$$;

grant execute on function public.oly_publish_compute_ranks(uuid) to authenticated;

-- =========================================================================
-- 7. oly_get_published_result(p_student_id)
-- STABLE — safe to cache. Self-lookup when p_student_id is null.
-- Returns jsonb with { ok: true, ...fields } or { ok: false, reason }.
-- =========================================================================
create or replace function public.oly_get_published_result(p_student_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_result public.oly_results%rowtype;
  v_student public.oly_students%rowtype;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  if p_student_id is null then
    -- Self-lookup: find the oly_student row linked to this user
    select id into v_target
      from public.oly_students
     where (auth_user_id = v_uid or profile_id = v_uid)
       and status = 'active'
     limit 1;
  else
    v_target := p_student_id;
    if not public.oly_student_can_read(v_uid, v_target) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  if v_target is null then
    return jsonb_build_object('ok', false, 'reason', 'no_enrollment');
  end if;

  select * into v_result
    from public.oly_results
   where oly_student_id = v_target;

  if v_result.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_published_yet');
  end if;

  select * into v_student
    from public.oly_students
   where id = v_target;

  return jsonb_build_object(
    'ok',                  true,
    'result_id',           v_result.id,
    'full_name',           v_student.full_name,
    'roll_number',         v_student.roll_number,
    'class_label',         v_student.class_label,
    'section_label',       v_student.section_label,
    'total_marks_obtained',v_result.total_marks_obtained,
    'total_max_marks',     v_result.total_max_marks,
    'percentage',          v_result.percentage,
    'subject_scores',      v_result.subject_scores,
    'total_time_seconds',  v_result.total_time_seconds,
    'class_rank',          v_result.class_rank,
    'class_total',         v_result.class_total,
    'school_rank',         v_result.school_rank,
    'school_total',        v_result.school_total,
    'certificate_tier',    v_result.certificate_tier,
    'certificate_id',      v_result.certificate_id,
    'result_pdf_path',     v_result.result_pdf_path,
    'certificate_pdf_path',v_result.certificate_pdf_path,
    'published_at',        v_result.published_at
  );
end;
$$;

grant execute on function public.oly_get_published_result(uuid) to authenticated;

-- =========================================================================
-- 8. oly_get_published_signed_url_path(p_result_id, p_kind)
-- STABLE — returns storage path after ownership / scope check.
-- Client uses this path with supabase.storage.from(bucket).createSignedUrl(path, ttl).
-- =========================================================================
create or replace function public.oly_get_published_signed_url_path(
  p_result_id uuid,
  p_kind text
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_path text;
  v_owner_student uuid;
  v_owner_school uuid;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_kind not in ('result', 'certificate') then
    raise exception 'Invalid kind — must be result or certificate';
  end if;

  select
    case when p_kind = 'result' then result_pdf_path else certificate_pdf_path end,
    oly_student_id,
    oly_school_id
    into v_path, v_owner_student, v_owner_school
    from public.oly_results
   where id = p_result_id;

  if v_path is null then
    raise exception 'PDF not yet generated' using errcode = 'P0002';
  end if;

  -- Scope check: super_admin OR school_admin of that school OR the student themselves
  if not (
    public.is_super_admin(v_uid)
    or public.oly_is_school_admin_for(v_uid, v_owner_school)
    or public.oly_student_can_read(v_uid, v_owner_student)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return v_path;
end;
$$;

grant execute on function public.oly_get_published_signed_url_path(uuid, text) to authenticated;
