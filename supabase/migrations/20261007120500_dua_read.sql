-- =============================================================
-- Deleted-user archive (dua), part 6: read RPCs for /admin/deleted-users (spec §10).
-- Every RPC is SECURITY DEFINER, checks dua.can_view() FIRST (super admin AND in
-- dua.viewers, decision 7: no MFA), fails closed on a NULL uid, and revokes anon by
-- name. Detail, export and file views are logged to dua.view_log (inside dua, so
-- school admins never see them in system_audit_logs).
-- =============================================================

CREATE TABLE IF NOT EXISTS dua.view_log (
  id bigserial PRIMARY KEY,
  viewer_id uuid NOT NULL,
  action text NOT NULL,
  archive_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dua.view_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dua.view_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE dua.view_log_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION dua.can_view() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND public.is_super_admin((SELECT auth.uid()))
     AND EXISTS (SELECT 1 FROM dua.viewers v WHERE v.user_id = (SELECT auth.uid()))
$$;

CREATE OR REPLACE FUNCTION dua.require_viewer() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT coalesce(dua.can_view(), false) THEN
    RAISE EXCEPTION 'Only the archive owner can open deleted users.' USING ERRCODE = '42501';
  END IF;
END $$;

-- The date an entry sorts and filters by: exact when known, else the range's end, else its start.
CREATE OR REPLACE FUNCTION dua.sort_at(u dua.users) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(u.deleted_at, u.deleted_at_max, u.deleted_at_min, u.created_at)
$$;

CREATE OR REPLACE FUNCTION dua.entry_type(u dua.users) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN u.kind = 'on_request' THEN 'on_request'
    WHEN u.kind = 'capture_failed' THEN 'capture_failed'
    WHEN u.kind = 'captured' AND u.is_complete IS TRUE THEN 'complete'
    ELSE 'partial' END
$$;

-- A short title for a referenced row, for label resolution.
CREATE OR REPLACE FUNCTION dua.row_title(_row jsonb) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT left(nullif(trim(concat_ws(' ',
           coalesce(_row->>'title', _row->>'full_name', _row->>'name', _row->>'question_text', _row->>'label',
                    _row->>'subject_name', _row->>'chapter_name', _row->>'topic_name', _row->>'code'),
           CASE WHEN _row ? 'name' AND _row ? 'section' THEN _row->>'section' END)), ''), 200)
$$;

-- Does an entry match the filters? _skip leaves one dimension out (for its own facet counts).
CREATE OR REPLACE FUNCTION dua.list_match(u dua.users, _f jsonb, _skip text DEFAULT '') RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT
    (coalesce((_f->>'show_test')::boolean, false) OR NOT u.is_test_account)
    AND (_skip = 'q' OR nullif(trim(_f->>'q'), '') IS NULL
         OR u.full_name ILIKE '%' || trim(_f->>'q') || '%'
         OR u.email ILIKE '%' || trim(_f->>'q') || '%'
         OR u.admission_number ILIKE '%' || trim(_f->>'q') || '%')
    AND (_skip = 'role' OR nullif(_f->>'role', '') IS NULL
         OR u.roles @> jsonb_build_array(jsonb_build_object('role', _f->>'role')))
    AND (_skip = 'institution' OR nullif(_f->>'institution_id', '') IS NULL
         OR u.institution_id::text = _f->>'institution_id'
         OR u.roles @> jsonb_build_array(jsonb_build_object('institution_id', _f->>'institution_id')))
    AND (_skip = 'class' OR nullif(_f->>'class_id', '') IS NULL
         OR u.class_sections @> jsonb_build_array(jsonb_build_object('class_id', _f->>'class_id')))
    AND (_skip = 'deleted_by' OR nullif(_f->>'deleted_by', '') IS NULL OR u.deleted_by::text = _f->>'deleted_by')
    AND (_skip = 'source' OR nullif(_f->>'source', '') IS NULL OR split_part(u.source, ':', 1) = _f->>'source')
    AND (_skip = 'entry' OR nullif(_f->>'entry', '') IS NULL OR dua.entry_type(u) = _f->>'entry')
    AND (_skip = 'status' OR nullif(_f->>'status', '') IS NULL
         OR (_f->>'status' = 'live_again' AND u.live_again_user_id IS NOT NULL)
         OR (_f->>'status' = 'gone' AND u.live_again_user_id IS NULL))
    AND (_skip = 'has_files' OR NOT coalesce((_f->>'has_files')::boolean, false)
         OR EXISTS (SELECT 1 FROM dua.files f WHERE f.archive_id = u.id))
    AND (_skip = 'flagged' OR NOT coalesce((_f->>'flagged')::boolean, false)
         OR u.kind = 'capture_failed' OR (u.kind = 'captured' AND u.is_complete IS NOT TRUE))
    AND (nullif(_f->>'from', '') IS NULL
         OR coalesce(u.deleted_at, u.deleted_at_max, 'infinity'::timestamptz)
              >= ((_f->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND (nullif(_f->>'to', '') IS NULL
         OR coalesce(u.deleted_at, u.deleted_at_min, '-infinity'::timestamptz)
              < (((_f->>'to')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
    AND ((nullif(_f->>'from', '') IS NULL AND nullif(_f->>'to', '') IS NULL)
         OR u.deleted_at IS NOT NULL OR u.deleted_at_min IS NOT NULL OR u.deleted_at_max IS NOT NULL)
$$;

-- One page of the list (keyset), the filtered total, facet counts and the stat row.
CREATE OR REPLACE FUNCTION public.dua_list(_filters jsonb DEFAULT '{}'::jsonb, _limit integer DEFAULT 50,
                                           _cursor jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f jsonb := coalesce(_filters, '{}'::jsonb);
  lim integer := least(greatest(coalesce(_limit, 50), 1), 50);
  c_at timestamptz := nullif(_cursor->>'at', '')::timestamptz;
  c_id uuid := nullif(_cursor->>'id', '')::uuid;
  v_rows jsonb;
  v_total bigint;
  v_facets jsonb;
  v_stats jsonb;
  month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
BEGIN
  PERFORM dua.require_viewer();

  SELECT coalesce(jsonb_agg(x.j ORDER BY x.at DESC, x.id DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT u.id, dua.sort_at(u) AS at,
           jsonb_build_object(
             'id', u.id, 'user_id', u.user_id, 'kind', u.kind, 'entry', dua.entry_type(u),
             'full_name', u.full_name, 'email', u.email, 'admission_number', u.admission_number,
             'roles', u.roles, 'institution_name', u.institution_name, 'class_sections', u.class_sections,
             'deleted_at', u.deleted_at, 'deleted_at_min', u.deleted_at_min, 'deleted_at_max', u.deleted_at_max,
             'deleted_by_name', u.deleted_by_name, 'source', u.source, 'is_complete', u.is_complete,
             'live_again', u.live_again_user_id IS NOT NULL, 'is_test_account', u.is_test_account,
             'has_files', EXISTS (SELECT 1 FROM dua.files fl WHERE fl.archive_id = u.id),
             'sort_at', dua.sort_at(u)) AS j
    FROM dua.users u
    WHERE u.kind <> 'roster_witness'
      AND dua.list_match(u, f)
      AND (c_at IS NULL OR (dua.sort_at(u), u.id) < (c_at, c_id))
    ORDER BY dua.sort_at(u) DESC, u.id DESC
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
                        THEN jsonb_build_object('at', v_rows->(lim - 1)->>'sort_at', 'id', v_rows->(lim - 1)->>'id') END);
END $$;

-- Everything about one entry except the row images themselves (those page through dua_rows).
CREATE OR REPLACE FUNCTION public.dua_detail(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u dua.users; v jsonb;
BEGIN
  PERFORM dua.require_viewer();
  SELECT * INTO u FROM dua.users WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This archive entry does not exist.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO dua.view_log (viewer_id, action, archive_id) VALUES ((SELECT auth.uid()), 'detail', _id);

  SELECT jsonb_build_object(
    'header', to_jsonb(u) || jsonb_build_object('entry', dua.entry_type(u)),
    'tables', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'table', r.table_name, 'label', coalesce(g.label, r.table_name), 'category', coalesce(g.category, 'Other'),
                  'display_columns', coalesce(g.display_columns, '{}'::text[]), 'mode', r.mode, 'row_count', r.row_count)
                  ORDER BY coalesce(g.category, 'Other'), coalesce(g.label, r.table_name)), '[]'::jsonb)
               FROM dua.rows r LEFT JOIN dua.table_registry g ON g.table_name = r.table_name
               WHERE r.archive_id = _id),
    'links', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'table', l.table_name, 'column', l.column_name, 'label', coalesce(g.label, l.table_name),
                  'category', coalesce(g.category, 'Other'), 'references_table', l.references_table,
                  'row_count', l.row_count, 'snapshot_count', coalesce(jsonb_array_length(l.snapshots), 0))
                  ORDER BY l.row_count DESC), '[]'::jsonb)
              FROM dua.links l LEFT JOIN dua.table_registry g ON g.table_name = l.table_name
              WHERE l.archive_id = _id),
    'files', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', fl.id, 'source', fl.source, 'bucket', fl.bucket,
                  'path', fl.path, 'raw_value', fl.raw_value, 'size_bytes', fl.size_bytes, 'mime', fl.mime) ORDER BY fl.id), '[]'::jsonb)
              FROM (SELECT * FROM dua.files WHERE archive_id = _id ORDER BY id LIMIT 500) fl),
    'file_count', (SELECT count(*) FROM dua.files WHERE archive_id = _id),
    'traces', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', t.source, 'payload', t.payload) ORDER BY t.id), '[]'::jsonb)
               FROM (SELECT * FROM dua.traces WHERE archive_id = _id ORDER BY id LIMIT 200) t),
    -- Evidence that lives outside the archive and survived the deletion (mainly for past entries).
    'audit_rows', (SELECT coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'entity_type', a.entity_type,
                      'entity_name', a.entity_name, 'actor_id', a.actor_id, 'old_values', a.old_values,
                      'new_values', a.new_values, 'created_at', a.created_at) ORDER BY a.created_at DESC), '[]'::jsonb)
                   FROM (SELECT * FROM public.system_audit_logs x
                          WHERE x.entity_id = u.user_id
                             OR (x.action IN ('role_deleted', 'role_created')
                                 AND coalesce(x.old_values, x.new_values)->>'user_id' = u.user_id::text)
                          ORDER BY x.created_at DESC LIMIT 200) a),
    'class_assignment_deletions', (SELECT coalesce(jsonb_agg(jsonb_build_object('class_id', d.class_id, 'class_name', c.name,
                      'section', c.section, 'subject_id', d.subject_id, 'role', d.role, 'assigned_at', d.assigned_at,
                      'deleted_at', d.deleted_at) ORDER BY d.deleted_at DESC), '[]'::jsonb)
                   FROM (SELECT * FROM public.class_assignment_deletions WHERE user_id = u.user_id ORDER BY deleted_at DESC LIMIT 200) d
                   LEFT JOIN public.classes c ON c.id = d.class_id),
    'log_events', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', e.source, 'kind', e.kind, 'event_at', e.event_at,
                      'email', e.email, 'actor_user_id', e.actor_user_id) ORDER BY e.event_at DESC), '[]'::jsonb)
                   FROM (SELECT * FROM dua.legacy_evidence WHERE subject_user_id = u.user_id AND kind <> 'auth_activity'
                         ORDER BY event_at DESC LIMIT 200) e),
    'sign_in_days', (SELECT count(*) FROM dua.legacy_evidence WHERE subject_user_id = u.user_id AND kind = 'auth_activity'),
    'live_again', (SELECT jsonb_build_object('user_id', p.id, 'full_name', p.full_name, 'email', p.email,
                      'institution_name', (SELECT i.name FROM public.institutions i WHERE i.id = p.institution_id),
                      'created_at', (SELECT au.created_at FROM auth.users au WHERE au.id = p.id))
                   FROM public.profiles p WHERE p.id = u.live_again_user_id),
    'view_count', (SELECT count(*) FROM dua.view_log WHERE archive_id = _id)
  ) INTO v;
  RETURN v;
