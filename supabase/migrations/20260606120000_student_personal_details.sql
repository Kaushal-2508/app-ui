-- Student personal & guardian details (1:1 with a student profile).
-- SALCI profiles store no DOB or guardian contact; this table holds them so
-- data collected during Olympiad cash-enroll surfaces in the student portal.
-- School-managed: written by service-role edge fn (and future admin UI),
-- read by the student themselves + institution staff. Read-only to students.

create table public.student_personal_details (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  date_of_birth  date,
  guardian_name  text,
  guardian_phone text,
  guardian_email text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);

-- FK index (profile_id is the PK, already indexed). Index the author FK (§23).
create index idx_student_personal_details_updated_by
  on public.student_personal_details(updated_by);

-- updated_at maintenance (repo-standard trigger fn used by 79 other tables).
create trigger student_personal_details_set_updated_at
  before update on public.student_personal_details
  for each row execute function public.update_updated_at_column();

-- ── SECURITY DEFINER helpers (no inline cross-table EXISTS in policies — §23) ──

create or replace function public.can_view_student_details(_profile_id uuid, _viewer uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    _viewer = _profile_id
    or public.is_super_admin(_viewer)
    or (
      exists (
        select 1 from public.profiles stu
         where stu.id = _profile_id
           and stu.institution_id = public.get_user_institution(_viewer)
      )
      and (
        public.has_role(_viewer, 'school_admin')
        or public.has_role(_viewer, 'super_school_admin')
        or public.has_role(_viewer, 'coordinator')
        or public.has_role(_viewer, 'teacher')
      )
    );
$$;

create or replace function public.can_write_student_details(_profile_id uuid, _writer uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    public.is_super_admin(_writer)
    or (
      exists (
        select 1 from public.profiles stu
         where stu.id = _profile_id
           and stu.institution_id = public.get_user_institution(_writer)
      )
      and (
        public.has_role(_writer, 'school_admin')
        or public.has_role(_writer, 'super_school_admin')
        or public.has_role(_writer, 'coordinator')
      )
    );
$$;

grant execute on function public.can_view_student_details(uuid, uuid) to authenticated;
grant execute on function public.can_write_student_details(uuid, uuid) to authenticated;

-- ── RLS ──
alter table public.student_personal_details enable row level security;

create policy "view student personal details"
  on public.student_personal_details for select to authenticated
  using (public.can_view_student_details(profile_id, auth.uid()));

create policy "insert student personal details"
  on public.student_personal_details for insert to authenticated
  with check (public.can_write_student_details(profile_id, auth.uid()));

create policy "update student personal details"
  on public.student_personal_details for update to authenticated
  using (public.can_write_student_details(profile_id, auth.uid()))
  with check (public.can_write_student_details(profile_id, auth.uid()));

-- No DELETE policy by design (default-deny for authenticated users): rows are
-- removed only via the profiles ON DELETE CASCADE on user deletion. The
-- service-role edge fn can still upsert/replace; if admins ever need to retract
-- details, add a DELETE policy guarded by can_write_student_details.
