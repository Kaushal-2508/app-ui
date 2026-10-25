-- Phase 4b — Olympiad exam delivery
-- Adds: oly_attempts, oly_questions_snapshot, oly_answers, oly_attempt_events tables,
--       6 SECURITY DEFINER RPCs, updates to oly_validate_pin + oly_student_dashboard_context.
--
-- Concurrency target: 6K students simultaneous.
-- All hot writes go through SECURITY DEFINER RPCs for sub-50ms latency.
-- Every FK has a supporting index per CLAUDE.md §23.1.
-- oly_save_answer is idempotent UPSERT on unique(oly_question_snapshot_id).
-- oly_submit_attempt uses FOR UPDATE lock + status check to prevent double-submit.

-- =========================================================================
-- 2.1  oly_attempts
-- =========================================================================
create table public.oly_attempts (
  id uuid primary key default gen_random_uuid(),
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  oly_batch_id uuid not null references public.oly_batches(id) on delete restrict,
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,

  -- Timer state (server-side authoritative).
  -- remaining = started_at + (exam_duration_seconds * interval '1 second') - now()
  started_at timestamptz not null default now(),
  exam_duration_seconds integer not null check (exam_duration_seconds > 0),

  -- Submission state
  status text not null default 'in_progress'
    check (status in (
      'in_progress', 'submitted',
      'auto_submitted_timer', 'auto_submitted_violation', 'auto_submitted_disconnect'
    )),
  submitted_at timestamptz,
  submit_reason text check (submit_reason in (
    null, 'manual', 'timer_zero', 'violations_exceeded', 'disconnect_exceeded'
  )),

  -- Score (computed atomically at submit by the RPC).
  -- NOTE: percentage is a normal column here (NOT GENERATED), computed and written by the
  -- submit RPC. Per CLAUDE.md §9 — never use GENERATED ALWAYS columns for values we write.
  total_marks_obtained numeric,
  total_max_marks numeric,
  percentage numeric(5,2),
  subject_scores jsonb, -- { subject_id: { correct, total, marks_obtained, marks_max } }

  -- Telemetry counters (incremented by oly_record_event RPC)
  proctoring_violations integer not null default 0,
  section_switches integer not null default 0,

  -- Lifecycle
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One attempt per student — enforced by this unique constraint
  unique(oly_student_id)
);

-- Every FK column indexed per §23.1
create index idx_oly_attempts_student    on public.oly_attempts(oly_student_id);
create index idx_oly_attempts_batch      on public.oly_attempts(oly_batch_id);
create index idx_oly_attempts_campaign   on public.oly_attempts(campaign_id);
create index idx_oly_attempts_status     on public.oly_attempts(status);
create index idx_oly_attempts_submitted  on public.oly_attempts(submitted_at);

create trigger oly_attempts_set_updated_at
  before update on public.oly_attempts
  for each row execute function public.oly_set_updated_at();

-- =========================================================================
-- 2.2  oly_questions_snapshot  (frozen copy created at oly_start_attempt)
-- =========================================================================
create table public.oly_questions_snapshot (
  id uuid primary key default gen_random_uuid(),
  oly_attempt_id uuid not null references public.oly_attempts(id) on delete cascade,
  subject_id uuid not null references public.oly_subjects(id) on delete restrict,
  question_id uuid not null references public.oly_questions(id) on delete restrict,
  topic_id uuid references public.oly_topics(id) on delete set null,
  position_in_subject integer not null, -- 1..N (N = questions_per_subject from campaign)

  -- Frozen question content — super-admin edits to oly_questions do NOT affect scores
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer char(1) not null check (correct_answer in ('A','B','C','D')),

  -- Marks per question (default 1; may vary in future campaign configs)
  marks numeric not null default 1,

  -- Uniqueness: one position per subject per attempt
  unique(oly_attempt_id, subject_id, position_in_subject)
);

create index idx_oqs_attempt   on public.oly_questions_snapshot(oly_attempt_id);
create index idx_oqs_subject   on public.oly_questions_snapshot(subject_id);
create index idx_oqs_question  on public.oly_questions_snapshot(question_id);
create index idx_oqs_topic     on public.oly_questions_snapshot(topic_id);

