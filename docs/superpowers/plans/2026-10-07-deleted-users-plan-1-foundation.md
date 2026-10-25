# Deleted Users, Plan 1 of 3: Foundation (evidence, archive, capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From go-live on, every account deletion on any path is copied completely into a private archive before the cascade removes it, and the copy is proven complete. Before that, the expiring platform-log evidence about past deletions is copied into the same archive.

**Architecture:**
- A private schema `dua` holds the archive.
- One `SECURITY DEFINER` function, `dua.capture_user(uuid)`, walks the live FK graph from `auth.users`. It copies every row the delete will remove, the surviving authored rows, the rows they point at, files, traces and a person index.
- `dua.stmt_begin()` and `dua.stmt_end()` bracket each DELETE statement with `pg_stat_xact_user_tables` counters and mark each archive complete or partial.
- Three thin triggers on `auth.users` call these functions. They are installed only at go-live: tests and the every-account proof call the functions directly, so they never lock `auth.users`.
- **Attribution goes through a delete intent.** Before it calls GoTrue's `deleteUser`, `admin-operations` records who is deleting, the source and the on-request flag with a tiny service-role RPC, `public.dua_note_delete`. The capture trigger reads the newest unconsumed intent for that user from the last 10 minutes and marks it used. Deletes therefore keep GoTrue's path, its 120 s timeout and its auth audit event.
  - This corrects spec §1. A `dua_delete_user` RPC that runs the DELETE itself would run under PostgREST's `authenticator` role, which has `statement_timeout=8s` (checked on prod 2026-10-07).
  - A function-level `SET statement_timeout` cannot extend the statement already running.
- Capture starts in `best_effort` mode. Switching to `required` is Plan 2.

**Tech Stack:** Postgres 17.6 (Supabase project `gyymkgohcijeksmrzuyw`), PL/pgSQL, the Supabase Management API (`scripts/run-sql.ps1`, PAT in Windows Credential Manager), Node 22 for scripts, and the Deno edge function `admin-operations`.

**Spec:** [docs/superpowers/specs/2026-10-06-deleted-users-page-design.md](../specs/2026-10-06-deleted-users-page-design.md). Sections 1, 2, 3 (`best_effort` half), 6 (Olympiad and on-request), 7 and 9 are this plan. Sections 3 (`required`), 4, 5, 5b, 5c and the dialogs are Plan 2. Sections 8, 10 and 11 are Plan 3.

**Facts checked on prod for this plan (2026-10-07, read-only):**
- All 56 table and column names used below exist.
- `system_audit_logs.entity_id` is uuid and `dashboard_flags.subject_key` is text.
- The only partitioned table is `realtime.messages`, which is outside the closure.
- `storage.objects` has 27,356 rows and both `owner` (uuid) and `owner_id` (text).
- `auth.users` has one trigger, `on_auth_user_created`.
- The database default `statement_timeout` is 2 min; `authenticator` has 8 s; `supabase_auth_admin` has no override.
- Auth log events are `{"auth_audit_event": {"action", "actor_id", "traits": {...}, ...}}`, with timestamps like `2026-10-07T05:20:23.000000`.

## Global Constraints

- **Prod SQL** runs only through `powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile <file> -OutFile <out>`. Verify against `pg_proc`, `pg_trigger` and `information_schema`, never the migration ledger (CLAUDE.md §26).
- **Locks on `auth.users`.** Nothing in this plan adds or alters a trigger on `auth.users` except Task 8, with `SET lock_timeout = '5s'`. Never `CREATE TRIGGER` on `auth.users` inside a long test transaction: it blocks every login until the transaction ends.
- **Grants.** Every function in `dua`, and the two public RPCs, revoke `EXECUTE` from `PUBLIC`, `anon` and `authenticated` by name. `public.dua_note_delete` and `public.dua_cancel_delete_intent` grant `EXECUTE` to `service_role` only. Schema `dua` has no `USAGE` for `PUBLIC`, `anon` or `authenticated`.
- **Never run a heavy statement through PostgREST** (`authenticator` has an 8 s timeout). The DELETE stays in GoTrue; the RPCs only insert or update one small row per user.
- **Capture fails open in this plan:** `dua.settings.capture_mode` is `best_effort`, and a capture error never blocks a delete.
- **Olympiad accounts are skipped entirely.** Skip when the account is an `oly_students.auth_user_id`, or has a role in an Olympiad-only school (`oly_schools.is_existing_salci_school = false`), AND holds no role in any other school or with a NULL school.
- **On-request deletes** (an intent with `on_request = true`, or `salci.delete_on_request = 'on'` set by hand) store a header only, with no name, email, rows or files.
- **Never stored:**
  - from `auth.users`: `encrypted_password`, `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change_token_current`, `phone_change_token`, `reauthentication_token`;
  - every other `auth.*` table except `auth.identities`, stored as counts only;
  - `public.push_subscriptions` and `public.hybrid_pairing_tokens`, counts only;
  - every column in `dua.column_policy` marked `exclude`;
  - any column matching the sensitive name pattern without an explicit `keep`.
- **Evidence files contain emails.** They live under `D:/Salci Projects/Salci-Main-Portal/salci-evidence/`, never in the repo or the scratchpad.
- **No em-dashes** in user-facing text. Code comments and docs are exempt.

## Review Focus

1. **A multi-user `DELETE` statement** (SQL cleanup deleting two people who share rows, such as a conversation) must archive both and mark both complete, without double-counting shared rows. Test: Task 6, step 1, case T6.
2. **A delete intent left behind** must never name the wrong person: an admin's delete that failed, then the same account deleted later from the dashboard or SQL. The archive must say "no app actor", not that admin. Test: Task 6, step 1, case T2b (stale and cancelled intents). Accounts with nothing but a profile are covered by the every-account proof in Task 7.
3. **A capture that throws in `best_effort` mode** must still let the delete happen, and must leave a `capture_failed` header naming the error. Test: Task 6, step 1, case T5.
4. **An Olympiad login must never be archived, and a SALCI account must never be skipped,** including a SALCI student who is also in the Olympiad. Test: Task 6, step 1, cases T3 and T3b.
5. **No credential ever reaches the archive.** That covers auth token columns, push keys and bank fields, including a brand-new table someone adds later with a `*_token` column. Test: Task 6, step 1, cases T7 and T7b; Task 2, step 4 (guard).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261007120000_dua_schema.sql` | Schema, tables (including `dua.delete_intents`), lockdown, seeds: settings, viewers, column policy, table modes, file columns, expected side effects. |
| `supabase/migrations/20261007120100_dua_capture.sql` | Helper functions, `dua.delete_context`, `dua.capture_user`, `dua.capture_guarded`, `dua.stmt_begin` and `dua.stmt_end`, the trigger functions, `public.dua_note_delete` and `public.dua_cancel_delete_intent`. Creates no triggers. |
| `supabase/migrations/20261007120200_dua_triggers.sql` | The three triggers on `auth.users` (Task 8 only). |
| `scripts/dua/mgmt-get.ps1` | Read-only Management API GET with the stored PAT. |
| `scripts/dua/harvest-platform-logs.cjs` | Copies 91 days of auth audit and function-log deletion evidence to NDJSON. |
| `scripts/dua/load-legacy-evidence.cjs` | Loads the NDJSON into `dua.legacy_evidence`, idempotently. |
| `scripts/dua/verify-legacy-evidence.sql` | Counts by kind; distinct deleted ids. |
| `scripts/dua/test-capture.sql` | The acceptance suite. Always rolled back; calls the functions directly. |
| `scripts/dua/probe-capture-all.sql` | Rolled-back capture of one batch of accounts (template with `__OFFSET__` / `__LIMIT__`). |
| `scripts/dua/run-probe.sh` | Runs every batch and prints a summary. |
| `supabase/functions/admin-operations/index.ts` | Notes a delete intent before each GoTrue delete, and cancels it on failure (Task 9). |
| `.claude/CLAUDE.md` (§31) and `.claude/skills/prod-operations/SKILL.md` | Documentation (Task 10). |

---

### Task 1: Archive schema and the expiring evidence

The log store keeps 90 days and loses a day every day, so this task goes first. It creates the archive schema, including `dua.legacy_evidence`, harvests the logs, and loads them.

**Files:**
- Create: `supabase/migrations/20261007120000_dua_schema.sql`
- Create: `scripts/dua/mgmt-get.ps1`, `scripts/dua/harvest-platform-logs.cjs`, `scripts/dua/load-legacy-evidence.cjs`, `scripts/dua/verify-legacy-evidence.sql`

**Interfaces:**
- Produces these tables: `dua.settings`, `dua.users`, `dua.rows`, `dua.links`, `dua.refs`, `dua.files`, `dua.traces`, `dua.people_index`, `dua.legacy_evidence`, `dua.viewers`, `dua.column_policy`, `dua.table_mode`, `dua.file_columns`, `dua.expected_side_effects`, `dua.delete_intents`.
- Every later task uses these exact column names.

- [ ] **Step 1: Write the schema migration**

`supabase/migrations/20261007120000_dua_schema.sql`:

```sql
-- =============================================================
-- Deleted-user archive (dua), part 1: storage.
-- Spec: docs/superpowers/specs/2026-10-06-deleted-users-page-design.md
-- Private schema. Never exposed to PostgREST, and no privileges for
-- PUBLIC, anon or authenticated. Readers come in Plan 3 as SECURITY DEFINER
-- RPCs gated on dua.viewers (team@salci.in only). No FKs to live tables,
-- so no cascade can reach the archive.
-- =============================================================
CREATE SCHEMA IF NOT EXISTS dua;
REVOKE ALL ON SCHEMA dua FROM PUBLIC;
REVOKE ALL ON SCHEMA dua FROM anon, authenticated;

