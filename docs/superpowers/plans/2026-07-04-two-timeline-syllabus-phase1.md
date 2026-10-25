# Two-Timeline Syllabus — Phase 1 (The Jar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-period lesson capture with chapter-based syllabus progress (the "jar"): a `syllabus_progress_events` table written at check-out (per class+subject, Completed/Partial via dropdown + add-more), a non-blocking check-in backlog popup that replaces the login hard-block gate, and a coverage dual-write — per spec `docs/superpowers/specs/2026-07-04-two-timeline-syllabus-design.md` §3–§6, §9–§10.

**Architecture:** Two new tables (`syllabus_progress_events`, `syllabus_sequence`) + three SECURITY DEFINER RPCs (`teacher_pending_syllabus_days`, `syllabus_progress_state`, `record_syllabus_progress` — the last one does event upsert + tt_lesson_plans coverage dual-write in ONE transaction). Frontend: new `useSyllabusProgress.ts` hooks, new `SyllabusProgressGroup` + `CheckInBacklogSheet` components, `CheckOutLessonGate` inner rework, `StaffCheckInCard` check-in wiring, My Week backlog chip, ProtectedRoute login-gate removal, deletion of the superseded Phase-1 (2026-07-03) components/hooks.

**Tech stack:** React 18 + TS, TanStack Query v5, Supabase (Postgres RLS + SECURITY DEFINER RPCs), shadcn/ui + MobileSheet.

## Global Constraints (binding, from CLAUDE.md + spec §12)

- `npm run typecheck` (NOT bare `npx tsc`), `npx eslint <changed>`, `npx vite build` — all clean before any task is "done" (§5a).
- No `any` (hard error), `prefer-const` (hard error). Never suppress.
- Every error toast via `toastError(err, { fallback, context })`; `toast` only for success/info.
- Every new `useQuery`: explicit `staleTime: 60_000`. No `select("*")`. No JWT-less `supabase.auth.getUser()` in NEW code.
- Every FK indexed in the same migration; `recorded_by`/`updated_by` → `ON DELETE SET NULL` (§21); RLS via the proven tri-clause (`tt_user_can_edit_class_slots` OR `class_assignments` teacher OR `tt_slots` teacher).
- All "today"/date math server-side via `(now() AT TIME ZONE COALESCE(institutions.timezone,'Asia/Kolkata'))::date` (§24). The client NEVER computes the teaching date — it uses the `date` string returned by the pending RPC.
- Forms with unsaved input set `data-dirty="true"` on a real `<form>` element (§17); Buttons inside get `type="button"`.
- shadcn/design-system components only; `MobileSheet` for sheets.
- Prod SQL applies via `scripts/run-sql.ps1` (Management API); migration ledger is stale — verify via information_schema/pg_proc, never `db push`.
- Branch: `feat/two-timeline-syllabus` off current `main`.

---

## Task 1: Migration A — tables + RLS + indexes + backfill

**Files:** Create `supabase/migrations/20260704140000_syllabus_progress_phase1.sql`

**Interfaces produced:** tables `public.syllabus_progress_events`, `public.syllabus_sequence` (shapes below — Tasks 2/4 depend on the exact column names).

- [ ] **Step 1: Write the migration file** with exactly:

