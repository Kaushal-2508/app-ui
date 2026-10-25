-- Fix: students could not download ANY Olympiad study material.
--
-- oly_get_student_study_material_path gates access by "subject must be one of the
-- student's chosen subjects", but the check was written as:
--     if v_material.subject_id <> any(v_student.subject_ids) then raise 'Not your subject'
-- `x <> any(arr)` is TRUE whenever x differs from AT LEAST ONE element — so for a
-- student with 3 subjects, a perfectly valid material (subject_id IN subject_ids)
-- still trips it (it differs from the other two), and the function raises. Every
-- download therefore failed with "Not your subject". The list query uses the right
-- membership test, so students SAW materials they could never open.
--
-- This was latent until the student read policy (20260616120000) made the list
-- visible. Correct membership test is NOT (x = ANY(arr)) (equivalently x <> ALL(arr)).
-- Signature unchanged (returns text) — no frontend types regen needed.

create or replace function public.oly_get_student_study_material_path(p_material_id uuid)
returns text
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_student record;
  v_material record;
begin
  if v_uid is null then raise exception 'Forbidden' using errcode = '42501'; end if;

  select id, grade_level_id, subject_ids
    into v_student
    from public.oly_students
   where (auth_user_id = v_uid or profile_id = v_uid)
     and status = 'active'
   limit 1;
  if v_student.id is null then raise exception 'No active enrollment' using errcode = '42501'; end if;

  select id, subject_id, grade_level_id, storage_path
    into v_material
    from public.oly_study_materials
   where id = p_material_id;
  if v_material.id is null then raise exception 'Not found' using errcode = '42P01'; end if;

  -- Scope: subject must be IN the student's chosen subjects, grade must match.
  -- (Membership test — NOT `<> any`, which is true for any non-uniform array.)
  if not (v_material.subject_id = any(v_student.subject_ids)) then
    raise exception 'Not your subject' using errcode = '42501';
  end if;
  if v_material.grade_level_id <> v_student.grade_level_id then
    raise exception 'Not your class' using errcode = '42501';
  end if;

  return v_material.storage_path;
end;
$function$;
