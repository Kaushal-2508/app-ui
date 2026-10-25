-- 20260609140000_oly_school_report_rpc.sql
-- School-admin analytics for the Olympiad "Report" tab. One server-aggregated
-- round-trip (CLAUDE.md §23) covering enrolment, participation, subject + topic
-- performance, score distribution, medal mix, and toppers. Works for BOTH
-- onboarded and existing-SALCI schools (keys off oly_school_id).
--
-- Performance data is computed from oly_attempts + oly_answers + the question
-- snapshot (live, pre-purge); medal tiers come from oly_results once published.
-- Everything returns sensible zeros/empty arrays before an exam runs.

create or replace function public.oly_school_report(p_oly_school_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_inst uuid;
  v_enrolled integer;
  v_appeared integer;
  v_published boolean;
begin
  select institution_id into v_inst from public.oly_schools where id = p_oly_school_id;
  if v_inst is null then
    return jsonb_build_object('found', false);
  end if;

  -- Super admin, or any member of the school's own institution (admin/coordinator).
  if not (public.is_super_admin(auth.uid()) or public.get_user_institution(auth.uid()) = v_inst) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_enrolled := (select count(*) from public.oly_students s
                  where s.oly_school_id = p_oly_school_id and s.status = 'active');
  v_appeared := (select count(*) from public.oly_attempts a
                  join public.oly_students s on s.id = a.oly_student_id
                  where s.oly_school_id = p_oly_school_id and a.status <> 'in_progress');
  v_published := exists (select 1 from public.oly_results r where r.oly_school_id = p_oly_school_id);

  with att as (
    select a.oly_student_id, a.percentage, a.total_marks_obtained, s.class_label
    from public.oly_attempts a
    join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id and a.status <> 'in_progress'
  ),
  ans as (
    select qs.subject_id, qs.topic_id, (an.selected_answer = qs.correct_answer) as is_correct
    from public.oly_answers an
    join public.oly_questions_snapshot qs on qs.id = an.oly_question_snapshot_id
    join public.oly_attempts a on a.id = qs.oly_attempt_id
    join public.oly_students s on s.id = a.oly_student_id
    where s.oly_school_id = p_oly_school_id and a.status <> 'in_progress'
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
    'revenue_rupees', coalesce((select sum(ep.total_rupees) from public.oly_enrollment_pending ep
                                 where ep.oly_school_id = p_oly_school_id and ep.status = 'paid'), 0),
    'channel', jsonb_build_object(
      'online', (select count(*) from public.oly_students where oly_school_id = p_oly_school_id and status = 'active' and enrollment_channel = 'parent_online'),
      'cash',   (select count(*) from public.oly_students where oly_school_id = p_oly_school_id and status = 'active' and enrollment_channel = 'teacher_cash')
    ),
    'enrollment_by_class', coalesce((
      select jsonb_agg(jsonb_build_object('class_label', class_label, 'count', cnt) order by class_label)
      from (select class_label, count(*) cnt from public.oly_students
             where oly_school_id = p_oly_school_id and status = 'active' group by class_label) q
    ), '[]'::jsonb),
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
    'class_performance', coalesce((
      select jsonb_agg(jsonb_build_object('class_label', class_label, 'avg_percentage', avg_pct, 'appeared', appeared) order by class_label)
      from (select class_label, round(avg(percentage), 1) avg_pct, count(*) appeared from att group by class_label) q
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
        'gold', count(*) filter (where certificate_tier = 'gold'),
        'silver', count(*) filter (where certificate_tier = 'silver'),
        'bronze', count(*) filter (where certificate_tier = 'bronze'),
        'participation', count(*) filter (where certificate_tier = 'participation'),
        'absent', count(*) filter (where certificate_tier = 'absent')
      ) from public.oly_results where oly_school_id = p_oly_school_id
    ),
    'toppers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'full_name', st.full_name, 'class_label', st.class_label, 'percentage', round(a2.percentage, 1)
             ) order by a2.percentage desc)
      from (select oly_student_id, percentage from att order by percentage desc nulls last limit 5) a2
      join public.oly_students st on st.id = a2.oly_student_id
    ), '[]'::jsonb)
  ) into v;

  return v;
end;
$$;

grant execute on function public.oly_school_report(uuid) to authenticated;
