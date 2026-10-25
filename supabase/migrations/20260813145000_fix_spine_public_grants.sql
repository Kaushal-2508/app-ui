-- SECURITY FIX for the already-applied spine migration (20260813140000).
--
-- That migration used "REVOKE EXECUTE ... FROM anon", which does NOT work.
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to PUBLIC on every new
-- function in the public schema, and anon/authenticated inherit through PUBLIC.
-- Revoking the role by name leaves the PUBLIC grant untouched:
--
--   log_student_activity  proacl = {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--                                   ^^^^^^^^^^^ this IS the PUBLIC grant
--
-- Consequence, live right now: any holder of the anon key can call
-- log_student_activity(<any uuid>, 'exam_submitted') and write activity rows for
-- an arbitrary user. Nothing consumes those rows yet, so no badge can be minted
-- from it today, but the evaluator turns exactly this into free streak days for
-- yourself and streak inflation for anyone else. Dates are derived server-side,
-- so backdating was never possible.
--
-- The correct form is REVOKE ... FROM PUBLIC first, then grant back deliberately.

-- log_student_activity takes a user_id, so it must never be reachable from any
-- client. Only SECURITY DEFINER callers (the triggers and log_study_material_open,
-- which derive the user from auth.uid()) may reach it.
REVOKE ALL ON FUNCTION public.log_student_activity(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- These three are legitimately called by a signed-in student for THEMSELVES, so
-- drop the blanket PUBLIC grant and re-grant authenticated explicitly.
REVOKE ALL ON FUNCTION public.student_local_date(uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_streak(uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_study_material_open(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.student_local_date(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_streak(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_study_material_open(uuid) TO authenticated;

-- Trigger functions are invoked by the trigger machinery as the table owner and
-- need no role grants at all.
REVOKE ALL ON FUNCTION public.tg_log_exam_submitted()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_log_homework_submitted()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_log_hybrid_exam_submitted() FROM PUBLIC, anon, authenticated;