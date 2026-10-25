-- Fix the "teacher SELECT own school" RLS policy on oly_schools.
--
-- The original (in migration 20260526114522_oly_phase_3a_operations.sql) wrote:
--   exists(select 1 from oly_teacher_class_assignments
--           where oly_school_id = id and teacher_profile_id = auth.uid())
-- Inside that subquery, bare `id` resolves to oly_teacher_class_assignments.id
-- (its own FROM table), NOT to oly_schools.id. The condition therefore checks
-- assignment.oly_school_id = assignment.id, which is virtually never true, so
-- teachers were silently denied direct SELECT on oly_schools. .maybeSingle()
-- returns {data: null, error: null} under RLS denial, so callers got null
-- without an error — exactly what masked this for so long.
--
-- The sibling policy in oly_phase_3b_batching for oly_batches got it right
-- with public.oly_batches.oly_school_id; this fix mirrors that qualification.

drop policy if exists "teacher SELECT own school" on public.oly_schools;

create policy "teacher SELECT own school" on public.oly_schools for select
  using (exists(
    select 1 from public.oly_teacher_class_assignments
     where oly_teacher_class_assignments.oly_school_id = oly_schools.id
       and oly_teacher_class_assignments.teacher_profile_id = auth.uid()
  ));