END $$;

-- One page of one archived table, with labels for every link the archive can resolve.
CREATE OR REPLACE FUNCTION public.dua_rows(_id uuid, _table text, _offset integer DEFAULT 0, _limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lim integer := least(greatest(coalesce(_limit, 50), 1), 50);
  off integer := greatest(coalesce(_offset, 0), 0);
  rel oid := to_regclass(_table);
  v jsonb;
BEGIN
  PERFORM dua.require_viewer();
  WITH fks AS (
    SELECT a.attname::text AS col, c.confrelid::regclass::text AS parent
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE rel IS NOT NULL AND c.conrelid = rel AND c.contype = 'f' AND cardinality(c.conkey) = 1
  ),
  page AS (
    SELECT e.row, e.ord
    FROM dua.rows r CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.rows, '[]'::jsonb)) WITH ORDINALITY e(row, ord)
    WHERE r.archive_id = _id AND r.table_name = _table
    ORDER BY e.ord OFFSET off LIMIT lim
  )
  SELECT jsonb_build_object(
    'total', (SELECT r.row_count FROM dua.rows r WHERE r.archive_id = _id AND r.table_name = _table),
    'mode', (SELECT r.mode FROM dua.rows r WHERE r.archive_id = _id AND r.table_name = _table),
    'offset', off,
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'row', p.row,
      'labels', (SELECT coalesce(jsonb_object_agg(fk.col, t.title), '{}'::jsonb)
                 FROM fks fk
                 CROSS JOIN LATERAL (SELECT dua.row_title(coalesce(
                     (SELECT rf.row FROM dua.refs rf
                       WHERE rf.archive_id = _id AND rf.table_name = fk.parent AND rf.row_pk = p.row->>fk.col),
                     (SELECT x FROM dua.rows r2 CROSS JOIN LATERAL jsonb_array_elements(coalesce(r2.rows, '[]'::jsonb)) x
                       WHERE r2.archive_id = _id AND r2.table_name = fk.parent AND x->>'id' = p.row->>fk.col LIMIT 1))) AS title) t
                 WHERE p.row->>fk.col IS NOT NULL AND t.title IS NOT NULL))
      ORDER BY p.ord), '[]'::jsonb))
  INTO v FROM page p;
  RETURN v;