-- =========================================================================
-- 2.3  oly_answers  (idempotent UPSERT target via unique(oly_question_snapshot_id))
-- =========================================================================
create table public.oly_answers (
  id uuid primary key default gen_random_uuid(),
  oly_attempt_id uuid not null references public.oly_attempts(id) on delete cascade,
  oly_question_snapshot_id uuid not null references public.oly_questions_snapshot(id) on delete cascade,
  selected_answer char(1) check (selected_answer in (null, 'A','B','C','D')),
  marked_for_review boolean not null default false,
  time_spent_seconds integer not null default 0 check (time_spent_seconds >= 0),
  answered_at timestamptz,
  updated_at timestamptz not null default now(),

  -- One answer row per snapshot question — the UPSERT key
  unique(oly_question_snapshot_id)
);

create index idx_oly_answers_attempt   on public.oly_answers(oly_attempt_id);
create index idx_oly_answers_snapshot  on public.oly_answers(oly_question_snapshot_id);
create index idx_oly_answers_selected  on public.oly_answers(selected_answer);

create trigger oly_answers_set_updated_at
  before update on public.oly_answers
  for each row execute function public.oly_set_updated_at();

-- =========================================================================
-- 2.4  oly_attempt_events  (telemetry — proctoring violations, section switches, etc.)
-- =========================================================================
create table public.oly_attempt_events (
  id uuid primary key default gen_random_uuid(),
  oly_attempt_id uuid not null references public.oly_attempts(id) on delete cascade,
  event_type text not null check (event_type in (
    'section_switch', 'flag', 'unflag',
    'proctoring_violation_fullscreen', 'proctoring_violation_tab_switch',
    'disconnect', 'reconnect', 'auto_save'
  )),
  payload jsonb,
  event_at timestamptz not null default now()
);

create index idx_oae_attempt    on public.oly_attempt_events(oly_attempt_id);
create index idx_oae_event_type on public.oly_attempt_events(event_type);
create index idx_oae_event_at   on public.oly_attempt_events(event_at);

-- =========================================================================
-- 2.5  RLS — all 4 new tables
-- =========================================================================

-- oly_attempts
alter table public.oly_attempts enable row level security;

create policy "super_admin all" on public.oly_attempts
  for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

-- Student: full own-row access (status + content gated inside RPCs, not RLS)
create policy "student all own" on public.oly_attempts
  for all
  using  (public.oly_student_can_read(auth.uid(), oly_student_id))
  with check (public.oly_student_can_read(auth.uid(), oly_student_id));

-- School admin: SELECT for live monitoring
create policy "school_admin SELECT own school" on public.oly_attempts
  for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));

-- oly_questions_snapshot
alter table public.oly_questions_snapshot enable row level security;

create policy "super_admin all" on public.oly_questions_snapshot
  for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

create policy "student SELECT own" on public.oly_questions_snapshot
  for select
  using (exists(
    select 1 from public.oly_attempts a
     where a.id = oly_attempt_id
       and public.oly_student_can_read(auth.uid(), a.oly_student_id)
  ));

create policy "school_admin SELECT own school" on public.oly_questions_snapshot
  for select
  using (exists(
    select 1 from public.oly_attempts a
      join public.oly_students s on s.id = a.oly_student_id
     where a.id = oly_attempt_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));

-- oly_answers
alter table public.oly_answers enable row level security;

create policy "super_admin all" on public.oly_answers
  for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

create policy "student all own" on public.oly_answers
  for all
  using (exists(
    select 1 from public.oly_attempts a
     where a.id = oly_attempt_id
       and public.oly_student_can_read(auth.uid(), a.oly_student_id)
  ))
  with check (exists(
    select 1 from public.oly_attempts a
     where a.id = oly_attempt_id
       and public.oly_student_can_read(auth.uid(), a.oly_student_id)
  ));

-- oly_attempt_events
alter table public.oly_attempt_events enable row level security;