```sql
-- 20260704140000_syllabus_progress_phase1.sql
-- Two-timeline syllabus, Phase 1 (spec 2026-07-04 §3, §9):
--   * syllabus_progress_events — the "jar": one row per (class, subject,
--     chapter, teaching-date) with action completed|partial. Chapter state and
--     day-resolution are DERIVED from this table (no status columns elsewhere).
--   * syllabus_sequence — teacher-controlled chapter order (default = syllabus
--     display order when no rows). Written by Phase 2 UI; created now so the
--     state RPC reads one shape from day one.
--   * Backfill completed events from historical tt_lesson_plans done rows so
--     dropdowns never re-offer already-taught chapters.

CREATE TABLE IF NOT EXISTS public.syllabus_progress_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id)       ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES public.classes(id)            ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  topic_id        UUID NOT NULL REFERENCES public.syllabus_topics(id)    ON DELETE CASCADE,
  date            DATE NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('completed','partial')),
  source          TEXT NOT NULL CHECK (source IN ('checkout','checkin','correction')),
  recorded_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT spe_unique UNIQUE (class_id, subject_id, topic_id, date)
);

CREATE INDEX IF NOT EXISTS spe_inst_idx        ON public.syllabus_progress_events (institution_id);
CREATE INDEX IF NOT EXISTS spe_subject_idx     ON public.syllabus_progress_events (subject_id);
CREATE INDEX IF NOT EXISTS spe_topic_idx       ON public.syllabus_progress_events (topic_id);
CREATE INDEX IF NOT EXISTS spe_recorded_by_idx ON public.syllabus_progress_events (recorded_by);
-- Day-resolution lookups: (class, subject, date). The UNIQUE covers
-- (class, subject, topic, date) but date-last doesn't serve this shape.
CREATE INDEX IF NOT EXISTS spe_class_subject_date_idx
  ON public.syllabus_progress_events (class_id, subject_id, date);

CREATE TABLE IF NOT EXISTS public.syllabus_sequence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id)       ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES public.classes(id)            ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES public.universal_subjects(id) ON DELETE CASCADE,
  topic_id        UUID NOT NULL REFERENCES public.syllabus_topics(id)    ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  updated_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sseq_unique UNIQUE (class_id, subject_id, topic_id)
);

CREATE INDEX IF NOT EXISTS sseq_inst_idx       ON public.syllabus_sequence (institution_id);
CREATE INDEX IF NOT EXISTS sseq_subject_idx    ON public.syllabus_sequence (subject_id);
CREATE INDEX IF NOT EXISTS sseq_topic_idx      ON public.syllabus_sequence (topic_id);
CREATE INDEX IF NOT EXISTS sseq_updated_by_idx ON public.syllabus_sequence (updated_by);

ALTER TABLE public.syllabus_progress_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syllabus_sequence        ENABLE ROW LEVEL SECURITY;

-- Read: any institution member (staff surfaces; students only ever read via
-- the SECURITY DEFINER projection RPC in Phase 2).
DROP POLICY IF EXISTS "Members read syllabus progress" ON public.syllabus_progress_events;
CREATE POLICY "Members read syllabus progress" ON public.syllabus_progress_events
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

DROP POLICY IF EXISTS "Members read syllabus sequence" ON public.syllabus_sequence;
CREATE POLICY "Members read syllabus sequence" ON public.syllabus_sequence
  FOR SELECT TO authenticated
  USING (institution_id = public.get_user_institution(auth.uid()));

-- Write: the proven tri-clause (admins/coords helper OR class_assignments
-- teacher OR timetable-scheduled teacher for the class+subject) — same shape
-- as the 20260704130000 tt_chapter_pacing fix.
DROP POLICY IF EXISTS "Staff write syllabus progress" ON public.syllabus_progress_events;
CREATE POLICY "Staff write syllabus progress" ON public.syllabus_progress_events
  FOR ALL TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = syllabus_progress_events.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = syllabus_progress_events.class_id
          AND s.subject_id = syllabus_progress_events.subject_id
      )
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = syllabus_progress_events.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = syllabus_progress_events.class_id
          AND s.subject_id = syllabus_progress_events.subject_id
      )
    )
  );

DROP POLICY IF EXISTS "Staff write syllabus sequence" ON public.syllabus_sequence;
CREATE POLICY "Staff write syllabus sequence" ON public.syllabus_sequence
  FOR ALL TO authenticated
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = syllabus_sequence.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = syllabus_sequence.class_id
          AND s.subject_id = syllabus_sequence.subject_id
      )
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.tt_user_can_edit_class_slots(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.class_assignments ca
        WHERE ca.user_id = auth.uid() AND ca.role = 'teacher' AND ca.class_id = syllabus_sequence.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.tt_slots s
        WHERE s.teacher_id = auth.uid()
          AND s.class_id = syllabus_sequence.class_id
          AND s.subject_id = syllabus_sequence.subject_id
      )
    )
  );

-- Backfill: every historical done teaching row with a chapter becomes a
-- completed event, so day-one dropdowns reflect reality. Re-runnable.
INSERT INTO public.syllabus_progress_events
  (institution_id, class_id, subject_id, topic_id, date, action, source, recorded_by)
SELECT lp.institution_id, lp.class_id, lp.subject_id, lp.topic_id, lp.date,
       'completed', 'correction', lp.owner_teacher_id
FROM public.tt_lesson_plans lp
WHERE lp.status = 'done'
  AND lp.session_type = 'teaching'
  AND lp.topic_id IS NOT NULL
  AND lp.subject_id IS NOT NULL
ON CONFLICT (class_id, subject_id, topic_id, date) DO NOTHING;
```

- [ ] **Step 2: Apply to prod:** `& "scripts\run-sql.ps1" -SqlFile "supabase\migrations\20260704140000_syllabus_progress_phase1.sql"` → expect `HTTP 201` and `[]`.
- [ ] **Step 3: Verify** — run this via `run-sql.ps1` (write to a scratch file first):

```sql
SELECT jsonb_build_object(
  'events_table',  (SELECT count(*) FROM information_schema.tables WHERE table_name='syllabus_progress_events'),
  'seq_table',     (SELECT count(*) FROM information_schema.tables WHERE table_name='syllabus_sequence'),
  'event_policies',(SELECT count(*) FROM pg_policies WHERE tablename='syllabus_progress_events'),
  'seq_policies',  (SELECT count(*) FROM pg_policies WHERE tablename='syllabus_sequence'),
  'backfilled',    (SELECT count(*) FROM public.syllabus_progress_events)
) AS result;
```
Expected: both tables = 1, policies = 2 each, `backfilled` ≥ 0 (report the number).
- [ ] **Step 4: Commit:** `git add supabase/migrations/20260704140000_syllabus_progress_phase1.sql && git commit -m "feat(lms): syllabus progress events + sequence tables (jar, phase 1)"` (+ Co-Authored-By trailer).

---

## Task 2: Migration B — the three RPCs

**Files:** Create `supabase/migrations/20260704141000_syllabus_progress_rpcs.sql`

**Interfaces produced (Tasks 4–7 depend on these exact names/shapes):**
- `teacher_pending_syllabus_days(p_include_today boolean) → jsonb` `{ unresolved_day_count, days:[{ date, is_today, groups:[{ class_id, class_name, subject_id, subject_name, filled }] }] }` — a day is listed only while ≥1 group is unfilled.
- `syllabus_progress_state(p_class_id uuid, p_subject_id uuid, p_date date) → jsonb` array of `{ topic_id, topic_name, chapter_number, position, status: 'completed'|'partial'|'untouched', action_on_date: 'completed'|'partial'|null }`, ordered by position.
- `record_syllabus_progress(p_class_id, p_subject_id, p_topic_id, p_date, p_action, p_source) → jsonb` `{ event_id, lesson_plan_written }`.

- [ ] **Step 1: Write the migration file** with exactly:

```sql
-- 20260704141000_syllabus_progress_rpcs.sql
-- Phase-1 RPCs for the two-timeline syllabus (spec §4.1, §4.2, §4.5).

-- ---------------------------------------------------------------------------
-- 4.1 teacher_pending_syllabus_days — backlog of (class,subject) groups per
-- working day with no jar entry. Carries over the hardened bounds from
-- teacher_pending_lesson_days (60-day lookback, LIMIT 30 days today-first,
-- zero-slot pre-check, institution timezone). DIFFERENCES: groups are
-- (class,subject) not slots, and ABSENT DAYS ARE INCLUDED — the check-in
-- popup is where the teacher fills them (spec decision #4).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_pending_syllabus_days(p_include_today boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_inst   uuid;
  v_tz     text;
  v_today  date;
  v_ay     text;
  v_start  date;
  v_end    date;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  SELECT p.institution_id INTO v_inst FROM public.profiles p WHERE p.id = v_uid;
  IF v_inst IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz FROM public.institutions i WHERE i.id = v_inst;
  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT ay.code, ay.starts_on, ay.ends_on INTO v_ay, v_start, v_end
  FROM public.cal_academic_years ay
  WHERE ay.institution_id = v_inst AND ay.is_active = true
  LIMIT 1;
  IF v_ay IS NULL THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tt_slots s
    WHERE s.teacher_id = v_uid AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical') AND s.subject_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb);
  END IF;

  v_end := LEAST(v_end, CASE WHEN p_include_today THEN v_today ELSE v_today - 1 END);
  v_start := GREATEST(v_start, v_today - 60);
  IF v_start > v_end THEN RETURN jsonb_build_object('unresolved_day_count', 0, 'days', '[]'::jsonb); END IF;

  WITH days AS (
    SELECT d::date AS d FROM generate_series(v_start, v_end, interval '1 day') AS g(d)
  ),
  slots AS (
    SELECT s.class_id, s.subject_id, s.day,
           trim(c.name || COALESCE(' ' || c.section, '')) AS class_name,
           us.name AS subject_name,
           cs.structure_id
    FROM public.tt_slots s
    JOIN public.classes c              ON c.id = s.class_id
    JOIN public.universal_subjects us  ON us.id = s.subject_id
    JOIN public.tt_class_structure cs  ON cs.class_id = s.class_id AND cs.academic_year = v_ay
    WHERE s.teacher_id = v_uid
      AND s.academic_year = v_ay
      AND s.slot_type IN ('theory','practical')
      AND s.subject_id IS NOT NULL
  ),
  occ AS (
    SELECT DISTINCT sl.class_id, sl.class_name, sl.subject_id, sl.subject_name, dd.d
    FROM slots sl
    JOIN public.tt_period_structures ps ON ps.id = sl.structure_id
    JOIN days dd ON public.tt_dow_to_text(dd.d) = sl.day
                AND public.tt_dow_to_text(dd.d) = ANY (ps.working_days)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.cal_events ce
      WHERE ce.institution_id = v_inst AND ce.academic_year = v_ay
        AND ce.kind IN ('holiday','exam_block')
        AND dd.d BETWEEN ce.starts_on AND ce.ends_on
    )
  ),
  grps AS (
    SELECT o.*,
           EXISTS (
             SELECT 1 FROM public.syllabus_progress_events e
             WHERE e.class_id = o.class_id AND e.subject_id = o.subject_id AND e.date = o.d
           ) AS filled
    FROM occ o
  ),
  by_day AS (
    SELECT g.d,
           bool_and(g.filled) AS all_filled,
           jsonb_agg(jsonb_build_object(
             'class_id', g.class_id, 'class_name', g.class_name,
             'subject_id', g.subject_id, 'subject_name', g.subject_name,
             'filled', g.filled
           ) ORDER BY g.class_name, g.subject_name) AS groups
    FROM grps g
    GROUP BY g.d
  ),
  pending AS (
    SELECT * FROM by_day WHERE NOT all_filled
  )
  SELECT jsonb_build_object(
    -- Count over the 60-day window (intentionally window-bounded; older gaps
    -- are out of scope for this per-login hot query).
    'unresolved_day_count', (SELECT count(*) FROM pending),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(p.d, 'YYYY-MM-DD'),
        'is_today', (p.d = v_today),
        'groups', p.groups) ORDER BY p.d)
      FROM (SELECT * FROM pending ORDER BY (d = v_today) DESC, d ASC LIMIT 30) p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_pending_syllabus_days(boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.teacher_pending_syllabus_days(boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4.2 syllabus_progress_state — the chapter working set for one
-- (class, subject): the SAME chapter resolution as useChaptersForExam /
-- coverage (class_group mapping → fallback all active subject topics),
-- sequence-or-default ordering, event-derived status, and the action already
-- recorded for p_date (prefill).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.syllabus_progress_state(p_class_id uuid, p_subject_id uuid, p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_inst uuid;
  v_cg   uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT c.institution_id, c.class_group_id INTO v_inst, v_cg
  FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL OR v_inst IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    WITH mapped AS (
      SELECT st.id, st.topic_name, st.chapter_number, st.display_order
      FROM public.topic_class_mappings tcm
      JOIN public.syllabus_topics st ON st.id = tcm.topic_id
      WHERE v_cg IS NOT NULL
        AND tcm.class_group_id = v_cg
        AND st.subject_id = p_subject_id
        AND st.is_active = true
    ),
    effective AS (
      SELECT * FROM mapped
      UNION ALL
      SELECT st.id, st.topic_name, st.chapter_number, st.display_order
      FROM public.syllabus_topics st
      WHERE st.subject_id = p_subject_id AND st.is_active = true
        AND NOT EXISTS (SELECT 1 FROM mapped)
    ),
    ordered AS (
      SELECT e.id AS topic_id, e.topic_name, e.chapter_number,
             COALESCE(sq.position,
                      10000 + (row_number() OVER (ORDER BY e.display_order NULLS LAST, e.chapter_number NULLS LAST, e.topic_name))::int
             ) AS position
      FROM effective e
      LEFT JOIN public.syllabus_sequence sq
        ON sq.class_id = p_class_id AND sq.subject_id = p_subject_id AND sq.topic_id = e.id
    )
    SELECT jsonb_agg(jsonb_build_object(
      'topic_id', o.topic_id,
      'topic_name', o.topic_name,
      'chapter_number', o.chapter_number,
      'position', o.position,
      'status', CASE
        WHEN EXISTS (SELECT 1 FROM public.syllabus_progress_events e
                     WHERE e.class_id = p_class_id AND e.subject_id = p_subject_id
                       AND e.topic_id = o.topic_id AND e.action = 'completed') THEN 'completed'
        WHEN EXISTS (SELECT 1 FROM public.syllabus_progress_events e
                     WHERE e.class_id = p_class_id AND e.subject_id = p_subject_id
                       AND e.topic_id = o.topic_id AND e.action = 'partial') THEN 'partial'
        ELSE 'untouched' END,
      'action_on_date', CASE WHEN p_date IS NULL THEN NULL ELSE (
        SELECT e.action FROM public.syllabus_progress_events e
        WHERE e.class_id = p_class_id AND e.subject_id = p_subject_id
          AND e.topic_id = o.topic_id AND e.date = p_date
      ) END
    ) ORDER BY o.position)
    FROM ordered o
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.syllabus_progress_state(uuid, uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.syllabus_progress_state(uuid, uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4.5 record_syllabus_progress — THE single write path for jar entries.
-- Event upsert + best-effort coverage dual-write (tt_lesson_plans done row on
-- a free slot of that class+subject+date) in ONE transaction (enterprise
-- rule 6). SECURITY DEFINER ⇒ explicit permission re-check (same tri-clause
-- as the tables' RLS). Institution derived from the class row, never client.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_syllabus_progress(
  p_class_id uuid, p_subject_id uuid, p_topic_id uuid,
  p_date date, p_action text, p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_inst  uuid;
  v_ay    text;
  v_slot  uuid;
  v_event uuid;
  v_lp    boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'You must be signed in.'; END IF;
  IF p_action NOT IN ('completed','partial') OR p_source NOT IN ('checkout','checkin','correction') THEN
    RAISE EXCEPTION 'Invalid progress entry.';
  END IF;

  SELECT c.institution_id INTO v_inst FROM public.classes c WHERE c.id = p_class_id;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'Class not found.'; END IF;
  IF v_inst IS DISTINCT FROM public.get_user_institution(v_uid) THEN
    RAISE EXCEPTION 'You are not allowed to record syllabus progress for this class.';
  END IF;

  IF NOT (
    public.tt_user_can_edit_class_slots(v_uid, p_class_id)
    OR EXISTS (SELECT 1 FROM public.class_assignments ca
               WHERE ca.user_id = v_uid AND ca.role = 'teacher' AND ca.class_id = p_class_id)
    OR EXISTS (SELECT 1 FROM public.tt_slots s
               WHERE s.teacher_id = v_uid AND s.class_id = p_class_id AND s.subject_id = p_subject_id)
  ) THEN
    RAISE EXCEPTION 'You are not allowed to record syllabus progress for this class.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.syllabus_topics st
                 WHERE st.id = p_topic_id AND st.subject_id = p_subject_id) THEN
    RAISE EXCEPTION 'That chapter does not belong to this subject.';
  END IF;

  INSERT INTO public.syllabus_progress_events
    (institution_id, class_id, subject_id, topic_id, date, action, source, recorded_by)
  VALUES (v_inst, p_class_id, p_subject_id, p_topic_id, p_date, p_action, p_source, v_uid)
  ON CONFLICT (class_id, subject_id, topic_id, date)
  DO UPDATE SET action = EXCLUDED.action, source = EXCLUDED.source,
                recorded_by = EXCLUDED.recorded_by, updated_at = now()
  RETURNING id INTO v_event;

  -- Coverage dual-write (best-effort — never blocks the event write): upgrade
  -- or create ONE tt_lesson_plans done row on a slot of this class+subject on
  -- p_date's weekday that doesn't already carry a done row for p_date.
  IF p_action = 'completed' THEN
    BEGIN
      SELECT ay.code INTO v_ay FROM public.cal_academic_years ay
      WHERE ay.institution_id = v_inst AND ay.is_active = true LIMIT 1;

      IF v_ay IS NOT NULL THEN
        SELECT s.id INTO v_slot
        FROM public.tt_slots s
        WHERE s.class_id = p_class_id AND s.subject_id = p_subject_id
          AND s.academic_year = v_ay
          AND s.slot_type IN ('theory','practical')
          AND s.day = public.tt_dow_to_text(p_date)
          AND NOT EXISTS (SELECT 1 FROM public.tt_lesson_plans lp
                          WHERE lp.slot_id = s.id AND lp.date = p_date AND lp.status = 'done')
        ORDER BY s.id
        LIMIT 1;

        IF v_slot IS NOT NULL THEN
          INSERT INTO public.tt_lesson_plans
            (slot_id, institution_id, class_id, subject_id, owner_teacher_id, created_by,
             date, session_type, status, topic_id, updated_by, updated_at)
          VALUES (v_slot, v_inst, p_class_id, p_subject_id, v_uid, v_uid,
                  p_date, 'teaching', 'done', p_topic_id, v_uid, now())
          ON CONFLICT (slot_id, date)
          DO UPDATE SET status = 'done', session_type = 'teaching',
                        topic_id = EXCLUDED.topic_id, updated_by = EXCLUDED.updated_by, updated_at = now();
          v_lp := true;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_lp := false;  -- swallow: the event row above is the source of truth
    END;
  END IF;

  RETURN jsonb_build_object('event_id', v_event, 'lesson_plan_written', v_lp);
END;
$$;

REVOKE ALL ON FUNCTION public.record_syllabus_progress(uuid, uuid, uuid, date, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_syllabus_progress(uuid, uuid, uuid, date, text, text) TO authenticated;
```

