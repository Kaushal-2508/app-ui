-- =============================================================
-- Deleted-user archive (dua), part 2: capture. Creates NO triggers
-- (20261007120200 does, at go-live). Every function is SECURITY DEFINER
-- or plain, owned by postgres, with search_path '' and fully qualified
-- names, so GoTrue's session (search_path=auth) cannot change what it reads.
-- =============================================================

CREATE OR REPLACE FUNCTION dua.sensitive_pattern() RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  -- Spec §7 names: token, secret, pin, hmac, fingerprint, descriptor, pan, ifsc, bank, meet. Plus auth-style names.
  SELECT '(token|secret|hmac|fingerprint|descriptor|password|passcode|(^|_)otp(_|$)|credential|private_key|api_key|(^|_)pin(_|$)|(^|_)pan(_|$)|pan_number|ifsc|bank|(^|_)meet|p256dh|auth_key|code_hash|session_data|webauthn|web_authn|recovery_code|code_challenge|authorization_code|nonce|short_code)'
$$;

CREATE OR REPLACE FUNCTION dua.drop_cols(_tbl oid) RETURNS text[]
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(array_agg(a.attname::text), '{}'::text[])
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = _tbl AND a.attnum > 0 AND NOT a.attisdropped
    AND (
      EXISTS (SELECT 1 FROM dua.column_policy p
               WHERE p.table_name = _tbl::regclass::text AND p.column_name = a.attname AND p.decision = 'exclude')
      OR (a.attname ~* dua.sensitive_pattern()
          AND NOT EXISTS (SELECT 1 FROM dua.column_policy p
                           WHERE p.table_name = _tbl::regclass::text AND p.column_name = a.attname AND p.decision = 'keep'))
    )
$$;

CREATE OR REPLACE FUNCTION dua.strip_row(_tbl oid, _row jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN _row IS NULL THEN NULL ELSE _row - dua.drop_cols(_tbl) END
$$;

CREATE OR REPLACE FUNCTION dua.strip_rows(_tbl oid, _rows jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN _rows IS NULL THEN NULL ELSE
    (SELECT coalesce(jsonb_agg(x - d.cols), '[]'::jsonb)
       FROM jsonb_array_elements(_rows) x, (SELECT dua.drop_cols(_tbl) AS cols) d) END
$$;

CREATE OR REPLACE FUNCTION dua.is_counts_only(_tbl oid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT ((SELECT n.nspname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.oid = _tbl) = 'auth'
          AND _tbl NOT IN ('auth.users'::regclass, 'auth.identities'::regclass))
      OR EXISTS (SELECT 1 FROM dua.table_mode m WHERE m.table_name = _tbl::regclass::text AND m.mode = 'counts')
$$;

CREATE OR REPLACE FUNCTION dua.pk_cols(_tbl oid) RETURNS text[]
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(array_agg(a.attname::text ORDER BY k.ord), '{}'::text[])
  FROM pg_catalog.pg_index i
  CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
  JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indrelid = _tbl AND i.indisprimary
$$;

-- Text key of a row, e.g. concat_ws('|', c."id"::text); ctid for a table without a PK.
CREATE OR REPLACE FUNCTION dua.pk_expr(_tbl oid, _alias text) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT 'concat_ws(''|'', ' || string_agg(format('%I.%I::text', _alias, c), ', ' ORDER BY o) || ')'
       FROM unnest(dua.pk_cols(_tbl)) WITH ORDINALITY u(c, o)),
    format('%I.ctid::text', _alias))
$$;

-- "(c.a, c.b) IN (SELECT (x->>'pa')::type_a, (x->>'pb')::type_b FROM jsonb_array_elements($1) x)"
CREATE OR REPLACE FUNCTION dua.fk_match(_alias text, _cols text[], _src_cols text[], _types text[]) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format('(%s) IN (SELECT %s FROM jsonb_array_elements($1) x)',
    (SELECT string_agg(format('%I.%I', _alias, c), ', ' ORDER BY o) FROM unnest(_cols) WITH ORDINALITY u(c, o)),
    (SELECT string_agg(format('(x->>%L)::%s', s, t), ', ' ORDER BY o) FROM unnest(_src_cols, _types) WITH ORDINALITY u(s, t, o)))
$$;

CREATE OR REPLACE FUNCTION dua.file_values(_v jsonb) RETURNS SETOF text
LANGUAGE sql IMMUTABLE AS $$
  SELECT s FROM (
    SELECT _v #>> '{}' AS s WHERE jsonb_typeof(_v) = 'string'
    UNION ALL
    SELECT CASE jsonb_typeof(x) WHEN 'string' THEN x #>> '{}'
                                WHEN 'object' THEN coalesce(x->>'path', x->>'storage_path', x->>'url', x->>'file_url') END
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_v) = 'array' THEN _v ELSE '[]'::jsonb END) x
  ) t WHERE s IS NOT NULL AND s <> ''
