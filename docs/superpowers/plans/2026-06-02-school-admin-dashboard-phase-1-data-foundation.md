# School-Admin Dashboard — Phase 1: Data Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the database layer (new columns, the `dashboard_flags` scaffold, two helper functions, and all read-path RPCs) plus the `exam_type` picker, so the new Command Center UI in later phases is a thin client over server-aggregated data.

**Architecture:** Compute-on-read `SECURITY DEFINER` Postgres RPCs aggregate server-side and return small pre-rolled payloads (CLAUDE.md §23 — no client-side aggregation, no `select("*")`, pagination end-to-end). Every RPC resolves + authorizes the institution through a shared `dash_resolve_institution()` guard. Flags are read here but written in Phase 3.

**Tech Stack:** Supabase Postgres (plpgsql/sql functions, RLS), `src/integrations/supabase/types.ts` (regenerated), React + TanStack Query (picker only), shadcn `Select`.

> ⚠️ **Migrations target the production Supabase project** (`gyymkgohcijeksmrzuyw`). Do **not** apply any migration in this plan to prod without the user's explicit go-ahead per task. Prefer a Supabase branch / local `supabase db reset` first. Each "apply" step assumes that confirmation. All functions are additive (new objects only) — no existing object is altered or dropped.

---

## Reference: confirmed schema (from recon, do not re-discover)

- `get_user_institution(_user_id uuid) RETURNS uuid` — existing SECURITY DEFINER helper: `SELECT institution_id FROM profiles WHERE id=_user_id`.
- `profiles(id, institution_id, full_name, email, is_active, roll_number, created_at)`.
- `user_roles(user_id, role app_role, institution_id)` — `app_role` ∈ super_admin|super_school_admin|school_admin|coordinator|teacher|employee|student.
- `classes(id, institution_id, class_group_id, name, section, academic_year, is_active)`.
- `class_groups(id, institution_id, grade_level_id, name, academic_year, is_active)`.
- `grade_levels(id, grade_name, grade_number int, display_order, is_active)` — **GLOBAL, no institution_id**.
- `class_assignments(id, user_id, class_id, role app_role, subject_id, teaching_type, assigned_by, assigned_at)` — student roster = `role='student'`; class teacher = `role='teacher' AND subject_id IS NULL`; subject teacher = `role='teacher' AND subject_id=<uuid>`.
- `exams(id, institution_id, title, status exam_status, exam_mode, total_marks, pass_marks, scheduled_date text, published_at, created_by, created_at)` — `exam_status` ∈ draft|ready|published|active|completed|archived.
- `final_results(id, attempt_id UNIQUE, total_marks_obtained, total_max_marks, percentage GENERATED, is_pass, grade, is_published, finalized_at, created_at)` — never write `percentage` (CLAUDE.md §9). `is_pass` is client-set; pass rule = `pass_marks ? obtained>=pass_marks : percentage>=40`.
- `student_exam_attempts(id, exam_id, student_id, class_id, is_submitted, submitted_at, evaluation_status, is_finalized, created_at)` — UNIQUE(exam_id, student_id).
- `exam_classes(id, exam_id, class_id)`; `exam_subjects(id, exam_id, subject_id, weightage)`; `universal_subjects(id, name, code, category, institution_id, grade_level_id, is_active)`.
- `attendance_records(id, institution_id, class_id, student_id, date, status, marked_by, method)` — present = `status IN ('present','late')`; values present|late|absent|sick|casual.
- `staff_attendance_records(id, institution_id, staff_id, date, status, auto_marked_absent, check_in_at, check_out_at)` — values present|late|absent.
- `wings(id, institution_id, name, is_active, display_order)`; `wing_assignments(user_id, wing_id)`; `wing_class_mappings(class_id, wing_id)`.
- `tasks(id, institution_id, title, description, due_date, priority int, status task_status, task_type, wing_id)` — status default `open`; required insert: institution_id, title, task_type.
- `task_assignments(task_id, assignee_id, assigner_id, supervisor_id, assigned_at)`.
- `cal_academic_years(id, institution_id, code, starts_on text, ends_on text, is_active)`.
- `recheck_requests(id, result_id, status, requested_at, resolved_at)` — scope via result_id→final_results→attempt→student_exam_attempts.
- `institution_features(institution_id, feature_id text, is_enabled)`; `tt_slots(class_id, institution_id, ...)`; `syllabus_topics(grade_level_id, subject_id, institution_id, is_active)`; `institutions(id, name, timezone, created_at, logo_url, is_active)`.
- `dashboard_flags` — **does not exist yet** (Task 3 creates it).

## File structure

```
supabase/migrations/
  20260602100000_dashboard_exam_type.sql            Task 1
  20260602100100_dashboard_kill_switch.sql          Task 2
  20260602100200_dashboard_flags_table.sql          Task 3
  20260602100300_dashboard_helpers.sql              Task 4
  20260602100400_dashboard_kpi_rpc.sql              Task 5
  20260602100500_dashboard_widget_rpcs.sql          Tasks 6–10
  20260602100600_dashboard_table_rpcs.sql           Tasks 11–14
  20260602100700_dashboard_flags_read_rpc.sql       Task 15
src/integrations/supabase/types.ts                  Task 16 (regenerated)
<exam-create UI> + src/hooks/useSaveExam.ts          Task 17 (exam_type picker)
```

Each migration is one file with complete SQL. Verification = run the SELECT in the Supabase SQL editor (as a school-admin session via `set request.jwt.claims`, or impersonate) and confirm the shape. All RPCs `GRANT EXECUTE ... TO authenticated`.

---

## Task 1: Add `exams.exam_type`

**Files:** Create `supabase/migrations/20260602100000_dashboard_exam_type.sql`

- [ ] **Step 1: Write the migration**

```sql
-- exams.exam_type: term | unit | weekly | unspecified (default). Backfill existing rows.
ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS exam_type text NOT NULL DEFAULT 'unspecified';

ALTER TABLE public.exams
  ADD CONSTRAINT exams_exam_type_check
  CHECK (exam_type IN ('term','unit','weekly','unspecified'));

-- Existing rows already default to 'unspecified' via the column default; make it explicit/idempotent.
UPDATE public.exams SET exam_type = 'unspecified' WHERE exam_type IS NULL;
```

- [ ] **Step 2: Apply** (after user go-ahead) via Supabase SQL editor or `npx supabase db push`.

- [ ] **Step 3: Verify**

