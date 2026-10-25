-- Fix infinite recursion (42P17) between oly_batches and oly_batch_assignments.
--
-- oly_batches "student SELECT own batch" policy had an inline
--   EXISTS (SELECT 1 FROM oly_batch_assignments oba JOIN oly_students s ...)
-- and oly_batch_assignments "school_admin all own school" policy had an inline
--   EXISTS (SELECT 1 FROM oly_batches b WHERE ... oly_is_school_admin_for ...)
-- The two tables reference each other in RLS, so evaluating RLS on either table
-- recurses into the other and back -> Postgres raises 42P17 on every SELECT.
-- Effect: school admins (and students) got 500s; the Batch Schedule and PIN
-- Custody pages rendered blank even though the batch existed and the admin was
-- authorized.
--
-- Per CLAUDE.md §23: cross-table checks between mutually-referencing tables must
-- be wrapped in SECURITY DEFINER helpers (which bypass RLS), breaking the cycle.

create or replace function public.oly_batch_school_id(p_batch_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select oly_school_id from public.oly_batches where id = p_batch_id;
$$;

create or replace function public.oly_student_can_see_batch(p_batch_id uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1
      from public.oly_batch_assignments oba
      join public.oly_students s on s.id = oba.oly_student_id
     where oba.oly_batch_id = p_batch_id
       and s.profile_id = p_uid
  );
$$;

grant execute on function public.oly_batch_school_id(uuid) to authenticated;
grant execute on function public.oly_student_can_see_batch(uuid, uuid) to authenticated;

-- Recreate the two offending policies using the helpers (no inline cross-table EXISTS).
drop policy if exists "student SELECT own batch" on public.oly_batches;
create policy "student SELECT own batch" on public.oly_batches for select
  using (public.oly_student_can_see_batch(id, auth.uid()));

drop policy if exists "school_admin all own school" on public.oly_batch_assignments;
create policy "school_admin all own school" on public.oly_batch_assignments for all
  using (public.oly_is_school_admin_for(auth.uid(), public.oly_batch_school_id(oly_batch_id)))
  with check (public.oly_is_school_admin_for(auth.uid(), public.oly_batch_school_id(oly_batch_id)));
