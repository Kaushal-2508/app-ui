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
  ('public.profiles', 'must_reset_password', 'keep', 'flag, not a secret'),
  -- Classified from dua.unclassified_sensitive_columns() on 2026-10-07.
  ('public.ptm_schedules', 'feedback_token', 'exclude', 'link credential for the feedback form'),
  ('public.ai_daily_usage', 'tokens_used', 'keep', 'AI token count, not a credential'),
  ('public.ai_usage_logs', 'tokens_used', 'keep', 'AI token count, not a credential'),
  ('public.teacher_ai_quotas', 'daily_token_limit', 'keep', 'AI quota number, not a credential'),
  ('public.oly_batches', 'pin_expiry_minutes', 'keep', 'setting, not the PIN'),
  ('public.oly_batches', 'pin_first_used_at', 'keep', 'timestamp, not the PIN'),
  ('public.oly_campaigns', 'pin_expiry_minutes', 'keep', 'setting, not the PIN'),
  ('public.oly_schools', 'school_short_code', 'keep', 'public school code'),
  ('public.ptm_booking_meet', 'meet_attempts', 'keep', 'room status, not the link'),
  ('public.ptm_booking_meet', 'meet_claimed_at', 'keep', 'room status, not the link'),
  ('public.ptm_booking_meet', 'meet_close_attempts', 'keep', 'room status, not the link'),
  ('public.ptm_booking_meet', 'meet_close_claimed_at', 'keep', 'room status, not the link'),
  ('public.ptm_booking_meet', 'meet_closed_at', 'keep', 'room status, not the link'),
  ('public.ptm_booking_meet', 'meet_cohost_set', 'keep', 'room status, not the link'),
  ('public.ptm_booking_meet', 'meet_created_at', 'keep', 'room status, not the link'),
  ('public.ptm_booking_meet', 'meet_error', 'keep', 'room status, not the link'),
  ('public.staff_salary_assignments', 'bank_name', 'keep', 'bank name only; account number, IFSC and PAN are excluded'),
  ('public.support_messages', 'client_token', 'keep', 'client dedupe key, not a credential');

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