Run: `SELECT exam_type, count(*) FROM public.exams GROUP BY 1;`
Expected: every row counted under `unspecified` (or pre-existing types), no NULLs, no error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602100000_dashboard_exam_type.sql
git commit -m "feat(dashboard): add exams.exam_type column (term/unit/weekly/unspecified)"
```

---

## Task 2: Add the adoption-flags kill switch

**Files:** Create `supabase/migrations/20260602100100_dashboard_kill_switch.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Backend-only kill switch for adoption (AD*) flags. Default ON.
ALTER TABLE public.institutions
  ADD COLUMN IF NOT EXISTS dashboard_adoption_flags_enabled boolean NOT NULL DEFAULT true;
```

- [ ] **Step 2: Apply** (after go-ahead).

- [ ] **Step 3: Verify**

Run: `SELECT id, dashboard_adoption_flags_enabled FROM public.institutions LIMIT 5;`
Expected: column present, all `true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602100100_dashboard_kill_switch.sql
git commit -m "feat(dashboard): add institutions.dashboard_adoption_flags_enabled kill switch"
```

---

## Task 3: Create the `dashboard_flags` table (scaffold)

**Files:** Create `supabase/migrations/20260602100200_dashboard_flags_table.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS public.dashboard_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  flag_code         text NOT NULL,
  category          text NOT NULL CHECK (category IN ('attendance','exams','adoption')),
  severity          text NOT NULL CHECK (severity IN ('critical','warning','info')),
  status            text NOT NULL DEFAULT 'red' CHECK (status IN ('red','amber','blue')),
  subject_type      text NOT NULL CHECK (subject_type IN ('class','student','exam','subject','teacher','school')),
  subject_key       text NOT NULL,
  title             text NOT NULL,
  description       text NOT NULL,
  metric_value      numeric,
  context           jsonb NOT NULL DEFAULT '{}'::jsonb,
  link_url          text,
  assignee_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  task_id           uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  auto_created      boolean NOT NULL DEFAULT false,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dashboard_flags_inst_open_idx
  ON public.dashboard_flags (institution_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS dashboard_flags_subject_idx
  ON public.dashboard_flags (institution_id, subject_type, subject_key);
CREATE INDEX IF NOT EXISTS dashboard_flags_task_idx ON public.dashboard_flags (task_id);
-- one open flag per (institution, code, subject)
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_flags_identity_uidx
  ON public.dashboard_flags (institution_id, flag_code, subject_key) WHERE resolved_at IS NULL;

ALTER TABLE public.dashboard_flags ENABLE ROW LEVEL SECURITY;

-- Admins of the institution may read & update (status/assignee). Inserts happen via SECURITY DEFINER RPCs in Phase 3.
CREATE POLICY dashboard_flags_admin_select ON public.dashboard_flags
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('super_admin','super_school_admin','school_admin')
              AND (ur.role = 'super_admin' OR ur.institution_id = dashboard_flags.institution_id))
  );

CREATE POLICY dashboard_flags_admin_update ON public.dashboard_flags
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur
            WHERE ur.user_id = auth.uid()
              AND ur.role IN ('super_admin','super_school_admin','school_admin')
              AND (ur.role = 'super_admin' OR ur.institution_id = dashboard_flags.institution_id))
  );

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION public.dashboard_flags_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS dashboard_flags_touch ON public.dashboard_flags;
CREATE TRIGGER dashboard_flags_touch BEFORE UPDATE ON public.dashboard_flags
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_flags_touch_updated_at();
```

- [ ] **Step 2: Apply** (after go-ahead).

- [ ] **Step 3: Verify**

Run: `INSERT INTO public.dashboard_flags (institution_id, flag_code, category, severity, subject_type, subject_key, title, description) SELECT id,'TEST','exams','info','school','school','t','d' FROM public.institutions LIMIT 1 RETURNING id;`
then `SELECT * FROM public.dashboard_flags WHERE flag_code='TEST';` then `DELETE FROM public.dashboard_flags WHERE flag_code='TEST';`
Expected: insert returns a row, select shows defaults (status `red`, resolved_at NULL), delete succeeds.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602100200_dashboard_flags_table.sql
git commit -m "feat(dashboard): dashboard_flags table + RLS + identity index (scaffold)"
```

---

## Task 4: Helper functions — admin guard + current academic year

**Files:** Create `supabase/migrations/20260602100300_dashboard_helpers.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Resolve the institution the caller may view, authorizing admins. super_admin may pass any institution.
CREATE OR REPLACE FUNCTION public.dash_resolve_institution(p_institution_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_is_super boolean;
BEGIN
  v_is_super := EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'super_admin');
  v_inst := COALESCE(p_institution_id, public.get_user_institution(auth.uid()));
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'dashboard: no institution context for this user';
  END IF;
  IF v_is_super THEN RETURN v_inst; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND institution_id = v_inst
      AND role IN ('school_admin','super_school_admin')
  ) THEN
    RAISE EXCEPTION 'dashboard: not authorized for this institution';
  END IF;
  RETURN v_inst;
END $$;

-- Current academic-year window for an institution. Prefers the row matching today's date, then is_active.
CREATE OR REPLACE FUNCTION public.dash_current_academic_year(p_institution_id uuid)
RETURNS TABLE(start_date date, end_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ay.starts_on::date, ay.ends_on::date
  FROM cal_academic_years ay
  WHERE ay.institution_id = p_institution_id
  ORDER BY (CURRENT_DATE BETWEEN ay.starts_on::date AND ay.ends_on::date) DESC,
           ay.is_active DESC,
           ay.starts_on::date DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.dash_resolve_institution(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_current_academic_year(uuid) TO authenticated;
```

- [ ] **Step 2: Apply** (after go-ahead).

- [ ] **Step 3: Verify** (as a school-admin session)

