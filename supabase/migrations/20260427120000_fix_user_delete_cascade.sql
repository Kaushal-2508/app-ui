-- =============================================================
-- Fix user-delete cascade chain
-- -------------------------------------------------------------
-- Teacher deletion failed at institutions with accumulated data
-- (Alliance International School) because
-- `auth.admin.deleteUser()` → `profiles ON DELETE CASCADE` → and
-- then any FK from another table to `profiles(id)` without an
-- explicit ON DELETE rule defaults to NO ACTION and blocks the
-- whole chain.
--
-- A partial cleanup shipped in 20260116054505 for ~20 columns,
-- but 40+ other FKs still defaulted to NO ACTION (teacher_
-- aggregates, student_remarks, conversations, ptm_*, circulars,
-- appointments, communication_templates, exam_templates, etc.).
-- Some columns were also declared `ON DELETE SET NULL NOT NULL`
-- which is a self-contradiction: the cascade tries to set NULL
-- on a NOT NULL column and raises a NOT NULL violation instead.
--
-- This migration sweeps `pg_constraint` and rewrites every FK
-- pointing at `profiles(id)` that still has action 'a' (NO
-- ACTION) or 'r' (RESTRICT). Rules:
--
--   OWNERSHIP columns  → ON DELETE CASCADE
--     user_id, student_id, teacher_id, parent_id, assignee_id,
--     participant_id
--
--   AUDIT / ACTOR columns → ON DELETE SET NULL
--     everything else (created_by, published_by, reviewed_by,
--     actor_id, sender_id, uploaded_by, enrolled_by, run_by,
--     marked_by, approved_by, etc.)
--
-- The sweep also drops NOT NULL on any audit column whose FK is
-- being rewritten to SET NULL, because Postgres will otherwise
-- refuse the ALTER and the next teacher delete will still fail
-- with a NOT NULL violation at cascade time.
-- =============================================================

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
      con.oid           AS constraint_oid,
      con.conname       AS constraint_name,
      cl.relname        AS table_name,
      ns.nspname        AS schema_name,
      att.attname       AS column_name,
      att.attnotnull    AS is_not_null,
      con.confdeltype   AS delete_action
    FROM pg_constraint con
    JOIN pg_class     cl  ON cl.oid  = con.conrelid
    JOIN pg_namespace ns  ON ns.oid  = cl.relnamespace
    JOIN pg_class     rcl ON rcl.oid = con.confrelid
    JOIN pg_namespace rns ON rns.oid = rcl.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid
                         AND att.attnum    = con.conkey[1]
    WHERE con.contype = 'f'
      AND rns.nspname = 'public'
      AND rcl.relname = 'profiles'
      AND cardinality(con.conkey) = 1
      -- Referenced column must be profiles.id (pkey, single col)
      AND con.confkey[1] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = rcl.oid AND attname = 'id'
      )
      -- Only rewrite FKs still on NO ACTION ('a') or RESTRICT ('r')
      AND con.confdeltype IN ('a', 'r')
      AND ns.nspname = 'public'
  LOOP
    IF r.column_name = ANY(cascade_cols) THEN
      new_action := 'CASCADE';
    ELSE
      new_action := 'SET NULL';

      -- SET NULL needs the column to be nullable.
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
         FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE %s',
      r.schema_name, r.table_name, r.constraint_name,
      r.column_name, new_action
    );

    RAISE NOTICE 'Rewrote % on %.%.% → ON DELETE %',
      r.constraint_name, r.schema_name, r.table_name, r.column_name, new_action;
  END LOOP;
END $$;

-- -------------------------------------------------------------
-- A second pass handles constraints that were DECLARED as
-- `ON DELETE SET NULL` at table-creation time but whose column
-- is still NOT NULL (e.g. task_assignments.assigner_id,
-- materials.uploaded_by, exam_publication_logs.actor_id). The
-- FK action here is already 'n', so the first loop skipped it —
-- but at cascade time Postgres still raises a NOT NULL
-- violation. Drop NOT NULL on every audit column whose FK points
-- at profiles(id) and whose action is SET NULL.
--
-- For the handful of ownership columns that were declared
-- `SET NULL NOT NULL` (task_assignments.assignee_id), the intent
-- is ownership, so rewrite to CASCADE.
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
      att.attname       AS column_name,
      att.attnotnull    AS is_not_null,
      con.confdeltype   AS delete_action
    FROM pg_constraint con
    JOIN pg_class     cl  ON cl.oid  = con.conrelid
    JOIN pg_namespace ns  ON ns.oid  = cl.relnamespace
    JOIN pg_class     rcl ON rcl.oid = con.confrelid
    JOIN pg_namespace rns ON rns.oid = rcl.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid
                         AND att.attnum    = con.conkey[1]
    WHERE con.contype = 'f'
      AND rns.nspname = 'public'
      AND rcl.relname = 'profiles'
      AND cardinality(con.conkey) = 1
      AND con.confkey[1] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = rcl.oid AND attname = 'id'
      )
      AND con.confdeltype = 'n'   -- SET NULL
      AND att.attnotnull  = true
      AND ns.nspname = 'public'
  LOOP
    IF r.column_name = ANY(cascade_cols) THEN
      -- Upgrade to CASCADE — ownership semantics, NOT NULL stays.
      EXECUTE format(
        'ALTER TABLE %I.%I DROP CONSTRAINT %I',
        r.schema_name, r.table_name, r.constraint_name
      );
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I
           FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE CASCADE',
        r.schema_name, r.table_name, r.constraint_name, r.column_name
      );
      RAISE NOTICE 'Upgraded % on %.%.% → ON DELETE CASCADE (was SET NULL NOT NULL)',
        r.constraint_name, r.schema_name, r.table_name, r.column_name;
    ELSE
      EXECUTE format(
        'ALTER TABLE %I.%I ALTER COLUMN %I DROP NOT NULL',
        r.schema_name, r.table_name, r.column_name
      );
      RAISE NOTICE 'Dropped NOT NULL on %.%.% (FK already SET NULL)',
        r.schema_name, r.table_name, r.column_name;
    END IF;
  END LOOP;
END $$;
