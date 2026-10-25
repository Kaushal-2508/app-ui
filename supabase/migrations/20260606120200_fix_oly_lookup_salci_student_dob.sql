-- Fix: oly_lookup_salci_student selected the non-existent profiles.date_of_birth
-- (PL/pgSQL bodies are not schema-validated at CREATE, so it compiled but crashed
-- at runtime for any matched student). Read DOB from student_personal_details.
create or replace function public.oly_lookup_salci_student(
  p_school_short_code text, p_admission_number text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_school_inst_id uuid;
  v_profile_id uuid;
  v_full_name text;
  v_dob date;
  v_class_name text;
begin
  select i.id into v_school_inst_id
    from public.institutions i
    join public.oly_schools sc on sc.institution_id = i.id
   where sc.school_short_code = upper(p_school_short_code)
     and sc.is_existing_salci_school = true;

  if v_school_inst_id is null then
    return jsonb_build_object('found', false);
  end if;

  select p.id, p.full_name, spd.date_of_birth
    into v_profile_id, v_full_name, v_dob
    from public.profiles p
    left join public.student_personal_details spd on spd.profile_id = p.id
   where p.institution_id = v_school_inst_id
     and p.admission_number = p_admission_number
     and exists (
       select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'student'
     );

  if v_profile_id is null then
    return jsonb_build_object('found', false);
  end if;

  select c.name into v_class_name
    from public.class_assignments ca
    join public.classes c on c.id = ca.class_id
   where ca.user_id = v_profile_id
     and ca.role = 'student'
   order by ca.assigned_at desc
   limit 1;

  return jsonb_build_object(
    'found', true,
    'profile_id', v_profile_id,
    'full_name', v_full_name,
    'date_of_birth', v_dob,
    'class_name', v_class_name
  );
end;
$$;

grant execute on function public.oly_lookup_salci_student(text, text) to anon, authenticated;
