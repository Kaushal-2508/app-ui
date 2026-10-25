-- Teacher Targets, part 3 of 7: rolling period math and the two counters.
--
-- ROLLING, NOT CALENDAR ALIGNED. Nothing in this repo computes a rolling window
-- of N units from an anchor date; every existing engine is calendar-aligned
-- ('YYYY-MM') or a trailing offset from now(). In particular dash_range_window
-- accepts only five month-granular tokens and SILENTLY FALLS BACK to '3m' on an
-- unrecognised one, so it must never be used here.
--
-- NAMING (fixed 2026-09-15, before Task 4 ships): `tt_` is the Timetable
-- module's namespace (tt_slots, tt_run_attendance_pass_for_institution, ~20
-- more) and CLAUDE.md 7 routes any `tt_*` match to the `timetable-module`
-- skill - this module deliberately uses `tgt_` instead, so do not "helpfully"
-- rename it back.

CREATE OR REPLACE FUNCTION public.tgt_interval(_unit text, _n integer)
RETURNS interval
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT CASE _unit
           WHEN 'day'   THEN make_interval(days   => _n)
           WHEN 'week'  THEN make_interval(weeks  => _n)
           WHEN 'month' THEN make_interval(months => _n)
         END
$fn$;

-- Period k runs from starts_on + (k-1)*interval to the day before
-- starts_on + k*interval, clipped at ends_on. Postgres month arithmetic already
-- clamps correctly (31 Jan + 1 month = 28 Feb).
--
-- MONTH-CLAMPING CONTRACT (binding on any reimplementation, including Task 8's
-- TypeScript port). Postgres date + interval 'N months' CLAMPS to the last day
-- of the target month when the anchor day-of-month doesn't exist there:
-- 2026-01-31 + interval '1 month' = 2026-02-28 (2026 is not a leap year), NOT
-- 2026-03-03 or any other rollover. Naive JavaScript `Date.setMonth` does NOT
-- do this: it rolls the overflow into the following month instead of clamping.
-- Any reimplementation of this period math (Task 8) MUST clamp to the last day
-- of the target month to agree with this function, or the same teacher's
-- period boundaries will disagree between the DB-evaluated targets and the UI
-- preview.
CREATE OR REPLACE FUNCTION public.tgt_periods(
  _starts_on date, _ends_on date, _unit text, _n integer, _upto date
)
RETURNS TABLE (period_index integer, period_start date, period_end date)
LANGUAGE plpgsql IMMUTABLE
AS $fn$
DECLARE
  v_iv interval;
  v_i  integer := 1;
  v_s  date;
BEGIN
  IF _unit IS NULL OR _n IS NULL THEN
    IF _starts_on <= _upto THEN
      period_index := 1; period_start := _starts_on; period_end := _ends_on;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  v_iv := public.tgt_interval(_unit, _n);
  LOOP
    v_s := (_starts_on + (v_i - 1) * v_iv)::date;
    EXIT WHEN v_s > _ends_on OR v_s > _upto;
    period_index := v_i;
    period_start := v_s;
    period_end   := LEAST((_starts_on + v_i * v_iv)::date - 1, _ends_on);
    RETURN NEXT;
    v_i := v_i + 1;
    EXIT WHEN v_i > 500;   -- a target cannot sanely have more than 500 periods
  END LOOP;
END $fn$;

