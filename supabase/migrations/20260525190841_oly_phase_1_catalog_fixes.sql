-- Phase 1 fixes — code-review findings
-- 1. Drop oly_campaign_stats(uuid) — param was unused; recreate paramless
-- 2. oly_campaign_lock_check: use IS DISTINCT FROM for NULL-safety
-- 3. oly_questions_upsert: raise on UPDATE-with-missing-id (silent no-op fix)
-- 4. oly_set_updated_at: add SECURITY DEFINER for consistency

-- =========================================================================
-- 1. oly_campaign_stats — drop param, rename clarifies the function is global
-- =========================================================================
drop function if exists public.oly_campaign_stats(uuid);

create or replace function public.oly_campaign_stats()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total_subjects integer;
  v_total_topics integer;
  v_total_questions integer;
  v_total_materials integer;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_total_subjects from public.oly_subjects where status = 'active';
  select count(*) into v_total_topics from public.oly_topics where status = 'active';
  select count(*) into v_total_questions from public.oly_questions where status = 'active';
  select count(*) into v_total_materials from public.oly_study_materials;

  return jsonb_build_object(
    'total_subjects', v_total_subjects,
    'total_topics', v_total_topics,
    'total_questions', v_total_questions,
    'total_materials', v_total_materials
  );
end;
$$;

grant execute on function public.oly_campaign_stats() to authenticated;

-- =========================================================================
-- 2. oly_campaign_lock_check — IS DISTINCT FROM for NULL-safety
-- =========================================================================
create or replace function public.oly_campaign_lock_check()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  has_enrolled_school boolean;
begin
  if (old.status = 'active' and new.status = 'active') then
    select exists(
      select 1 from public.oly_schools
       where campaign_id = new.id
         and status != 'enrollment_open'
    ) into has_enrolled_school;

    if has_enrolled_school then
      if (new.exam_duration_minutes is distinct from old.exam_duration_minutes
       or new.questions_per_subject is distinct from old.questions_per_subject
       or new.gst_percent is distinct from old.gst_percent
       or new.gold_threshold_percent is distinct from old.gold_threshold_percent
       or new.silver_threshold_percent is distinct from old.silver_threshold_percent
       or new.bronze_threshold_percent is distinct from old.bronze_threshold_percent) then
        raise exception 'Cannot edit locked campaign fields once schools have enrolled. Default price and per-school overrides remain editable.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 3. oly_questions_upsert — raise on UPDATE missing-id (silent no-op fix)
-- =========================================================================
create or replace function public.oly_questions_upsert(p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_row record;
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_id := nullif(p_payload->>'id', '')::uuid;

  if v_id is null then
    insert into public.oly_questions (
      subject_id, grade_level_id, topic_id, question_text,
      option_a, option_b, option_c, option_d, correct_answer,
      internal_notes, status, created_by
    ) values (
      (p_payload->>'subject_id')::uuid,
      (p_payload->>'grade_level_id')::uuid,
      nullif(p_payload->>'topic_id','')::uuid,
      p_payload->>'question_text',
      p_payload->>'option_a',
      p_payload->>'option_b',
      p_payload->>'option_c',
      p_payload->>'option_d',
      p_payload->>'correct_answer',
      p_payload->>'internal_notes',
      coalesce(p_payload->>'status','active'),
      auth.uid()
    ) returning * into v_row;
  else
    update public.oly_questions set
      topic_id = nullif(p_payload->>'topic_id','')::uuid,
      question_text = p_payload->>'question_text',
      option_a = p_payload->>'option_a',
      option_b = p_payload->>'option_b',
      option_c = p_payload->>'option_c',
      option_d = p_payload->>'option_d',
      correct_answer = p_payload->>'correct_answer',
      internal_notes = p_payload->>'internal_notes',
      status = coalesce(p_payload->>'status', status)
    where id = v_id
    returning * into v_row;

    if not found then
      raise exception 'Question not found' using errcode = 'P0002';
    end if;
  end if;

  return row_to_jsonb(v_row);
end;
$$;

-- =========================================================================
-- 4. oly_set_updated_at — add SECURITY DEFINER for consistency
-- =========================================================================
create or replace function public.oly_set_updated_at()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
