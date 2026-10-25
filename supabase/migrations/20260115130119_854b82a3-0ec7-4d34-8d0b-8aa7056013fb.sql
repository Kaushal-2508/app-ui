-- Add function to check exam window status and active attempts
CREATE OR REPLACE FUNCTION public.get_exam_window_status(p_exam_id UUID)
RETURNS TABLE (
  is_window_open BOOLEAN,
  is_window_closed BOOLEAN,
  active_attempt_count INTEGER,
  time_until_start INTERVAL,
  time_until_end INTERVAL,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (e.start_time IS NOT NULL AND e.start_time <= NOW() AND (e.end_time IS NULL OR e.end_time > NOW())) AS is_window_open,
    (e.end_time IS NOT NULL AND e.end_time <= NOW()) AS is_window_closed,
    (SELECT COUNT(*)::INTEGER FROM student_exam_attempts 
     WHERE exam_id = p_exam_id AND is_submitted = false) AS active_attempt_count,
    CASE WHEN e.start_time IS NOT NULL THEN (e.start_time - NOW()) ELSE NULL END AS time_until_start,
    CASE WHEN e.end_time IS NOT NULL THEN (e.end_time - NOW()) ELSE NULL END AS time_until_end,
    e.start_time AS start_time,
    e.end_time AS end_time
  FROM exams e
  WHERE e.id = p_exam_id;
END;
$$;