- [ ] **Step 2: Apply to prod** via `run-sql.ps1` → `HTTP 201`, `[]`.
- [ ] **Step 3: Smoke-verify** via `run-sql.ps1`:

```sql
SELECT jsonb_build_object(
  'pending_exists', (SELECT count(*) FROM pg_proc WHERE proname='teacher_pending_syllabus_days'),
  'state_exists',   (SELECT count(*) FROM pg_proc WHERE proname='syllabus_progress_state'),
  'record_exists',  (SELECT count(*) FROM pg_proc WHERE proname='record_syllabus_progress'),
  'pending_runs',   public.teacher_pending_syllabus_days(false)
) AS result;
```
Expected: all three = 1; `pending_runs` = `{"days": [], "unresolved_day_count": 0}` (service role has NULL uid).
- [ ] **Step 4: Commit** the migration file (`feat(lms): syllabus-progress RPCs (pending days, state, record)`).

---

## Task 3: Regenerate Supabase types

**Files:** Modify `src/integrations/supabase/types.ts`

- [ ] **Step 1:** `npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw` → **temp file** (never `>` straight to types.ts from PowerShell — UTF-16 trap).
- [ ] **Step 2:** Compare (`Compare-Object` or fc) — expect ONLY additions (two tables, three functions) plus possibly a benign `PostgrestVersion` bump. Any other removal = STOP and investigate.
- [ ] **Step 3:** Write over `src/integrations/supabase/types.ts` with `[System.IO.File]::WriteAllText($path, $raw, (New-Object System.Text.UTF8Encoding($false)))`; verify first bytes are ASCII (`0x65 0x78`).
- [ ] **Step 4:** `npm run typecheck` → exit 0. Commit (`chore(types): syllabus_progress_events/sequence + 3 RPCs (regen)`).

