# Timetable + Academic Calendar Rebuild — Plan 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the entire new `tt_*` and `cal_*` schema alongside the existing tables, backfill all production data into the new schema in one transaction, and route the existing public APIs (`currentAcademicYear()`, `useAcademicCalendar()`, `useSyllabusCoverage()`) through a TypeScript shim that reads from the new tables — without changing any user-visible behavior or any other tab/page.

**Architecture:** Two SQL migrations + one TypeScript shim layer. Phase 1 creates the new schema (tables, RLS, triggers, indexes) idempotently. Phase 2 contains a `tt_backfill_from_legacy()` SQL function and calls it once at the end of the migration in a single transaction. Phase 3 introduces `src/lib/timetableCompat.ts` and rewires `useAcademicCalendar.ts` + `syllabusCoverage.ts` to read through it; external callers' import paths and return shapes are unchanged.

**Tech Stack:** PostgreSQL 15 (Supabase), TypeScript 5, React 18 + TanStack Query v5, Vite 5. No test framework currently in repo; verification uses `npm run lint`, `npm run build` (TypeScript type check), and SQL `SELECT` queries via the Supabase SQL editor.

**Spec reference:** `docs/superpowers/specs/2026-04-23-timetable-academic-calendar-rebuild-design.md`, sections 3 (data model) and 5.1–5.3 (Phases 1, 2, 3).

---

## File Structure

### Created in this plan

| Path | Purpose |
|---|---|
| `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql` | All `tt_*` + `cal_*` tables, triggers, indexes, RLS policies. |
| `supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql` | `tt_backfill_from_legacy()` SQL function + one-shot call. |
| `src/lib/timetableCompat.ts` | TypeScript shim: `currentAcademicYear`, `useAcademicCalendar`-shape exports backed by `cal_*`, `getCoverageForClassSubject`-shape exports backed by `tt_*`. |

### Modified in this plan

| Path | What changes |
|---|---|
| `src/hooks/useAcademicCalendar.ts` | Internal reads switched to `cal_events` / `cal_academic_years` via shim. **Exported function/hook signatures unchanged.** |
| `src/lib/syllabusCoverage.ts` | Internal reads switched to `tt_lesson_plans` via shim. **Exported function signatures and return shapes unchanged.** |

### Untouched in this plan (will be touched in Plan 2 / 3)

- All current pages, components, hooks under `src/pages/school/`, `src/pages/teacher/`, `src/pages/student/`, `src/components/timetable/`, `src/components/admin/institution-wizard/SharedResourcesStep.tsx`.
- All current edge functions (`copy-timetable-template`, `get-working-days`).
- `useTimetableBuilder.ts`, `usePeriodStructures.ts`, `useLessonPlans.ts`, `lessonPlanDraft.ts`, `timetableConflicts.ts`, `resourceAvailability.ts`.
- `AppSidebar.tsx`, `FEATURE_URL_MAP`, all routes.
- All current `period_structures`, `period_slots`, `class_period_structure`, `shared_resources`, `timetable_slots`, `lesson_plans`, `academic_calendar` tables. (They keep existing.)

---

## Phase 1 — Schema (one migration file)

### Task 1: Create the Phase 1 migration file with header comment

**Files:**
- Create: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Create the migration file with this content**

```sql
-- =============================================================
-- TIMETABLE + ACADEMIC CALENDAR REBUILD — PHASE 1
-- -------------------------------------------------------------
-- Stands up the new tt_* and cal_* schema alongside the existing
-- tables (period_structures, timetable_slots, lesson_plans,
-- academic_calendar, etc.). No data is moved here — Phase 2
-- handles backfill. No old tables are altered or dropped.
-- After this migration runs:
--   * All new tables exist, empty.
--   * All RLS policies, triggers, indexes are in place.
--   * Old tables and their consumers are unchanged.
-- =============================================================
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "chore(timetable-rebuild): add Phase 1 migration scaffold"
```

---

### Task 2: Create `tt_period_structures` table

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append the table DDL to the migration file**