-- EXAMS. status IN ('published','active','completed') is the exams_published
-- predicate; 'archived' is deliberately excluded. The date chain
-- COALESCE(published_at, scheduled_date, created_at) is the one every dash_* and
-- school_analytics_* RPC uses. TWO RIVAL CHAINS are live in prod (the
-- achievements evaluator puts scheduled_date first; the flag evaluator omits
-- published_at). Using a different one makes the same teacher's September read
-- two different numbers on two screens. Do not "improve" it.
--
-- No expression index backs this: timestamptz::date is STABLE, not IMMUTABLE, so
-- Postgres refuses an index on the COALESCE. The (created_by, status) index below
-- narrows to the teacher and the date is a heap filter, which is fine at
-- per-teacher cardinality.
CREATE OR REPLACE FUNCTION public.tgt_count_exams_published(
  _teacher uuid, _institution uuid, _from date, _to date
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT count(*)::int
  FROM public.exams e
  WHERE e.created_by     = _teacher
    AND e.institution_id = _institution
    AND e.status IN ('published','active','completed')
    AND COALESCE(e.published_at::date, e.scheduled_date::date, e.created_at::date)
        BETWEEN _from AND _to
$fn$;

-- HOMEWORK. Compares published_at against a timestamptz RANGE rather than
-- casting the column, so idx_homework_assignments_creator_published is usable.
-- The range is built from the institution-local calendar day (CLAUDE.md 24).
CREATE OR REPLACE FUNCTION public.tgt_count_homework_published(
  _teacher uuid, _institution uuid, _from date, _to date, _tz text
)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT count(*)::int
  FROM public.homework_assignments h
  WHERE h.created_by     = _teacher
    AND h.institution_id = _institution
    AND h.status IN ('published','checked')
    AND h.published_at IS NOT NULL
    AND h.published_at >= (_from::timestamp        AT TIME ZONE COALESCE(_tz,'Asia/Kolkata'))
    AND h.published_at <  ((_to + 1)::timestamp    AT TIME ZONE COALESCE(_tz,'Asia/Kolkata'))
$fn$;

-- Narrows the exam count to one teacher's published papers.
CREATE INDEX IF NOT EXISTS idx_exams_created_by_status
  ON public.exams (created_by, status);

-- FIX (2026-09-15, post-review): the original REVOKE list here read
-- `FROM PUBLIC, anon` and omitted `authenticated`. Supabase's default
-- privileges grant EXECUTE to `authenticated` on every new function in
-- `public` at creation time (the same mechanism documented for `anon` in
-- CLAUDE.md 26), so tgt_interval, tgt_count_exams_published and
-- tgt_count_homework_published were left directly callable by ANY signed-in
-- user with arbitrary `_teacher`/`_institution` uuids. Both counters are
-- SECURITY DEFINER (bypassing RLS) with no check that the caller IS that
-- teacher or belongs to that institution - the same argument-trust defect
-- class already open on this repo's audit list - so that was a live
-- cross-tenant information leak: any school's user could read any other
-- school's teacher activity counts. No client needs these three; Task 6's
-- nightly evaluator is itself SECURITY DEFINER and executes as its definer,
-- so revoking `authenticated` here cannot break it. Do not re-grant
-- `authenticated` on these three without adding a caller-identity check
-- first (compare `auth.uid()` against `_teacher`, or require `_teacher` to be
-- the caller via a wrapping RPC).
--
-- tgt_periods is the one exception, deliberately: it is pure date
-- arithmetic over caller-supplied inputs, touches no table, and leaks
-- nothing, so a client may legitimately want server-truth period boundaries
-- (Task 8's UI preview) - it keeps its authenticated GRANT below.
REVOKE ALL ON FUNCTION public.tgt_interval(text, integer)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tgt_periods(date, date, text, integer, date)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tgt_count_exams_published(uuid, uuid, date, date)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tgt_count_homework_published(uuid, uuid, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tgt_periods(date, date, text, integer, date) TO authenticated;

-- RENAME CLEANUP (2026-09-15): the old tt_-prefixed names above are recreated
-- under tgt_ names above, and nothing else in the database calls the old
-- names (Task 3 added no RLS policy - only Task 2's helpers had that
-- dependency, handled in 20260915120100_teacher_targets_schema.sql), so a
-- plain DROP (no CASCADE) is safe here.
DROP FUNCTION IF EXISTS public.tt_target_interval(text, integer);
DROP FUNCTION IF EXISTS public.tt_target_periods(date, date, text, integer, date);
DROP FUNCTION IF EXISTS public.tt_count_exams_published(uuid, uuid, date, date);
DROP FUNCTION IF EXISTS public.tt_count_homework_published(uuid, uuid, date, date, text);