CREATE TABLE dua.settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  capture_mode text NOT NULL DEFAULT 'best_effort' CHECK (capture_mode IN ('best_effort', 'required')),
  authored_snapshot_cap integer NOT NULL DEFAULT 2000 CHECK (authored_snapshot_cap >= 0),
  ref_depth integer NOT NULL DEFAULT 2 CHECK (ref_depth BETWEEN 0 AND 3),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO dua.settings DEFAULT VALUES ON CONFLICT DO NOTHING;

CREATE TABLE dua.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('captured', 'on_request', 'capture_failed', 'legacy', 'roster_witness')),
  full_name text, email text, phone text, admission_number text, roll_number text, avatar_path text,
  roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  institution_id uuid, institution_name text,
  class_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  wings jsonb NOT NULL DEFAULT '[]'::jsonb,
  account_created_at timestamptz, last_sign_in_at timestamptz, last_active_at timestamptz,
  deleted_at timestamptz, deleted_at_min timestamptz, deleted_at_max timestamptz,
  deleted_by uuid, deleted_by_name text, deleted_by_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL,
  source_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_complete boolean,
  completeness jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  field_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  live_again_user_id uuid,
  is_test_account boolean NOT NULL DEFAULT false,
  total_rows integer NOT NULL DEFAULT 0,
  stmt_token text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dua_users_deleted_at_idx ON dua.users (deleted_at DESC NULLS LAST);
CREATE INDEX dua_users_user_id_idx ON dua.users (user_id);
CREATE INDEX dua_users_institution_idx ON dua.users (institution_id);

CREATE TABLE dua.rows (
  archive_id uuid NOT NULL REFERENCES dua.users(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('rows', 'counts')),
  row_count integer NOT NULL,
  row_pks text[] NOT NULL,
  rows jsonb,
  PRIMARY KEY (archive_id, table_name)
);

CREATE TABLE dua.links (
  archive_id uuid NOT NULL REFERENCES dua.users(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  column_name text NOT NULL,
  references_table text NOT NULL,
  row_count integer NOT NULL,
  row_pks jsonb NOT NULL,
  snapshots jsonb,
  PRIMARY KEY (archive_id, table_name, column_name)
);

CREATE TABLE dua.refs (
  archive_id uuid NOT NULL REFERENCES dua.users(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  row_pk text NOT NULL,
  depth integer NOT NULL,
  row jsonb NOT NULL,
  PRIMARY KEY (archive_id, table_name, row_pk)
);

CREATE TABLE dua.files (
  id bigserial PRIMARY KEY,
  archive_id uuid NOT NULL REFERENCES dua.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  raw_value text,
  bucket text, path text, size_bytes bigint, mime text
);
CREATE INDEX dua_files_archive_idx ON dua.files (archive_id);

CREATE TABLE dua.traces (
  id bigserial PRIMARY KEY,
  archive_id uuid NOT NULL REFERENCES dua.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  payload jsonb NOT NULL
);
CREATE INDEX dua_traces_archive_idx ON dua.traces (archive_id);

CREATE TABLE dua.people_index (
  archive_id uuid NOT NULL REFERENCES dua.users(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  row_pk text NOT NULL,
  person_id uuid NOT NULL,
  PRIMARY KEY (archive_id, table_name, row_pk, person_id)
);
CREATE INDEX dua_people_index_person_idx ON dua.people_index (person_id);

CREATE TABLE dua.legacy_evidence (
  id bigserial PRIMARY KEY,
  source text NOT NULL,
  kind text NOT NULL,
  event_at timestamptz,
  subject_user_id uuid,
  actor_user_id uuid,
  email text,
  payload jsonb NOT NULL,
  payload_md5 text GENERATED ALWAYS AS (md5(payload::text)) STORED,
  harvested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, kind, payload_md5)
);
CREATE INDEX dua_legacy_subject_idx ON dua.legacy_evidence (subject_user_id);

CREATE TABLE dua.viewers (
  user_id uuid PRIMARY KEY,
  note text,
  added_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO dua.viewers (user_id, note)
SELECT u.id, 'team@salci.in (Tushar, decision 6)' FROM auth.users u WHERE u.email = 'team@salci.in'
ON CONFLICT DO NOTHING;

-- Per-column decisions for sensitive-looking columns ('exclude' = never archived).
CREATE TABLE dua.column_policy (
  table_name text NOT NULL,
  column_name text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('exclude', 'keep')),
  reason text NOT NULL,
  PRIMARY KEY (table_name, column_name)
);
INSERT INTO dua.column_policy (table_name, column_name, decision, reason) VALUES
  ('auth.users', 'encrypted_password', 'exclude', 'password hash'),
  ('auth.users', 'confirmation_token', 'exclude', 'credential'),
  ('auth.users', 'recovery_token', 'exclude', 'credential'),
  ('auth.users', 'email_change_token_new', 'exclude', 'credential'),
  ('auth.users', 'email_change_token_current', 'exclude', 'credential'),
  ('auth.users', 'phone_change_token', 'exclude', 'credential'),
  ('auth.users', 'reauthentication_token', 'exclude', 'credential'),
  ('public.staff_salary_assignments', 'bank_account_number', 'exclude', 'bank detail'),
  ('public.staff_salary_assignments', 'ifsc_code', 'exclude', 'bank detail'),
  ('public.staff_salary_assignments', 'pan_number', 'exclude', 'tax id'),
  ('public.biometric_enrollments', 'fingerprint_template', 'exclude', 'biometric'),
  ('public.face_enrollments', 'face_descriptor', 'exclude', 'biometric'),
  ('public.push_devices', 'token', 'exclude', 'push credential'),
  ('public.hybrid_answer_sheet_pages', 'device_fingerprint', 'exclude', 'device identifier'),
  ('public.ptm_booking_meet', 'meet_uri', 'exclude', 'meeting access link'),
  ('public.ptm_booking_meet', 'meet_space_id', 'exclude', 'meeting access id'),
  ('public.oly_batches', 'pin', 'exclude', 'exam PIN'),
  ('public.hybrid_pairing_tokens', 'short_code', 'exclude', 'pairing credential'),
  ('public.user_google_accounts', 'google_email', 'keep', 'linked account email, needed to identify the account'),
  ('public.profiles', 'password_expires_at', 'keep', 'timestamp, not a secret'),
  ('public.profiles', 'password_set_at', 'keep', 'timestamp, not a secret'),
  ('public.profiles', 'last_password_change', 'keep', 'timestamp, not a secret'),
  ('public.profiles', 'must_reset_password', 'keep', 'flag, not a secret');

CREATE TABLE dua.table_mode (
  table_name text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('rows', 'counts')),
  reason text NOT NULL
);
INSERT INTO dua.table_mode (table_name, mode, reason) VALUES
  ('public.push_subscriptions', 'counts', 'browser push keys'),
  ('public.hybrid_pairing_tokens', 'counts', 'pairing credentials');

CREATE TABLE dua.file_columns (
  table_name text NOT NULL,
  column_name text NOT NULL,
  shape text NOT NULL CHECK (shape IN ('path', 'url', 'json')),
  PRIMARY KEY (table_name, column_name)
);
INSERT INTO dua.file_columns (table_name, column_name, shape) VALUES
  ('public.profiles', 'avatar_path', 'path'),
  ('public.homework_submission_files', 'storage_path', 'path'),
  ('public.homework_assignments', 'attachment_path', 'path'),
  ('public.ptm_feedback', 'audio_path', 'path'),
  ('public.staff_documents', 'file_path', 'path'),
  ('public.task_comments', 'audio_url', 'url'),
  ('public.task_evidence', 'file_url', 'url'),
  ('public.ocr_uploads', 'file_url', 'url'),
  ('public.hybrid_answer_sheet_pages', 'storage_path', 'path'),
  ('public.hybrid_proctoring_snapshots', 'storage_path', 'path'),
  ('public.proctoring_events', 'screenshot_url', 'url'),
  ('public.proctoring_sessions', 'video_recording_url', 'url'),
  ('public.proctoring_sessions', 'audio_recording_url', 'url'),
  ('public.student_exam_attempts', 'answer_sheet_url', 'url'),
  ('public.student_answers', 'answer_file_url', 'url'),
  ('public.face_enrollments', 'photo_url', 'url'),
  ('public.passport_olympiad_entries', 'result_pdf_path', 'path'),
  ('public.passport_olympiad_entries', 'certificate_pdf_path', 'path'),
  ('public.conversation_messages', 'attachment_url', 'url'),
  ('public.notices', 'attachments', 'json');

-- Rows a delete removes that are NOT the deleted person's own (trigger side effects).
CREATE TABLE dua.expected_side_effects (
  table_name text PRIMARY KEY,
  reason text NOT NULL
);
INSERT INTO dua.expected_side_effects (table_name, reason) VALUES
  ('public.ptm_notifications_sent', 'tg_ptm_online_participant_removed deletes other students'' ptm_online_invited rows when a teacher is deleted');

-- Who is deleting, written by admin-operations (via public.dua_note_delete) just
-- before GoTrue's deleteUser, and consumed by the capture trigger. Only intents
-- younger than 10 minutes, and neither consumed nor cancelled, are ever read.
CREATE TABLE dua.delete_intents (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  actor_id uuid,
  source text NOT NULL,
  on_request boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  cancelled_at timestamptz,
  archive_id uuid
);
CREATE INDEX dua_delete_intents_user_idx ON dua.delete_intents (user_id, created_at DESC);

-- Defence in depth: RLS on, no policies. Only the owner (postgres) and BYPASSRLS roles read.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['settings','users','rows','links','refs','files','traces','people_index','legacy_evidence',
                           'viewers','column_policy','table_mode','file_columns','expected_side_effects','delete_intents'] LOOP
    EXECUTE format('ALTER TABLE dua.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON dua.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA dua FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 2: Apply it and verify the lockdown**

Run:
```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20261007120000_dua_schema.sql -OutFile "$TEMP/dua1.json"
```

Then run this verification as `scratch/v1.sql`:

```sql
SELECT 'tables' AS k, count(*)::text AS v FROM information_schema.tables WHERE table_schema = 'dua'
UNION ALL SELECT 'grants_to_anon_auth_public', count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'dua' AND grantee IN ('anon','authenticated','PUBLIC')
UNION ALL SELECT 'schema_usage_anon', has_schema_privilege('anon', 'dua', 'USAGE')::text
UNION ALL SELECT 'schema_usage_authenticated', has_schema_privilege('authenticated', 'dua', 'USAGE')::text
UNION ALL SELECT 'viewer_is_team', (SELECT count(*)::text FROM dua.viewers v JOIN auth.users u ON u.id = v.user_id WHERE u.email = 'team@salci.in');
```

Expected: `tables` 15, `grants_to_anon_auth_public` 0, both `schema_usage` values false, `viewer_is_team` 1.

- [ ] **Step 3: Write the read-only GET helper**

`scripts/dua/mgmt-get.ps1`:

```powershell
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$OutFile
)
# Read-only GET against the Supabase Management API, using the PAT stored in
# Windows Credential Manager (target "Supabase CLI:supabase", same lookup as
# scripts/run-sql.ps1). Writes the raw body to OutFile and prints the HTTP status.
$ErrorActionPreference = "Stop"
$sig = @"
using System;
using System.Runtime.InteropServices;
public class CredManDua {
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr credPtr);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'CredManDua').Type) { Add-Type -TypeDefinition $sig -Language CSharp }
$ptr = [IntPtr]::Zero
if (-not [CredManDua]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) { throw "Credential 'Supabase CLI:supabase' not found" }
try {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CredManDua+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  $pat = [System.Text.Encoding]::UTF8.GetString($bytes).Trim()
} finally { [CredManDua]::CredFree($ptr) }
try {
  $resp = Invoke-WebRequest -Uri ("https://api.supabase.com" + $Path) -Method Get -Headers @{ Authorization = "Bearer $pat" } -UseBasicParsing
  [System.IO.File]::WriteAllText($OutFile, $resp.Content, [System.Text.Encoding]::UTF8)
  Write-Output "HTTP $($resp.StatusCode)"
} catch {
  $msg = ""; if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $msg = $_.ErrorDetails.Message }
  [System.IO.File]::WriteAllText($OutFile, $msg, [System.Text.Encoding]::UTF8)
  $r = $_.Exception.Response
  if ($r) { Write-Output "HTTP ERROR $([int]$r.StatusCode)" } else { Write-Output "ERROR $($_.Exception.Message)" }
}
```

- [ ] **Step 4: Write the harvester**

`scripts/dua/harvest-platform-logs.cjs`:

```js
// Copies the platform-log evidence about deleted users before it expires.
// The log store keeps a rolling 90 days and each query covers at most 24 h.
// Output is NDJSON per query in OUT_DIR. It contains emails, so it lives
// outside the repo. Read-only: GET requests only.
// Usage: node scripts/dua/harvest-platform-logs.cjs [OUT_DIR] [DAYS]
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const OUT = process.argv[2] || "D:/Salci Projects/Salci-Main-Portal/salci-evidence/dua-legacy-logs";
const DAYS = Number(process.argv[3] || 91);
const REF = "gyymkgohcijeksmrzuyw";
const GET = path.join(__dirname, "mgmt-get.ps1");
const TMP = path.join(os.tmpdir(), "dua-log-response.json");

// Every query ends in an explicit LIMIT; a window that returns CAP rows is split
// in half and re-queried, so nothing is silently truncated.
const CAP = 1000;
const QUERIES = {
  auth_events:
    "select timestamp, event_message from logs where source = 'auth_audit_logs' and extract(event_message, '\"action\":\"([a-z_]+)\"') in ('user_deleted','user_signedup','user_invited','user_modified','user_repeated_signup','user_updated_password','user_recovery_requested') limit " + CAP,
  auth_activity:
    "select extract(event_message, '\"actor_id\":\"([0-9a-f-]{36})\"') as uid, toString(max(timestamp)) as last_at, count(*) as n from logs where source = 'auth_audit_logs' and extract(event_message, '\"action\":\"([a-z_]+)\"') in ('login','token_refreshed') group by uid limit " + CAP,
  function_deletes:
    "select timestamp, event_message from logs where source = 'function_logs' and positionCaseInsensitive(event_message, 'delet') > 0 limit " + CAP,
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function query(sql, start, end) {
  const p = `/v1/projects/${REF}/analytics/endpoints/logs?sql=${encodeURIComponent(sql)}` +
    `&iso_timestamp_start=${encodeURIComponent(start.toISOString())}&iso_timestamp_end=${encodeURIComponent(end.toISOString())}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const status = execFileSync("powershell", ["-NoProfile", "-File", GET, "-Path", p, "-OutFile", TMP]).toString().trim();
    const body = fs.readFileSync(TMP, "utf8").replace(/^\uFEFF/, "");
    if (status.startsWith("HTTP 2")) {
      const json = JSON.parse(body);
      if (json.error) throw new Error(`${start.toISOString()} ${JSON.stringify(json.error).slice(0, 300)}`);
      return json.result || [];
    }
    sleep(4000 * attempt); // throttled or transient
  }
  throw new Error(`log query failed 3 times for ${start.toISOString()}`);
}