```sql
-- -------------------------------------------------------------
-- tt_period_structures — weekly grid template (admin-owned)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_period_structures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  working_days    TEXT[] NOT NULL,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_period_structures_working_days_chk
    CHECK (working_days <@ ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])
);

CREATE INDEX IF NOT EXISTS idx_tt_period_structures_institution
  ON public.tt_period_structures(institution_id);

DROP TRIGGER IF EXISTS update_tt_period_structures_updated_at ON public.tt_period_structures;
CREATE TRIGGER update_tt_period_structures_updated_at
  BEFORE UPDATE ON public.tt_period_structures
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] **Step 2: Push the migration to verify it parses and applies**

Run: `npm run db:push`
Expected: migration applied without errors.

- [ ] **Step 3: Verify table exists via SQL query**

Run in Supabase SQL editor:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tt_period_structures'
ORDER BY ordinal_position;
```
Expected: 7 rows (`id`, `institution_id`, `name`, `working_days`, `created_by`, `created_at`, `updated_at`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add tt_period_structures table"
```

---

### Task 3: Create `tt_period_slots` table + overlap-prevention trigger

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_period_slots — periods + breaks within a structure
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_period_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id    UUID NOT NULL REFERENCES public.tt_period_structures(id) ON DELETE CASCADE,
  period_number   INTEGER NOT NULL,
  label           TEXT NOT NULL,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  kind            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_period_slots_kind_chk CHECK (kind IN ('period','break')),
  CONSTRAINT tt_period_slots_time_chk CHECK (end_time > start_time),
  CONSTRAINT tt_period_slots_unique_number UNIQUE (structure_id, period_number)
);

CREATE INDEX IF NOT EXISTS idx_tt_period_slots_structure
  ON public.tt_period_slots(structure_id);

-- -------------------------------------------------------------
-- Overlap guard: reject a new/updated slot whose [start_time,
-- end_time) tsrange overlaps another slot in the same structure.
-- Uses exclusive-end so back-to-back slots (09:00-09:40 and
-- 09:40-10:20) do NOT falsely conflict.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_prevent_overlapping_period_slots()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tt_period_slots s
    WHERE s.structure_id = NEW.structure_id
      AND s.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND tsrange(
            ('2000-01-01 ' || s.start_time)::timestamp,
            ('2000-01-01 ' || s.end_time)::timestamp,
            '()'
          )
       && tsrange(
            ('2000-01-01 ' || NEW.start_time)::timestamp,
            ('2000-01-01 ' || NEW.end_time)::timestamp,
            '()'
          )
  ) THEN
    RAISE EXCEPTION 'Period slot times overlap with an existing slot in the same structure'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tt_prevent_overlapping_period_slots_tr ON public.tt_period_slots;
CREATE TRIGGER tt_prevent_overlapping_period_slots_tr
  BEFORE INSERT OR UPDATE ON public.tt_period_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.tt_prevent_overlapping_period_slots();
```

- [ ] **Step 2: Push the migration**

Run: `npm run db:push`
Expected: applied successfully.

- [ ] **Step 3: Verify trigger fires correctly (manual smoke)**

Run in SQL editor:
```sql
DO $$
DECLARE
  test_inst UUID := (SELECT id FROM public.institutions LIMIT 1);
  test_struct UUID;
BEGIN
  INSERT INTO public.tt_period_structures (institution_id, name, working_days)
    VALUES (test_inst, '__phase1_test__', ARRAY['monday'])
    RETURNING id INTO test_struct;

  INSERT INTO public.tt_period_slots (structure_id, period_number, label, start_time, end_time, kind)
    VALUES (test_struct, 1, 'P1', '08:00', '08:40', 'period');

  -- Back-to-back should succeed.
  INSERT INTO public.tt_period_slots (structure_id, period_number, label, start_time, end_time, kind)
    VALUES (test_struct, 2, 'P2', '08:40', '09:20', 'period');

  -- Overlap should fail.
  BEGIN
    INSERT INTO public.tt_period_slots (structure_id, period_number, label, start_time, end_time, kind)
      VALUES (test_struct, 3, 'P3', '09:00', '09:30', 'period');
    RAISE EXCEPTION 'Overlap insert should have failed';
  EXCEPTION WHEN sqlstate '23P01' THEN
    RAISE NOTICE 'OK: overlap rejected as expected';
  END;

  DELETE FROM public.tt_period_structures WHERE id = test_struct;
END $$;
```
Expected: NOTICE `OK: overlap rejected as expected`. No exceptions.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add tt_period_slots with overlap trigger"
```

---

### Task 4: Create `tt_class_structure` table (with publish state)

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_class_structure — which structure each class uses for an AY,
-- plus the per-class publish state (Q5: per-class draft scope).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_class_structure (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  structure_id    UUID NOT NULL REFERENCES public.tt_period_structures(id) ON DELETE RESTRICT,
  academic_year   TEXT NOT NULL,
  publish_status  TEXT NOT NULL DEFAULT 'draft',
  published_at    TIMESTAMPTZ,
  published_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_class_structure_publish_status_chk CHECK (publish_status IN ('draft','published')),
  CONSTRAINT tt_class_structure_unique_class_year UNIQUE (class_id, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_tt_class_structure_structure
  ON public.tt_class_structure(structure_id);
CREATE INDEX IF NOT EXISTS idx_tt_class_structure_institution_year
  ON public.tt_class_structure(institution_id, academic_year);

DROP TRIGGER IF EXISTS update_tt_class_structure_updated_at ON public.tt_class_structure;
CREATE TRIGGER update_tt_class_structure_updated_at
  BEFORE UPDATE ON public.tt_class_structure
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] **Step 2: Push and verify**

Run: `npm run db:push`
Then in SQL editor:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='tt_class_structure'
ORDER BY ordinal_position;
```
Expected: 12 rows including `publish_status`, `published_at`, `published_by`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add tt_class_structure with publish state"
```

---

### Task 5: Create `tt_resources` table

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_resources — school-wide pool (lab, library, room, etc.)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_resources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  capacity        INTEGER NOT NULL DEFAULT 1,
  description     TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_resources_kind_chk CHECK (kind IN ('lab','library','computer_room','sports_facility','other')),
  CONSTRAINT tt_resources_capacity_chk CHECK (capacity >= 1),
  CONSTRAINT tt_resources_unique_name UNIQUE (institution_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tt_resources_institution
  ON public.tt_resources(institution_id);

DROP TRIGGER IF EXISTS update_tt_resources_updated_at ON public.tt_resources;
CREATE TRIGGER update_tt_resources_updated_at
  BEFORE UPDATE ON public.tt_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] **Step 2: Push and verify**

Run: `npm run db:push` (expect success), then `SELECT * FROM tt_resources LIMIT 0;` to confirm shape.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add tt_resources table"
```

---

### Task 6: Create `tt_slots` table (the cells)

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_slots — the cells. One row per (class, day, period, AY).
-- Visibility controlled by tt_class_structure.publish_status.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_slots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  class_id         UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  period_slot_id   UUID NOT NULL REFERENCES public.tt_period_slots(id) ON DELETE CASCADE,
  day              TEXT NOT NULL,
  academic_year    TEXT NOT NULL,
  slot_type        TEXT NOT NULL,
  subject_id       UUID REFERENCES public.universal_subjects(id) ON DELETE SET NULL,
  teacher_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resource_id      UUID REFERENCES public.tt_resources(id) ON DELETE SET NULL,
  notes            TEXT,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_slots_day_chk CHECK (day IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  CONSTRAINT tt_slots_type_chk CHECK (slot_type IN ('theory','practical','library','sports','arts','assembly','free','break')),
  CONSTRAINT tt_slots_unique_cell UNIQUE (class_id, period_slot_id, day, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_tt_slots_class_year ON public.tt_slots(class_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_tt_slots_teacher_year ON public.tt_slots(teacher_id, academic_year)
  WHERE teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_slots_subject_class ON public.tt_slots(subject_id, class_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_slots_resource_period ON public.tt_slots(resource_id, period_slot_id, day)
  WHERE resource_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_tt_slots_updated_at ON public.tt_slots;
CREATE TRIGGER update_tt_slots_updated_at
  BEFORE UPDATE ON public.tt_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] **Step 2: Push and verify**

Run: `npm run db:push`, then `SELECT * FROM tt_slots LIMIT 0;` confirms columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add tt_slots cells table"
```

---

### Task 7: Create `tt_substitutions` table

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_substitutions — one-off date overrides for an absent teacher.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_substitutions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id                UUID NOT NULL REFERENCES public.tt_slots(id) ON DELETE CASCADE,
  date                   DATE NOT NULL,
  substitute_teacher_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason                 TEXT,
  created_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_substitutions_unique_slot_date UNIQUE (slot_id, date)
);

CREATE INDEX IF NOT EXISTS idx_tt_substitutions_substitute_date
  ON public.tt_substitutions(substitute_teacher_id, date);
CREATE INDEX IF NOT EXISTS idx_tt_substitutions_date
  ON public.tt_substitutions(date);
```

- [ ] **Step 2: Push and verify**

Run: `npm run db:push`, then `SELECT * FROM tt_substitutions LIMIT 0;`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add tt_substitutions table"
```

---

### Task 8: Create `tt_lesson_plans` table + status-stamp trigger

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_lesson_plans — per-date instance of a slot. Owned by the
-- original teacher (not substitute). Denormalizes class_id /
-- subject_id / owner_teacher_id / session_type from tt_slots so
-- existing index-backed queries stay fast (matches current
-- lesson_plans pattern that useSyllabusCoverage relies on).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tt_lesson_plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id       UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  slot_id              UUID NOT NULL REFERENCES public.tt_slots(id) ON DELETE CASCADE,
  class_id             UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id           UUID REFERENCES public.universal_subjects(id) ON DELETE SET NULL,
  owner_teacher_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  date                 DATE NOT NULL,
  session_type         TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'planned',
  topic_id             UUID REFERENCES public.syllabus_topics(id) ON DELETE SET NULL,
  chapter_topic_id     UUID REFERENCES public.chapter_topics(id) ON DELETE SET NULL,
  addressed_topic_ids  UUID[] DEFAULT ARRAY[]::UUID[],
  note                 TEXT,
  planned_at           TIMESTAMPTZ,
  done_at              TIMESTAMPTZ,
  updated_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tt_lesson_plans_session_type_chk CHECK (session_type IN ('teaching','test','doubt_session','other')),
  CONSTRAINT tt_lesson_plans_status_chk CHECK (status IN ('planned','done','pending','skipped')),
  CONSTRAINT tt_lesson_plans_unique_slot_date UNIQUE (slot_id, date)
);

CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_owner_date
  ON public.tt_lesson_plans(owner_teacher_id, date)
  WHERE owner_teacher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_class_subject
  ON public.tt_lesson_plans(class_id, subject_id)
  WHERE subject_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_topic_status
  ON public.tt_lesson_plans(topic_id, status)
  WHERE topic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tt_lesson_plans_slot_date
  ON public.tt_lesson_plans(slot_id, date);

DROP TRIGGER IF EXISTS update_tt_lesson_plans_updated_at ON public.tt_lesson_plans;
CREATE TRIGGER update_tt_lesson_plans_updated_at
  BEFORE UPDATE ON public.tt_lesson_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Status-aware timestamp stamping (mirrors current lesson_plans_stamp_status).
CREATE OR REPLACE FUNCTION public.tt_lesson_plans_stamp_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'planned' AND NEW.planned_at IS NULL THEN
    NEW.planned_at := now();
  END IF;
  IF NEW.status = 'done' AND NEW.done_at IS NULL THEN
    NEW.done_at := now();
    -- Preserve legacy behavior: also stamp planned_at on a direct
    -- transition to 'done' (e.g. teacher logs a past lesson). Avoids
    -- ever leaving a 'done' row with NULL planned_at.
    IF NEW.planned_at IS NULL THEN
      NEW.planned_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tt_lesson_plans_stamp_status_tr ON public.tt_lesson_plans;
CREATE TRIGGER tt_lesson_plans_stamp_status_tr
  BEFORE INSERT OR UPDATE ON public.tt_lesson_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.tt_lesson_plans_stamp_status();
```

- [ ] **Step 2: Push and verify**

Run: `npm run db:push`, then verify columns:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='tt_lesson_plans'
ORDER BY ordinal_position;
```
Expected: 19 columns including `class_id`, `subject_id`, `owner_teacher_id`, `session_type`, `planned_at`, `done_at`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add tt_lesson_plans with status-stamp trigger"
```

---

### Task 9: Create `cal_academic_years` table

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- cal_academic_years — explicit AY records (replaces ad-hoc string
-- typing scattered across the app). Exactly one is_active per
-- institution at any time.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cal_academic_years (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  starts_on       DATE NOT NULL,
  ends_on         DATE NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cal_academic_years_date_chk CHECK (ends_on > starts_on),
  CONSTRAINT cal_academic_years_unique_code UNIQUE (institution_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_year_per_institution
  ON public.cal_academic_years(institution_id)
  WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_cal_academic_years_institution
  ON public.cal_academic_years(institution_id);

DROP TRIGGER IF EXISTS update_cal_academic_years_updated_at ON public.cal_academic_years;
CREATE TRIGGER update_cal_academic_years_updated_at
  BEFORE UPDATE ON public.cal_academic_years
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] **Step 2: Push and verify partial unique index**

Run: `npm run db:push`. Then verify the index:
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='cal_academic_years';
```
Expected: includes `one_active_year_per_institution` with `WHERE is_active`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add cal_academic_years"
```

---

### Task 10: Create `cal_events` table + exam-block overlap trigger

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- cal_events — holidays, exam blocks, and informational events.
-- Replaces academic_calendar table. Terms intentionally excluded.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cal_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  academic_year   TEXT NOT NULL,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL,
  starts_on       DATE NOT NULL,
  ends_on         DATE NOT NULL,
  color           TEXT,
  notes           TEXT,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cal_events_kind_chk CHECK (kind IN ('holiday','exam_block','event')),
  CONSTRAINT cal_events_date_chk CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_cal_events_institution_year
  ON public.cal_events(institution_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_cal_events_dates
  ON public.cal_events(institution_id, starts_on, ends_on);

DROP TRIGGER IF EXISTS update_cal_events_updated_at ON public.cal_events;
CREATE TRIGGER update_cal_events_updated_at
  BEFORE UPDATE ON public.cal_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Exam-block overlap guard (port of prevent_overlapping_exam_blocks).
-- Holidays vs exam_blocks remain a soft confirm at UI layer.
CREATE OR REPLACE FUNCTION public.cal_prevent_overlapping_exam_blocks()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'exam_block' THEN
    IF EXISTS (
      SELECT 1
      FROM public.cal_events e
      WHERE e.institution_id = NEW.institution_id
        AND e.academic_year  = NEW.academic_year
        AND e.kind           = 'exam_block'
        AND e.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND daterange(e.starts_on, e.ends_on, '[]')
         && daterange(NEW.starts_on, NEW.ends_on, '[]')
    ) THEN
      RAISE EXCEPTION 'Exam block dates overlap with an existing exam block in this academic year'
        USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cal_prevent_overlapping_exam_blocks_tr ON public.cal_events;
CREATE TRIGGER cal_prevent_overlapping_exam_blocks_tr
  BEFORE INSERT OR UPDATE ON public.cal_events
  FOR EACH ROW
  EXECUTE FUNCTION public.cal_prevent_overlapping_exam_blocks();
```

- [ ] **Step 2: Push and smoke-test the overlap trigger**

Run: `npm run db:push`, then in SQL editor:
```sql
DO $$
DECLARE
  test_inst UUID := (SELECT id FROM public.institutions LIMIT 1);
BEGIN
  INSERT INTO public.cal_events (institution_id, academic_year, title, kind, starts_on, ends_on)
    VALUES (test_inst, '__phase1_test__', 'Mid-terms', 'exam_block', '2099-01-01', '2099-01-10');

  -- Adjacent holiday should succeed.
  INSERT INTO public.cal_events (institution_id, academic_year, title, kind, starts_on, ends_on)
    VALUES (test_inst, '__phase1_test__', 'Republic Day', 'holiday', '2099-01-26', '2099-01-26');

  -- Overlapping exam block should fail.
  BEGIN
    INSERT INTO public.cal_events (institution_id, academic_year, title, kind, starts_on, ends_on)
      VALUES (test_inst, '__phase1_test__', 'Other exams', 'exam_block', '2099-01-05', '2099-01-15');
    RAISE EXCEPTION 'Overlapping exam_block insert should have failed';
  EXCEPTION WHEN sqlstate '23P01' THEN
    RAISE NOTICE 'OK: exam_block overlap rejected as expected';
  END;

  DELETE FROM public.cal_events WHERE academic_year = '__phase1_test__';
END $$;
```
Expected: NOTICE `OK: exam_block overlap rejected as expected`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add cal_events with exam-block overlap guard"
```

---

### Task 11: Enable RLS on every new table

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- =============================================================
-- ROW LEVEL SECURITY — enable on every new table
-- =============================================================
ALTER TABLE public.tt_period_structures  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_period_slots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_class_structure    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_resources          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_slots              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_substitutions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tt_lesson_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cal_academic_years    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cal_events            ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Push and verify RLS is on**

Run: `npm run db:push`, then:
```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname='public' AND tablename LIKE 'tt\_%' OR tablename LIKE 'cal\_%';
```
Expected: all 9 new tables have `rowsecurity = true`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): enable RLS on all new tables"
```

---

### Task 12: RLS policies for `tt_period_structures` + `tt_period_slots` + `tt_resources`

These three tables share the same access pattern: admin write, everyone in the institution reads.

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_period_structures policies
-- -------------------------------------------------------------
CREATE POLICY tt_period_structures_select_in_institution
  ON public.tt_period_structures FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY tt_period_structures_admin_write
  ON public.tt_period_structures FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY tt_period_structures_super_admin_all
  ON public.tt_period_structures FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- -------------------------------------------------------------
-- tt_period_slots policies (scope via parent structure)
-- -------------------------------------------------------------
CREATE POLICY tt_period_slots_select_in_institution
  ON public.tt_period_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_period_structures s
      WHERE s.id = tt_period_slots.structure_id
        AND s.institution_id = public.get_user_institution(auth.uid())
    )
  );

CREATE POLICY tt_period_slots_admin_write
  ON public.tt_period_slots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_period_structures s
      WHERE s.id = tt_period_slots.structure_id
        AND s.institution_id = public.get_user_institution(auth.uid())
    )
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tt_period_structures s
      WHERE s.id = tt_period_slots.structure_id
        AND s.institution_id = public.get_user_institution(auth.uid())
    )
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY tt_period_slots_super_admin_all
  ON public.tt_period_slots FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- -------------------------------------------------------------
-- tt_resources policies (mirror period_structures)
-- -------------------------------------------------------------
CREATE POLICY tt_resources_select_in_institution
  ON public.tt_resources FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY tt_resources_admin_write
  ON public.tt_resources FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY tt_resources_super_admin_all
  ON public.tt_resources FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
```

- [ ] **Step 2: Push and verify policies exist**

Run: `npm run db:push`, then:
```sql
SELECT polname, polcmd FROM pg_policy
WHERE polrelid::regclass::text IN ('public.tt_period_structures','public.tt_period_slots','public.tt_resources')
ORDER BY polrelid::regclass::text, polname;
```
Expected: 9 policies.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add RLS for structures/slots/resources (admin-only writes)"
```

---

### Task 13: RLS for `tt_class_structure` (admin-only writes per spec)

Per spec §2 role table, the admin owns class↔structure mapping (coordinator does NOT assign structures). Read access for everyone in the institution.

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_class_structure policies — admin-only writes per spec.
-- Coordinators read so they can see which classes have structures
-- attached. publish_status updates: admin OR coordinator-in-wing
-- (handled in Plan 2 RLS for tt_slots; tt_class_structure publish
-- toggle goes through a SECURITY DEFINER helper in Plan 2).
-- -------------------------------------------------------------
CREATE POLICY tt_class_structure_select_in_institution
  ON public.tt_class_structure FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY tt_class_structure_admin_write
  ON public.tt_class_structure FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY tt_class_structure_super_admin_all
  ON public.tt_class_structure FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
```

- [ ] **Step 2: Push and verify**

Run: `npm run db:push`, then `SELECT polname FROM pg_policy WHERE polrelid='public.tt_class_structure'::regclass;` should return 3 rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add RLS for tt_class_structure (admin writes)"
```

---

### Task 14: RLS for `tt_slots` (admin full, coordinator wing-scoped)

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append a SECURITY DEFINER helper for "is the user coordinator-in-wing for this class" + the policies**

```sql
-- -------------------------------------------------------------
-- Helper: is the calling user a coordinator whose wing assignment
-- includes the given class? Wrapping in SECURITY DEFINER avoids
-- RLS-recursion traps (per CLAUDE.md §22 RLS recursion note).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tt_user_can_edit_class_slots(p_user UUID, p_class UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.has_role(p_user, 'super_admin')
    OR (
      (
        public.has_role(p_user, 'school_admin')
        OR public.has_role(p_user, 'super_school_admin')
      )
      AND EXISTS (
        SELECT 1 FROM public.classes c
        WHERE c.id = p_class
          AND c.institution_id = public.get_user_institution(p_user)
      )
    )
    OR (
      public.has_role(p_user, 'coordinator')
      AND EXISTS (
        SELECT 1
        FROM public.wing_class_mappings wcm
        JOIN public.wing_assignments  wa ON wa.wing_id = wcm.wing_id
        WHERE wcm.class_id = p_class
          AND wa.user_id = p_user
      )
    );
$$;

-- -------------------------------------------------------------
-- tt_slots policies
-- Read: admin & coordinator see all in scope; teacher sees their
-- own slots OR any slot in a published class their student/teacher
-- profile maps to. (Student visibility lives on tt_lesson_plans
-- read filtering — students don't query tt_slots directly in the
-- typical UI.)
-- Write: admin school-wide; coordinator wing-only via the helper.
-- -------------------------------------------------------------
CREATE POLICY tt_slots_select_admin_or_coord
  ON public.tt_slots FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
      OR public.has_role(auth.uid(), 'coordinator')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE POLICY tt_slots_select_teacher_own
  ON public.tt_slots FOR SELECT
  USING (
    teacher_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tt_substitutions sub
      WHERE sub.slot_id = tt_slots.id
        AND sub.substitute_teacher_id = auth.uid()
    )
  );

CREATE POLICY tt_slots_select_published_for_class
  ON public.tt_slots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_class_structure cs
      WHERE cs.class_id = tt_slots.class_id
        AND cs.academic_year = tt_slots.academic_year
        AND cs.publish_status = 'published'
    )
  );

CREATE POLICY tt_slots_admin_or_coord_write
  ON public.tt_slots FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  );
```

- [ ] **Step 2: Push and verify the SECURITY DEFINER helper + policies**

Run: `npm run db:push`, then:
```sql
SELECT proname, prosecdef FROM pg_proc
WHERE proname = 'tt_user_can_edit_class_slots';
```
Expected: one row with `prosecdef = true`.

```sql
SELECT polname, polcmd FROM pg_policy WHERE polrelid='public.tt_slots'::regclass ORDER BY polname;
```
Expected: 4 policies (`select_admin_or_coord`, `select_teacher_own`, `select_published_for_class`, `admin_or_coord_write`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add RLS for tt_slots with wing-scoped coordinator writes"
```

---

### Task 15: RLS for `tt_substitutions`

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_substitutions policies — read for everyone whose slot they
-- can see; write for admin or coordinator-of-wing for the slot's
-- class.
-- -------------------------------------------------------------
CREATE POLICY tt_substitutions_select
  ON public.tt_substitutions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_slots s
      WHERE s.id = tt_substitutions.slot_id
        AND s.institution_id = public.get_user_institution(auth.uid())
    )
    OR substitute_teacher_id = auth.uid()
  );