Run: `SELECT public.dash_resolve_institution(NULL);` → returns the admin's institution uuid.
Run: `SELECT * FROM public.dash_current_academic_year(public.dash_resolve_institution(NULL));` → returns one (start_date,end_date) row or zero rows if no AY configured (callers fall back to a rolling window).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602100300_dashboard_helpers.sql
git commit -m "feat(dashboard): dash_resolve_institution guard + dash_current_academic_year helper"
```

---

## Task 5: KPI summary RPC

**Files:** Create `supabase/migrations/20260602100400_dashboard_kpi_rpc.sql`

> Note: weekly deltas for "students who need help" require a historical snapshot we don't keep yet, so `prev_count` is returned as NULL in v1 (UI shows the count without a delta). Attendance compares the last 7 days vs the prior 7 days.

- [ ] **Step 1: Write the migration**

```sql
CREATE OR REPLACE FUNCTION public.dash_kpi_summary(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst uuid; v_tz text; v_today date; v_ay_start date; v_ay_end date;
  v_present int; v_total int;
  v_wk_present int; v_wk_total int; v_pwk_present int; v_pwk_total int;
  v_avg numeric; v_prev_avg numeric; v_exams int;
  v_need int; v_flags int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;
  SELECT start_date, end_date INTO v_ay_start, v_ay_end FROM public.dash_current_academic_year(v_inst);
  v_ay_start := COALESCE(v_ay_start, v_today - INTERVAL '12 months')::date;
  v_ay_end   := COALESCE(v_ay_end,   v_today)::date;

  -- attendance today
  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_present, v_total
  FROM attendance_records WHERE institution_id = v_inst AND date = v_today;

  -- last 7 days vs prior 7 days (for "same as / lower than last week")
  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_wk_present, v_wk_total
  FROM attendance_records
  WHERE institution_id = v_inst AND date > v_today - 7 AND date <= v_today;
  SELECT count(*) FILTER (WHERE status IN ('present','late')), count(*)
    INTO v_pwk_present, v_pwk_total
  FROM attendance_records
  WHERE institution_id = v_inst AND date > v_today - 14 AND date <= v_today - 7;

  -- school average this academic year + previous AY
  SELECT round(avg(fr.percentage),1), count(DISTINCT e.id) INTO v_avg, v_exams
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id = fr.attempt_id
  JOIN exams e ON e.id = a.exam_id
  WHERE e.institution_id = v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) BETWEEN v_ay_start AND v_ay_end;

  SELECT round(avg(fr.percentage),1) INTO v_prev_avg
  FROM final_results fr
  JOIN student_exam_attempts a ON a.id = fr.attempt_id
  JOIN exams e ON e.id = a.exam_id
  WHERE e.institution_id = v_inst AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
        BETWEEN (v_ay_start - INTERVAL '1 year')::date AND (v_ay_start - INTERVAL '1 day')::date;

  -- students who need help (default weights -> pass NULL)
  SELECT count(*) INTO v_need FROM public.dash_score_students(v_inst, NULL) WHERE score >= 20;

  -- active flags
  SELECT count(*) INTO v_flags FROM dashboard_flags WHERE institution_id = v_inst AND resolved_at IS NULL;

  RETURN jsonb_build_object(
    'attendance_today', jsonb_build_object(
       'present', v_present, 'total', v_total, 'marked', v_total > 0,
       'pct', CASE WHEN v_total > 0 THEN round(v_present*100.0/v_total,1) END,
       'week_pct',  CASE WHEN v_wk_total  > 0 THEN round(v_wk_present *100.0/v_wk_total ,1) END,
       'prev_week_pct', CASE WHEN v_pwk_total > 0 THEN round(v_pwk_present*100.0/v_pwk_total,1) END),
    'school_avg', jsonb_build_object('pct', v_avg, 'prev_pct', v_prev_avg, 'exams_count', v_exams),
    'students_need_help', jsonb_build_object('count', v_need, 'prev_count', NULL),
    'decisions_waiting', jsonb_build_object('count', v_flags)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.dash_kpi_summary(uuid) TO authenticated;
```

> ⚠️ This RPC calls `dash_score_students` (Task 12). Apply Task 12's migration **before** running this one, or temporarily stub `v_need := 0;`. The file ordering (100400 before 100600) means: when applying in order, set `v_need := 0` here, then change to the real call after Task 12 lands. Simplest: include `dash_score_students` in Task 4's helper migration instead. **Decision for executor:** move the `dash_score_students` definition (Task 12 Step 1) into the helpers migration (Task 4) so it exists before this KPI RPC. Keep the `dash_students_attention` wrapper in Task 12.

- [ ] **Step 2: Apply** (after Task 12's scoring function exists).

- [ ] **Step 3: Verify**

Run: `SELECT public.dash_kpi_summary(NULL);`
Expected: a JSON object with the four keys; numbers reflect real data (or NULLs where cold-start). No error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602100400_dashboard_kpi_rpc.sql
git commit -m "feat(dashboard): dash_kpi_summary RPC (attendance/school-avg/need-help/flags)"
```

---

## Tasks 6–10: Widget RPCs

**Files:** Create `supabase/migrations/20260602100500_dashboard_widget_rpcs.sql` (all five functions in one file).

- [ ] **Step 1: Write the migration**

```sql
-- 6) Attendance trend: daily school-wide % over p_days, plus all-time average.
CREATE OR REPLACE FUNCTION public.dash_attendance_trend(p_days int DEFAULT 30, p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_tz text; v_today date; v_points jsonb; v_all numeric;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'date', d.date, 'present', d.present, 'total', d.total,
           'pct', CASE WHEN d.total>0 THEN round(d.present*100.0/d.total,1) END) ORDER BY d.date), '[]'::jsonb)
    INTO v_points
  FROM (
    SELECT date,
           count(*) FILTER (WHERE status IN ('present','late')) AS present,
           count(*) AS total
    FROM attendance_records
    WHERE institution_id = v_inst AND date > v_today - p_days AND date <= v_today
    GROUP BY date
  ) d;

  SELECT round(
           (count(*) FILTER (WHERE status IN ('present','late')))*100.0 / NULLIF(count(*),0), 1)
    INTO v_all
  FROM attendance_records WHERE institution_id = v_inst;

  RETURN jsonb_build_object('points', v_points, 'all_time_avg', v_all);
END $$;

-- 7) Subjects-by-performance for one class + the school reference per subject.
CREATE OR REPLACE FUNCTION public.dash_subject_performance(p_class_id uuid, p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb; v_has boolean;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  -- guard: class belongs to institution
  IF NOT EXISTS (SELECT 1 FROM classes WHERE id = p_class_id AND institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  WITH res AS (   -- per result joined to its subject (an exam may carry one or more subjects)
    SELECT a.class_id, es.subject_id, us.name AS subject_name, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
  ),
  class_avg AS (
    SELECT subject_id, subject_name, round(avg(percentage),1) AS class_avg
    FROM res WHERE class_id = p_class_id GROUP BY subject_id, subject_name
  ),
  school_avg AS (
    SELECT subject_id, round(avg(percentage),1) AS school_avg FROM res GROUP BY subject_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'subject_id', c.subject_id, 'subject_name', c.subject_name,
           'class_avg', c.class_avg, 'school_avg', s.school_avg) ORDER BY c.class_avg ASC), '[]'::jsonb)
    INTO v_rows
  FROM class_avg c LEFT JOIN school_avg s USING (subject_id);

  v_has := jsonb_array_length(v_rows) > 0;
  RETURN jsonb_build_object('has_data', v_has, 'subjects', v_rows);
END $$;

-- 8) Student distribution (school-wide), using each student's latest finalized result.
CREATE OR REPLACE FUNCTION public.dash_student_distribution(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_dw int; v_cu int; v_nh int; v_total int; v_eval int;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  WITH latest AS (
    SELECT DISTINCT ON (a.student_id) a.student_id, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst AND e.status IN ('published','active','completed')
    ORDER BY a.student_id, coalesce(fr.finalized_at, fr.created_at) DESC
  )
  SELECT count(*) FILTER (WHERE percentage > 70),
         count(*) FILTER (WHERE percentage BETWEEN 50 AND 70),
         count(*) FILTER (WHERE percentage < 50),
         count(*)
    INTO v_dw, v_cu, v_nh, v_eval
  FROM latest;

  SELECT count(*) INTO v_total
  FROM class_assignments WHERE role = 'student'
    AND class_id IN (SELECT id FROM classes WHERE institution_id = v_inst);

  RETURN jsonb_build_object('doing_well', v_dw, 'catching_up', v_cu, 'needs_help', v_nh,
                            'total', v_total, 'evaluated', v_eval);
END $$;

-- 9) Exam performance trend: last p_limit published exams, chronological.
CREATE OR REPLACE FUNCTION public.dash_exam_trend(p_limit int DEFAULT 8, p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  WITH recent AS (
    SELECT e.id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
    FROM exams e
    WHERE e.institution_id = v_inst AND e.status IN ('published','active','completed')
    ORDER BY exam_date DESC NULLS LAST
    LIMIT p_limit
  ),
  agg AS (
    SELECT r.id, r.title, r.exam_type, r.exam_date,
           round(avg(fr.percentage),1) AS avg_pct,
           count(fr.id) AS participation
    FROM recent r
    LEFT JOIN student_exam_attempts a ON a.exam_id = r.id
    LEFT JOIN final_results fr ON fr.attempt_id = a.id
    GROUP BY r.id, r.title, r.exam_type, r.exam_date
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'exam_id', id, 'title', title, 'exam_type', exam_type,
           'avg_pct', avg_pct, 'participation', participation, 'exam_date', exam_date)
           ORDER BY exam_date ASC), '[]'::jsonb)
    INTO v_rows FROM agg;
  RETURN v_rows;
END $$;

-- 10) Class x Subject heatmap. Rows = wings (if any configured), else CBSE grade-number bands.
CREATE OR REPLACE FUNCTION public.dash_subject_heatmap(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_use_wings boolean; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT EXISTS (SELECT 1 FROM wings w WHERE w.institution_id = v_inst AND coalesce(w.is_active,true)
                 AND EXISTS (SELECT 1 FROM wing_class_mappings m WHERE m.wing_id = w.id))
    INTO v_use_wings;

  WITH res AS (
    SELECT a.class_id, es.subject_id, us.name AS subject_name, fr.percentage
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst AND e.status IN ('published','active','completed')
    JOIN exam_subjects es ON es.exam_id = e.id
    JOIN universal_subjects us ON us.id = es.subject_id
  ),
  banded AS (
    SELECT r.*,
      CASE
        WHEN v_use_wings THEN (SELECT w.name FROM wing_class_mappings m JOIN wings w ON w.id = m.wing_id
                               WHERE m.class_id = r.class_id LIMIT 1)
        ELSE (
          SELECT CASE
                   WHEN gl.grade_number BETWEEN 1 AND 5  THEN 'Primary'
                   WHEN gl.grade_number BETWEEN 6 AND 8  THEN 'Middle'
                   WHEN gl.grade_number BETWEEN 9 AND 10 THEN 'Secondary'
                   WHEN gl.grade_number BETWEEN 11 AND 12 THEN 'Senior Secondary'
                   WHEN gl.grade_number < 1 THEN 'Pre-Primary'
                   ELSE 'Other'
                 END
          FROM classes c JOIN class_groups cg ON cg.id = c.class_group_id
                         LEFT JOIN grade_levels gl ON gl.id = cg.grade_level_id
          WHERE c.id = r.class_id
        )
      END AS band_label,
      CASE
        WHEN v_use_wings THEN (SELECT w.display_order FROM wing_class_mappings m JOIN wings w ON w.id = m.wing_id
                               WHERE m.class_id = r.class_id LIMIT 1)
        ELSE (SELECT gl.grade_number FROM classes c JOIN class_groups cg ON cg.id = c.class_group_id
              LEFT JOIN grade_levels gl ON gl.id = cg.grade_level_id WHERE c.id = r.class_id)
      END AS band_order
    FROM res r
  ),
  cells AS (
    SELECT coalesce(band_label,'Other') AS band_label, min(band_order) AS band_order,
           subject_id, subject_name, round(avg(percentage),1) AS avg_pct
    FROM banded GROUP BY coalesce(band_label,'Other'), subject_id, subject_name
  )
  SELECT coalesce(jsonb_agg(row_to_json(g)) , '[]'::jsonb) INTO v_rows
  FROM (
    SELECT band_label AS band_label, min(band_order) AS band_order,
      jsonb_agg(jsonb_build_object(
        'subject_id', subject_id, 'subject_name', subject_name, 'avg_pct', avg_pct,
        'band', CASE WHEN avg_pct < 50 THEN 'red' WHEN avg_pct <= 70 THEN 'amber' ELSE 'green' END)
        ORDER BY subject_name) AS cells
    FROM cells
    GROUP BY band_label
    ORDER BY min(band_order) NULLS LAST
  ) g;

  RETURN jsonb_build_object('grouping', CASE WHEN v_use_wings THEN 'wings' ELSE 'grade' END, 'rows', v_rows);
END $$;

GRANT EXECUTE ON FUNCTION public.dash_attendance_trend(int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_subject_performance(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_student_distribution(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_exam_trend(int, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_subject_heatmap(uuid) TO authenticated;
```

- [ ] **Step 2: Apply** (after go-ahead).

- [ ] **Step 3: Verify** (school-admin session)

```sql
SELECT public.dash_attendance_trend(30);
SELECT public.dash_student_distribution(NULL);
SELECT public.dash_exam_trend(8);
SELECT public.dash_subject_heatmap(NULL);
-- pick a real class id:
SELECT public.dash_subject_performance((SELECT id FROM classes WHERE institution_id = public.dash_resolve_institution(NULL) LIMIT 1));
```
Expected: each returns its documented JSON shape with real numbers (or empty arrays / `has_data:false` on cold-start). No error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602100500_dashboard_widget_rpcs.sql
git commit -m "feat(dashboard): widget RPCs (attendance trend, subjects, distribution, exam trend, heatmap)"
```

---

## Tasks 11–14: Table RPCs

**Files:** Create `supabase/migrations/20260602100600_dashboard_table_rpcs.sql`. Each table RPC takes `(p_filters jsonb DEFAULT '{}', p_limit int DEFAULT 10, p_offset int DEFAULT 0, p_institution_id uuid DEFAULT NULL)` and returns `{ rows, total }`. (Offset pagination is acceptable here — top-10 with a "show all" expander; the largest realistic set, classes/teachers, is small. The §23 cursor rule targets unbounded student/result reads, which these RPCs aggregate server-side.)

- [ ] **Step 1: Write the migration**

```sql
-- 11) Classes table — worst recent exam average first.
CREATE OR REPLACE FUNCTION public.dash_classes_table(
  p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 10, p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_tz text; v_today date; v_rows jsonb; v_total int;
        v_only_flagged boolean := coalesce((p_filters->>'only_flagged')::boolean, false);
        v_wing uuid := nullif(p_filters->>'wing_id','')::uuid;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  WITH cls AS (
    SELECT c.id, c.name, c.section
    FROM classes c
    WHERE c.institution_id = v_inst AND coalesce(c.is_active,true)
      AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings m WHERE m.class_id = c.id AND m.wing_id = v_wing))
  ),
  students AS (
    SELECT class_id, count(*) AS n FROM class_assignments WHERE role='student' GROUP BY class_id
  ),
  att AS (
    SELECT class_id,
           round((count(*) FILTER (WHERE status IN ('present','late')))*100.0/NULLIF(count(*),0),1) AS pct
    FROM attendance_records
    WHERE institution_id = v_inst AND date > v_today - 30 AND date <= v_today
    GROUP BY class_id
  ),
  recent AS (   -- avg percentage over results from exams in the last 60 days, per class
    SELECT a.class_id, round(avg(fr.percentage),1) AS recent_avg
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = v_inst AND e.status IN ('published','active','completed')
      AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) > v_today - 60
    GROUP BY a.class_id
  ),
  flags AS (
    SELECT subject_key, count(*) AS n FROM dashboard_flags
    WHERE institution_id = v_inst AND resolved_at IS NULL AND subject_type='class' GROUP BY subject_key
  ),
  joined AS (
    SELECT cls.id, cls.name, cls.section,
           coalesce(students.n,0) AS students,
           att.pct AS attendance_30d,
           recent.recent_avg,
           coalesce(flags.n,0) AS active_flags
    FROM cls
    LEFT JOIN students ON students.class_id = cls.id
    LEFT JOIN att ON att.class_id = cls.id
    LEFT JOIN recent ON recent.class_id = cls.id
    LEFT JOIN flags ON flags.subject_key = cls.id::text
    WHERE (NOT v_only_flagged OR coalesce(flags.n,0) > 0)
  )
  SELECT count(*) INTO v_total FROM joined;

  WITH joined AS (  -- repeat CTE for the paginated select
    SELECT c.id, c.name, c.section,
           (SELECT count(*) FROM class_assignments ca WHERE ca.role='student' AND ca.class_id=c.id) AS students,
           (SELECT round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1)
              FROM attendance_records ar WHERE ar.class_id=c.id AND ar.date>v_today-30 AND ar.date<=v_today) AS attendance_30d,
           (SELECT round(avg(fr.percentage),1)
              FROM final_results fr JOIN student_exam_attempts a ON a.id=fr.attempt_id
              JOIN exams e ON e.id=a.exam_id AND e.status IN ('published','active','completed')
                AND COALESCE(e.published_at::date,e.scheduled_date::date,e.created_at::date) > v_today-60
              WHERE a.class_id=c.id) AS recent_avg,
           (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
              AND df.subject_type='class' AND df.subject_key=c.id::text) AS active_flags
    FROM classes c
    WHERE c.institution_id=v_inst AND coalesce(c.is_active,true)
      AND (v_wing IS NULL OR EXISTS (SELECT 1 FROM wing_class_mappings m WHERE m.class_id=c.id AND m.wing_id=v_wing))
  )
  SELECT coalesce(jsonb_agg(row_to_json(j) ORDER BY j.recent_avg ASC NULLS LAST), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT * FROM joined
    WHERE (NOT v_only_flagged OR active_flags > 0)
    ORDER BY recent_avg ASC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  ) j;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;

