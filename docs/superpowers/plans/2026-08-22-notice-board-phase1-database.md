# Notice Board Implementation Plan — Phase 1: Database

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `circulars` schema with a hierarchy-scoped `notices` schema whose RLS actually enforces scope, whose recipients are materialised at publish time, and whose reach is aggregated server-side.

**Architecture:** Six sequential SQL migrations applied through the Supabase Management API. Each migration ships with an assertion script that must fail before it and pass after it. Recipients are expanded once by a shared set-returning helper that both `publish_notice` and `notice_audience_preview` call, so the composer's preview can never disagree with what publishing does.

**Tech Stack:** PostgreSQL 15 (Supabase, project ref `gyymkgohcijeksmrzuyw`), PL/pgSQL, Supabase Storage, PowerShell 5.1 (`scripts/run-sql.ps1`).

**Spec:** [docs/superpowers/specs/2026-08-22-notice-board-design.md](../specs/2026-08-22-notice-board-design.md)

## Global Constraints

- **This repo has no test runner.** No vitest, no jest, no `*.test.*` files, no `test` script in `package.json`. The verification cycle for database work is an **assertion SQL script** that returns a single row of `ok_*` booleans; "test fails" means the script errors or returns any `false`. Do not scaffold a test framework — that is out of scope.
- **Never run `supabase db push`.** `supabase_migrations.schema_migrations` is not maintained on this project. Apply every migration through `powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile <file> -OutFile <json>` and verify against `pg_proc` / `information_schema`.
- Migration files still get written to `supabase/migrations/` for the repo record, using the timestamp naming already in use (`YYYYMMDDHHMMSS_description.sql`).
- **Every new `SECURITY DEFINER` function gets `REVOKE EXECUTE ... FROM anon` BY NAME.** `REVOKE FROM PUBLIC` does not strip Supabase's default `anon` grant. Verify against `information_schema.routine_privileges` before the task is done.
- **Every RLS policy wraps `auth.uid()` as `(SELECT auth.uid())`** so Postgres evaluates it once per statement rather than once per row (§23.13).
- **Every RLS policy calls a `SECURITY DEFINER` helper.** No inline cross-table `EXISTS` — that caused the 2026-04-26 recursion incident.
- **Every new FK gets an index in the same migration** (§23).
- **All timestamp comparisons that mean "today" or a wall clock use `(now() AT TIME ZONE i.timezone)`** against `institutions.timezone` (§24). This phase compares absolute `timestamptz` values only, so the rule is satisfied by not introducing any wall-clock comparison.
- Domains, fixed: `scope ∈ (institution, wing, class)`, `priority ∈ (normal, important, urgent)`, `type ∈ (general, academic, event, ptm)`, `recipient_role ∈ (coordinator, teacher, student)`, `added_reason ∈ (audience_role, class_student, class_teacher, wing_coordinator_auto, wing_member)`.
- Production baseline this plan assumes, verified 2026-08-22: **9 rows** in `circulars` (scope `institution` 4, `class` 3, `all` 2; priority `normal` 5, `urgent` 3, `high` 1; type `general` 5 + `academic`/`announcement`/`event`/`notice` 1 each), **3 rows** in `circular_acknowledgements`, **12 rows** in `institution_features` with `feature_id='circulars'`, **1 object** in the `circular-attachments` bucket, **45 institutions**, **32 wings**, **34 wing_assignments**, **398 wing_class_mappings**, `class_assignments` role counts student 2258 / teacher 1088 / coordinator 12.
- `attachment_urls` has a **dual shape**: `array` on one row, `{}` object on two seed rows. Guard every read with `jsonb_typeof(attachment_urls) = 'array'`.
- **`target_class_id` and `target_wing_id` are NULL on all 9 rows**, including the 3 with `scope='class'`. There is no legacy targeting data to preserve — those 3 rows are broken records that the old RLS showed to their whole institution anyway. Task 1 folds them into `institution` scope so the migration preserves what users actually see today.
- **2 of the 3 legacy acknowledgements were made by the notice's own author.** An author is never their own recipient, so those 2 are dropped rather than reintroduced; 1 acknowledgement survives. The invariant is worth more than 2 self-acks on test data.
- **All 9 legacy notices belong to three test schools** — Salci National School (1), Vanshika Testing School (2), Product Testing School (6). Alliance, the largest real institution, has none. Total backfill fan-out is ~648 rows.
- Write `p.is_active IS NOT FALSE`, never bare `p.is_active` — a NULL would silently drop that person from every audience.
- Existing helpers to reuse, never re-implement: `get_user_institution(uuid)`, `has_role(uuid, app_role)` (note: `has_role(x,'school_admin')` already returns true for `super_school_admin`), `is_institution_admin(uuid, uuid)`, `is_coordinator_for_class(uuid, uuid)`, `is_teacher_for_class(uuid, uuid)`.
- Working directory for every command is the repo root, `d:\Salci Projects\Salci-Main-Portal\salci-eco-core-main`. Branch is `feat/notice-board`.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260822100000_notices_rename_and_columns.sql` | Rename `circulars`→`notices`, rename its constraints/indexes/trigger, normalise legacy values, add new columns + CHECKs |
| `supabase/migrations/20260822100100_notice_targets_and_recipients.sql` | Create `notice_target_classes`, `notice_target_wings`, `notice_recipients`; backfill from legacy scope; drop legacy columns and `circular_acknowledgements` |
| `supabase/migrations/20260822100200_notice_helpers_and_rls.sql` | The four `SECURITY DEFINER` helpers + `notice_id_from_path`; drop `circ_*` policies; create the new policy set |
| `supabase/migrations/20260822100300_notice_expand_and_publish.sql` | `notice_expand_audience` set-returning helper, `publish_notice`, `notice_audience_preview` |
| `supabase/migrations/20260822100400_notice_read_and_reporting.sql` | `mark_notice_read`, `notice_reach`, `notice_recipient_list`, `notice_inbox`, `notice_outbox` |
| `supabase/migrations/20260822100500_notice_storage_and_flag.sql` | Private `notice-attachments` bucket + 3 policies, `attachments` backfill, `institution_features` flag rename |
| `scripts/notice-board/verify-01-rename.sql` … `verify-06-storage-flag.sql` | One assertion script per migration; each returns a single row of `ok_*` booleans |
| `scripts/notice-board/apply.ps1` | Thin wrapper: applies one migration then its verify script, and prints both results |

Migrations are split one-per-concern rather than bundled because each has a distinct failure mode and a distinct assertion, and because a reviewer could reasonably reject the RLS design while approving the rename.

---

### Task 1: Rename `circulars` → `notices`, normalise legacy values, add columns

**Files:**
- Create: `supabase/migrations/20260822100000_notices_rename_and_columns.sql`
- Create: `scripts/notice-board/verify-01-rename.sql`
- Create: `scripts/notice-board/apply.ps1`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.notices` with columns `id uuid, institution_id uuid, title text, content text, type text, scope text, target_class_id uuid, target_wing_id uuid, priority text, attachment_urls jsonb, published_by uuid, published_at timestamptz, expires_at timestamptz, created_at timestamptz, updated_at timestamptz, audience_roles text[], requires_acknowledgement boolean, recipient_count integer, attachments jsonb`. FK constraint names `notices_institution_id_fkey`, `notices_published_by_fkey` (PostgREST embed syntax depends on these). `target_class_id`, `target_wing_id`, `attachment_urls` still exist and are dropped in Task 2 / Task 6.

- [ ] **Step 1: Write the assertion script**

Create `scripts/notice-board/verify-01-rename.sql`:

```sql
SELECT
  (to_regclass('public.notices') IS NOT NULL)                                     AS ok_table_renamed,
  (to_regclass('public.circulars') IS NULL)                                       AS ok_old_gone,
  (SELECT count(*) FROM public.notices) = 9                                       AS ok_rows_preserved,
  (SELECT count(*) FROM public.notices
     WHERE scope NOT IN ('institution','wing','class')) = 0                       AS ok_scope_normalised,
  (SELECT count(*) FROM public.notices
     WHERE priority NOT IN ('normal','important','urgent')) = 0                   AS ok_priority_normalised,
  (SELECT count(*) FROM public.notices WHERE priority = 'important') = 1          AS ok_high_became_important,
  (SELECT count(*) FROM public.notices
     WHERE type NOT IN ('general','academic','event','ptm')) = 0                  AS ok_type_normalised,
  -- 4 already institution + 2 legacy 'all' + 3 targetless 'class' = 9
  (SELECT count(*) FROM public.notices WHERE scope = 'institution') = 9           AS ok_all_became_institution,
  (SELECT count(*) FROM public.notices WHERE scope = 'class') = 0                 AS ok_no_targetless_class,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='notices'
       AND column_name IN ('audience_roles','requires_acknowledgement',
                           'recipient_count','attachments')) = 4                  AS ok_new_columns,
  EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'notices_published_by_fkey')                          AS ok_fk_renamed,
  EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'notices_scope_check')                                AS ok_scope_check,
  EXISTS (SELECT 1 FROM pg_trigger
            WHERE tgname = 'update_notices_ts')                                   AS ok_trigger_renamed;
```

`ok_all_became_institution` expects 9: 4 rows are already `institution`, the 2 legacy `all` rows join them, and so do the 3 `class` rows whose `target_class_id` is NULL (see Global Constraints — there is no targeting data on any legacy row, and the old RLS showed them institution-wide regardless).

- [ ] **Step 2: Write the apply wrapper**

Create `scripts/notice-board/apply.ps1`:

```powershell
param(
  [Parameter(Mandatory = $true)][string]$Migration,
  [Parameter(Mandatory = $true)][string]$Verify
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Output "=== APPLY $Migration ==="
& "$root\scripts\run-sql.ps1" -SqlFile $Migration -OutFile "$env:TEMP\nb_apply.json"
Get-Content "$env:TEMP\nb_apply.json" -Raw

Write-Output "=== VERIFY $Verify ==="
& "$root\scripts\run-sql.ps1" -SqlFile $Verify -OutFile "$env:TEMP\nb_verify.json"
$raw = Get-Content "$env:TEMP\nb_verify.json" -Raw
Write-Output $raw
if ($raw -match '"ok_[a-z_]+":false') {
  throw "VERIFY FAILED - at least one assertion returned false"
}
Write-Output "ALL ASSERTIONS PASSED"
```

- [ ] **Step 3: Run the assertion script to verify it fails**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-01-rename.sql -OutFile "$TEMP/v01.json"
```
Expected: `HTTP ERROR 400` — `relation "public.notices" does not exist`. That error IS the failing test.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260822100000_notices_rename_and_columns.sql`:

```sql
-- Notice Board phase 1: rename circulars -> notices, normalise legacy values,
-- add the columns the new targeting + read-receipt model needs.
--
-- The circ_* RLS policies are deliberately NOT dropped here. Policy names are
-- independent of the table name, so they keep working after the rename; the
-- replacement set lands in 20260822100200. Dropping them now would leave the
-- table RLS-enabled with zero policies, which reads as "nobody can see
-- anything" for the window between the two migrations.
BEGIN;

ALTER TABLE public.circulars RENAME TO notices;

-- PostgREST embed syntax names FK constraints, so rename them explicitly
-- rather than leaving circulars_* names on a notices table.
ALTER TABLE public.notices RENAME CONSTRAINT circulars_pkey                 TO notices_pkey;
ALTER TABLE public.notices RENAME CONSTRAINT circulars_institution_id_fkey  TO notices_institution_id_fkey;
ALTER TABLE public.notices RENAME CONSTRAINT circulars_published_by_fkey    TO notices_published_by_fkey;
ALTER TABLE public.notices RENAME CONSTRAINT circulars_target_class_id_fkey TO notices_target_class_id_fkey;
ALTER TABLE public.notices RENAME CONSTRAINT circulars_target_wing_id_fkey  TO notices_target_wing_id_fkey;

ALTER INDEX public.idx_circulars_institution RENAME TO idx_notices_institution;
ALTER INDEX public.idx_circulars_published   RENAME TO idx_notices_published;

ALTER TRIGGER update_circulars_ts ON public.notices RENAME TO update_notices_ts;

-- Normalise legacy values BEFORE the CHECK constraints go on.
--   scope 'all' (2 seed rows)            -> 'institution'
--   priority 'high' (1 row)              -> 'important' (the value
--                                           ImportantCircularsCard already
--                                           filtered on but no writer produced)
--   type 'announcement' / 'notice'       -> 'general'
UPDATE public.notices SET scope    = 'institution' WHERE scope    NOT IN ('institution','wing','class');
-- target_class_id / target_wing_id are NULL on every legacy row, so the 3
-- scope='class' rows name no class at all. The old policy matched on
-- institution_id alone, so they were visible institution-wide in practice;
-- folding them into 'institution' preserves exactly what users see today
-- instead of stranding them with an empty audience.
UPDATE public.notices SET scope = 'institution'
 WHERE scope = 'class'  AND target_class_id IS NULL;
UPDATE public.notices SET scope = 'institution'
 WHERE scope = 'wing'   AND target_wing_id  IS NULL;
UPDATE public.notices SET priority = 'important'   WHERE priority = 'high';
UPDATE public.notices SET priority = 'normal'      WHERE priority NOT IN ('normal','important','urgent');
UPDATE public.notices SET type     = 'general'     WHERE type     NOT IN ('general','academic','event','ptm');

ALTER TABLE public.notices
  ADD COLUMN audience_roles           text[]  NOT NULL DEFAULT ARRAY['student']::text[],
  ADD COLUMN requires_acknowledgement boolean NOT NULL DEFAULT false,
  ADD COLUMN recipient_count          integer NOT NULL DEFAULT 0,
  ADD COLUMN attachments              jsonb   NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.notices.recipient_count IS
  'Snapshot written by publish_notice so a list row never runs a COUNT over notice_recipients.';
COMMENT ON COLUMN public.notices.audience_roles IS
  'Author-chosen for wing/institution scope. Under class scope publish_notice writes what it actually expanded.';

ALTER TABLE public.notices
  ADD CONSTRAINT notices_scope_check    CHECK (scope    IN ('institution','wing','class')),
  ADD CONSTRAINT notices_priority_check CHECK (priority IN ('normal','important','urgent')),
  ADD CONSTRAINT notices_type_check     CHECK (type     IN ('general','academic','event','ptm')),
  ADD CONSTRAINT notices_audience_roles_check
    CHECK (audience_roles <@ ARRAY['coordinator','teacher','student']::text[]);

COMMIT;
```

- [ ] **Step 5: Apply the migration and run the assertions**

Run:
```bash
powershell -NoProfile -File scripts/notice-board/apply.ps1 \
  -Migration supabase/migrations/20260822100000_notices_rename_and_columns.sql \
  -Verify scripts/notice-board/verify-01-rename.sql
```
Expected: `ALL ASSERTIONS PASSED`, with every `ok_*` field `true` in the printed JSON.

- [ ] **Step 6: Confirm the old policies still function post-rename**

Run:
```bash
cat > "$TEMP/p.sql" <<'SQL'
SELECT policyname, cmd FROM pg_policies
WHERE schemaname='public' AND tablename='notices' ORDER BY policyname;
SQL
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile "$TEMP/p.sql" -OutFile "$TEMP/p.json"
cat "$TEMP/p.json"
```
Expected: exactly four rows — `circ_delete`, `circ_insert`, `circ_select`, `circ_update`. Policy names are independent of the table name, so they carry over the rename unchanged and keep the table readable until Task 3 replaces them.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260822100000_notices_rename_and_columns.sql scripts/notice-board/
git commit -m "feat(notices): rename circulars to notices, normalise legacy values

Renames the table, its constraints, indexes and trigger, folds the
undocumented scope='all' and priority='high' values into the real
domains, and adds audience_roles / requires_acknowledgement /
recipient_count / attachments.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Target junctions, `notice_recipients`, and the legacy backfill

**Files:**
- Create: `supabase/migrations/20260822100100_notice_targets_and_recipients.sql`
- Create: `scripts/notice-board/verify-02-recipients.sql`

**Interfaces:**
- Consumes: `public.notices` from Task 1, including `target_class_id` / `target_wing_id` (dropped by this task) and `recipient_count`.
- Produces:
  - `public.notice_target_classes (notice_id uuid, class_id uuid)`, PK `(notice_id, class_id)`.
  - `public.notice_target_wings (notice_id uuid, wing_id uuid)`, PK `(notice_id, wing_id)`.
  - `public.notice_recipients (id uuid, notice_id uuid, user_id uuid, recipient_role text, added_reason text, read_at timestamptz, acknowledged_at timestamptz, created_at timestamptz)`, `UNIQUE (notice_id, user_id)`.
  - `public.notices` no longer has `target_class_id` or `target_wing_id`.
  - `public.circular_acknowledgements` no longer exists.

- [ ] **Step 1: Write the assertion script**

Create `scripts/notice-board/verify-02-recipients.sql`:

```sql
SELECT
  (to_regclass('public.notice_recipients') IS NOT NULL)                            AS ok_recipients_table,
  (to_regclass('public.notice_target_classes') IS NOT NULL)                        AS ok_target_classes,
  (to_regclass('public.notice_target_wings') IS NOT NULL)                          AS ok_target_wings,
  (to_regclass('public.circular_acknowledgements') IS NULL)                        AS ok_old_acks_dropped,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='notices'
       AND column_name IN ('target_class_id','target_wing_id')) = 0                AS ok_legacy_cols_dropped,
  -- no legacy row carried a target, so both junctions start empty
  (SELECT count(*) FROM public.notice_target_classes) = 0                          AS ok_class_targets_copied,
  (SELECT count(*) FROM public.notice_target_wings) = 0                            AS ok_wing_targets_copied,
  -- every notice got a non-empty audience, and recipient_count agrees with reality
  (SELECT count(*) FROM public.notices n
     WHERE n.recipient_count <> (SELECT count(*) FROM public.notice_recipients r
                                  WHERE r.notice_id = n.id)) = 0                   AS ok_counts_agree,
  (SELECT count(*) FROM public.notices WHERE recipient_count = 0) = 0              AS ok_no_empty_audience,
  -- 1 of the 3 legacy acknowledgements survives; the other 2 were self-acks by
  -- the notice author, who is never their own recipient
  (SELECT count(*) FROM public.notice_recipients
     WHERE acknowledged_at IS NOT NULL) = 1                                        AS ok_acks_migrated,
  (SELECT count(*) FROM public.notice_recipients
     WHERE acknowledged_at IS NOT NULL AND read_at IS NULL) = 0                    AS ok_ack_implies_read,
  -- nobody is their own recipient
  (SELECT count(*) FROM public.notice_recipients r
     JOIN public.notices n ON n.id = r.notice_id
    WHERE r.user_id = n.published_by) = 0                                          AS ok_author_excluded,
  -- one row per person per notice
  (SELECT count(*) FROM (
      SELECT notice_id, user_id FROM public.notice_recipients
      GROUP BY 1,2 HAVING count(*) > 1) d) = 0                                     AS ok_no_duplicates,
  -- every FK side is indexed
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
            AND indexname='notice_recipients_user_id_idx')                         AS ok_user_index,
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
            AND indexname='notice_target_classes_class_id_idx')                    AS ok_class_index;
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-02-recipients.sql -OutFile "$TEMP/v02.json"
```
Expected: `HTTP ERROR 400` — `relation "public.notice_recipients" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260822100100_notice_targets_and_recipients.sql`:

```sql
-- Notice Board phase 2: multi-target junctions + materialised recipients.
--
-- Recipients are expanded at publish time rather than evaluated at read time.
-- The notice list is loaded by every user on every visit, so its RLS predicate
-- runs per row per user: a materialised row costs one index lookup, whereas
-- rule evaluation costs several EXISTS per row. Publishing is the cold path and
-- fans out in a single INSERT ... SELECT.
--
-- "Who was addressed" and "who has read it" share one row, so reach is
-- count(*) FILTER (WHERE read_at IS NOT NULL) over count(*) — one server-side
-- aggregate — and first-open is an UPDATE of a row that already exists rather
-- than an insert-vs-upsert race.
BEGIN;

CREATE TABLE public.notice_target_classes (
  notice_id uuid NOT NULL REFERENCES public.notices(id)  ON DELETE CASCADE,
  class_id  uuid NOT NULL REFERENCES public.classes(id)  ON DELETE CASCADE,
  PRIMARY KEY (notice_id, class_id)
);
CREATE INDEX notice_target_classes_class_id_idx ON public.notice_target_classes (class_id);

CREATE TABLE public.notice_target_wings (
  notice_id uuid NOT NULL REFERENCES public.notices(id) ON DELETE CASCADE,
  wing_id   uuid NOT NULL REFERENCES public.wings(id)   ON DELETE CASCADE,
  PRIMARY KEY (notice_id, wing_id)
);
CREATE INDEX notice_target_wings_wing_id_idx ON public.notice_target_wings (wing_id);

CREATE TABLE public.notice_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id       uuid NOT NULL REFERENCES public.notices(id)  ON DELETE CASCADE,
  -- ownership column: cascades with the profile (CLAUDE.md §21)
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_role  text NOT NULL CHECK (recipient_role IN ('coordinator','teacher','student')),
  added_reason    text NOT NULL CHECK (added_reason IN
                    ('audience_role','class_student','class_teacher',
                     'wing_coordinator_auto','wing_member')),
  read_at         timestamptz,
  acknowledged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, user_id)
);

-- UNIQUE(notice_id,user_id) already serves notice-first lookups (reach, the
-- recipient list). These cover the other two access patterns.
CREATE INDEX notice_recipients_user_id_idx ON public.notice_recipients (user_id);
CREATE INDEX notice_recipients_unread_idx  ON public.notice_recipients (notice_id)
  WHERE read_at IS NULL;

COMMENT ON COLUMN public.notice_recipients.added_reason IS
  'Why this person is on the notice. Renders the locked coordinator chip ("Added because Class 9-A is in Senior Wing") and makes an unexpected recipient debuggable.';

ALTER TABLE public.notice_target_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_target_wings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_recipients     ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Backfill: copy the single-target columns into the junctions.
-- ---------------------------------------------------------------------------
INSERT INTO public.notice_target_classes (notice_id, class_id)
SELECT id, target_class_id FROM public.notices WHERE target_class_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.notice_target_wings (notice_id, wing_id)
SELECT id, target_wing_id FROM public.notices WHERE target_wing_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill: expand each legacy notice's original scope into recipients.
-- Role priority coordinator > teacher > student makes recipient_role
-- deterministic for someone who qualifies twice.
-- ---------------------------------------------------------------------------
INSERT INTO public.notice_recipients (notice_id, user_id, recipient_role, added_reason)
SELECT DISTINCT ON (c.notice_id, c.user_id)
       c.notice_id, c.user_id, c.recipient_role, c.added_reason
FROM (
  -- class scope: students + teachers of the target class, plus its wing coordinators
  SELECT n.id AS notice_id, ca.user_id,
         ca.role::text AS recipient_role,
         CASE ca.role::text WHEN 'student' THEN 'class_student' ELSE 'class_teacher' END AS added_reason
    FROM public.notices n
    JOIN public.notice_target_classes tc ON tc.notice_id = n.id
    JOIN public.class_assignments ca     ON ca.class_id  = tc.class_id
    JOIN public.profiles p               ON p.id = ca.user_id
   WHERE n.scope = 'class'
     AND ca.role::text IN ('student','teacher')
     AND p.institution_id = n.institution_id
     AND p.is_active IS NOT FALSE

  UNION ALL

  SELECT n.id, wa.user_id, 'coordinator', 'wing_coordinator_auto'
    FROM public.notices n
    JOIN public.notice_target_classes tc  ON tc.notice_id = n.id
    JOIN public.wing_class_mappings wcm   ON wcm.class_id = tc.class_id
    JOIN public.wing_assignments wa       ON wa.wing_id   = wcm.wing_id
    JOIN public.profiles p                ON p.id = wa.user_id
   WHERE n.scope = 'class'
     AND p.institution_id = n.institution_id
     AND p.is_active IS NOT FALSE

  UNION ALL

  -- wing scope: everyone assigned to the target wing
  SELECT n.id, wa.user_id,
         COALESCE((SELECT ur.role::text FROM public.user_roles ur
                    WHERE ur.user_id = wa.user_id
                      AND ur.role::text IN ('coordinator','teacher','student')
                    ORDER BY CASE ur.role::text
                               WHEN 'coordinator' THEN 1
                               WHEN 'teacher'     THEN 2
                               ELSE 3 END
                    LIMIT 1), 'student'),
         'wing_member'
    FROM public.notices n
    JOIN public.notice_target_wings tw ON tw.notice_id = n.id
    JOIN public.wing_assignments wa    ON wa.wing_id   = tw.wing_id
    JOIN public.profiles p             ON p.id = wa.user_id
   WHERE n.scope = 'wing'
     AND p.institution_id = n.institution_id
     AND p.is_active IS NOT FALSE

  UNION ALL

  -- institution scope: every active coordinator/teacher/student in the school
  SELECT n.id, p.id,
         COALESCE((SELECT ur.role::text FROM public.user_roles ur
                    WHERE ur.user_id = p.id
                      AND ur.role::text IN ('coordinator','teacher','student')
                    ORDER BY CASE ur.role::text
                               WHEN 'coordinator' THEN 1
                               WHEN 'teacher'     THEN 2
                               ELSE 3 END
                    LIMIT 1), 'student'),
         'audience_role'
    FROM public.notices n
    JOIN public.profiles p ON p.institution_id = n.institution_id
   WHERE n.scope = 'institution'
     AND p.is_active IS NOT FALSE
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = p.id
                    AND ur.role::text IN ('coordinator','teacher','student'))
) c
JOIN public.notices n2 ON n2.id = c.notice_id
WHERE c.user_id <> n2.published_by          -- the author reads their own notice through oversight
ORDER BY c.notice_id, c.user_id,
         CASE c.recipient_role
           WHEN 'coordinator' THEN 1
           WHEN 'teacher'     THEN 2
           ELSE 3 END
ON CONFLICT (notice_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Merge the legacy acknowledgements. An acknowledgement implies a read.
--
-- 2 of the 3 were made by the notice's own author. An author is never their own
-- recipient -- notice_expand_audience guarantees that for every new notice --
-- so reintroducing them here would leave the table permanently inconsistent
-- with the rule the rest of the system relies on. Those 2 self-acks are dropped
-- and 1 real acknowledgement survives.
--
-- A legacy acker who is not otherwise in the expanded audience (roster drift
-- since they acked) is still inserted, because their signal is real data.
-- ---------------------------------------------------------------------------
INSERT INTO public.notice_recipients (notice_id, user_id, recipient_role, added_reason, read_at, acknowledged_at)
SELECT ca.circular_id, ca.user_id, 'student', 'audience_role', ca.acknowledged_at, ca.acknowledged_at
  FROM public.circular_acknowledgements ca
  JOIN public.notices n ON n.id = ca.circular_id
 WHERE ca.user_id <> n.published_by
ON CONFLICT (notice_id, user_id) DO UPDATE
  SET read_at         = COALESCE(public.notice_recipients.read_at, EXCLUDED.read_at),
      acknowledged_at = COALESCE(public.notice_recipients.acknowledged_at, EXCLUDED.acknowledged_at);

UPDATE public.notices n
   SET recipient_count = (SELECT count(*) FROM public.notice_recipients r WHERE r.notice_id = n.id);

DROP TABLE public.circular_acknowledgements;

ALTER TABLE public.notices
  DROP COLUMN target_class_id,
  DROP COLUMN target_wing_id;

COMMIT;
```

- [ ] **Step 4: Apply and verify**

Run:
```bash
powershell -NoProfile -File scripts/notice-board/apply.ps1 \
  -Migration supabase/migrations/20260822100100_notice_targets_and_recipients.sql \
  -Verify scripts/notice-board/verify-02-recipients.sql
```
Expected: `ALL ASSERTIONS PASSED`.

- [ ] **Step 5: Eyeball the fan-out sizes**

Run:
```bash
cat > "$TEMP/fan.sql" <<'SQL'
SELECT left(n.id::text,8) AS id, n.scope, left(n.title,28) AS title, n.recipient_count,
       count(*) FILTER (WHERE r.recipient_role='student')     AS students,
       count(*) FILTER (WHERE r.recipient_role='teacher')     AS teachers,
       count(*) FILTER (WHERE r.recipient_role='coordinator') AS coordinators
  FROM public.notices n
  LEFT JOIN public.notice_recipients r ON r.notice_id = n.id
 GROUP BY 1,2,3,4 ORDER BY n.recipient_count DESC;
SQL
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile "$TEMP/fan.sql" -OutFile "$TEMP/fan.json"
cat "$TEMP/fan.json"
```
Expected: `institution`-scope rows carry the largest counts (hundreds to ~1,500 for Alliance), `class`-scope rows carry tens plus a small coordinator count. A `class`-scope row with **zero** coordinators means that class has no `wing_class_mappings` entry — record it, it is data to report, not a migration bug.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260822100100_notice_targets_and_recipients.sql scripts/notice-board/verify-02-recipients.sql
git commit -m "feat(notices): multi-target junctions + materialised recipients

Adds notice_target_classes / notice_target_wings / notice_recipients,
backfills all 9 legacy notices by expanding their original scope, folds
the 3 legacy acknowledgements in as read+acknowledged stamps, then drops
target_class_id / target_wing_id and circular_acknowledgements.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Helpers and the RLS policy set

**Files:**
- Create: `supabase/migrations/20260822100200_notice_helpers_and_rls.sql`
- Create: `scripts/notice-board/verify-03-rls.sql`

**Interfaces:**
- Consumes: `notices`, `notice_recipients`, `notice_target_classes`, `notice_target_wings` from Tasks 1–2.
- Produces, all `SECURITY DEFINER STABLE SET search_path = public`:
  - `public.notice_is_recipient(_notice_id uuid, _user_id uuid) RETURNS boolean`
  - `public.notice_can_oversee(_notice_id uuid, _user_id uuid) RETURNS boolean`
  - `public.can_view_notice(_notice_id uuid, _user_id uuid) RETURNS boolean`
  - `public.can_publish_notices(_user_id uuid) RETURNS boolean`
  - `public.notice_id_from_path(_name text) RETURNS uuid` (NULL on a non-uuid first path segment)

- [ ] **Step 1: Write the assertion script**

Create `scripts/notice-board/verify-03-rls.sql`:

```sql
WITH fns AS (
  SELECT p.proname, p.prosecdef,
         EXISTS (SELECT 1 FROM information_schema.routine_privileges rp
                  WHERE rp.routine_schema='public' AND rp.routine_name=p.proname
                    AND rp.grantee='anon' AND rp.privilege_type='EXECUTE') AS anon_can_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('notice_is_recipient','notice_can_oversee','can_view_notice',
                       'can_publish_notices','notice_id_from_path')
)
SELECT
  (SELECT count(*) FROM fns) = 5                                      AS ok_all_five_exist,
  (SELECT count(*) FROM fns WHERE NOT prosecdef) = 0                  AS ok_all_security_definer,
  (SELECT count(*) FROM fns WHERE anon_can_execute) = 0               AS ok_anon_revoked,
  -- old policy set gone, new one in place
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notices' AND policyname LIKE 'circ\_%') = 0       AS ok_old_policies_dropped,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notices') = 3                                     AS ok_notices_three_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notices' AND cmd='INSERT') = 0                    AS ok_no_direct_insert,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notice_recipients') = 1                           AS ok_recipients_one_policy,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notice_recipients' AND cmd='UPDATE') = 0          AS ok_no_direct_read_update,
  -- every new policy uses the initplan form, never a bare auth.uid()
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN ('notices','notice_recipients',
                        'notice_target_classes','notice_target_wings')
      AND (coalesce(qual,'') || coalesce(with_check,'')) ~ '[^(]auth\.uid\(\)'
  ) = 0                                                               AS ok_initplan_form,
  -- the helper discriminates: a real recipient sees their notice, a stranger does not
  (SELECT public.can_view_notice(r.notice_id, r.user_id)
     FROM public.notice_recipients r LIMIT 1) IS TRUE                 AS ok_recipient_sees,
  (SELECT public.can_view_notice(r.notice_id,
            '00000000-0000-0000-0000-000000000000'::uuid)
     FROM public.notice_recipients r LIMIT 1) IS FALSE                AS ok_stranger_blocked,
  (public.can_view_notice(NULL, '00000000-0000-0000-0000-000000000000'::uuid))
     IS NOT TRUE                                                      AS ok_null_notice_denied,
  (public.notice_id_from_path('not-a-uuid/file.pdf') IS NULL)         AS ok_bad_path_null,
  (public.notice_id_from_path('de300004-dddd-4b04-9c04-000000000001/a.pdf')
     = 'de300004-dddd-4b04-9c04-000000000001'::uuid)                  AS ok_good_path_parsed;
```

- [ ] **Step 1b: Write the live RLS test**

The static script above checks policy *shape*. This one checks policy *effect*, by impersonating
real users. `auth.uid()` resolves from `request.jwt.claims`, so `set_config` plus `SET LOCAL ROLE
authenticated` reproduces exactly what a signed-in user sees — without it the Management API session
is `postgres`, which has `BYPASSRLS` and would pass any policy.

Create `scripts/notice-board/verify-03b-rls-live.sql`:

```sql
DO $$
DECLARE
  _nid       uuid;
  _recipient uuid;
  _stranger  uuid;
  _seen      integer;
BEGIN
  SELECT r.notice_id, r.user_id INTO _nid, _recipient
    FROM public.notice_recipients r LIMIT 1;
  IF _nid IS NULL THEN RAISE EXCEPTION 'FIXTURE: no recipient rows'; END IF;

  -- somebody who is neither a recipient, nor the author, nor an admin of that school
  SELECT p.id INTO _stranger
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role::text = 'student'
   WHERE NOT EXISTS (SELECT 1 FROM public.notice_recipients r2
                      WHERE r2.notice_id = _nid AND r2.user_id = p.id)
     AND p.id <> (SELECT published_by FROM public.notices WHERE id = _nid)
   LIMIT 1;
  IF _stranger IS NULL THEN RAISE EXCEPTION 'FIXTURE: no stranger student found'; END IF;

  -- as the recipient: the notice is visible
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _recipient, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _seen FROM public.notices WHERE id = _nid;
  RESET ROLE;
  IF _seen <> 1 THEN
    RAISE EXCEPTION 'recipient could not see their own notice (saw % rows)', _seen;
  END IF;

  -- as the stranger: invisible. THIS IS THE ORIGINAL BUG.
  -- circ_select matched on institution_id alone, so this returned 1.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _stranger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _seen FROM public.notices WHERE id = _nid;
  RESET ROLE;
  IF _seen <> 0 THEN
    RAISE EXCEPTION 'SCOPE LEAK: non-recipient read the notice (saw % rows)', _seen;
  END IF;

  -- a stranger also cannot enumerate the roster
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _stranger, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _seen FROM public.notice_recipients WHERE notice_id = _nid;
  RESET ROLE;
  IF _seen <> 0 THEN
    RAISE EXCEPTION 'ROSTER LEAK: non-recipient read % recipient rows', _seen;
  END IF;

  RAISE EXCEPTION 'ROLLBACK_OK';
END $$;
```

- [ ] **Step 2: Run both scripts to verify they fail**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-03-rls.sql -OutFile "$TEMP/v03.json"
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-03b-rls-live.sql -OutFile "$TEMP/v03b.json"
cat "$TEMP/v03b.json"
```
Expected: the first returns `HTTP ERROR 400` — `function public.notice_id_from_path(unknown) does not exist`. The second raises **`SCOPE LEAK: non-recipient read the notice (saw 1 rows)`** — that is the live bug, reproduced, before the fix.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260822100200_notice_helpers_and_rls.sql`:

```sql
-- Notice Board phase 3: SECURITY DEFINER helpers + the policy set that finally
-- enforces scope.
--
-- The policy this replaces was:
--   USING (public.get_user_institution(auth.uid()) = institution_id)
-- which ignored scope entirely, so every class- and wing-targeted circular was
-- readable by every user in the school, students included.
--
-- Helpers are SECURITY DEFINER so the policies never inline a cross-table
-- EXISTS (the 2026-04-26 recursion incident), and every auth.uid() is wrapped
-- as (SELECT auth.uid()) so Postgres evaluates it once per statement instead of
-- once per row (§23.13).
BEGIN;

CREATE OR REPLACE FUNCTION public.notice_is_recipient(_notice_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notice_recipients r
     WHERE r.notice_id = _notice_id AND r.user_id = _user_id
  );
$$;

-- Oversight is downward only. A coordinator oversees a notice whose target
-- classes or wings intersect their wing_assignments; they do NOT oversee an
-- institution-scope notice from the principal (it has no targets to intersect),
-- so they receive it in their inbox but get no reach report for it.
CREATE OR REPLACE FUNCTION public.notice_can_oversee(_notice_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notices n
     WHERE n.id = _notice_id
       AND (
            n.published_by = _user_id
         OR public.is_institution_admin(_user_id, n.institution_id)
         OR EXISTS (
              SELECT 1 FROM public.notice_target_classes tc
                JOIN public.wing_class_mappings wcm ON wcm.class_id = tc.class_id
                JOIN public.wing_assignments   wa   ON wa.wing_id   = wcm.wing_id
               WHERE tc.notice_id = n.id AND wa.user_id = _user_id
            )
         OR EXISTS (
              SELECT 1 FROM public.notice_target_wings tw
                JOIN public.wing_assignments wa ON wa.wing_id = tw.wing_id
               WHERE tw.notice_id = n.id AND wa.user_id = _user_id
            )
       )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_notice(_notice_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _notice_id IS NOT NULL
     AND (public.notice_is_recipient(_notice_id, _user_id)
       OR public.notice_can_oversee(_notice_id, _user_id));
$$;

CREATE OR REPLACE FUNCTION public.can_publish_notices(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- has_role(x,'school_admin') already covers super_school_admin
  SELECT public.has_role(_user_id, 'school_admin')
      OR public.has_role(_user_id, 'coordinator')
      OR public.has_role(_user_id, 'teacher');
$$;

-- Storage paths are {notice_id}/{file}. A malformed first segment must deny,
-- not raise -- a raising cast inside a policy 500s the whole storage request.
CREATE OR REPLACE FUNCTION public.notice_id_from_path(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE _seg text;
BEGIN
  _seg := split_part(coalesce(_name, ''), '/', 1);
  RETURN _seg::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.notice_is_recipient(uuid, uuid)  FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_can_oversee(uuid, uuid)   FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_view_notice(uuid, uuid)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_publish_notices(uuid)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_id_from_path(text)        FROM anon;

GRANT EXECUTE ON FUNCTION public.notice_is_recipient(uuid, uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_can_oversee(uuid, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_notice(uuid, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_publish_notices(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_id_from_path(text)         TO authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS circ_select ON public.notices;
DROP POLICY IF EXISTS circ_insert ON public.notices;
DROP POLICY IF EXISTS circ_update ON public.notices;
DROP POLICY IF EXISTS circ_delete ON public.notices;

CREATE POLICY notices_select ON public.notices FOR SELECT TO authenticated
  USING (public.can_view_notice(id, (SELECT auth.uid())));

-- No INSERT policy at all: publishing goes through publish_notice() only, so a
-- client cannot create a notice without its recipient fan-out.

-- Title / content / priority / expiry are editable. The audience is immutable
-- after publish -- recipients are materialised, so changing it would mean
-- re-running fan-out and reconciling reads already recorded. Wrong audience
-- means delete and re-issue.
CREATE POLICY notices_update ON public.notices FOR UPDATE TO authenticated
  USING (published_by = (SELECT auth.uid())
      OR public.is_institution_admin((SELECT auth.uid()), institution_id))
  WITH CHECK (published_by = (SELECT auth.uid())
      OR public.is_institution_admin((SELECT auth.uid()), institution_id));

CREATE POLICY notices_delete ON public.notices FOR DELETE TO authenticated
  USING (public.is_institution_admin((SELECT auth.uid()), institution_id));

-- Recipients read their own row; overseers read the whole roster. No UPDATE
-- policy: mark_notice_read() is the only write path, so nobody can stamp an
-- acknowledgement they did not make or edit their own recipient_role.
CREATE POLICY notice_recipients_select ON public.notice_recipients FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
      OR public.notice_can_oversee(notice_id, (SELECT auth.uid())));

CREATE POLICY notice_target_classes_select ON public.notice_target_classes FOR SELECT TO authenticated
  USING (public.can_view_notice(notice_id, (SELECT auth.uid())));

CREATE POLICY notice_target_wings_select ON public.notice_target_wings FOR SELECT TO authenticated
  USING (public.can_view_notice(notice_id, (SELECT auth.uid())));

COMMIT;
```

- [ ] **Step 4: Apply and verify**

Run:
```bash
powershell -NoProfile -File scripts/notice-board/apply.ps1 \
  -Migration supabase/migrations/20260822100200_notice_helpers_and_rls.sql \
  -Verify scripts/notice-board/verify-03-rls.sql
```
Expected: `ALL ASSERTIONS PASSED`.

- [ ] **Step 4b: Re-run the live RLS test to verify the leak is closed**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-03b-rls-live.sql -OutFile "$TEMP/v03b.json"
cat "$TEMP/v03b.json"
```
Expected: the message is now exactly `ROLLBACK_OK`. If it still says `SCOPE LEAK`, the policy did not
replace `circ_select` — check that the `DROP POLICY` statements ran.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260822100200_notice_helpers_and_rls.sql scripts/notice-board/verify-03-rls.sql scripts/notice-board/verify-03b-rls-live.sql
git commit -m "fix(notices): enforce scope in RLS, close the class-notice leak

circ_select matched on institution_id alone, so every class- and
wing-targeted circular was readable by every user in the school. Replaces
it with can_view_notice(), backed by four SECURITY DEFINER helpers, and
removes the INSERT policy so publishing must go through publish_notice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Audience expansion, `publish_notice`, `notice_audience_preview`

**Files:**
- Create: `supabase/migrations/20260822100300_notice_expand_and_publish.sql`
- Create: `scripts/notice-board/verify-04-publish.sql`

**Interfaces:**
- Consumes: every table and helper from Tasks 1–3.
- Produces:
  - `public.notice_expand_audience(_institution_id uuid, _author uuid, _scope text, _class_ids uuid[], _wing_ids uuid[], _audience_roles text[], _teacher_ids uuid[]) RETURNS TABLE(user_id uuid, recipient_role text, added_reason text)` — the single source of truth for who receives a notice.
  - `public.publish_notice(_notice_id uuid, _title text, _content text, _type text, _priority text, _scope text, _class_ids uuid[], _wing_ids uuid[], _audience_roles text[], _teacher_ids uuid[], _requires_acknowledgement boolean, _expires_at timestamptz, _attachments jsonb) RETURNS uuid`
  - `public.notice_audience_preview(_scope text, _class_ids uuid[], _wing_ids uuid[], _audience_roles text[], _teacher_ids uuid[]) RETURNS TABLE(recipient_role text, total integer)`

- [ ] **Step 1: Write the assertion script**

Create `scripts/notice-board/verify-04-publish.sql`:

```sql
-- Runs entirely inside a rolled-back transaction so prod data is untouched.
DO $$
DECLARE
  _inst     uuid;
  _author   uuid;
  _class    uuid;
  _outsider uuid;
  _nid      uuid := gen_random_uuid();
  _cnt      integer;
  _preview  integer;
