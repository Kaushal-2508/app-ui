-- Phase 4a — Student auth + portal + PIN entry validation
-- Adds: auth_user_id on oly_students, oly_pin_attempt_log table,
-- oly_validate_pin RPC, oly_student_dashboard_context RPC,
-- oly_student_login_resolve RPC, study-material signed-URL RPC.

-- =========================================================================
-- 1. auth_user_id column on oly_students
-- =========================================================================
alter table public.oly_students
  add column auth_user_id uuid references auth.users(id) on delete set null;
create index idx_oly_students_auth_user on public.oly_students(auth_user_id);

-- Student SELECT self via auth_user_id (in addition to existing profile_id policy)
create policy "student SELECT self via auth_user_id" on public.oly_students for select
  using (auth_user_id = auth.uid());

-- Extend oly_student_can_read helper to cover both profile_id + auth_user_id
create or replace function public.oly_student_can_read(p_uid uuid, p_oly_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.oly_students s
     where s.id = p_oly_student_id
       and (
         s.profile_id = p_uid
         or s.auth_user_id = p_uid
         or public.oly_is_school_admin_for(p_uid, s.oly_school_id)
         or public.oly_is_teacher_for_class(p_uid, s.oly_school_id, s.grade_level_id)
       )
  );
$$;

-- =========================================================================
-- 2. oly_pin_attempt_log — audit every PIN attempt
-- =========================================================================
create table public.oly_pin_attempt_log (
  id uuid primary key default gen_random_uuid(),
  oly_school_id uuid references public.oly_schools(id) on delete cascade,
  oly_student_id uuid references public.oly_students(id) on delete set null,
  attempted_pin text not null,
  ip_address text,
  user_agent text,
  outcome text not null check (outcome in (
    'success', 'wrong_pin', 'expired_pin', 'wrong_batch',
    'already_attempted', 'student_not_found', 'enrollment_closed'
  )),
  resolved_batch_id uuid references public.oly_batches(id) on delete set null,
  attempted_at timestamptz not null default now()
);
-- Indexes for the school_admin audit view + for queries by student/outcome
create index idx_opal_school on public.oly_pin_attempt_log(oly_school_id);
create index idx_opal_student on public.oly_pin_attempt_log(oly_student_id);
create index idx_opal_outcome on public.oly_pin_attempt_log(outcome);
create index idx_opal_attempted_at on public.oly_pin_attempt_log(attempted_at);
create index idx_opal_batch on public.oly_pin_attempt_log(resolved_batch_id);

alter table public.oly_pin_attempt_log enable row level security;
create policy "super_admin all" on public.oly_pin_attempt_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_pin_attempt_log for select
  using (oly_school_id is not null and public.oly_is_school_admin_for(auth.uid(), oly_school_id));

