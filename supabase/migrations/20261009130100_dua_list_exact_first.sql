-- =============================================================
-- Deleted Users list order (2026-10-09). Entries with an exact deletion time come
-- first, newest on top; entries known only as a date range (deleted before the
-- archive existed) follow, by the end of their range. Before this, a range that
-- ended at a re-import date sorted above real recent deletions. The keyset cursor
-- carries the exact/range flag so Load more stays in order.
-- =============================================================
CREATE OR REPLACE FUNCTION public.dua_list(_filters jsonb DEFAULT '{}'::jsonb, _limit integer DEFAULT 50,
                                           _cursor jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f jsonb := coalesce(_filters, '{}'::jsonb);
  lim integer := least(greatest(coalesce(_limit, 50), 1), 50);
  c_at timestamptz := nullif(_cursor->>'at', '')::timestamptz;
  c_id uuid := nullif(_cursor->>'id', '')::uuid;
  c_exact integer := coalesce(nullif(_cursor->>'exact', '')::integer, 1);
  v_rows jsonb;
  v_total bigint;
  v_facets jsonb;
  v_stats jsonb;
  month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
BEGIN
  PERFORM dua.require_viewer();

  SELECT coalesce(jsonb_agg(x.j ORDER BY x.ex DESC, x.at DESC, x.id DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT u.id, (u.deleted_at IS NOT NULL)::int AS ex, dua.sort_at(u) AS at,
           jsonb_build_object(
             'id', u.id, 'user_id', u.user_id, 'kind', u.kind, 'entry', dua.entry_type(u),
             'full_name', u.full_name, 'email', u.email, 'admission_number', u.admission_number,
             'roles', u.roles, 'institution_name', u.institution_name, 'class_sections', u.class_sections,
             'deleted_at', u.deleted_at, 'deleted_at_min', u.deleted_at_min, 'deleted_at_max', u.deleted_at_max,
             'deleted_by_name', u.deleted_by_name, 'source', u.source, 'is_complete', u.is_complete,
             'live_again', u.live_again_user_id IS NOT NULL, 'is_test_account', u.is_test_account,
             'has_files', EXISTS (SELECT 1 FROM dua.files fl WHERE fl.archive_id = u.id),
             'exact', (u.deleted_at IS NOT NULL)::int, 'sort_at', dua.sort_at(u)) AS j
    FROM dua.users u
    WHERE u.kind <> 'roster_witness'
      AND dua.list_match(u, f)
      AND (c_at IS NULL OR ((u.deleted_at IS NOT NULL)::int, dua.sort_at(u), u.id) < (c_exact, c_at, c_id))
    ORDER BY (u.deleted_at IS NOT NULL)::int DESC, dua.sort_at(u) DESC, u.id DESC
    LIMIT lim
  ) x;

  SELECT count(*) INTO v_total FROM dua.users u WHERE u.kind <> 'roster_witness' AND dua.list_match(u, f);

  SELECT jsonb_build_object(
    'role', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', r.role, 'count', r.n) ORDER BY r.n DESC), '[]'::jsonb)
             FROM (SELECT x->>'role' AS role, count(DISTINCT u.id) AS n
                     FROM dua.users u CROSS JOIN LATERAL jsonb_array_elements(u.roles) x
                    WHERE u.kind <> 'roster_witness' AND dua.list_match(u, f, 'role') AND x->>'role' IS NOT NULL
                    GROUP BY 1) r),
    'institution', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', r.id, 'label', r.name, 'count', r.n) ORDER BY r.n DESC), '[]'::jsonb)
             FROM (SELECT u.institution_id::text AS id, max(u.institution_name) AS name, count(*) AS n
                     FROM dua.users u
                    WHERE u.kind <> 'roster_witness' AND dua.list_match(u, f, 'institution') AND u.institution_id IS NOT NULL
                    GROUP BY 1) r),
    'deleted_by', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', r.id, 'label', r.name, 'count', r.n) ORDER BY r.n DESC), '[]'::jsonb)
             FROM (SELECT u.deleted_by::text AS id, max(u.deleted_by_name) AS name, count(*) AS n
                     FROM dua.users u
                    WHERE u.kind <> 'roster_witness' AND dua.list_match(u, f, 'deleted_by') AND u.deleted_by IS NOT NULL
                    GROUP BY 1) r),
    'source', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', r.s, 'count', r.n) ORDER BY r.n DESC), '[]'::jsonb)
             FROM (SELECT split_part(u.source, ':', 1) AS s, count(*) AS n FROM dua.users u
                    WHERE u.kind <> 'roster_witness' AND dua.list_match(u, f, 'source') GROUP BY 1) r),
    'entry', (SELECT coalesce(jsonb_agg(jsonb_build_object('value', r.e, 'count', r.n) ORDER BY r.n DESC), '[]'::jsonb)
             FROM (SELECT dua.entry_type(u) AS e, count(*) AS n FROM dua.users u
                    WHERE u.kind <> 'roster_witness' AND dua.list_match(u, f, 'entry') GROUP BY 1) r),
    'status', (SELECT jsonb_build_array(
                 jsonb_build_object('value', 'gone', 'count', count(*) FILTER (WHERE u.live_again_user_id IS NULL)),
                 jsonb_build_object('value', 'live_again', 'count', count(*) FILTER (WHERE u.live_again_user_id IS NOT NULL)))
               FROM dua.users u WHERE u.kind <> 'roster_witness' AND dua.list_match(u, f, 'status')),
    'has_files', (SELECT count(*) FROM dua.users u WHERE u.kind <> 'roster_witness' AND dua.list_match(u, f, 'has_files')
                    AND EXISTS (SELECT 1 FROM dua.files fl WHERE fl.archive_id = u.id)),
    'flagged', (SELECT count(*) FROM dua.users u WHERE u.kind <> 'roster_witness' AND dua.list_match(u, f, 'flagged')
                  AND (u.kind = 'capture_failed' OR (u.kind = 'captured' AND u.is_complete IS NOT TRUE))),
    'test_accounts', (SELECT count(*) FROM dua.users u WHERE u.kind <> 'roster_witness' AND u.is_test_account)
  ) INTO v_facets;

  SELECT jsonb_build_object(
    'gone', count(*) FILTER (WHERE u.live_again_user_id IS NULL),
    'live_again', count(*) FILTER (WHERE u.live_again_user_id IS NOT NULL),
    'this_month', count(*) FILTER (WHERE dua.sort_at(u) >= month_start AND (u.deleted_at IS NOT NULL OR u.deleted_at_min >= month_start)),
    'students', count(*) FILTER (WHERE u.roles @> '[{"role":"student"}]'::jsonb),
    'staff', count(*) FILTER (WHERE u.roles @> '[{"role":"teacher"}]'::jsonb OR u.roles @> '[{"role":"coordinator"}]'::jsonb
                                  OR u.roles @> '[{"role":"school_admin"}]'::jsonb OR u.roles @> '[{"role":"super_school_admin"}]'::jsonb
                                  OR u.roles @> '[{"role":"employee"}]'::jsonb),
    'partial', count(*) FILTER (WHERE dua.entry_type(u) = 'partial'))
  INTO v_stats
  FROM dua.users u
  WHERE u.kind <> 'roster_witness' AND (coalesce((f->>'show_test')::boolean, false) OR NOT u.is_test_account);

  RETURN jsonb_build_object(
    'rows', v_rows, 'total', v_total, 'facets', v_facets, 'stats', v_stats,
    'next_cursor', CASE WHEN jsonb_array_length(v_rows) = lim
                        THEN jsonb_build_object('at', v_rows->(lim - 1)->>'sort_at', 'id', v_rows->(lim - 1)->>'id',
                                                 'exact', v_rows->(lim - 1)->>'exact') END);
END $$;

REVOKE EXECUTE ON FUNCTION public.dua_list(jsonb, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dua_list(jsonb, integer, jsonb) TO authenticated;
