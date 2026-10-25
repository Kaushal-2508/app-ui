-- Olympiad students could not LIST their study materials.
--
-- oly_study_materials had only a "super_admin all" policy (Phase 1) and a
-- "school staff read scoped" policy (20260611150000). There was NEVER a student
-- SELECT policy — Phase 4a only added SECURITY DEFINER helpers (the dashboard
-- count + the signed-URL path RPC), not a table-level read policy.
--
-- Result: the dashboard RPC reports e.g. "Study materials: 6" (SECURITY DEFINER,
-- bypasses RLS) but the student's direct list query (useOlympiadStudentStudyMaterials)
-- returns 0 rows under RLS — so the dashboard list and every per-subject study
-- page render empty, and the "Study materials" tile scrolls to a section that
-- isn't there.
--
-- Fix: a scoped student read policy. §23 — the cross-table check lives in a
-- SECURITY DEFINER helper, never inline in the policy.

create or replace function public.oly_student_can_read_material(
  _subject_id uuid,
  _grade_level_id uuid,
  _user_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.oly_students s
     where (s.auth_user_id = _user_id or s.profile_id = _user_id)
       and s.status = 'active'
       and s.grade_level_id = _grade_level_id
       and _subject_id = any(s.subject_ids)
  );
$$;

grant execute on function public.oly_student_can_read_material(uuid, uuid, uuid) to authenticated;

drop policy if exists "student read scoped materials" on public.oly_study_materials;
create policy "student read scoped materials"
  on public.oly_study_materials for select
  using (public.oly_student_can_read_material(subject_id, grade_level_id, auth.uid()));
