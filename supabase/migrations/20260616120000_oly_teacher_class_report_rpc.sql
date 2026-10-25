-- 20260616120000_oly_teacher_class_report_rpc.sql
-- Class-scoped analytics for the TEACHER Olympiad results panel. A grade-scoped
-- clone of oly_school_report (20260609140000): every CTE/aggregate is filtered to
-- the teacher's single assigned (school, grade). Auth is via oly_is_teacher_for_class
-- (NOT institution membership) — we must never reuse oly_school_report for teachers,
-- because its get_user_institution gate would admit a teacher to WHOLE-SCHOOL data
-- including other grades and revenue. Revenue is deliberately OMITTED here.
--
-- One server-aggregated round-trip (CLAUDE.md §23). Performance data comes from
-- oly_attempts + oly_answers + the question snapshot (live, pre-purge); medal tiers
-- come from oly_results once published. Returns sensible zeros/empty arrays before
-- an exam runs. No schema/table/RLS changes — pure function migration.

create or replace function public.oly_teacher_class_report(
  p_oly_school_id uuid,
  p_grade_level_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_enrolled integer;
  v_appeared integer;
  v_published boolean;
begin
  -- Class-scoped auth: only a teacher assigned to THIS (school, grade) pair.
  if not public.oly_is_teacher_for_class(auth.uid(), p_oly_school_id, p_grade_level_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_enrolled := (select count(*) from public.oly_students s
                  where s.oly_school_id = p_oly_school_id
                    and s.grade_level_id = p_grade_level_id and s.status = 'active');
  v_appeared := (select count(*) from public.oly_attempts a
                  join public.oly_students s on s.id = a.oly_student_id
                  where s.oly_school_id = p_oly_school_id
                    and s.grade_level_id = p_grade_level_id and a.status <> 'in_progress');
  v_published := exists (select 1 from public.oly_results r
                          join public.oly_students s on s.id = r.oly_student_id
                          where r.oly_school_id = p_oly_school_id
                            and s.grade_level_id = p_grade_level_id);

  with att as (
    select a.oly_student_id, a.percentage, a.total_marks_obtained
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id
      and s.grade_level_id = p_grade_level_id and a.status <> 'in_progress'
  ),
  ans as (
    select qs.subject_id, qs.topic_id, (an.selected_answer = qs.correct_answer) as is_correct
    from public.oly_answers an
    join public.oly_questions_snapshot qs on qs.id = an.oly_question_snapshot_id
    join public.oly_attempts a on a.id = qs.oly_attempt_id
    join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id
      and s.grade_level_id = p_grade_level_id and a.status <> 'in_progress'
  )
  select jsonb_build_object(
    'found', true,
    'results_available', v_appeared > 0,
    'results_published', v_published,
    'enrolled', v_enrolled,
    'appeared', v_appeared,
    'absent', greatest(v_enrolled - v_appeared, 0),
    'avg_percentage', coalesce((select round(avg(percentage), 1) from att), 0),
    'max_percentage', coalesce((select round(max(percentage), 1) from att), 0),
    'avg_marks', coalesce((select round(avg(total_marks_obtained), 1) from att), 0),
    'channel', jsonb_build_object(
      'online', (select count(*) from public.oly_students where oly_school_id = p_oly_school_id and grade_level_id = p_grade_level_id and status = 'active' and enrollment_channel = 'parent_online'),
      'cash',   (select count(*) from public.oly_students where oly_school_id = p_oly_school_id and grade_level_id = p_grade_level_id and status = 'active' and enrollment_channel = 'teacher_cash')
    ),
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
    ), '[]'::jsonb),
    'score_distribution', (
      select jsonb_build_array(
        jsonb_build_object('bucket', '0-40',   'count', count(*) filter (where percentage < 40)),
        jsonb_build_object('bucket', '40-60',  'count', count(*) filter (where percentage >= 40 and percentage < 60)),
        jsonb_build_object('bucket', '60-75',  'count', count(*) filter (where percentage >= 60 and percentage < 75)),
        jsonb_build_object('bucket', '75-90',  'count', count(*) filter (where percentage >= 75 and percentage < 90)),
        jsonb_build_object('bucket', '90-100', 'count', count(*) filter (where percentage >= 90))
      ) from att
    ),
    'tier_distribution', (
      select jsonb_build_object(
        'gold', count(*) filter (where r.certificate_tier = 'gold'),
        'silver', count(*) filter (where r.certificate_tier = 'silver'),
        'bronze', count(*) filter (where r.certificate_tier = 'bronze'),
        'participation', count(*) filter (where r.certificate_tier = 'participation'),
        'absent', count(*) filter (where r.certificate_tier = 'absent')
      )
      from public.oly_results r
      join public.oly_students s on s.id = r.oly_student_id
      where r.oly_school_id = p_oly_school_id and s.grade_level_id = p_grade_level_id
    )
  ) into v;

  return v;
end;
$$;

grant execute on function public.oly_teacher_class_report(uuid, uuid) to authenticated;