function harvestWindow(name, sql, start, end, out) {
  const rows = query(sql, start, end);
  sleep(1200);
  if (rows.length >= CAP) {
    if (end - start <= 60 * 1000) throw new Error(`${name}: ${CAP}+ rows in one minute at ${start.toISOString()}; lower the split floor`);
    const mid = new Date(start.getTime() + (end - start) / 2);
    return harvestWindow(name, sql, start, mid, out) + harvestWindow(name, sql, mid, end, out);
  }
  for (const r of rows) out.write(JSON.stringify({ query: name, window_start: start.toISOString(), ...r }) + "\n");
  return rows.length;
}

fs.mkdirSync(OUT, { recursive: true });
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const totals = {};
for (const [name, sql] of Object.entries(QUERIES)) {
  const out = fs.createWriteStream(path.join(OUT, `${name}.ndjson`), { flags: "w" });
  totals[name] = 0;
  for (let d = DAYS; d >= 0; d--) {
    const start = new Date(today.getTime() - d * 86400000);
    const end = new Date(Math.min(start.getTime() + 86400000, now.getTime()));
    if (end <= start) continue;
    totals[name] += harvestWindow(name, sql, start, end, out);
    process.stdout.write(`\r${name} ${start.toISOString().slice(0, 10)} rows=${totals[name]}   `);
  }
  out.end();
  process.stdout.write("\n");
}
console.log(JSON.stringify({ out: OUT, days: DAYS, totals }));
```

- [ ] **Step 5: Run the harvest**

Run it in the background, since it takes about 15 to 25 minutes:
```bash
node scripts/dua/harvest-platform-logs.cjs
```

Expected:
- the final line is `{"out": ..., "totals": {"auth_events": N1, "auth_activity": N2, "function_deletes": N3}}`, with N1 > 400, N2 > 1000 and N3 > 100;
- there is no "failed 3 times" error;
- the three `.ndjson` files exist in `salci-evidence/dua-legacy-logs/`.

- [ ] **Step 6: Write the loader**

`scripts/dua/load-legacy-evidence.cjs`:

```js
// Loads the harvested NDJSON into dua.legacy_evidence. Idempotent: the table
// is UNIQUE (source, kind, payload_md5) and inserts use ON CONFLICT DO NOTHING,
// so re-running after a new harvest only adds new evidence.
// Usage: node scripts/dua/load-legacy-evidence.cjs [IN_DIR]
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const IN = process.argv[2] || "D:/Salci Projects/Salci-Main-Portal/salci-evidence/dua-legacy-logs";
const REPO = path.resolve(__dirname, "..", "..");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function ts(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return new Date(n > 1e14 ? n / 1000 : n > 1e11 ? n : n * 1000).toISOString(); // micro-, milli- or seconds
  }
  const d = new Date(String(v).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1") + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? "" : "Z"));
  return isNaN(d) ? null : d.toISOString();
}

function* records(file, map) {
  const p = path.join(IN, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rec = map(JSON.parse(line));
    if (rec) yield rec;
  }
}

