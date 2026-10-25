-- =============================================================
-- Server-side activity capture: one generic row-audit trigger
-- -------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-09-11-activity-logs-design.md, "NEEDS DB:
-- capture every action", step 1-3. Written by Tushar; Naman writes no SQL.
--
-- WHY. Until now every row on the Activity Logs page was written by the
-- BROWSER, through log_audit_event. Three problems with that, all of which
-- this migration removes:
--   1. It only records what a developer remembered to instrument. Whole
--      modules left no trace.
--   2. It cannot tell a real delete from one the database refused: a PostgREST
--      DELETE blocked by RLS returns empty data and no error (CLAUDE.md 6), so
--      the client logged "deleted" for rows that are still there.
--   3. log_audit_event is SECURITY DEFINER granted to `authenticated`, so any
--      signed-in user can write an audit row with any action, any entity, any
--      values, aimed at any school via metadata.institution_id. actor_id is
--      stamped from auth.uid() so WHO cannot be forged, but WHAT can.
-- A trigger sees the committed row and nothing else, so it cannot be skipped,
-- cannot be lied to, and cannot record a write that did not happen.
--
-- The REVOKE that closes problem 3 is deliberately NOT in this migration: the
-- shipped frontend still calls log_audit_event, and pulling the grant first
-- would silently drop those writes. Order is: this migration, then the
-- frontend stops logging, then the revoke. Until the frontend lands, a delete
-- on a covered table is recorded TWICE (once by the browser, once here). That
-- is the intended direction of the overlap: a duplicate is recoverable, a gap
-- in an audit trail is not.
--
-- Prod: applied 2026-09-14 via scripts/run-sql.ps1. The ledger is not
-- maintained (CLAUDE.md 26); verify with the block at the end.
-- =============================================================

