-- Security hardening: convert SECURITY DEFINER views to security_invoker
-- and drop pointless anonymous grants. Flagged by the Supabase Security
-- Advisor (lint 0010_security_definer_view) + the 2026-06-20 manual review.
--
-- Postgres views run with the VIEW OWNER's privileges by default. These
-- views are owned by `postgres` (superuser), so the underlying joins
-- BYPASS Row Level Security on the base tables. None of these views has an
-- internal auth.uid() filter, so RLS was the only thing meant to scope
-- rows — and it was being bypassed.
--
-- ============================================================
-- PART A — School-domain views: full fix (invoker + anon revoke)
-- ============================================================
-- These three are SALCI school-portal views. Their consumers were verified
-- in this repo (useDashboardData, useClassGroups) and against the live
-- base-table SELECT policies (2026-06-20). The LMS / marketing frontend
-- has no reason to read class groups, subject mappings, or student exam
-- eligibility, so flipping to invoker + revoking anon changes nothing for
-- any authenticated user in either frontend — it only stops cross-tenant
-- leakage that no legitimate flow relied on.
--
--   * student_eligible_exams — students have own-row SELECT on
--     class_assignments / classes / exam_classes / exams /
--     student_exam_attempts that exactly match the view's joins, so a
--     student still sees their own eligible exams; they just stop seeing
--     every other student's across all institutions.
--   * v_class_groups_with_sections — "Institution members read
--     class_groups" + admin/coordinator class SELECT keep the admin
--     class-group screen fully populated; cross-institution reads stop.
--   * v_subject_class_mappings_unified — "Institution members read scgm" +
--     institution-scoped subject_class_mappings SELECT keep it working
--     within the caller's institution.

ALTER VIEW public.student_eligible_exams           SET (security_invoker = on);
ALTER VIEW public.v_class_groups_with_sections     SET (security_invoker = on);
ALTER VIEW public.v_subject_class_mappings_unified SET (security_invoker = on);

REVOKE SELECT ON public.student_eligible_exams           FROM anon;
REVOKE SELECT ON public.v_class_groups_with_sections     FROM anon;
REVOKE SELECT ON public.v_subject_class_mappings_unified FROM anon;

-- ============================================================
-- PART B — lms_leads_safe: anon revoke ONLY (critical breach)
-- ============================================================
-- lms_leads_safe exposed every sales lead's name / phone / email / notes
-- to UNAUTHENTICATED callers (granted to anon, definer view bypassing
-- lms_leads RLS). Revoking anon closes that breach with zero impact on
-- authenticated LMS users (reps / admins / demo presenters are never
-- anonymous), so no LMS flow changes.
--
-- The security_invoker flip for THIS view is deliberately DEFERRED: the
-- LMS frontend is a separate codebase. A CRM "lead pool" (reps viewing
-- unassigned leads to claim) would today rely on the definer bypass, and
-- flipping to invoker — where a rep's RLS only grants assigned_to =
-- auth.uid() — could make pool/unassigned leads vanish from the LMS.
-- Flip it only after confirming the LMS does not depend on cross-row
-- lead visibility through this view.

REVOKE SELECT ON public.lms_leads_safe FROM anon;

-- REGRESSION GUARD: `CREATE OR REPLACE VIEW` resets reloptions. Any future
-- migration that recreates one of the PART A views MUST re-add
-- `WITH (security_invoker = on)` or this hole reopens.