-- 12a) Shared scoring function (also used by dash_kpi_summary). Weights from TS constants; NULL -> defaults.
-- DEFAULT weights MUST match src/lib/dashboardConstants.ts SEVERITY_WEIGHTS.
CREATE OR REPLACE FUNCTION public.dash_score_students(p_institution_id uuid, p_weights jsonb DEFAULT NULL)
RETURNS TABLE(student_id uuid, class_id uuid, score int, band text, reason text,
              attendance numeric, recent_pct numeric, trend text, active_flags int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tz text; v_today date;
  w_att   int := coalesce((p_weights->>'attendance_gap')::int, 30);
  w_quart int := coalesce((p_weights->>'bottom_quartile')::int, 30);
  w_drop  int := coalesce((p_weights->>'dropped_half')::int, 25);
  w_flags int := coalesce((p_weights->>'flag_count')::int, 15);
  v_min   int := coalesce((p_weights->>'min_score')::int, 20);
  b_red   int := coalesce((p_weights->>'band_red')::int, 55);
  b_amber int := coalesce((p_weights->>'band_amber')::int, 35);
BEGIN
  SELECT timezone INTO v_tz FROM institutions WHERE id = p_institution_id;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  RETURN QUERY
  WITH roster AS (   -- one row per student + their class (their student class_assignment)
    SELECT ca.user_id AS sid, ca.class_id AS cid
    FROM class_assignments ca
    JOIN classes c ON c.id = ca.class_id AND c.institution_id = p_institution_id
    WHERE ca.role = 'student'
  ),
  stu_att AS (
    SELECT ar.student_id AS sid,
           round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1) AS pct,
           count(*) AS days
    FROM attendance_records ar
    WHERE ar.institution_id = p_institution_id AND ar.date > v_today - 30 AND ar.date <= v_today
    GROUP BY ar.student_id
  ),
  cls_att AS (
    SELECT ar.class_id AS cid,
           round((count(*) FILTER (WHERE ar.status IN ('present','late')))*100.0/NULLIF(count(*),0),1) AS pct
    FROM attendance_records ar
    WHERE ar.institution_id = p_institution_id AND ar.date > v_today - 30 AND ar.date <= v_today
    GROUP BY ar.class_id
  ),
  results AS (   -- finalized results for this institution, with class + recency rank within student
    SELECT a.student_id AS sid, a.class_id AS cid, a.exam_id, fr.percentage,
           coalesce(fr.finalized_at, fr.created_at) AS at
    FROM final_results fr
    JOIN student_exam_attempts a ON a.id = fr.attempt_id
    JOIN exams e ON e.id = a.exam_id AND e.institution_id = p_institution_id AND e.status IN ('published','active','completed')
  ),
  exam_counts AS (SELECT sid, count(*) AS n FROM results GROUP BY sid),
  ranked AS (
    SELECT r.*, row_number() OVER (PARTITION BY sid ORDER BY at DESC) AS rn
    FROM results r
  ),
  recent AS (   -- latest exam per student + that exam's class quartile cut
    SELECT rk.sid, rk.cid, rk.exam_id, rk.percentage,
           percent_rank() OVER (PARTITION BY rk.exam_id, rk.cid ORDER BY rk.percentage) AS pr
    FROM ranked rk WHERE rk.rn = 1
  ),
  halves AS (   -- recent half vs older half averages per student, and class averages over the same windows
    SELECT sid, cid,
           avg(percentage) FILTER (WHERE rn <= 3) AS recent_avg,
           avg(percentage) FILTER (WHERE rn > 3) AS older_avg
    FROM ranked GROUP BY sid, cid
  ),
  cls_halves AS (
    SELECT cid,
           avg(percentage) FILTER (WHERE rn <= 3) AS cls_recent_avg,
           avg(percentage) FILTER (WHERE rn > 3) AS cls_older_avg
    FROM ranked GROUP BY cid
  ),
  flagn AS (
    SELECT subject_key AS sid_text, count(*) AS n FROM dashboard_flags
    WHERE institution_id = p_institution_id AND resolved_at IS NULL AND subject_type='student'
    GROUP BY subject_key
  ),
  scored AS (
    SELECT ro.sid, ro.cid,
      sa.pct AS attendance, re.percentage AS recent_pct,
      sa.days AS att_days, ec.n AS exam_n,
      -- factor flags
      (sa.pct IS NOT NULL AND ca2.pct IS NOT NULL AND (ca2.pct - sa.pct) > 15)                          AS f_att,
      (re.pr IS NOT NULL AND re.pr <= 0.25)                                                              AS f_quart,
      (h.older_avg IS NOT NULL AND ch.cls_older_avg IS NOT NULL AND ch.cls_recent_avg IS NOT NULL
        AND h.older_avg >= ch.cls_older_avg AND h.recent_avg < ch.cls_recent_avg)                        AS f_drop,
      (coalesce(fn.n,0) >= 3)                                                                            AS f_flags,
      coalesce(fn.n,0) AS flag_n,
      ca2.pct AS class_att
    FROM roster ro
    LEFT JOIN stu_att sa ON sa.sid = ro.sid
    LEFT JOIN cls_att ca2 ON ca2.cid = ro.cid
    LEFT JOIN recent re ON re.sid = ro.sid
    LEFT JOIN halves h ON h.sid = ro.sid
    LEFT JOIN cls_halves ch ON ch.cid = ro.cid
    LEFT JOIN exam_counts ec ON ec.sid = ro.sid
    LEFT JOIN flagn fn ON fn.sid_text = ro.sid::text
  ),
  final AS (
    SELECT sid, cid, attendance, recent_pct,
      (CASE WHEN f_att THEN w_att ELSE 0 END
       + CASE WHEN f_quart THEN w_quart ELSE 0 END
       + CASE WHEN f_drop THEN w_drop ELSE 0 END
       + CASE WHEN f_flags THEN w_flags ELSE 0 END) AS sc,
      f_att, f_quart, f_drop, flag_n, att_days, exam_n
    FROM scored
    WHERE coalesce(att_days,0) >= 10 AND coalesce(exam_n,0) >= 2   -- cold-start exclusion
  )
  SELECT f.sid, f.cid, f.sc::int AS score,
    CASE WHEN f.sc >= b_red THEN 'red' WHEN f.sc >= b_amber THEN 'amber' ELSE 'yellow' END AS band,
    trim(BOTH ', ' FROM concat_ws(', ',
      CASE WHEN f.f_quart THEN 'recent marks among the lowest in class' END,
      CASE WHEN f.f_att   THEN 'attendance well below class' END,
      CASE WHEN f.f_drop  THEN 'was above average, now below' END,
      CASE WHEN f.flag_n >= 3 THEN f.flag_n || ' active flags' END
    )) AS reason,
    f.attendance, f.recent_pct,
    CASE WHEN f.f_drop THEN 'down' ELSE 'flat' END AS trend,
    f.flag_n::int AS active_flags
  FROM final f
  WHERE f.sc >= v_min;
