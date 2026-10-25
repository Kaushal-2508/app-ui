-- Whole-Olympiad review fix:
-- oly_publish_compute_ranks's `current_user = 'service_role'` branch is broken.
-- Inside a SECURITY DEFINER function, current_user is the function OWNER (postgres),
-- not the caller's role. PostgREST's service-role-key requests would always fail the
-- check, so every orchestrator-initiated publish would 403.
-- Replace with auth.role() which reads from the JWT and works regardless of definer/invoker.
-- Body otherwise identical to migration 20260527000016.

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
  if not (
    public.is_super_admin(auth.uid())
    or public.oly_is_school_admin_for(auth.uid(), p_oly_school_id)
    or auth.role() = 'service_role'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select campaign_id into v_campaign_id from public.oly_schools where id = p_oly_school_id;
  if v_campaign_id is null then raise exception 'School not found'; end if;

  select campaign_year, gold_threshold_percent, silver_threshold_percent, bronze_threshold_percent
    into v_campaign_year, v_gold_threshold, v_silver_threshold, v_bronze_threshold
    from public.oly_campaigns where id = v_campaign_id;

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
