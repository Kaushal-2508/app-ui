-- Tier 1 RLS hardening from the 2026-05-16 scaling audit.
--
-- Three tables had `FOR ALL USING (true)` policies (migration 20260112051733
-- lines 106, 110, 117) which allowed any authenticated user to INSERT /
-- UPDATE / DELETE any row in any institution. That was a cross-tenant data
-- integrity hole, not just a scaling concern.
--
-- Writes to these tables come from triggers and SECURITY DEFINER edge
-- functions (snapshot-student-passport, badge-award triggers, etc.) which
-- bypass RLS regardless. Removing the wide-open policy does NOT block the
-- legitimate writers — only blocks unauthorized authenticated writes.
--
-- user_activity_log is the one exception: useBadges.ts:185 does a direct
-- UPSERT from the frontend scoped to `user_id: user.id`. We replace the
-- wide-open policy with INSERT/UPDATE policies that enforce that scope.


-- =====================================================================
-- 1. badge_progress
-- =====================================================================

DROP POLICY IF EXISTS "Manage progress" ON public.badge_progress;

-- Existing "Users view own progress" SELECT policy is preserved.
-- Add a staff read so school admins can pull badge analytics for their
-- own institution; previously this was happening implicitly via the
-- FOR ALL policy.
CREATE POLICY "Staff view institution badge progress"
  ON public.badge_progress FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      institution_id IS NOT NULL
      AND institution_id = public.get_user_institution(auth.uid())
      AND (
        public.has_role(auth.uid(), 'school_admin'::public.app_role)
        OR public.has_role(auth.uid(), 'super_school_admin'::public.app_role)
      )
    )
  );

-- No INSERT/UPDATE/DELETE policy — writes flow through triggers /
-- SECURITY DEFINER functions / service role only.


-- =====================================================================
-- 2. user_activity_log
-- =====================================================================

DROP POLICY IF EXISTS "Manage activity" ON public.user_activity_log;

-- Existing "Users view own activity" SELECT policy is preserved.

-- Allow users to upsert their own activity rows. useBadges.ts:185 already
-- writes with user_id: user.id; this policy enforces that contract.
CREATE POLICY "Users insert own activity"
  ON public.user_activity_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own activity"
  ON public.user_activity_log FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Staff read for institution-scoped audit / analytics.
CREATE POLICY "Staff view institution activity"
  ON public.user_activity_log FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      institution_id IS NOT NULL
      AND institution_id = public.get_user_institution(auth.uid())
      AND (
        public.has_role(auth.uid(), 'school_admin'::public.app_role)
        OR public.has_role(auth.uid(), 'super_school_admin'::public.app_role)
      )
    )
  );


-- =====================================================================
-- 3. student_passport
-- =====================================================================

DROP POLICY IF EXISTS "Manage passports" ON public.student_passport;

-- Existing "Students view own passport" + "Staff view institution
-- passports" SELECT policies are preserved.
--
-- All writes to student_passport happen via the snapshot-student-passport
-- edge function (service role) or the updated_at trigger. Both bypass
-- RLS; no application-level write policy needed.