END $$;

-- 12b) Students-needing-attention table (paginates the scored set + joins display fields).
CREATE OR REPLACE FUNCTION public.dash_students_attention(
  p_weights jsonb DEFAULT NULL, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 10, p_offset int DEFAULT 0, p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb; v_total int;
        v_class uuid := nullif(p_filters->>'class_id','')::uuid;
        v_band  text := nullif(p_filters->>'band','');   -- 'red' | 'amber' | NULL(all)
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  WITH s AS (
    SELECT * FROM public.dash_score_students(v_inst, p_weights)
    WHERE (v_class IS NULL OR class_id = v_class)
      AND (v_band IS NULL
           OR (v_band='red' AND band='red')
           OR (v_band='amber' AND band IN ('red','amber')))
  )
  SELECT count(*) INTO v_total FROM s;

  WITH s AS (
    SELECT * FROM public.dash_score_students(v_inst, p_weights)
    WHERE (v_class IS NULL OR class_id = v_class)
      AND (v_band IS NULL OR (v_band='red' AND band='red') OR (v_band='amber' AND band IN ('red','amber')))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'student_id', s.student_id, 'name', p.full_name, 'roll', p.roll_number,
           'class', c.name || coalesce(' '||c.section,''),
           'band', s.band, 'reason', s.reason,
           'attendance', s.attendance, 'recent_pct', s.recent_pct, 'trend', s.trend,
           'active_flags', s.active_flags)
           ORDER BY CASE s.band WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END, s.recent_pct ASC NULLS FIRST), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT * FROM s ORDER BY CASE band WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END, recent_pct ASC NULLS FIRST
    LIMIT p_limit OFFSET p_offset
  ) s
  JOIN profiles p ON p.id = s.student_id
  JOIN classes c ON c.id = s.class_id;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;