const all = [
  ...records("auth_events.ndjson", (r) => {
    let msg; try { msg = JSON.parse(r.event_message); } catch { msg = { raw: r.event_message }; }
    const ev = msg.auth_audit_event || {};
    return {
      source: "auth_audit_logs", kind: ev.action || "unknown", event_at: ts(r.timestamp) || ts(ev.created_at),
      subject_user_id: (ev.traits && ev.traits.user_id) || null, actor_user_id: UUID.test(ev.actor_id || "") ? ev.actor_id : null,
      email: (ev.traits && ev.traits.user_email) || null, payload: msg,
    };
  }),
  ...records("auth_activity.ndjson", (r) => UUID.test(r.uid || "") ? {
    source: "auth_audit_logs", kind: "auth_activity", event_at: ts(r.last_at),
    subject_user_id: r.uid, actor_user_id: null, email: null, payload: { day: r.window_start.slice(0, 10), n: Number(r.n), last_at: r.last_at },
  } : null),
  ...records("function_deletes.ndjson", (r) => {
    const m = String(r.event_message || "");
    const by = m.match(/by user:\s*([0-9a-f-]{36})/i);
    const subj = m.match(/(?:Deleting user|deleted user|delete user)\D{0,12}([0-9a-f-]{36})/i);
    return {
      source: "function_logs", kind: "function_log", event_at: ts(r.timestamp),
      subject_user_id: subj ? subj[1] : null, actor_user_id: by ? by[1] : null, email: null,
      payload: { message: m, timestamp: r.timestamp },
    };
  }),
];

const BATCH = 300;
let loaded = 0;
for (let i = 0; i < all.length; i += BATCH) {
  const json = JSON.stringify(all.slice(i, i + BATCH));
  if (json.includes("$dua_json$")) throw new Error("payload contains the dollar-quote tag");
  const sql = `INSERT INTO dua.legacy_evidence (source, kind, event_at, subject_user_id, actor_user_id, email, payload)
SELECT x.source, x.kind, x.event_at, x.subject_user_id, x.actor_user_id, x.email, x.payload
FROM jsonb_to_recordset($dua_json$${json}$dua_json$::jsonb)
  AS x(source text, kind text, event_at timestamptz, subject_user_id uuid, actor_user_id uuid, email text, payload jsonb)
ON CONFLICT (source, kind, payload_md5) DO NOTHING;`;
  const f = path.join(os.tmpdir(), `dua-load-${i}.sql`);
  fs.writeFileSync(f, sql, "utf8");
  const out = path.join(os.tmpdir(), `dua-load-${i}.json`);
  execFileSync("powershell", ["-NoProfile", "-File", path.join(REPO, "scripts", "run-sql.ps1"), "-SqlFile", f, "-OutFile", out], { cwd: REPO });
  const body = fs.readFileSync(out, "utf8").replace(/^\uFEFF/, "");
  if (body.includes('"message"')) throw new Error(`batch ${i}: ${body.slice(0, 400)}`);
  loaded += Math.min(BATCH, all.length - i);
  process.stdout.write(`\rloaded ${loaded}/${all.length}   `);
}
console.log(`\ndone: ${all.length} records offered`);
```

- [ ] **Step 7: Load and verify**

Run:
```bash
node scripts/dua/load-legacy-evidence.cjs
```

Then `scripts/dua/verify-legacy-evidence.sql`:

```sql
-- READ-ONLY: what the archive now holds from the platform logs
SELECT source, kind, count(*) AS rows, count(DISTINCT subject_user_id) AS people,
       min(event_at) AS first, max(event_at) AS last,
       count(*) FILTER (WHERE email IS NOT NULL) AS with_email
FROM dua.legacy_evidence GROUP BY source, kind ORDER BY source, kind;
```

Expected:
- `auth_audit_logs/user_deleted` has `people` ≥ 430 (444 distinct on 2026-10-06; a few days roll off) and `with_email` equal to `rows`;
- `auth_activity` has more than 1,000 rows;
- `function_logs/function_log` has rows on 2026-09-02.

Re-running the loader adds 0 rows, which shows it is idempotent.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261007120000_dua_schema.sql scripts/dua/mgmt-get.ps1 scripts/dua/harvest-platform-logs.cjs scripts/dua/load-legacy-evidence.cjs scripts/dua/verify-legacy-evidence.sql
git commit -m "feat(dua): archive schema, and the expiring platform-log evidence copied into it"
```

---

### Task 2: Policy helpers and the sensitive-column guard

**Files:**
- Create: `supabase/migrations/20261007120100_dua_capture.sql` (the first section, which Tasks 3 to 5 append to)

**Interfaces:**
- Produces:
  - `dua.sensitive_pattern() returns text`
  - `dua.drop_cols(_tbl oid) returns text[]`
  - `dua.strip_row(_tbl oid, _row jsonb) returns jsonb`
  - `dua.strip_rows(_tbl oid, _rows jsonb) returns jsonb`
  - `dua.is_counts_only(_tbl oid) returns boolean`
  - `dua.pk_cols(_tbl oid) returns text[]`
  - `dua.pk_expr(_tbl oid, _alias text) returns text`
  - `dua.fk_match(_alias text, _cols text[], _src_cols text[], _types text[]) returns text`
  - `dua.file_values(_v jsonb) returns setof text`
  - `dua.session_source() returns text`
  - `dua.is_olympiad_account(_user uuid) returns boolean`
  - `dua.unclassified_sensitive_columns() returns table(table_name text, column_name text)`

- [ ] **Step 1: Write the helpers**

These start `supabase/migrations/20261007120100_dua_capture.sql`:

```sql
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
```

- [ ] **Step 2: Apply the helpers**

Apply the file as it stands. It is idempotent: `CREATE OR REPLACE` throughout.

```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20261007120100_dua_capture.sql -OutFile "$TEMP/dua2.json"
```

Expected: `[]`.

- [ ] **Step 3: Run the guard. It should fail first (find unclassified columns)**

```sql
SELECT * FROM dua.unclassified_sensitive_columns();
```

Expected the first time: a list such as `ai_usage_logs.tokens_used` (numbers) or `oauth` columns. Each one is a real decision.

- [ ] **Step 4: Classify every reported column, then re-run until 0 rows**

For each row from step 3, append one line to the `dua.column_policy` seed in `20261007120000_dua_schema.sql`:
- `exclude` with a reason, when the value is a secret or credential;
- `keep` with a reason, when it is harmless, such as a count of AI tokens used or a timestamp.

Insert the same rows on prod with the same statement, then re-run step 3.

Expected: 0 rows.

- [ ] **Step 5: Unit-check the helpers (rolled back)**

```sql
BEGIN;
SELECT
  dua.pk_expr('public.profiles'::regclass, 'c') = 'concat_ws(''|'', c.id::text)' AS pk_ok,
  dua.fk_match('c', ARRAY['student_id'], ARRAY['id'], ARRAY['uuid']) = '(c.student_id) IN (SELECT (x->>''id'')::uuid FROM jsonb_array_elements($1) x)' AS fk_ok,
  'encrypted_password' = ANY (dua.drop_cols('auth.users'::regclass)) AS strips_password,
  NOT ('email' = ANY (dua.drop_cols('auth.users'::regclass))) AS keeps_email,
  dua.is_counts_only('auth.sessions'::regclass) AS sessions_counts,
  NOT dua.is_counts_only('auth.identities'::regclass) AS identities_rows,
  (SELECT count(*) FROM dua.file_values('["a/b.pdf", {"path":"c/d.png"}]'::jsonb)) = 2 AS files_ok,
  (SELECT count(*) FROM auth.users u WHERE dua.is_olympiad_account(u.id)) AS olympiad_skipped,
  -- Independent count, written without the function: Olympiad login OR any role in an
  -- Olympiad-only school, minus everyone with a role elsewhere or with no school.
  (WITH oo AS (SELECT institution_id FROM public.oly_schools WHERE is_existing_salci_school = false AND institution_id IS NOT NULL),
        cand AS (SELECT auth_user_id AS id FROM public.oly_students WHERE auth_user_id IS NOT NULL
                 UNION SELECT user_id FROM public.user_roles WHERE institution_id IN (SELECT institution_id FROM oo)),
        other AS (SELECT user_id AS id FROM public.user_roles
                   WHERE institution_id IS NULL OR institution_id NOT IN (SELECT institution_id FROM oo))
   SELECT count(*) FROM auth.users u WHERE u.id IN (SELECT id FROM cand) AND u.id NOT IN (SELECT id FROM other)) AS olympiad_independent,
  (SELECT count(*) FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id
     WHERE dua.is_olympiad_account(u.id)
       AND r.institution_id NOT IN (SELECT institution_id FROM public.oly_schools WHERE is_existing_salci_school = false AND institution_id IS NOT NULL)) AS salci_role_skipped;
ROLLBACK;
```