END $$;

-- One page of records the person created that stayed with the school.
CREATE OR REPLACE FUNCTION public.dua_links(_id uuid, _table text, _column text, _offset integer DEFAULT 0, _limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lim integer := least(greatest(coalesce(_limit, 50), 1), 50);
  off integer := greatest(coalesce(_offset, 0), 0);
  v jsonb;
BEGIN
  PERFORM dua.require_viewer();
  SELECT jsonb_build_object(
    'total', l.row_count,
    'snapshot_count', coalesce(jsonb_array_length(l.snapshots), 0),
    'offset', off,
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object('row', s.row, 'title', dua.row_title(s.row)) ORDER BY s.ord)
                      FROM (SELECT e.row, e.ord FROM jsonb_array_elements(coalesce(l.snapshots, '[]'::jsonb)) WITH ORDINALITY e(row, ord)
                            ORDER BY e.ord OFFSET off LIMIT lim) s), '[]'::jsonb),
    'ids_only', CASE WHEN off + lim > coalesce(jsonb_array_length(l.snapshots), 0)
                     THEN (SELECT coalesce(jsonb_agg(p ORDER BY o), '[]'::jsonb)
                             FROM jsonb_array_elements_text(l.row_pks) WITH ORDINALITY q(p, o)
                            WHERE o > greatest(coalesce(jsonb_array_length(l.snapshots), 0), off)
                              AND o <= off + lim) END)
  INTO v
  FROM dua.links l
  WHERE l.archive_id = _id AND l.table_name = _table AND l.column_name = _column;
  RETURN coalesce(v, jsonb_build_object('total', 0, 'snapshot_count', 0, 'offset', off, 'rows', '[]'::jsonb));
