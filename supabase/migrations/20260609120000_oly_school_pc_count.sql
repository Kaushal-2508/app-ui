-- 20260609120000_oly_school_pc_count.sql
-- Lab capacity (students per batch) for the Olympiad batch builder.
-- Remembered per school so the admin doesn't re-enter it each scheduling session.
alter table public.oly_schools
  add column if not exists pc_count integer
  check (pc_count is null or pc_count > 0);

comment on column public.oly_schools.pc_count is
  'Computer-lab capacity (students per batch) for Olympiad batch scheduling; set once by the school admin.';