-- 13) Teachers table — reads auth.users.last_sign_in_at (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.dash_teachers_table(
  p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 10, p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_tz text; v_today date; v_rows jsonb; v_total int;
        v_roles text[] := CASE WHEN p_filters ? 'roles'
                               THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'roles'))
                               ELSE ARRAY['teacher','coordinator','employee'] END;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT timezone INTO v_tz FROM institutions WHERE id = v_inst;
  v_today := (now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date;

  WITH staff AS (
    SELECT DISTINCT ur.user_id, ur.role::text AS role
    FROM user_roles ur
    WHERE ur.institution_id = v_inst AND ur.role::text = ANY(v_roles)
  )
  SELECT count(*) INTO v_total FROM staff;

  WITH staff AS (
    SELECT DISTINCT ON (ur.user_id) ur.user_id, ur.role::text AS role
    FROM user_roles ur WHERE ur.institution_id = v_inst AND ur.role::text = ANY(v_roles)
  ),
  enriched AS (
    SELECT st.user_id, p.full_name, st.role, p.created_at AS profile_created,
      (SELECT w.name FROM wing_assignments wa JOIN wings w ON w.id = wa.wing_id WHERE wa.user_id = st.user_id LIMIT 1) AS wing,
      (SELECT count(DISTINCT ca.class_id) FROM class_assignments ca WHERE ca.user_id = st.user_id AND ca.role='teacher') AS classes,
      (SELECT round((count(*) FILTER (WHERE sar.status='present' OR (sar.status='late')))*100.0/NULLIF(count(*),0),1)
         FROM staff_attendance_records sar
         WHERE sar.staff_id = st.user_id AND sar.date > v_today - 30 AND sar.date <= v_today) AS attendance_30d,
      (SELECT u.last_sign_in_at FROM auth.users u WHERE u.id = st.user_id) AS last_login,
      (SELECT count(*) FROM exams e WHERE e.created_by = st.user_id AND e.institution_id = v_inst
         AND e.created_at > now() - INTERVAL '30 days') AS exams_30d,
      (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
         AND df.subject_type='teacher' AND df.subject_key = st.user_id::text) AS active_flags
    FROM staff st JOIN profiles p ON p.id = st.user_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', user_id, 'name', full_name, 'role', role, 'wing', wing,
           'classes', classes, 'attendance_30d', attendance_30d,
           'last_login', last_login, 'exams_30d', exams_30d, 'active_flags', active_flags,
           'is_new', profile_created > now() - INTERVAL '7 days')
           -- needs-attention first: stale login / low attendance / unfilled, but keep new staff out of "inactive" top
           ORDER BY (profile_created > now() - INTERVAL '7 days'),
                    (last_login IS NULL OR last_login < now() - INTERVAL '7 days') DESC,
                    coalesce(attendance_30d, 0) ASC), '[]'::jsonb)
    INTO v_rows
  FROM (SELECT * FROM enriched
        ORDER BY (profile_created > now() - INTERVAL '7 days'),
                 (last_login IS NULL OR last_login < now() - INTERVAL '7 days') DESC,
                 coalesce(attendance_30d,0) ASC
        LIMIT p_limit OFFSET p_offset) enriched;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;

