-- =====================================================================
-- FIX: "database \"postgres\" has a collation version mismatch"
-- =====================================================================
-- DO NOT run this blindly through the Management API /database/query
-- endpoint — see the "HOW TO RUN" notes at the bottom. REINDEX
-- CONCURRENTLY cannot execute inside a transaction block.
--
-- WHY THIS WARNING EXISTS (verified on prod 2026-08-10):
--   pg_database.datcollversion (recorded)  = 153.120
--   pg_database_collation_actual_version() = 153.121
--   collation "en_US.utf8": recorded 2.39 -> actual 2.40   (glibc bump)
--   ICU collations:         recorded 153.120 -> actual 153.121
--
-- The OS collation libraries (glibc 2.39 -> 2.40, ICU) were upgraded
-- underneath the database by Supabase platform maintenance. Postgres
-- records which collation version each index was built with; when the
-- library changes, string sort order MAY differ, which can silently
-- corrupt btree indexes on text/varchar columns (missed rows on index
-- scans, unique constraints failing to catch duplicates).
--
-- Postgres emits this WARNING once PER NEW CONNECTION, which is why it
-- accounts for ~11,760 of ~13,390 Postgres log lines in 24h. It is one
-- condition, not 11,760 separate problems.
--
-- CURRENT RISK ASSESSMENT (verified 2026-08-10, all checks CLEAN):
--   auth.refresh_tokens duplicate tokens ............ 0
--   auth.users duplicate emails ..................... 0
--   public.profiles duplicate emails ................ 0
--   storage.objects duplicate (bucket_id, name) ..... 0
--   syllabus_topics duplicate unique key ............ 0
--   homework_notifications_sent duplicate uniq key .. 0
--   => No evidence of actual corruption yet. The risk is LATENT.
--
-- BLAST RADIUS OF THE FIX (verified):
--   collatable indexes ....... 156  (32 MB total)
--   of which UNIQUE .......... 75
--   whole database ........... 497 MB
--   => A full reindex is small and fast. This is cheap insurance.

-- ---------------------------------------------------------------------
-- STEP 1 - Rebuild indexes under the NEW collation.
-- ---------------------------------------------------------------------
-- Option A (RECOMMENDED for a live system): non-blocking.
-- CONCURRENTLY avoids ACCESS EXCLUSIVE locks so students mid-exam are
-- unaffected. Slower wall-clock, but no downtime. System catalogs are
-- skipped automatically with a NOTICE - that is expected and fine.

REINDEX DATABASE CONCURRENTLY postgres;

-- Option B (only if Option A is unavailable): blocking, but fast.
-- With just 32 MB of collatable indexes this typically completes in
-- well under a minute, locking one table at a time. Run in a low-traffic
-- window (late night IST) if you use this.
--
--   REINDEX DATABASE postgres;

-- ---------------------------------------------------------------------
-- STEP 2 - Tell Postgres the recorded version is now current.
-- ---------------------------------------------------------------------
-- ONLY run this AFTER Step 1 succeeds. Running it alone would silence
-- the warning while leaving any latent index corruption in place - that
-- is the one genuinely wrong way to "fix" this.

ALTER DATABASE postgres  REFRESH COLLATION VERSION;
ALTER DATABASE template1 REFRESH COLLATION VERSION;

-- ---------------------------------------------------------------------
-- STEP 3 - Verify the warning is gone.
-- ---------------------------------------------------------------------
-- Expect mismatch = false for every row.
--
--   SELECT datname,
--          datcollversion                              AS recorded,
--          pg_database_collation_actual_version(oid)   AS actual,
--          (datcollversion IS DISTINCT FROM
--           pg_database_collation_actual_version(oid)) AS mismatch
--   FROM pg_database WHERE datallowconn;
--
-- Then confirm new Postgres log lines stop carrying the warning, and the
-- project's Success Rate climbs from ~76% toward ~99%.

-- =====================================================================
-- HOW TO RUN
-- =====================================================================
-- REINDEX ... CONCURRENTLY cannot run inside a transaction block, and
-- both the Management API query endpoint and the Dashboard SQL Editor
-- may wrap statements in one. If you get:
--     ERROR: REINDEX CONCURRENTLY cannot run inside a transaction block
-- then run Step 1 over a direct session-mode connection instead:
--
--   psql "postgresql://postgres:[PASSWORD]@db.gyymkgohcijeksmrzuyw.supabase.co:5432/postgres" \
--        -c "REINDEX DATABASE CONCURRENTLY postgres;"
--
-- (Port 5432 = session mode. Do NOT use the 6543 transaction pooler for
-- this.) Steps 2 and 3 are ordinary statements and run fine anywhere.
--
-- If a CONCURRENTLY reindex is interrupted it can leave an INVALID index
-- behind. Find and clean up any with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
--   -- then: DROP INDEX CONCURRENTLY <name>;  (the _ccnew leftovers)