create policy "super_admin all" on public.oly_attempt_events
  for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

-- Students can INSERT their own events (but NOT SELECT — forensics are admin-only)
create policy "student INSERT own" on public.oly_attempt_events
  for insert
  with check (exists(
    select 1 from public.oly_attempts a
     where a.id = oly_attempt_id
       and public.oly_student_can_read(auth.uid(), a.oly_student_id)
  ));

-- School admin SELECT for forensics / dispute resolution
create policy "school_admin SELECT own school" on public.oly_attempt_events
  for select
  using (exists(
    select 1 from public.oly_attempts a
      join public.oly_students s on s.id = a.oly_student_id
     where a.id = oly_attempt_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));

-- =========================================================================
-- 2.6  RPCs
-- =========================================================================

-- ---------------------------------------------------------------------------
-- oly_start_attempt()
-- ---------------------------------------------------------------------------
-- Creates a new attempt for the calling student OR returns the existing one.
-- Snapshots questions_per_subject random active questions per chosen subject
-- in a single transaction.  Enforces PIN-success gate (within 15 minutes).
-- Returns { ok, attempt_id, resumed }.
create or replace function public.oly_start_attempt()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid                  uuid := auth.uid();
  v_student              record;
  v_campaign             record;
  v_questions_per_subj   integer;
  v_existing_attempt     record;
  v_attempt_id           uuid;
  v_pin_success          boolean;
  v_subject_id           uuid;
  v_inserted_count       integer;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Resolve active student enrollment
  select id, oly_school_id, grade_level_id, campaign_id, subject_ids
    into v_student
    from public.oly_students
   where (auth_user_id = v_uid or profile_id = v_uid)
     and status = 'active'
   limit 1;
  if v_student.id is null then
    raise exception 'No active enrollment';
  end if;

  -- Idempotency — return existing attempt if already started
  select id, status into v_existing_attempt
    from public.oly_attempts
   where oly_student_id = v_student.id;
  if v_existing_attempt.id is not null then
    if v_existing_attempt.status = 'in_progress' then
      return jsonb_build_object(
        'ok', true,
        'attempt_id', v_existing_attempt.id,
        'resumed', true
      );
    else
      raise exception 'Exam already submitted' using errcode = 'P0002';
    end if;
  end if;

  -- Gate on recent PIN success (within 15 minutes)
  select exists(
    select 1 from public.oly_pin_attempt_log
     where oly_student_id = v_student.id
       and outcome = 'success'
       and attempted_at > now() - interval '15 minutes'
  ) into v_pin_success;
  if not v_pin_success then
    raise exception 'PIN entry required first' using errcode = 'P0001';
  end if;

  -- Load campaign settings
  select campaign_year, exam_duration_minutes, questions_per_subject
    into v_campaign
    from public.oly_campaigns
   where id = v_student.campaign_id;
  v_questions_per_subj := v_campaign.questions_per_subject;

  -- Create attempt row — batch assignment must exist
  insert into public.oly_attempts (
    oly_student_id, oly_batch_id, campaign_id, exam_duration_seconds, started_at
  )
  select
    v_student.id,
    oba.oly_batch_id,
    v_student.campaign_id,
    v_campaign.exam_duration_minutes * 60,
    now()
  from public.oly_batch_assignments oba
  where oba.oly_student_id = v_student.id
  returning id into v_attempt_id;

  -- Snapshot questions: N random active questions per chosen subject
  foreach v_subject_id in array v_student.subject_ids loop
    insert into public.oly_questions_snapshot (
      oly_attempt_id, subject_id, question_id, topic_id, position_in_subject,
      question_text, option_a, option_b, option_c, option_d, correct_answer, marks
    )
    select
      v_attempt_id,
      v_subject_id,
      q.id,
      q.topic_id,
      row_number() over (order by random()),
      q.question_text,
      q.option_a,
      q.option_b,
      q.option_c,
      q.option_d,
      q.correct_answer,
      1
    from public.oly_questions q
    where q.subject_id = v_subject_id
      and q.grade_level_id = v_student.grade_level_id
      and q.status = 'active'
    order by random()
    limit v_questions_per_subj;

    get diagnostics v_inserted_count = row_count;
    if v_inserted_count < v_questions_per_subj then
      raise exception
        'Not enough active questions in bank for subject % (need %, found %)',
        v_subject_id, v_questions_per_subj, v_inserted_count;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'attempt_id', v_attempt_id,
    'resumed', false
  );