-- 14) Recent exams table.
CREATE OR REPLACE FUNCTION public.dash_recent_exams(
  p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 20, p_offset int DEFAULT 0,
  p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb; v_total int;
        v_status text := nullif(p_filters->>'status','');
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);

  SELECT count(*) INTO v_total FROM exams e
  WHERE e.institution_id = v_inst AND (v_status IS NULL OR e.status::text = v_status);

  WITH ex AS (
    SELECT e.id, e.title, e.status::text AS status, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date,
           (SELECT string_agg(DISTINCT us.name, ', ') FROM exam_subjects es JOIN universal_subjects us ON us.id=es.subject_id WHERE es.exam_id=e.id) AS subjects,
           (SELECT string_agg(DISTINCT c.name, ', ') FROM exam_classes ec JOIN classes c ON c.id=ec.class_id WHERE ec.exam_id=e.id) AS classes,
           (SELECT count(*) FROM student_exam_attempts a WHERE a.exam_id=e.id AND a.is_submitted) AS attempted,
           (SELECT count(*) FROM class_assignments ca WHERE ca.role='student'
              AND ca.class_id IN (SELECT class_id FROM exam_classes WHERE exam_id=e.id)) AS assigned,
           (SELECT round(avg(fr.percentage),1) FROM final_results fr
              JOIN student_exam_attempts a ON a.id=fr.attempt_id WHERE a.exam_id=e.id) AS avg_pct,
           (SELECT count(*) FROM dashboard_flags df WHERE df.institution_id=v_inst AND df.resolved_at IS NULL
              AND df.subject_type='exam' AND df.subject_key=e.id::text) AS active_flags
    FROM exams e
    WHERE e.institution_id = v_inst AND (v_status IS NULL OR e.status::text = v_status)
    ORDER BY exam_date DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT coalesce(jsonb_agg(row_to_json(ex) ORDER BY ex.exam_date DESC NULLS LAST), '[]'::jsonb) INTO v_rows FROM ex;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;

GRANT EXECUTE ON FUNCTION public.dash_classes_table(jsonb,int,int,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_score_students(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_students_attention(jsonb,jsonb,int,int,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_teachers_table(jsonb,int,int,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_recent_exams(jsonb,int,int,uuid) TO authenticated;
```

> **Executor note (ordering):** `dash_score_students` is referenced by `dash_kpi_summary` (Task 5). Put `dash_score_students` in the helpers migration (Task 4) so it exists first, OR apply this table-RPC migration before the KPI migration. The function bodies above are the source of truth regardless of file placement.

> **⚠️ Pilot-validation gate (CLAUDE.md spec §16):** `dash_score_students` encodes the weighted severity model with two documented approximations — (a) "dropped from top half to bottom half" uses class **average** as the split (not strict median), and (b) "recent" = the student's latest exam, "older half" = their earlier exams. After applying, run the verify query against pilot data and sanity-check the surfaced students with a teacher who knows them. Tune `src/lib/dashboardConstants.ts` (and the SQL defaults) if it misfires. A flag/score that fires wrongly destroys trust faster than one that doesn't fire.

- [ ] **Step 2: Apply** (after go-ahead; ensure `dash_score_students` exists before the KPI RPC).

- [ ] **Step 3: Verify**

```sql
SELECT public.dash_classes_table('{}'::jsonb, 10, 0);
SELECT public.dash_students_attention(NULL, '{}'::jsonb, 10, 0);
SELECT public.dash_teachers_table('{}'::jsonb, 10, 0);
SELECT public.dash_recent_exams('{}'::jsonb, 20, 0);
```
Expected: each returns `{rows:[...], total:N}` with real data. `dash_students_attention` returns only students past the cold-start gate scoring ≥ 20.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602100600_dashboard_table_rpcs.sql
git commit -m "feat(dashboard): table RPCs (classes, students-attention scoring, teachers, recent exams)"
```

---

## Task 15: Flags read RPC

**Files:** Create `supabase/migrations/20260602100700_dashboard_flags_read_rpc.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Returns unresolved flags for the institution (UI groups by category, sorts severity then newest).
CREATE OR REPLACE FUNCTION public.dash_get_flags(p_institution_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_inst uuid; v_rows jsonb;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'flag_code', flag_code, 'category', category, 'severity', severity,
           'status', status, 'subject_type', subject_type, 'subject_key', subject_key,
           'title', title, 'description', description, 'metric_value', metric_value,
           'context', context, 'link_url', link_url, 'assignee_id', assignee_id,
           'task_id', task_id, 'auto_created', auto_created, 'first_detected_at', first_detected_at)
           ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                    first_detected_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM dashboard_flags WHERE institution_id = v_inst AND resolved_at IS NULL;
  RETURN v_rows;
END $$;

GRANT EXECUTE ON FUNCTION public.dash_get_flags(uuid) TO authenticated;
```

- [ ] **Step 2: Apply** (after go-ahead).

- [ ] **Step 3: Verify**

Run: `SELECT public.dash_get_flags(NULL);`
Expected: `[]` (no flags until Phase 3), no error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260602100700_dashboard_flags_read_rpc.sql
git commit -m "feat(dashboard): dash_get_flags read RPC (returns [] until Phase 3 evaluator)"
```

---

## Task 16: Regenerate Supabase types

**Files:** Modify `src/integrations/supabase/types.ts`

- [ ] **Step 1: Regenerate**

Run: `npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts`
(or the repo's existing type-gen command if different — check `package.json` scripts first).

- [ ] **Step 2: Verify new objects are present**

Run: `npx tsc --noEmit`
Expected: exit 0. Confirm `exams.exam_type`, `institutions.dashboard_adoption_flags_enabled`, the `dashboard_flags` table, and the `dash_*` functions appear under `Database["public"]["Functions"]`.

- [ ] **Step 3: Build**

Run: `npx vite build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(dashboard): regenerate supabase types for Phase 1 schema"
```

---

## Task 17: `exam_type` picker in the exam-creation flow

**Files:** Modify the exam-creation form component + `src/hooks/useSaveExam.ts`

- [ ] **Step 1: Locate the exam-create form & its state**

Run: `grep -rn "useSaveExam\|exam_mode\|examMode" src/components src/pages | grep -i exam`
Find the component that builds the exam payload passed to `useSaveExam`. Read it to see how `exam_mode` (or title/description) is collected — mirror that pattern for `exam_type`.

- [ ] **Step 2: Add the type selector (shadcn Select)**

In the exam-create form, beside the existing mode/title fields, add (match surrounding label/field markup, no raw HTML — CLAUDE.md UI rules):

```tsx
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// in component state:
const [examType, setExamType] = useState<"term" | "unit" | "weekly" | "unspecified">("unit");

// in JSX:
<div className="space-y-2">
  <Label htmlFor="exam-type">Exam type</Label>
  <Select value={examType} onValueChange={(v) => setExamType(v as typeof examType)}>
    <SelectTrigger id="exam-type"><SelectValue placeholder="Select type" /></SelectTrigger>
    <SelectContent>
      <SelectItem value="term">Term exam</SelectItem>
      <SelectItem value="unit">Unit test</SelectItem>
      <SelectItem value="weekly">Weekly test</SelectItem>
      <SelectItem value="unspecified">Other / unspecified</SelectItem>
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 3: Thread `exam_type` into the save payload**

In `useSaveExam.ts`, add `exam_type` to the `exams` insert/update payload (the hook builds an object inserted into `exams`). Add `examType` to the form's call to the hook. Because the generated types now include `exam_type`, no cast is needed.

```ts
// in the exams insert/update object inside useSaveExam:
exam_type: input.examType ?? "unspecified",
```
Add `examType?: "term" | "unit" | "weekly" | "unspecified"` to the hook's input type.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx eslint src/hooks/useSaveExam.ts <exam-create form path> && npx vite build`
Expected: all exit 0. Manually create an exam, pick "Unit test", save, then `SELECT id, title, exam_type FROM exams ORDER BY created_at DESC LIMIT 1;` → shows `unit`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSaveExam.ts <exam-create form path>
git commit -m "feat(dashboard): exam_type picker in exam-creation flow"
```

---

## Self-review (completed by author)

**Spec coverage (Phase-1 slice):** exam_type column+picker ✓ (T1,T17); kill switch ✓ (T2); dashboard_flags scaffold + RLS + identity index ✓ (T3); admin guard + current-AY helper ✓ (T4); KPI RPC ✓ (T5); 5 widget RPCs ✓ (T6–10); 4 table RPCs incl. weighted scoring with TS-tunable weights ✓ (T11–14); flags read RPC ✓ (T15); type regen + build ✓ (T16). Evaluator + flag/task RPCs correctly deferred to Phase 3 (spec §13). Connection-health, report, and all UI deferred to Phases 2–4.

**Placeholder scan:** No TBD/TODO. The one cross-reference risk (KPI → `dash_score_students` ordering) is called out explicitly with a concrete resolution.

**Type consistency:** RPC names used in verify steps match definitions. JSON keys returned by each RPC are the ones the Phase-2 hooks will consume (documented in spec §6.2). `dash_score_students` columns (student_id, class_id, score, band, reason, attendance, recent_pct, trend, active_flags) are consumed unchanged by `dash_students_attention` and counted by `dash_kpi_summary`.

**Known approximations flagged for pilot tuning:** severity "drop" detection (class-average split) and "recent vs older" windowing in `dash_score_students`; weekly delta for "students who need help" returns NULL in v1 (no historical snapshot).
