-- =====================================================================
-- Homework & Assignment — Phase 1: schema, indexes, triggers, RLS
-- Spec: docs/superpowers/specs/2026-06-01-homework-assignment-module-design.md
-- Additive only. RLS on every table in this migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

CREATE TABLE public.homework_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject_id      UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE RESTRICT,
  title           TEXT NOT NULL,
  description     TEXT,
  carries_marks   BOOLEAN NOT NULL DEFAULT true,
  max_marks       NUMERIC(6,2),
  attachment_path TEXT,
  attachment_name TEXT,
  attachment_mime TEXT,
  visible_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at          TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','checked')),
  academic_year   TEXT NOT NULL,
  evaluated_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  checked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT homework_due_after_visible CHECK (due_at > visible_from),
  CONSTRAINT homework_marks_requires_max CHECK (
    carries_marks = false OR (max_marks IS NOT NULL AND max_marks > 0)
  )
);
CREATE INDEX idx_homework_assignments_institution ON public.homework_assignments(institution_id);
CREATE INDEX idx_homework_assignments_subject     ON public.homework_assignments(subject_id);
CREATE INDEX idx_homework_assignments_created_by  ON public.homework_assignments(created_by);
CREATE INDEX idx_homework_assignments_status      ON public.homework_assignments(status);
CREATE INDEX idx_homework_assignments_due_at      ON public.homework_assignments(due_at);
CREATE INDEX idx_homework_assignments_ay          ON public.homework_assignments(institution_id, academic_year);
CREATE INDEX idx_homework_assignments_evaluated_by ON public.homework_assignments(evaluated_by);

CREATE TABLE public.homework_assignment_classes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_assignment_id UUID NOT NULL REFERENCES public.homework_assignments(id) ON DELETE CASCADE,
  class_id               UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (homework_assignment_id, class_id)
);
CREATE INDEX idx_hw_assignment_classes_hw    ON public.homework_assignment_classes(homework_assignment_id);
CREATE INDEX idx_hw_assignment_classes_class ON public.homework_assignment_classes(class_id);

CREATE TABLE public.homework_submissions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_assignment_id UUID NOT NULL REFERENCES public.homework_assignments(id) ON DELETE CASCADE,
  student_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  submitted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_late                BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (homework_assignment_id, student_id)
);
CREATE INDEX idx_hw_submissions_hw      ON public.homework_submissions(homework_assignment_id);
CREATE INDEX idx_hw_submissions_student ON public.homework_submissions(student_id);

CREATE TABLE public.homework_submission_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES public.homework_submissions(id) ON DELETE CASCADE,
  storage_path    TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_mime       TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hw_submission_files_submission ON public.homework_submission_files(submission_id);

