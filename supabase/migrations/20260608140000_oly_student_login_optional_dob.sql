-- =========================================================================
-- Olympiad student login: make DOB optional in the resolver so the student
-- sign-in can use an explicit Login ID + Password instead of a date picker.
--
-- The auth password is unchanged (still DDMMYY of the date of birth, set by
-- oly-cash-enroll). signInWithPassword remains the real gate; when the client
-- omits the DOB (passes empty string), we simply skip the DOB verification
-- factor and resolve identifier -> synthetic email. The 2-arg signature is
-- preserved so the generated types keep working (client passes p_dob_iso = '').
-- =========================================================================
create or replace function public.oly_student_login_resolve(
  p_identifier text, p_dob_iso text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_student record;
  v_dob date;
  v_email text;
begin
  -- DOB is now optional. When supplied (legacy date-of-birth login), parse +
  -- verify it. When empty/null (password login), skip the DOB factor.
  if p_dob_iso is not null and length(trim(p_dob_iso)) > 0 then
    begin
      v_dob := p_dob_iso::date;
    exception when others then
      return jsonb_build_object('found', false);
    end;
  else
    v_dob := null;
  end if;

  -- Try roll number first (uppercase comparison since roll numbers are stored uppercase)
  select s.id, s.auth_user_id, s.profile_id, s.roll_number, s.date_of_birth
    into v_student
    from public.oly_students s
   where upper(s.roll_number) = upper(p_identifier)
     and s.status in ('active', 'dormant');

  if v_student.id is null then
    -- Try admission number (only meaningful for SALCI students)
    select s.id, s.auth_user_id, s.profile_id, s.roll_number, s.date_of_birth
      into v_student
      from public.oly_students s
     where s.admission_number = p_identifier
       and s.status in ('active', 'dormant');
  end if;

  if v_student.id is null then
    return jsonb_build_object('found', false);
  end if;

  -- Verify DOB only when one was supplied
  if v_dob is not null and v_student.date_of_birth <> v_dob then
    return jsonb_build_object('found', false);
  end if;

  -- For non-SALCI students with auth_user_id, return the synthetic email.
  if v_student.auth_user_id is not null then
    v_email := lower(v_student.roll_number) || '@olympiad.salci.org';
    return jsonb_build_object(
      'found', true,
      'email', v_email,
      'is_olympiad_only', true
    );
  end if;

  -- SALCI student fallback — they should use their school SALCI login
  return jsonb_build_object(
    'found', true,
    'is_olympiad_only', false,
    'message', 'Please log in via the main SALCI login page'
  );
end;
$$;

grant execute on function public.oly_student_login_resolve(text, text) to anon, authenticated;