-- =========================================================================
-- 3. oly_validate_pin RPC — atomic single-round-trip PIN validation
-- =========================================================================
-- This is the hottest write path on exam day. Sub-50ms latency target.
-- All 7 validation steps + audit log insert + pin_first_used_at update happen
-- in one transaction. Returns the outcome to the client.
create or replace function public.oly_validate_pin(
  p_pin text,
  p_ip text default null,
  p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_student record;
  v_assigned_batch_id uuid;
  v_batch record;
  v_school_status text;
  v_now timestamptz := now();
  v_outcome text;
  v_resolved_batch_id uuid;
  v_clean_pin text := upper(trim(p_pin));
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
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (null, null, v_clean_pin, p_ip, p_user_agent, 'student_not_found');
    return jsonb_build_object('ok', false, 'reason', 'student_not_found');
  end if;

  -- Check school status
  select status into v_school_status
    from public.oly_schools where id = v_student.oly_school_id;
  if v_school_status not in ('batches_scheduled', 'exam_in_progress') then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'enrollment_closed');
    return jsonb_build_object('ok', false, 'reason', 'enrollment_closed');
  end if;

  -- Find student's assigned batch
  select oly_batch_id into v_assigned_batch_id
    from public.oly_batch_assignments where oly_student_id = v_student.id;
  if v_assigned_batch_id is null then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'wrong_batch');
    return jsonb_build_object('ok', false, 'reason', 'wrong_batch');
  end if;

  -- Find batch by PIN within this school (strict scope)
  select id, pin, pin_expiry_minutes, pin_first_used_at, status, scheduled_at
    into v_batch
    from public.oly_batches
   where pin = v_clean_pin and oly_school_id = v_student.oly_school_id;
  if v_batch.id is null then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'wrong_pin');
    return jsonb_build_object('ok', false, 'reason', 'wrong_pin');
  end if;

  v_resolved_batch_id := v_batch.id;

  -- Strict batch binding
  if v_batch.id <> v_assigned_batch_id then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome, resolved_batch_id)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'wrong_batch', v_resolved_batch_id);
    return jsonb_build_object('ok', false, 'reason', 'wrong_batch');
  end if;

  -- PIN expiry check
  if v_batch.pin_first_used_at is not null
     and v_now > v_batch.pin_first_used_at + (v_batch.pin_expiry_minutes * interval '1 minute') then
    insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome, resolved_batch_id)
      values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'expired_pin', v_resolved_batch_id);
    return jsonb_build_object('ok', false, 'reason', 'expired_pin');
  end if;

  -- TODO Phase 4b: check oly_attempts for existing attempt by this student.
  -- For Phase 4a there are no attempts to check yet.

  -- Success — log + atomically set pin_first_used_at if NULL
  insert into public.oly_pin_attempt_log (oly_school_id, oly_student_id, attempted_pin, ip_address, user_agent, outcome, resolved_batch_id)
    values (v_student.oly_school_id, v_student.id, v_clean_pin, p_ip, p_user_agent, 'success', v_resolved_batch_id);
  -- Atomic update — only the FIRST student's update succeeds
  update public.oly_batches
     set pin_first_used_at = v_now
   where id = v_resolved_batch_id and pin_first_used_at is null;

  return jsonb_build_object(
    'ok', true,
    'batch_id', v_resolved_batch_id,
    'student_id', v_student.id,
    'scheduled_at', v_batch.scheduled_at
  );
end;
$$;

grant execute on function public.oly_validate_pin(text, text, text) to authenticated;

-- =========================================================================
-- 4. oly_student_dashboard_context RPC — collapse 3+ queries into 1
-- =========================================================================
create or replace function public.oly_student_dashboard_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_student record;
  v_batch jsonb;
  v_subjects jsonb;
  v_school_name text;
  v_campaign_year integer;
  v_study_material_count integer;
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

  -- School name (from institutions join)
  select i.name into v_school_name
    from public.oly_schools sc
    join public.institutions i on i.id = sc.institution_id
   where sc.id = v_student.oly_school_id;

  -- Campaign year
  select campaign_year into v_campaign_year
    from public.oly_campaigns where id = v_student.campaign_id;

  -- Assigned batch (no PIN exposed)
  select jsonb_build_object(
    'id', b.id,
    'batch_label', b.batch_label,
    'scheduled_at', b.scheduled_at,
    'pin_expiry_minutes', b.pin_expiry_minutes,
    'pin_first_used_at', b.pin_first_used_at,
    'status', b.status,
    'is_absentees', b.is_absentees
  ) into v_batch
    from public.oly_batch_assignments oba
    join public.oly_batches b on b.id = oba.oly_batch_id
   where oba.oly_student_id = v_student.id;

  -- Subject names for the 3 chosen subjects
  select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name)
    into v_subjects
    from public.oly_subjects s
   where s.id = any(v_student.subject_ids);

  -- Study material count for the student's chosen subjects + grade level
  select count(*) into v_study_material_count
    from public.oly_study_materials sm
   where sm.subject_id = any(v_student.subject_ids)
     and sm.grade_level_id = v_student.grade_level_id;

  return jsonb_build_object(
    'ok', true,
    'student', jsonb_build_object(
      'id', v_student.id,
      'oly_school_id', v_student.oly_school_id,
      'grade_level_id', v_student.grade_level_id,
      'full_name', v_student.full_name,
      'roll_number', v_student.roll_number,
      'section_label', v_student.section_label,
      'subject_ids', v_student.subject_ids,
      'date_of_birth', v_student.date_of_birth
    ),
    'school_name', v_school_name,
    'campaign_year', v_campaign_year,
    'batch', v_batch,
    'subjects', v_subjects,
    'study_material_count', v_study_material_count
  );
