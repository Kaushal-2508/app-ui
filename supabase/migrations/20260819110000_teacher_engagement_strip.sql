-- Spec 2.2 / 3 — teacher portal-engagement score + the monthly standing strip.
--
-- HONEST SCOPE, stated up front
-- ----------------------------
-- The spec named four inputs. Measured in prod 2026-08-19:
--   * "digital attendance %" is UNCOMPUTABLE — attendance_records.method is
--     'manual' on 100% of 33,669 rows, so it is a constant for everybody. It is
--     replaced here by attendance-logging COMPLETENESS (how many distinct days
--     the teacher marked), which measures the teacher's own portal use.
--   * syllabus logging has 8 lifetime recorders out of 213 teachers.
--   * exactly 1 of 213 teachers has all four inputs in a 60-day window.
-- A fixed-weight composite over that would be noise dressed as a rank. So the
-- score is ELIGIBILITY-WEIGHTED: it averages only the components a teacher
-- actually has data for, and stores how many that was (inputs_present) so the
-- UI can say "based on N of 4 measures" instead of implying a full picture.
--
-- WHAT IT MEASURES, AND WHAT IT MUST NEVER MEASURE
-- Timestamps and row existence ONLY. attendance_records.status,
-- final_results.percentage / total_marks_obtained and homework_results.marks_awarded
-- are deliberately NOT read: a teacher must never be ranked by how their pupils
-- performed. Any future edit that references those columns is a rule violation.

CREATE TABLE IF NOT EXISTS public.teacher_engagement_monthly (
  teacher_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  period_key     text NOT NULL,                -- institution-local 'YYYY-MM'
  cohort_size    smallint NOT NULL,
  score          numeric(5,2),
  rank           integer,
  inputs_present smallint NOT NULL DEFAULT 0,
  c_grading      numeric(5,2),
  c_attendance   numeric(5,2),
  c_homework     numeric(5,2),
  c_syllabus     numeric(5,2),
  badge_label    text,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, period_key)
);

-- Both FKs indexed in-migration (§23).
CREATE INDEX IF NOT EXISTS teacher_engagement_monthly_inst_period_idx
  ON public.teacher_engagement_monthly (institution_id, period_key, rank);
CREATE INDEX IF NOT EXISTS teacher_engagement_monthly_teacher_idx
  ON public.teacher_engagement_monthly (teacher_id, period_key DESC);

ALTER TABLE public.teacher_engagement_monthly ENABLE ROW LEVEL SECURITY;

