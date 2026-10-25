-- Phase 5b — Passport integration support
-- The existing passport_academic_records is aggregate-only (UNIQUE(student_id, academic_year))
-- and lacks olympiad-specific fields (tier, rank, certificate, PDF path).
-- This additive table stores one row per SALCI student per Olympiad campaign.

create table public.passport_olympiad_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  oly_result_id uuid not null references public.oly_results(id) on delete cascade,
  campaign_year smallint not null,
  total_marks_obtained numeric not null,
  total_max_marks numeric not null,
  percentage numeric(5,2) not null,
  certificate_tier text not null,
  certificate_id text not null,
  school_rank integer,
  class_rank integer,
  result_pdf_path text,
  certificate_pdf_path text,
  created_at timestamptz not null default now(),
  unique (student_id, oly_result_id)
);

create index idx_poe_student on public.passport_olympiad_entries(student_id);
create index idx_poe_result on public.passport_olympiad_entries(oly_result_id);
create index idx_poe_year on public.passport_olympiad_entries(student_id, campaign_year);

alter table public.passport_olympiad_entries enable row level security;

create policy "students read own olympiad passport"
  on public.passport_olympiad_entries
  for select
  using (auth.uid() = student_id);

create policy "super admin all olympiad passport"
  on public.passport_olympiad_entries
  for all
  using (public.is_super_admin(auth.uid()))
  with check (public.is_super_admin(auth.uid()));

-- school admins / teachers within the same institution can read their students' entries
create policy "institution staff read olympiad passport"
  on public.passport_olympiad_entries
  for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = passport_olympiad_entries.student_id
        and p.institution_id = public.get_user_institution(auth.uid())
        and (public.has_role(auth.uid(), 'teacher')
          or public.has_role(auth.uid(), 'coordinator')
          or public.has_role(auth.uid(), 'school_admin')
          or public.has_role(auth.uid(), 'super_school_admin'))
    )
  );
