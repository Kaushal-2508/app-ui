-- Class × subject cross-analysis for the Analytics tab ("students vs subjects
-- vs class"): per class and subject, how many students answered and what %
-- they got correct. Same auth gate and aggregation plane as
-- oly_school_subject_topic_stats (20260612090000); one server-aggregated
-- round-trip (CLAUDE.md §23).

create or replace function public.oly_school_class_subject_matrix(p_oly_school_id uuid)
returns table (
  grade_level_id uuid,
  class_label text,
  subject_id uuid,
  subject_name text,
  students bigint,
  pct_correct numeric
) language plpgsql stable security definer set search_path = public as $$
declare
  v_inst uuid;
begin
  select institution_id into v_inst from public.oly_schools where id = p_oly_school_id;
  if v_inst is null then return; end if;

  -- Super admin, or any member of the school's own institution (admin/coordinator).
  if not (public.is_super_admin(auth.uid()) or public.get_user_institution(auth.uid()) = v_inst) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select s.grade_level_id,
           gl.grade_name::text,
           qs.subject_id,
           sub.name::text,
           count(distinct a.oly_student_id)::bigint,
           round(
             count(*) filter (where an.selected_answer = qs.correct_answer)::numeric
             / nullif(count(*), 0) * 100, 1)
      from public.oly_answers an
      join public.oly_questions_snapshot qs on qs.id = an.oly_question_snapshot_id
      join public.oly_attempts a on a.id = qs.oly_attempt_id
      join public.oly_students s on s.id = a.oly_student_id
      join public.grade_levels gl on gl.id = s.grade_level_id
      join public.oly_subjects sub on sub.id = qs.subject_id
     where s.oly_school_id = p_oly_school_id
       and a.status <> 'in_progress'
     group by s.grade_level_id, gl.grade_name, gl.display_order, qs.subject_id, sub.name
     order by gl.display_order, sub.name;
end;
$$;

grant execute on function public.oly_school_class_subject_matrix(uuid) to authenticated;