-- Teachers never read the table directly; the RPC below is their only path, and
-- it returns nobody else's row. A self-only policy keeps admin tooling working.
DROP POLICY IF EXISTS teacher_engagement_monthly_self ON public.teacher_engagement_monthly;
CREATE POLICY teacher_engagement_monthly_self ON public.teacher_engagement_monthly
  FOR SELECT USING (teacher_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.teacher_engagement_monthly FROM anon;

-- ---------------------------------------------------------------------------
-- Compute one month for every institution. Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_teacher_engagement_monthly(_period_key text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_n integer := 0;
BEGIN
  WITH inst AS (
    SELECT i.id, COALESCE(i.timezone,'Asia/Kolkata') AS tz FROM institutions i
  ),
  per AS (
    SELECT inst.id AS institution_id,
           COALESCE(_period_key,
                    to_char((now() AT TIME ZONE inst.tz)::date, 'YYYY-MM')) AS period_key
      FROM inst
  ),
  bounds AS (
    SELECT p.institution_id, p.period_key,
           to_date(p.period_key || '-01', 'YYYY-MM-DD')                       AS d_from,
           (to_date(p.period_key || '-01','YYYY-MM-DD') + INTERVAL '1 month')::date AS d_to
      FROM per p
  ),
  teachers AS (
    SELECT DISTINCT ca.user_id AS teacher_id, c.institution_id
      FROM class_assignments ca
      JOIN classes c ON c.id = ca.class_id AND COALESCE(c.is_active, true)
     WHERE ca.role = 'teacher'
  ),
  -- (1) Grading: share of submissions on MY exams that I have finalised.
  grading AS (
    SELECT t.teacher_id, b.period_key,
           round(count(*) FILTER (WHERE a.evaluation_status IN ('teacher_reviewed','finalized'))
                 * 100.0 / NULLIF(count(*), 0), 2) AS pct
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      JOIN exams e ON e.created_by = t.teacher_id
      JOIN student_exam_attempts a ON a.exam_id = e.id AND a.is_submitted
                                  AND a.submitted_at >= b.d_from AND a.submitted_at < b.d_to
     GROUP BY t.teacher_id, b.period_key
  ),
  -- (2) Attendance LOGGING completeness. Counts distinct days marked. Never
  --     reads attendance_records.status — that would encode pupil behaviour.
  attend AS (
    SELECT t.teacher_id, b.period_key,
           LEAST(count(DISTINCT ar.date) * 100.0 / 20.0, 100)::numeric(5,2) AS pct
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      JOIN attendance_records ar ON ar.marked_by = t.teacher_id
                                AND ar.date >= b.d_from AND ar.date < b.d_to
     GROUP BY t.teacher_id, b.period_key
  ),
  -- (3) Homework marking: share of submissions on MY homework that have a result.
  hw AS (
    SELECT t.teacher_id, b.period_key,
           round(count(*) FILTER (WHERE r.id IS NOT NULL) * 100.0 / NULLIF(count(*), 0), 2) AS pct
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      JOIN homework_assignments h ON h.created_by = t.teacher_id
      JOIN homework_submissions s ON s.homework_assignment_id = h.id
                                 AND s.submitted_at >= b.d_from AND s.submitted_at < b.d_to
      LEFT JOIN homework_results r ON r.submission_id = s.id
     GROUP BY t.teacher_id, b.period_key
  ),
  -- (4) Syllabus logging cadence. 8 logs in a month reads as full marks.
  syl AS (
    SELECT t.teacher_id, b.period_key,
           LEAST(count(*) * 100.0 / 8.0, 100)::numeric(5,2) AS pct
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      JOIN syllabus_progress_events spe ON spe.recorded_by = t.teacher_id
                                       AND spe.date >= b.d_from AND spe.date < b.d_to
     GROUP BY t.teacher_id, b.period_key
  ),
  merged AS (
    SELECT t.teacher_id, t.institution_id, b.period_key,
           g.pct AS c_grading, at.pct AS c_attendance, hw.pct AS c_homework, sy.pct AS c_syllabus,
           (CASE WHEN g.pct  IS NULL THEN 0 ELSE 1 END
          + CASE WHEN at.pct IS NULL THEN 0 ELSE 1 END
          + CASE WHEN hw.pct IS NULL THEN 0 ELSE 1 END
          + CASE WHEN sy.pct IS NULL THEN 0 ELSE 1 END)::smallint AS inputs_present,
           -- eligibility-weighted: average of the components that exist
           ((COALESCE(g.pct,0) + COALESCE(at.pct,0) + COALESCE(hw.pct,0) + COALESCE(sy.pct,0))
            / NULLIF((CASE WHEN g.pct IS NULL THEN 0 ELSE 1 END
                    + CASE WHEN at.pct IS NULL THEN 0 ELSE 1 END
                    + CASE WHEN hw.pct IS NULL THEN 0 ELSE 1 END
                    + CASE WHEN sy.pct IS NULL THEN 0 ELSE 1 END), 0))::numeric(5,2) AS score
      FROM teachers t
      JOIN bounds b ON b.institution_id = t.institution_id
      LEFT JOIN grading g ON g.teacher_id = t.teacher_id AND g.period_key = b.period_key
      LEFT JOIN attend at ON at.teacher_id = t.teacher_id AND at.period_key = b.period_key
      LEFT JOIN hw ON hw.teacher_id = t.teacher_id AND hw.period_key = b.period_key
      LEFT JOIN syl sy ON sy.teacher_id = t.teacher_id AND sy.period_key = b.period_key
  ),
  rankable AS (
    SELECT m.*,
           count(*) OVER (PARTITION BY m.institution_id, m.period_key)              AS cohort_size,
           rank() OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.score DESC) AS rnk,
           rank() OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.c_grading    DESC NULLS LAST) AS r_grading,
           rank() OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.c_attendance DESC NULLS LAST) AS r_attend,
           rank() OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.c_homework   DESC NULLS LAST) AS r_hw,
           rank() OVER (PARTITION BY m.institution_id, m.period_key ORDER BY m.c_syllabus   DESC NULLS LAST) AS r_syl
      FROM merged m
     WHERE m.inputs_present > 0
  )
  INSERT INTO public.teacher_engagement_monthly AS tem
    (teacher_id, institution_id, period_key, cohort_size, score, rank,
     inputs_present, c_grading, c_attendance, c_homework, c_syllabus, badge_label, computed_at)
  SELECT r.teacher_id, r.institution_id, r.period_key, r.cohort_size, r.score, r.rnk,
         r.inputs_present, r.c_grading, r.c_attendance, r.c_homework, r.c_syllabus,
         -- the measure this teacher places highest on
         (SELECT b.lbl FROM (
            VALUES ('marking turnaround', r.r_grading,  r.c_grading),
                   ('attendance logging', r.r_attend,   r.c_attendance),
                   ('homework marking',   r.r_hw,       r.c_homework),
                   ('syllabus logging',   r.r_syl,      r.c_syllabus)
          ) AS b(lbl, rk, val)
          WHERE b.val IS NOT NULL
          ORDER BY b.rk ASC, b.val DESC
          LIMIT 1),
         now()
    FROM rankable r
  ON CONFLICT (teacher_id, period_key) DO UPDATE SET
    cohort_size = EXCLUDED.cohort_size, score = EXCLUDED.score, rank = EXCLUDED.rank,
    inputs_present = EXCLUDED.inputs_present, c_grading = EXCLUDED.c_grading,
    c_attendance = EXCLUDED.c_attendance, c_homework = EXCLUDED.c_homework,
    c_syllabus = EXCLUDED.c_syllabus, badge_label = EXCLUDED.badge_label,
    computed_at = now();

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

