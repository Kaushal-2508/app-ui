-- Phase 3 — super-admin per-school aggregation. All SECURITY DEFINER + super_admin gated.
-- Derived stage is computed in ONE helper reused by overview + schools_by_stage.

-- all-exams-finished: >=1 non-absentee batch and all such batches completed,
-- and no in-progress attempts. Zero-batch schools never reach exam_completed.
create or replace function public.oly_school_derived_stage(p_oly_school_id uuid)
returns text language sql stable security definer set search_path = public as $$
  with sc as (select status from public.oly_schools where id = p_oly_school_id),
  batches as (
    select count(*) filter (where not is_absentees) as total,
           count(*) filter (where not is_absentees and status = 'completed') as done
    from public.oly_batches where oly_school_id = p_oly_school_id
  ),
  inflight as (
    select count(*) as n
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id and a.status = 'in_progress'
  )
  select case
    when (select status from sc) in ('results_published','archived') then 'exam_completed'
    when (select status from sc) = 'exam_in_progress'
         and (select total from batches) > 0
         and (select total from batches) = (select done from batches)
         and (select n from inflight) = 0 then 'exam_completed'
    when (select status from sc) = 'exam_in_progress' then 'exam_in_progress'
    when (select status from sc) = 'batches_scheduled' then 'exam_scheduled'
    else 'enrollment'
  end;
$$;
grant execute on function public.oly_school_derived_stage(uuid) to authenticated;

-- 1) overview: single row of stage + counts + payment split
create or replace function public.oly_school_overview(p_oly_school_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'derived_stage', public.oly_school_derived_stage(p_oly_school_id),
    'total_students', (select count(*) from public.oly_students s where s.oly_school_id = p_oly_school_id and s.status = 'active'),
    'attempted_count', (select count(*) from public.oly_attempts a join public.oly_students s on s.id = a.oly_student_id where s.oly_school_id = p_oly_school_id and a.status <> 'in_progress'),
    'cash_count', (select count(*) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'teacher_cash'),
    'cash_paise', coalesce((select sum(ep.total_paise) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'teacher_cash'), 0),
    'online_count', (select count(*) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'parent_online'),
    'online_paise', coalesce((select sum(ep.total_paise) from public.oly_enrollment_pending ep join public.oly_students s on s.id = ep.promoted_student_id where ep.oly_school_id = p_oly_school_id and ep.status = 'paid' and s.enrollment_channel = 'parent_online'), 0),
    'results_published', exists (select 1 from public.oly_results r where r.oly_school_id = p_oly_school_id)
  ) into v;
  return v;
end;
$$;
grant execute on function public.oly_school_overview(uuid) to authenticated;

-- 2) payment list: paginated students per channel (cursor = updated_at desc)
create or replace function public.oly_school_payment_list(
  p_oly_school_id uuid, p_channel text, p_limit int default 50, p_cursor timestamptz default null
) returns table (
  oly_student_id uuid, full_name text, roll_number text,
  total_paise integer, gst_paise integer,
  gateway_order_id text, gateway_payment_id text, paid_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select s.id, s.full_name, s.roll_number,
           ep.total_paise, ep.gst_paise,
           ep.gateway_order_id, ep.gateway_payment_id, ep.updated_at
    from public.oly_enrollment_pending ep
    join public.oly_students s on s.id = ep.promoted_student_id
    where ep.oly_school_id = p_oly_school_id
      and ep.status = 'paid'
      and s.enrollment_channel = (case when p_channel = 'cash' then 'teacher_cash' else 'parent_online' end)
      and (p_cursor is null or ep.updated_at < p_cursor)
    order by ep.updated_at desc
    limit greatest(1, least(p_limit, 200));
end;
$$;
grant execute on function public.oly_school_payment_list(uuid,text,int,timestamptz) to authenticated;

-- 3) result summary: published -> oly_results; else provisional from terminal attempts
create or replace function public.oly_school_result_summary(p_oly_school_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_published boolean;
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  v_published := exists (select 1 from public.oly_results r where r.oly_school_id = p_oly_school_id);
  if v_published then
    select jsonb_build_object(
      'published', true,
      'gold_count', count(*) filter (where certificate_tier = 'gold'),
      'silver_count', count(*) filter (where certificate_tier = 'silver'),
      'bronze_count', count(*) filter (where certificate_tier = 'bronze'),
      'participation_count', count(*) filter (where certificate_tier = 'participation'),
      'absent_count', count(*) filter (where certificate_tier = 'absent'),
      'avg_percentage', round(coalesce(avg(percentage) filter (where certificate_tier <> 'absent'), 0), 2),
      'top_scorers', (
        select coalesce(jsonb_agg(t), '[]'::jsonb) from (
          select s.full_name, s.roll_number, r2.percentage, r2.school_rank
          from public.oly_results r2 join public.oly_students s on s.id = r2.oly_student_id
          where r2.oly_school_id = p_oly_school_id and r2.school_rank is not null
          order by r2.school_rank asc limit 3
        ) t)
    ) into v from public.oly_results where oly_school_id = p_oly_school_id;
  else
    select jsonb_build_object(
      'published', false,
      'attempted_count', count(*),
      'avg_percentage', round(coalesce(avg(a.percentage), 0), 2),
      'top_scorers', '[]'::jsonb
    ) into v
    from public.oly_attempts a join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id and a.status <> 'in_progress';
  end if;
  return v;
end;
$$;
grant execute on function public.oly_school_result_summary(uuid) to authenticated;

-- 4) schools by stage bucket + type (cursor = created_at desc)
create or replace function public.oly_schools_by_stage(
  p_campaign_id uuid, p_bucket text, p_school_type text default 'all',
  p_limit int default 50, p_cursor timestamptz default null
) returns table (
  id uuid, institution_name text, school_short_code text,
  city text, state text, status text, is_existing boolean,
  enrolled_count bigint, derived_stage text, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select sc.id, i.name, sc.school_short_code, sc.city, sc.state, sc.status,
           sc.is_existing_salci_school,
           (select count(*) from public.oly_students s where s.oly_school_id = sc.id and s.status = 'active'),
           public.oly_school_derived_stage(sc.id),
           sc.created_at
    from public.oly_schools sc
    join public.institutions i on i.id = sc.institution_id
    where sc.campaign_id = p_campaign_id
      and (p_school_type = 'all'
           or (p_school_type = 'new' and sc.is_existing_salci_school = false)
           or (p_school_type = 'existing' and sc.is_existing_salci_school = true))
      and (
        (p_bucket = 'done' and public.oly_school_derived_stage(sc.id) = 'exam_completed')
        or (p_bucket = 'in_progress' and public.oly_school_derived_stage(sc.id) <> 'exam_completed')
      )
      and (p_cursor is null or sc.created_at < p_cursor)
    order by sc.created_at desc
    limit greatest(1, least(p_limit, 200));
end;
$$;
grant execute on function public.oly_schools_by_stage(uuid,text,text,int,timestamptz) to authenticated;
