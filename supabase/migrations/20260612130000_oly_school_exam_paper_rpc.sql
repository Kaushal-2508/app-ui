-- "View Exam" for school staff: the full class-wise question pool the
-- Olympiad draws from (oly_questions is super-admin-only via RLS, so school
-- access goes through this SECURITY DEFINER RPC). Available regardless of
-- exam stage — before, during and after exam day. Set-returning so the
-- client can paginate with .range() (CLAUDE.md §23).

create or replace function public.oly_school_exam_paper(
  p_oly_school_id uuid,
  p_grade_level_id uuid
) returns table (
  id uuid,
  subject_id uuid,
  subject_name text,
  topic_name text,
  question_text text,
  option_a text,
  option_b text,
  option_c text,
  option_d text,
  correct_answer text,
  image_url text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_super_admin(auth.uid()) or public.oly_is_school_admin_for(auth.uid(), p_oly_school_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- The school must actually participate in this grade.
  if not exists (
    select 1 from public.oly_schools sc
     where sc.id = p_oly_school_id
       and p_grade_level_id = any(sc.participating_grade_level_ids)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select q.id, q.subject_id, sub.name::text, tp.name::text,
           q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
           q.correct_answer::text, q.image_url
      from public.oly_questions q
      join public.oly_subjects sub on sub.id = q.subject_id
      left join public.oly_topics tp on tp.id = q.topic_id
     where q.grade_level_id = p_grade_level_id
       and q.status = 'active'
     order by sub.name, tp.name nulls last, q.created_at;
end;
$$;

grant execute on function public.oly_school_exam_paper(uuid, uuid) to authenticated;
