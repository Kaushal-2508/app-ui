-- =========================================================================
-- Olympiad student identity: let synthetic students read their own oly_school
-- so the Olympiad-only lockdown (useIsOlympiadOnlyInstitution) detects them and
-- routes them to /student/olympiad with the collapsed sidebar. Pairs with the
-- oly-cash-enroll change that now gives each student a profile (name +
-- institution_id) and a 'student' role (required by the /student/olympiad
-- route) + the resolve-login-identifier fallback (main login by roll number).
-- =========================================================================

-- SECURITY DEFINER helper (avoids any cross-table RLS recursion, per §23).
create or replace function public.oly_is_student_of_school(p_uid uuid, p_oly_school_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.oly_students s
     where s.oly_school_id = p_oly_school_id
       and s.auth_user_id = p_uid
       and s.status in ('active', 'dormant')
  );
$$;
grant execute on function public.oly_is_student_of_school(uuid, uuid) to authenticated;

drop policy if exists "student SELECT own school" on public.oly_schools;
create policy "student SELECT own school" on public.oly_schools for select
  using (public.oly_is_student_of_school(auth.uid(), id));