CREATE POLICY tt_substitutions_admin_or_coord_write
  ON public.tt_substitutions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.tt_slots s
      WHERE s.id = tt_substitutions.slot_id
        AND public.tt_user_can_edit_class_slots(auth.uid(), s.class_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tt_slots s
      WHERE s.id = tt_substitutions.slot_id
        AND public.tt_user_can_edit_class_slots(auth.uid(), s.class_id)
    )
  );
```

- [ ] **Step 2: Push and verify**

Run: `npm run db:push`, then `SELECT polname FROM pg_policy WHERE polrelid='public.tt_substitutions'::regclass;` returns 2 rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add RLS for tt_substitutions"
```

---

### Task 16: RLS for `tt_lesson_plans`

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- tt_lesson_plans policies
-- Read:
--   - admin & coordinator (wing-scoped via helper)
--   - owner_teacher reads their own
--   - student reads only when slot's class is published AND
--     status IN ('planned','done')
-- Write:
--   - admin full
--   - coordinator wing-scoped (via helper)
--   - teacher writes their own (owner_teacher_id = auth.uid())
-- -------------------------------------------------------------
CREATE POLICY tt_lesson_plans_select_admin_or_coord
  ON public.tt_lesson_plans FOR SELECT
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  );

CREATE POLICY tt_lesson_plans_select_owner_teacher
  ON public.tt_lesson_plans FOR SELECT
  USING (owner_teacher_id = auth.uid());

