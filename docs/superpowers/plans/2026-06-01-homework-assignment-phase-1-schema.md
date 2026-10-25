# Homework & Assignment — Phase 1 (Schema, RLS, Storage, Feature Flag) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the complete database foundation for the Homework & Assignment module — seven tables with RLS, the SECURITY DEFINER permission helpers, integrity triggers, a private storage bucket, and the `homework` feature flag (default-on for existing institutions) — so later phases (create flow, submit, marking, results, notifications, analytics) build on a sound, scaling-compliant base.

**Architecture:** Three additive SQL migrations + one TypeScript edit. Migration 1 creates all tables/indexes/triggers/helpers/RLS. Migration 2 creates the `homework-files` private bucket + storage policies. Migration 3 backfills the `homework` feature for existing institutions. The TS edit registers `homework` in the feature registry. Wing-scoped coordinator access uses the existing dormant `is_coordinator_for_class()` helper. All cross-table RLS checks go through SECURITY DEFINER helpers to avoid the §23.1 recursion trap; all FK columns are indexed in the same migration (§23); every `profiles(id)` FK has an explicit `ON DELETE` (§21).

**Tech Stack:** Supabase Postgres (SQL migrations under `supabase/migrations/`), Supabase Storage, React 18 + TypeScript (Vite). Verification via SQL queries + `npx tsc --noEmit` / `npx eslint` / `npx vite build` (§5a).

**Base branch:** `main`. **Spec:** `docs/superpowers/specs/2026-06-01-homework-assignment-module-design.md`.

---

## File structure

**Create:**
- `supabase/migrations/20260601090000_homework_phase1_schema.sql` — tables, indexes, integrity triggers, SECURITY DEFINER helpers, RLS + policies.
- `supabase/migrations/20260601090100_homework_storage_bucket.sql` — `homework-files` private bucket + `storage.objects` policies.
- `supabase/migrations/20260601090200_homework_feature_backfill.sql` — enable `homework` feature for all existing institutions.

**Modify:**
- `src/components/admin/institution-wizard/featuresData.ts` — add the `homework` entry to `AVAILABLE_FEATURES` and three `FEATURE_URL_MAP` entries.

**Not in Phase 1 (later phases):** any `src/pages`, `src/hooks`, `src/components` for the module; regenerating `src/integrations/supabase/types.ts` (done in Phase 2 when the first hooks need the types); the notifications cron; the analytics RPC; nav wiring.

> **Migration apply note:** This repo applies migrations against the hosted Supabase project. Apply each migration via your usual mechanism (e.g. `npx supabase db push` against a dev/branch DB, or the Management API) and then run the verification SQL in Task 5. Do **not** assume a local stack exists; the plan's "verify" steps are SQL queries you run in the Supabase SQL editor after applying.

---

## Task 1: Branch and commit the spec + this plan

**Files:**
- (none created — git only)

- [ ] **Step 1: Create the feature branch off `main`**

The untracked spec/plan docs follow you across the checkout.

Run:
```bash
git stash list   # expect empty; if you have unrelated WIP, handle it first
git checkout main
git pull --ff-only
git checkout -b homework/phase-1-schema
```
Expected: now on `homework/phase-1-schema`; `docs/superpowers/specs/2026-06-01-homework-assignment-module-design.md` and `docs/superpowers/plans/2026-06-01-homework-assignment-phase-1-schema.md` still present (untracked).

- [ ] **Step 2: Commit the spec + plan**

Run:
```bash
git add docs/superpowers/specs/2026-06-01-homework-assignment-module-design.md docs/superpowers/plans/2026-06-01-homework-assignment-phase-1-schema.md
git commit -m @'
docs(homework): add Homework & Assignment design spec + Phase-1 plan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```
Expected: one commit created on `homework/phase-1-schema`.

---

## Task 2: Schema migration — tables, indexes, triggers, helpers, RLS

**Files:**
- Create: `supabase/migrations/20260601090000_homework_phase1_schema.sql`

- [ ] **Step 1: Confirm the timestamp sorts last**

Run (PowerShell):
```powershell
Get-ChildItem "supabase\migrations\*.sql" | Sort-Object Name -Descending | Select-Object -First 1 Name
```
Expected: the newest existing migration is `20260531141906_oly_phase_3_rpc_hardening.sql` (or another `2026053…`). If anything sorts **after** `20260601090000`, bump all three Phase-1 filenames to a later timestamp (e.g. `20260602…`) before continuing.

- [ ] **Step 2: Create the migration file with the full schema**

Create `supabase/migrations/20260601090000_homework_phase1_schema.sql` with exactly this content:

```sql
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
```

- [ ] **Step 3: Self-review the SQL**

