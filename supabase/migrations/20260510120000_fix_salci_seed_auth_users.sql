-- =====================================================================
-- Repair seeded auth.users so password sign-in works
-- =====================================================================
-- The Salci test users created in 20260510110000 left several auth
-- columns as NULL that Supabase GoTrue expects to be empty strings.
-- When NULL, internal SELECTs in the password-grant flow fail to scan
-- and the request is returned as "Invalid credentials" — even though
-- the encrypted_password is a perfectly good bcrypt hash.
--
-- Affected columns:
--   confirmation_token, recovery_token, email_change,
--   email_change_token_new, email_change_token_current,
--   reauthentication_token, phone_change, phone_change_token
--
-- Fix:
--   - Coalesce all of those to '' for the seeded users.
--   - Re-stamp encrypted_password to a fresh bcrypt hash (idempotent;
--     ensures old rows that may have been hashed with a stale function
--     are also corrected).
--   - Re-stamp email_confirmed_at = now() so the email is treated as
--     verified.
--   - Patch auth.identities to include email_verified=true in
--     identity_data, which newer GoTrue versions require for password
--     sign-in.

DO $fix$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE auth.users
  SET
    encrypted_password         = extensions.crypt('Salci@2026', extensions.gen_salt('bf')),
    email_confirmed_at         = COALESCE(email_confirmed_at, now()),
    confirmation_token         = COALESCE(confirmation_token, ''),
    recovery_token             = COALESCE(recovery_token, ''),
    email_change               = COALESCE(email_change, ''),
    email_change_token_new     = COALESCE(email_change_token_new, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    reauthentication_token     = COALESCE(reauthentication_token, ''),
    phone_change               = COALESCE(phone_change, ''),
    phone_change_token         = COALESCE(phone_change_token, ''),
    updated_at                 = now()
  WHERE email LIKE '%@salci-test.in';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Repaired auth.users: % rows', v_count;

  -- Patch identity_data so password sign-in passes the email_verified
  -- check on newer GoTrue versions.
  UPDATE auth.identities i
  SET
    identity_data = COALESCE(i.identity_data, '{}'::jsonb)
                    || jsonb_build_object(
                         'sub',            u.id::text,
                         'email',          u.email,
                         'email_verified', true,
                         'phone_verified', false
                       ),
    updated_at = now()
  FROM auth.users u
  WHERE i.user_id = u.id
    AND u.email LIKE '%@salci-test.in';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Repaired auth.identities: % rows', v_count;
END;
$fix$;
