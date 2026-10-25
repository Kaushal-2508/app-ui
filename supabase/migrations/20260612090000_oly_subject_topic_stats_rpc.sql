-- Filtered companion to oly_school_report for the Analytics tab's per-card
-- filters: Subject performance (class filter) and Weakest chapters (class +
-- subject filters). Same auth gate and aggregation as the parent RPC
-- (20260609140000), scoped by optional grade level / subject. One
-- server-aggregated round-trip per filter change (CLAUDE.md §23).

create or replace function public.oly_school_subject_topic_stats(
  p_oly_school_id uuid,
  p_grade_level_id uuid default null,
  p_subject_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_inst uuid;
begin
  select institution_id into v_inst from public.oly_schools where id = p_oly_school_id;
  if v_inst is null then
    return jsonb_build_object('found', false);
  end if;

  -- Super admin, or any member of the school's own institution (admin/coordinator).
  if not (public.is_super_admin(auth.uid()) or public.get_user_institution(auth.uid()) = v_inst) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return (
    with ans as (
      select qs.subject_id, qs.topic_id, (an.selected_answer = qs.correct_answer) as is_correct
      from public.oly_answers an
      join public.oly_questions_snapshot qs on qs.id = an.oly_question_snapshot_id
      join public.oly_attempts a on a.id = qs.oly_attempt_id
      join public.oly_students s on s.id = a.oly_student_id
      where s.oly_school_id = p_oly_school_id
        and a.status <> 'in_progress'
        and (p_grade_level_id is null or s.grade_level_id = p_grade_level_id)
        and (p_subject_id is null or qs.subject_id = p_subject_id)
    )
    select jsonb_build_object(
      'found', true,
      'subject_performance', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'subject_name', sub.name,
                 'pct_correct', round((g.correct::numeric / nullif(g.total, 0)) * 100, 1),
                 'correct', g.correct, 'total', g.total
               ) order by (g.correct::numeric / nullif(g.total, 0)) desc)
        from (select subject_id, count(*) total, count(*) filter (where is_correct) correct
              from ans group by subject_id) g
        join public.oly_subjects sub on sub.id = g.subject_id
      ), '[]'::jsonb),
      'weak_topics', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'topic_name', tp.name, 'subject_name', sub.name,
                 'pct_correct', round((g.correct::numeric / nullif(g.total, 0)) * 100, 1),
                 'questions', g.total
               ) order by (g.correct::numeric / nullif(g.total, 0)) asc)
        from (select topic_id, count(*) total, count(*) filter (where is_correct) correct
              from ans where topic_id is not null group by topic_id
              order by (count(*) filter (where is_correct))::numeric / nullif(count(*), 0) asc
              limit 10) g
        join public.oly_topics tp on tp.id = g.topic_id
        join public.oly_subjects sub on sub.id = tp.subject_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.oly_school_subject_topic_stats(uuid, uuid, uuid) to authenticated;