-- 1. The trigger function -----------------------------------------------------
--
-- AFTER ... FOR EACH ROW on every covered table. Arguments:
--   TG_ARGV[0]  human entity label ("Wing", "Fee category"); drives both
--               `entity_type` and the `<label>_created|updated|deleted` action.
--   TG_ARGV[1]  the row's name column, or '' to let the function guess.
--
-- Institution resolution, in order: the row's own institution_id; then a known
-- lookup for the two wing join tables; then the ACTOR's institution. That last
-- fallback is what makes rows on institution-less tables readable by the school
-- admin who caused them, since system_audit_logs RLS keys on
-- metadata->>'institution_id'. employee_levels is global and stays NULL, so
-- only super admins see it, which matches who can edit it.
--
-- NOTHING here may break the write it audits. The whole body is wrapped so a
-- failure downgrades to a WARNING and the original INSERT/UPDATE/DELETE still
-- commits. An audit trigger that can abort a delete is worse than no trigger.
CREATE OR REPLACE FUNCTION public.tg_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old     jsonb;
  v_new     jsonb;
  v_row     jsonb;
  v_label   text := COALESCE(NULLIF(TG_ARGV[0], ''), TG_TABLE_NAME);
  v_namecol text := COALESCE(TG_ARGV[1], '');
  v_id      uuid;
  v_name    text;
  v_inst    uuid;
  v_actor   uuid := (SELECT auth.uid());
  v_verb    text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_row := v_new;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_row := v_new;
  ELSE
    v_old := to_jsonb(OLD);
    v_row := v_old;
  END IF;

  -- Never copy a credential into an audit row, whatever table this is attached
  -- to later. Cheap, and it cannot be forgotten at attach time.
  v_old := v_old - 'password' - 'encrypted_password' - 'token' - 'secret'
                 - 'api_key' - 'access_token' - 'refresh_token';
  v_new := v_new - 'password' - 'encrypted_password' - 'token' - 'secret'
                 - 'api_key' - 'access_token' - 'refresh_token';

  BEGIN
    v_id := NULLIF(v_row ->> 'id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_id := NULL;
  END;

  v_name := NULLIF(v_row ->> v_namecol, '');
  IF v_name IS NULL THEN
    v_name := COALESCE(
      NULLIF(v_row ->> 'name', ''),
      NULLIF(v_row ->> 'title', ''),
      NULLIF(v_row ->> 'level_name', ''),
      NULLIF(v_row ->> 'label', '')
    );
  END IF;

  BEGIN
    v_inst := NULLIF(v_row ->> 'institution_id', '')::uuid;
  EXCEPTION WHEN others THEN
    v_inst := NULL;
  END;

  IF v_inst IS NULL THEN
    IF TG_TABLE_NAME IN ('wing_assignments', 'wing_class_mappings') THEN
      -- These join tables carry no name of their own, so without this the page
      -- would show "Wing coordinator created" with nothing to say WHICH wing.
      -- The person is still identifiable from user_id in new_values/old_values.
      SELECT w.institution_id, COALESCE(v_name, w.name)
        INTO v_inst, v_name
        FROM public.wings w
       WHERE w.id = NULLIF(v_row ->> 'wing_id', '')::uuid;
    ELSIF TG_TABLE_NAME <> 'employee_levels' THEN
      v_inst := public.get_user_institution(v_actor);
    END IF;
  END IF;

  v_verb := CASE TG_OP
              WHEN 'INSERT' THEN 'created'
              WHEN 'UPDATE' THEN 'updated'
              ELSE 'deleted'
            END;

  INSERT INTO public.system_audit_logs (
    actor_id, action, entity_type, entity_id, entity_name,
    old_values, new_values, metadata
  ) VALUES (
    v_actor,
    lower(regexp_replace(v_label, '[^a-zA-Z0-9]+', '_', 'g')) || '_' || v_verb,
    v_label,
    v_id,
    v_name,
    v_old,
    v_new,
    jsonb_build_object(
      'institution_id', v_inst,
      'source',         'trigger',
      'table',          TG_TABLE_NAME
    )
    -- A NULL actor means a cron job, an edge function on the service role, or
    -- a cascade. Mark it so the page can say "system" honestly instead of
    -- rendering an unreadable profile as one.
    || CASE WHEN v_actor IS NULL
            THEN jsonb_build_object('via', 'system')
            ELSE '{}'::jsonb END
  );

  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING 'tg_audit_row failed on %.% (%): %',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.tg_audit_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_audit_row() FROM anon;

-- 2. Attach ------------------------------------------------------------------
--
-- INSERT + DELETE on tables where both ends are a user-level event.
-- DELETE ONLY on the two bulk-import tables: question_bank holds 100,281 rows
-- and syllabus_topics 4,516, both loaded by XLSX imports that would otherwise
-- write one audit row per imported question. Deletions there are always a
-- person's decision, so they stay covered.
-- tasks is DELETE ONLY as well: log_task_created already writes task_audit_logs
-- on insert, and the Activity page federates that table, so an INSERT trigger
-- here would print every new task twice.

DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- table,                          label,                  name col,   ops
      ('wings',                          'Wing',                 'name',     'ID'),
      ('wing_assignments',               'Wing coordinator',     '',         'ID'),
      ('wing_class_mappings',            'Wing class',           '',         'ID'),
      ('classes',                        'Class section',        'name',     'ID'),
      ('class_groups',                   'Class',                'name',     'ID'),
      ('universal_subjects',             'Subject',              'name',     'ID'),
      ('subject_class_group_mappings',   'Subject mapping',      '',         'ID'),
      ('syllabus_topics',                'Chapter',              'name',     'D'),
      ('question_bank',                  'Question',             '',         'D'),
      ('exams',                          'Exam',                 'title',    'ID'),
      ('exam_templates',                 'Exam template',        'name',     'ID'),
      ('homework_assignments',           'Homework',             'title',    'ID'),
      ('tasks',                          'Task',                 'title',    'D'),
      ('notices',                        'Notice',               'title',    'ID'),
      ('diary_entries',                  'Diary entry',          'title',    'ID'),
      ('study_materials',                'Study material',       'title',    'ID'),
      ('fee_categories',                 'Fee category',         'name',     'ID'),
      ('fee_structures',                 'Fee structure',        '',         'ID'),
      ('holiday_calendar',               'Holiday',              'name',     'ID'),
      ('employee_levels',                'Employee level',       'level_name','ID'),
      ('optional_groups',                'Optional group',       'name',     'ID'),
      ('tt_resources',                   'Shared resource',      'name',     'ID'),
      ('tt_substitutions',               'Substitution',         '',         'ID'),
      ('user_roles',                     'Role',                 '',         'ID')
    ) AS v(tbl, label, namecol, ops)
  LOOP
    -- Idempotent: re-running this migration replaces the triggers cleanly.
    EXECUTE format('DROP TRIGGER IF EXISTS zzz_audit_ins ON public.%I', r.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS zzz_audit_del ON public.%I', r.tbl);

    IF position('I' in r.ops) > 0 THEN
      EXECUTE format(
        'CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row(%L, %L)',
        r.tbl, r.label, r.namecol);
    END IF;

    IF position('D' in r.ops) > 0 THEN
      EXECUTE format(
        'CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.%I
           FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row(%L, %L)',
        r.tbl, r.label, r.namecol);
    END IF;
  END LOOP;
END
$do$;

-- 3. Indexes for the page's query shapes (spec step 3) ------------------------
-- The RLS predicate on system_audit_logs parses metadata->>'institution_id'
-- per row, and the feed then orders by created_at DESC. One expression index
-- serves both. The person filter gets its own composite; the existing
-- idx_audit_logs_actor is actor_id alone and cannot satisfy the ORDER BY.
CREATE INDEX IF NOT EXISTS system_audit_logs_institution_created_idx
  ON public.system_audit_logs ((metadata ->> 'institution_id'), created_at DESC);

CREATE INDEX IF NOT EXISTS system_audit_logs_actor_created_idx
  ON public.system_audit_logs (actor_id, created_at DESC);

-- Verify after applying:
--   SELECT proname, prosecdef, proacl::text FROM pg_proc WHERE proname = 'tg_audit_row';
--   SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE t.tgname LIKE 'zzz_audit_%' ORDER BY 1, 2;   -- 24 tables, 45 triggers (21 tables INSERT+DELETE, 3 DELETE-only)
--   SELECT indexname FROM pg_indexes WHERE schemaname='public'
--     AND indexname IN ('system_audit_logs_institution_created_idx',
--                       'system_audit_logs_actor_created_idx');
-- Functional (inside a transaction that is rolled back): insert and delete a
-- fee category as a real school admin and confirm two system_audit_logs rows
-- appear with metadata->>'source' = 'trigger' and the right institution_id.
--
-- NEXT, in order, once the frontend stops writing audit rows:
--   REVOKE ALL ON FUNCTION public.log_audit_event(text, text, uuid, text, jsonb, jsonb, jsonb) FROM authenticated;
-- SECURITY DEFINER callers (the 7 SQL RPCs) and the service-role edge functions
-- are unaffected by that revoke; only the browser loses the write.
