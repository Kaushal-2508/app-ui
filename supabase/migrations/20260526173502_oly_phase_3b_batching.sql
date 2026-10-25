-- Phase 3b — Batching + PIN custody + reminders + credentials
-- Adds oly_batches, oly_batch_assignments, oly_reminder_log, PIN-hiding view,
-- PIN generator + regenerate RPC, and pg_cron job for pre-exam reminders.

-- =========================================================================
-- 1. oly_batches
-- =========================================================================
create table public.oly_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  grade_level_id uuid references public.grade_levels(id) on delete restrict,
  batch_label text not null,
  scheduled_at timestamptz not null,
  pc_count integer not null check (pc_count > 0),
  pin text,
  pin_expiry_minutes integer not null default 120 check (pin_expiry_minutes > 0),
  pin_first_used_at timestamptz,
  is_absentees boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'locked', 'in_progress', 'completed', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  unique(oly_school_id, scheduled_at, grade_level_id, is_absentees)
);
create index idx_oly_batches_school on public.oly_batches(oly_school_id);
create index idx_oly_batches_campaign on public.oly_batches(campaign_id);
create index idx_oly_batches_grade_level on public.oly_batches(grade_level_id);
create index idx_oly_batches_scheduled_at on public.oly_batches(scheduled_at);
create index idx_oly_batches_status on public.oly_batches(status);
create index idx_oly_batches_pin on public.oly_batches(pin) where pin is not null;
create index idx_oly_batches_created_by on public.oly_batches(created_by);
create trigger oly_batches_set_updated_at before update on public.oly_batches
  for each row execute function public.oly_set_updated_at();

-- =========================================================================
-- 2. oly_batch_assignments — strict 1:1 student to batch
-- =========================================================================
create table public.oly_batch_assignments (
  id uuid primary key default gen_random_uuid(),
  oly_batch_id uuid not null references public.oly_batches(id) on delete cascade,
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique(oly_student_id)
);
create index idx_oba_batch on public.oly_batch_assignments(oly_batch_id);
create index idx_oba_student on public.oly_batch_assignments(oly_student_id);

-- =========================================================================
-- 3. oly_reminder_log — idempotent cron-sent reminders
-- =========================================================================
create table public.oly_reminder_log (
  id uuid primary key default gen_random_uuid(),
  oly_batch_id uuid not null references public.oly_batches(id) on delete cascade,
  oly_student_id uuid not null references public.oly_students(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('pre_exam_3d')),
  sent_at timestamptz not null default now(),
  sent_to_email text,
  unique(oly_batch_id, oly_student_id, reminder_type)
);
create index idx_orl_batch on public.oly_reminder_log(oly_batch_id);
create index idx_orl_student on public.oly_reminder_log(oly_student_id);
create index idx_orl_sent_at on public.oly_reminder_log(sent_at);

-- =========================================================================
-- 4. PIN-hiding wrapper view
-- =========================================================================
create view public.oly_batches_no_pin
with (security_invoker = true)
as
select
  id, campaign_id, oly_school_id, grade_level_id, batch_label,
  scheduled_at, pc_count, pin_expiry_minutes, pin_first_used_at,
  is_absentees, status, created_at, updated_at, locked_at
from public.oly_batches;

grant select on public.oly_batches_no_pin to authenticated;

-- =========================================================================
-- 5. RLS — oly_batches
-- =========================================================================
alter table public.oly_batches enable row level security;
create policy "super_admin all" on public.oly_batches for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin all own school" on public.oly_batches for all
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id))
  with check (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
create policy "teacher SELECT own school" on public.oly_batches for select
  using (exists(
    select 1 from public.oly_teacher_class_assignments
     where oly_school_id = public.oly_batches.oly_school_id
       and teacher_profile_id = auth.uid()
  ));
create policy "student SELECT own batch" on public.oly_batches for select
  using (exists(
    select 1 from public.oly_batch_assignments oba
      join public.oly_students s on s.id = oba.oly_student_id
     where oba.oly_batch_id = public.oly_batches.id
       and s.profile_id = auth.uid()
  ));

-- =========================================================================
-- 6. RLS — oly_batch_assignments
-- =========================================================================
alter table public.oly_batch_assignments enable row level security;
create policy "super_admin all" on public.oly_batch_assignments for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin all own school" on public.oly_batch_assignments for all
  using (exists(
    select 1 from public.oly_batches b
     where b.id = oly_batch_id
       and public.oly_is_school_admin_for(auth.uid(), b.oly_school_id)
  ))
  with check (exists(
    select 1 from public.oly_batches b
     where b.id = oly_batch_id
       and public.oly_is_school_admin_for(auth.uid(), b.oly_school_id)
  ));
create policy "teacher SELECT own classes" on public.oly_batch_assignments for select
  using (exists(
    select 1 from public.oly_students s
      join public.oly_teacher_class_assignments tca
        on tca.oly_school_id = s.oly_school_id
        and tca.grade_level_id = s.grade_level_id
        and tca.teacher_profile_id = auth.uid()
     where s.id = oly_student_id
  ));
create policy "student SELECT own" on public.oly_batch_assignments for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and s.profile_id = auth.uid()
  ));