---

## Task 4: Hooks — `src/hooks/useSyllabusProgress.ts`

**Files:** Create `src/hooks/useSyllabusProgress.ts`

**Interfaces:**
- Consumes: RPCs from Task 2 (typed after Task 3).
- Produces (Tasks 5–7 import these EXACT names): `PendingGroup`, `PendingSyllabusDay`, `PendingSyllabusDays`, `ChapterAction`, `ChapterProgressState`, `useTeacherPendingSyllabusDays`, `useSyllabusProgressState`, `useRecordSyllabusProgress`.

- [ ] **Step 1: Create the file** with exactly:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toastError } from "@/lib/toast";

export interface PendingGroup {
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  filled: boolean;
}
export interface PendingSyllabusDay {
  date: string;
  is_today: boolean;
  groups: PendingGroup[];
}
export interface PendingSyllabusDays {
  unresolved_day_count: number;
  days: PendingSyllabusDay[];
}

/** Days with ≥1 (class, subject) group missing a jar entry (past, optionally today). */
export function useTeacherPendingSyllabusDays(opts: { includeToday: boolean; enabled?: boolean }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["teacher-pending-syllabus-days", user?.id, opts.includeToday],
    enabled: (opts.enabled ?? true) && !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<PendingSyllabusDays> => {
      const { data, error } = await supabase.rpc("teacher_pending_syllabus_days", {
        p_include_today: opts.includeToday,
      });
      if (error) throw error;
      return (data as unknown as PendingSyllabusDays) ?? { unresolved_day_count: 0, days: [] };
    },
  });
}

export type ChapterAction = "completed" | "partial";
export interface ChapterProgressState {
  topic_id: string;
  topic_name: string;
  chapter_number: number | null;
  position: number;
  status: "completed" | "partial" | "untouched";
  action_on_date: ChapterAction | null;
}

/** Chapter working set for one (class, subject): status + what's recorded for `date`. */
export function useSyllabusProgressState(args: { classId: string; subjectId: string; date: string } | null) {
  return useQuery({
    queryKey: ["syllabus-progress-state", args?.classId, args?.subjectId, args?.date],
    enabled: !!args,
    staleTime: 60_000,
    queryFn: async (): Promise<ChapterProgressState[]> => {
      if (!args) return [];
      const { data, error } = await supabase.rpc("syllabus_progress_state", {
        p_class_id: args.classId,
        p_subject_id: args.subjectId,
        p_date: args.date,
      });
      if (error) throw error;
      return (data as unknown as ChapterProgressState[]) ?? [];
    },
  });
}

/** The single jar write path — event upsert + coverage dual-write in one RPC transaction. */
export function useRecordSyllabusProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      classId: string; subjectId: string; topicId: string;
      date: string; action: ChapterAction; source: "checkout" | "checkin" | "correction";
    }) => {
      const { error } = await supabase.rpc("record_syllabus_progress", {
        p_class_id: input.classId,
        p_subject_id: input.subjectId,
        p_topic_id: input.topicId,
        p_date: input.date,
        p_action: input.action,
        p_source: input.source,
      });
      if (error) throw error;
    },
    onError: (e: unknown) =>
      toastError(e, { fallback: "Couldn't save syllabus progress.", context: "recordSyllabusProgress" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teacher-pending-syllabus-days"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-progress-state"] });
      queryClient.invalidateQueries({ queryKey: ["syllabus-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["dash"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "lesson-plan"] });
    },
  });
}
```

- [ ] **Step 2: Verify:** `npm run typecheck` exit 0; `npx eslint src/hooks/useSyllabusProgress.ts` 0 errors.
- [ ] **Step 3: Commit** (`feat(lms): syllabus-progress hooks (pending days, state, record)`).

---

## Task 5: Components — `SyllabusProgressGroup` + `CheckInBacklogSheet`

**Files:** Create `src/components/lesson-completion/SyllabusProgressGroup.tsx`, `src/components/lesson-completion/CheckInBacklogSheet.tsx`

**Interfaces:**
- Consumes: Task 4 hooks; `MobileSheet` from `@/components/shared/sheets`; shadcn `Card/Button/Select/Badge`.
- Produces: `<SyllabusProgressGroup classId subjectId className subjectName date source />` and `<CheckInBacklogSheet open onOpenChange />` (Tasks 6–7 mount them).

- [ ] **Step 1: Create `SyllabusProgressGroup.tsx`** with exactly:

```tsx
import { useState } from "react";
import { Check, CircleDot, Loader2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useSyllabusProgressState,
  useRecordSyllabusProgress,
  type ChapterAction,
} from "@/hooks/useSyllabusProgress";

