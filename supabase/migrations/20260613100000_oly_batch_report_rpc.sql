-- 20260613100000_oly_batch_report_rpc.sql
-- Batch-scoped analytics for the school-admin "Exam Analysis" view inside a
-- single batch's detail sheet. Mirrors oly_school_report (20260609140000) but
-- restricts every aggregate to the students ASSIGNED to one batch
-- (oly_batch_assignments). One server-aggregated round-trip (CLAUDE.md §23).
--
-- Performance comes from oly_attempts + oly_answers + the question snapshot;
-- medal tiers from oly_results once that batch is published. Returns sensible
-- zeros/empty arrays before the batch's exam runs.

create or replace function public.oly_batch_report(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_school uuid;
  v_inst uuid;
  v_label text;
  v_scheduled timestamptz;
  v_enrolled integer;
  v_appeared integer;
  v_published boolean;
begin
  select b.oly_school_id, b.batch_label, b.scheduled_at, sc.institution_id
    into v_school, v_label, v_scheduled, v_inst
    from public.oly_batches b
    join public.oly_schools sc on sc.id = b.oly_school_id
   where b.id = p_batch_id;
  if v_school is null then
    return jsonb_build_object('found', false);
  end if;

  -- Super admin, or any member of the batch's own institution (admin/coordinator).
  if not (public.is_super_admin(auth.uid()) or public.get_user_institution(auth.uid()) = v_inst) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_enrolled := (
    select count(*) from public.oly_students s
    join public.oly_batch_assignments ba on ba.oly_student_id = s.id
    where ba.oly_batch_id = p_batch_id and s.status = 'active'
  );
  v_appeared := (
    select count(*) from public.oly_attempts a
    join public.oly_batch_assignments ba on ba.oly_student_id = a.oly_student_id
    where ba.oly_batch_id = p_batch_id and a.status <> 'in_progress'
  );
  v_published := exists (
    select 1 from public.oly_results r
    join public.oly_batch_assignments ba on ba.oly_student_id = r.oly_student_id
    where ba.oly_batch_id = p_batch_id
  );

  with batch_students as (
    select s.id, s.class_label
    from public.oly_students s
    join public.oly_batch_assignments ba on ba.oly_student_id = s.id
    where ba.oly_batch_id = p_batch_id and s.status = 'active'
  ),
  att as (
    select a.oly_student_id, a.percentage, a.total_marks_obtained, bs.class_label
    from public.oly_attempts a
    join batch_students bs on bs.id = a.oly_student_id
    where a.status <> 'in_progress'
  ),
  ans as (
    select qs.subject_id, qs.topic_id, (an.selected_answer = qs.correct_answer) as is_correct
    from public.oly_answers an
    join public.oly_questions_snapshot qs on qs.id = an.oly_question_snapshot_id
    join public.oly_attempts a on a.id = qs.oly_attempt_id
    join batch_students bs on bs.id = a.oly_student_id
    where a.status <> 'in_progress'
  )
  select jsonb_build_object(
    'found', true,
    'batch_label', v_label,
    'scheduled_at', v_scheduled,
    'results_available', v_appeared > 0,
    'results_published', v_published,
    'enrolled', v_enrolled,
    'appeared', v_appeared,
    'absent', greatest(v_enrolled - v_appeared, 0),
    'avg_percentage', coalesce((select round(avg(percentage), 1) from att), 0),
    'max_percentage', coalesce((select round(max(percentage), 1) from att), 0),
    'avg_marks', coalesce((select round(avg(total_marks_obtained), 1) from att), 0),
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
      )
      from public.oly_results r
      join public.oly_batch_assignments ba on ba.oly_student_id = r.oly_student_id
      where ba.oly_batch_id = p_batch_id
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

grant execute on function public.oly_batch_report(uuid) to authenticated;
