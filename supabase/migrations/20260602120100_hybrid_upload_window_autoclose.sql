-- =====================================================================
-- HYBRID EXAM MODE — Upload-window auto-close (flow correction, Phase 3)
-- =====================================================================
-- When the teacher-set upload window (hybrid_exam_settings.grace_window_minutes,
-- measured from hybrid_exam_attempts.submitted_at) lapses, move the attempt off
-- the upload states: -> pending_evaluation when at least one page exists,
-- else -> cancelled_no_upload. Runs every minute via pg_cron. Client-side
-- timers are now only a visual; this is the source of truth.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.hybrid_close_expired_upload_windows()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed INTEGER := 0;
  r RECORD;
  v_page_count INTEGER;
  v_next_status TEXT;
BEGIN
  FOR r IN
    SELECT a.id, a.institution_id, a.submitted_at, s.grace_window_minutes
    FROM public.hybrid_exam_attempts a
    JOIN public.hybrid_exam_settings s ON s.exam_id = a.exam_id
    WHERE a.status IN ('awaiting_upload', 'upload_in_progress')
      AND a.submitted_at IS NOT NULL
      AND now() > a.submitted_at + make_interval(mins => s.grace_window_minutes)
  LOOP
    SELECT count(*) INTO v_page_count
    FROM public.hybrid_answer_sheet_pages p
    WHERE p.attempt_id = r.id;

    v_next_status := CASE WHEN v_page_count > 0 THEN 'pending_evaluation' ELSE 'cancelled_no_upload' END;

    UPDATE public.hybrid_exam_attempts
    SET status = v_next_status,
        upload_completed_at = CASE WHEN v_next_status = 'pending_evaluation' THEN now() ELSE upload_completed_at END
    WHERE id = r.id;

    INSERT INTO public.hybrid_exam_attempt_logs (attempt_id, institution_id, event_type, event_payload)
    VALUES (
      r.id, r.institution_id, 'upload_window_closed',
      jsonb_build_object('page_count', v_page_count, 'next_status', v_next_status)
    );

    v_closed := v_closed + 1;
  END LOOP;

  RETURN v_closed;
END;
$$;

-- Schedule every minute. cron.schedule is idempotent on jobname in pg_cron 1.5+;
-- guard for older versions by unscheduling first if present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hybrid-close-upload-windows') THEN
    PERFORM cron.unschedule('hybrid-close-upload-windows');
  END IF;
  PERFORM cron.schedule(
    'hybrid-close-upload-windows',
    '* * * * *',
    $job$ SELECT public.hybrid_close_expired_upload_windows(); $job$
  );
END;
$$;