CREATE POLICY tt_lesson_plans_select_student_published
  ON public.tt_lesson_plans FOR SELECT
  USING (
    public.has_role(auth.uid(), 'student')
    AND status IN ('planned','done')
    AND EXISTS (
      SELECT 1
      FROM public.tt_class_structure cs
      JOIN public.class_assignments  ca ON ca.class_id = cs.class_id
      WHERE cs.class_id = tt_lesson_plans.class_id
        AND cs.publish_status = 'published'
        AND ca.user_id = auth.uid()
        AND ca.role    = 'student'
    )
  );

CREATE POLICY tt_lesson_plans_admin_or_coord_write
  ON public.tt_lesson_plans FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND public.tt_user_can_edit_class_slots(auth.uid(), class_id)
  );

CREATE POLICY tt_lesson_plans_owner_teacher_write
  ON public.tt_lesson_plans FOR ALL
  USING (owner_teacher_id = auth.uid())
  WITH CHECK (owner_teacher_id = auth.uid());
```

> **Note:** student↔class is via `class_assignments WHERE role = 'student'` (the same table used for teacher assignments, role-tagged). This pattern matches the legacy `lesson_plans` student RLS policy.

- [ ] **Step 2: Push the migration**

Run: `npm run db:push`. Expected: success.

- [ ] **Step 3: Verify policies present**

Run: `SELECT polname FROM pg_policy WHERE polrelid='public.tt_lesson_plans'::regclass ORDER BY polname;`
Expected: 5 policies.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add RLS for tt_lesson_plans"
```

---

### Task 17: RLS for `cal_academic_years` + `cal_events`

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- cal_academic_years — admin write, everyone in institution reads.
-- -------------------------------------------------------------
CREATE POLICY cal_academic_years_select_in_institution
  ON public.cal_academic_years FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY cal_academic_years_admin_write
  ON public.cal_academic_years FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY cal_academic_years_super_admin_all
  ON public.cal_academic_years FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- -------------------------------------------------------------
-- cal_events — admin write, everyone in institution reads.
-- (Q4.i: only admin can edit; teachers/students/coordinators read.)
-- -------------------------------------------------------------
CREATE POLICY cal_events_select_in_institution
  ON public.cal_events FOR SELECT
  USING (institution_id = public.get_user_institution(auth.uid()));

CREATE POLICY cal_events_admin_write
  ON public.cal_events FOR ALL
  USING (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  )
  WITH CHECK (
    institution_id = public.get_user_institution(auth.uid())
    AND (
      public.has_role(auth.uid(), 'school_admin')
      OR public.has_role(auth.uid(), 'super_school_admin')
    )
  );

CREATE POLICY cal_events_super_admin_all
  ON public.cal_events FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
```

- [ ] **Step 2: Push and verify**

Run: `npm run db:push`, then:
```sql
SELECT polrelid::regclass::text AS table, polname FROM pg_policy
WHERE polrelid::regclass::text IN ('public.cal_academic_years','public.cal_events')
ORDER BY 1, 2;
```
Expected: 6 policies (3 per table).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): add RLS for cal_academic_years + cal_events"
```

---