BEGIN
  -- pick a class that has students AND a wing mapping, so every branch fires
  SELECT c.institution_id, c.id INTO _inst, _class
    FROM public.classes c
   WHERE EXISTS (SELECT 1 FROM public.class_assignments ca
                  WHERE ca.class_id=c.id AND ca.role::text='student')
     AND EXISTS (SELECT 1 FROM public.wing_class_mappings w WHERE w.class_id=c.id)
   LIMIT 1;
  IF _class IS NULL THEN RAISE EXCEPTION 'FIXTURE: no class with students + wing mapping'; END IF;

  SELECT ur.user_id INTO _author
    FROM public.user_roles ur JOIN public.profiles p ON p.id=ur.user_id
   WHERE ur.role::text IN ('school_admin','super_school_admin')
     AND p.institution_id=_inst LIMIT 1;
  IF _author IS NULL THEN RAISE EXCEPTION 'FIXTURE: no admin in institution %', _inst; END IF;

  -- preview and publish must agree, so capture the expansion before writing
  SELECT count(*) INTO _preview
    FROM public.notice_expand_audience(_inst,_author,'class',ARRAY[_class],NULL,NULL,NULL);
  IF _preview = 0 THEN RAISE EXCEPTION 'class expansion produced zero recipients'; END IF;

  -- Exercise the real RPC, not a hand-rolled imitation of it. publish_notice
  -- reads auth.uid(), which resolves from request.jwt.claims.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _author, 'role', 'authenticated')::text, true);

  PERFORM public.publish_notice(
    _nid, 'assert', 'assert body', 'general', 'normal', 'class',
    ARRAY[_class], NULL, NULL, NULL, false, NULL, '[]'::jsonb);

  SELECT count(*) INTO _cnt FROM public.notice_recipients WHERE notice_id=_nid;
  IF _cnt <> _preview THEN
    RAISE EXCEPTION 'preview/publish disagree: preview=% published=%', _preview, _cnt;
  END IF;

  IF (SELECT recipient_count FROM public.notices WHERE id=_nid) <> _cnt THEN
    RAISE EXCEPTION 'recipient_count snapshot is wrong';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.notice_target_classes
                  WHERE notice_id=_nid AND class_id=_class) THEN
    RAISE EXCEPTION 'target class row was not written';
  END IF;

  -- idempotency: the client-generated id means a double-submit returns rather
  -- than publishing twice
  PERFORM public.publish_notice(
    _nid, 'assert', 'assert body', 'general', 'normal', 'class',
    ARRAY[_class], NULL, NULL, NULL, false, NULL, '[]'::jsonb);
  IF (SELECT count(*) FROM public.notice_recipients WHERE notice_id=_nid) <> _cnt THEN
    RAISE EXCEPTION 'publish_notice was not idempotent on a repeat submit';
  END IF;

  IF EXISTS (SELECT 1 FROM public.notice_recipients
              WHERE notice_id=_nid AND user_id=_author) THEN
    RAISE EXCEPTION 'author must not be their own recipient';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.notice_recipients
                  WHERE notice_id=_nid AND added_reason='wing_coordinator_auto') THEN
    RAISE EXCEPTION 'wing coordinator was not auto-added';
  END IF;

  IF EXISTS (SELECT notice_id,user_id FROM public.notice_recipients
              WHERE notice_id=_nid GROUP BY 1,2 HAVING count(*)>1) THEN
    RAISE EXCEPTION 'duplicate recipient rows';
  END IF;

  -- ---- authority must actually reject -------------------------------------
  -- A teacher who does not teach this class cannot address it.
  SELECT ur.user_id INTO _outsider
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role::text = 'teacher'
     AND p.institution_id = _inst
     AND NOT public.is_teacher_for_class(ur.user_id, _class)
     AND NOT public.is_coordinator_for_class(ur.user_id, _class)
     AND NOT public.is_institution_admin(ur.user_id, _inst)
   LIMIT 1;

  IF _outsider IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _outsider, 'role', 'authenticated')::text, true);
    BEGIN
      PERFORM public.publish_notice(
        gen_random_uuid(), 'nope', 'nope', 'general', 'normal', 'class',
        ARRAY[_class], NULL, NULL, NULL, false, NULL, '[]'::jsonb);
      RAISE EXCEPTION 'AUTHORITY HOLE: a teacher published to a class they do not teach';
    EXCEPTION WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'AUTHORITY HOLE%' THEN RAISE; END IF;
      -- the expected refusal ("You can only send notices to your own classes.")
    END;

    -- and a teacher cannot address staff
    BEGIN
      PERFORM public.publish_notice(
        gen_random_uuid(), 'nope', 'nope', 'general', 'normal', 'institution',
        NULL, NULL, ARRAY['teacher'], NULL, false, NULL, '[]'::jsonb);
      RAISE EXCEPTION 'AUTHORITY HOLE: a teacher published a whole-school staff notice';
    EXCEPTION WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'AUTHORITY HOLE%' THEN RAISE; END IF;
    END;
  ELSE
    RAISE NOTICE 'SKIPPED authority checks: no non-teaching teacher in institution %', _inst;
  END IF;

  RAISE EXCEPTION 'ROLLBACK_OK';   -- always unwind; this is an assertion run
END $$;
```

Because the block always raises, a **successful** run is the message `ROLLBACK_OK`. Any other message is a real failure.

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-04-publish.sql -OutFile "$TEMP/v04.json"
cat "$TEMP/v04.json"
```
Expected: `HTTP ERROR 400` naming `function public.notice_expand_audience(...) does not exist`.

- [ ] **Step 3: Write the expansion helper and the two RPCs**

Create `supabase/migrations/20260822100300_notice_expand_and_publish.sql`:

```sql
-- Notice Board phase 4: one expansion expression, two callers.
--
-- publish_notice and notice_audience_preview MUST agree -- a composer that
-- promises "84 students" and then delivers to 60 is worse than no preview at
-- all -- so the audience is expanded in exactly one place and both call it.
BEGIN;

CREATE OR REPLACE FUNCTION public.notice_expand_audience(
  _institution_id uuid,
  _author         uuid,
  _scope          text,
  _class_ids      uuid[],
  _wing_ids       uuid[],
  _audience_roles text[],
  _teacher_ids    uuid[]
) RETURNS TABLE(user_id uuid, recipient_role text, added_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH role_of AS (
    -- one canonical role per person: coordinator > teacher > student
    SELECT ur.user_id,
           (ARRAY_AGG(ur.role::text ORDER BY CASE ur.role::text
                        WHEN 'coordinator' THEN 1
                        WHEN 'teacher'     THEN 2
                        ELSE 3 END))[1] AS role
      FROM public.user_roles ur
     WHERE ur.role::text IN ('coordinator','teacher','student')
     GROUP BY ur.user_id
  ),
  candidates AS (
    -- CLASS scope: students of the chosen classes
    SELECT ca.user_id, 'student'::text AS recipient_role, 'class_student'::text AS added_reason
      FROM public.class_assignments ca
      JOIN public.profiles p ON p.id = ca.user_id
     WHERE _scope = 'class'
       AND ca.class_id = ANY(_class_ids)
       AND ca.role::text = 'student'
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE

    UNION ALL
    -- CLASS scope: teachers of those classes. Empty/NULL _teacher_ids means
    -- "all teachers of these classes", which is the composer's default.
    SELECT ca.user_id, 'teacher', 'class_teacher'
      FROM public.class_assignments ca
      JOIN public.profiles p ON p.id = ca.user_id
     WHERE _scope = 'class'
       AND ca.class_id = ANY(_class_ids)
       AND ca.role::text = 'teacher'
       AND (_teacher_ids IS NULL OR cardinality(_teacher_ids) = 0
            OR ca.user_id = ANY(_teacher_ids))
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE

    UNION ALL
    -- CLASS scope: wing coordinators, auto-added and not removable, so a
    -- teacher cannot notify a class while cutting their coordinator out.
    SELECT wa.user_id, 'coordinator', 'wing_coordinator_auto'
      FROM public.wing_class_mappings wcm
      JOIN public.wing_assignments wa ON wa.wing_id = wcm.wing_id
      JOIN public.profiles p          ON p.id = wa.user_id
     WHERE _scope = 'class'
       AND wcm.class_id = ANY(_class_ids)
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE

    UNION ALL
    -- WING scope: wing members filtered by the ticked audience roles
    SELECT wa.user_id, r.role, 'wing_member'
      FROM public.wing_assignments wa
      JOIN public.profiles p ON p.id = wa.user_id
      JOIN role_of r         ON r.user_id = wa.user_id
     WHERE _scope = 'wing'
       AND wa.wing_id = ANY(_wing_ids)
       AND r.role = ANY(coalesce(_audience_roles, ARRAY['coordinator','teacher','student']))
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE

    UNION ALL
    -- INSTITUTION scope: everyone in the school with a ticked role
    SELECT p.id, r.role, 'audience_role'
      FROM public.profiles p
      JOIN role_of r ON r.user_id = p.id
     WHERE _scope = 'institution'
       AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE
       AND r.role = ANY(coalesce(_audience_roles, ARRAY['coordinator','teacher','student']))
  )
  SELECT DISTINCT ON (c.user_id) c.user_id, c.recipient_role, c.added_reason
    FROM candidates c
   WHERE c.user_id <> _author       -- author reaches their notice through oversight
   ORDER BY c.user_id,
            CASE c.recipient_role
              WHEN 'coordinator' THEN 1
              WHEN 'teacher'     THEN 2
              ELSE 3 END;
$$;

CREATE OR REPLACE FUNCTION public.notice_audience_preview(
  _scope          text,
  _class_ids      uuid[] DEFAULT NULL,
  _wing_ids       uuid[] DEFAULT NULL,
  _audience_roles text[] DEFAULT NULL,
  _teacher_ids    uuid[] DEFAULT NULL
) RETURNS TABLE(recipient_role text, total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.recipient_role, count(*)::integer
    FROM public.notice_expand_audience(
           public.get_user_institution((SELECT auth.uid())),
           (SELECT auth.uid()),
           _scope, _class_ids, _wing_ids, _audience_roles, _teacher_ids) e
   GROUP BY e.recipient_role;
$$;

CREATE OR REPLACE FUNCTION public.publish_notice(
  _notice_id               uuid,
  _title                   text,
  _content                 text,
  _type                    text,
  _priority                text,
  _scope                   text,
  _class_ids               uuid[]      DEFAULT NULL,
  _wing_ids                uuid[]      DEFAULT NULL,
  _audience_roles          text[]      DEFAULT NULL,
  _teacher_ids             uuid[]      DEFAULT NULL,
  _requires_acknowledgement boolean    DEFAULT false,
  _expires_at              timestamptz DEFAULT NULL,
  _attachments             jsonb       DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _author    uuid := (SELECT auth.uid());
  _inst      uuid;
  _is_admin  boolean;
  _is_coord  boolean;
  _is_teach  boolean;
  _roles     text[];
  _n         integer;
BEGIN
  IF _author IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to publish a notice.';
  END IF;

  -- Idempotent: the notice id is generated client-side so attachments can be
  -- uploaded before the row exists. A double-submit finds it already present
  -- and returns instead of publishing twice.
  IF EXISTS (SELECT 1 FROM public.notices WHERE id = _notice_id) THEN
    RETURN _notice_id;
  END IF;

  _inst := public.get_user_institution(_author);
  IF _inst IS NULL THEN
    RAISE EXCEPTION 'Your account is not linked to a school yet.';
  END IF;

  IF coalesce(btrim(_title), '') = '' THEN
    RAISE EXCEPTION 'A notice needs a title.';
  END IF;
  IF coalesce(btrim(_content), '') = '' THEN
    RAISE EXCEPTION 'A notice needs some content.';
  END IF;
  IF _scope NOT IN ('institution','wing','class') THEN
    RAISE EXCEPTION 'Choose who this notice is for.';
  END IF;

  _is_admin := public.is_institution_admin(_author, _inst);
  _is_coord := public.has_role(_author, 'coordinator');
  _is_teach := public.has_role(_author, 'teacher');

  IF NOT (_is_admin OR _is_coord OR _is_teach) THEN
    RAISE EXCEPTION 'You do not have permission to publish notices.';
  END IF;

  -- ---- authority, per scope -------------------------------------------------
  IF _scope = 'class' THEN
    IF _class_ids IS NULL OR cardinality(_class_ids) = 0 THEN
      RAISE EXCEPTION 'Pick at least one class.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.classes c
                WHERE c.id = ANY(_class_ids) AND c.institution_id <> _inst) THEN
      RAISE EXCEPTION 'That class belongs to another school.';
    END IF;
    IF NOT _is_admin THEN
      -- a coordinator may address classes in their wings; a teacher only
      -- classes they actually teach
      IF EXISTS (
        SELECT 1 FROM unnest(_class_ids) cid
         WHERE NOT (
           (_is_coord AND public.is_coordinator_for_class(_author, cid))
           OR (_is_teach AND public.is_teacher_for_class(_author, cid))
         )
      ) THEN
        RAISE EXCEPTION 'You can only send notices to your own classes.';
      END IF;
    END IF;
    -- Under class scope the audience is implied by the flow, so the RPC records
    -- what it expanded rather than trusting a second, contradictory input.
    _roles := NULL;

  ELSIF _scope = 'wing' THEN
    IF _wing_ids IS NULL OR cardinality(_wing_ids) = 0 THEN
      RAISE EXCEPTION 'Pick at least one wing.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.wings w
                WHERE w.id = ANY(_wing_ids) AND w.institution_id <> _inst) THEN
      RAISE EXCEPTION 'That wing belongs to another school.';
    END IF;
    IF NOT _is_admin THEN
      IF NOT _is_coord THEN
        RAISE EXCEPTION 'Only coordinators and admins can send a wing notice.';
      END IF;
      IF EXISTS (
        SELECT 1 FROM unnest(_wing_ids) wid
         WHERE NOT EXISTS (SELECT 1 FROM public.wing_assignments wa
                            WHERE wa.user_id = _author AND wa.wing_id = wid)
      ) THEN
        RAISE EXCEPTION 'You can only send notices to your own wings.';
      END IF;
    END IF;
    _roles := coalesce(_audience_roles, ARRAY['teacher','student']);

  ELSE  -- institution
    IF NOT _is_admin THEN
      RAISE EXCEPTION 'Only school admins can send a whole-school notice.';
    END IF;
    _roles := coalesce(_audience_roles, ARRAY['coordinator','teacher','student']);
  END IF;

  -- A teacher issues to their students. They may not address staff.
  IF _is_teach AND NOT _is_admin AND NOT _is_coord THEN
    IF _roles IS NOT NULL AND EXISTS (
      SELECT 1 FROM unnest(_roles) r WHERE r <> 'student'
    ) THEN
      RAISE EXCEPTION 'Teachers can only send notices to students.';
    END IF;
    IF _teacher_ids IS NOT NULL AND cardinality(_teacher_ids) > 0 THEN
      RAISE EXCEPTION 'Teachers can only send notices to students.';
    END IF;
  END IF;

  IF _roles IS NOT NULL AND NOT (_roles <@ ARRAY['coordinator','teacher','student']) THEN
    RAISE EXCEPTION 'Unknown audience.';
  END IF;

  -- ---- write ---------------------------------------------------------------
  INSERT INTO public.notices (
    id, institution_id, title, content, type, scope, priority,
    audience_roles, requires_acknowledgement, expires_at, attachments,
    published_by, published_at
  ) VALUES (
    _notice_id, _inst, btrim(_title), _content, _type, _priority, _scope,
    coalesce(_roles, ARRAY['student']), _requires_acknowledgement, _expires_at,
    coalesce(_attachments, '[]'::jsonb),
    _author, now()
  );

  IF _scope = 'class' THEN
    INSERT INTO public.notice_target_classes (notice_id, class_id)
    SELECT _notice_id, cid FROM unnest(_class_ids) cid
    ON CONFLICT DO NOTHING;
  ELSIF _scope = 'wing' THEN
    INSERT INTO public.notice_target_wings (notice_id, wing_id)
    SELECT _notice_id, wid FROM unnest(_wing_ids) wid
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.notice_recipients (notice_id, user_id, recipient_role, added_reason)
  SELECT _notice_id, e.user_id, e.recipient_role, e.added_reason
    FROM public.notice_expand_audience(
           _inst, _author, _scope, _class_ids, _wing_ids, _roles, _teacher_ids) e
  ON CONFLICT (notice_id, user_id) DO NOTHING;

  GET DIAGNOSTICS _n = ROW_COUNT;

  UPDATE public.notices
     SET recipient_count = _n,
         audience_roles  = COALESCE(
           _roles,
           (SELECT coalesce(array_agg(DISTINCT r.recipient_role), ARRAY['student'])
              FROM public.notice_recipients r WHERE r.notice_id = _notice_id))
   WHERE id = _notice_id;

  RETURN _notice_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.notice_expand_audience(uuid,uuid,text,uuid[],uuid[],text[],uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_audience_preview(text,uuid[],uuid[],text[],uuid[])          FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_notice(uuid,text,text,text,text,text,uuid[],uuid[],text[],uuid[],boolean,timestamptz,jsonb) FROM anon;

-- notice_expand_audience is an internal building block: it takes _author as a
-- parameter, so exposing it to clients would let anyone enumerate any roster.
REVOKE EXECUTE ON FUNCTION public.notice_expand_audience(uuid,uuid,text,uuid[],uuid[],text[],uuid[]) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.notice_audience_preview(text,uuid[],uuid[],text[],uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_notice(uuid,text,text,text,text,text,uuid[],uuid[],text[],uuid[],boolean,timestamptz,jsonb) TO authenticated;

COMMIT;
```