Check, in the file:
- Every `REFERENCES public.profiles(id)` has an explicit `ON DELETE` (CASCADE for `student_id`; SET NULL for `created_by`/`evaluated_by`/`changed_by`). ✅
- `subject_id` references `public.universal_subjects(id)` (NOT `subjects`). ✅
- Every FK column has a matching `CREATE INDEX`. ✅
- Helper functions are defined **after** the tables they query and **before** the policies that call them. ✅
- No policy contains an inline `EXISTS` across the two *mutually-referencing* tables `homework_assignments` ↔ `homework_assignment_classes` (those go through `can_manage_homework`/`homework_visible_to_student`). ✅
- `homework_log_mark_audit` is `SECURITY DEFINER` (so it can insert into `homework_mark_audit`, which has no user INSERT policy). ✅

- [ ] **Step 4: Commit**

Run:
```bash
git add supabase/migrations/20260601090000_homework_phase1_schema.sql
git commit -m @'
feat(homework): phase-1 schema, indexes, triggers, RLS

Seven tables (assignments, assignment_classes, submissions, submission_files,
results, mark_audit, notifications_sent) with FK indexes, edit-lock + file-cap
+ audit triggers, wing-scoped can_manage_homework / homework_visible_to_student
SECURITY DEFINER helpers, and RLS policies on every table.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: Storage bucket migration

**Files:**
- Create: `supabase/migrations/20260601090100_homework_storage_bucket.sql`

- [ ] **Step 1: Create the bucket migration**

Create `supabase/migrations/20260601090100_homework_storage_bucket.sql` with exactly:

```sql
-- =====================================================================
-- Homework & Assignment — Phase 1: private storage bucket
-- Teacher attachments + student submission files. Cross-user reads are
-- served via service-role signed URLs in later phases; direct object
-- access is owner-only.
-- =====================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'homework-files',
  'homework-files',
  false,
  10485760, -- 10 MB
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'application/rtf','text/rtf',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "homework_files_insert" ON storage.objects;
CREATE POLICY "homework_files_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'homework-files' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "homework_files_select_own" ON storage.objects;
CREATE POLICY "homework_files_select_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'homework-files' AND auth.uid() = owner);

DROP POLICY IF EXISTS "homework_files_update_own" ON storage.objects;
CREATE POLICY "homework_files_update_own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'homework-files' AND auth.uid() = owner)
  WITH CHECK (bucket_id = 'homework-files' AND auth.uid() = owner);

DROP POLICY IF EXISTS "homework_files_delete_own" ON storage.objects;
CREATE POLICY "homework_files_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'homework-files' AND auth.uid() = owner);
```

- [ ] **Step 2: Commit**

Run:
```bash
git add supabase/migrations/20260601090100_homework_storage_bucket.sql
git commit -m @'
feat(homework): private homework-files storage bucket + owner RLS

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: Feature flag registration + backfill

**Files:**
- Modify: `src/components/admin/institution-wizard/featuresData.ts`
- Create: `supabase/migrations/20260601090200_homework_feature_backfill.sql`

- [ ] **Step 1: Read the current featuresData.ts to confirm insertion points**

Run: open `src/components/admin/institution-wizard/featuresData.ts`. Confirm: the lucide-react import line at the top, the `AVAILABLE_FEATURES` array (the `exams` entry is on ~line 24, the array closes ~line 52), and `FEATURE_URL_MAP` (closes ~line 99). Note the exact icon import style.

- [ ] **Step 2: Add the `homework` feature entry**

In `AVAILABLE_FEATURES`, immediately **after** the `exams` line, add:

```ts
  { id: "homework", name: "Homework & Assignment", description: "Create, distribute, and grade homework and assignments", icon: ClipboardList, category: "academic", isDefault: true },
```

Ensure `ClipboardList` is imported from `lucide-react` at the top of the file. If the existing lucide import does not already include it, add `ClipboardList` to that import list (do not create a second import statement).

- [ ] **Step 3: Add the URL map entries**

In `FEATURE_URL_MAP`, before the closing brace, add these three lines (map every role-specific URL so the sidebar never leaks a tab when the feature is off):

```ts
  "/homework": "homework",
  "/homework/create": "homework",
  "/student/homework": "homework",
```

- [ ] **Step 4: Create the backfill migration**

Create `supabase/migrations/20260601090200_homework_feature_backfill.sql` with exactly:

```sql
-- =====================================================================
-- Homework & Assignment — Phase 1: enable 'homework' feature (default-on)
-- for all existing institutions. New institutions follow the existing
-- per-institution enablement flow (EditInstitutionDialog).
-- =====================================================================
INSERT INTO public.institution_features (institution_id, feature_id, is_enabled)
SELECT id, 'homework', true
FROM public.institutions
ON CONFLICT (institution_id, feature_id) DO NOTHING;
```