Expected:
- every boolean is `true`;
- `olympiad_skipped` equals `olympiad_independent`, and is close to the research figure (205 Olympiad logins and 229 Olympiad-only role holders, overlapping, on 2026-10-06);
- `salci_role_skipped` is 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261007120000_dua_schema.sql supabase/migrations/20261007120100_dua_capture.sql
git commit -m "feat(dua): column policy, sensitive-column guard, Olympiad skip rule and walk helpers"
```

---

### Task 3: `dua.capture_user`: header, walk, rows

**Files:**
- Modify: `supabase/migrations/20261007120100_dua_capture.sql` (append)

**Interfaces:**
- Consumes: all Task 2 helpers.
- Produces:
  - `dua.delete_context(_user uuid) returns jsonb`, shaped `{actor uuid|null, source text, on_request boolean, intent_id bigint|null}`. Resolution order:
    1. a hand-set `salci.delete_source` setting (the SQL path);
    2. otherwise the newest live intent in `dua.delete_intents`;
    3. otherwise `dua.session_source()`.
    `salci.delete_on_request = 'on'` is honoured when no intent supplies the flag.
  - `dua.capture_user(_user uuid, _ctx jsonb) returns uuid`: the archive id, or NULL for an Olympiad account.
    - Writes `dua.users`, `dua.rows`, `dua.links`, `dua.refs`, `dua.files`, `dua.traces` and `dua.people_index`.
    - Appends the archive id to the transaction setting `dua.stmt_archives`.
    - Reads `dua.test_fail` (test hook).
    - Does not consume the intent; `capture_guarded` (Task 5) does that, outside the failure boundary.
  - Temp tables `pg_temp.dua_walk`, `pg_temp.dua_fk` and `pg_temp.dua_ref`, all `ON COMMIT DROP`.

- [ ] **Step 1: Append the context resolver and the capture function**

```sql
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

  -- Steps 5 to 9 are appended by Task 4 (links, refs, files, traces, people index).

  UPDATE dua.users SET total_rows = (SELECT coalesce(sum(x.row_count), 0) FROM dua.rows x WHERE x.archive_id = v_archive)
  WHERE id = v_archive;
  PERFORM set_config('dua.stmt_archives',
                     concat_ws(',', nullif(current_setting('dua.stmt_archives', true), ''), v_archive::text), true);
  RETURN v_archive;
END $$;