CREATE TABLE public.homework_results (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id          UUID NOT NULL UNIQUE REFERENCES public.homework_submissions(id) ON DELETE CASCADE,
  homework_assignment_id UUID NOT NULL REFERENCES public.homework_assignments(id) ON DELETE CASCADE,
  student_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  marks_awarded          NUMERIC(6,2),
  feedback               TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','graded','skipped')),
  evaluated_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  evaluated_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hw_results_hw           ON public.homework_results(homework_assignment_id);
CREATE INDEX idx_hw_results_student      ON public.homework_results(student_id);
CREATE INDEX idx_hw_results_evaluated_by ON public.homework_results(evaluated_by);

CREATE TABLE public.homework_mark_audit (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_result_id     UUID NOT NULL REFERENCES public.homework_results(id) ON DELETE CASCADE,
  homework_assignment_id UUID NOT NULL REFERENCES public.homework_assignments(id) ON DELETE CASCADE,
  student_id             UUID NOT NULL,
  changed_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action                 TEXT NOT NULL CHECK (action IN ('graded','mark_edited','feedback_edited','skipped')),
  old_marks              NUMERIC(6,2),
  new_marks              NUMERIC(6,2),
  old_feedback           TEXT,
  new_feedback           TEXT,
  old_status             TEXT,
  new_status             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hw_mark_audit_result     ON public.homework_mark_audit(homework_result_id);
CREATE INDEX idx_hw_mark_audit_hw         ON public.homework_mark_audit(homework_assignment_id);
CREATE INDEX idx_hw_mark_audit_changed_by ON public.homework_mark_audit(changed_by);

CREATE TABLE public.homework_notifications_sent (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homework_assignment_id UUID NOT NULL REFERENCES public.homework_assignments(id) ON DELETE CASCADE,
  recipient_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type      TEXT NOT NULL CHECK (notification_type IN ('visible','due_reminder_24h','closed_teacher')),
  sent_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (homework_assignment_id, recipient_id, notification_type)
);
CREATE INDEX idx_hw_notifications_sent_hw        ON public.homework_notifications_sent(homework_assignment_id);
CREATE INDEX idx_hw_notifications_sent_recipient ON public.homework_notifications_sent(recipient_id);

-- ---------------------------------------------------------------------
-- Integrity triggers (reuse the shared public.update_updated_at_column())
-- ---------------------------------------------------------------------

CREATE TRIGGER update_homework_assignments_updated_at
  BEFORE UPDATE ON public.homework_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_homework_submissions_updated_at
  BEFORE UPDATE ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_homework_results_updated_at
  BEFORE UPDATE ON public.homework_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cap each submission at 10 files (server-side backstop to client validation)
CREATE OR REPLACE FUNCTION public.homework_enforce_file_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.homework_submission_files
        WHERE submission_id = NEW.submission_id) >= 10 THEN
    RAISE EXCEPTION 'A submission may have at most 10 files.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER homework_submission_files_limit
  BEFORE INSERT ON public.homework_submission_files
  FOR EACH ROW EXECUTE FUNCTION public.homework_enforce_file_limit();

-- Freeze content once the assignment is visible to students (edit-lock rule).
-- Status workflow (publish -> checked), evaluation bookkeeping, updated_at stay editable.
CREATE OR REPLACE FUNCTION public.homework_enforce_edit_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'draft' AND OLD.visible_from <= now() THEN
    IF NEW.title           IS DISTINCT FROM OLD.title
       OR NEW.description    IS DISTINCT FROM OLD.description
       OR NEW.subject_id     IS DISTINCT FROM OLD.subject_id
       OR NEW.carries_marks  IS DISTINCT FROM OLD.carries_marks
       OR NEW.max_marks      IS DISTINCT FROM OLD.max_marks
       OR NEW.attachment_path IS DISTINCT FROM OLD.attachment_path
       OR NEW.attachment_name IS DISTINCT FROM OLD.attachment_name
       OR NEW.attachment_mime IS DISTINCT FROM OLD.attachment_mime
       OR NEW.visible_from   IS DISTINCT FROM OLD.visible_from
       OR NEW.due_at         IS DISTINCT FROM OLD.due_at THEN
      RAISE EXCEPTION 'This assignment is locked for edits (already visible to students).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER homework_assignments_edit_lock
  BEFORE UPDATE ON public.homework_assignments
  FOR EACH ROW EXECUTE FUNCTION public.homework_enforce_edit_lock();

-- Block class add/remove once the parent assignment is locked.
CREATE OR REPLACE FUNCTION public.homework_guard_class_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_hw_id  UUID := COALESCE(NEW.homework_assignment_id, OLD.homework_assignment_id);
  v_locked BOOLEAN;
BEGIN
  SELECT (status <> 'draft' AND visible_from <= now())
    INTO v_locked
    FROM public.homework_assignments
    WHERE id = v_hw_id;
  IF v_locked THEN
    RAISE EXCEPTION 'Cannot change classes of a locked assignment.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER homework_assignment_classes_guard
  BEFORE INSERT OR DELETE ON public.homework_assignment_classes
  FOR EACH ROW EXECUTE FUNCTION public.homework_guard_class_changes();

-- Audit every meaningful mark/feedback/status change on homework_results.
-- SECURITY DEFINER so it can write the audit row regardless of RLS; auth.uid()
-- still returns the calling user for changed_by.
CREATE OR REPLACE FUNCTION public.homework_log_mark_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      RETURN NEW;
    END IF;
    v_action := CASE WHEN NEW.status = 'skipped' THEN 'skipped' ELSE 'graded' END;
    INSERT INTO public.homework_mark_audit (
      homework_result_id, homework_assignment_id, student_id, changed_by,
      action, old_marks, new_marks, old_feedback, new_feedback, old_status, new_status
    ) VALUES (
      NEW.id, NEW.homework_assignment_id, NEW.student_id, auth.uid(),
      v_action, NULL, NEW.marks_awarded, NULL, NEW.feedback, NULL, NEW.status
    );
    RETURN NEW;
  END IF;

  IF NEW.marks_awarded IS DISTINCT FROM OLD.marks_awarded
     OR NEW.feedback   IS DISTINCT FROM OLD.feedback
     OR NEW.status     IS DISTINCT FROM OLD.status THEN
    v_action := CASE
      WHEN NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'skipped' THEN 'skipped'
      WHEN NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'graded' THEN 'graded'
      WHEN NEW.marks_awarded IS DISTINCT FROM OLD.marks_awarded THEN 'mark_edited'
      WHEN NEW.feedback IS DISTINCT FROM OLD.feedback THEN 'feedback_edited'
      ELSE 'graded'
    END;
    INSERT INTO public.homework_mark_audit (
      homework_result_id, homework_assignment_id, student_id, changed_by,
      action, old_marks, new_marks, old_feedback, new_feedback, old_status, new_status
    ) VALUES (
      NEW.id, NEW.homework_assignment_id, NEW.student_id, auth.uid(),
      v_action, OLD.marks_awarded, NEW.marks_awarded, OLD.feedback, NEW.feedback, OLD.status, NEW.status
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER homework_results_audit
  AFTER INSERT OR UPDATE ON public.homework_results
  FOR EACH ROW EXECUTE FUNCTION public.homework_log_mark_audit();

-- ---------------------------------------------------------------------
-- SECURITY DEFINER permission helpers (avoid §23.1 RLS recursion trap)
-- ---------------------------------------------------------------------

-- A user who may manage (edit/mark/check) this assignment:
--   creator, super admin, institution admin, wing coordinator of an assigned
--   class, or a teacher of the assignment's subject for an assigned class.
CREATE OR REPLACE FUNCTION public.can_manage_homework(_user_id uuid, _homework_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.homework_assignments h
    WHERE h.id = _homework_id
      AND (
        h.created_by = _user_id
        OR public.is_super_admin(_user_id)
        OR public.is_institution_admin(_user_id, h.institution_id)
        OR EXISTS (
          SELECT 1
          FROM public.homework_assignment_classes hac
          WHERE hac.homework_assignment_id = h.id
            AND (
              public.is_coordinator_for_class(_user_id, hac.class_id)
              OR EXISTS (
                SELECT 1
                FROM public.class_assignments ca
                WHERE ca.user_id = _user_id
                  AND ca.class_id = hac.class_id
                  AND ca.role = 'teacher'
                  AND (ca.subject_id = h.subject_id OR ca.subject_id IS NULL)
              )
            )
        )
      )
  )
$$;

-- A student to whom this assignment is currently visible (assigned class,
-- published/checked, and visible_from reached).
CREATE OR REPLACE FUNCTION public.homework_visible_to_student(_user_id uuid, _homework_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.homework_assignments h
    JOIN public.homework_assignment_classes hac ON hac.homework_assignment_id = h.id
    JOIN public.class_assignments ca ON ca.class_id = hac.class_id
    WHERE h.id = _homework_id
      AND ca.user_id = _user_id
      AND ca.role = 'student'
      AND h.status IN ('published','checked')
      AND h.visible_from <= now()
  )
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

ALTER TABLE public.homework_assignments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_assignment_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submissions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_submission_files   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_results            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_mark_audit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_notifications_sent ENABLE ROW LEVEL SECURITY;

-- homework_assignments
CREATE POLICY "hw_assignments select" ON public.homework_assignments
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.can_manage_homework(auth.uid(), id)
    OR public.homework_visible_to_student(auth.uid(), id)
  );

CREATE POLICY "hw_assignments insert" ON public.homework_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'coordinator')
      OR public.is_institution_admin(auth.uid(), institution_id)
      OR public.is_super_admin(auth.uid())
    )
  );