END $$;

-- The whole entry as one JSON document (the page builds the Excel workbook from it).
CREATE OR REPLACE FUNCTION public.dua_export(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM dua.require_viewer();
  IF NOT EXISTS (SELECT 1 FROM dua.users WHERE id = _id) THEN
    RAISE EXCEPTION 'This archive entry does not exist.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO dua.view_log (viewer_id, action, archive_id) VALUES ((SELECT auth.uid()), 'export', _id);
  SELECT jsonb_build_object(
    'header', (SELECT to_jsonb(u) FROM dua.users u WHERE u.id = _id),
    'tables', (SELECT coalesce(jsonb_object_agg(r.table_name, jsonb_build_object(
                  'label', coalesce(g.label, r.table_name), 'category', coalesce(g.category, 'Other'),
                  'mode', r.mode, 'row_count', r.row_count, 'rows', r.rows)), '{}'::jsonb)
               FROM dua.rows r LEFT JOIN dua.table_registry g ON g.table_name = r.table_name WHERE r.archive_id = _id),
    'kept_with_school', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', l.table_name, 'column', l.column_name,
                  'row_count', l.row_count, 'ids', l.row_pks, 'snapshots', l.snapshots)), '[]'::jsonb)
               FROM dua.links l WHERE l.archive_id = _id),
    'referenced_rows', (SELECT coalesce(jsonb_agg(jsonb_build_object('table', f.table_name, 'pk', f.row_pk, 'row', f.row)), '[]'::jsonb)
               FROM dua.refs f WHERE f.archive_id = _id),
    'files', (SELECT coalesce(jsonb_agg(to_jsonb(fl) - 'archive_id'), '[]'::jsonb) FROM dua.files fl WHERE fl.archive_id = _id),
    'traces', (SELECT coalesce(jsonb_agg(jsonb_build_object('source', t.source, 'payload', t.payload)), '[]'::jsonb)
               FROM dua.traces t WHERE t.archive_id = _id)
  ) INTO v;
  RETURN v;
