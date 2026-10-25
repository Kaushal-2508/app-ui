-- Fix: oly_list_salci_roster_for_grade RAISEd at runtime with
--   42804 structure of query does not match function result type
--   DETAIL: Returned type character varying(50) does not match expected type text in column 3
-- because profiles.admission_number is VARCHAR(50) (and classes.section /
-- profiles.full_name / oly_students.roll_number may also be varchar) while the
-- RETURNS TABLE declares those columns as `text`. PL/pgSQL RETURN QUERY is strict
-- about column types, so every call raised, the client hook fell back to [], and
-- the cash-enroll Student dropdown was always empty.
--
-- Cast every varchar-sourced string column to ::text so the projected types match
-- the declared RETURNS TABLE types exactly. Logic is otherwise unchanged.

create or replace function public.oly_list_salci_roster_for_grade(
  p_oly_school_id uuid,
  p_grade_level_id uuid
) returns table (
  profile_id uuid,
  full_name text,
  admission_number text,
  section_label text,
  date_of_birth date,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  already_enrolled boolean,
  enrolled_roll_number text
) language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_institution_id uuid;
  v_campaign_id uuid;
begin
  if not (
    public.oly_is_teacher_for_class(v_uid, p_oly_school_id, p_grade_level_id)
    or public.oly_is_school_admin_for(v_uid, p_oly_school_id)
    or public.is_super_admin(v_uid)
  ) then
    raise exception 'Not authorized to list students for this class';
  end if;

  select sc.institution_id, sc.campaign_id
    into v_institution_id, v_campaign_id
    from public.oly_schools sc
   where sc.id = p_oly_school_id;

  if v_institution_id is null then
    return;  -- net-new school (no SALCI institution) -> empty roster
  end if;

  return query
  with roster as (
    select distinct on (p.id)
           p.id               as r_profile_id,
           p.full_name        as r_full_name,
           p.admission_number as r_admission_number,
           c.section          as r_section_label
      from public.class_groups cg
      join public.classes c on c.class_group_id = cg.id
      join public.class_assignments ca on ca.class_id = c.id and ca.role = 'student'
      join public.profiles p on p.id = ca.user_id
     where cg.institution_id = v_institution_id
       and cg.grade_level_id = p_grade_level_id
       and p.is_active is not false
     order by p.id, ca.assigned_at desc
  )
  select r.r_profile_id,
         r.r_full_name::text,
         r.r_admission_number::text,
         r.r_section_label::text,
         spd.date_of_birth,
         spd.guardian_name::text,
         spd.guardian_phone::text,
         spd.guardian_email::text,
         (enr.id is not null) as already_enrolled,
         enr.roll_number::text
    from roster r
    left join public.student_personal_details spd on spd.profile_id = r.r_profile_id
    left join lateral (
      select e.id, e.roll_number
        from public.oly_students e
       where e.oly_school_id = p_oly_school_id
         and e.campaign_id = v_campaign_id
         and e.status <> 'removed'
         and (
           e.profile_id = r.r_profile_id
           or (r.r_admission_number is not null
               and lower(e.admission_number) = lower(r.r_admission_number))
         )
       limit 1
    ) enr on true
   order by r.r_section_label nulls first, r.r_full_name;
end;
$$;

grant execute on function public.oly_list_salci_roster_for_grade(uuid, uuid) to authenticated;