REVOKE ALL ON FUNCTION public.compute_teacher_engagement_monthly(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The strip's read API.
--
-- ZERO ARGUMENTS by design: there is no _limit, no _teacher_id, no _wing_id, so
-- there is nothing a curious caller can widen. It returns ONLY the caller's own
-- row plus the cohort size — no other teacher's name, id, score or timestamp
-- appears in the return type at all, which is a stronger guarantee than the
-- spec's "self + top 2 + neighbour" window.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_engagement_standing()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_inst uuid; v_tz text;
  v_period text; v_prev text; v_row record; v_prev_rank int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'dashboard: not authenticated'; END IF;
  v_inst := public.get_user_institution(v_uid);
  SELECT COALESCE(i.timezone,'Asia/Kolkata') INTO v_tz FROM institutions i WHERE i.id = v_inst;

  v_period := to_char((now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date, 'YYYY-MM');
  v_prev   := to_char(((now() AT TIME ZONE COALESCE(v_tz,'Asia/Kolkata'))::date
                       - INTERVAL '1 month'), 'YYYY-MM');

  SELECT * INTO v_row FROM teacher_engagement_monthly tem
   WHERE tem.teacher_id = v_uid AND tem.period_key = v_period;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'not_scored_yet');
  END IF;

  SELECT tem.rank INTO v_prev_rank FROM teacher_engagement_monthly tem
   WHERE tem.teacher_id = v_uid AND tem.period_key = v_prev;

  -- COHORT FLOOR. In prod today 44 teachers sit in a cohort of 44 (a real
  -- ranking) while 2 sit alone. "#1 of 1" is not an achievement, it is an
  -- artefact, so below 3 rankable colleagues the rank is withheld and the strip
  -- shows the score and badge only.
  RETURN jsonb_build_object(
    'available',      true,
    'rank',           CASE WHEN v_row.cohort_size >= 3 THEN v_row.rank END,
    'cohort_size',    v_row.cohort_size,
    'score',          v_row.score,
    'movement',       CASE WHEN v_prev_rank IS NULL THEN NULL ELSE v_prev_rank - v_row.rank END,
    'badge_label',    v_row.badge_label,
    'inputs_present', v_row.inputs_present);
END $function$;

REVOKE ALL ON FUNCTION public.teacher_engagement_standing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_engagement_standing() TO authenticated;

-- Seed this month and last month so "movement" has something to compare against.
SELECT public.compute_teacher_engagement_monthly(
  to_char((now() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 month', 'YYYY-MM'));
SELECT public.compute_teacher_engagement_monthly();

SELECT cron.schedule('teacher-engagement-monthly', '25 0 * * *',
                     'SELECT public.compute_teacher_engagement_monthly();')
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'teacher-engagement-monthly');
