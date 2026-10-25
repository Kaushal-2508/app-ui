-- =============================================================================
-- Syllabus Segmentation (optional, additive)
--
-- Lets a school split a subject's syllabus into named parts (PA1, Term 1, ...)
-- at the CLASS-GROUP + SUBJECT level, so a part applies identically to every
-- section of that class. A chapter may belong to many parts. Parts are optional:
-- a subject with zero parts behaves exactly as before.
--
-- Scope model (verified against real schema 2026-07-08):
--   * class_groups = the "class" that contains all sections (classes rows).
--   * chapters = syllabus_topics (linked to a subject by subject_id).
--   * Segments are keyed by (institution_id, class_group_id, subject_id) so they
--     apply to every section, and never leak across class_groups for a shared
--     GLOBAL subject.
--
-- Permissions reuse the existing SECURITY DEFINER, section-level helpers
-- (is_coordinator_for_class, is_teacher_for_class, has_role) composed up to the
-- class_group. No new scoping model is invented.
--
-- Fully additive. No existing table, column, or policy is altered. Safe on live
-- pilot data (creates only new objects).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.syllabus_segments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id)      ON DELETE CASCADE,
  class_group_id uuid NOT NULL REFERENCES public.class_groups(id)      ON DELETE CASCADE,
  subject_id     uuid NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  name           text NOT NULL,
  display_order  integer NOT NULL DEFAULT 0,
  created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Every FK gets an index in the same migration (CLAUDE.md 23).
CREATE INDEX IF NOT EXISTS syllabus_segments_scope_idx
  ON public.syllabus_segments (institution_id, class_group_id, subject_id);
CREATE INDEX IF NOT EXISTS syllabus_segments_class_group_id_idx
  ON public.syllabus_segments (class_group_id);
CREATE INDEX IF NOT EXISTS syllabus_segments_subject_id_idx
  ON public.syllabus_segments (subject_id);
CREATE INDEX IF NOT EXISTS syllabus_segments_created_by_idx
  ON public.syllabus_segments (created_by);

DROP TRIGGER IF EXISTS set_syllabus_segments_updated_at ON public.syllabus_segments;
CREATE TRIGGER set_syllabus_segments_updated_at
  BEFORE UPDATE ON public.syllabus_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Many-to-many: a chapter may be in many parts; no "primary part", no