CREATE POLICY "hw_assignments update" ON public.homework_assignments
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.can_manage_homework(auth.uid(), id))
  WITH CHECK (created_by = auth.uid() OR public.can_manage_homework(auth.uid(), id));

CREATE POLICY "hw_assignments delete draft" ON public.homework_assignments
  FOR DELETE TO authenticated
  USING (
    status = 'draft'
    AND (created_by = auth.uid() OR public.can_manage_homework(auth.uid(), id))
  );

-- homework_assignment_classes
CREATE POLICY "hw_classes select" ON public.homework_assignment_classes
  FOR SELECT TO authenticated
  USING (
    public.can_manage_homework(auth.uid(), homework_assignment_id)
    OR public.homework_visible_to_student(auth.uid(), homework_assignment_id)
  );

CREATE POLICY "hw_classes insert" ON public.homework_assignment_classes
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_homework(auth.uid(), homework_assignment_id));

CREATE POLICY "hw_classes delete" ON public.homework_assignment_classes
  FOR DELETE TO authenticated
  USING (public.can_manage_homework(auth.uid(), homework_assignment_id));

-- homework_submissions
CREATE POLICY "hw_submissions student select" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "hw_submissions manager select" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (public.can_manage_homework(auth.uid(), homework_assignment_id));

CREATE POLICY "hw_submissions student insert" ON public.homework_submissions
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id = auth.uid()
    AND public.homework_visible_to_student(auth.uid(), homework_assignment_id)
  );

-- homework_submission_files
CREATE POLICY "hw_files select" ON public.homework_submission_files
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.homework_submissions s
      WHERE s.id = submission_id AND s.student_id = auth.uid()
    )
    OR public.can_manage_homework(
      auth.uid(),
      (SELECT s.homework_assignment_id FROM public.homework_submissions s WHERE s.id = submission_id)
    )
  );

CREATE POLICY "hw_files student insert" ON public.homework_submission_files
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.homework_submissions s
      WHERE s.id = submission_id AND s.student_id = auth.uid()
    )
  );

-- homework_results
CREATE POLICY "hw_results manager all" ON public.homework_results
  FOR ALL TO authenticated
  USING (public.can_manage_homework(auth.uid(), homework_assignment_id))
  WITH CHECK (public.can_manage_homework(auth.uid(), homework_assignment_id));

CREATE POLICY "hw_results student select" ON public.homework_results
  FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.homework_assignments h
      WHERE h.id = homework_assignment_id AND h.status = 'checked'
    )
  );

-- homework_mark_audit (writes are trigger-only via SECURITY DEFINER fn; no user write policies)
CREATE POLICY "hw_audit select" ON public.homework_mark_audit
  FOR SELECT TO authenticated
  USING (
    changed_by = auth.uid()
    OR public.can_manage_homework(auth.uid(), homework_assignment_id)
  );

-- homework_notifications_sent: service-role only (cron). No authenticated policies => deny.
