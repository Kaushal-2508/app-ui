-- A date-range filter on "Exam performance over time", on the platform's
-- existing five windows rather than a sixth set invented for this card.
--
-- The vocabulary already exists and is already user-visible: TREND_RANGE_OPTIONS
-- in src/hooks/useStudentClassComparison.ts drives the student dashboard's Score
-- Trend and Attendance cards, and 20260813120000 fixed its SQL semantics.
-- Reusing 'tm' | '1m' | '3m' | '6m' | 'ay' verbatim means "Last 3 months" means
-- the same thing to an admin and to a student, which is the whole point of that
-- file calling itself a single source of truth.
--
-- dash_range_window resolves a range token to a concrete window so the CASE
-- lives in exactly one place. Its semantics are lifted from
-- student_attendance_summary, unchanged:
--
--   tm            calendar month to date
--   1m / 3m / 6m  trailing window measured back from today
--   ay            the academic year in progress, clamped to today
--   anything else the 3m default, never an exception -- an unrecognised token
--                 from a stale client should narrow the chart, not break it
--
-- "today" is institution-local (§24). A bare CURRENT_DATE would put every IST
-- school on the wrong day for five and a half hours each night, and month-to-
-- date is exactly the window where that shows up as a missing first exam.
-- dash_current_academic_year still uses CURRENT_DATE to pick WHICH year is
-- current, so the local date is passed in and compared here instead.
BEGIN;

CREATE OR REPLACE FUNCTION public.dash_range_window(
  p_range text,
  p_institution_id uuid
) RETURNS TABLE(from_date date, to_date date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_tz text; v_today date; v_range text;
  v_ay_start date; v_ay_end date;
BEGIN
  v_range := CASE WHEN p_range IN ('tm','1m','3m','6m','ay') THEN p_range ELSE '3m' END;

  SELECT timezone INTO v_tz FROM institutions WHERE id = p_institution_id;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  IF v_range = 'ay' THEN
    SELECT ay.starts_on::date, ay.ends_on::date INTO v_ay_start, v_ay_end
      FROM cal_academic_years ay
     WHERE ay.institution_id = p_institution_id
     ORDER BY (v_today BETWEEN ay.starts_on::date AND ay.ends_on::date) DESC,
              ay.is_active DESC, ay.starts_on::date DESC
     LIMIT 1;
    from_date := COALESCE(v_ay_start, (v_today - INTERVAL '1 year')::date);
    to_date   := LEAST(COALESCE(v_ay_end, v_today), v_today);
  ELSIF v_range = 'tm' THEN
    from_date := date_trunc('month', v_today)::date;
    to_date   := v_today;
  ELSE
    from_date := (v_today - (CASE v_range
                               WHEN '6m' THEN INTERVAL '6 months'
                               WHEN '3m' THEN INTERVAL '3 months'
                               ELSE           INTERVAL '1 month'
                             END))::date;
    to_date := v_today;
  END IF;

  RETURN NEXT;
END $function$;

REVOKE EXECUTE ON FUNCTION public.dash_range_window(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_range_window(text, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_range_window(text, uuid) TO authenticated;

-- p_range is appended, so the three-argument signature from 20260822102300 is
-- dropped: CREATE OR REPLACE across a different argument count adds an overload
-- rather than replacing, and PostgREST cannot resolve a call matching both.
DROP FUNCTION IF EXISTS public.dash_exam_trend(integer, uuid, uuid);

CREATE OR REPLACE FUNCTION public.dash_exam_trend(
  p_limit integer DEFAULT 8,
  p_institution_id uuid DEFAULT NULL::uuid,
  p_class_id uuid DEFAULT NULL::uuid,
  p_range text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_inst uuid; v_rows jsonb; v_from date; v_to date;
BEGIN
  v_inst := public.dash_resolve_institution(p_institution_id);
  p_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 24);

  -- NULL means "no date restriction", which is what every caller written before
  -- this migration expects. Only an explicit token narrows the window, so the
  -- teacher and coordinator variants and any cached client keep their behaviour.
  IF p_range IS NOT NULL THEN
    SELECT w.from_date, w.to_date INTO v_from, v_to
      FROM public.dash_range_window(p_range, v_inst) w;
  END IF;

  IF p_class_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM classes c
                      WHERE c.id = p_class_id AND c.institution_id = v_inst) THEN
    RAISE EXCEPTION 'dashboard: class not in institution';
  END IF;

  WITH recent AS (
    SELECT e.id, e.title, e.exam_type,
           COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date) AS exam_date
    FROM exams e
    WHERE e.institution_id = v_inst
      AND e.status IN ('published','active','completed')
      -- The window is applied to the SAME expression the bar is dated by, so an
      -- exam can never sit outside the range it is plotted at.
      AND (v_from IS NULL
           OR COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
              BETWEEN v_from AND v_to)
      -- only exams that can actually be plotted, for the chosen class
      AND EXISTS (
        SELECT 1
          FROM student_exam_attempts a
          JOIN final_results fr ON fr.attempt_id = a.id
         WHERE a.exam_id = e.id
           AND (p_class_id IS NULL OR a.class_id = p_class_id)
      )
    ORDER BY exam_date DESC NULLS LAST
    LIMIT p_limit
  ),
  agg AS (
    SELECT r.id, r.title, r.exam_type, r.exam_date,
           round(avg(fr.percentage),1) AS avg_pct,
           count(fr.id) AS participation
    FROM recent r
    LEFT JOIN student_exam_attempts a
           ON a.exam_id = r.id
          AND (p_class_id IS NULL OR a.class_id = p_class_id)
    LEFT JOIN final_results fr ON fr.attempt_id = a.id
    GROUP BY r.id, r.title, r.exam_type, r.exam_date
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'exam_id', id, 'title', title, 'exam_type', exam_type,
           'avg_pct', avg_pct, 'participation', participation, 'exam_date', exam_date)
           ORDER BY exam_date ASC), '[]'::jsonb)
    INTO v_rows FROM agg;
  RETURN v_rows;
END $function$;

REVOKE EXECUTE ON FUNCTION public.dash_exam_trend(integer, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dash_exam_trend(integer, uuid, uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dash_exam_trend(integer, uuid, uuid, text) TO authenticated;

COMMIT;
