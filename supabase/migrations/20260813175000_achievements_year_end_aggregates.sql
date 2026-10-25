-- Year-end awarding for the two aggregate badges that no other path owns:
--   Grand Slam     (quest_log,  aggregate, 200 pts, diamond)
--   Double Century (legendary,  count,     200 pts, legendary)
--
-- WHY A SEPARATE FILE rather than editing award_year_end_badges():
-- 20260813170000 is a large, twice-reviewed function whose year resolution,
-- All-Star gaps-and-islands ranking and Class MVP tiebreaks were verified line by
-- line. Re-opening it to graft two more badges in risks regressing work that is
-- already correct. This function is additive, resolves the closed year by exactly
-- the same rule, and is scheduled from the same daily tick.
--
-- WHY THESE TWO ARE NOT EVENT-DRIVEN:
-- "Complete every exam scheduled in the academic year" cannot be evaluated
-- mid-year, because the year's later exams do not exist as rows yet, so
-- did_required = required is trivially true in April. Measured against production
-- on 2026-08-13, awarding Grand Slam from the evaluator would have handed a
-- 200-point diamond badge to 284 students 7.5 months early with no revoke path,
-- 243 of them in classes holding only 8 exams. A ratio floor cannot fix that:
-- ceil(0.80 * 1) = 1. Double Century is legendary, and the locked decision puts
-- every legendary badge at year end.
--
-- The evaluator still writes badge_progress for Double Century ("1 of 2") all
-- year. Progress is not an award.