$$;

CREATE OR REPLACE FUNCTION dua.session_source() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE session_user::text
    WHEN 'supabase_auth_admin' THEN 'auth_api'
    WHEN 'postgres' THEN 'sql'
    WHEN 'supabase_admin' THEN 'sql'
    ELSE 'other:' || session_user::text END
$$;

-- Olympiad accounts are out of scope (decision 4). Skip only when the account is
-- an Olympiad login or sits in an Olympiad-only school, AND holds no role in any
-- other school (or a role with no school, such as super_admin).
CREATE OR REPLACE FUNCTION dua.is_olympiad_account(_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH oly_only AS (
    SELECT s.institution_id FROM public.oly_schools s
    WHERE s.is_existing_salci_school = false AND s.institution_id IS NOT NULL
  )
  SELECT (EXISTS (SELECT 1 FROM public.oly_students o WHERE o.auth_user_id = _user)
          OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user
                      AND r.institution_id IN (SELECT institution_id FROM oly_only)))
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user
                      AND (r.institution_id IS NULL OR r.institution_id NOT IN (SELECT institution_id FROM oly_only)))
$$;

-- Any column in the live deletion closure that looks sensitive and has no decision.
-- Must return 0 rows. Run after any migration that adds a table or a column.
CREATE OR REPLACE FUNCTION dua.unclassified_sensitive_columns()
RETURNS TABLE (table_name text, column_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH RECURSIVE closure(rel) AS (
    SELECT 'auth.users'::regclass::oid
    UNION
    SELECT c.conrelid FROM pg_catalog.pg_constraint c JOIN closure cl ON c.confrelid = cl.rel
    WHERE c.contype = 'f' AND c.confdeltype = 'c'
  ),
  touched AS (
    SELECT rel FROM closure
    UNION
    SELECT c.conrelid FROM pg_catalog.pg_constraint c
    WHERE c.contype = 'f' AND c.confdeltype IN ('n', 'd') AND c.confrelid IN (SELECT rel FROM closure)
  )
  SELECT t.rel::regclass::text, a.attname::text
  FROM touched t
  JOIN pg_catalog.pg_attribute a ON a.attrelid = t.rel AND a.attnum > 0 AND NOT a.attisdropped
  WHERE a.attname ~* dua.sensitive_pattern()
    AND NOT dua.is_counts_only(t.rel)
    AND NOT EXISTS (SELECT 1 FROM dua.column_policy p WHERE p.table_name = t.rel::regclass::text AND p.column_name = a.attname)
  ORDER BY 1, 2
$$;

CREATE OR REPLACE FUNCTION dua.delete_context(_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := coalesce(current_setting('salci.delete_actor', true), '');
  v_source text := nullif(current_setting('salci.delete_source', true), '');
  v_req boolean := coalesce(current_setting('salci.delete_on_request', true), '') = 'on';
  i record;
BEGIN
  IF v_source IS NOT NULL THEN   -- set by hand in a SQL session
    RETURN jsonb_build_object('actor', CASE WHEN v_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_actor END,
                              'source', v_source, 'on_request', v_req, 'intent_id', NULL);
  END IF;
  SELECT d.id, d.actor_id, d.source, d.on_request INTO i
  FROM dua.delete_intents d
  WHERE d.user_id = _user AND d.consumed_at IS NULL AND d.cancelled_at IS NULL
    AND d.created_at > now() - interval '10 minutes'
  ORDER BY d.created_at DESC, d.id DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('actor', i.actor_id, 'source', i.source, 'on_request', i.on_request, 'intent_id', i.id);
  END IF;
  RETURN jsonb_build_object('actor', NULL, 'source', dua.session_source(), 'on_request', v_req, 'intent_id', NULL);
END $$;

CREATE OR REPLACE FUNCTION dua.capture_user(_user uuid, _ctx jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_archive uuid := gen_random_uuid();
  v_cap integer;
  v_depth integer;
  v_on_request boolean := coalesce((_ctx->>'on_request')::boolean, false);
  v_actor_txt text := coalesce(_ctx->>'actor', '');
  v_actor uuid;
  v_source text := coalesce(nullif(_ctx->>'source', ''), dua.session_source());
  v_round integer := 0;
  v_level integer;
  v_added bigint;
  v_n bigint;
  v_cnt bigint;
  v_parents jsonb;
  v_pks jsonb;
  v_snap jsonb;
  f record;
  r record;
BEGIN
  -- Test hook: lets the suite prove best_effort and required behaviour. Never set in production.
  IF current_setting('dua.test_fail', true) = 'on' THEN
    RAISE EXCEPTION 'dua test failure (injected by a test)';
  END IF;
  IF dua.is_olympiad_account(_user) THEN
    RETURN NULL;
  END IF;
  IF v_actor_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_actor := v_actor_txt::uuid;
  END IF;
  SELECT s.authored_snapshot_cap, s.ref_depth INTO v_cap, v_depth FROM dua.settings s;

  -- 1. Header. On-request (decision 5): no name, email or personal fields.
  INSERT INTO dua.users (id, user_id, kind, full_name, email, phone, admission_number, roll_number, avatar_path,
                         roles, institution_id, institution_name, class_sections, wings,
                         account_created_at, last_sign_in_at, last_active_at,
                         deleted_at, deleted_by, deleted_by_name, deleted_by_roles, source, source_detail, stmt_token)
  SELECT v_archive, _user,
         CASE WHEN v_on_request THEN 'on_request' ELSE 'captured' END,
         CASE WHEN v_on_request THEN NULL ELSE coalesce(p.full_name, u.raw_user_meta_data->>'full_name') END,
         CASE WHEN v_on_request THEN NULL ELSE coalesce(u.email, p.email) END,
         CASE WHEN v_on_request THEN NULL ELSE coalesce(p.phone, u.phone) END,
         CASE WHEN v_on_request THEN NULL ELSE p.admission_number END,
         CASE WHEN v_on_request THEN NULL ELSE p.roll_number END,
         CASE WHEN v_on_request THEN NULL ELSE p.avatar_path END,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('role', ur.role, 'institution_id', ur.institution_id,
                    'institution_name', i.name, 'granted_at', ur.granted_at, 'admin_title', ur.admin_title)
                    ORDER BY ur.granted_at), '[]'::jsonb)
            FROM public.user_roles ur LEFT JOIN public.institutions i ON i.id = ur.institution_id
           WHERE ur.user_id = _user),
         p.institution_id,
         (SELECT i.name FROM public.institutions i WHERE i.id = p.institution_id),
         CASE WHEN v_on_request THEN '[]'::jsonb ELSE
           (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('class_id', c.id, 'name', c.name, 'section', c.section, 'role', ca.role)), '[]'::jsonb)
              FROM public.class_assignments ca JOIN public.classes c ON c.id = ca.class_id WHERE ca.user_id = _user) END,
         CASE WHEN v_on_request THEN '[]'::jsonb ELSE
           (SELECT coalesce(jsonb_agg(jsonb_build_object('wing_id', w.id, 'name', w.name)), '[]'::jsonb)
              FROM public.wing_assignments wa JOIN public.wings w ON w.id = wa.wing_id WHERE wa.user_id = _user) END,
         CASE WHEN v_on_request THEN NULL ELSE u.created_at END,
         CASE WHEN v_on_request THEN NULL ELSE u.last_sign_in_at END,
         CASE WHEN v_on_request THEN NULL ELSE greatest(
             (SELECT max(greatest(s.refreshed_at AT TIME ZONE 'UTC', s.updated_at)) FROM auth.sessions s WHERE s.user_id = _user),
             (SELECT max(d.activity_date)::timestamptz FROM public.student_activity_daily d WHERE d.student_id = _user),
             (SELECT max(l.activity_date)::timestamptz FROM public.user_activity_log l WHERE l.user_id = _user)) END,
         now(), v_actor,
         (SELECT ap.full_name FROM public.profiles ap WHERE ap.id = v_actor),
         (SELECT coalesce(jsonb_agg(DISTINCT ar.role), '[]'::jsonb) FROM public.user_roles ar WHERE ar.user_id = v_actor),
         v_source,
         jsonb_build_object('session_user', session_user::text, 'application_name', current_setting('application_name', true),
                            'intent_id', _ctx->'intent_id'),
         nullif(current_setting('dua.stmt_token', true), '')
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = _user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dua: auth user % not found', _user;
  END IF;
  IF v_on_request THEN
    RETURN v_archive;   -- not registered for the completeness check: nothing is archived on purpose
  END IF;

  -- 2. FK graph and walk state (temp tables live only for this transaction).
  CREATE TEMP TABLE IF NOT EXISTS dua_fk (child oid, parent oid, child_cols text[], parent_cols text[],
                                          child_types text[], parent_types text[], deltype "char") ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS dua_walk (tbl oid NOT NULL, pk text NOT NULL, row jsonb NOT NULL,
                                            round integer NOT NULL, PRIMARY KEY (tbl, pk)) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS dua_ref (tbl oid NOT NULL, pk text NOT NULL, row jsonb NOT NULL,
                                           depth integer NOT NULL, PRIMARY KEY (tbl, pk)) ON COMMIT DROP;
  DELETE FROM pg_temp.dua_fk;
  DELETE FROM pg_temp.dua_walk;
  DELETE FROM pg_temp.dua_ref;

  INSERT INTO pg_temp.dua_fk
  SELECT c.conrelid, c.confrelid,
         ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.o),
         ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.o),
         ARRAY(SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.o),
         ARRAY(SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
                 JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.o),
         c.confdeltype
  FROM pg_catalog.pg_constraint c
  WHERE c.contype = 'f' AND c.connamespace <> 'dua'::regnamespace;

  INSERT INTO pg_temp.dua_walk (tbl, pk, row, round)
  SELECT 'auth.users'::regclass, u.id::text, to_jsonb(u), 0 FROM auth.users u WHERE u.id = _user;

  -- 3. Walk every ON DELETE CASCADE edge, locking what it reads, until nothing new appears.
  LOOP
    v_added := 0;
    FOR f IN
      SELECT k.* FROM pg_temp.dua_fk k
      WHERE k.deltype = 'c'
        AND k.parent IN (SELECT DISTINCT w.tbl FROM pg_temp.dua_walk w WHERE w.round = v_round)
    LOOP
      SELECT jsonb_agg(w.row) INTO v_parents FROM pg_temp.dua_walk w WHERE w.tbl = f.parent AND w.round = v_round;
      EXECUTE format(
        'INSERT INTO pg_temp.dua_walk (tbl, pk, row, round)
           SELECT s.tbl, s.pk, s.row, s.round FROM (
             SELECT %s::oid AS tbl, %s AS pk, to_jsonb(c) AS row, %s AS round
               FROM %s c WHERE %s FOR UPDATE OF c) s
         ON CONFLICT (tbl, pk) DO NOTHING',
        f.child, dua.pk_expr(f.child, 'c'), v_round + 1, f.child::regclass,
        dua.fk_match('c', f.child_cols, f.parent_cols, f.child_types))
      USING v_parents;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_added := v_added + v_n;
    END LOOP;
    EXIT WHEN v_added = 0;
    v_round := v_round + 1;
    IF v_round > 25 THEN
      RAISE EXCEPTION 'dua: cascade walk did not converge for user %', _user;
    END IF;
  END LOOP;

  -- 4. Row images per table (stripped), or counts only.
  FOR r IN
    SELECT w.tbl, count(*) AS n, array_agg(w.pk ORDER BY w.pk) AS pks, jsonb_agg(w.row ORDER BY w.pk) AS rws
    FROM pg_temp.dua_walk w GROUP BY w.tbl
  LOOP
    INSERT INTO dua.rows (archive_id, table_name, mode, row_count, row_pks, rows)
    VALUES (v_archive, r.tbl::regclass::text,
            CASE WHEN dua.is_counts_only(r.tbl) THEN 'counts' ELSE 'rows' END,
            r.n, r.pks,
            CASE WHEN dua.is_counts_only(r.tbl) THEN NULL ELSE dua.strip_rows(r.tbl, r.rws) END);
  END LOOP;

  -- 5. Surviving rows whose link to a deleted row will be cleared (ON DELETE SET NULL / SET DEFAULT).
  FOR f IN
    SELECT k.* FROM pg_temp.dua_fk k
    WHERE k.deltype IN ('n', 'd') AND k.parent IN (SELECT DISTINCT w.tbl FROM pg_temp.dua_walk w)
  LOOP
    SELECT jsonb_agg(w.row) INTO v_parents FROM pg_temp.dua_walk w WHERE w.tbl = f.parent;
    -- One pass: every id, plus a full copy of the first authored_snapshot_cap rows.
    EXECUTE format(
      'SELECT count(*), coalesce(jsonb_agg(s.pk), ''[]''::jsonb), jsonb_agg(s.r) FILTER (WHERE s.r IS NOT NULL)
         FROM (SELECT %s AS pk, CASE WHEN row_number() OVER () <= %s THEN to_jsonb(c) END AS r
                 FROM %s c
                WHERE %s AND NOT EXISTS (SELECT 1 FROM pg_temp.dua_walk w2 WHERE w2.tbl = %s::oid AND w2.pk = %s)) s',
      dua.pk_expr(f.child, 'c'), v_cap, f.child::regclass, dua.fk_match('c', f.child_cols, f.parent_cols, f.child_types),
      f.child, dua.pk_expr(f.child, 'c'))
    INTO v_cnt, v_pks, v_snap USING v_parents;
    CONTINUE WHEN v_cnt = 0;
    v_snap := dua.strip_rows(f.child, v_snap);
    INSERT INTO dua.links (archive_id, table_name, column_name, references_table, row_count, row_pks, snapshots)
    VALUES (v_archive, f.child::regclass::text, array_to_string(f.child_cols, ','), f.parent::regclass::text,
            v_cnt, v_pks, v_snap)
    ON CONFLICT (archive_id, table_name, column_name) DO NOTHING;
  END LOOP;

  -- 6. Rows that archived rows point at (depth 1), and what those point at (depth 2).
  --    People are reduced to id + name.
  FOR v_level IN 1..v_depth LOOP
    FOR f IN
      SELECT k.* FROM pg_temp.dua_fk k
      WHERE k.child IN (SELECT w.tbl FROM pg_temp.dua_walk w WHERE v_level = 1
                        UNION SELECT x.tbl FROM pg_temp.dua_ref x WHERE x.depth = v_level - 1)
    LOOP
      SELECT jsonb_agg(src.row) INTO v_parents FROM (
        SELECT w.row FROM pg_temp.dua_walk w WHERE v_level = 1 AND w.tbl = f.child
        UNION ALL
        SELECT x.row FROM pg_temp.dua_ref x WHERE x.depth = v_level - 1 AND x.tbl = f.child) src;
      CONTINUE WHEN v_parents IS NULL;
      EXECUTE format(
        'INSERT INTO pg_temp.dua_ref (tbl, pk, row, depth)
           SELECT %s::oid, %s, %s, %s FROM %s p
            WHERE %s
              AND NOT EXISTS (SELECT 1 FROM pg_temp.dua_walk w WHERE w.tbl = %s::oid AND w.pk = %s)
         ON CONFLICT (tbl, pk) DO NOTHING',
        f.parent, dua.pk_expr(f.parent, 'p'),
        CASE WHEN f.parent = 'public.profiles'::regclass THEN 'jsonb_build_object(''id'', p.id, ''full_name'', p.full_name)'
             WHEN f.parent = 'auth.users'::regclass THEN 'jsonb_build_object(''id'', p.id, ''full_name'', p.raw_user_meta_data->>''full_name'')'
             ELSE 'to_jsonb(p)' END,
        v_level, f.parent::regclass,
        dua.fk_match('p', f.parent_cols, f.child_cols, f.parent_types),
        f.parent, dua.pk_expr(f.parent, 'p'))
      USING v_parents;
    END LOOP;
  END LOOP;
  INSERT INTO dua.refs (archive_id, table_name, row_pk, depth, row)
  SELECT v_archive, x.tbl::regclass::text, x.pk, x.depth,
         CASE WHEN dua.is_counts_only(x.tbl) THEN jsonb_build_object('pk', x.pk) ELSE dua.strip_row(x.tbl, x.row) END
  FROM pg_temp.dua_ref x;

  -- 7. Files: values in path/url columns of archived rows, resolved to storage.objects where they
  --    exist, plus every object the user owns or whose path carries their id. A manifest error is
  --    recorded and never fails the capture (spec §3: file gaps are recorded, they do not block).
  BEGIN
  INSERT INTO dua.files (archive_id, source, raw_value)
  SELECT DISTINCT v_archive, 'row:' || w.tbl::regclass::text || '.' || e.key, v.val
  FROM pg_temp.dua_walk w
  CROSS JOIN LATERAL jsonb_each(w.row) e
  CROSS JOIN LATERAL dua.file_values(e.value) v(val)
  WHERE NOT dua.is_counts_only(w.tbl)
    AND (e.key ~ '(_path|_url|_paths|_urls)$' OR e.key IN ('attachments', 'attachment')
         OR EXISTS (SELECT 1 FROM dua.file_columns fc WHERE fc.table_name = w.tbl::regclass::text AND fc.column_name = e.key));
  UPDATE dua.files df
     SET bucket = o.bucket_id, path = o.name,
         size_bytes = nullif(o.metadata->>'size', '')::bigint, mime = o.metadata->>'mimetype'
    FROM storage.objects o
   WHERE df.archive_id = v_archive AND df.bucket IS NULL
     AND ((o.bucket_id = substring(df.raw_value from '/storage/v1/object/(?:public|sign|authenticated)/([^/]+)/')
           AND o.name = split_part(substring(df.raw_value from '/storage/v1/object/(?:public|sign|authenticated)/[^/]+/(.+)$'), '?', 1))
          OR o.name = df.raw_value);
  INSERT INTO dua.files (archive_id, source, raw_value, bucket, path, size_bytes, mime)
  SELECT v_archive,
         CASE WHEN o.owner = _user OR o.owner_id = _user::text THEN 'storage_owner' ELSE 'storage_path' END,
         o.bucket_id || '/' || o.name, o.bucket_id, o.name, nullif(o.metadata->>'size', '')::bigint, o.metadata->>'mimetype'
  FROM storage.objects o
  WHERE o.owner = _user OR o.owner_id = _user::text OR position(_user::text IN o.name) > 0;
  EXCEPTION WHEN OTHERS THEN
    UPDATE dua.users SET field_sources = field_sources || jsonb_build_object('files_error', SQLSTATE || ' ' || SQLERRM)
    WHERE id = v_archive;
  END;

  -- 8. Traces that already exist outside the cascade.
  INSERT INTO dua.traces (archive_id, source, payload)
  SELECT v_archive, 'class_assignment_deletions', to_jsonb(d) FROM public.class_assignment_deletions d WHERE d.user_id = _user;
  INSERT INTO dua.traces (archive_id, source, payload)
  SELECT v_archive, 'system_audit_logs', to_jsonb(a)
  FROM (SELECT * FROM public.system_audit_logs x WHERE x.entity_id = _user ORDER BY x.created_at DESC LIMIT 5000) a;
  INSERT INTO dua.traces (archive_id, source, payload)
  SELECT v_archive, 'dashboard_flags', to_jsonb(df) FROM public.dashboard_flags df WHERE df.subject_key = _user::text;
  INSERT INTO dua.traces (archive_id, source, payload)
  SELECT v_archive, 'onboarding_snapshots', jsonb_build_object('snapshot', to_jsonb(o) - 'per_user_data', 'entry', e)
  FROM public.onboarding_snapshots o
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.per_user_data) = 'array' THEN o.per_user_data ELSE '[]'::jsonb END) e
  WHERE e->>'user_id' = _user::text;

  -- 9. Every person each archived row mentions, so a later lookup or scrub finds rows about others.
  INSERT INTO dua.people_index (archive_id, table_name, row_pk, person_id)
  SELECT DISTINCT v_archive, w.tbl::regclass::text, w.pk, (w.row->>k.child_cols[1])::uuid
  FROM pg_temp.dua_walk w
  JOIN pg_temp.dua_fk k ON k.child = w.tbl AND cardinality(k.child_cols) = 1
                       AND k.parent IN ('public.profiles'::regclass, 'auth.users'::regclass)
  WHERE (w.row->>k.child_cols[1]) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ON CONFLICT DO NOTHING;

  UPDATE dua.users SET total_rows = (SELECT coalesce(sum(x.row_count), 0) FROM dua.rows x WHERE x.archive_id = v_archive)
  WHERE id = v_archive;
  PERFORM set_config('dua.stmt_archives',
                     concat_ws(',', nullif(current_setting('dua.stmt_archives', true), ''), v_archive::text), true);
  RETURN v_archive;
