-- School staff (school_admin / super_school_admin / coordinator) can read
-- study-material catalog rows for the grades their institution participates
-- in. Until now only super admins (Phase 1) and olympiad students (Phase 4a)
-- could see oly_study_materials — the school-admin "Study Material" page
-- needs read access too. Signed-URL fetches already work for any
-- authenticated user via the Phase 4a storage policy; the table row (and its
-- storage_path) is the actual gate.
--
-- §23: RLS goes through a SECURITY DEFINER helper, no inline cross-table
-- EXISTS in the policy itself.

create or replace function public.oly_school_staff_can_read_material(
  _grade_level_id uuid,
  _user_id uuid
) returns boolean
language sql stable security definer set search_path = public
as $$
  select (
    public.has_role(_user_id, 'school_admin'::app_role)
    or public.has_role(_user_id, 'super_school_admin'::app_role)
    or public.has_role(_user_id, 'coordinator'::app_role)
  ) and exists (
    select 1
      from public.profiles p
      join public.oly_schools os on os.institution_id = p.institution_id
     where p.id = _user_id
       and _grade_level_id = any(os.participating_grade_level_ids)
  );
$$;

drop policy if exists "school staff read scoped materials" on public.oly_study_materials;
create policy "school staff read scoped materials"
  on public.oly_study_materials for select
  using (public.oly_school_staff_can_read_material(grade_level_id, auth.uid()));
