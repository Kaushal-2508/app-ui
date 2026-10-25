-- PTM: a teacher's PTM rights follow every class they teach.
-- NEEDS DB from naman-erp 019ff8e3; Tushar chose "with or without a subject"
-- on 2026-09-29.
--
-- Before: only a subject-less class_assignments teacher row (the "class
-- teacher" row) counted, so at Alliance 3 of 84 teachers could run a PTM and
-- the rest saw an empty teacher tab. Now any teacher row on the class counts,
-- with or without a subject: every subject teacher of the section, plus the
-- teachers on a subject-less row who could already. Nobody loses a right they
-- have today (measured 2026-09-29: Alliance 3 -> 84, Salci National 2 -> 51,
-- Vidyabodhini 0 -> 24, Vanshika 4 -> 11, Product Testing 5 -> 9).
--
-- A deliberate exception to CLAUDE.md section 25, like attendance: a PTM is
-- about the whole child, not one subject, so the scope is the whole section and
-- teacher_controls_student / the optional-choice gate do not apply. Accepted
-- consequence: every teacher of a section sees that section's family feedback,
-- booking names, attendance ticks and voice notes (can_view_ptm_feedback, and
-- through it the ptm_feedback_select policy, the ptm_audio_* storage policies,
-- the booking grid and the dashboard). Several teachers of one section may each
-- schedule a PTM for it; can_manage_ptm still limits edit and cancel to the
-- creating teacher (and the coordinator / admin above them).
--
-- Only two bodies change; every other rule reads is_class_teacher_of:
-- can_manage_ptm, can_view_ptm_feedback, cancel_ptm_booking and, through
-- ptm_classes_for_hat, ptm_manageable_scope, create_ptm_schedule,
-- _ptm_dashboard_classes, ptm_feedback_summary and ptm_feedback_list.
-- The name is kept so every caller and grant stays as it is (CREATE OR REPLACE
-- keeps postgres + service_role only; the browser never calls either).
--
-- Left on purpose: ptm_class_teachers() and _ptm_class_teacher_names() still
-- list subject-less rows only. The new frontend never calls them, but a browser
-- still on the previous build does, so they go in a later release (CLAUDE.md 2).
--
-- Ship order: this only widens access, so it is applied BEFORE the frontend
-- that relies on it goes live.

CREATE OR REPLACE FUNCTION public.is_class_teacher_of(_user uuid, _class uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT _user IS NOT NULL AND _class IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.class_assignments ca
                   JOIN public.profiles p ON p.id = ca.user_id
                  WHERE ca.user_id = _user AND ca.class_id = _class
                    AND ca.role = 'teacher'
                    AND p.is_active IS NOT FALSE)
     AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user AND r.role = 'teacher');
$$;

COMMENT ON FUNCTION public.is_class_teacher_of(uuid, uuid) IS
  'PTM only: _user teaches _class (any teacher row on it, with or without a subject), holds the teacher role and is active. Whole-section scope, an exception to CLAUDE.md section 25 like attendance. Since 20260929170000.';

CREATE OR REPLACE FUNCTION public.ptm_classes_for_hat(_user uuid, _hat text)
RETURNS TABLE(class_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_inst uuid := public.get_user_institution(_user);
BEGIN
  IF NOT public._ptm_has_hat(_user, v_inst, _hat) THEN
    RAISE EXCEPTION 'You don''t hold that role at this school.' USING ERRCODE = '42501';
  END IF;
  IF _hat = 'admin' THEN
    RETURN QUERY SELECT c.id FROM public.classes c
                  WHERE c.institution_id = v_inst AND c.is_active IS NOT FALSE;
  ELSIF _hat = 'coordinator' THEN
    RETURN QUERY SELECT DISTINCT c.id
      FROM public.wing_assignments wa
      JOIN public.wings w ON w.id = wa.wing_id AND w.institution_id = v_inst AND w.is_active IS NOT FALSE
      JOIN public.wing_class_mappings wcm ON wcm.wing_id = wa.wing_id
      JOIN public.classes c ON c.id = wcm.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
     WHERE wa.user_id = _user;
  ELSE
    -- Every active class of this school the teacher teaches, any subject or none.
    RETURN QUERY SELECT DISTINCT c.id
      FROM public.class_assignments ca
      JOIN public.classes c ON c.id = ca.class_id AND c.institution_id = v_inst AND c.is_active IS NOT FALSE
     WHERE ca.user_id = _user AND ca.role = 'teacher'
       AND public.is_class_teacher_of(_user, ca.class_id);
  END IF;
END;
$$;
