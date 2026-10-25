-- Student performance intelligence for the Olympiad student dashboard.
-- One server-aggregated RPC (CLAUDE.md §23) over the student's own attempt:
--   * topics[]  — per-topic (competency) accuracy + avg time, the data behind
--                 the skill radar, strengths and focus areas;
--   * time      — totals, avg per question, correct-vs-incorrect speed,
--                 unanswered count;
--   * benchmark — student % vs class average vs school average (non-absent
--                 published results only).
-- Auth mirrors oly_get_published_result: self-lookup via auth_user_id /
-- profile_id, or any caller oly_student_can_read allows (parents/admins).
-- Only meaningful once the student's result is published and not absent.

create or replace function public.oly_student_performance_analysis(p_student_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_attempt_id uuid;
  v_pct numeric;
  v_tier text;
  v_school uuid;
  v_grade uuid;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;

  if p_student_id is null then
    select id into v_target
      from public.oly_students
     where (auth_user_id = v_uid or profile_id = v_uid)
       and status = 'active'
     limit 1;
  else
    v_target := p_student_id;
    if not public.oly_student_can_read(v_uid, v_target) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  if v_target is null then
    return jsonb_build_object('ok', false, 'reason', 'no_enrollment');
  end if;

  select r.percentage, r.certificate_tier, s.oly_school_id, s.grade_level_id
    into v_pct, v_tier, v_school, v_grade
    from public.oly_results r
    join public.oly_students s on s.id = r.oly_student_id
   where r.oly_student_id = v_target;

  if v_pct is null then
    return jsonb_build_object('ok', false, 'reason', 'not_published_yet');
  end if;
  if v_tier = 'absent' then
    return jsonb_build_object('ok', false, 'reason', 'absent');
  end if;

  select a.id into v_attempt_id
    from public.oly_attempts a
   where a.oly_student_id = v_target
     and a.status != 'in_progress'
   order by a.submitted_at desc nulls last
   limit 1;

  if v_attempt_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_attempt');
  end if;

  return (
    with qa as (
      select qs.subject_id,
             qs.topic_id,
             (an.selected_answer is not null) as attempted,
             coalesce(an.selected_answer = qs.correct_answer, false) as is_correct,
             coalesce(an.time_spent_seconds, 0) as secs
      from public.oly_questions_snapshot qs
      left join public.oly_answers an on an.oly_question_snapshot_id = qs.id
      where qs.oly_attempt_id = v_attempt_id
    )
    select jsonb_build_object(
      'ok', true,
      'topics', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'topic_name', coalesce(tp.name, 'General'),
                 'subject_name', sub.name,
                 'questions', g.questions,
                 'attempted', g.attempted,
                 'correct', g.correct,
                 'pct_correct', g.pct,
                 'avg_time_seconds', g.avg_secs
               ) order by g.questions desc, g.pct desc)
        from (
          select topic_id, subject_id,
                 count(*) as questions,
                 count(*) filter (where attempted) as attempted,
                 count(*) filter (where is_correct) as correct,
                 round(count(*) filter (where is_correct)::numeric / nullif(count(*), 0) * 100, 1) as pct,
                 round(avg(secs), 1) as avg_secs
          from qa group by topic_id, subject_id
        ) g
        left join public.oly_topics tp on tp.id = g.topic_id
        join public.oly_subjects sub on sub.id = g.subject_id
      ), '[]'::jsonb),
      'time', (
        select jsonb_build_object(
          'total_seconds', coalesce(sum(secs), 0),
          'questions', count(*),
          'attempted', count(*) filter (where attempted),
          'unanswered', count(*) filter (where not attempted),
          'avg_seconds_per_question', round(avg(secs), 1),
          'avg_seconds_correct', round(avg(secs) filter (where is_correct), 1),
          'avg_seconds_incorrect', round(avg(secs) filter (where attempted and not is_correct), 1)
        ) from qa
      ),
      'benchmark', (
        select jsonb_build_object(
          'student_pct', v_pct,
          'class_avg_pct', round(avg(r2.percentage) filter (where s2.grade_level_id = v_grade), 1),
          'school_avg_pct', round(avg(r2.percentage), 1)
        )
        from public.oly_results r2
        join public.oly_students s2 on s2.id = r2.oly_student_id
        where r2.oly_school_id = v_school
          and r2.certificate_tier != 'absent'
      )
    )
  );
end;
$$;

grant execute on function public.oly_student_performance_analysis(uuid) to authenticated;