END $$;

-- For the dua-file-url edge function: may the caller open this file of this entry?
CREATE OR REPLACE FUNCTION public.dua_file_check(_archive_id uuid, _file_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM dua.require_viewer();
  SELECT jsonb_build_object('bucket', f.bucket, 'path', f.path) INTO v
  FROM dua.files f WHERE f.archive_id = _archive_id AND f.id = _file_id AND f.bucket IS NOT NULL;
  IF v IS NULL THEN
    RAISE EXCEPTION 'This file is not part of this archive entry.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO dua.view_log (viewer_id, action, archive_id, detail)
  VALUES ((SELECT auth.uid()), 'file', _archive_id, v);
  RETURN v;
END $$;

-- For the sidebar: show "Deleted Users" only to the archive owner. Never raises.
CREATE OR REPLACE FUNCTION public.dua_can_view() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(dua.can_view(), false)
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'dua.can_view()', 'dua.require_viewer()', 'dua.sort_at(dua.users)', 'dua.entry_type(dua.users)', 'dua.row_title(jsonb)',
    'dua.list_match(dua.users, jsonb, text)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'public.dua_list(jsonb, integer, jsonb)', 'public.dua_detail(uuid)', 'public.dua_rows(uuid, text, integer, integer)',
    'public.dua_links(uuid, text, text, integer, integer)', 'public.dua_export(uuid)', 'public.dua_file_check(uuid, bigint)',
    'public.dua_can_view()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;