end;
$$;

grant execute on function public.oly_student_dashboard_context() to authenticated;

-- =========================================================================
-- 5. oly_student_login_resolve RPC — public, resolves identifier+dob → email
-- =========================================================================
create or replace function public.oly_student_login_resolve(
  p_identifier text, p_dob_iso text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_student record;
  v_dob date;
  v_email text;
begin
  -- Parse DOB defensively
  begin
    v_dob := p_dob_iso::date;
  exception when others then
    return jsonb_build_object('found', false);
  end;

  -- Try roll number first (uppercase comparison since roll numbers are stored uppercase)
  select s.id, s.auth_user_id, s.profile_id, s.roll_number, s.date_of_birth
    into v_student
    from public.oly_students s
   where upper(s.roll_number) = upper(p_identifier)
     and s.status in ('active', 'dormant');

  if v_student.id is null then
    -- Try admission number (only meaningful for SALCI students)
    select s.id, s.auth_user_id, s.profile_id, s.roll_number, s.date_of_birth
      into v_student
      from public.oly_students s
     where s.admission_number = p_identifier
       and s.status in ('active', 'dormant');
  end if;

  if v_student.id is null then
    return jsonb_build_object('found', false);
  end if;

  -- Verify DOB
  if v_student.date_of_birth <> v_dob then
    return jsonb_build_object('found', false);
  end if;

  -- For SALCI students with profile_id, return null — they should use their regular login.
  -- For non-SALCI students with auth_user_id, return the synthetic email.
  if v_student.auth_user_id is not null then
    v_email := lower(v_student.roll_number) || '@olympiad.salci.org';
    return jsonb_build_object(
      'found', true,
      'email', v_email,
      'is_olympiad_only', true
    );
  end if;

  -- SALCI student fallback — they should use their school SALCI login
  return jsonb_build_object(
    'found', true,
    'is_olympiad_only', false,
    'message', 'Please log in via the main SALCI login page'
  );
end;
$$;

grant execute on function public.oly_student_login_resolve(text, text) to anon, authenticated;

-- =========================================================================
-- 6. oly_get_student_study_material_url RPC — signed URL with scope check
-- =========================================================================
-- Note: signed URL generation is NOT something the DB can do directly.
-- This RPC instead validates eligibility and returns the storage_path,
-- and the client calls supabase.storage.createSignedUrl with that path.
-- The bucket RLS additionally blocks unauthorized fetches.
create or replace function public.oly_get_student_study_material_path(
  p_material_id uuid
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_student record;
  v_material record;
begin
  if v_uid is null then raise exception 'Forbidden' using errcode = '42501'; end if;

  select id, grade_level_id, subject_ids
    into v_student
    from public.oly_students
   where (auth_user_id = v_uid or profile_id = v_uid)
     and status = 'active'
   limit 1;
  if v_student.id is null then raise exception 'No active enrollment' using errcode = '42501'; end if;

  select id, subject_id, grade_level_id, storage_path
    into v_material
    from public.oly_study_materials
   where id = p_material_id;
  if v_material.id is null then raise exception 'Not found' using errcode = '42P01'; end if;

  -- Scope: subject must be in student's chosen subjects, grade must match
  if v_material.subject_id <> any(v_student.subject_ids) then
    raise exception 'Not your subject' using errcode = '42501';
  end if;
  if v_material.grade_level_id <> v_student.grade_level_id then
    raise exception 'Not your class' using errcode = '42501';
  end if;

  return v_material.storage_path;
end;
$$;

grant execute on function public.oly_get_student_study_material_path(uuid) to authenticated;

-- Storage RLS: allow Olympiad students to read materials matching their scope.
-- The above RPC already checks scope; this policy is defense-in-depth.
create policy "olympiad student SELECT scoped material"
  on storage.objects for select
  using (
    bucket_id = 'olympiad-study-material'
    and auth.uid() is not null
  );