- [ ] **Step 5: Verify the TypeScript change builds clean (§5a)**

Run:
```bash
npx tsc --noEmit
npx eslint src/components/admin/institution-wizard/featuresData.ts
npx vite build
```
Expected: `tsc` exits 0; eslint reports no errors on the file; `vite build` exits 0 (bundle-size warnings are not failures).

- [ ] **Step 6: Commit**

Run:
```bash
git add src/components/admin/institution-wizard/featuresData.ts supabase/migrations/20260601090200_homework_feature_backfill.sql
git commit -m @'
feat(homework): register homework feature flag + backfill existing institutions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: Apply migrations and verify the database

**Files:**
- (none — DB verification only)

- [ ] **Step 1: Apply the three migrations**

Apply via your usual Supabase mechanism (e.g. `npx supabase db push` against a dev/branch DB, or the Management API), in filename order:
`20260601090000_…` → `20260601090100_…` → `20260601090200_…`.
Expected: all three apply with no errors.

- [ ] **Step 2: Verify tables, RLS, and indexes exist**

Run this in the Supabase SQL editor:
```sql
-- 7 tables present
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'homework\_%'
ORDER BY tablename;
-- Expect: homework_assignment_classes, homework_assignments, homework_mark_audit,
--         homework_notifications_sent, homework_results, homework_submission_files, homework_submissions

-- RLS enabled on all 7
SELECT relname, relrowsecurity FROM pg_class
WHERE relname LIKE 'homework\_%' AND relkind = 'r'
ORDER BY relname;
-- Expect: relrowsecurity = true for every row

-- Helper functions present
SELECT proname FROM pg_proc
WHERE proname IN ('can_manage_homework','homework_visible_to_student','homework_log_mark_audit',
                  'homework_enforce_edit_lock','homework_guard_class_changes','homework_enforce_file_limit');
-- Expect: all 6
```

- [ ] **Step 3: Verify the storage bucket**

```sql
SELECT id, public, file_size_limit, array_length(allowed_mime_types, 1) AS mime_count
FROM storage.buckets WHERE id = 'homework-files';
-- Expect: public = false, file_size_limit = 10485760, mime_count = 17
```

- [ ] **Step 4: Verify the feature backfill**

```sql
SELECT count(*) AS institutions, count(f.feature_id) AS with_homework
FROM public.institutions i
LEFT JOIN public.institution_features f
  ON f.institution_id = i.id AND f.feature_id = 'homework';
-- Expect: with_homework = institutions (every institution now has the flag)
```

- [ ] **Step 5: Smoke-test the edit-lock trigger (optional, on a dev DB)**

```sql
-- As a setup, insert a published+visible assignment, then attempt a title edit; expect the exception.
-- (Use a real institution_id, subject_id, and a created_by profile id from your dev DB.)
-- This should RAISE: 'This assignment is locked for edits (already visible to students).'
```
Expected: the UPDATE raises the lock exception. (Skip if you don't have a scratch DB; the logic is covered by review.)

- [ ] **Step 6: Final phase verification + push**

Confirm `npx tsc --noEmit` and `npx vite build` still exit 0 (no TS/build regressions from the featuresData.ts change). Then push the branch:
```bash
git push -u origin homework/phase-1-schema
```

---

## Self-review (run before handing off)

**Spec coverage (§ → task):**
- Spec §3 tables → Task 2 (all 7 created with the exact columns/constraints).
- Spec §4 RLS + helpers → Task 2 (helpers + policies, wing-scoped coordinator via `is_coordinator_for_class`).
- Spec §5 storage → Task 3 (private bucket + allowlist + owner policies).
- Spec §9 AY + audit → Task 2 (`academic_year` column + `homework_mark_audit` + trigger).
- Spec §10 feature gating (flag + backfill) → Task 4. (Nav wiring is Phase 2, per spec §12.)
- Spec §3 edit-lock / one-shot / ≤10 files → Task 2 triggers + UNIQUE constraints.

**Placeholder scan:** none — every step has exact SQL/commands.

**Type/name consistency:** table names, column names, helper signatures, and policy predicates are identical across Tasks 2/3/4/5. `subject_id → universal_subjects`, `can_manage_homework`/`homework_visible_to_student` names match between definition (Task 2) and policy usage (Task 2) and verification (Task 5).

**Deferred to later phases (not gaps):** types.ts regen (Phase 2), nav/dashboard/route wiring (Phase 2), submit-homework edge function + signed-URL read brokering (Phase 3/4), notification cron (Phase 6), analytics RPC (Phase 7).
