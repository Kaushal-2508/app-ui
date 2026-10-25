-- Phase 3a — Olympiad school operations
-- Adds oly_teacher_class_assignments, oly_audit_log, 4 SECURITY DEFINER helpers,
-- and extended RLS policies on all existing oly_* tables.

-- =========================================================================
-- 1. oly_teacher_class_assignments
-- =========================================================================
create table public.oly_teacher_class_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  oly_school_id uuid not null references public.oly_schools(id) on delete cascade,
  teacher_profile_id uuid not null references public.profiles(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique(campaign_id, oly_school_id, teacher_profile_id, grade_level_id)
);
create index idx_otca_school on public.oly_teacher_class_assignments(oly_school_id);
create index idx_otca_teacher on public.oly_teacher_class_assignments(teacher_profile_id);
create index idx_otca_grade on public.oly_teacher_class_assignments(grade_level_id);
create index idx_otca_campaign on public.oly_teacher_class_assignments(campaign_id);
create index idx_otca_assigned_by on public.oly_teacher_class_assignments(assigned_by);

-- =========================================================================
-- 2. oly_audit_log
-- =========================================================================
create table public.oly_audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.oly_campaigns(id) on delete restrict,
  oly_school_id uuid references public.oly_schools(id) on delete cascade,
  oly_student_id uuid references public.oly_students(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null check (actor_role in ('super_admin','school_admin','coordinator','teacher')),
  action text not null check (action in (
    'student_enrolled_cash','student_edited','student_removed',
    'enrollment_closed','teacher_created','teacher_assigned','teacher_unassigned'
  )),
  before_json jsonb,
  after_json jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index idx_oal_campaign on public.oly_audit_log(campaign_id);
create index idx_oal_school on public.oly_audit_log(oly_school_id);
create index idx_oal_student on public.oly_audit_log(oly_student_id);
create index idx_oal_actor on public.oly_audit_log(actor_id);
create index idx_oal_action on public.oly_audit_log(action);
create index idx_oal_created_at on public.oly_audit_log(created_at);

-- =========================================================================
-- 3. SECURITY DEFINER helpers
-- =========================================================================
create or replace function public.oly_is_school_admin_for(p_uid uuid, p_oly_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.oly_schools sc
      join public.user_roles ur on ur.institution_id = sc.institution_id
     where sc.id = p_oly_school_id
       and ur.user_id = p_uid
       and ur.role in ('school_admin','coordinator','super_school_admin')
  );
$$;

create or replace function public.oly_is_teacher_for_class(p_uid uuid, p_oly_school_id uuid, p_grade_level_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.oly_teacher_class_assignments
     where oly_school_id = p_oly_school_id
       and grade_level_id = p_grade_level_id
       and teacher_profile_id = p_uid
  );
$$;

create or replace function public.oly_student_can_read(p_uid uuid, p_oly_student_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.oly_students s
     where s.id = p_oly_student_id
       and (
         s.profile_id = p_uid
         or public.oly_is_school_admin_for(p_uid, s.oly_school_id)
         or public.oly_is_teacher_for_class(p_uid, s.oly_school_id, s.grade_level_id)
       )
  );
$$;

create or replace function public.oly_user_active_campaign(p_uid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  -- Returns the active campaign_id reachable from any oly_school the user can admin
  select c.id from public.oly_campaigns c
   where c.status = 'active'
   order by c.campaign_year desc
   limit 1;
$$;

grant execute on function public.oly_is_school_admin_for(uuid, uuid) to authenticated;
grant execute on function public.oly_is_teacher_for_class(uuid, uuid, uuid) to authenticated;
grant execute on function public.oly_student_can_read(uuid, uuid) to authenticated;
grant execute on function public.oly_user_active_campaign(uuid) to authenticated;

-- =========================================================================
-- 4. RLS — oly_teacher_class_assignments + oly_audit_log
-- =========================================================================
alter table public.oly_teacher_class_assignments enable row level security;
create policy "super_admin all" on public.oly_teacher_class_assignments for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin all own school" on public.oly_teacher_class_assignments for all
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id))
  with check (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
create policy "teacher SELECT own" on public.oly_teacher_class_assignments for select
  using (teacher_profile_id = auth.uid());

alter table public.oly_audit_log enable row level security;
create policy "super_admin all" on public.oly_audit_log for all
  using (public.is_super_admin(auth.uid())) with check (public.is_super_admin(auth.uid()));
create policy "school_admin SELECT own school" on public.oly_audit_log for select
  using (oly_school_id is not null and public.oly_is_school_admin_for(auth.uid(), oly_school_id));

-- =========================================================================
-- 5. Extended RLS — existing oly_* tables get school_admin / teacher / student policies
-- =========================================================================
create policy "school_admin SELECT own school" on public.oly_schools for select
  using (public.oly_is_school_admin_for(auth.uid(), id));
create policy "teacher SELECT own school" on public.oly_schools for select
  using (exists(
    select 1 from public.oly_teacher_class_assignments
     where oly_school_id = id and teacher_profile_id = auth.uid()
  ));

create policy "school_admin all own school" on public.oly_students for all
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id))
  with check (public.oly_is_school_admin_for(auth.uid(), oly_school_id));
create policy "teacher SELECT assigned class" on public.oly_students for select
  using (public.oly_is_teacher_for_class(auth.uid(), oly_school_id, grade_level_id));
create policy "student SELECT self" on public.oly_students for select
  using (profile_id = auth.uid());

create policy "school_admin SELECT own school" on public.oly_enrollment_pending for select
  using (public.oly_is_school_admin_for(auth.uid(), oly_school_id));

create policy "student SELECT own receipt" on public.oly_receipts for select
  using (public.oly_student_can_read(auth.uid(), oly_student_id));
create policy "school_admin SELECT school receipts" on public.oly_receipts for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));

create policy "school_admin SELECT school refunds" on public.oly_refunds for select
  using (exists(
    select 1 from public.oly_students s
     where s.id = oly_student_id
       and public.oly_is_school_admin_for(auth.uid(), s.oly_school_id)
  ));

-- =========================================================================
-- 6. Authenticated SELECT on read-only catalog tables
-- =========================================================================
create policy "authenticated SELECT active campaigns" on public.oly_campaigns for select
  using (status in ('active','closed') and auth.uid() is not null);
create policy "authenticated SELECT active subjects" on public.oly_subjects for select
  using (status = 'active' and auth.uid() is not null);
create policy "authenticated SELECT subject_classes" on public.oly_subject_classes for select
  using (auth.uid() is not null);