/**
 * One (class, subject) group for a specific teaching date: rows already
 * recorded for that date + a picker (remaining chapters) with Completed /
 * Partial actions. Per-row save via record_syllabus_progress — interruption
 * re-opens prefilled (state RPC returns action_on_date).
 */
export function SyllabusProgressGroup({
  classId, subjectId, className, subjectName, date, source,
}: {
  classId: string; subjectId: string; className: string; subjectName: string;
  date: string; source: "checkout" | "checkin";
}) {
  const { data: chapters = [], isLoading, isError } = useSyllabusProgressState({ classId, subjectId, date });
  const record = useRecordSyllabusProgress();
  const [pickedId, setPickedId] = useState<string | null>(null);

  const savedToday = chapters.filter((c) => c.action_on_date != null);
  const available = chapters.filter((c) => c.status !== "completed" && c.action_on_date == null);
  const filled = savedToday.length > 0;

  const save = async (action: ChapterAction) => {
    if (!pickedId) return;
    await record.mutateAsync({ classId, subjectId, topicId: pickedId, date, action, source });
    setPickedId(null);
  };

  return (
    <Card className="surface-card frosted-shadow rounded-card p-3">
      <form data-dirty="true" onSubmit={(e) => e.preventDefault()} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-900 truncate">
            {className} · {subjectName}
          </p>
          {filled && (
            <Badge variant="outline" className="shrink-0 gap-1 text-[10px] h-5 bg-emerald-50 text-emerald-700 border-emerald-200">
              <Check className="h-2.5 w-2.5" /> Filled
            </Badge>
          )}
        </div>

        {savedToday.map((c) => (
          <div key={c.topic_id} className="flex items-center justify-between gap-2 rounded-lg border border-surface-stroke px-2.5 py-1.5">
            <span className="text-xs text-ink-900 truncate">
              {c.chapter_number != null ? `${c.chapter_number}. ` : ""}{c.topic_name}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 text-[10px] h-5",
                c.action_on_date === "completed"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-700 border-amber-200",
              )}
            >
              {c.action_on_date === "completed" ? "Completed" : "Partial"}
            </Badge>
          </div>
        ))}

        {isLoading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-ink-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading chapters…
          </div>
        ) : isError ? (
          <p className="flex items-center gap-1.5 py-1 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Couldn't load chapters — retrying.
          </p>
        ) : available.length === 0 ? (
          savedToday.length === 0 ? (
            <p className="py-1 text-xs text-ink-500">All chapters of this subject are already completed.</p>
          ) : null
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={pickedId ?? undefined} onValueChange={(v) => setPickedId(v)} disabled={record.isPending}>
              <SelectTrigger className="h-9 flex-1">
                <SelectValue placeholder={savedToday.length > 0 ? "Add another chapter…" : "Which chapter did you teach?"} />
              </SelectTrigger>
              <SelectContent>
                {available.map((c) => (
                  <SelectItem key={c.topic_id} value={c.topic_id}>
                    {c.chapter_number != null ? `${c.chapter_number}. ` : ""}{c.topic_name}
                    {c.status === "partial" ? " · in progress" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button" size="sm"
                onClick={() => save("completed")}
                disabled={!pickedId || record.isPending}
                className="bg-brand-primary text-white hover:bg-brand-primary/90"
              >
                <Check className="h-4 w-4 mr-1" /> Completed
              </Button>
              <Button
                type="button" size="sm" variant="outline"
                onClick={() => save("partial")}
                disabled={!pickedId || record.isPending}
              >
                <CircleDot className="h-4 w-4 mr-1" /> Partial
              </Button>
            </div>
          </div>
        )}
      </form>
    </Card>
  );
}
```

- [ ] **Step 2: Create `CheckInBacklogSheet.tsx`** with exactly:

```tsx
import { format, parseISO } from "date-fns";
import { NotebookPen, Loader2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { useTeacherPendingSyllabusDays } from "@/hooks/useSyllabusProgress";
import { SyllabusProgressGroup } from "./SyllabusProgressGroup";

/**
 * Non-blocking backlog popup (replaces the login hard-block gate): lists past
 * days whose (class, subject) groups have no jar entry — absent days included.
 * Opened after check-in and from the My Week backlog chip; dismissible; days
 * drop off as their groups are filled.
 */
export function CheckInBacklogSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError } = useTeacherPendingSyllabusDays({ includeToday: false, enabled: open });
  const days = data?.days ?? [];

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Unlogged syllabus"
      subtitle="Fill what you covered on these days"
      icon={<NotebookPen className="h-4 w-4" />}
      secondaryAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your recent days…
        </div>
      ) : isError ? (
        <p className="py-6 text-sm text-ink-500">
          Couldn't load your pending days. You can close this and try again later.
        </p>
      ) : days.length === 0 ? (
        <p className="py-6 text-sm text-ink-500">You're all caught up. Nothing to fill.</p>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <div key={day.date} className="space-y-2">
              <h3 className="text-sm font-semibold text-ink-900">
                {format(parseISO(day.date), "EEE, dd MMM")}
              </h3>
              {day.groups.map((g) => (
                <SyllabusProgressGroup
                  key={`${g.class_id}|${g.subject_id}`}
                  classId={g.class_id}
                  subjectId={g.subject_id}
                  className={g.class_name}
                  subjectName={g.subject_name}
                  date={day.date}
                  source="checkin"
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </MobileSheet>
  );
}
```

- [ ] **Step 3: Verify:** `npm run typecheck` exit 0; `npx eslint src/components/lesson-completion/SyllabusProgressGroup.tsx src/components/lesson-completion/CheckInBacklogSheet.tsx` 0 errors.
- [ ] **Step 4: Commit** (`feat(lms): syllabus-progress group + check-in backlog sheet`).

---

## Task 6: Rework `CheckOutLessonGate` + `StaffCheckInCard` wiring

**Files:** Modify `src/components/lesson-completion/CheckOutLessonGate.tsx` (full replacement), Modify `src/components/attendance/StaffCheckInCard.tsx`

**Interfaces:** `CheckOutLessonGate` DROPS its `institutionId` prop → `{ open, onOpenChange, onComplete }`. StaffCheckInCard: check-in success (teachers) opens `CheckInBacklogSheet`.

- [ ] **Step 1: Replace the ENTIRE content of `CheckOutLessonGate.tsx`** with:

```tsx
import { useEffect, useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets";
import { useTeacherPendingSyllabusDays } from "@/hooks/useSyllabusProgress";
import { SyllabusProgressGroup } from "./SyllabusProgressGroup";

/**
 * Shown to teachers when they check out (staff attendance): one group per
 * (class, subject) taught today; every group needs ≥1 chapter entry
 * (Completed/Partial) before the actual check-out (onComplete) runs.
 * Dismissing cancels the check-out. Past days are handled by the non-blocking
 * CheckInBacklogSheet — nothing blocks login.
 */
export function CheckOutLessonGate({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => Promise<void> | void;
}) {
  const { data, isLoading, isError } = useTeacherPendingSyllabusDays({ includeToday: true, enabled: open });
  const [submitting, setSubmitting] = useState(false);

  // A day is listed only while ≥1 group is unfilled, so today absent from
  // `days` ⇒ everything's recorded (or there were no teaching periods today).
  const todayDay = data?.days.find((d) => d.is_today) ?? null;
  const groups = todayDay?.groups ?? [];
  const unfilledCount = groups.filter((g) => !g.filled).length;
  const canProceed = isError || (!isLoading && unfilledCount === 0);

  // The gate stays mounted; reset the submit latch when the sheet reopens or
  // the day changes.
  useEffect(() => {
    setSubmitting(false);
  }, [open, todayDay?.date]);

  const handleCheckOut = async () => {
    setSubmitting(true);
    try {
      await onComplete();
    } catch {
      // onComplete surfaces its own error toast; reset so the user can retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={(o) => { if (!submitting) onOpenChange(o); }}
      title="Before you check out"
      subtitle="Log today's syllabus progress"
      icon={<LogOut className="h-4 w-4" />}
      primaryAction={{ label: "Check out", onClick: handleCheckOut, disabled: !canProceed, loading: submitting }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: submitting }}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking today's classes…
        </div>
      ) : isError ? (
        <p className="py-6 text-sm text-ink-500">
          Couldn't confirm today's classes. You can still check out — you'll be asked to fill them next time.
        </p>
      ) : todayDay && groups.length > 0 ? (
        <div className="space-y-2">
          {groups.map((g) => (
            <SyllabusProgressGroup
              key={`${g.class_id}|${g.subject_id}`}
              classId={g.class_id}
              subjectId={g.subject_id}
              className={g.class_name}
              subjectName={g.subject_name}
              date={todayDay.date}
              source="checkout"
            />
          ))}
        </div>
      ) : (
        <p className="py-6 text-sm text-ink-500">Nothing to log today. You're all set.</p>
      )}
    </MobileSheet>
  );
}
```

- [ ] **Step 2: `StaffCheckInCard.tsx` edits** (four):

(a) Add import below the `CheckOutLessonGate` import:
```tsx
import { CheckInBacklogSheet } from "@/components/lesson-completion/CheckInBacklogSheet";
```

(b) Below `const [checkoutGateOpen, setCheckoutGateOpen] = useState(false);` add:
```tsx
  const [checkinBacklogOpen, setCheckinBacklogOpen] = useState(false);
```

(c) Check-in button — replace `onClick={() => checkIn.mutate({ institutionId, settings })}` with:
```tsx
              onClick={() =>
                checkIn.mutate(
                  { institutionId, settings },
                  { onSuccess: () => { if (isTeacher) setCheckinBacklogOpen(true); } },
                )
              }
```

(d) Update the checked-in branch's gate render — replace:
```tsx
      {isTeacher && (
        <CheckOutLessonGate
          open={checkoutGateOpen}
          onOpenChange={setCheckoutGateOpen}
          institutionId={institutionId}
          onComplete={async () => {
            await checkOut.mutateAsync(today.id);
            setCheckoutGateOpen(false);
          }}
        />
      )}
```
with:
```tsx
      {isTeacher && (
        <>
          <CheckOutLessonGate
            open={checkoutGateOpen}
            onOpenChange={setCheckoutGateOpen}
            onComplete={async () => {
              await checkOut.mutateAsync(today.id);
              setCheckoutGateOpen(false);
            }}
          />
          <CheckInBacklogSheet open={checkinBacklogOpen} onOpenChange={setCheckinBacklogOpen} />
        </>
      )}
```
AND wrap the final not-checked-in `return (…)` so the sheet is mounted there too (state survives the branch flip at the moment check-in succeeds) — change its outermost
```tsx
  return (
    <div className="surface-card frosted-shadow rounded-card p-5 sm:p-6">
```
to
```tsx
  return (
    <>
    <div className="surface-card frosted-shadow rounded-card p-5 sm:p-6">
```
and its closing
```tsx
    </div>
  );
}
```
to
```tsx
    </div>
    {isTeacher && <CheckInBacklogSheet open={checkinBacklogOpen} onOpenChange={setCheckinBacklogOpen} />}
    </>
  );
}
```
(the LAST return in the component — the "Mark your attendance" branch).

- [ ] **Step 3: Verify:** `npm run typecheck`; `npx eslint src/components/lesson-completion/CheckOutLessonGate.tsx src/components/attendance/StaffCheckInCard.tsx`; both clean.
- [ ] **Step 4: Commit** (`feat(lms): chapter-based check-out gate + check-in backlog popup`).

---

## Task 7: Remove login gate, add My Week chip, delete superseded files

**Files:** Modify `src/components/layout/ProtectedRoute.tsx`, Modify `src/pages/teacher/TeacherMyWeekPageV2.tsx`; Delete `src/components/lesson-completion/LoginLessonGate.tsx`, `src/components/lesson-completion/LessonCompletionRow.tsx`, `src/components/lesson-completion/LessonCompletionChecklist.tsx`, `src/hooks/useLessonCompletion.ts`

- [ ] **Step 1: `ProtectedRoute.tsx` — revert the login gate** (three edits):

(a) Delete these two import lines:
```tsx
import { useTeacherPendingLessonDays } from "@/hooks/useLessonCompletion";
import { LoginLessonGate } from "@/components/lesson-completion/LoginLessonGate";
```

(b) Delete this block (after the `useIsOlympiadOnlyInstitution` call):
```tsx
  const isTeacher = !!roleInfo?.isTeacher;
  const { data: pendingLessonData, isLoading: pendingLessonsLoading } = useTeacherPendingLessonDays({
    includeToday: false,
    enabled: isTeacher && !!user,
  });
  const pastLessonDays = pendingLessonData?.days ?? [];
