-- =============================================================
-- Accounts that may not delete users, whatever their role (2026-10-07).
-- First use: admin@salci.in (school admin + teacher at Salci National School)
-- is handed to an outside tester and must not be able to delete anyone.
-- admin-operations refuses delete_user, bulk_delete_students and
-- delete_institution for any actor listed here, and refuses (fails closed)
-- if it cannot read this table. Undo: DELETE the row.
--
-- No FK on purpose: the row only names an account, and an FK to profiles
-- would pull this table into the user-delete cascade and the dua capture.
-- Service role only: RLS on, no policies, no grants to anon/authenticated.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.user_delete_blocked (
  user_id uuid PRIMARY KEY,
  reason text NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_delete_blocked ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_delete_blocked FROM PUBLIC, anon, authenticated;

INSERT INTO public.user_delete_blocked (user_id, reason)
SELECT u.id, 'Test account handed to an outside tester (Tushar, 2026-10-07)'
FROM auth.users u
WHERE u.email = 'admin@salci.in'
ON CONFLICT (user_id) DO NOTHING;