REVOKE EXECUTE ON FUNCTION dua.capture_user(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION dua.delete_context(uuid) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 2: Apply, then run a failing-then-passing check on a heavy student (rolled back)**

`scratch/t3.sql`:

```sql
BEGIN;
DO $$
DECLARE v_user uuid; v_arch uuid; v_ans integer; v_attempts integer; v_rows integer;
BEGIN
  SELECT a.student_id INTO v_user FROM public.student_exam_attempts a
  GROUP BY a.student_id ORDER BY count(*) DESC LIMIT 1;
  SELECT count(*) INTO v_attempts FROM public.student_exam_attempts WHERE student_id = v_user;
  SELECT count(*) INTO v_ans FROM public.student_answers sa JOIN public.student_exam_attempts a ON a.id = sa.attempt_id WHERE a.student_id = v_user;
  v_arch := dua.capture_user(v_user, dua.delete_context(v_user));
  SELECT row_count INTO v_rows FROM dua.rows WHERE archive_id = v_arch AND table_name = 'public.student_answers';
  RAISE EXCEPTION 'RESULT attempts=% archived_attempts=% answers=% archived_answers=% password_absent=%',
    v_attempts, (SELECT row_count FROM dua.rows WHERE archive_id = v_arch AND table_name = 'public.student_exam_attempts'),
    v_ans, v_rows,
    NOT EXISTS (SELECT 1 FROM dua.rows WHERE archive_id = v_arch AND table_name = 'auth.users' AND rows::text LIKE '%encrypted_password%');
END $$;
ROLLBACK;
```

Expected: the error text reads `RESULT attempts=N archived_attempts=N answers=M archived_answers=M password_absent=true`, with matching N and M.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261007120100_dua_capture.sql
git commit -m "feat(dua): capture_user header, cascade walk and stripped row images"
```

---

### Task 4: Links, referenced rows, files, traces and the people index

**Files:**
- Modify: `supabase/migrations/20261007120100_dua_capture.sql`. Replace the comment line `-- Steps 5 to 9 are appended by Task 4 (...)` inside `dua.capture_user` with the block below.

**Interfaces:**
- Consumes: the `pg_temp.dua_walk` and `pg_temp.dua_fk` tables and the Task 2 helpers.
- Produces: rows in `dua.links`, `dua.refs`, `dua.files`, `dua.traces` and `dua.people_index` for the archive.

- [ ] **Step 1: Insert steps 5 to 9 into `capture_user`**

```sql
  -- 5. Surviving rows whose link to a deleted row will be cleared (ON DELETE SET NULL / SET DEFAULT).
  FOR f IN
    SELECT k.* FROM pg_temp.dua_fk k
    WHERE k.deltype IN ('n', 'd') AND k.parent IN (SELECT DISTINCT w.tbl FROM pg_temp.dua_walk w)
  LOOP
    SELECT jsonb_agg(w.row) INTO v_parents FROM pg_temp.dua_walk w WHERE w.tbl = f.parent;
    EXECUTE format(
      'SELECT count(*), coalesce(jsonb_agg(%s), ''[]''::jsonb) FROM %s c
        WHERE %s AND NOT EXISTS (SELECT 1 FROM pg_temp.dua_walk w2 WHERE w2.tbl = %s::oid AND w2.pk = %s)',
      dua.pk_expr(f.child, 'c'), f.child::regclass, dua.fk_match('c', f.child_cols, f.parent_cols, f.child_types),
      f.child, dua.pk_expr(f.child, 'c'))
    INTO v_cnt, v_pks USING v_parents;
    CONTINUE WHEN v_cnt = 0;
    v_snap := NULL;
    IF v_cnt <= v_cap THEN
      EXECUTE format(
        'SELECT jsonb_agg(to_jsonb(c)) FROM %s c
          WHERE %s AND NOT EXISTS (SELECT 1 FROM pg_temp.dua_walk w2 WHERE w2.tbl = %s::oid AND w2.pk = %s)',
        f.child::regclass, dua.fk_match('c', f.child_cols, f.parent_cols, f.child_types),
        f.child, dua.pk_expr(f.child, 'c'))
      INTO v_snap USING v_parents;
      v_snap := dua.strip_rows(f.child, v_snap);
    END IF;
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
```

- [ ] **Step 2: Apply and check a teacher (rolled back)**

`scratch/t4.sql`:

```sql
BEGIN;
DO $$
DECLARE v_user uuid; v_arch uuid; v_exams bigint; v_linked bigint; v_q integer;
BEGIN
  SELECT o.evaluated_by INTO v_user FROM public.teacher_overrides o WHERE o.evaluated_by IS NOT NULL
  GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;
  SELECT count(*) INTO v_exams FROM public.exams WHERE created_by = v_user;
  v_arch := dua.capture_user(v_user, dua.delete_context(v_user));
  SELECT row_count INTO v_linked FROM dua.links WHERE archive_id = v_arch AND table_name = 'public.exams' AND column_name = 'created_by';
  SELECT count(*) INTO v_q FROM dua.refs WHERE archive_id = v_arch AND table_name = 'public.exam_questions';
  RAISE EXCEPTION 'RESULT exams=% linked=% refs_exam_questions=% people_rows=% traces=%',
    v_exams, coalesce(v_linked, 0), v_q,
    (SELECT count(*) FROM dua.people_index WHERE archive_id = v_arch),
    (SELECT count(*) FROM dua.traces WHERE archive_id = v_arch);
END $$;
ROLLBACK;
```

Expected: `exams=N linked=N`, with matching N, and `people_rows` > 0.

Then the same check for the heavy student from Task 3:
- `refs_exam_questions` > 0;
- every ref row of `public.exam_questions` contains a `question_text` key.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261007120100_dua_capture.sql
git commit -m "feat(dua): authored links, referenced rows with question text, files, traces, people index"
```

---

### Task 5: Statement bracket, guarded capture, trigger functions and the intent RPCs

**Files:**
- Modify: `supabase/migrations/20261007120100_dua_capture.sql` (append)

**Interfaces:**
- Consumes: `dua.delete_context(uuid)`, `dua.capture_user(uuid, jsonb)` (Task 3).
- Produces:
  - `dua.stmt_begin() returns void`
  - `dua.stmt_end() returns void`. It never raises: an internal error is written to `completeness.error`.
  - `dua.capture_guarded(_user uuid) returns uuid`. It resolves the context, captures, and marks the intent consumed.
  - trigger functions `dua.trg_stmt_before()`, `dua.trg_capture()` and `dua.trg_stmt_after()`
  - `public.dua_note_delete(_user_ids uuid[], _actor_id uuid, _source text default 'app', _on_request boolean default false) returns integer` (intents written; at most 2,000 ids per call)
  - `public.dua_cancel_delete_intent(_user_id uuid) returns integer` (intents cancelled)

- [ ] **Step 1: Append**

```sql
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
```

- [ ] **Step 2: Apply, then verify the grants**

```sql
SELECT p.oid::regprocedure::text AS fn, p.proacl::text AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'dua' OR p.proname IN ('dua_note_delete', 'dua_cancel_delete_intent') ORDER BY 1;
```

Expected:
- no `acl` contains `anon=`, `authenticated=` or a leading `=X/`;
- both public RPCs show `service_role=X`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261007120100_dua_capture.sql
git commit -m "feat(dua): statement completeness bracket, best_effort guard, trigger functions, delete-intent RPCs"
```

---

### Task 6: The acceptance suite (always rolled back, no DDL on `auth.users`)

**Files:**
- Create: `scripts/dua/test-capture.sql`

**Interfaces:**
- Consumes: everything from Tasks 1 to 5. It simulates the trigger sequence by calling `dua.stmt_begin()`, then `dua.capture_guarded()` for each row, then the `DELETE`, then `dua.stmt_end()`, which is exactly what the triggers will do.

- [ ] **Step 1: Write the suite**

`scripts/dua/test-capture.sql`:

```sql
-- Deleted-user archive acceptance suite. Calls the capture functions in the same
-- order the triggers will (stmt_begin, capture per row, DELETE, stmt_end) inside
-- aborted subtransactions, then rolls everything back. Creates NO trigger on
-- auth.users, so logins are never blocked. Assertions RECORD instead of raising.
-- Run: powershell -File scripts/run-sql.ps1 -SqlFile scripts/dua/test-capture.sql -OutFile "$env:TEMP\dua-test.json"
BEGIN;

CREATE TEMP TABLE t_out(n serial, result text, label text, detail text);

CREATE FUNCTION pg_temp.chk(p_pass boolean, p_label text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $chk$
BEGIN
  INSERT INTO t_out(result, label, detail)
  VALUES (CASE WHEN coalesce(p_pass, false) THEN 'PASS' ELSE 'FAIL' END, p_label, p_detail);
END $chk$;

-- Delete like the triggers will: returns the archive header(s) as jsonb, then the caller aborts.
CREATE FUNCTION pg_temp.del(p_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql AS $d$
DECLARE i uuid;
BEGIN
  PERFORM dua.stmt_begin();
  FOREACH i IN ARRAY p_ids LOOP PERFORM dua.capture_guarded(i); END LOOP;
  DELETE FROM auth.users WHERE id = ANY (p_ids);
  PERFORM dua.stmt_end();
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) FROM dua.users u WHERE u.user_id = ANY (p_ids));
END $d$;

DO $test$
DECLARE
  v jsonb; v_student uuid; v_student2 uuid; v_teacher uuid; v_oly uuid; v_team uuid;
BEGIN
  SELECT id INTO v_team FROM auth.users WHERE email = 'team@salci.in';
  SELECT a.student_id INTO v_student FROM public.student_exam_attempts a GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;
  SELECT ca2.user_id INTO v_student2 FROM public.class_assignments ca1
    JOIN public.class_assignments ca2 ON ca2.class_id = ca1.class_id AND ca2.role = 'student' AND ca2.user_id <> v_student
   WHERE ca1.user_id = v_student AND ca1.role = 'student' LIMIT 1;
  SELECT o.evaluated_by INTO v_teacher FROM public.teacher_overrides o WHERE o.evaluated_by IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;
  SELECT o.auth_user_id INTO v_oly FROM public.oly_students o WHERE o.auth_user_id IS NOT NULL LIMIT 1;

  -- T1 heavy student: captured, complete, rows match
  BEGIN
    v := pg_temp.del(ARRAY[v_student]);
    PERFORM pg_temp.chk(v->0->>'kind' = 'captured' AND (v->0->>'is_complete')::boolean, 'T1 heavy student captured and complete',
                        coalesce(v->0->>'completeness', ''));
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T1 heavy student', SQLERRM); END IF;
  END;

  -- T2 app path: the intent written by admin-operations names the actor and source, and is used up
  BEGIN
    PERFORM public.dua_note_delete(ARRAY[v_teacher], v_team, 'app', false);
    v := pg_temp.del(ARRAY[v_teacher]);
    PERFORM pg_temp.chk(v->0->>'source' = 'app' AND v->0->>'deleted_by' = v_team::text
                        AND v->0->>'deleted_by_name' IS NOT NULL AND v->0->>'kind' = 'captured'
                        AND EXISTS (SELECT 1 FROM dua.delete_intents d WHERE d.user_id = v_teacher
                                     AND d.consumed_at IS NOT NULL AND d.archive_id = (v->0->>'id')::uuid),
                        'T2 intent: actor named, source app, intent consumed', v::text);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T2 intent', SQLERRM); END IF;
  END;

  -- T2b a stale intent (older than 10 minutes) and a cancelled one are both ignored
  BEGIN
    INSERT INTO dua.delete_intents (user_id, actor_id, source, created_at)
    VALUES (v_teacher, v_team, 'app:stale', now() - interval '11 minutes');
    PERFORM public.dua_note_delete(ARRAY[v_teacher], v_team, 'app:cancelled', false);
    PERFORM public.dua_cancel_delete_intent(v_teacher);
    v := pg_temp.del(ARRAY[v_teacher]);
    PERFORM pg_temp.chk(v->0->>'source' = 'sql' AND v->0->>'deleted_by' IS NULL,
                        'T2b stale and cancelled intents never attribute a delete', v::text);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T2b stale intent', SQLERRM); END IF;
  END;

  -- T3 Olympiad login: no archive at all
  BEGIN
    v := pg_temp.del(ARRAY[v_oly]);
    PERFORM pg_temp.chk(jsonb_array_length(v) = 0, 'T3 Olympiad login skipped', v::text);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T3 Olympiad', SQLERRM); END IF;
  END;

  -- T3b a SALCI student is never skipped by the Olympiad rule
  PERFORM pg_temp.chk(NOT dua.is_olympiad_account(v_student), 'T3b SALCI student not treated as Olympiad');

  -- T4 on request: header only
  BEGIN
    PERFORM set_config('salci.delete_on_request', 'on', true);
    v := pg_temp.del(ARRAY[v_student2]);
    PERFORM pg_temp.chk(v->0->>'kind' = 'on_request' AND v->0->>'full_name' IS NULL AND v->0->>'email' IS NULL
                        AND NOT EXISTS (SELECT 1 FROM dua.rows r WHERE r.archive_id = (v->0->>'id')::uuid),
                        'T4 on-request keeps no name, email or rows', v::text);
    PERFORM set_config('salci.delete_on_request', 'off', true);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('salci.delete_on_request', 'off', true);
    IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T4 on request', SQLERRM); END IF;
  END;

  -- T5 best_effort: injected capture failure still deletes and leaves a capture_failed header
  BEGIN
    PERFORM set_config('dua.test_fail', 'on', true);
    v := pg_temp.del(ARRAY[v_student2]);
    PERFORM pg_temp.chk(v->0->>'kind' = 'capture_failed' AND v->0->>'error' LIKE '%dua test failure%'
                        AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_student2),
                        'T5 best_effort: delete proceeds, failure recorded', v::text);
    PERFORM set_config('dua.test_fail', 'off', true);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('dua.test_fail', 'off', true);
    IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T5 best_effort', SQLERRM); END IF;
  END;

  -- T5b required: the same failure aborts the delete
  BEGIN
    UPDATE dua.settings SET capture_mode = 'required';
    PERFORM set_config('dua.test_fail', 'on', true);
    BEGIN
      v := pg_temp.del(ARRAY[v_student2]);
      PERFORM pg_temp.chk(false, 'T5b required blocks the delete', 'delete went through');
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_temp.chk(SQLERRM LIKE '%dua test failure%', 'T5b required blocks the delete', SQLERRM);
    END;
    PERFORM set_config('dua.test_fail', 'off', true);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('dua.test_fail', 'off', true);
    IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T5b required', SQLERRM); END IF;
  END;

  -- T6 two classmates in ONE statement: both captured, both complete, shared rows not double-counted
  BEGIN
    v := pg_temp.del(ARRAY[v_student, v_student2]);
    PERFORM pg_temp.chk(jsonb_array_length(v) = 2
                        AND (v->0->>'is_complete')::boolean AND (v->1->>'is_complete')::boolean,
                        'T6 multi-user statement both complete', v::text);
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T6 multi-user', SQLERRM); END IF;
  END;

  -- T7 no credential anywhere in the archive
  BEGIN
    v := pg_temp.del(ARRAY[v_teacher]);
    PERFORM pg_temp.chk(NOT EXISTS (
        SELECT 1 FROM dua.rows r WHERE r.archive_id = (v->0->>'id')::uuid AND r.rows IS NOT NULL
          AND (r.rows::text ~* '"(encrypted_password|refresh_token_hmac_key|bank_account_number|pan_number|ifsc_code|fingerprint_template|face_descriptor|token)"\s*:'))
      AND NOT EXISTS (SELECT 1 FROM dua.rows r WHERE r.archive_id = (v->0->>'id')::uuid AND r.table_name LIKE 'auth.%'
                       AND r.table_name NOT IN ('auth.users', 'auth.identities') AND r.mode <> 'counts'),
      'T7 no credential columns or credential tables stored', '');
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T7 credentials', SQLERRM); END IF;
  END;

  -- T7b a new table with a *_token column is stripped even without a policy row
  BEGIN
    CREATE TABLE public.dua_t7b (id uuid PRIMARY KEY, owner uuid REFERENCES public.profiles(id) ON DELETE CASCADE, api_token text, note text);
    INSERT INTO public.dua_t7b VALUES (gen_random_uuid(), v_student, 'SECRET-123', 'kept');
    v := pg_temp.del(ARRAY[v_student]);
    PERFORM pg_temp.chk(EXISTS (SELECT 1 FROM dua.rows r WHERE r.archive_id = (v->0->>'id')::uuid AND r.table_name = 'public.dua_t7b'
                                 AND r.rows::text LIKE '%kept%' AND r.rows::text NOT LIKE '%SECRET-123%'),
                        'T7b new table captured, token column stripped', '');
    RAISE EXCEPTION 'undo';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'undo' THEN PERFORM pg_temp.chk(false, 'T7b new table', SQLERRM); END IF;
  END;

  -- T8 grants
  PERFORM pg_temp.chk(NOT has_function_privilege('authenticated', 'public.dua_note_delete(uuid[], uuid, text, boolean)', 'EXECUTE')
                      AND NOT has_function_privilege('anon', 'public.dua_note_delete(uuid[], uuid, text, boolean)', 'EXECUTE')
                      AND has_function_privilege('service_role', 'public.dua_note_delete(uuid[], uuid, text, boolean)', 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', 'public.dua_cancel_delete_intent(uuid)', 'EXECUTE')
                      AND NOT has_function_privilege('anon', 'public.dua_cancel_delete_intent(uuid)', 'EXECUTE')
                      AND has_function_privilege('service_role', 'public.dua_cancel_delete_intent(uuid)', 'EXECUTE')
                      AND NOT has_schema_privilege('authenticated', 'dua', 'USAGE')
                      AND NOT has_schema_privilege('anon', 'dua', 'USAGE'),
                      'T8 grants: only service_role writes intents; dua closed');

  -- T9 guard
  PERFORM pg_temp.chk((SELECT count(*) FROM dua.unclassified_sensitive_columns()) = 0, 'T9 no unclassified sensitive columns');
END $test$;

SELECT result, label, detail FROM t_out ORDER BY n;
ROLLBACK;
```

- [ ] **Step 2: Run the suite. Expect failures on the first run, fix, re-run until all PASS**

```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/dua/test-capture.sql -OutFile "$TEMP/dua-test.json"
```

Expected at the end: 13 rows, all `PASS` (T1, T2, T2b, T3, T3b, T4, T5, T5b, T6, T7, T7b, T8, T9).

For any `FAIL`:
- read `detail`, fix the function in `20261007120100_dua_capture.sql`, re-apply the file, and re-run;
- a mismatch in T1 or T6 that is a genuine trigger side effect (another person's row) becomes a row in `dua.expected_side_effects`, with a reason.

- [ ] **Step 3: Commit**

```bash
git add scripts/dua/test-capture.sql supabase/migrations/20261007120100_dua_capture.sql supabase/migrations/20261007120000_dua_schema.sql
git commit -m "test(dua): acceptance suite, rolled back, no DDL on auth.users"
```

---

### Task 7: Proof on every account (rolled back)

**Files:**
- Create: `scripts/dua/probe-capture-all.sql`, `scripts/dua/run-probe.sh`

- [ ] **Step 1: Write the batch template**

`scripts/dua/probe-capture-all.sql`:

```sql
-- DRY RUN, NOTHING IS WRITTEN: for each account in the batch, run the capture and
-- the real DELETE in the trigger order inside an aborted subtransaction, read the
-- archive header before the abort, and report. No DDL on auth.users.
-- Template: run-probe.sh substitutes __OFFSET__ and __LIMIT__.
BEGIN;
CREATE TEMP TABLE dua_probe (user_id uuid, outcome text, is_complete boolean, total_rows integer,
                             mismatches jsonb, ms numeric, error text);
DO $probe$
DECLARE r record; t0 timestamptz; v jsonb; st text; msg text;
BEGIN
  UPDATE dua.settings SET capture_mode = 'required';   -- surface every capture error as a failure
  FOR r IN SELECT u.id FROM auth.users u ORDER BY u.id OFFSET __OFFSET__ LIMIT __LIMIT__ LOOP
    t0 := clock_timestamp(); v := NULL;
    BEGIN
      PERFORM dua.stmt_begin();
      PERFORM dua.capture_guarded(r.id);
      DELETE FROM auth.users WHERE id = r.id;
      PERFORM dua.stmt_end();
      SELECT jsonb_build_object('kind', u.kind, 'is_complete', u.is_complete, 'total_rows', u.total_rows,
                                'mismatches', u.completeness->'mismatches')
        INTO v FROM dua.users u WHERE u.user_id = r.id ORDER BY u.created_at DESC LIMIT 1;
      RAISE EXCEPTION 'DUA_PROBE_OK';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
      INSERT INTO dua_probe VALUES (r.id,
        CASE WHEN msg <> 'DUA_PROBE_OK' THEN 'error' WHEN v IS NULL THEN 'skipped_olympiad' ELSE v->>'kind' END,
        (v->>'is_complete')::boolean, (v->>'total_rows')::integer, v->'mismatches',
        round(extract(epoch FROM clock_timestamp() - t0) * 1000, 1),
        CASE WHEN msg = 'DUA_PROBE_OK' THEN NULL ELSE st || ' ' || msg END);
    END;
  END LOOP;
END $probe$;
SELECT outcome, is_complete, count(*) AS accounts, max(ms) AS max_ms, round(avg(ms), 1) AS avg_ms,
       max(total_rows) AS max_rows,
       (array_agg(user_id ORDER BY ms DESC))[1:3] AS slowest,
       (array_agg(DISTINCT coalesce(error, mismatches::text)) FILTER (WHERE error IS NOT NULL OR is_complete = false))[1:5] AS problems
FROM dua_probe GROUP BY outcome, is_complete ORDER BY outcome, is_complete;
ROLLBACK;
```

- [ ] **Step 2: Write the runner**

`scripts/dua/run-probe.sh`:

```bash
#!/usr/bin/env bash
# Runs probe-capture-all.sql over every account in batches and prints each batch summary.
# Usage: bash scripts/dua/run-probe.sh [BATCH_SIZE]
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BATCH="${1:-100}"
TMP="$(mktemp -d)"
TOTAL=$(cd "$REPO" && printf "SELECT count(*) AS n FROM auth.users;\n" > "$TMP/count.sql" && \
  powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile "$TMP/count.sql" -OutFile "$TMP/count.json" >/dev/null && \
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,''))[0].n)" "$TMP/count.json")
echo "accounts: $TOTAL, batch: $BATCH"
for ((off = 0; off < TOTAL; off += BATCH)); do
  sed "s/__OFFSET__/$off/; s/__LIMIT__/$BATCH/" "$REPO/scripts/dua/probe-capture-all.sql" > "$TMP/batch.sql"
  start=$(date +%s)
  (cd "$REPO" && powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile "$TMP/batch.sql" -OutFile "$TMP/batch-$off.json" >/dev/null)
  echo "== offset $off ($(( $(date +%s) - start ))s)"
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,''));if(!Array.isArray(r)){console.log('  BATCH ERROR',JSON.stringify(r).slice(0,400));process.exit()}for(const x of r)console.log('  '+x.outcome+' complete='+x.is_complete+' n='+x.accounts+' max_ms='+x.max_ms+' avg_ms='+x.avg_ms+' max_rows='+x.max_rows+(x.problems?' problems='+JSON.stringify(x.problems).slice(0,600):''))" "$TMP/batch-$off.json"
done
```

- [ ] **Step 3: Run it, starting with a 100-account batch to calibrate time**

```bash
bash scripts/dua/run-probe.sh 100
```

Run this in the background, since it takes 30 to 60 minutes for about 3,400 accounts.

Expected:
- every batch shows only `captured complete=true` and `skipped_olympiad`;
- there are no `error` and no `complete=false` rows;
- `max_ms` < 10,000.

Fix the cause of anything else:
- a capture error is a code fix;
- a mismatch that is someone else's row is an `expected_side_effects` row with a reason;
- a slow account gets its plan read, and the index it needs goes on the Plan 2 index list.

Then re-run the affected batches.

- [ ] **Step 4: Commit**

```bash
git add scripts/dua/probe-capture-all.sql scripts/dua/run-probe.sh supabase/migrations/
git commit -m "test(dua): rolled-back capture proven on every account"
```

---

### Task 8: Go live: triggers on `auth.users` (`best_effort`)

**Files:**
- Create: `supabase/migrations/20261007120200_dua_triggers.sql`

- [ ] **Step 1: Write the trigger migration**

```sql
-- =============================================================
-- Deleted-user archive (dua), part 3: switch capture on, in best_effort mode.
-- Proven first by scripts/dua/test-capture.sql and scripts/dua/run-probe.sh on
-- every account. A capture error never blocks a delete in this mode (Plan 2
-- moves to 'required'). The brief lock that CREATE TRIGGER takes on
-- auth.users is bounded by lock_timeout.
-- =============================================================
SET lock_timeout = '5s';
DROP TRIGGER IF EXISTS dua_stmt_before_delete ON auth.users;
DROP TRIGGER IF EXISTS dua_capture_before_delete ON auth.users;
DROP TRIGGER IF EXISTS dua_stmt_after_delete ON auth.users;
CREATE TRIGGER dua_stmt_before_delete BEFORE DELETE ON auth.users
  FOR EACH STATEMENT EXECUTE FUNCTION dua.trg_stmt_before();