```

(c) Restore the loading guard — replace
```tsx
  if (authLoading || roleLoading || (isTeacher && pendingLessonsLoading)) {
```
with
```tsx
  if (authLoading || roleLoading) {
```
and replace the final return block
```tsx
  // A teacher with past working days whose lessons were never logged is blocked
  // here (in place of the app, not via redirect, so refresh keeps them gated)
  // until they resolve them. Fail-open on a null institution — never trap them.
  if (isTeacher && pastLessonDays.length > 0 && roleInfo?.institutionId) {
    return <LoginLessonGate days={pastLessonDays} institutionId={roleInfo.institutionId} />;
  }

  return <AppLayout>{children}</AppLayout>;
```
with
```tsx
  return <AppLayout>{children}</AppLayout>;
```

- [ ] **Step 2: `TeacherMyWeekPageV2.tsx` — backlog chip** (three edits):

(a) Add imports (below the `LessonPlanDialogV2` import):
```tsx
import { useTeacherPendingSyllabusDays } from "@/hooks/useSyllabusProgress";
import { CheckInBacklogSheet } from "@/components/lesson-completion/CheckInBacklogSheet";
```

(b) Inside the component, below `const [planTarget, setPlanTarget] = useState<…>(null);` add:
```tsx
  // Passive backlog reminder — the non-blocking counterpart of the check-in popup.
  const pendingSyllabus = useTeacherPendingSyllabusDays({ includeToday: false });
  const backlogCount = pendingSyllabus.data?.unresolved_day_count ?? 0;
  const [backlogOpen, setBacklogOpen] = useState(false);
```

(c) In the header controls `div` (the one holding the month `Select` and the plans `Badge`), add BEFORE the `<Select …>`:
```tsx
          {backlogCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              onClick={() => setBacklogOpen(true)}
            >
              {backlogCount} day{backlogCount === 1 ? "" : "s"} unlogged
            </Button>
          )}
```
and at the bottom of the returned JSX (next to the `LessonPlanDialogV2` conditional, inside the outer wrapper `div`):
```tsx
      <CheckInBacklogSheet open={backlogOpen} onOpenChange={setBacklogOpen} />
```

- [ ] **Step 3: Delete superseded files:**
```bash
git rm src/components/lesson-completion/LoginLessonGate.tsx \
       src/components/lesson-completion/LessonCompletionRow.tsx \
       src/components/lesson-completion/LessonCompletionChecklist.tsx \
       src/hooks/useLessonCompletion.ts
```
- [ ] **Step 4: Grep for dangling imports** — `LoginLessonGate|LessonCompletionRow|LessonCompletionChecklist|useLessonCompletion|useTeacherPendingLessonDays|useMarkLessonCompletion|useSetChapterPacing|useChapterPacing` across `src/` must return ZERO matches.
- [ ] **Step 5: Verify:** `npm run typecheck`; `npx eslint src/components/layout/ProtectedRoute.tsx src/pages/teacher/TeacherMyWeekPageV2.tsx`; both clean.
- [ ] **Step 6: Commit** (`feat(lms): non-blocking backlog replaces login gate; retire per-period capture`).

---

## Task 8: Full verification + ship gate

- [ ] **Step 1:** `npm run typecheck` → exit 0.
- [ ] **Step 2:** `npx eslint src/hooks/useSyllabusProgress.ts src/components/lesson-completion/ src/components/attendance/StaffCheckInCard.tsx src/components/layout/ProtectedRoute.tsx src/pages/teacher/TeacherMyWeekPageV2.tsx` → 0 errors.
- [ ] **Step 3:** `npx vite build` → exit 0 (bundle-size warnings OK).
- [ ] **Step 4:** Scale-gate walk (state one-line verdicts): staleTime on all 2 new queries · RPCs bounded (60-day/LIMIT 30/zero-slot) · no select("*") · single-flight (record.isPending gates buttons; submit latch on gate) · dependent writes in ONE RPC · FK indexes in-migration · tri-clause RLS + explicit re-check in SECURITY DEFINER RPC · errors via toastError, error-before-empty in every surface.
- [ ] **Step 5:** Update `.superpowers/sdd/progress.md`, push branch. Merge to main only after the user smoke-tests (check-out flow, check-in popup, My Week chip).

**Phase 2 (separate plan): projection RPCs + My Week PeriodChip overlay + LessonPlanDialog Syllabus section + reorder sheet + student grid overlay.**