-- =========================================================================
-- 7. RLS — oly_reminder_log
-- =========================================================================
alter table public.oly_reminder_log enable row level security;
create policy "super_admin all" on public.oly_reminder_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_reminder_log for select
  using (exists(
    select 1 from public.oly_batches b
     where b.id = oly_batch_id
       and public.oly_is_school_admin_for(auth.uid(), b.oly_school_id)
  ));

-- =========================================================================
-- 8. PIN generator function
-- =========================================================================
create or replace function public.oly_generate_batch_pin()
returns text language plpgsql as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_len integer := 6;
  v_pin text;
  v_i integer;
  v_attempts integer := 0;
begin
  loop
    v_pin := '';
    for v_i in 1..v_len loop
      v_pin := v_pin || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    exit when not exists(
      select 1 from public.oly_batches
       where pin = v_pin
         and status in ('locked', 'in_progress')
    );
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'Could not generate unique batch PIN after 100 attempts';
    end if;
  end loop;
  return v_pin;
end;
$$;

-- =========================================================================
-- 9. Regenerate PIN RPC (audited) — first pass with temporary action label
-- =========================================================================
create or replace function public.oly_regenerate_batch_pin(p_batch_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_batch record;
  v_new_pin text;
  v_uid uuid := auth.uid();
begin
  select id, oly_school_id, campaign_id, status, pin_first_used_at
    into v_batch from public.oly_batches where id = p_batch_id;
  if v_batch.id is null then raise exception 'Batch not found'; end if;

  if not (public.is_super_admin(v_uid) or public.oly_is_school_admin_for(v_uid, v_batch.oly_school_id)) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if v_batch.pin_first_used_at is not null then
    raise exception 'Cannot regenerate PIN after a student has entered it';
  end if;
  if v_batch.status not in ('locked','draft') then
    raise exception 'Cannot regenerate PIN in status %', v_batch.status;
  end if;

  v_new_pin := public.oly_generate_batch_pin();
  update public.oly_batches set pin = v_new_pin where id = p_batch_id;

  -- Audit (Phase 3a oly_audit_log)
  insert into public.oly_audit_log (campaign_id, oly_school_id, actor_id, actor_role, action, after_json)
  values (
    v_batch.campaign_id, v_batch.oly_school_id, v_uid,
    case when public.is_super_admin(v_uid) then 'super_admin' else 'school_admin' end,
    'teacher_assigned',  -- temporary mapping; the audit log action enum doesn't include batch ops yet
    jsonb_build_object('batch_id', p_batch_id, 'pin_regenerated', true)
  );

  return v_new_pin;
end;
$$;

grant execute on function public.oly_regenerate_batch_pin(uuid) to authenticated;

-- =========================================================================
-- 10. Extend audit log action enum to include batch actions
-- =========================================================================
alter table public.oly_audit_log drop constraint if exists oly_audit_log_action_check;
alter table public.oly_audit_log add constraint oly_audit_log_action_check
  check (action in (
    'student_enrolled_cash','student_edited','student_removed',
    'enrollment_closed','teacher_created','teacher_assigned','teacher_unassigned',
    'batch_draft_generated','batches_locked','batch_pin_regenerated',
    'batch_rescheduled','credentials_pdf_generated','absentees_batch_created'
  ));

-- Re-apply the regenerate-PIN RPC with the correct action label now that
-- the constraint allows it
create or replace function public.oly_regenerate_batch_pin(p_batch_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_batch record;
  v_new_pin text;
  v_uid uuid := auth.uid();
begin
  select id, oly_school_id, campaign_id, status, pin_first_used_at
    into v_batch from public.oly_batches where id = p_batch_id;
  if v_batch.id is null then raise exception 'Batch not found'; end if;

  if not (public.is_super_admin(v_uid) or public.oly_is_school_admin_for(v_uid, v_batch.oly_school_id)) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if v_batch.pin_first_used_at is not null then
    raise exception 'Cannot regenerate PIN after a student has entered it';
  end if;
  if v_batch.status not in ('locked','draft') then
    raise exception 'Cannot regenerate PIN in status %', v_batch.status;
  end if;

  v_new_pin := public.oly_generate_batch_pin();
  update public.oly_batches set pin = v_new_pin where id = p_batch_id;

  insert into public.oly_audit_log (campaign_id, oly_school_id, actor_id, actor_role, action, after_json)
  values (
    v_batch.campaign_id, v_batch.oly_school_id, v_uid,
    case when public.is_super_admin(v_uid) then 'super_admin' else 'school_admin' end,
    'batch_pin_regenerated',
    jsonb_build_object('batch_id', p_batch_id, 'pin_regenerated', true)
  );

  return v_new_pin;
end;
$$;

-- =========================================================================
-- 11. pg_cron job — daily pre-exam reminders at 9 AM IST (3:30 AM UTC)
-- =========================================================================
-- Note: app.cron_secret must be set via: ALTER DATABASE postgres SET app.cron_secret = '<secret>';
-- The edge function checks this secret before sending emails.
do $$
begin
  perform cron.unschedule('oly-pre-exam-reminders');
exception when others then null;
end;
$$;

select cron.schedule(
  'oly-pre-exam-reminders',
  '30 3 * * *',  -- 3:30 UTC = 9:00 IST
  $job$
  select net.http_post(
    url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/oly-send-pre-exam-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $job$
);