CREATE OR REPLACE FUNCTION public.award_year_end_aggregates(
  _institution_id   uuid DEFAULT NULL,
  _academic_year_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Same 30-day window as award_year_end_badges: every re-run is a no-op, so a
  -- wide window is pure resilience against a missed tick.
  c_year_end_window constant int := 30;
  -- Volume floor. Without it a class that ran ONE exam all year hands its whole
  -- roster a 200-point diamond badge for sitting it. Mirrors the min-exams floor
  -- award_year_end_badges already applies to Undefeated for the same reason.
  c_grand_slam_min_exams constant int := 10;
  -- Completion floor from the locked spec: approved leave excuses an exam, but a
  -- student on extended leave must not earn it on a handful.
  c_grand_slam_floor constant numeric := 0.80;

  v_grand_slam uuid;
  v_double_ton uuid;
  v_awarded    int := 0;
  v_new_ids    uuid[] := ARRAY[]::uuid[];
BEGIN
  -- badge_type = 'student' on both lookups: name carries no unique constraint,
  -- so a teacher badge sharing the name would otherwise be written into students'
  -- user_badges rows.
  SELECT bd.id INTO v_grand_slam
    FROM badge_definitions bd
   WHERE bd.badge_type = 'student' AND bd.name = 'Grand Slam' AND bd.is_active
   ORDER BY bd.created_at, bd.id LIMIT 1;

  SELECT bd.id INTO v_double_ton
    FROM badge_definitions bd
   WHERE bd.badge_type = 'student' AND bd.name = 'Double Century' AND bd.is_active
   ORDER BY bd.created_at, bd.id LIMIT 1;

  IF v_grand_slam IS NULL AND v_double_ton IS NULL THEN
    RAISE WARNING 'award_year_end_aggregates: neither Grand Slam nor Double Century is an active student badge - nothing awarded';
    RETURN jsonb_build_object('ok', false, 'reason', 'no_badge_definitions');
  END IF;

  WITH years AS (
    -- Resolve the year to CLOSE by DATE, never by ay.is_active: is_active always
    -- points at the year currently RUNNING, so gating on it kills these badges
    -- permanently the moment a school rolls over.
    SELECT DISTINCT ON (i.id)
           i.id AS institution_id,
           COALESCE(i.timezone, 'Asia/Kolkata') AS tz,
           ay.starts_on, ay.ends_on, ay.code
    FROM institutions i
    CROSS JOIN LATERAL (
      SELECT (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date AS local_today
    ) t
    JOIN cal_academic_years ay
      ON ay.institution_id = i.id
     AND ( (_academic_year_id IS NOT NULL AND ay.id = _academic_year_id)
        OR (_academic_year_id IS NULL
            AND ay.ends_on <  t.local_today
            AND ay.ends_on >= t.local_today - c_year_end_window) )
    WHERE (_institution_id IS NULL OR i.id = _institution_id)
    ORDER BY i.id, ay.ends_on DESC
  ),
  -- Every student, with the closed year they belong to.
  roster AS (
    SELECT p.id AS student_id, y.institution_id, y.tz, y.starts_on, y.ends_on
    FROM years y
    JOIN profiles p   ON p.institution_id = y.institution_id
    JOIN user_roles ur ON ur.user_id = p.id AND ur.role = 'student'
  ),
  -- The exams scheduled for each student's class(es) inside the closed year.
  year_exams AS (
    SELECT DISTINCT r.student_id, r.institution_id, e.id AS exam_id,
           (COALESCE(e.scheduled_date, e.published_at, e.created_at) AT TIME ZONE r.tz)::date AS on_date
    FROM roster r
    JOIN class_assignments ca ON ca.user_id = r.student_id AND ca.role = 'student'
    JOIN exam_classes ec      ON ec.class_id = ca.class_id
    JOIN exams e              ON e.id = ec.exam_id
    WHERE e.status IN ('published', 'active', 'completed')
      AND (COALESCE(e.scheduled_date, e.published_at, e.created_at) AT TIME ZONE r.tz)::date
          BETWEEN r.starts_on AND r.ends_on
  ),
  -- Completed on EITHER plane. UNION (not UNION ALL) so an exam sat online and
  -- also present as a hybrid attempt counts once.
  completed AS (
    SELECT sea.student_id, sea.exam_id
      FROM student_exam_attempts sea WHERE sea.is_submitted
    UNION
    SELECT h.student_id, h.exam_id
      FROM hybrid_exam_attempts h WHERE h.submitted_at IS NOT NULL
  ),
  year_split AS (
    SELECT ye.student_id, ye.institution_id, ye.exam_id,
           EXISTS (SELECT 1 FROM leave_requests lr
                    WHERE lr.student_id = ye.student_id
                      AND lr.status = 'approved'
                      AND ye.on_date BETWEEN lr.start_date AND lr.end_date) AS on_leave,
           EXISTS (SELECT 1 FROM completed c
                    WHERE c.student_id = ye.student_id AND c.exam_id = ye.exam_id) AS done
    FROM year_exams ye
  ),
  grand AS (
    SELECT student_id, institution_id,
           count(*)                                      AS total_year,
           count(*) FILTER (WHERE NOT on_leave)          AS required,
           count(*) FILTER (WHERE NOT on_leave AND done) AS did_required,
           count(*) FILTER (WHERE done)                  AS did_year
    FROM year_split
    GROUP BY student_id, institution_id
  ),
  grand_winners AS (
    SELECT g.student_id, g.institution_id
    FROM grand g
    WHERE v_grand_slam IS NOT NULL
      AND g.required > 0                                     -- nothing required is not a sweep
      AND g.total_year >= c_grand_slam_min_exams             -- volume floor
      AND g.did_required = g.required                        -- every non-leave exam
      AND g.did_year >= ceil(c_grand_slam_floor * g.total_year)
  ),
  -- Double Century: exactly 100% in two or more DISTINCT exams inside the year.
  scored_raw AS (
    SELECT r.student_id, sea.exam_id, r.institution_id,
           -- Bonus marks can push a raw percentage past 100 on either plane.
           -- Clamping keeps "100%" meaning exactly 100 rather than "at least".
           LEAST(fr.percentage, 100)::numeric AS pct
    FROM roster r
    JOIN student_exam_attempts sea ON sea.student_id = r.student_id
    JOIN final_results fr          ON fr.attempt_id = sea.id
    JOIN exams e                   ON e.id = sea.exam_id
    WHERE fr.is_published AND fr.percentage IS NOT NULL
      AND (COALESCE(e.scheduled_date, e.published_at, e.created_at) AT TIME ZONE r.tz)::date
          BETWEEN r.starts_on AND r.ends_on
    UNION ALL
    SELECT r.student_id, h.exam_id, r.institution_id,
           LEAST(round(h.total_marks_awarded::numeric * 100 / h.total_max_marks::numeric, 2), 100)
    FROM roster r
    JOIN hybrid_exam_attempts h ON h.student_id = r.student_id
    JOIN exams e                ON e.id = h.exam_id
    WHERE h.status = 'evaluated'
      AND COALESCE(h.total_max_marks, 0) > 0
      AND h.total_marks_awarded IS NOT NULL
      AND (COALESCE(e.scheduled_date, e.published_at, e.created_at) AT TIME ZONE r.tz)::date
          BETWEEN r.starts_on AND r.ends_on
  ),
  -- One row per (student, exam): retakes and dual-plane rows must not double-count
  -- toward "TWO separate exams".
  scored AS (
    SELECT DISTINCT ON (sr.student_id, sr.exam_id)
           sr.student_id, sr.exam_id, sr.institution_id, sr.pct
    FROM scored_raw sr
    ORDER BY sr.student_id, sr.exam_id, sr.pct DESC
  ),
  century_winners AS (
    SELECT s.student_id, s.institution_id
    FROM scored s
    WHERE v_double_ton IS NOT NULL AND s.pct >= 100
    GROUP BY s.student_id, s.institution_id
    HAVING count(*) >= 2
  ),
  all_winners AS (
    SELECT student_id, institution_id, v_grand_slam AS badge_id FROM grand_winners
    UNION ALL
    SELECT student_id, institution_id, v_double_ton FROM century_winners
  ),
  ins AS (
    INSERT INTO user_badges (user_id, badge_id, institution_id, source_entity_type, metadata)
    SELECT w.student_id, w.badge_id, w.institution_id, 'year_end_aggregate',
           jsonb_build_object('awarded_by', 'award_year_end_aggregates')
    FROM all_winners w
    WHERE w.badge_id IS NOT NULL
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_new_ids FROM ins;

  v_awarded := COALESCE(array_length(v_new_ids, 1), 0);

  -- Notifications run in their OWN subtransaction, deliberately AFTER the award
  -- statement has completed. Sharing a CTE with the award INSERT means a
  -- notifications failure aborts the award with it, i.e. the notification path
  -- could revoke a badge. Losing a notification is recoverable; losing the badge
  -- is not.
  IF v_awarded > 0 THEN
    BEGIN
      INSERT INTO notifications (user_id, type, title, message, link, metadata)
      SELECT ub.user_id, 'badge_earned',
             'Badge earned: ' || bd.name,
             'You earned the "' || bd.name || '" badge (+' || bd.points || ' points).',
             '/achievements',
             jsonb_build_object('badge_id', bd.id, 'badge_name', bd.name, 'points', bd.points)
      FROM user_badges ub
      JOIN badge_definitions bd ON bd.id = ub.badge_id
      WHERE ub.id = ANY (v_new_ids);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'award_year_end_aggregates: awards committed but notifications failed: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'awarded', v_awarded);
END $$;

COMMENT ON FUNCTION public.award_year_end_aggregates(uuid, uuid) IS
  'Awards Grand Slam and Double Century for the most recently CLOSED academic year (ends_on within the last 30 institution-local days), or for _academic_year_id when ops passes one. Never keys off cal_academic_years.is_active. Idempotent. These two cannot be event-driven: mid-year the year''s later exams do not exist as rows, so Grand Slam would award trivially.';

-- Server-only. FROM PUBLIC first: Supabase grants EXECUTE to PUBLIC on every new
-- public function and anon inherits through it, so revoking the role by name
-- alone leaves the function callable (see 20260813145000).
REVOKE ALL ON FUNCTION public.award_year_end_aggregates(uuid, uuid) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  -- Guarded so a database without pg_cron (a local `supabase db reset` shadow DB)
  -- does not hard-fail the whole migration.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('achievements-year-end-aggregates');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'achievements-year-end-aggregates',
      '45 0 * * *',                       -- daily; a no-op on all but a few days a year
      $job$ SELECT public.award_year_end_aggregates(); $job$
    );
  END IF;
END $$;