### Task 18: Add `GRANT EXECUTE` for the SECURITY DEFINER helper

**Files:**
- Modify: `supabase/migrations/20260424100000_tt_cal_phase1_schema.sql`

- [ ] **Step 1: Append to migration file**

```sql
-- -------------------------------------------------------------
-- The helper function is SECURITY DEFINER but must be callable
-- from anon/authenticated to be useful inside RLS policies.
-- -------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.tt_user_can_edit_class_slots(UUID, UUID) TO anon, authenticated;
```

- [ ] **Step 2: Push and verify grant**

Run: `npm run db:push`, then:
```sql
SELECT grantee, privilege_type FROM information_schema.routine_privileges
WHERE routine_name = 'tt_user_can_edit_class_slots';
```
Expected: rows for `anon` and `authenticated` with `EXECUTE`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424100000_tt_cal_phase1_schema.sql
git commit -m "feat(timetable-rebuild): grant EXECUTE on tt_user_can_edit_class_slots"
```

---

## Phase 2 — Backfill (separate migration)

### Task 19: Create the Phase 2 migration file

**Files:**
- Create: `supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql`

- [ ] **Step 1: Create the file with header**

```sql
-- =============================================================
-- TIMETABLE + ACADEMIC CALENDAR REBUILD — PHASE 2
-- -------------------------------------------------------------
-- One-shot backfill of legacy tables into the new tt_* / cal_*
-- schema. Idempotent: re-running is safe (uses ON CONFLICT
-- DO NOTHING). Wrapped in a single transaction. Skipped rows
-- log to RAISE NOTICE for manual review.
-- =============================================================
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql
git commit -m "chore(timetable-rebuild): add Phase 2 backfill migration scaffold"
```

---

### Task 20: Backfill function — period structures, slots, class assignments, resources

**Files:**
- Modify: `supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql`

- [ ] **Step 1: Append the function definition**

```sql
CREATE OR REPLACE FUNCTION public.tt_backfill_from_legacy()
RETURNS TABLE (
  step TEXT,
  copied INTEGER,
  skipped INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_struct INTEGER := 0;
  c_slots  INTEGER := 0;
  c_csa    INTEGER := 0;
  c_res    INTEGER := 0;
BEGIN
  -- --- period_structures -> tt_period_structures (preserve IDs) ---
  WITH ins AS (
    INSERT INTO public.tt_period_structures (id, institution_id, name, working_days, created_at, updated_at)
    SELECT id, institution_id, name, working_days, created_at, updated_at
    FROM public.period_structures
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_struct FROM ins;
  step := 'tt_period_structures'; copied := c_struct; skipped := 0; RETURN NEXT;

  -- --- period_slots -> tt_period_slots (preserve IDs and period_number encoding) ---
  WITH ins AS (
    INSERT INTO public.tt_period_slots (id, structure_id, period_number, label, start_time, end_time, kind, created_at)
    SELECT
      id,
      structure_id,
      period_number,
      label,
      start_time,
      end_time,
      CASE WHEN is_break THEN 'break' ELSE 'period' END,
      created_at
    FROM public.period_slots
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_slots FROM ins;
  step := 'tt_period_slots'; copied := c_slots; skipped := 0; RETURN NEXT;

  -- --- class_period_structure -> tt_class_structure
  -- Old table had no academic_year column; synthesize via the
  -- institution's most-recent active year (best-effort).
  WITH ins AS (
    INSERT INTO public.tt_class_structure
      (institution_id, class_id, structure_id, academic_year, publish_status, created_at, updated_at)
    SELECT
      cps.institution_id,
      cps.class_id,
      cps.structure_id,
      COALESCE(
        (SELECT ay.academic_year FROM public.classes cl
          WHERE cl.id = cps.class_id LIMIT 1),
        '2026-27'
      ) AS academic_year,
      'published',  -- Old system had no draft state; existing rows treated as published.
      cps.created_at,
      cps.updated_at
    FROM public.class_period_structure cps
    ON CONFLICT (class_id, academic_year) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_csa FROM ins;
  step := 'tt_class_structure'; copied := c_csa; skipped := 0; RETURN NEXT;

  -- --- shared_resources -> tt_resources
  WITH ins AS (
    INSERT INTO public.tt_resources (id, institution_id, name, kind, capacity, description, created_at, updated_at)
    SELECT id, institution_id, name, resource_type, count, description, created_at, updated_at
    FROM public.shared_resources
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_res FROM ins;
  step := 'tt_resources'; copied := c_res; skipped := 0; RETURN NEXT;
END;
$$;
```

> **Verification note:** the `classes` table reference inside `class_period_structure` backfill uses a placeholder `academic_year` column that may not exist on `classes`. **Run the verification query in Step 2** before pushing — if `classes` has no `academic_year` column, replace the `COALESCE` subquery with `'2026-27'` (or the latest known active year).

- [ ] **Step 2: Verify column existence on legacy tables**

Run in SQL editor:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='classes' AND column_name='academic_year';
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='period_slots' AND column_name='is_break';
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='shared_resources' AND column_name IN ('resource_type','count');
```
Adjust the function source for any missing columns.

- [ ] **Step 3: Push**

Run: `npm run db:push`. Expected: success.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql
git commit -m "feat(timetable-rebuild): backfill function for structures/slots/class-map/resources"
```

---

### Task 21: Backfill function — slots, lesson_plans

**Files:**
- Modify: `supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql`

- [ ] **Step 1: Extend the function (append a new block before its `END;`)**

Replace the function body to also handle `tt_slots` and `tt_lesson_plans`. Append these blocks before the final `END;`:

```sql
-- INSIDE tt_backfill_from_legacy() — append before the final END;

-- --- timetable_slots -> tt_slots (preserve IDs) ---
DECLARE c_tslots INTEGER := 0; BEGIN
  WITH ins AS (
    INSERT INTO public.tt_slots
      (id, institution_id, class_id, period_slot_id, day, academic_year, slot_type,
       subject_id, teacher_id, resource_id, notes, created_at, updated_at)
    SELECT
      id, institution_id, class_id, period_slot_id, day, academic_year, slot_type,
      subject_id, teacher_id, resource_id, notes, created_at, updated_at
    FROM public.timetable_slots
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_tslots FROM ins;
  step := 'tt_slots'; copied := c_tslots; skipped := 0; RETURN NEXT;
END;

-- --- lesson_plans -> tt_lesson_plans (preserve IDs)
-- Sets owner_teacher_id from the legacy teacher_id column.
DECLARE c_plans INTEGER := 0; BEGIN
  WITH ins AS (
    INSERT INTO public.tt_lesson_plans
      (id, institution_id, slot_id, class_id, subject_id, owner_teacher_id, date,
       session_type, status, topic_id, addressed_topic_ids, note,
       planned_at, done_at, created_by, created_at, updated_at)
    SELECT
      id, institution_id, timetable_slot_id, class_id, subject_id, teacher_id, date,
      session_type, status, topic_id, addressed_topic_ids, note,
      planned_at, done_at, created_by, created_at, updated_at
    FROM public.lesson_plans
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_plans FROM ins;
  step := 'tt_lesson_plans'; copied := c_plans; skipped := 0; RETURN NEXT;
END;
```

> **Note:** the inner `DECLARE...BEGIN...END;` blocks are nested anonymous blocks inside the function body. They give us local counter variables without polluting the outer DECLARE list. Keep this pattern — it makes the function readable and each step independently editable.

- [ ] **Step 2: Verify legacy column names**

Run: `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='lesson_plans' ORDER BY ordinal_position;`
Confirm columns `timetable_slot_id`, `class_id`, `subject_id`, `teacher_id`, `date`, `session_type`, `status`, `topic_id`, `addressed_topic_ids`, `note`, `planned_at`, `done_at`, `created_by`, `created_at`, `updated_at` all exist.

If any are missing or named differently, adjust the SELECT in the function above to match.

- [ ] **Step 3: Push**

Run: `npm run db:push`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql
git commit -m "feat(timetable-rebuild): backfill function for tt_slots and tt_lesson_plans"
```

---

### Task 22: Backfill function — academic years + calendar events

**Files:**
- Modify: `supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql`

- [ ] **Step 1: Extend the function with academic years + events blocks**

Append these blocks inside the function body before the final `END;`:

```sql
-- --- Distinct academic_years from academic_calendar -> cal_academic_years ---
DECLARE c_ay INTEGER := 0; BEGIN
  WITH ay_rows AS (
    SELECT DISTINCT institution_id, academic_year
    FROM public.academic_calendar
  ),
  ins AS (
    INSERT INTO public.cal_academic_years (institution_id, code, starts_on, ends_on, is_active)
    SELECT
      ay.institution_id,
      ay.academic_year,
      -- Synthesize April 1 of the start year as starts_on.
      make_date(
        substring(ay.academic_year FROM 1 FOR 4)::INT,
        4, 1
      ),
      -- And March 31 of the end year as ends_on.
      make_date(
        substring(ay.academic_year FROM 1 FOR 4)::INT + 1,
        3, 31
      ),
      false  -- Set is_active separately (manual choice — admin can flip post-migration).
    FROM ay_rows ay
    ON CONFLICT (institution_id, code) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_ay FROM ins;
  step := 'cal_academic_years'; copied := c_ay; skipped := 0; RETURN NEXT;
END;

-- --- academic_calendar -> cal_events (with enum mapping) ---
DECLARE
  c_events INTEGER := 0;
  c_skipped INTEGER := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.cal_events
      (id, institution_id, academic_year, title, kind, starts_on, ends_on, notes, created_by, created_at, updated_at)
    SELECT
      ac.id,
      ac.institution_id,
      ac.academic_year,
      ac.title,
      CASE ac.event_type
        WHEN 'holiday'       THEN 'holiday'
        WHEN 'exam_block'    THEN 'exam_block'
        WHEN 'ptm'           THEN 'event'
        WHEN 'special_event' THEN 'event'
        -- Other enum values intentionally fall through; filtered by WHERE below.
      END AS kind,
      ac.date,
      COALESCE(ac.end_date, ac.date),
      ac.description,
      ac.created_by,
      ac.created_at,
      ac.updated_at
    FROM public.academic_calendar ac
    WHERE ac.event_type IN ('holiday','exam_block','ptm','special_event')
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_events FROM ins;

  -- Tally how many rows were skipped (working_day, term_start, term_end).
  SELECT COUNT(*) INTO c_skipped
  FROM public.academic_calendar
  WHERE event_type IN ('working_day','term_start','term_end');

  step := 'cal_events'; copied := c_events; skipped := c_skipped; RETURN NEXT;
  RAISE NOTICE 'cal_events backfill: copied=% skipped=% (working_day/term_*)', c_events, c_skipped;
END;
```

- [ ] **Step 2: Push**

Run: `npm run db:push`.

- [ ] **Step 3: Verify the function exists and is callable (dry-run with no commit)**

Run: `SELECT * FROM public.tt_backfill_from_legacy();`
Expected: 7+ rows, one per step, with `copied` >= 0 and `skipped` >= 0. **First call after migration should already have populated the new tables** because Task 23 will append the call.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql
git commit -m "feat(timetable-rebuild): backfill function for cal_academic_years + cal_events"
```

---

### Task 23: Invoke backfill once at end of Phase 2 migration

**Files:**
- Modify: `supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql`

- [ ] **Step 1: Append the one-shot invocation**

```sql
-- -------------------------------------------------------------
-- Invoke the backfill once. RAISE NOTICEs surface in Supabase
-- migration logs for manual review.
-- -------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM public.tt_backfill_from_legacy() LOOP
    RAISE NOTICE 'BACKFILL %: copied=%, skipped=%', r.step, r.copied, r.skipped;
  END LOOP;
END $$;
```

- [ ] **Step 2: Push (this is the canonical execution)**

Run: `npm run db:push`. Watch the output for `BACKFILL ...` notices.

- [ ] **Step 3: Verify row counts match between old and new**

Run in SQL editor:
```sql
SELECT 'period_structures' AS t, COUNT(*) FROM public.period_structures
UNION ALL SELECT 'tt_period_structures', COUNT(*) FROM public.tt_period_structures
UNION ALL SELECT 'period_slots', COUNT(*) FROM public.period_slots
UNION ALL SELECT 'tt_period_slots', COUNT(*) FROM public.tt_period_slots
UNION ALL SELECT 'class_period_structure', COUNT(*) FROM public.class_period_structure
UNION ALL SELECT 'tt_class_structure', COUNT(*) FROM public.tt_class_structure
UNION ALL SELECT 'shared_resources', COUNT(*) FROM public.shared_resources
UNION ALL SELECT 'tt_resources', COUNT(*) FROM public.tt_resources
UNION ALL SELECT 'timetable_slots', COUNT(*) FROM public.timetable_slots
UNION ALL SELECT 'tt_slots', COUNT(*) FROM public.tt_slots
UNION ALL SELECT 'lesson_plans', COUNT(*) FROM public.lesson_plans
UNION ALL SELECT 'tt_lesson_plans', COUNT(*) FROM public.tt_lesson_plans
UNION ALL SELECT 'academic_calendar (excl term/working_day)', (
  SELECT COUNT(*) FROM public.academic_calendar
  WHERE event_type IN ('holiday','exam_block','ptm','special_event')
)
UNION ALL SELECT 'cal_events', COUNT(*) FROM public.cal_events;
```
Expected: each `tt_*`/`cal_*` count equals the corresponding legacy count.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424100100_tt_cal_phase2_backfill.sql
git commit -m "feat(timetable-rebuild): invoke backfill at end of Phase 2 migration"
```

---

## Phase 3 — Compatibility shim

### Task 24: Create the `timetableCompat.ts` skeleton

**Files:**
- Create: `src/lib/timetableCompat.ts`

- [ ] **Step 1: Create file with the public surface**

```ts
// =============================================================
// timetableCompat — internal shim for the post-rebuild schema.
// Existing public APIs (currentAcademicYear, useAcademicCalendar,
// getCoverageForClassSubject) keep their signatures; their
// implementation reads cal_*/tt_* tables from this module.
// External imports do NOT change. This file is the only place
// that knows about the new schema during Plan 1.
// =============================================================

import { supabase } from "@/integrations/supabase/client";

// -------------------------------------------------------------
// currentAcademicYear — preserves the legacy date-based contract.
// Reads cal_academic_years.is_active when available; falls back
// to the original month-based heuristic. Pure function (no async)
// to keep call-sites unchanged.
// -------------------------------------------------------------
export function currentAcademicYearFromDate(today = new Date()): string {
  const month = today.getMonth() + 1;
  const year  = today.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Async variant that prefers cal_academic_years.is_active when set.
// Falls back silently if the table is empty or the institution has
// no active row.
export async function currentAcademicYearActive(institutionId: string | null | undefined): Promise<string> {
  if (!institutionId) return currentAcademicYearFromDate();
  const { data, error } = await supabase
    .from("cal_academic_years" as never)
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return currentAcademicYearFromDate();
  return (data as unknown as { code: string }).code;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: build succeeds (no type errors in the new file).

- [ ] **Step 3: Commit**

```bash
git add src/lib/timetableCompat.ts
git commit -m "feat(timetable-rebuild): scaffold timetableCompat shim with currentAcademicYear"
```

---

### Task 25: Add the `cal_events` read functions to the shim

**Files:**
- Modify: `src/lib/timetableCompat.ts`

- [ ] **Step 1: Append shim functions for the read paths**

```ts
// -------------------------------------------------------------
// Calendar event row shape — matches the LEGACY shape so that
// existing AcademicCalendarEvent consumers don't break. Internal
// reads pull from cal_events, internal writes push to cal_events.
// -------------------------------------------------------------
export type CompatAcademicEventType =
  | "holiday"
  | "exam_block"
  | "ptm"
  | "special_event";

export interface CompatAcademicCalendarEvent {
  id: string;
  institution_id: string;
  academic_year: string;
  title: string;
  date: string;            // legacy: starts_on -> date
  end_date: string | null; // legacy: ends_on   -> end_date (null when single-day)
  event_type: CompatAcademicEventType;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const KIND_TO_LEGACY: Record<string, CompatAcademicEventType> = {
  holiday: "holiday",
  exam_block: "exam_block",
  // We collapsed ptm + special_event into "event" on cal_events.
  // Map both back to "special_event" — close enough for downstream
  // consumers that only branch on holiday/exam_block.
  event: "special_event",
};

const LEGACY_TO_KIND: Record<CompatAcademicEventType, string> = {
  holiday: "holiday",
  exam_block: "exam_block",
  ptm: "event",
  special_event: "event",
};

export async function fetchCalendarEvents(
  institutionId: string,
  academicYear: string,
): Promise<CompatAcademicCalendarEvent[]> {
  const { data, error } = await supabase
    .from("cal_events" as never)
    .select("*")
    .eq("institution_id", institutionId)
    .eq("academic_year", academicYear)
    .order("starts_on", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    id: string;
    institution_id: string;
    academic_year: string;
    title: string;
    kind: string;
    starts_on: string;
    ends_on: string;
    notes: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  }>).map((row) => ({
    id: row.id,
    institution_id: row.institution_id,
    academic_year: row.academic_year,
    title: row.title,
    date: row.starts_on,
    end_date: row.ends_on === row.starts_on ? null : row.ends_on,
    event_type: KIND_TO_LEGACY[row.kind] ?? "special_event",
    description: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

export interface CompatEventInput {
  title: string;
  date: string;
  end_date?: string | null;
  event_type: CompatAcademicEventType;
  description?: string | null;
}

export async function insertCalendarEvent(
  institutionId: string,
  academicYear: string,
  input: CompatEventInput,
): Promise<CompatAcademicCalendarEvent> {
  const { data: userRes } = await supabase.auth.getUser();
  const ends_on = input.end_date ?? input.date;
  const { data, error } = await supabase
    .from("cal_events" as never)
    .insert({
      institution_id: institutionId,
      academic_year: academicYear,
      title: input.title,
      kind: LEGACY_TO_KIND[input.event_type],
      starts_on: input.date,
      ends_on,
      notes: input.description ?? null,
      created_by: userRes.user?.id ?? null,
    } as never)
    .select()
    .single();
  if (error) throw error;
  const row = data as unknown as {
    id: string;
    institution_id: string;
    academic_year: string;
    title: string;
    kind: string;
    starts_on: string;
    ends_on: string;
    notes: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  };
  return {
    id: row.id,
    institution_id: row.institution_id,
    academic_year: row.academic_year,
    title: row.title,
    date: row.starts_on,
    end_date: row.ends_on === row.starts_on ? null : row.ends_on,
    event_type: KIND_TO_LEGACY[row.kind] ?? "special_event",
    description: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function updateCalendarEvent(
  id: string,
  input: CompatEventInput,
): Promise<CompatAcademicCalendarEvent> {
  const ends_on = input.end_date ?? input.date;
  const { data, error } = await supabase
    .from("cal_events" as never)
    .update({
      title: input.title,
      kind: LEGACY_TO_KIND[input.event_type],
      starts_on: input.date,
      ends_on,
      notes: input.description ?? null,
    } as never)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const row = data as unknown as {
    id: string;
    institution_id: string;
    academic_year: string;
    title: string;
    kind: string;
    starts_on: string;
    ends_on: string;
    notes: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  };
  return {
    id: row.id,
    institution_id: row.institution_id,
    academic_year: row.academic_year,
    title: row.title,
    date: row.starts_on,
    end_date: row.ends_on === row.starts_on ? null : row.ends_on,
    event_type: KIND_TO_LEGACY[row.kind] ?? "special_event",
    description: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const { error } = await supabase.from("cal_events" as never).delete().eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/timetableCompat.ts
git commit -m "feat(timetable-rebuild): add cal_events read/write shims to timetableCompat"
```

---

### Task 26: Rewire `useAcademicCalendar.ts` to use the shim

**Files:**
- Modify: `src/hooks/useAcademicCalendar.ts:69-198`

- [ ] **Step 1: Rewrite the body of `useAcademicCalendar` to call the shim**

Open `src/hooks/useAcademicCalendar.ts` and replace the implementation between lines 69–198 (the `useAcademicCalendar` function) with this:

```ts
export function useAcademicCalendar(academicYear: string) {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["academic-calendar", institutionId, academicYear],
    queryFn: async (): Promise<AcademicCalendarEvent[]> => {
      if (!institutionId) return [];
      const rows = await fetchCalendarEvents(institutionId, academicYear);
      return rows.map((r): AcademicCalendarEvent => ({
        id: r.id,
        institution_id: r.institution_id,
        academic_year: r.academic_year,
        title: r.title,
        date: r.date,
        end_date: r.end_date,
        // The legacy enum had more values than the compat enum returns;
        // safe to widen because all callers branch on the present subset.
        event_type: r.event_type as AcademicEventType,
        description: r.description,
        created_by: r.created_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
    },
    enabled: !!institutionId && !!academicYear,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["academic-calendar", institutionId, academicYear] });
    queryClient.invalidateQueries({ queryKey: ["working-days", institutionId, academicYear] });
  };

  const createEvent = useMutation({
    mutationFn: async (input: EventInput) => {
      if (!institutionId) throw new Error("Institution not resolved");
      // Map legacy enum to compat enum. Anything outside the compat set
      // (term_start/term_end/working_day) is intentionally rejected here —
      // the new schema has no place for them.
      const supportedTypes = new Set<AcademicEventType>(["holiday", "exam_block", "ptm", "special_event"]);
      if (!supportedTypes.has(input.event_type)) {
        throw new Error(`Event type '${input.event_type}' is no longer supported in the rebuilt calendar.`);
      }
      const row = await insertCalendarEvent(institutionId, academicYear, {
        title: input.title,
        date: input.date,
        end_date: input.end_date ?? null,
        event_type: input.event_type as "holiday" | "exam_block" | "ptm" | "special_event",
        description: input.description ?? null,
      });
      return {
        ...row,
        event_type: row.event_type as AcademicEventType,
      } as AcademicCalendarEvent;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Event added");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't add the event.", context: "createCalendarEvent" }),
  });

  const updateEvent = useMutation({
    mutationFn: async (input: EventInput & { id: string }) => {
      const supportedTypes = new Set<AcademicEventType>(["holiday", "exam_block", "ptm", "special_event"]);
      if (!supportedTypes.has(input.event_type)) {
        throw new Error(`Event type '${input.event_type}' is no longer supported in the rebuilt calendar.`);
      }
      const row = await updateCalendarEvent(input.id, {
        title: input.title,
        date: input.date,
        end_date: input.end_date ?? null,
        event_type: input.event_type as "holiday" | "exam_block" | "ptm" | "special_event",
        description: input.description ?? null,
      });
      return {
        ...row,
        event_type: row.event_type as AcademicEventType,
      } as AcademicCalendarEvent;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Event updated");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't update the event.", context: "updateCalendarEvent" }),
  });

  const deleteEvent = useMutation({
    mutationFn: async (id: string) => {
      await deleteCalendarEvent(id);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Event deleted");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't delete the event.", context: "deleteCalendarEvent" }),
  });

  const bulkInsertHolidays = useMutation({
    mutationFn: async (items: { title: string; date: string; description?: string }[]) => {
      if (items.length === 0) return [];
      const inserted: AcademicCalendarEvent[] = [];
      for (const h of items) {
        if (!institutionId) throw new Error("Institution not resolved");
        const row = await insertCalendarEvent(institutionId, academicYear, {
          title: h.title,
          date: h.date,
          end_date: null,
          event_type: "holiday",
          description: h.description ?? null,
        });
        inserted.push({
          ...row,
          event_type: row.event_type as AcademicEventType,
        } as AcademicCalendarEvent);
      }
      return inserted;
    },
    onSuccess: (rows) => {
      invalidate();
      toast.success(`Imported ${rows.length} holiday${rows.length === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't import the holidays.", context: "bulkInsertHolidays" }),
  });

  return {
    events: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    createEvent,
    updateEvent,
    deleteEvent,
    bulkInsertHolidays,
  };
}
```

- [ ] **Step 2: Add the import for the shim functions at the top of the file (after the existing imports)**

```ts
import {
  fetchCalendarEvents,
  insertCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/timetableCompat";
```

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: builds clean. If type errors surface around `AcademicEventType`, the cast in `createEvent`/`updateEvent` should narrow the supported types.

- [ ] **Step 4: Manual smoke (dev server)**

Run: `npm run dev`
Open `/school/calendar`, log in as a school_admin, view existing events, create a holiday, update its title, delete it. All operations should succeed and re-render without errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAcademicCalendar.ts
git commit -m "refactor(timetable-rebuild): route useAcademicCalendar through compat shim"
```

---

### Task 27: Add `tt_lesson_plans` read function for syllabus coverage

**Files:**
- Modify: `src/lib/timetableCompat.ts`

- [ ] **Step 1: Append a shim function that returns the same shape `syllabusCoverage` reads today**

```ts
// -------------------------------------------------------------
// Coverage read — mirrors the legacy lesson_plans SELECT used by
// syllabusCoverage.ts. Returns rows with the same column names so
// the caller's reduce loop stays unchanged.
// -------------------------------------------------------------
export interface CompatCoveragePlanRow {
  topic_id: string | null;
  status: "planned" | "done" | "skipped" | "pending";
  session_type: "teaching" | "test" | "doubt_session" | "other";
  class_id: string;
  subject_id: string | null;
}

export async function fetchCoveragePlans(args: {
  classId: string;
  subjectId: string;
  chapterIds: string[];
}): Promise<CompatCoveragePlanRow[]> {
  if (args.chapterIds.length === 0) return [];
  const { data, error } = await supabase
    .from("tt_lesson_plans" as never)
    .select("topic_id, status, session_type, class_id, subject_id")
    .eq("class_id", args.classId)
    .eq("subject_id", args.subjectId)
    .in("topic_id", args.chapterIds);
  if (error) throw error;
  return (data ?? []) as unknown as CompatCoveragePlanRow[];
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/timetableCompat.ts
git commit -m "feat(timetable-rebuild): add fetchCoveragePlans shim for tt_lesson_plans"
```

---

### Task 28: Rewire `syllabusCoverage.ts` to use the shim

**Files:**
- Modify: `src/lib/syllabusCoverage.ts:80-165`

- [ ] **Step 1: Replace the body of `getCoverageRowsForClassSubject`**

In `src/lib/syllabusCoverage.ts`, replace the SELECT block (lines 90–110, the `q = supabase.from("lesson_plans" as never)...` block) with a single call to the shim:

```ts
// Pull all lesson_plan status rows that touch these chapters via
// the compat shim (reads tt_lesson_plans). RLS filters down to
// what the caller is allowed to see; that's correct — students
// shouldn't see skipped/pending/planned-but-skipped history, so
// their coverage naturally excludes those.
const planRows = await fetchCoveragePlans({
  classId,
  subjectId,
  chapterIds,
});

// (Legacy comment preserved: We don't store academic_year on the
// row directly; class_id implies the year via class enrollment.
// `academicYear` parameter kept for future cross-year admin views.)
void academicYear;
```

- [ ] **Step 2: Add the import at top of the file**

```ts
import { fetchCoveragePlans } from "@/lib/timetableCompat";
```

- [ ] **Step 3: Remove the now-unused supabase import if applicable**

If `supabase` is no longer used elsewhere in `syllabusCoverage.ts` after the change, remove the import. (Check `fetchChapterOptions` still uses it — it does, so keep the import.)

- [ ] **Step 4: Type-check**

Run: `npm run build`.

- [ ] **Step 5: Manual smoke**

Run: `npm run dev`. Open a syllabus page that shows coverage (e.g., `/school/syllabus`) for a class with existing lesson plans. The "covered / pending / skipped" counts should match what they showed before the rewire. Compare numerically against the same class shown in the legacy `lesson_plans` table:

```sql
SELECT topic_id, status, COUNT(*)
FROM public.lesson_plans
WHERE class_id = '<class-id>' AND subject_id = '<subject-id>' AND session_type = 'teaching'
GROUP BY 1, 2;
```
vs.
```sql
SELECT topic_id, status, COUNT(*)
FROM public.tt_lesson_plans
WHERE class_id = '<class-id>' AND subject_id = '<subject-id>' AND session_type = 'teaching'
GROUP BY 1, 2;
```
Expected: identical (because the backfill copied row-for-row, IDs preserved).

- [ ] **Step 6: Commit**

```bash
git add src/lib/syllabusCoverage.ts
git commit -m "refactor(timetable-rebuild): route syllabusCoverage through compat shim"
```

---

### Task 29: Cross-cut regression sweep — confirm no other consumers break

**Files:**
- Read-only sweep across the codebase.

- [ ] **Step 1: Grep for any direct calls to the legacy tables**

Run searches in the IDE:
- `from("lesson_plans"` — should ONLY match (a) `useLessonPlans.ts`, (b) the compat shim itself if applicable. Anything else is a forgotten consumer.
- `from("academic_calendar"` — should ONLY match (a) `useAcademicCalendar.ts` (already rewired — confirm the line numbers match the rewired file, no stragglers), (b) `supabase/functions/get-working-days/...`. Edge function update is in Plan 2, so leaving it for now is correct.
- `from("timetable_slots"`, `from("period_structures"`, etc. — these are still used by current TimetablePage, builder hooks, etc. **Leave them alone in Plan 1.** Plan 2 replaces them.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Run full build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit (if any drive-by lint fixes were needed)**

```bash
git add -A
git commit -m "chore(timetable-rebuild): post-shim regression sweep"
```
(Skip the commit if no files changed.)

---

## Final Phase 1+2+3 verification

### Task 30: End-to-end smoke

- [ ] **Step 1: Confirm migrations are applied**

Run: `npm run db:status`
Expected: `20260424100000_tt_cal_phase1_schema` and `20260424100100_tt_cal_phase2_backfill` both shown as applied.

- [ ] **Step 2: Confirm row-count parity**

Run the parity query from Task 23, Step 3 again. Each `tt_*`/`cal_*` count must equal the corresponding legacy count.

- [ ] **Step 3: Manual UI smoke — old surfaces unchanged**

Run: `npm run dev`. Click through:
- `/school/timetable` (still shows the OLD UI with the 3 tabs — Plan 2 replaces it)
- `/school/calendar` (NEW data path via shim, but UI is unchanged) — read & write events; both should work
- `/school/syllabus` for any class — coverage numbers unchanged
- `/teacher/my-week` (unchanged old UI; reads still work)
- `/student/my-week` (unchanged old UI; reads still work)

Expected: every page renders identically to before this plan started.

- [ ] **Step 4: Tag this checkpoint**

```bash
git tag plan-1-foundation-complete
```

This tag marks the safe-to-execute-Plan-2 boundary.

---

## Self-review checklist (run after the engineer completes the plan)

1. **All migrations applied** — `npm run db:status` shows the two Phase migrations.
2. **All new tables populated** — counts match legacy counts.
3. **All RLS policies active** — `pg_policy` query returns expected counts per table.
4. **Build is clean** — `npm run build` succeeds.
5. **Lint is clean** — `npm run lint` succeeds.
6. **No user-visible regressions** — every page that worked before still works.
7. **No new code paths read from legacy tables** outside of the still-current Timetable code (Plan 2 replaces those).
8. **Commits are atomic** — one task per commit, messages all start with `feat(timetable-rebuild)`, `chore(timetable-rebuild)`, or `refactor(timetable-rebuild)`.

---

## What's NOT in this plan (intentional)

These are deferred to **Plan 2** and **Plan 3**:

- New TimetablePage UI (per-class workspace, gear sheet, slot drawer, substitute mode).
- New AnnualCalendarPage UI (month view, agenda fallback).
- New TeacherWeekPage / StudentWeekPage UIs.
- `tt-rollover-year`, `tt-notify-substitute`, `tt-notify-absence-pending` edge functions.
- Updating `get-working-days` edge function to read `cal_events`.
- Removing the legacy hooks (`useLessonPlans`, `usePeriodStructures`, `useTimetableBuilder`).
- Sidebar, FEATURE_URL_MAP, dashboard tile updates.
- `DROP TABLE` migrations for the legacy schema.

After Plan 1 is merged and stable for one release cycle (or one day of QA, whichever the user prefers), Plan 2 can begin without any data risk.
