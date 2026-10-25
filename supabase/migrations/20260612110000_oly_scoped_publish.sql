-- Scoped (class-wise / batch-wise) results publishing with automatic merge.
--
-- Before: oly_publish_initiate was all-or-nothing — it flipped the school to
-- results_published immediately and oly_publish_compute_ranks marked EVERY
-- active student without a terminal attempt absent, with ON CONFLICT DO
-- NOTHING freezing ranks at first publish (late sitters could never merge).
--
-- Now:
--   * oly_publish_initiate(school, grade_level_ids?, batch_ids?) — a scoped
--     run publishes only the selected classes/batches and does NOT flip the
--     school status, so remaining batches can still run. A whole-school run
--     (no scope) keeps the old final semantics (status flip = exam closed).
--   * oly_publish_compute_ranks(school, grade_level_ids?, batch_ids?):
--       A) upgrade pass — absent rows whose student has since produced a
--          terminal attempt get their real scores/tier, PDFs + email reset;
--       B) insert results for in-scope terminal attempts;
--       C) absent rows only for in-scope students with no terminal attempt —
--          and, on scoped runs, no FUTURE pending batch (they still get
--          their chance; the next publish merges them in);
--       D) merge re-rank — ranks recomputed over ALL published attempts
--          school-wide; rows whose ranks moved get result_pdf_path nulled so
--          the orchestrator regenerates them (emails are NOT resent).
--   * oly_publish_jobs gains scope columns (single-row-per-school invariant
--     unchanged — each run reuses the row) + a running-run guard.

alter table public.oly_publish_jobs
  add column if not exists scope_grade_level_ids uuid[],
  add column if not exists scope_batch_ids uuid[];

-- ---------------------------------------------------------------------------
-- oly_publish_initiate(school, grades?, batches?)
-- ---------------------------------------------------------------------------
drop function if exists public.oly_publish_initiate(uuid);

