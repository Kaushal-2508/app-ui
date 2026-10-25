-- Column-scoped self-writes, ahead of narrowing the profiles self-update policy.
--
-- Postgres RLS has no column granularity within a single policy, so the two
-- legitimate self-writes that must survive a student lockdown move to narrow
-- SECURITY DEFINER RPCs:
--
--   * PasswordResetRequired.tsx writes must_reset_password and THROWS on
--     failure. Without this, every student on a forced reset is trapped in an
--     infinite loop.
--   * GuidedTourProvider.tsx writes onboarding_completed and swallows failure,
--     so the tour would silently replay forever.

CREATE OR REPLACE FUNCTION public.clear_password_reset_flag()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
     SET must_reset_password = false,
         last_password_change = now(),
         password_expires_at  = NULL,
         updated_at           = now()
   WHERE id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.clear_password_reset_flag() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_password_reset_flag() FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_password_reset_flag() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_onboarding_complete(_steps jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
     SET onboarding_completed = true,
         tour_steps_completed = COALESCE(_steps, tour_steps_completed),
         updated_at           = now()
   WHERE id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.mark_onboarding_complete(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_onboarding_complete(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_complete(jsonb) TO authenticated;