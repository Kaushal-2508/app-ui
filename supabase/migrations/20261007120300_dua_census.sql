-- =============================================================
-- Deleted-user archive (dua), part 4: the census of past deletions (spec §8).
-- One 'legacy' entry per account that is proven deleted: its id appears in the
-- audit trail, role or class history, homework audit, storage or the platform
-- log, and it no longer exists in auth.users. Every field records its source
-- in field_sources. Records themselves were destroyed by the cascade and are
-- not recoverable; these entries carry only the facts that survived.
-- Re-runnable: dua.backfill_census() replaces every 'legacy' entry.
-- =============================================================

CREATE OR REPLACE FUNCTION dua.backfill_census() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v jsonb;
BEGIN
  DROP TABLE IF EXISTS pg_temp.c_ids, pg_temp.c_ud, pg_temp.c_uc, pg_temp.c_oth, pg_temp.c_role,
                       pg_temp.c_cad, pg_temp.c_lg, pg_temp.c_fn, pg_temp.c_row, pg_temp.c_inst, pg_temp.c_live;

  -- 1. Every id that some trace says existed and auth.users says is gone.
  CREATE TEMP TABLE c_ids (uid uuid PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO c_ids
  SELECT DISTINCT s.uid FROM (
    SELECT a.entity_id AS uid FROM public.system_audit_logs a
     WHERE a.action IN ('user_deleted', 'user_created') OR a.entity_type IN ('user', 'User', 'Student')
    UNION ALL
    SELECT (coalesce(a.old_values, a.new_values)->>'user_id')::uuid FROM public.system_audit_logs a
     WHERE a.action IN ('role_deleted', 'role_created', 'wing_coordinator_deleted', 'wing_coordinator_created')
       AND coalesce(a.old_values, a.new_values)->>'user_id' ~* uuid_re
    UNION ALL SELECT d.user_id FROM public.class_assignment_deletions d
    UNION ALL SELECT h.student_id FROM public.homework_mark_audit h
    UNION ALL SELECT coalesce(o.owner::text, o.owner_id)::uuid FROM storage.objects o
               WHERE coalesce(o.owner::text, o.owner_id) ~* uuid_re
    UNION ALL SELECT e.subject_user_id FROM dua.legacy_evidence e WHERE e.kind = 'user_deleted'
  ) s
  WHERE s.uid IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.uid)
    AND NOT EXISTS (SELECT 1 FROM dua.users x WHERE x.user_id = s.uid AND x.kind <> 'legacy');

  -- 2. One pass per source, aggregated per id.
  CREATE TEMP TABLE c_ud ON COMMIT DROP AS
  SELECT DISTINCT ON (a.entity_id) a.entity_id AS uid, a.created_at, a.actor_id, nullif(a.entity_name, '') AS name,
         nullif(a.old_values->>'institution_id', '') AS inst
  FROM public.system_audit_logs a JOIN c_ids i ON i.uid = a.entity_id
  WHERE a.action = 'user_deleted'
  ORDER BY a.entity_id, a.created_at DESC;

  CREATE TEMP TABLE c_uc ON COMMIT DROP AS
  SELECT DISTINCT ON (a.entity_id) a.entity_id AS uid, a.created_at, nullif(a.entity_name, '') AS name,
         nullif(a.new_values->>'email', '') AS email, nullif(a.new_values->>'role', '') AS role,
         nullif(a.metadata->>'institution_id', '') AS inst
  FROM public.system_audit_logs a JOIN c_ids i ON i.uid = a.entity_id
  WHERE a.action = 'user_created'
  ORDER BY a.entity_id, a.created_at;

  CREATE TEMP TABLE c_oth ON COMMIT DROP AS
  SELECT DISTINCT ON (a.entity_id) a.entity_id AS uid, a.entity_name AS name
  FROM public.system_audit_logs a JOIN c_ids i ON i.uid = a.entity_id
  WHERE a.entity_type IN ('user', 'User', 'Student') AND nullif(a.entity_name, '') IS NOT NULL
    AND a.action NOT IN ('user_deleted', 'user_created')
  ORDER BY a.entity_id, a.created_at DESC;

  CREATE TEMP TABLE c_role ON COMMIT DROP AS
  SELECT (coalesce(a.old_values, a.new_values)->>'user_id')::uuid AS uid,
         jsonb_agg(DISTINCT jsonb_build_object('role', coalesce(a.old_values, a.new_values)->>'role',
                                               'institution_id', coalesce(a.old_values, a.new_values)->>'institution_id',
                                               'admin_title', coalesce(a.old_values, a.new_values)->>'admin_title')) AS roles,
         (array_agg(nullif(coalesce(a.old_values, a.new_values)->>'institution_id', '') ORDER BY a.created_at)
            FILTER (WHERE nullif(coalesce(a.old_values, a.new_values)->>'institution_id', '') IS NOT NULL))[1] AS inst,
         array_agg(DISTINCT nullif(coalesce(a.old_values, a.new_values)->>'institution_id', ''))
            FILTER (WHERE nullif(coalesce(a.old_values, a.new_values)->>'institution_id', '') IS NOT NULL) AS insts,
         min(nullif(coalesce(a.old_values, a.new_values)->>'granted_at', '')::timestamptz) AS granted_min,
         max(a.created_at) FILTER (WHERE a.action = 'role_deleted') AS role_deleted_at
  FROM public.system_audit_logs a
  WHERE a.action IN ('role_deleted', 'role_created')
    AND coalesce(a.old_values, a.new_values)->>'user_id' ~* uuid_re
    AND (coalesce(a.old_values, a.new_values)->>'user_id')::uuid IN (SELECT uid FROM c_ids)
  GROUP BY 1;

  CREATE TEMP TABLE c_cad ON COMMIT DROP AS
  SELECT d.user_id AS uid,
         jsonb_agg(DISTINCT jsonb_build_object('class_id', d.class_id, 'name', c.name, 'section', c.section, 'role', d.role))
           FILTER (WHERE d.class_id IS NOT NULL) AS classes,
         (array_agg(d.institution_id ORDER BY d.deleted_at DESC) FILTER (WHERE d.institution_id IS NOT NULL))[1]::text AS inst,
         array_agg(DISTINCT d.role) FILTER (WHERE d.role IS NOT NULL) AS roles,
         max(d.deleted_at) AS last_at
  FROM public.class_assignment_deletions d
  JOIN c_ids i ON i.uid = d.user_id
  LEFT JOIN public.classes c ON c.id = d.class_id
  GROUP BY d.user_id;

  CREATE TEMP TABLE c_lg ON COMMIT DROP AS
  SELECT e.subject_user_id AS uid,
         max(e.event_at) FILTER (WHERE e.kind = 'user_deleted') AS del_at,
         (array_agg(e.email ORDER BY e.event_at DESC) FILTER (WHERE e.kind = 'user_deleted' AND e.email IS NOT NULL))[1] AS del_email,
         min(e.event_at) FILTER (WHERE e.kind = 'user_signedup') AS signup_at,
         (array_agg(e.email ORDER BY e.event_at) FILTER (WHERE e.kind = 'user_signedup' AND e.email IS NOT NULL))[1] AS signup_email,
         max(nullif(e.payload->>'last_at', '')::timestamptz) FILTER (WHERE e.kind = 'auth_activity') AS last_active
  FROM dua.legacy_evidence e JOIN c_ids i ON i.uid = e.subject_user_id
  GROUP BY e.subject_user_id;

  -- Who ran the delete, for log-only deletions: the nearest admin-operations delete
  -- line in the 15 minutes before GoTrue logged it (an inference, labelled as one).
  CREATE TEMP TABLE c_fn ON COMMIT DROP AS
  SELECT l.uid, f.actor_user_id AS actor, f.event_at AS fn_at, f.payload->>'message' AS msg
  FROM c_lg l
  CROSS JOIN LATERAL (
    SELECT e.actor_user_id, e.event_at, e.payload FROM dua.legacy_evidence e
    WHERE e.kind = 'function_log' AND e.actor_user_id IS NOT NULL
      AND e.payload->>'message' ~ 'Admin operation: (delete_user|bulk_delete_students|delete_institution)'
      AND e.event_at BETWEEN l.del_at - interval '15 minutes' AND l.del_at
    ORDER BY e.event_at DESC LIMIT 1) f
  WHERE l.del_at IS NOT NULL;

  -- 3. Assemble.
  CREATE TEMP TABLE c_row ON COMMIT DROP AS
  SELECT i.uid,
         coalesce(ud.name, uc.name, oth.name) AS full_name,
         CASE WHEN ud.name IS NOT NULL THEN 'user_deleted audit row' WHEN uc.name IS NOT NULL THEN 'user_created audit row'
              WHEN oth.name IS NOT NULL THEN 'other audit row' END AS name_src,
         lower(coalesce(uc.email, lg.del_email, lg.signup_email)) AS email,
         CASE WHEN uc.email IS NOT NULL THEN 'user_created audit row' WHEN lg.del_email IS NOT NULL THEN 'auth log: user_deleted'
              WHEN lg.signup_email IS NOT NULL THEN 'auth log: user_signedup' END AS email_src,
         coalesce(ud.inst, uc.inst, rl.inst, cad.inst) AS inst,
         CASE WHEN ud.inst IS NOT NULL THEN 'user_deleted audit row' WHEN uc.inst IS NOT NULL THEN 'user_created audit row'
              WHEN rl.inst IS NOT NULL THEN 'role audit rows' WHEN cad.inst IS NOT NULL THEN 'class_assignment_deletions' END AS inst_src,
         array_remove(ARRAY[ud.inst, uc.inst, cad.inst] || coalesce(rl.insts, '{}'::text[]), NULL) AS all_insts,
         coalesce(rl.roles,
                  CASE WHEN uc.role IS NOT NULL THEN jsonb_build_array(jsonb_build_object('role', uc.role, 'institution_id', uc.inst)) END,
                  (SELECT jsonb_agg(jsonb_build_object('role', r, 'institution_id', cad.inst)) FROM unnest(cad.roles) r)) AS roles,
         CASE WHEN rl.roles IS NOT NULL THEN 'role audit rows' WHEN uc.role IS NOT NULL THEN 'user_created audit row'
              WHEN cad.roles IS NOT NULL THEN 'class_assignment_deletions' END AS role_src,
         coalesce(uc.created_at, rl.granted_min, lg.signup_at) AS created_at,
         CASE WHEN uc.created_at IS NOT NULL THEN 'user_created audit row' WHEN rl.granted_min IS NOT NULL THEN 'first role grant'
              WHEN lg.signup_at IS NOT NULL THEN 'auth log: user_signedup' END AS created_src,
         coalesce(ud.created_at, lg.del_at, rl.role_deleted_at) AS deleted_at,
         CASE WHEN ud.created_at IS NOT NULL THEN 'user_deleted audit row' WHEN lg.del_at IS NOT NULL THEN 'auth log: user_deleted'
              WHEN rl.role_deleted_at IS NOT NULL THEN 'role removed with the account (trigger row)' END AS deleted_src,
         greatest(uc.created_at, rl.granted_min, lg.signup_at, cad.last_at, lg.last_active) AS deleted_min,
         coalesce(ud.actor_id, fn.actor) AS actor,
         CASE WHEN ud.actor_id IS NOT NULL THEN 'user_deleted audit row'
              WHEN fn.actor IS NOT NULL THEN 'function log, nearest admin delete before it (inferred)' END AS actor_src,
         lg.last_active,
         cad.classes,
         jsonb_strip_nulls(jsonb_build_object('user_deleted_audit', ud.uid IS NOT NULL, 'user_created_audit', uc.uid IS NOT NULL,
            'role_audit', rl.uid IS NOT NULL, 'class_assignment_deletions', cad.uid IS NOT NULL,
            'auth_log', lg.uid IS NOT NULL, 'function_log', CASE WHEN fn.uid IS NOT NULL THEN fn.msg END)) AS evidence
  FROM c_ids i
  LEFT JOIN c_ud ud ON ud.uid = i.uid
  LEFT JOIN c_uc uc ON uc.uid = i.uid
  LEFT JOIN c_oth oth ON oth.uid = i.uid
  LEFT JOIN c_role rl ON rl.uid = i.uid
  LEFT JOIN c_cad cad ON cad.uid = i.uid
  LEFT JOIN c_lg lg ON lg.uid = i.uid
  LEFT JOIN c_fn fn ON fn.uid = i.uid;

  -- Olympiad accounts are out of scope (decision 4): skip ids whose every known
  -- school is Olympiad-only. Ids with no fact at all are not people we can show.
  DELETE FROM c_row r
  WHERE (r.full_name IS NULL AND r.email IS NULL)
     OR (cardinality(r.all_insts) > 0 AND NOT EXISTS (
           SELECT 1 FROM unnest(r.all_insts) x
           WHERE x NOT IN (SELECT s.institution_id::text FROM public.oly_schools s
                            WHERE s.is_existing_salci_school = false AND s.institution_id IS NOT NULL)));

  -- School names (live, or from the institution_deleted audit row) and live accounts by email.
  CREATE TEMP TABLE c_inst ON COMMIT DROP AS
  SELECT z.id, (array_agg(z.name ORDER BY z.pri) FILTER (WHERE z.name IS NOT NULL))[1] AS name, min(z.deleted_at) AS deleted_at
  FROM (SELECT i2.id::text AS id, i2.name, NULL::timestamptz AS deleted_at, 0 AS pri FROM public.institutions i2
        UNION ALL
        SELECT a.entity_id::text, nullif(a.entity_name, ''), a.created_at, 1 FROM public.system_audit_logs a
         WHERE a.action = 'institution_deleted' AND a.entity_id IS NOT NULL) z
  GROUP BY z.id;
  CREATE TEMP TABLE c_live ON COMMIT DROP AS
  SELECT DISTINCT ON (lower(u.email)) lower(u.email) AS email, u.id, u.created_at
  FROM auth.users u WHERE u.email IS NOT NULL
  ORDER BY lower(u.email), u.created_at;

  DELETE FROM dua.users WHERE kind = 'legacy';

  INSERT INTO dua.users (user_id, kind, full_name, email, admission_number, roles, institution_id, institution_name,
                         class_sections, account_created_at, last_sign_in_at, last_active_at,
                         deleted_at, deleted_at_min, deleted_at_max, deleted_by, deleted_by_name, deleted_by_roles,
                         source, source_detail, is_complete, field_sources, live_again_user_id, is_test_account)
  SELECT r.uid, 'legacy', r.full_name, r.email,
         CASE WHEN r.email LIKE '%@temp.local' THEN nullif(regexp_replace(split_part(r.email, '@', 1), '^[a-z]+', ''), '') END,
         coalesce((SELECT jsonb_agg(x || jsonb_build_object('institution_name',
                     (SELECT ci.name FROM c_inst ci WHERE ci.id = x->>'institution_id')))
                   FROM jsonb_array_elements(r.roles) x), '[]'::jsonb),
         CASE WHEN r.inst ~* uuid_re THEN r.inst::uuid END,
         inst.name,
         coalesce(r.classes, '[]'::jsonb), r.created_at, NULL, r.last_active,
         r.deleted_at,
         CASE WHEN r.deleted_at IS NULL THEN r.deleted_min END,
         CASE WHEN r.deleted_at IS NULL THEN least(live.created_at, inst.deleted_at) END,
         r.actor,
         (SELECT p.full_name FROM public.profiles p WHERE p.id = r.actor),
         (SELECT coalesce(jsonb_agg(DISTINCT ur.role), '[]'::jsonb) FROM public.user_roles ur WHERE ur.user_id = r.actor),
         'legacy',
         jsonb_build_object('evidence', r.evidence),
         NULL,
         jsonb_strip_nulls(jsonb_build_object(
           'full_name', r.name_src, 'email', r.email_src, 'institution', r.inst_src, 'roles', r.role_src,
           'account_created_at', r.created_src, 'deleted_at', r.deleted_src,
           'deleted_at_range', CASE WHEN r.deleted_at IS NULL THEN 'after the last trace; before the same email was created again, or the school was deleted' END,
           'deleted_by', r.actor_src,
           'admission_number', CASE WHEN r.email LIKE '%@temp.local' THEN 'admission-number sign-in email' END,
           'class_sections', CASE WHEN r.classes IS NOT NULL THEN 'class_assignment_deletions' END,
           'last_active_at', CASE WHEN r.last_active IS NOT NULL THEN 'auth log: last sign-in or token refresh (90 days)' END)),
         live.id,
         coalesce(r.email ~* '(^(test|demo|dummy)|\+test|@(example|test|mailinator)\.)', false)
           OR coalesce(r.full_name ~* '^(test|demo|dummy)\M', false)
  FROM c_row r
  LEFT JOIN c_inst inst ON inst.id = r.inst
  LEFT JOIN c_live live ON live.email = r.email;

  -- Files the person left in storage (never deleted with them).
  INSERT INTO dua.files (archive_id, source, raw_value, bucket, path, size_bytes, mime)
  SELECT DISTINCT ON (u.id, o.id) u.id,
         CASE WHEN o.owner = u.user_id OR o.owner_id = u.user_id::text THEN 'storage_owner' ELSE 'storage_path' END,
         o.bucket_id || '/' || o.name, o.bucket_id, o.name, nullif(o.metadata->>'size', '')::bigint, o.metadata->>'mimetype'
  FROM storage.objects o
  CROSS JOIN LATERAL (SELECT m[1] AS idtxt FROM regexp_matches(o.name, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'gi') m
                      UNION SELECT o.owner::text UNION SELECT o.owner_id) k
  JOIN dua.users u ON u.kind = 'legacy' AND u.user_id::text = lower(k.idtxt);

  SELECT jsonb_build_object(
    'entries', count(*),
    'with_name', count(*) FILTER (WHERE full_name IS NOT NULL),
    'with_email', count(*) FILTER (WHERE email IS NOT NULL),
    'with_school', count(*) FILTER (WHERE institution_name IS NOT NULL),
    'with_role', count(*) FILTER (WHERE jsonb_array_length(roles) > 0),
    'with_admission', count(*) FILTER (WHERE admission_number IS NOT NULL),
    'with_class', count(*) FILTER (WHERE jsonb_array_length(class_sections) > 0),
    'deleted_exact', count(*) FILTER (WHERE deleted_at IS NOT NULL),
    'deleted_range', count(*) FILTER (WHERE deleted_at IS NULL AND (deleted_at_min IS NOT NULL OR deleted_at_max IS NOT NULL)),
    'with_deleter', count(*) FILTER (WHERE deleted_by IS NOT NULL),
    'with_last_active', count(*) FILTER (WHERE last_active_at IS NOT NULL),
    'live_again', count(*) FILTER (WHERE live_again_user_id IS NOT NULL),
    'test_accounts', count(*) FILTER (WHERE is_test_account),
    'people_with_files', (SELECT count(DISTINCT f.archive_id) FROM dua.files f JOIN dua.users u2 ON u2.id = f.archive_id AND u2.kind = 'legacy'),
    'files', (SELECT count(*) FROM dua.files f JOIN dua.users u2 ON u2.id = f.archive_id AND u2.kind = 'legacy'))
  INTO v FROM dua.users WHERE kind = 'legacy';
  RETURN v;
END $$;

REVOKE EXECUTE ON FUNCTION dua.backfill_census() FROM PUBLIC, anon, authenticated;