end;
$$;

grant execute on function public.oly_start_attempt() to authenticated;

-- ---------------------------------------------------------------------------
-- oly_save_answer(attempt_id, snapshot_id, selected, marked, time_spent)
-- ---------------------------------------------------------------------------
-- Idempotent UPSERT.  Hottest write path: ~90 saves/sec sustained at 6K students.
-- The greatest() on time_spent_seconds prevents regression if a slow save
-- arrives out-of-order (e.g. debounce fired after user moved to next question).
create or replace function public.oly_save_answer(
  p_attempt_id   uuid,
  p_snapshot_id  uuid,
  p_selected     text,    -- 'A'|'B'|'C'|'D' or null to clear
  p_marked       boolean,
  p_time_spent   integer  -- cumulative seconds on this question
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid            uuid := auth.uid();
  v_attempt_status text;
  v_belongs        boolean;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Ownership check (layer 2, RLS is layer 1) + status gate + snapshot membership
  select a.status,
         exists(
           select 1 from public.oly_questions_snapshot s2
            where s2.id = p_snapshot_id
              and s2.oly_attempt_id = p_attempt_id
         )
    into v_attempt_status, v_belongs
    from public.oly_attempts a
    join public.oly_students st on st.id = a.oly_student_id
   where a.id = p_attempt_id
     and (st.auth_user_id = v_uid or st.profile_id = v_uid);

  if v_attempt_status is null then
    raise exception 'Attempt not found or forbidden' using errcode = '42501';
  end if;
  if v_attempt_status <> 'in_progress' then
    raise exception 'Attempt is already closed';
  end if;
  if not v_belongs then
    raise exception 'Question not in this attempt';
  end if;
  if p_selected is not null and p_selected not in ('A','B','C','D') then
    raise exception 'Invalid answer value — must be A, B, C, D or null';
  end if;

  insert into public.oly_answers (
    oly_attempt_id, oly_question_snapshot_id,
    selected_answer, marked_for_review,
    time_spent_seconds, answered_at
  ) values (
    p_attempt_id, p_snapshot_id,
    p_selected::char(1), p_marked,
    p_time_spent,
    case when p_selected is null then null else now() end
  )
  on conflict (oly_question_snapshot_id) do update set
    selected_answer    = excluded.selected_answer,
    marked_for_review  = excluded.marked_for_review,
    -- greatest() keeps the larger value so an out-of-order late-arriving save
    -- cannot decrease the recorded time (per spec critical correctness note)
    time_spent_seconds = greatest(public.oly_answers.time_spent_seconds,
                                  excluded.time_spent_seconds),
    answered_at        = case
                           when excluded.selected_answer is null
                           then public.oly_answers.answered_at
                           else now()
                         end;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.oly_save_answer(uuid, uuid, text, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- oly_submit_attempt(attempt_id, reason)
-- ---------------------------------------------------------------------------
-- Atomic submit + score computation in one transaction.
-- FOR UPDATE lock on the attempt row prevents concurrent double-submit.
-- Server-side enforces timer_zero reason (rejects if timer not yet expired).
create or replace function public.oly_submit_attempt(
  p_attempt_id uuid,
  p_reason     text default 'manual'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid            uuid := auth.uid();
  v_attempt        record;
  v_now            timestamptz := now();
  v_final_status   text;
  v_subject_scores jsonb;
  v_total_obtained numeric := 0;
  v_total_max      numeric := 0;
  v_percentage     numeric;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason not in ('manual','timer_zero','violations_exceeded','disconnect_exceeded') then
    raise exception 'Invalid submit reason';
  end if;

  -- Lock the attempt row to prevent concurrent double-submit races (FOR UPDATE)
  select a.id, a.oly_student_id, a.started_at, a.exam_duration_seconds, a.status
    into v_attempt
    from public.oly_attempts a
    join public.oly_students st on st.id = a.oly_student_id
   where a.id = p_attempt_id
     and (st.auth_user_id = v_uid or st.profile_id = v_uid)
   for update;

  if v_attempt.id is null then
    raise exception 'Attempt not found or forbidden' using errcode = '42501';
  end if;

  -- Idempotent double-submit: return ok instead of raising (client retry-safe)
  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object('ok', true, 'already_submitted', true);
  end if;

  -- Defense-in-depth: reject a timer_zero submit if the timer has not yet elapsed
  if p_reason = 'timer_zero'
     and v_now < v_attempt.started_at + (v_attempt.exam_duration_seconds * interval '1 second')
  then
    raise exception 'Timer not yet expired — cannot submit with reason timer_zero';
  end if;

  -- Compute per-subject scores in a single GROUP BY aggregate (§23.1 — server-side aggregation)
  select
    jsonb_object_agg(
      t.subject_id::text,
      jsonb_build_object(
        'correct',         t.correct,
        'total',           t.total,
        'marks_obtained',  t.marks_obtained,
        'marks_max',       t.marks_max
      )
    ) as subject_scores,
    coalesce(sum(t.marks_obtained), 0) as total_obtained,
    coalesce(sum(t.marks_max), 0)      as total_max
    into v_subject_scores, v_total_obtained, v_total_max
    from (
      select
        s.subject_id,
        count(*) filter (where a.selected_answer = s.correct_answer)::integer as correct,
        count(*)::integer                                                      as total,
        coalesce(sum(
          case when a.selected_answer = s.correct_answer then s.marks else 0 end
        ), 0)                                                                  as marks_obtained,
        coalesce(sum(s.marks), 0)                                              as marks_max
      from public.oly_questions_snapshot s
      left join public.oly_answers a on a.oly_question_snapshot_id = s.id
      where s.oly_attempt_id = p_attempt_id
      group by s.subject_id
    ) t;

  v_percentage := case
    when v_total_max > 0
    then round((v_total_obtained / v_total_max) * 100, 2)
    else 0
  end;

  v_final_status := case p_reason
    when 'manual'               then 'submitted'
    when 'timer_zero'           then 'auto_submitted_timer'
    when 'violations_exceeded'  then 'auto_submitted_violation'
    when 'disconnect_exceeded'  then 'auto_submitted_disconnect'
  end;

  update public.oly_attempts set
    status               = v_final_status,
    submitted_at         = v_now,
    submit_reason        = p_reason,
    total_marks_obtained = v_total_obtained,
    total_max_marks      = v_total_max,
    percentage           = v_percentage,
    subject_scores       = v_subject_scores
  where id = p_attempt_id;

  return jsonb_build_object(
    'ok',          true,
    'total_marks', v_total_obtained,
    'total_max',   v_total_max,
    'percentage',  v_percentage
  );
end;
$$;

grant execute on function public.oly_submit_attempt(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- oly_record_event(attempt_id, event_type, payload)
-- ---------------------------------------------------------------------------
-- Telemetry insert + counter increments.  Fire-and-forget; returns violation count
-- so the client knows when to trigger auto-submit.
create or replace function public.oly_record_event(
  p_attempt_id  uuid,
  p_event_type  text,
  p_payload     jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid            uuid := auth.uid();
  v_attempt        record;
  v_new_violations integer;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select a.id, a.status, a.proctoring_violations
    into v_attempt
    from public.oly_attempts a
    join public.oly_students st on st.id = a.oly_student_id
   where a.id = p_attempt_id
     and (st.auth_user_id = v_uid or st.profile_id = v_uid);

  if v_attempt.id is null then
    raise exception 'Attempt not found or forbidden' using errcode = '42501';
  end if;

  -- Silently accept events on already-closed attempts (e.g. late reconnect ping)
  if v_attempt.status <> 'in_progress' then
    return jsonb_build_object('ok', true, 'attempt_closed', true);
  end if;

  insert into public.oly_attempt_events (oly_attempt_id, event_type, payload)
    values (p_attempt_id, p_event_type, p_payload);

  if p_event_type like 'proctoring_violation_%' then
    update public.oly_attempts
       set proctoring_violations = proctoring_violations + 1
     where id = p_attempt_id
    returning proctoring_violations into v_new_violations;
  elsif p_event_type = 'section_switch' then
    update public.oly_attempts
       set section_switches = section_switches + 1
     where id = p_attempt_id;
    v_new_violations := v_attempt.proctoring_violations;
  else
    v_new_violations := v_attempt.proctoring_violations;
  end if;

  return jsonb_build_object('ok', true, 'total_violations', v_new_violations);
end;
$$;

grant execute on function public.oly_record_event(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- oly_get_attempt_state(attempt_id)  — STABLE, polled every 30s by the client
-- ---------------------------------------------------------------------------
-- Returns server-authoritative remaining_seconds.
-- Marked STABLE so the query planner can cache within a transaction.
create or replace function public.oly_get_attempt_state(p_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_a         record;
  v_remaining integer;
  v_expired   boolean;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select a.id, a.status, a.started_at, a.exam_duration_seconds,
         a.proctoring_violations, a.section_switches, a.submit_reason
    into v_a
    from public.oly_attempts a
    join public.oly_students st on st.id = a.oly_student_id
   where a.id = p_attempt_id
     and (st.auth_user_id = v_uid or st.profile_id = v_uid);

  if v_a.id is null then
    raise exception 'Attempt not found or forbidden' using errcode = '42501';
  end if;

  v_remaining := greatest(
    0,
    v_a.exam_duration_seconds
    - extract(epoch from (now() - v_a.started_at))::integer
  );
  v_expired := v_remaining <= 0;

  return jsonb_build_object(
    'attempt_id',           v_a.id,
    'status',               v_a.status,
    'remaining_seconds',    v_remaining,
    'expired',              v_expired,
    'proctoring_violations',v_a.proctoring_violations,
    'section_switches',     v_a.section_switches,
    'submit_reason',        v_a.submit_reason
  );
end;
$$;

grant execute on function public.oly_get_attempt_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- oly_get_attempt_questions(attempt_id)  — STABLE, called once at exam start / resume
-- ---------------------------------------------------------------------------
-- Bulk fetch: all 90 snapshot questions with existing answers joined.
-- staleTime: Infinity on the client (questions are immutable after start).
create or replace function public.oly_get_attempt_questions(p_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_owns     boolean;
  v_questions jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.oly_attempts a
      join public.oly_students st on st.id = a.oly_student_id
     where a.id = p_attempt_id
       and (st.auth_user_id = v_uid or st.profile_id = v_uid)
  ) into v_owns;

  if not v_owns then
    raise exception 'Attempt not found or forbidden' using errcode = '42501';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'snapshot_id',        s.id,
      'subject_id',         s.subject_id,
      'position',           s.position_in_subject,
      'question_text',      s.question_text,
      'option_a',           s.option_a,
      'option_b',           s.option_b,
      'option_c',           s.option_c,
      'option_d',           s.option_d,
      'marks',              s.marks,
      'selected_answer',    a.selected_answer,
      'marked_for_review',  coalesce(a.marked_for_review, false),
      'time_spent_seconds', coalesce(a.time_spent_seconds, 0)
    ) order by s.subject_id, s.position_in_subject
  ) into v_questions
  from public.oly_questions_snapshot s
  left join public.oly_answers a on a.oly_question_snapshot_id = s.id
  where s.oly_attempt_id = p_attempt_id;

  return jsonb_build_object('ok', true, 'questions', v_questions);
end;
$$;

grant execute on function public.oly_get_attempt_questions(uuid) to authenticated;

-- =========================================================================
-- 2.7  UPDATE oly_validate_pin — add already_attempted check
-- =========================================================================
-- Full CREATE OR REPLACE with the Phase 4a body + the Phase 4b check inserted
-- after the PIN expiry check, before the success branch.
-- Per spec 2.7: reject if existing attempt with status != 'in_progress'
-- (allow in_progress to support session resume without re-doing PIN).
create or replace function public.oly_validate_pin(
  p_pin        text,
  p_ip         text default null,
  p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid              uuid := auth.uid();
  v_student          record;
  v_assigned_batch_id uuid;
  v_batch            record;
  v_school_status    text;
  v_now              timestamptz := now();
  v_outcome          text;
  v_resolved_batch_id uuid;
  v_clean_pin        text := upper(trim(p_pin));
  v_attempt_status   text;  -- Phase 4b addition
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'student_not_found');
  end if;

  -- Resolve student (single query — avoid round trips)
  select id, oly_school_id, grade_level_id, full_name, roll_number
    into v_student
    from public.oly_students
   where (auth_user_id = v_uid or profile_id = v_uid)
     and status = 'active'
   limit 1;

  if v_student.id is null then
    insert into public.oly_pin_attempt_log
      (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (null, null, v_clean_pin, p_ip, p_user_agent, 'student_not_found');
    return jsonb_build_object('ok', false, 'reason', 'student_not_found');
  end if;

  -- Check school status
  select status into v_school_status
    from public.oly_schools where id = v_student.oly_school_id;
  if v_school_status not in ('batches_scheduled', 'exam_in_progress') then
    insert into public.oly_pin_attempt_log
      (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'enrollment_closed');
    return jsonb_build_object('ok', false, 'reason', 'enrollment_closed');
  end if;

  -- Find student's assigned batch
  select oly_batch_id into v_assigned_batch_id
    from public.oly_batch_assignments where oly_student_id = v_student.id;
  if v_assigned_batch_id is null then
    insert into public.oly_pin_attempt_log
      (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'wrong_batch');
    return jsonb_build_object('ok', false, 'reason', 'wrong_batch');
  end if;

  -- Find batch by PIN within this school (strict scope)
  select id, pin, pin_expiry_minutes, pin_first_used_at, status, scheduled_at
    into v_batch
    from public.oly_batches
   where pin = v_clean_pin and oly_school_id = v_student.oly_school_id;
  if v_batch.id is null then
    insert into public.oly_pin_attempt_log
      (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'wrong_pin');
    return jsonb_build_object('ok', false, 'reason', 'wrong_pin');
  end if;

  v_resolved_batch_id := v_batch.id;

  -- Strict batch binding: the PIN entered must match the student's own batch
  if v_batch.id <> v_assigned_batch_id then
    insert into public.oly_pin_attempt_log
      (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent,
       outcome, resolved_batch_id)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent,
              'wrong_batch', v_resolved_batch_id);
    return jsonb_build_object('ok', false, 'reason', 'wrong_batch');
  end if;

  -- PIN expiry check
  if v_batch.pin_first_used_at is not null
     and v_now > v_batch.pin_first_used_at + (v_batch.pin_expiry_minutes * interval '1 minute')
  then
    insert into public.oly_pin_attempt_log
      (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent,
       outcome, resolved_batch_id)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent,
              'expired_pin', v_resolved_batch_id);
    return jsonb_build_object('ok', false, 'reason', 'expired_pin');
  end if;

  -- Phase 4b: already_attempted check.
  -- Reject if the student has a completed attempt (non-in_progress status).
  -- Allow in_progress status so session resume works (student can re-enter PIN
  -- after a crash without getting blocked).
  select status into v_attempt_status
    from public.oly_attempts
   where oly_student_id = v_student.id;
  if v_attempt_status is not null and v_attempt_status <> 'in_progress' then
    insert into public.oly_pin_attempt_log
      (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent,
       outcome, resolved_batch_id)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent,
              'already_attempted', v_resolved_batch_id);
    return jsonb_build_object('ok', false, 'reason', 'already_attempted');
  end if;

  -- Success — log + atomically set pin_first_used_at if this is the first use
  insert into public.oly_pin_attempt_log
    (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent,
     outcome, resolved_batch_id)
    values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent,
            'success', v_resolved_batch_id);

  -- Atomic first-use timestamp — only the first student to use the PIN updates this
  update public.oly_batches
     set pin_first_used_at = v_now
   where id = v_resolved_batch_id
     and pin_first_used_at is null;

  return jsonb_build_object(
    'ok',          true,
    'batch_id',    v_resolved_batch_id,
    'student_id',  v_student.id,
    'scheduled_at',v_batch.scheduled_at
  );
end;
$$;

grant execute on function public.oly_validate_pin(text, text, text) to authenticated;

-- =========================================================================
-- 2.7 (continued)  UPDATE oly_student_dashboard_context — add attempt field
-- =========================================================================
-- Full CREATE OR REPLACE with Phase 4a body + the attempt object added to the return.
create or replace function public.oly_student_dashboard_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid                  uuid := auth.uid();
  v_student              record;
  v_batch                jsonb;
  v_subjects             jsonb;
  v_school_name          text;
  v_campaign_year        integer;
  v_study_material_count integer;
  v_attempt              record;  -- Phase 4b addition
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select s.id, s.oly_school_id, s.grade_level_id, s.full_name, s.roll_number,
         s.section_label, s.subject_ids, s.date_of_birth, s.campaign_id
    into v_student
    from public.oly_students s
   where (s.auth_user_id = v_uid or s.profile_id = v_uid)
     and s.status = 'active'
   limit 1;

  if v_student.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_enrollment');
  end if;

  -- School name (via institutions join)
  select i.name into v_school_name
    from public.oly_schools sc
    join public.institutions i on i.id = sc.institution_id
   where sc.id = v_student.oly_school_id;

  -- Campaign year
  select campaign_year into v_campaign_year
    from public.oly_campaigns where id = v_student.campaign_id;

  -- Assigned batch (PIN not exposed to client)
  select jsonb_build_object(
    'id',                 b.id,
    'batch_label',        b.batch_label,
    'scheduled_at',       b.scheduled_at,
    'pin_expiry_minutes', b.pin_expiry_minutes,
    'pin_first_used_at',  b.pin_first_used_at,
    'status',             b.status,
    'is_absentees',       b.is_absentees
  ) into v_batch
  from public.oly_batch_assignments oba
  join public.oly_batches b on b.id = oba.oly_batch_id
  where oba.oly_student_id = v_student.id;

  -- Subject names for the 3 chosen subjects
  select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
    into v_subjects
    from public.oly_subjects s
   where s.id = any(v_student.subject_ids);

  -- Study material count for chosen subjects + grade level
  select count(*) into v_study_material_count
    from public.oly_study_materials sm
   where sm.subject_id = any(v_student.subject_ids)
     and sm.grade_level_id = v_student.grade_level_id;

  -- Phase 4b: fetch the student's attempt status (null if not yet started)
  select id, status, submitted_at, submit_reason into v_attempt
    from public.oly_attempts
   where oly_student_id = v_student.id;

  return jsonb_build_object(
    'ok',                  true,
    'student', jsonb_build_object(
      'id',              v_student.id,
      'oly_school_id',   v_student.oly_school_id,
      'grade_level_id',  v_student.grade_level_id,
      'full_name',       v_student.full_name,
      'roll_number',     v_student.roll_number,
      'section_label',   v_student.section_label,
      'subject_ids',     v_student.subject_ids,
      'date_of_birth',   v_student.date_of_birth
    ),
    'school_name',         v_school_name,
    'campaign_year',       v_campaign_year,
    'batch',               v_batch,
    'subjects',            v_subjects,
    'study_material_count',v_study_material_count,
    -- Attempt: null if not started, otherwise { id, status, submitted_at, submit_reason }
    'attempt', case
      when v_attempt.id is null then null
      else jsonb_build_object(
        'id',            v_attempt.id,
        'status',        v_attempt.status,
        'submitted_at',  v_attempt.submitted_at,
        'submit_reason', v_attempt.submit_reason
      )
    end
  );
end;
$$;

grant execute on function public.oly_student_dashboard_context() to authenticated;
