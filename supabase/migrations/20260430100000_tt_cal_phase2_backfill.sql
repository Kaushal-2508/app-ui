-- =============================================================
-- TIMETABLE + ACADEMIC CALENDAR REBUILD — PHASE 2
-- -------------------------------------------------------------
-- One-shot backfill of legacy tables into the new tt_* / cal_*
-- schema. Idempotent: re-running is safe (uses ON CONFLICT
-- DO NOTHING). Wrapped in a single transaction. Skipped rows
-- log to RAISE NOTICE for manual review.
-- =============================================================

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
  c_struct   INTEGER := 0;
  c_slots    INTEGER := 0;
  c_csa      INTEGER := 0;
  c_res      INTEGER := 0;
  c_tslots   INTEGER := 0;
  c_plans    INTEGER := 0;
  c_ay       INTEGER := 0;
  c_events   INTEGER := 0;
  c_skipped  INTEGER := 0;
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
  -- Synthesizes academic_year from the parent class.
  WITH ins AS (
    INSERT INTO public.tt_class_structure
      (institution_id, class_id, structure_id, academic_year, publish_status, created_at, updated_at)
    SELECT
      cps.institution_id,
      cps.class_id,
      cps.structure_id,
      COALESCE(cl.academic_year, '2026-27') AS academic_year,
      'published',  -- Old system had no draft state; existing rows treated as published.
      cps.created_at,
      cps.updated_at
    FROM public.class_period_structure cps
    LEFT JOIN public.classes cl ON cl.id = cps.class_id
    ON CONFLICT (class_id, academic_year) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_csa FROM ins;
  step := 'tt_class_structure'; copied := c_csa; skipped := 0; RETURN NEXT;

  -- --- shared_resources -> tt_resources ---
  WITH ins AS (
    INSERT INTO public.tt_resources (id, institution_id, name, kind, capacity, description, created_at, updated_at)
    SELECT id, institution_id, name, resource_type, count, description, created_at, updated_at
    FROM public.shared_resources
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_res FROM ins;
  step := 'tt_resources'; copied := c_res; skipped := 0; RETURN NEXT;

  -- --- timetable_slots -> tt_slots (preserve IDs)
  -- Legacy timetable_slots has no `notes` column; new tt_slots adds
  -- it (nullable) so the slot drawer in Plan 2 can capture per-slot
  -- notes. NULL the column on copy.
  WITH ins AS (
    INSERT INTO public.tt_slots
      (id, institution_id, class_id, period_slot_id, day, academic_year, slot_type,
       subject_id, teacher_id, resource_id, notes, created_at, updated_at)
    SELECT
      id, institution_id, class_id, period_slot_id, day, academic_year, slot_type,
      subject_id, teacher_id, resource_id, NULL::TEXT AS notes, created_at, updated_at
    FROM public.timetable_slots
    ON CONFLICT (id) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_tslots FROM ins;
  step := 'tt_slots'; copied := c_tslots; skipped := 0; RETURN NEXT;

  -- --- lesson_plans -> tt_lesson_plans (preserve IDs)
  -- Sets owner_teacher_id from the legacy teacher_id column.
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

  -- --- Distinct academic_years from academic_calendar -> cal_academic_years ---
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
      false  -- Set is_active separately (admin can flip post-migration).
    FROM ay_rows ay
    ON CONFLICT (institution_id, code) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO c_ay FROM ins;
  step := 'cal_academic_years'; copied := c_ay; skipped := 0; RETURN NEXT;

  -- --- academic_calendar -> cal_events (with enum mapping) ---
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
$$;

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
