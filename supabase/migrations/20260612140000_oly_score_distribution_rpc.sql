-- Class-filtered Score distribution for the Analytics tab's per-card filter.
-- Same buckets as oly_school_report (20260609140000) and the same auth gate
-- as oly_school_subject_topic_stats (20260612090000); "all classes" keeps
-- using the unfiltered numbers already present in the report RPC.

create or replace function public.oly_school_score_distribution(
  p_oly_school_id uuid,
  p_grade_level_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_inst uuid;
begin
  select institution_id into v_inst from public.oly_schools where id = p_oly_school_id;
  if v_inst is null then
    return '[]'::jsonb;
  end if;

  -- Super admin, or any member of the school's own institution (admin/coordinator).
  if not (public.is_super_admin(auth.uid()) or public.get_user_institution(auth.uid()) = v_inst) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return (
    with att as (
      select a.percentage
      from public.oly_attempts a
      join public.oly_students s on s.id = a.oly_student_id
      where s.oly_school_id = p_oly_school_id
        and a.status <> 'in_progress'
        and (p_grade_level_id is null or s.grade_level_id = p_grade_level_id)
    )
    select jsonb_build_array(
      jsonb_build_object('bucket', '0-40',   'count', count(*) filter (where percentage < 40)),
      jsonb_build_object('bucket', '40-60',  'count', count(*) filter (where percentage >= 40 and percentage < 60)),
      jsonb_build_object('bucket', '60-75',  'count', count(*) filter (where percentage >= 60 and percentage < 75)),
      jsonb_build_object('bucket', '75-90',  'count', count(*) filter (where percentage >= 75 and percentage < 90)),
      jsonb_build_object('bucket', '90-100', 'count', count(*) filter (where percentage >= 90))
    ) from att
  );
end;
$$;

grant execute on function public.oly_school_score_distribution(uuid, uuid) to authenticated;