-- constraint forcing a chapter into only one part. The UNIQUE below only stops
-- the SAME chapter being linked to the SAME part twice.
CREATE TABLE IF NOT EXISTS public.syllabus_segment_chapters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL REFERENCES public.syllabus_segments(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES public.syllabus_topics(id)   ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (segment_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS syllabus_segment_chapters_segment_id_idx
  ON public.syllabus_segment_chapters (segment_id);
CREATE INDEX IF NOT EXISTS syllabus_segment_chapters_chapter_id_idx
  ON public.syllabus_segment_chapters (chapter_id);

-- ---------------------------------------------------------------------------
-- 2. SECURITY DEFINER permission helpers (compose existing section-level checks)
-- ---------------------------------------------------------------------------

-- Is this user a student enrolled in any section of the class_group?
CREATE OR REPLACE FUNCTION public.student_in_class_group(_user_id uuid, _class_group_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM class_assignments ca
    JOIN classes c ON c.id = ca.class_id
    WHERE ca.user_id = _user_id
      AND ca.role = 'student'
      AND c.class_group_id = _class_group_id
  )
$$;

-- May this user CREATE/EDIT/DELETE/REORDER parts for (class_group, subject)?
-- admin: any class_group in their institution; coordinator: any section of it;
-- teacher: only if they teach that subject in any section of it.
CREATE OR REPLACE FUNCTION public.can_manage_syllabus_segment(
  _user_id uuid, _class_group_id uuid, _subject_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    CASE
      WHEN public.has_role(_user_id, 'super_admin') THEN true
      ELSE (
        EXISTS (
          SELECT 1 FROM class_groups cg
          WHERE cg.id = _class_group_id
            AND cg.institution_id = public.get_user_institution(_user_id)
        )
        AND (
          public.has_role(_user_id, 'school_admin')  -- includes super_school_admin
          OR EXISTS (
            SELECT 1 FROM classes c
            WHERE c.class_group_id = _class_group_id
              AND public.is_coordinator_for_class(_user_id, c.id)
          )
          OR EXISTS (
            SELECT 1 FROM class_assignments ca
            JOIN classes c ON c.id = ca.class_id
            WHERE ca.user_id = _user_id
              AND ca.role = 'teacher'
              AND ca.subject_id = _subject_id
              AND c.class_group_id = _class_group_id
          )
        )
      )
    END
$$;

-- May this user READ parts for a class_group?
-- staff of the class_group's institution + students of the class_group.
-- Institution is derived from class_groups here (never trusts a stored/passed
-- institution_id) so a spoofed column can never widen read access.
CREATE OR REPLACE FUNCTION public.can_read_syllabus_segment(
  _user_id uuid, _class_group_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'super_admin')
    OR (
      EXISTS (
        SELECT 1 FROM class_groups cg
        WHERE cg.id = _class_group_id
          AND cg.institution_id = public.get_user_institution(_user_id)
      )
      AND (
        public.has_role(_user_id, 'school_admin')
        OR public.has_role(_user_id, 'coordinator')
        OR public.has_role(_user_id, 'teacher')
        OR public.has_role(_user_id, 'employee')
      )
    )
    OR public.student_in_class_group(_user_id, _class_group_id)
$$;

-- Row-targeted variants used by segment_chapters policies (no inline cross-table
-- EXISTS in policies -> avoids the recursion trap; CLAUDE.md 23).
CREATE OR REPLACE FUNCTION public.can_manage_segment(_user_id uuid, _segment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM syllabus_segments s
    WHERE s.id = _segment_id
      AND public.can_manage_syllabus_segment(_user_id, s.class_group_id, s.subject_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_read_segment(_user_id uuid, _segment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM syllabus_segments s
    WHERE s.id = _segment_id
      AND public.can_read_syllabus_segment(_user_id, s.class_group_id)
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.syllabus_segments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_segment_chapters  ENABLE ROW LEVEL SECURITY;

-- syllabus_segments
DROP POLICY IF EXISTS "read syllabus segments" ON public.syllabus_segments;
CREATE POLICY "read syllabus segments"
  ON public.syllabus_segments FOR SELECT TO authenticated
  USING (public.can_read_syllabus_segment((select auth.uid()), class_group_id));

DROP POLICY IF EXISTS "insert syllabus segments" ON public.syllabus_segments;
CREATE POLICY "insert syllabus segments"
  ON public.syllabus_segments FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_syllabus_segment((select auth.uid()), class_group_id, subject_id));

DROP POLICY IF EXISTS "update syllabus segments" ON public.syllabus_segments;
CREATE POLICY "update syllabus segments"
  ON public.syllabus_segments FOR UPDATE TO authenticated
  USING (public.can_manage_syllabus_segment((select auth.uid()), class_group_id, subject_id))
  WITH CHECK (public.can_manage_syllabus_segment((select auth.uid()), class_group_id, subject_id));

DROP POLICY IF EXISTS "delete syllabus segments" ON public.syllabus_segments;
CREATE POLICY "delete syllabus segments"
  ON public.syllabus_segments FOR DELETE TO authenticated
  USING (public.can_manage_syllabus_segment((select auth.uid()), class_group_id, subject_id));

-- syllabus_segment_chapters
DROP POLICY IF EXISTS "read segment chapters" ON public.syllabus_segment_chapters;
CREATE POLICY "read segment chapters"
  ON public.syllabus_segment_chapters FOR SELECT TO authenticated
  USING (public.can_read_segment((select auth.uid()), segment_id));

DROP POLICY IF EXISTS "insert segment chapters" ON public.syllabus_segment_chapters;
CREATE POLICY "insert segment chapters"
  ON public.syllabus_segment_chapters FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_segment((select auth.uid()), segment_id));

DROP POLICY IF EXISTS "delete segment chapters" ON public.syllabus_segment_chapters;
CREATE POLICY "delete segment chapters"
  ON public.syllabus_segment_chapters FOR DELETE TO authenticated
  USING (public.can_manage_segment((select auth.uid()), segment_id));

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
-- Reads only for the client. Every write goes through the SECURITY DEFINER RPCs
-- below, which re-derive institution_id from class_groups and re-check
-- can_manage. Supabase's default privileges grant ALL on new public tables to
-- anon/authenticated, so we must REVOKE first, then grant back SELECT only.
-- This closes the raw-PostgREST write surface (and any institution_id spoofing)
-- entirely and makes the stored institution_id trustworthy (only the create RPC
-- ever sets it; nothing updates it). The write policies above remain as
-- defence-in-depth should a future grant ever be added.
REVOKE ALL ON public.syllabus_segments         FROM anon, authenticated;
REVOKE ALL ON public.syllabus_segment_chapters FROM anon, authenticated;
GRANT SELECT ON public.syllabus_segments         TO authenticated;
GRANT SELECT ON public.syllabus_segment_chapters TO authenticated;

GRANT EXECUTE ON FUNCTION public.student_in_class_group(uuid, uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_syllabus_segment(uuid, uuid, uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_syllabus_segment(uuid, uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_segment(uuid, uuid)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_segment(uuid, uuid)                       TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Write RPCs (atomic, gated, idempotent where applicable)
--    All writes go through these so multi-row changes are one transaction and
--    permission denials raise a clean, translatable error.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_syllabus_segment(
  _class_group_id uuid, _subject_id uuid, _name text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(_name, ''));
  v_inst uuid;
  v_ord  integer;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to manage parts';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Please enter a name for the part';
  END IF;
  IF NOT public.can_manage_syllabus_segment(v_uid, _class_group_id, _subject_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage parts for this class and subject';
  END IF;

  SELECT institution_id INTO v_inst FROM class_groups WHERE id = _class_group_id;
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'That class could not be found';
  END IF;

  -- Serialise concurrent creates for the same (class_group, subject) so two
  -- tabs cannot compute the same next display_order.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(_class_group_id::text || ':' || _subject_id::text, 0)
  );

  SELECT coalesce(max(display_order), 0) + 1 INTO v_ord
  FROM syllabus_segments
  WHERE class_group_id = _class_group_id AND subject_id = _subject_id;

  INSERT INTO syllabus_segments (institution_id, class_group_id, subject_id, name, display_order, created_by)
  VALUES (v_inst, _class_group_id, _subject_id, v_name, v_ord, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_syllabus_segment(_segment_id uuid, _name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(_name, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to manage parts';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Please enter a name for the part';
  END IF;
  IF NOT public.can_manage_segment(v_uid, _segment_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this part';
  END IF;

  UPDATE syllabus_segments SET name = v_name, updated_at = now() WHERE id = _segment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_syllabus_segment(_segment_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to manage parts';
  END IF;
  IF NOT public.can_manage_segment(v_uid, _segment_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this part';
  END IF;

  -- Removes the part and its chapter links only (ON DELETE CASCADE on the
  -- link table). Never touches syllabus_topics or the syllabus itself.
  DELETE FROM syllabus_segments WHERE id = _segment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_syllabus_segments(
  _class_group_id uuid, _subject_id uuid, _ordered_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to manage parts';
  END IF;
  IF NOT public.can_manage_syllabus_segment(v_uid, _class_group_id, _subject_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage parts for this class and subject';
  END IF;

  UPDATE syllabus_segments s
  SET display_order = u.ord, updated_at = now()
  FROM unnest(_ordered_ids) WITH ORDINALITY AS u(id, ord)
  WHERE s.id = u.id
    AND s.class_group_id = _class_group_id
    AND s.subject_id = _subject_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_segment_chapters(_segment_id uuid, _chapter_ids uuid[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to manage parts';
  END IF;
  IF NOT public.can_manage_segment(v_uid, _segment_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this part';
  END IF;

  -- Replace membership atomically. Only accept chapters that really are active
  -- chapters of this part's subject (defensive against stale client ids).
  DELETE FROM syllabus_segment_chapters WHERE segment_id = _segment_id;

  INSERT INTO syllabus_segment_chapters (segment_id, chapter_id)
  SELECT _segment_id, cid
  FROM unnest(_chapter_ids) AS t(cid)
  WHERE EXISTS (
    SELECT 1
    FROM syllabus_topics st
    JOIN syllabus_segments s ON s.id = _segment_id
    WHERE st.id = cid
      AND st.subject_id = s.subject_id
      AND st.is_active = true
      AND (st.institution_id = s.institution_id OR st.institution_id IS NULL)
  )
  ON CONFLICT (segment_id, chapter_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_syllabus_segment(uuid, uuid, text)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_syllabus_segment(uuid, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_syllabus_segment(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_syllabus_segments(uuid, uuid, uuid[])    TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_segment_chapters(uuid, uuid[])              TO authenticated;
