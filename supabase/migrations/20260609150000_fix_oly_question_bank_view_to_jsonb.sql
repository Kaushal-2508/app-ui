-- 20260609150000_fix_oly_question_bank_view_to_jsonb.sql
-- Bug fix: oly_question_bank_view used row_to_jsonb(x), which does NOT exist in
-- PostgreSQL (the row→jsonb function is to_jsonb; row_to_json returns json).
-- The RPC therefore errored on every call that reached the rows query, so the
-- Olympiad admin Question Bank always rendered "No questions match these filters"
-- (the component treats an RPC error as an empty list). It went unnoticed because
-- no Olympiad questions had ever been listed before. Replaced row_to_jsonb → to_jsonb.

create or replace function public.oly_question_bank_view(
  p_subject_id uuid,
  p_grade_level_id uuid,
  p_topic_id uuid default null,
  p_status text default null,
  p_sort text default 'last_used_desc',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_offset integer := greatest(0, (p_page - 1) * p_page_size);
  v_rows jsonb;
  v_total integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_total
    from public.oly_questions q
   where q.subject_id = p_subject_id
     and q.grade_level_id = p_grade_level_id
     and (p_topic_id is null or q.topic_id = p_topic_id)
     and (p_status is null or q.status = p_status);

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows
    from (
      select
        q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d,
        q.correct_answer, q.topic_id, q.status, q.times_used, q.total_correct,
        q.total_attempts, q.total_time_seconds, q.last_used_at, q.updated_at,
        t.name as topic_name,
        case when q.total_attempts > 0
          then round((q.total_correct::numeric / q.total_attempts) * 100, 2)
          else null end as avg_correct_rate_percent,
        case when q.total_attempts > 0
          then round((q.total_time_seconds::numeric / q.total_attempts), 2)
          else null end as avg_time_seconds
      from public.oly_questions q
      left join public.oly_topics t on t.id = q.topic_id
      where q.subject_id = p_subject_id
        and q.grade_level_id = p_grade_level_id
        and (p_topic_id is null or q.topic_id = p_topic_id)
        and (p_status is null or q.status = p_status)
      order by
        case when p_sort = 'avg_correct_rate_asc' then
          coalesce((q.total_correct::numeric / nullif(q.total_attempts, 0)), 999) end asc nulls last,
        case when p_sort = 'times_used_desc' then q.times_used end desc nulls last,
        case when p_sort = 'last_used_desc' then q.last_used_at end desc nulls last,
        q.created_at desc
      limit p_page_size offset v_offset
    ) x;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'page', p_page, 'page_size', p_page_size);
end;
$$;
