-- Teacher Targets: tell the teacher when an exam is marked but not published.
--
-- THE PROBLEM. 20260916120200 made a results-upload exam count only once its
-- results reach students. That is correct, and it is invisible. A teacher enters
-- every mark, leaves "Publish results now" off (it defaults off), saves, and the
-- target still reads "0 of 2" with nothing explaining why. Reproduced on Salci
-- National: exam "dfgdfg" ended with 5 attempts, 5 final_results rows and 0
-- published, counting 0. The rule was right; the silence was the bug.
--
-- This adds one number to the open period: how many exams in this window are
-- fully marked and waiting only on publication. The card turns that into a line
-- the teacher can act on. Nothing about the COUNT changes.

CREATE OR REPLACE FUNCTION public.tgt_count_exams_awaiting_results(
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
    AND COALESCE(e.is_results_only, false)
    -- has marks recorded ...
    AND EXISTS (
      SELECT 1 FROM public.final_results fr
      JOIN public.student_exam_attempts a ON a.id = fr.attempt_id
      WHERE a.exam_id = e.id
    )
    -- ... but none of them published, so it does not count yet
    AND NOT EXISTS (
      SELECT 1 FROM public.final_results fr
      JOIN public.student_exam_attempts a ON a.id = fr.attempt_id
      WHERE a.exam_id = e.id AND fr.is_published
    )
$fn$;

COMMENT ON FUNCTION public.tgt_count_exams_awaiting_results(uuid, uuid, date, date) IS
  'Results-upload exams in the window that are marked but whose results are not published, so they do not yet count toward the teacher''s target. Display only: never added to achieved_value.';

REVOKE ALL ON FUNCTION public.tgt_count_exams_awaiting_results(uuid, uuid, date, date)
  FROM PUBLIC, anon, authenticated;

-- Republished with `awaiting_results` on the live branch. A CLOSED period keeps
-- returning exactly what the ledger froze, with no extra field: the hint is only
-- meaningful while something can still be done about it.
CREATE OR REPLACE FUNCTION public.tgt_open_period(_target uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  t       public.teacher_targets%ROWTYPE;
  v_tz    text;
  v_today date;
  v_p     record;
BEGIN
  SELECT * INTO t FROM public.teacher_targets WHERE id = _target;
  IF t.id IS NULL OR t.scope <> 'teacher' THEN RETURN NULL; END IF;

  SELECT COALESCE(i.timezone, 'Asia/Kolkata') INTO v_tz
  FROM public.institutions i WHERE i.id = t.institution_id;
  v_today := (now() AT TIME ZONE COALESCE(v_tz, 'Asia/Kolkata'))::date;

  SELECT p.period_index, p.period_start, p.period_end INTO v_p
  FROM public.tgt_periods(t.starts_on, t.ends_on, t.cadence_unit, t.cadence_n, t.ends_on) p
  WHERE v_today BETWEEN p.period_start AND p.period_end
  LIMIT 1;

  IF v_p.period_index IS NULL THEN RETURN NULL; END IF;

  RETURN COALESCE(
    (SELECT to_jsonb(x) FROM (
       SELECT pr.period_index, pr.period_start, pr.period_end,
              pr.target_value, pr.achieved_value, pr.status
       FROM public.teacher_target_periods pr
       WHERE pr.target_id = t.id AND pr.period_index = v_p.period_index
         AND pr.status <> 'open'
     ) x),
    (SELECT to_jsonb(y) FROM (
       SELECT v_p.period_index  AS period_index,
              v_p.period_start  AS period_start,
              v_p.period_end    AS period_end,
              t.target_value    AS target_value,
              CASE t.metric
                WHEN 'exams_published' THEN
                  public.tgt_count_exams_published(t.owner_id, t.institution_id, v_p.period_start, v_p.period_end)
                WHEN 'homework_published' THEN
                  public.tgt_count_homework_published(t.owner_id, t.institution_id, v_p.period_start, v_p.period_end, v_tz)
              END               AS achieved_value,
              CASE t.metric
                WHEN 'exams_published' THEN
                  public.tgt_count_exams_awaiting_results(t.owner_id, t.institution_id, v_p.period_start, v_p.period_end)
                ELSE 0
              END               AS awaiting_results,
              'open'::text      AS status
     ) y)
  );
END $fn$;

REVOKE ALL ON FUNCTION public.tgt_open_period(uuid) FROM PUBLIC, anon, authenticated;