- [ ] **Step 4: Apply the migration**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 \
  -SqlFile supabase/migrations/20260822100300_notice_expand_and_publish.sql \
  -OutFile "$TEMP/m04.json"
cat "$TEMP/m04.json"
```
Expected: `HTTP 201`.

- [ ] **Step 5: Run the assertion script to verify it passes**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-04-publish.sql -OutFile "$TEMP/v04.json"
cat "$TEMP/v04.json"
```
Expected: an error whose message is exactly `ROLLBACK_OK`. Any other message names the assertion that failed.

- [ ] **Step 6: Confirm the anon revoke landed**

Run:
```bash
cat > "$TEMP/g.sql" <<'SQL'
SELECT routine_name, grantee, privilege_type
  FROM information_schema.routine_privileges
 WHERE routine_schema='public'
   AND routine_name IN ('publish_notice','notice_audience_preview','notice_expand_audience')
 ORDER BY routine_name, grantee;
SQL
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile "$TEMP/g.sql" -OutFile "$TEMP/g.json"
cat "$TEMP/g.json"
```
Expected: no row with `grantee = 'anon'`, and no row granting `notice_expand_audience` to `authenticated`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260822100300_notice_expand_and_publish.sql scripts/notice-board/verify-04-publish.sql
git commit -m "feat(notices): audience expansion, publish_notice, audience preview

One expansion expression feeds both publishing and the composer preview,
so the promised reach cannot disagree with the delivered one. Authority
is enforced in the RPC: admins anywhere, coordinators inside their wings,
teachers to their own classes' students only.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Read and reporting RPCs

**Files:**
- Create: `supabase/migrations/20260822100400_notice_read_and_reporting.sql`
- Create: `scripts/notice-board/verify-05-reporting.sql`

**Interfaces:**
- Consumes: every table and helper from Tasks 1–4.
- Produces:
  - `public.mark_notice_read(_notice_id uuid, _acknowledge boolean DEFAULT false) RETURNS void`
  - `public.notice_inbox(_before_published_at timestamptz, _before_id uuid, _limit integer) RETURNS TABLE(id uuid, title text, content text, type text, scope text, priority text, published_at timestamptz, expires_at timestamptz, requires_acknowledgement boolean, attachments jsonb, publisher_name text, read_at timestamptz, acknowledged_at timestamptz)`
  - `public.notice_outbox(_before_published_at timestamptz, _before_id uuid, _limit integer) RETURNS TABLE(id uuid, title text, type text, scope text, priority text, published_at timestamptz, expires_at timestamptz, requires_acknowledgement boolean, publisher_name text, target_summary text, recipient_count integer, read_count integer, ack_count integer)`
  - `public.notice_reach(_notice_id uuid) RETURNS TABLE(recipient_role text, total integer, read_count integer, ack_count integer)`
  - `public.notice_recipient_list(_notice_id uuid, _status text, _after_name text, _after_id uuid, _limit integer) RETURNS TABLE(user_id uuid, full_name text, recipient_role text, added_reason text, read_at timestamptz, acknowledged_at timestamptz)`

- [ ] **Step 1: Write the assertion script**

Create `scripts/notice-board/verify-05-reporting.sql`:

```sql
DO $$
DECLARE
  _nid    uuid;
  _uid    uuid;
  _t      integer;
  _r      integer;
  _a      integer;
  _r_after integer;
  _stamp  timestamptz;
  _rows   integer;
BEGIN
  -- The recipient must not be an institution admin, or the oversight-boundary
  -- assertion at the end would fail for the right reason and read as a bug.
  SELECT r.notice_id, r.user_id INTO _nid, _uid
    FROM public.notice_recipients r
    JOIN public.notices n ON n.id = r.notice_id
   WHERE r.read_at IS NULL
     AND NOT public.is_institution_admin(r.user_id, n.institution_id)
   LIMIT 1;
  IF _nid IS NULL THEN RAISE EXCEPTION 'FIXTURE: no unread non-admin recipient row'; END IF;

  -- notice_reach and notice_recipient_list are gated on notice_can_oversee(),
  -- which needs an identity. auth.uid() reads request.jwt.claims, and this
  -- session is otherwise postgres with no claims at all -- without this the
  -- gate returns false and every assertion below reads as "empty" rather than
  -- "broken". Impersonate the notice's author, who always oversees it.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT published_by FROM public.notices WHERE id = _nid),
                      'role', 'authenticated')::text, true);

  -- reach before
  SELECT coalesce(sum(total),0), coalesce(sum(read_count),0), coalesce(sum(ack_count),0)
    INTO _t, _r, _a FROM public.notice_reach(_nid);
  IF _t = 0 THEN RAISE EXCEPTION 'notice_reach returned no totals'; END IF;

  -- Mark read. auth.uid() is NULL in a Management API session, so exercise the
  -- exact UPDATE mark_notice_read performs rather than the RPC wrapper.
  UPDATE public.notice_recipients
     SET read_at = coalesce(read_at, now())
   WHERE notice_id = _nid AND user_id = _uid;

  SELECT coalesce(sum(read_count),0) INTO _r_after FROM public.notice_reach(_nid);
  IF _r_after <> _r + 1 THEN
    RAISE EXCEPTION 'reach read_count did not advance: before=% after=%', _r, _r_after;
  END IF;

  -- idempotency: a second mark must not move the stamp
  SELECT read_at INTO _stamp FROM public.notice_recipients
   WHERE notice_id=_nid AND user_id=_uid;
  UPDATE public.notice_recipients
     SET read_at = coalesce(read_at, now())
   WHERE notice_id = _nid AND user_id = _uid;
  IF (SELECT read_at FROM public.notice_recipients
       WHERE notice_id=_nid AND user_id=_uid) <> _stamp THEN
    RAISE EXCEPTION 'COALESCE guard failed: read_at moved on a second mark';
  END IF;

  -- recipient list respects _limit
  SELECT count(*) INTO _rows
    FROM public.notice_recipient_list(_nid, 'all', NULL, NULL, 5);
  IF _rows > 5 THEN RAISE EXCEPTION 'recipient list ignored _limit'; END IF;

  -- and its status filter
  IF EXISTS (SELECT 1 FROM public.notice_recipient_list(_nid,'unread',NULL,NULL,500)
              WHERE read_at IS NOT NULL) THEN
    RAISE EXCEPTION 'unread filter returned read rows';
  END IF;

  -- oversight boundary: a plain recipient is NOT an overseer, so reporting must
  -- come back empty for them. "Author + everyone above" is the whole rule.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  IF EXISTS (SELECT 1 FROM public.notice_reach(_nid)) THEN
    RAISE EXCEPTION 'REPORT LEAK: a plain recipient got reach data';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notice_recipient_list(_nid,'all',NULL,NULL,50)) THEN
    RAISE EXCEPTION 'REPORT LEAK: a plain recipient enumerated the roster';
  END IF;

  RAISE EXCEPTION 'ROLLBACK_OK';
END $$;
```