create or replace function public.oly_publish_initiate(
  p_oly_school_id uuid,
  p_grade_level_ids uuid[] default null,
  p_batch_ids uuid[] default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_school record;
  v_job record;
  v_job_id uuid;
  v_total integer;
  v_grades uuid[] := nullif(p_grade_level_ids, '{}'::uuid[]);
  v_batches uuid[] := nullif(p_batch_ids, '{}'::uuid[]);
  v_scoped boolean;
begin
  v_scoped := v_grades is not null or v_batches is not null;

  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not (public.is_super_admin(v_uid) or public.oly_is_school_admin_for(v_uid, p_oly_school_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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

  -- One publish run at a time per school (the job row is shared across runs).
  select status, updated_at into v_job
    from public.oly_publish_jobs where oly_school_id = p_oly_school_id;
  if v_job.status in ('queued', 'computing_ranks', 'generating_pdfs', 'sending_emails')
     and v_job.updated_at > now() - interval '10 minutes' then
    raise exception 'A publish run is already in progress — wait for it to finish.';
  end if;

  -- Students in scope, for the job tracker.
  select count(*) into v_total
    from public.oly_students s
   where s.oly_school_id = p_oly_school_id
     and s.status = 'active'
     and (v_grades is null or s.grade_level_id = any(v_grades))
     and (v_batches is null or exists (
            select 1 from public.oly_batch_assignments ba
             where ba.oly_student_id = s.id and ba.oly_batch_id = any(v_batches)));

  insert into public.oly_publish_jobs
      (oly_school_id, campaign_id, initiated_by, total_students, status, started_at,
       scope_grade_level_ids, scope_batch_ids)
    values
      (p_oly_school_id, v_school.campaign_id, v_uid, v_total, 'queued', now(),
       v_grades, v_batches)
  on conflict (oly_school_id) do update set
    status = 'queued',
    started_at = now(),
    error = null,
    failed_students = 0,
    failure_details = '[]'::jsonb,
    processed_students = 0,
    total_students = excluded.total_students,
    scope_grade_level_ids = excluded.scope_grade_level_ids,
    scope_batch_ids = excluded.scope_batch_ids,
    initiated_by = excluded.initiated_by
  returning id into v_job_id;

  -- Whole-school publish is final: lock the exam window. Scoped publishes
  -- leave the school open so remaining batches can still run.
  if not v_scoped then
    update public.oly_schools set status = 'results_published' where id = p_oly_school_id;
  end if;

  insert into public.oly_audit_log (campaign_id, oly_school_id, actor_id, actor_role, action, after_json)
    values (
      v_school.campaign_id, p_oly_school_id, v_uid,
      case when public.is_super_admin(v_uid) then 'super_admin' else 'school_admin' end,
      'results_published',
      jsonb_build_object(
        'job_id', v_job_id, 'total_students', v_total, 'scoped', v_scoped,
        'scope_grade_level_ids', to_jsonb(coalesce(v_grades, '{}'::uuid[])),
        'scope_batch_ids', to_jsonb(coalesce(v_batches, '{}'::uuid[]))
      )
    );

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'total_students', v_total, 'scoped', v_scoped);
end;
$$;

grant execute on function public.oly_publish_initiate(uuid, uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- oly_publish_compute_ranks(school, grades?, batches?)
-- ---------------------------------------------------------------------------
drop function if exists public.oly_publish_compute_ranks(uuid);

create or replace function public.oly_publish_compute_ranks(
  p_oly_school_id uuid,
  p_grade_level_ids uuid[] default null,
  p_batch_ids uuid[] default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid;
  v_campaign_year integer;
  v_gold_threshold numeric;
  v_silver_threshold numeric;
  v_bronze_threshold numeric;
  v_grades uuid[] := nullif(p_grade_level_ids, '{}'::uuid[]);
  v_batches uuid[] := nullif(p_batch_ids, '{}'::uuid[]);
  v_scoped boolean;
  v_upgraded integer;
  v_inserted integer;
  v_absent_inserted integer;
  v_reranked integer;
begin
  v_scoped := v_grades is not null or v_batches is not null;

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

  -- A) MERGE UPGRADE: students published as absent who have since produced a
  --    terminal attempt (rescheduled into a later/absentee batch). Their row
  --    gets the real scores + threshold tier; PDFs and email reset so the
  --    orchestrator regenerates and notifies. certificate_id is kept.
  update public.oly_results r
     set oly_attempt_id = a.id,
         total_marks_obtained = a.total_marks_obtained,
         total_max_marks = a.total_max_marks,
         percentage = a.percentage,
         subject_scores = a.subject_scores,
         total_time_seconds = extract(epoch from (a.submitted_at - a.started_at))::integer,
         certificate_tier = case
           when a.percentage >= v_gold_threshold   then 'gold'
           when a.percentage >= v_silver_threshold then 'silver'
           when a.percentage >= v_bronze_threshold then 'bronze'
           else 'participation'
         end,
         result_pdf_path = null,
         result_pdf_generated_at = null,
         certificate_pdf_path = null,
         certificate_pdf_generated_at = null,
         emailed_at = null,
         published_at = now()
    from public.oly_attempts a
   where r.oly_school_id = p_oly_school_id
     and r.certificate_tier = 'absent'
     and a.oly_student_id = r.oly_student_id
     and a.status != 'in_progress';
  get diagnostics v_upgraded = row_count;

  -- B) Insert results for in-scope students with terminal attempts. Ranks in
  --    this insert are computed over ALL terminal attempts school-wide (the
  --    merge re-rank in step D keeps previously published rows consistent).
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
      rank() over (
        partition by s.grade_level_id
        order by a.percentage desc nulls last,
                 extract(epoch from (a.submitted_at - a.started_at)) asc
      ) as class_rank,
      count(*) over (partition by s.grade_level_id) as class_total,
      rank() over (
        order by a.percentage desc nulls last,
                 extract(epoch from (a.submitted_at - a.started_at)) asc
      ) as school_rank,
      count(*) over () as school_total,
      (
        (v_grades is null or s.grade_level_id = any(v_grades))
        and (v_batches is null or exists (
               select 1 from public.oly_batch_assignments ba
                where ba.oly_student_id = s.id and ba.oly_batch_id = any(v_batches)))
      ) as in_scope
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
  where r.in_scope
  on conflict (oly_student_id) do nothing;
  get diagnostics v_inserted = row_count;

  -- C) Absent rows for in-scope students with no terminal attempt. On a
  --    SCOPED run, students who still have a FUTURE pending batch are spared —
  --    they get their chance and merge in on the next publish. A whole-school
  --    run is final: everyone without an attempt is absent.
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
    and (v_grades is null or s.grade_level_id = any(v_grades))
    and (v_batches is null or exists (
           select 1 from public.oly_batch_assignments ba
            where ba.oly_student_id = s.id and ba.oly_batch_id = any(v_batches)))
    and (not v_scoped or not exists (
           select 1 from public.oly_batch_assignments ba
           join public.oly_batches b on b.id = ba.oly_batch_id
          where ba.oly_student_id = s.id
            and b.status in ('draft', 'locked', 'in_progress')
            and b.scheduled_at > now()))
  on conflict (oly_student_id) do nothing;
  get diagnostics v_absent_inserted = row_count;

  -- D) MERGE RE-RANK: recompute ranks over ALL terminal attempts school-wide
  --    and update any published row whose ranks moved. Their result PDF is
  --    stale (it shows ranks) so it's nulled for regeneration; certificates
  --    are threshold-based and unaffected; emails are NOT resent.
  with ranked as (
    select
      a.oly_student_id,
      rank() over (
        partition by s.grade_level_id
        order by a.percentage desc nulls last,
                 extract(epoch from (a.submitted_at - a.started_at)) asc
      ) as class_rank,
      count(*) over (partition by s.grade_level_id) as class_total,
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
  update public.oly_results r
     set class_rank = k.class_rank::integer,
         class_total = k.class_total::integer,
         school_rank = k.school_rank::integer,
         school_total = k.school_total::integer,
         result_pdf_path = null,
         result_pdf_generated_at = null
    from ranked k
   where r.oly_school_id = p_oly_school_id
     and r.oly_student_id = k.oly_student_id
     and (r.class_rank is distinct from k.class_rank::integer
          or r.class_total is distinct from k.class_total::integer
          or r.school_rank is distinct from k.school_rank::integer
          or r.school_total is distinct from k.school_total::integer);
  get diagnostics v_reranked = row_count;

  return jsonb_build_object(
    'ok', true,
    'upgraded', v_upgraded,
    'inserted', v_inserted,
    'absent_inserted', v_absent_inserted,
    'reranked', v_reranked
  );
end;
$$;

grant execute on function public.oly_publish_compute_ranks(uuid, uuid[], uuid[]) to authenticated;