CREATE TRIGGER dua_capture_before_delete BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION dua.trg_capture();
CREATE TRIGGER dua_stmt_after_delete AFTER DELETE ON auth.users
  FOR EACH STATEMENT EXECUTE FUNCTION dua.trg_stmt_after();
```

- [ ] **Step 2: Apply it at a quiet hour, then verify the triggers**

Apply between 20:00 and 06:00 IST:

```bash
powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20261007120200_dua_triggers.sql -OutFile "$TEMP/dua3.json"
```

```sql
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname LIKE 'dua_%' ORDER BY 1;
SELECT capture_mode FROM dua.settings;
```

Expected: three rows; `capture_mode` is `best_effort`.

- [ ] **Step 3: Prove the live trigger path once (rolled back)**

```sql
BEGIN;
DO $$
DECLARE v_user uuid; v jsonb;
BEGIN
  SELECT a.student_id INTO v_user FROM public.student_exam_attempts a GROUP BY 1 ORDER BY count(*) DESC LIMIT 1;
  PERFORM public.dua_note_delete(ARRAY[v_user], (SELECT id FROM auth.users WHERE email = 'team@salci.in'), 'app', false);
  DELETE FROM auth.users WHERE id = v_user;   -- the real triggers fire
  SELECT to_jsonb(u) INTO v FROM dua.users u WHERE u.user_id = v_user;
  RAISE EXCEPTION 'RESULT kind=% complete=% rows=% source=% by=%',
    v->>'kind', v->>'is_complete', v->>'total_rows', v->>'source', v->>'deleted_by_name';