A successful run raises `ROLLBACK_OK` and leaves no writes behind.

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-05-reporting.sql -OutFile "$TEMP/v05.json"
cat "$TEMP/v05.json"
```
Expected: `HTTP ERROR 400` naming `function public.notice_reach(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260822100400_notice_read_and_reporting.sql`:

```sql
-- Notice Board phase 5: read receipts and the reach rollup.
--
-- Both feeds are single RPCs rather than PostgREST embeds so a list never N+1s
-- to fetch per-notice read state or reach, and both paginate by keyset rather
-- than OFFSET (§23).
BEGIN;

-- Opening a notice stamps read_at. The Acknowledge button additionally stamps
-- acknowledged_at, and is only offered when notices.requires_acknowledgement.
--
-- COALESCE makes this idempotent by construction: a double-click, a retry, or a
-- second open cannot move a timestamp that is already set. notice_recipients
-- has no UPDATE policy, so this is the only write path -- nobody can stamp an
-- acknowledgement they did not make or edit their own recipient_role.
CREATE OR REPLACE FUNCTION public.mark_notice_read(
  _notice_id  uuid,
  _acknowledge boolean DEFAULT false
) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.notice_recipients
     SET read_at         = COALESCE(read_at, now()),
         acknowledged_at = CASE WHEN _acknowledge
                                THEN COALESCE(acknowledged_at, now())
                                ELSE acknowledged_at END
   WHERE notice_id = _notice_id
     AND user_id   = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.notice_inbox(
  _before_published_at timestamptz DEFAULT NULL,
  _before_id           uuid        DEFAULT NULL,
  _limit               integer     DEFAULT 20
) RETURNS TABLE(
  id uuid, title text, content text, type text, scope text, priority text,
  published_at timestamptz, expires_at timestamptz,
  requires_acknowledgement boolean, attachments jsonb,
  publisher_name text, read_at timestamptz, acknowledged_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.title, n.content, n.type, n.scope, n.priority,
         n.published_at, n.expires_at, n.requires_acknowledgement, n.attachments,
         pub.full_name, r.read_at, r.acknowledged_at
    FROM public.notice_recipients r
    JOIN public.notices  n   ON n.id  = r.notice_id
    LEFT JOIN public.profiles pub ON pub.id = n.published_by
   WHERE r.user_id = (SELECT auth.uid())
     AND n.published_at <= now()
     AND (n.expires_at IS NULL OR n.expires_at > now())
     AND (_before_published_at IS NULL
          OR (n.published_at, n.id) < (_before_published_at, _before_id))
   ORDER BY n.published_at DESC, n.id DESC
   LIMIT LEAST(GREATEST(coalesce(_limit, 20), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.notice_outbox(
  _before_published_at timestamptz DEFAULT NULL,
  _before_id           uuid        DEFAULT NULL,
  _limit               integer     DEFAULT 20
) RETURNS TABLE(
  id uuid, title text, type text, scope text, priority text,
  published_at timestamptz, expires_at timestamptz,
  requires_acknowledgement boolean, publisher_name text, target_summary text,
  recipient_count integer, read_count integer, ack_count integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.title, n.type, n.scope, n.priority,
         n.published_at, n.expires_at, n.requires_acknowledgement,
         pub.full_name,
         CASE n.scope
           WHEN 'institution' THEN 'Whole school'
           WHEN 'wing'  THEN (SELECT string_agg(w.name, ', ' ORDER BY w.name)
                                FROM public.notice_target_wings tw
                                JOIN public.wings w ON w.id = tw.wing_id
                               WHERE tw.notice_id = n.id)
           ELSE (SELECT string_agg(
                          c.name || CASE WHEN coalesce(c.section,'') <> ''
                                         THEN '-' || c.section ELSE '' END,
                          ', ' ORDER BY c.name, c.section)
                   FROM public.notice_target_classes tc
                   JOIN public.classes c ON c.id = tc.class_id
                  WHERE tc.notice_id = n.id)
         END,
         n.recipient_count,
         agg.read_count, agg.ack_count
    FROM public.notices n
    LEFT JOIN public.profiles pub ON pub.id = n.published_by
    -- server-side aggregate, never rows pulled to be counted on the client
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE r.read_at IS NOT NULL)::integer         AS read_count,
             count(*) FILTER (WHERE r.acknowledged_at IS NOT NULL)::integer AS ack_count
        FROM public.notice_recipients r WHERE r.notice_id = n.id
    ) agg
   WHERE n.institution_id = public.get_user_institution((SELECT auth.uid()))
     AND public.notice_can_oversee(n.id, (SELECT auth.uid()))
     AND (_before_published_at IS NULL
          OR (n.published_at, n.id) < (_before_published_at, _before_id))
   ORDER BY n.published_at DESC, n.id DESC
   LIMIT LEAST(GREATEST(coalesce(_limit, 20), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.notice_reach(_notice_id uuid)
RETURNS TABLE(recipient_role text, total integer, read_count integer, ack_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.recipient_role,
         count(*)::integer,
         count(*) FILTER (WHERE r.read_at IS NOT NULL)::integer,
         count(*) FILTER (WHERE r.acknowledged_at IS NOT NULL)::integer
    FROM public.notice_recipients r
   WHERE r.notice_id = _notice_id
     AND public.notice_can_oversee(_notice_id, (SELECT auth.uid()))
   GROUP BY r.recipient_role
   ORDER BY CASE r.recipient_role
              WHEN 'coordinator' THEN 1
              WHEN 'teacher'     THEN 2
              ELSE 3 END;
$$;

CREATE OR REPLACE FUNCTION public.notice_recipient_list(
  _notice_id  uuid,
  _status     text    DEFAULT 'all',
  _after_name text    DEFAULT NULL,
  _after_id   uuid    DEFAULT NULL,
  _limit      integer DEFAULT 50
) RETURNS TABLE(
  user_id uuid, full_name text, recipient_role text, added_reason text,
  read_at timestamptz, acknowledged_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.user_id, p.full_name, r.recipient_role, r.added_reason,
         r.read_at, r.acknowledged_at
    FROM public.notice_recipients r
    JOIN public.profiles p ON p.id = r.user_id
   WHERE r.notice_id = _notice_id
     AND public.notice_can_oversee(_notice_id, (SELECT auth.uid()))
     AND CASE coalesce(_status, 'all')
           WHEN 'unread'       THEN r.read_at IS NULL
           WHEN 'read'         THEN r.read_at IS NOT NULL
           WHEN 'acknowledged' THEN r.acknowledged_at IS NOT NULL
           ELSE true
         END
     AND (_after_name IS NULL
          OR (coalesce(p.full_name,''), r.user_id) > (_after_name, _after_id))
   ORDER BY coalesce(p.full_name,'') ASC, r.user_id ASC
   LIMIT LEAST(GREATEST(coalesce(_limit, 50), 1), 200);
$$;

REVOKE EXECUTE ON FUNCTION public.mark_notice_read(uuid, boolean)                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_inbox(timestamptz, uuid, integer)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_outbox(timestamptz, uuid, integer)                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_reach(uuid)                                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.notice_recipient_list(uuid, text, text, uuid, integer)     FROM anon;

GRANT EXECUTE ON FUNCTION public.mark_notice_read(uuid, boolean)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_inbox(timestamptz, uuid, integer)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_outbox(timestamptz, uuid, integer)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_reach(uuid)                                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.notice_recipient_list(uuid, text, text, uuid, integer)      TO authenticated;

COMMIT;
```

- [ ] **Step 4: Apply the migration**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 \
  -SqlFile supabase/migrations/20260822100400_notice_read_and_reporting.sql \
  -OutFile "$TEMP/m05.json"
cat "$TEMP/m05.json"
```
Expected: `HTTP 201`.

- [ ] **Step 5: Run the assertion script to verify it passes**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-05-reporting.sql -OutFile "$TEMP/v05.json"
cat "$TEMP/v05.json"
```
Expected: an error whose message is exactly `ROLLBACK_OK`.

- [ ] **Step 6: Confirm the anon revoke landed**

Run:
```bash
cat > "$TEMP/g5.sql" <<'SQL'
SELECT routine_name, grantee, privilege_type
  FROM information_schema.routine_privileges
 WHERE routine_schema='public'
   AND routine_name IN ('mark_notice_read','notice_inbox','notice_outbox',
                        'notice_reach','notice_recipient_list')
   AND grantee = 'anon';
SQL
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile "$TEMP/g5.sql" -OutFile "$TEMP/g5.json"
cat "$TEMP/g5.json"
```
Expected: `[]` — an empty array.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260822100400_notice_read_and_reporting.sql scripts/notice-board/verify-05-reporting.sql
git commit -m "feat(notices): read receipts, inbox/outbox feeds, reach rollup

mark_notice_read is idempotent via COALESCE and is the only write path to
notice_recipients. Both feeds are single keyset-paginated RPCs so a list
never N+1s for read state, and reach is a server-side aggregate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Private attachment bucket, `attachments` backfill, feature-flag rename

**Files:**
- Create: `supabase/migrations/20260822100500_notice_storage_and_flag.sql`
- Create: `scripts/notice-board/verify-06-storage-flag.sql`

**Interfaces:**
- Consumes: `notices.attachment_urls` (dropped by this task), `can_publish_notices`, `can_view_notice`, `notice_can_oversee`, `notice_id_from_path` from Task 3.
- Produces: storage bucket `notice-attachments` (private) with three policies; `public.notices.attachments` populated and `attachment_urls` dropped; `institution_features.feature_id = 'notice_board'` on 12 rows.

- [ ] **Step 1: Write the assertion script**

Create `scripts/notice-board/verify-06-storage-flag.sql`:

```sql
SELECT
  EXISTS (SELECT 1 FROM storage.buckets WHERE id='notice-attachments')          AS ok_bucket_exists,
  (SELECT NOT public FROM storage.buckets WHERE id='notice-attachments')        AS ok_bucket_private,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname LIKE 'notice_attachments_%') = 3                          AS ok_three_storage_policies,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='notices'
       AND column_name='attachment_urls') = 0                                   AS ok_legacy_col_dropped,
  -- the one real legacy attachment survived as a legacy_url entry
  (SELECT count(*) FROM public.notices
    WHERE attachments @> '[{"legacy_url": null}]'::jsonb) >= 0                   AS ok_attachments_is_jsonb,
  (SELECT count(*) FROM public.notices n
     WHERE jsonb_typeof(n.attachments) <> 'array') = 0                          AS ok_attachments_all_arrays,
  (SELECT count(*) FROM public.notices n, jsonb_array_elements(n.attachments) e
    WHERE e ? 'legacy_url') = 1                                                 AS ok_one_legacy_attachment,
  -- feature flag renamed, none left behind
  (SELECT count(*) FROM public.institution_features
     WHERE feature_id='notice_board') = 12                                      AS ok_flag_renamed,
  (SELECT count(*) FROM public.institution_features
     WHERE feature_id='circulars') = 0                                          AS ok_old_flag_gone,
  -- the deprecated bucket is intentionally still there so that file resolves
  EXISTS (SELECT 1 FROM storage.buckets WHERE id='circular-attachments')        AS ok_old_bucket_kept;
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-06-storage-flag.sql -OutFile "$TEMP/v06.json"
cat "$TEMP/v06.json"
```
Expected: a row where `ok_bucket_exists` is `false` (and `ok_legacy_col_dropped` false).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260822100500_notice_storage_and_flag.sql`:

```sql
-- Notice Board phase 6: private attachments + feature-flag rename.
--
-- circular-attachments is a PUBLIC bucket whose read policy is
--   USING (bucket_id = 'circular-attachments')
-- i.e. no membership check at all, so any attachment was world-readable by URL.
-- The new bucket is private and its read policy runs the same can_view_notice
-- helper the table uses, so an attachment is exactly as visible as its notice.
BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('notice-attachments', 'notice-attachments', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Paths are {notice_id}/{uuid}-{filename}. The notice id is generated
-- client-side so files can be uploaded before the notice row exists, which is
-- also what makes publish_notice idempotent.
CREATE POLICY notice_attachments_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'notice-attachments'
              AND public.can_publish_notices((SELECT auth.uid())));

CREATE POLICY notice_attachments_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'notice-attachments'
         AND public.can_view_notice(public.notice_id_from_path(name), (SELECT auth.uid())));

CREATE POLICY notice_attachments_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'notice-attachments'
         AND public.notice_can_oversee(public.notice_id_from_path(name), (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- attachment_urls -> attachments
--
-- attachment_urls has a DUAL SHAPE in prod: an array of public URLs on one row
-- and an empty object {} on the two seed rows, so every read must guard with
-- jsonb_typeof(...) = 'array' -- treating {} as an array raises and aborts.
--
-- Exactly one real attachment exists, on a test notice titled "ewj", and its
-- bytes live in the old public bucket. Moving bytes between buckets needs the
-- Storage API, not a storage.objects row update (a row update desyncs the
-- record from the file), so rather than run that dance for one junk file the
-- entry is preserved as {legacy_url, name} and NoticeDetail renders any entry
-- carrying legacy_url as a plain anchor instead of minting a signed URL.
-- ---------------------------------------------------------------------------
UPDATE public.notices n
   SET attachments = COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'legacy_url', u,
                  'name', regexp_replace(
                            replace(split_part(u, '/', array_length(string_to_array(u,'/'),1)), '%20', ' '),
                            '^\d+-', '')
                ))
           FROM jsonb_array_elements_text(n.attachment_urls) AS t(u)
       ), '[]'::jsonb)
 WHERE jsonb_typeof(n.attachment_urls) = 'array'
   AND jsonb_array_length(n.attachment_urls) > 0;

ALTER TABLE public.notices DROP COLUMN attachment_urls;

ALTER TABLE public.notices
  ADD CONSTRAINT notices_attachments_is_array CHECK (jsonb_typeof(attachments) = 'array');

-- ---------------------------------------------------------------------------
-- Feature flag. institution_features.feature_id has no CHECK constraint
-- (verified against pg_constraint), so this is a plain UPDATE of 12 rows.
-- ---------------------------------------------------------------------------
UPDATE public.institution_features
   SET feature_id = 'notice_board'
 WHERE feature_id = 'circulars';

COMMIT;
```

- [ ] **Step 4: Apply and verify**

Run:
```bash
powershell -NoProfile -File scripts/notice-board/apply.ps1 \
  -Migration supabase/migrations/20260822100500_notice_storage_and_flag.sql \
  -Verify scripts/notice-board/verify-06-storage-flag.sql
```
Expected: `ALL ASSERTIONS PASSED`.

- [ ] **Step 5: Confirm the old wide-open storage policies are gone or harmless**

Run:
```bash
cat > "$TEMP/sp.sql" <<'SQL'
SELECT policyname, cmd, qual
  FROM pg_policies
 WHERE schemaname='storage' AND tablename='objects'
   AND (qual ILIKE '%circular-attachments%' OR with_check ILIKE '%circular-attachments%')
 ORDER BY policyname;
SQL
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile "$TEMP/sp.sql" -OutFile "$TEMP/sp.json"
cat "$TEMP/sp.json"
```
Expected: the legacy policies are still listed. They are deliberately kept so the one legacy file keeps resolving. Record the list in the commit body so a future cleanup knows exactly what to drop.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260822100500_notice_storage_and_flag.sql scripts/notice-board/verify-06-storage-flag.sql
git commit -m "feat(notices): private attachment bucket + feature-flag rename

circular-attachments was public with a read policy of USING(bucket_id=...)
and no membership check, so any attachment was world-readable by URL. The
new notice-attachments bucket is private and its read policy runs the same
can_view_notice helper as the table. attachment_urls (dual-shaped: array on
one row, {} on two) becomes attachments; the single legacy file is kept as a
legacy_url entry rather than moved. institution_features 'circulars' ->
'notice_board' across 12 rows.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Regenerate `types.ts` and gate Phase 1

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated wholesale)
- Create: `scripts/notice-board/verify-07-phase1-gate.sql`

**Interfaces:**
- Consumes: every migration from Tasks 1–6.
- Produces: `Database["public"]["Tables"]["notices" | "notice_recipients" | "notice_target_classes" | "notice_target_wings"]` and `Database["public"]["Functions"]["publish_notice" | "mark_notice_read" | "notice_inbox" | "notice_outbox" | "notice_reach" | "notice_recipient_list" | "notice_audience_preview"]`. Phase 2 depends entirely on these being present — without them every `supabase.rpc("notice_inbox")` call is a typecheck error.

- [ ] **Step 1: Write the end-to-end gate script**

Create `scripts/notice-board/verify-07-phase1-gate.sql`:

```sql
SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('notice_expand_audience','publish_notice','notice_audience_preview',
                        'mark_notice_read','notice_inbox','notice_outbox','notice_reach',
                        'notice_recipient_list','notice_is_recipient','notice_can_oversee',
                        'can_view_notice','can_publish_notices','notice_id_from_path')) = 13
                                                                          AS ok_all_13_functions,
  -- no new function is reachable by anon
  (SELECT count(*) FROM information_schema.routine_privileges
    WHERE routine_schema='public' AND grantee='anon'
      AND routine_name LIKE ANY (ARRAY['notice\_%','publish\_notice','can\_view\_notice',
                                       'can\_publish\_notices','mark\_notice\_read'])) = 0
                                                                          AS ok_no_anon_grants,
  -- no legacy object survives
  (to_regclass('public.circulars') IS NULL
   AND to_regclass('public.circular_acknowledgements') IS NULL)           AS ok_legacy_tables_gone,
  (SELECT count(*) FROM public.institution_features WHERE feature_id='circulars') = 0
                                                                          AS ok_no_legacy_flag,
  -- RLS is on everywhere it must be
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN ('notices','notice_recipients',
                        'notice_target_classes','notice_target_wings')) AS ok_rls_enabled,
  -- every FK column is indexed
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
     AND indexname IN ('notice_recipients_user_id_idx','notice_recipients_unread_idx',
                       'notice_target_classes_class_id_idx','notice_target_wings_wing_id_idx')) = 4
                                                                          AS ok_fk_indexes,
  -- recipient_count still agrees with reality after all six migrations
  (SELECT count(*) FROM public.notices n
     WHERE n.recipient_count <> (SELECT count(*) FROM public.notice_recipients r
                                  WHERE r.notice_id = n.id)) = 0          AS ok_counts_still_agree;
```

- [ ] **Step 2: Run the gate**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/notice-board/verify-07-phase1-gate.sql -OutFile "$TEMP/v07.json"
cat "$TEMP/v07.json"
```
Expected: every `ok_*` field `true`. If `ok_all_13_functions` is short, one migration did not apply — re-run that task's apply step before continuing.

- [ ] **Step 3: Regenerate the generated types**

Run:
```bash
npx supabase gen types typescript --project-id gyymkgohcijeksmrzuyw > src/integrations/supabase/types.ts
```

- [ ] **Step 4: Verify the regeneration did not truncate the file**

An auto-merge once silently dropped 206 lines of schema from this file (commit 393f329), so check size and content rather than assuming.

Run:
```bash
wc -l src/integrations/supabase/types.ts
grep -c "notices:\|notice_recipients:\|notice_target_classes:\|notice_target_wings:" src/integrations/supabase/types.ts
grep -c "publish_notice:\|notice_inbox:\|notice_outbox:\|notice_reach:\|notice_recipient_list:\|mark_notice_read:\|notice_audience_preview:" src/integrations/supabase/types.ts
grep -c "circulars:\|circular_acknowledgements:" src/integrations/supabase/types.ts
```
Expected: line count within a few hundred lines of the previous file (not a fraction of it); at least 4 table matches; at least 7 function matches; **0** legacy matches.

- [ ] **Step 5: Confirm the frontend still compiles against the regenerated types**

`useCirculars.ts`, `CircularsList.tsx`, `CircularDetail.tsx`, `CreateCircularDialog.tsx`, `CommunicationAnalytics.tsx` and `ImportantCircularsCard.tsx` all reference the now-deleted `circulars` / `circular_acknowledgements` tables, so this WILL fail. That is expected and is Phase 2's opening task.

Run:
```bash
npm run typecheck 2>&1 | tail -40
```
Expected: errors confined to those six files. **Record the exact error list in the commit body.** Any error in a file outside that set means the regeneration dropped unrelated schema — restore `types.ts` from git and re-run Step 3.

- [ ] **Step 6: Commit**

```bash
git add src/integrations/supabase/types.ts scripts/notice-board/verify-07-phase1-gate.sql
git commit -m "chore(notices): regenerate Supabase types after the notices migrations

Phase 1 database work is complete and gated: 13 functions present, no anon
grants, legacy tables gone, RLS on all four tables, every FK indexed,
recipient_count consistent.

typecheck now fails in exactly the six circulars call sites, which Phase 2
replaces. Recorded here so a later reader can tell an expected break from a
truncated types.ts regeneration.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Deliberately deferred

`communication_overview(_institution_id)` — the RPC that replaces `CommunicationAnalytics`'s six
unbounded client-side selects — is specified in the design but is **not** in this phase. It is not a
dependency of any Notice Board surface; it belongs with the analytics rewrite that consumes it, so it
ships in the phase that touches `CommunicationAnalytics.tsx`. Flagged here so a reader comparing spec
to plan sees an intentional deferral rather than a gap.

## Phase 1 exit criteria

All seven tasks committed, and:

- `scripts/notice-board/verify-07-phase1-gate.sql` returns all `true`.
- `scripts/notice-board/verify-03b-rls-live.sql` reports `ROLLBACK_OK` — meaning an impersonated non-recipient reads **zero** rows for a notice they are not on, and zero recipient rows. Before Task 3 the same script reports `SCOPE LEAK`. That before/after pair is the proof the original bug is fixed.
- `scripts/notice-board/verify-04-publish.sql` reports `ROLLBACK_OK` — preview and publish agree, publishing is idempotent, and a teacher is refused both a class they do not teach and a staff audience.
- `scripts/notice-board/verify-05-reporting.sql` reports `ROLLBACK_OK` — read stamps are idempotent and a plain recipient gets no reach data.
- `npm run typecheck` fails only in the six known circulars call sites.

Phase 2 (frontend data layer) and Phase 3 (UI) are separate plan documents, written against the interfaces this phase produces.