END $$;

REVOKE EXECUTE ON FUNCTION dua.capture_user(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION dua.delete_context(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION dua.stmt_begin() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM set_config('dua.baseline',
    (SELECT jsonb_build_object(
              'del', coalesce(jsonb_object_agg(s.relid::text, s.n_tup_del), '{}'::jsonb),
              'upd', coalesce(jsonb_object_agg(s.relid::text, s.n_tup_upd), '{}'::jsonb))::text
       FROM pg_catalog.pg_stat_xact_user_tables s), true);
  PERFORM set_config('dua.stmt_archives', '', true);
  PERFORM set_config('dua.stmt_token', gen_random_uuid()::text, true);
END $$;

-- Compares rows Postgres actually deleted in this statement with rows archived for it,
-- de-duplicated across every account in the statement. Never raises: a partial result
-- never blocks (spec §2).
CREATE OR REPLACE FUNCTION dua.stmt_end() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_base jsonb := coalesce(nullif(current_setting('dua.baseline', true), '')::jsonb, '{}'::jsonb);
  v_ids uuid[];
  v_mismatch jsonb;
  v_expected jsonb;
  v_updated jsonb;
BEGIN
  v_ids := ARRAY(SELECT x::uuid FROM unnest(string_to_array(coalesce(current_setting('dua.stmt_archives', true), ''), ',')) x
                  WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  IF cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;
  BEGIN
    -- The archive's own tables and the walk's temp tables are not part of the delete.
    WITH deltas AS (
      SELECT s.relid::regclass::text AS tname,
             s.n_tup_del - coalesce((v_base->'del'->>(s.relid::text))::bigint, 0) AS deleted
      FROM pg_catalog.pg_stat_xact_user_tables s
      WHERE s.schemaname <> 'dua' AND s.schemaname NOT LIKE 'pg\_temp%'
    ),
    archived AS (
      SELECT r.table_name AS tname, count(DISTINCT p.pk) AS archived
      FROM dua.rows r CROSS JOIN LATERAL unnest(r.row_pks) p(pk)
      WHERE r.archive_id = ANY (v_ids)
      GROUP BY r.table_name
    ),
    cmp AS (
      SELECT coalesce(d.tname, a.tname) AS tname, coalesce(d.deleted, 0) AS deleted, coalesce(a.archived, 0) AS archived
      FROM deltas d FULL JOIN archived a ON a.tname = d.tname
      WHERE coalesce(d.deleted, 0) <> coalesce(a.archived, 0)
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('table', c.tname, 'deleted', c.deleted, 'archived', c.archived))
                      FILTER (WHERE NOT EXISTS (SELECT 1 FROM dua.expected_side_effects e WHERE e.table_name = c.tname)), '[]'::jsonb),
           coalesce(jsonb_agg(jsonb_build_object('table', c.tname, 'deleted', c.deleted, 'archived', c.archived))
                      FILTER (WHERE EXISTS (SELECT 1 FROM dua.expected_side_effects e WHERE e.table_name = c.tname)), '[]'::jsonb)
      INTO v_mismatch, v_expected
    FROM cmp c;

    -- Rows the delete updated (ON DELETE SET NULL and trigger side effects), kept for the record.
    SELECT coalesce(jsonb_object_agg(x.tname, x.updated), '{}'::jsonb) INTO v_updated
    FROM (SELECT s.relid::regclass::text AS tname,
                 s.n_tup_upd - coalesce((v_base->'upd'->>(s.relid::text))::bigint, 0) AS updated
            FROM pg_catalog.pg_stat_xact_user_tables s
           WHERE s.schemaname <> 'dua' AND s.schemaname NOT LIKE 'pg\_temp%') x
    WHERE x.updated > 0;

    UPDATE dua.users
       SET is_complete = (jsonb_array_length(v_mismatch) = 0),
           completeness = jsonb_build_object('mismatches', v_mismatch, 'expected', v_expected, 'updated', v_updated,
                                             'archives_in_statement', cardinality(v_ids), 'checked_at', now())
     WHERE id = ANY (v_ids) AND kind = 'captured';

    -- The trigger-audit rows (tg_audit_row) this delete just wrote about the archived rows.
    INSERT INTO dua.traces (archive_id, source, payload)
    SELECT DISTINCT r.archive_id, 'system_audit_logs:this_delete', to_jsonb(a)
    FROM public.system_audit_logs a
    JOIN dua.rows r ON r.archive_id = ANY (v_ids) AND a.entity_id::text = ANY (r.row_pks)
    WHERE a.created_at >= now();
  EXCEPTION WHEN OTHERS THEN
    UPDATE dua.users
       SET is_complete = NULL,
           completeness = jsonb_build_object('error', SQLSTATE || ' ' || SQLERRM, 'checked_at', now())
     WHERE id = ANY (v_ids);
  END;
END $$;

-- best_effort: a capture error is recorded and the delete proceeds. required (Plan 2): the error aborts the delete.
-- The intent is marked consumed OUTSIDE the failure boundary, so a failed capture still uses it up.
CREATE OR REPLACE FUNCTION dua.capture_guarded(_user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_mode text; v_ctx jsonb; v_req boolean; v_id uuid; v_state text; v_msg text; v_where text;
BEGIN
  SELECT s.capture_mode INTO v_mode FROM dua.settings s;
  v_ctx := dua.delete_context(_user);
  v_req := coalesce((v_ctx->>'on_request')::boolean, false);
  IF v_mode = 'required' THEN
    v_id := dua.capture_user(_user, v_ctx);
  ELSE
    BEGIN
      v_id := dua.capture_user(_user, v_ctx);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_where = PG_EXCEPTION_CONTEXT;
      INSERT INTO dua.users (user_id, kind, full_name, email, deleted_by, deleted_by_name, source, source_detail,
                             deleted_at, error, stmt_token)
      SELECT _user, 'capture_failed',
             CASE WHEN v_req THEN NULL ELSE (SELECT p.full_name FROM public.profiles p WHERE p.id = _user) END,
             CASE WHEN v_req THEN NULL ELSE (SELECT u.email FROM auth.users u WHERE u.id = _user) END,
             (v_ctx->>'actor')::uuid,
             (SELECT ap.full_name FROM public.profiles ap WHERE ap.id = (v_ctx->>'actor')::uuid),
             v_ctx->>'source',
             jsonb_build_object('session_user', session_user::text, 'application_name', current_setting('application_name', true),
                                'intent_id', v_ctx->'intent_id', 'on_request', v_req),
             now(), v_state || ' ' || v_msg || ' @ ' || left(coalesce(v_where, ''), 500),
             nullif(current_setting('dua.stmt_token', true), '')
      RETURNING id INTO v_id;
    END;
  END IF;
  IF v_ctx->>'intent_id' IS NOT NULL THEN
    UPDATE dua.delete_intents SET consumed_at = now(), archive_id = v_id WHERE id = (v_ctx->>'intent_id')::bigint;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION dua.trg_stmt_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM dua.stmt_begin(); RETURN NULL; END $$;

CREATE OR REPLACE FUNCTION dua.trg_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM dua.capture_guarded(OLD.id); RETURN OLD; END $$;

CREATE OR REPLACE FUNCTION dua.trg_stmt_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM dua.stmt_end(); RETURN NULL; END $$;

-- admin-operations calls this just before GoTrue's deleteUser, so the archive can name
-- who deleted. Small on purpose: PostgREST runs it under authenticator's 8 s
-- statement_timeout, and the DELETE itself stays in GoTrue (120 s, auth audit event).
CREATE OR REPLACE FUNCTION public.dua_note_delete(_user_ids uuid[], _actor_id uuid,
                                                  _source text DEFAULT 'app', _on_request boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  IF _user_ids IS NULL OR cardinality(_user_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(_user_ids) > 2000 THEN
    RAISE EXCEPTION 'at most 2000 users per call' USING ERRCODE = '22023';
  END IF;
  INSERT INTO dua.delete_intents (user_id, actor_id, source, on_request)
  SELECT DISTINCT u, _actor_id, coalesce(nullif(_source, ''), 'app'), coalesce(_on_request, false)
  FROM unnest(_user_ids) u
  WHERE u IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- After a failed deleteUser, so the intent cannot attribute a later delete made by another path.
CREATE OR REPLACE FUNCTION public.dua_cancel_delete_intent(_user_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  UPDATE dua.delete_intents SET cancelled_at = now()
   WHERE user_id = _user_id AND consumed_at IS NULL AND cancelled_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'dua.sensitive_pattern()', 'dua.drop_cols(oid)', 'dua.strip_row(oid, jsonb)', 'dua.strip_rows(oid, jsonb)',
    'dua.is_counts_only(oid)', 'dua.pk_cols(oid)', 'dua.pk_expr(oid, text)', 'dua.fk_match(text, text[], text[], text[])',
    'dua.file_values(jsonb)', 'dua.session_source()', 'dua.is_olympiad_account(uuid)', 'dua.unclassified_sensitive_columns()',
    'dua.delete_context(uuid)', 'dua.capture_user(uuid, jsonb)', 'dua.stmt_begin()', 'dua.stmt_end()', 'dua.capture_guarded(uuid)',
    'dua.trg_stmt_before()', 'dua.trg_capture()', 'dua.trg_stmt_after()',
    'public.dua_note_delete(uuid[], uuid, text, boolean)', 'public.dua_cancel_delete_intent(uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.dua_note_delete(uuid[], uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.dua_cancel_delete_intent(uuid) TO service_role;