END $$;
ROLLBACK;
```

Expected: `RESULT kind=captured complete=true rows=<N> source=app by=<team@salci.in's profile name>`.

Re-run `scripts/probe-user-deletes.sql` on one batch to confirm deletes still succeed with the triggers live (its own rolled-back deletes fire capture too).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261007120200_dua_triggers.sql
git commit -m "feat(dua): capture switched on for every deletion path (best_effort)"
```

---

### Task 9: `admin-operations` notes who is deleting before each GoTrue delete

**Files:**
- Modify: `supabase/functions/admin-operations/index.ts` at three call sites, each currently `adminClient.auth.admin.deleteUser(...)`:
  - the `delete_institution` member loop (`index.ts:1347`);
  - the `delete_user` case (`index.ts:1422`);
  - the `bulk_delete_students` loop (`index.ts:1998`).

**Interfaces:**
- Consumes: `public.dua_note_delete(_user_ids uuid[], _actor_id uuid, _source text, _on_request boolean) returns integer` and `public.dua_cancel_delete_intent(_user_id uuid) returns integer` (Task 5).
- Produces: `deleteAuthUserNoted(adminClient, userId, actorId, source)`, returning `Promise<{ error: { message: string } | null }>`. That is the same error shape GoTrue returns, so the call sites keep their `error.message` lines. Plan 2 adds the on-request flag to it.

- [ ] **Step 1: Add the helper below `explainDeleteFailure`**

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deletes an auth user the same way as before (GoTrue deleteUser: 120 s budget,
 * auth audit event), after first recording WHO is deleting in dua.delete_intents,
 * so the Deleted Users archive can name them (spec 2026-10-06-deleted-users-page-design).
 * The database trigger copies everything before the cascade and uses the intent up.
 * If the delete fails, the intent is cancelled so it can never attribute a later
 * delete made another way. A failure to record the intent never blocks the delete.
 */
async function deleteAuthUserNoted(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  actorId: string,
  source: string,
): Promise<{ error: { message: string } | null }> {
  const { error: noteError } = await adminClient.rpc("dua_note_delete", {
    _user_ids: [userId],
    _actor_id: UUID_RE.test(actorId) ? actorId : null,
    _source: source,
    _on_request: false,
  });
  if (noteError) console.error("dua_note_delete failed, archive will show no app actor:", noteError.message);

  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) {
    const { error: cancelError } = await adminClient.rpc("dua_cancel_delete_intent", { _user_id: userId });
    if (cancelError) console.error("dua_cancel_delete_intent failed:", cancelError.message);
    return { error: { message: error.message } };
  }
  return { error: null };
}
```

- [ ] **Step 2: Use it at the three call sites (one-line changes)**

At `index.ts:1347` (delete_institution loop):

```ts
            const { error } = await deleteAuthUserNoted(adminClient, userId, user.id, "app:delete_institution");
```

At `index.ts:1422` (delete_user):

```ts
        const { error: authError } = await deleteAuthUserNoted(adminClient, data.userId, user.id, "app");
```

At `index.ts:1998` (bulk_delete_students loop):

```ts
              const { error: deleteError } = await deleteAuthUserNoted(adminClient, userId, user.id, "app:bulk_delete_students");
```

The surrounding error handling (`authError.message`, `explainDeleteFailure`, the `user_delete_blocked` audit row, and the existing `user_deleted` audit row) is unchanged. So there is still exactly one `user_deleted` row per delete, and the §29 alerts are not double-counted.

- [ ] **Step 3: Lint against a baseline, then deploy**

```bash
git stash -- supabase/functions/admin-operations/index.ts && npx eslint supabase/functions/admin-operations/index.ts | tail -3; git stash pop
npx eslint supabase/functions/admin-operations/index.ts | tail -3
npx supabase@latest functions deploy admin-operations --project-ref gyymkgohcijeksmrzuyw --use-api
```

Expected:
- the error count after the change equals the baseline count from the first line, and `npx eslint` reports nothing on the new lines;
- the deploy prints "Deployed Functions."

- [ ] **Step 4: Verify the deployed RPCs as service_role, without deleting anyone (rolled back)**

```sql
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.dua_note_delete(ARRAY[gen_random_uuid()], NULL, 'app', false) AS noted,
       public.dua_cancel_delete_intent(gen_random_uuid()) AS cancelled_none;
ROLLBACK;
```

Expected: `noted` 1 and `cancelled_none` 0, with no permission error.

Note for Tushar: the next real deletion from the app appears in `dua.users` with `source = 'app'` and the admin's name. Check it with:

```sql
SELECT full_name, source, deleted_by_name, is_complete, total_rows FROM dua.users ORDER BY created_at DESC LIMIT 5;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/admin-operations/index.ts
git commit -m "feat(admin): note who is deleting before each GoTrue delete so the archive names them"
```

---

### Task 10: Documentation

**Files:**
- Modify: `.claude/CLAUDE.md` (append §31; stay within the 200-line cap)
- Modify: `.claude/skills/prod-operations/SKILL.md` (one bullet under §4)

- [ ] **Step 1: Append §31 to CLAUDE.md**

```markdown
## 31. Deleted-user archive (`dua` schema, since 2026-10-07)
Every account deletion on ANY path (app, GoTrue/dashboard, SQL) is copied first by a `BEFORE DELETE` trigger on `auth.users` (`dua.capture_user`: live FK walk, stripped rows, authored links, referenced rows incl. question text, files, traces, people index), and `dua.stmt_begin/stmt_end` prove completeness from `pg_stat_xact_user_tables`. Private schema, no API exposure; only team@salci.in will read it (Plan 3 page). **Never add a credential column without a `dua.column_policy` decision** (`SELECT * FROM dua.unclassified_sensitive_columns()` must be empty), never put a trigger on `auth.users` in a long transaction (it blocks logins), and keep `scripts/dua/test-capture.sql` + `run-probe.sh` green after any table/FK change. App deletes call `dua_note_delete` (who/source/on-request) right before GoTrue `deleteUser`, and `dua_cancel_delete_intent` if it fails; never move the DELETE itself into a PostgREST RPC (`authenticator` has an 8 s statement_timeout). Spec + plans: `docs/superpowers/specs/2026-10-06-deleted-users-page-design.md`.
```

- [ ] **Step 2: Add the prod-operations bullet** under "RLS landmines":

```markdown
* **User deletes are archived** (`dua`, CLAUDE.md §31). After a migration that adds a table, FK or sensitive column, run `scripts/dua/test-capture.sql` and `SELECT * FROM dua.unclassified_sensitive_columns()`; a capture error is recorded as `capture_failed` in best_effort mode and BLOCKS the delete once Plan 2 sets `required`.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/CLAUDE.md .claude/skills/prod-operations/SKILL.md
git commit -m "docs: CLAUDE.md §31 deleted-user archive, prod-operations note"
```

---

## Self-review

| Spec item | Where |
|---|---|
| §1 capture: walk, rows, links, labels/refs, header, files, traces, people index | Tasks 3 and 4 |
| §1 attribution and sources | Task 3 (`delete_context`, `session_source`), Task 5 (intent RPCs), Task 9; T2 and T2b. The spec's `dua_delete_user` RPC is replaced by a delete intent, for the 8 s reason above. |
| §1.7 trigger-audit rows written during the delete | Task 5 (`stmt_end`) |
| §2 completeness, deleted and updated counts | Task 5 (`stmt_begin` and `stmt_end`), proven in Tasks 6 and 7 |
| §3 `best_effort` mode and the off switch | `dua.settings`, `capture_guarded`, T5 and T5b |
| §6 Olympiad and on-request | `is_olympiad_account`, T3, T3b and T4 |
| §7 never stored | `column_policy`, pattern, counts-only rule, T7 and T7b, guard T9 |
| §8 expiring evidence first | Task 1 |
| §9 storage | Task 1 |

Out of this plan (in Plans 2 and 3):
- §3 `required` mode;
- §4 side doors and witness;
- §5 jobs;
- §5b former staff;
- §5c preview;
- §8 census backfill;
- §10 readers;
- §11 page.

- **Placeholders:** none. Classification decisions in Task 2 step 4 are produced by running the guard; that is the step's test.
- **Type consistency:** these names are used identically everywhere:
  - `delete_context(uuid) returns jsonb`
  - `capture_user(uuid, jsonb) returns uuid`
  - `capture_guarded(uuid) returns uuid`
  - `stmt_begin` and `stmt_end`
  - `dua_note_delete(uuid[], uuid, text, boolean) returns integer`
  - `dua_cancel_delete_intent(uuid) returns integer`
  - the `dua.users`, `dua.rows` and `dua.delete_intents` columns.
- **Review Focus:** every line has its test (T6, T2b, T5, T3/T3b, T7/T7b).
