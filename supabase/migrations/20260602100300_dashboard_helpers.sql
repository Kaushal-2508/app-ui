-- Dashboard rebuild Phase 1 — Task 4
-- Shared helpers: admin guard + current academic year + weighted student scoring.

-- Resolve + authorize the institution the caller may view. super_admin may pass any institution.
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

-- Current academic-year window for an institution. Prefers the row matching today, then is_active.
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

-- Weighted "students who need help" scoring. Weights from TS constants (p_weights jsonb); NULL -> baked defaults.
-- DEFAULTS MUST stay in sync with src/lib/dashboardConstants.ts SEVERITY_WEIGHTS.
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
  WITH roster AS (
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
  results AS (
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
  recent AS (
    SELECT rk.sid, rk.cid, rk.exam_id, rk.percentage,
           percent_rank() OVER (PARTITION BY rk.exam_id, rk.cid ORDER BY rk.percentage) AS pr
    FROM ranked rk WHERE rk.rn = 1
  ),
  halves AS (
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
      sa.pct AS att_pct, re.percentage AS rec_pct,
      sa.days AS att_days, ec.n AS exam_n,
      (sa.pct IS NOT NULL AND ca2.pct IS NOT NULL AND (ca2.pct - sa.pct) > 15)                          AS f_att,
      (re.pr IS NOT NULL AND re.pr <= 0.25)                                                              AS f_quart,
      (h.older_avg IS NOT NULL AND ch.cls_older_avg IS NOT NULL AND ch.cls_recent_avg IS NOT NULL
        AND h.older_avg >= ch.cls_older_avg AND h.recent_avg < ch.cls_recent_avg)                        AS f_drop,
      (coalesce(fn.n,0) >= 3)                                                                            AS f_flags,
      coalesce(fn.n,0) AS flag_n
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
    SELECT sid, cid, att_pct, rec_pct,
      (CASE WHEN f_att THEN w_att ELSE 0 END
       + CASE WHEN f_quart THEN w_quart ELSE 0 END
       + CASE WHEN f_drop THEN w_drop ELSE 0 END
       + CASE WHEN f_flags THEN w_flags ELSE 0 END) AS sc,
      f_att, f_quart, f_drop, flag_n, att_days, exam_n
    FROM scored
    WHERE coalesce(att_days,0) >= 10 AND coalesce(exam_n,0) >= 2
  )
  SELECT f.sid, f.cid, f.sc::int AS score,
    CASE WHEN f.sc >= b_red THEN 'red' WHEN f.sc >= b_amber THEN 'amber' ELSE 'yellow' END AS band,
    trim(BOTH ', ' FROM concat_ws(', ',
      CASE WHEN f.f_quart THEN 'recent marks among the lowest in class' END,
      CASE WHEN f.f_att   THEN 'attendance well below class' END,
      CASE WHEN f.f_drop  THEN 'was above average, now below' END,
      CASE WHEN f.flag_n >= 3 THEN f.flag_n || ' active flags' END
    )) AS reason,
    f.att_pct, f.rec_pct,
    CASE WHEN f.f_drop THEN 'down' ELSE 'flat' END AS trend,
    f.flag_n::int AS active_flags
  FROM final f
  WHERE f.sc >= v_min;
END $$;

GRANT EXECUTE ON FUNCTION public.dash_resolve_institution(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_current_academic_year(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dash_score_students(uuid, jsonb) TO authenticated;
