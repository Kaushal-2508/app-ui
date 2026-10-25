-- =============================================================
-- Fix user-delete cascade chain, part 2: FKs that point at auth.users
-- -------------------------------------------------------------
-- 2026-09-11: deleting a teacher (Natasha Kaur, Alliance) failed five
-- times in a row with
--
--   update or delete on table "users" violates foreign key constraint
--   "school_custom_topics_created_by_fkey" on table "school_custom_topics"
--
-- GoTrue surfaces that as "Database error deleting user" and the whole
-- delete aborts. The 20260427120000 sweep rewrote every FK that
-- references public.profiles(id) but never looked at FKs that reference
-- auth.users(id) DIRECTLY. Eleven of those still default to NO ACTION
-- (verified in pg_constraint on 2026-09-11):
--
--   ai_config_changes.changed_by       NOT NULL
--   ai_daily_usage.user_id             NOT NULL
--   ai_usage_logs.user_id              NOT NULL
--   attendance_records.marked_by
--   global_ai_config.updated_by
--   institution_features.enabled_by
--   payment_receipts.generated_by
--   school_custom_topics.created_by    <- the one that bit today
--   subjects.created_by
--   syllabus_topics.created_by
--   universal_subjects.created_by
--
-- So any teacher who has ever authored a custom topic, marked
-- attendance, created a subject, etc. cannot be deleted at all.
--
-- Same rules as 20260427120000 (CLAUDE.md §21):
--   OWNERSHIP columns  -> ON DELETE CASCADE
--     user_id, student_id, teacher_id, parent_id, assignee_id,
--     participant_id
--   AUDIT / ACTOR columns -> ON DELETE SET NULL (+ DROP NOT NULL)
--     created_by, updated_by, enabled_by, generated_by, changed_by,
--     marked_by, ... the row survives, the author becomes unknown.
--
-- Deliberately NOT touched: support_settings.owner_id -> profiles(id)
-- ON DELETE RESTRICT. That is a singleton config row; refusing to
-- delete the support owner until someone reassigns it is the intent.
--
-- Prod: apply through scripts/run-sql.ps1 (§26), then verify with
-- pg_constraint, never the migration ledger.
-- =============================================================

-- -------------------------------------------------------------
-- Pass 1: every single-column FK from public.* to auth.users(id)
-- that is still NO ACTION ('a') or RESTRICT ('r').
-- -------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  cascade_cols TEXT[] := ARRAY[
    'user_id',
    'student_id',
    'teacher_id',
    'parent_id',
    'assignee_id',
    'participant_id'
  ];
  new_action TEXT;
BEGIN
  FOR r IN
    SELECT
      con.conname       AS constraint_name,
      cl.relname        AS table_name,
      ns.nspname        AS schema_name,
      att.attname       AS column_name,
      att.attnotnull    AS is_not_null
    FROM pg_constraint con
    JOIN pg_class     cl  ON cl.oid  = con.conrelid
    JOIN pg_namespace ns  ON ns.oid  = cl.relnamespace
    JOIN pg_class     rcl ON rcl.oid = con.confrelid
    JOIN pg_namespace rns ON rns.oid = rcl.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid
                         AND att.attnum    = con.conkey[1]
    WHERE con.contype = 'f'
      AND rns.nspname = 'auth'
      AND rcl.relname = 'users'
      AND cardinality(con.conkey) = 1
      AND con.confkey[1] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = rcl.oid AND attname = 'id'
      )
      AND con.confdeltype IN ('a', 'r')
      AND ns.nspname = 'public'
  LOOP
    IF r.column_name = ANY(cascade_cols) THEN
      new_action := 'CASCADE';
    ELSE
      new_action := 'SET NULL';

      -- SET NULL needs the column to be nullable, otherwise the cascade
      -- raises a NOT NULL violation and the delete still aborts.
      IF r.is_not_null THEN
        EXECUTE format(
          'ALTER TABLE %I.%I ALTER COLUMN %I DROP NOT NULL',
          r.schema_name, r.table_name, r.column_name
        );
        RAISE NOTICE 'Dropped NOT NULL on %.%.%',
          r.schema_name, r.table_name, r.column_name;
      END IF;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      r.schema_name, r.table_name, r.constraint_name
    );

    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I
         FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE %s',
      r.schema_name, r.table_name, r.constraint_name,
      r.column_name, new_action
    );

    RAISE NOTICE 'Rewrote % on %.%.% -> ON DELETE %',
      r.constraint_name, r.schema_name, r.table_name, r.column_name, new_action;
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Pass 2: FKs to auth.users(id) already declared ON DELETE SET NULL
-- but on a NOT NULL column (the self-contradiction 20260427120000
-- found on profiles-targeted FKs). Audit columns lose NOT NULL;
-- ownership columns are rewritten to CASCADE.
-- -------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  cascade_cols TEXT[] := ARRAY[
    'user_id',
    'student_id',
    'teacher_id',
    'parent_id',
    'assignee_id',
    'participant_id'
  ];
BEGIN
  FOR r IN
    SELECT
      con.conname       AS constraint_name,
      cl.relname        AS table_name,
      ns.nspname        AS schema_name,
      att.attname       AS column_name
    FROM pg_constraint con
    JOIN pg_class     cl  ON cl.oid  = con.conrelid
    JOIN pg_namespace ns  ON ns.oid  = cl.relnamespace
    JOIN pg_class     rcl ON rcl.oid = con.confrelid
    JOIN pg_namespace rns ON rns.oid = rcl.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid
                         AND att.attnum    = con.conkey[1]
    WHERE con.contype = 'f'
      AND rns.nspname = 'auth'
      AND rcl.relname = 'users'
      AND cardinality(con.conkey) = 1
      AND con.confkey[1] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = rcl.oid AND attname = 'id'
      )
      AND con.confdeltype = 'n'
      AND att.attnotnull
      AND ns.nspname = 'public'
  LOOP
    IF r.column_name = ANY(cascade_cols) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        r.schema_name, r.table_name, r.constraint_name
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I
           FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE CASCADE',
        r.schema_name, r.table_name, r.constraint_name, r.column_name
      );
      RAISE NOTICE 'Rewrote SET NULL NOT NULL ownership FK % on %.%.% -> CASCADE',
        r.constraint_name, r.schema_name, r.table_name, r.column_name;
    ELSE
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I DROP NOT NULL',
        r.schema_name, r.table_name, r.column_name
      );
      RAISE NOTICE 'Dropped NOT NULL on SET NULL audit column %.%.%',
        r.schema_name, r.table_name, r.column_name;
    END IF;
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- Indexes: the SET NULL / CASCADE actions look the child rows up by
-- these columns on every user delete (§23: every FK column indexed).
-- attendance_records.marked_by and ai_usage_logs.user_id already have
-- one; global_ai_config is a singleton and subjects has six rows.
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_school_custom_topics_created_by
  ON public.school_custom_topics (created_by);
CREATE INDEX IF NOT EXISTS idx_syllabus_topics_created_by
  ON public.syllabus_topics (created_by);
CREATE INDEX IF NOT EXISTS idx_universal_subjects_created_by
  ON public.universal_subjects (created_by);
CREATE INDEX IF NOT EXISTS idx_institution_features_enabled_by
  ON public.institution_features (enabled_by);
CREATE INDEX IF NOT EXISTS idx_ai_daily_usage_user_id
  ON public.ai_daily_usage (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_config_changes_changed_by
  ON public.ai_config_changes (changed_by);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_generated_by
  ON public.payment_receipts (generated_by);
