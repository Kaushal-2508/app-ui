-- Admissions: enquiry, registration fee, admission (NEEDS DB in naman-erp
-- e0d3c99a, e2112713, a4c829cc, 9648ea07; spec
-- docs/superpowers/specs/2026-10-09-admissions-module-design.md, section 5).
--
-- * Tables admission_settings, admission_enquiries, admission_registrations,
--   admission_notes, admission_documents (with the scan columns),
--   admissions_overrides; plus admission_intake_hits (public form rate limit)
--   and admission_document_trash (scans waiting to be deleted).
-- * Who: _admissions_can(uid, institution) = super admin, an admin of that
--   school, or a non-student active account of that school named in
--   admissions_overrides. is_admissions_staff(uid) asks it for uid's own school
--   (another user's answer only to that school's admins).
-- * Every table is RPC-written; admissions staff may SELECT their school's rows.
-- * admission_number is unique across the platform (idx_profiles_admission_unique
--   is on lower(admission_number) over all profiles), so the admit check is
--   platform-wide; a number held in another school is refused without a name.
-- * admission_admit_tx and the two public intake RPCs are service_role only:
--   the first trusts the _actor the admin-operations edge function passes.
-- * Scans: photos (no SVG) and PDF up to 10 MB in the private bucket.
-- * Removing a scan clears the row and queues the object in
--   admission_document_trash; Storage forbids SQL deletes of storage.objects
--   (storage.protect_delete), so the admission-docs-sweep edge function deletes
--   it through the Storage API (kicked by pg_net, cron every 10 minutes).
-- * student_personal_details gains gender, blood_group, address, father_name,
--   mother_name. classes gains a SELECT policy for admissions staff (the admit
--   form lists a class's sections).

-- ── 1. tables ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admission_settings (
  institution_id          uuid PRIMARY KEY REFERENCES public.institutions(id) ON DELETE CASCADE,
  registration_fee_rupees integer NOT NULL DEFAULT 1000 CHECK (registration_fee_rupees BETWEEN 0 AND 10000000),
  document_checklist      jsonb NOT NULL DEFAULT '[
    {"key":"birth_certificate","label":"Birth certificate"},
    {"key":"transfer_certificate","label":"Transfer certificate"},
    {"key":"report_card","label":"Previous report card"},
    {"key":"aadhaar_student","label":"Aadhaar card (child)"},
    {"key":"aadhaar_parent","label":"Aadhaar card (parent)"},
    {"key":"photos","label":"Passport photos"},
    {"key":"address_proof","label":"Address proof"},
    {"key":"category_certificate","label":"Category certificate"},
    {"key":"medical_certificate","label":"Medical certificate"}
  ]'::jsonb CHECK (jsonb_typeof(document_checklist) = 'array'),
  admission_number_prefix text NULL CHECK (admission_number_prefix IS NULL OR length(admission_number_prefix) BETWEEN 1 AND 20),
  next_admission_seq      integer NOT NULL DEFAULT 1 CHECK (next_admission_seq BETWEEN 1 AND 99999999),
  next_reference_seq      integer NOT NULL DEFAULT 1 CHECK (next_reference_seq >= 1),
  enquiry_form_enabled    boolean NOT NULL DEFAULT true,
  form_schema             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(form_schema) = 'array'),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS admission_settings_updated_by_idx ON public.admission_settings (updated_by);

CREATE TABLE IF NOT EXISTS public.admission_enquiries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id      uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  reference_no        text NOT NULL,
  stage               text NOT NULL DEFAULT 'enquiry' CHECK (stage IN ('enquiry', 'registered', 'admitted', 'dropped')),
  stage_before_drop   text NULL CHECK (stage_before_drop IS NULL OR stage_before_drop IN ('enquiry', 'registered')),
  stage_changed_at    timestamptz NOT NULL DEFAULT now(),
  source              text NOT NULL DEFAULT 'walk_in' CHECK (source IN ('public_form', 'walk_in', 'phone', 'referral', 'other')),
  student_name        text NOT NULL CHECK (length(student_name) BETWEEN 1 AND 120),
  date_of_birth       date NULL,
  gender              text NULL CHECK (gender IS NULL OR gender IN ('female', 'male', 'other')),
  class_group_id      uuid NULL REFERENCES public.class_groups(id) ON DELETE SET NULL,
  applying_for_label  text NOT NULL CHECK (length(applying_for_label) BETWEEN 1 AND 80),
  academic_year_label text NOT NULL CHECK (academic_year_label ~ '^\d{4}-\d{2}$'),
  parent_name         text NOT NULL CHECK (length(parent_name) BETWEEN 1 AND 120),
  parent_phone        text NOT NULL CHECK (parent_phone ~ '^\d{10}$'),
  parent_email        text NULL CHECK (parent_email IS NULL OR length(parent_email) <= 200),
  previous_school     text NULL CHECK (previous_school IS NULL OR length(previous_school) <= 200),
  message             text NULL CHECK (message IS NULL OR length(message) <= 2000),
  assigned_to         uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  next_follow_up_on   date NULL,
  dropped_reason      text NULL CHECK (dropped_reason IS NULL OR length(dropped_reason) <= 500),
  admission_number    text NULL,
  admitted_on         date NULL,
  student_profile_id  uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  form                jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(form) = 'object'),
  created_by          uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_enquiries_reference_key UNIQUE (institution_id, reference_no)
);
CREATE INDEX IF NOT EXISTS admission_enquiries_inst_created_idx ON public.admission_enquiries (institution_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS admission_enquiries_inst_stage_idx ON public.admission_enquiries (institution_id, stage);
CREATE INDEX IF NOT EXISTS admission_enquiries_inst_year_idx ON public.admission_enquiries (institution_id, academic_year_label, stage);
CREATE INDEX IF NOT EXISTS admission_enquiries_inst_phone_idx ON public.admission_enquiries (institution_id, parent_phone);
CREATE INDEX IF NOT EXISTS admission_enquiries_class_group_idx ON public.admission_enquiries (class_group_id);
CREATE INDEX IF NOT EXISTS admission_enquiries_assigned_to_idx ON public.admission_enquiries (assigned_to);
CREATE INDEX IF NOT EXISTS admission_enquiries_student_profile_idx ON public.admission_enquiries (student_profile_id);
CREATE INDEX IF NOT EXISTS admission_enquiries_created_by_idx ON public.admission_enquiries (created_by);

CREATE TABLE IF NOT EXISTS public.admission_registrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id     uuid NOT NULL UNIQUE REFERENCES public.admission_enquiries(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  fee_rupees     integer NOT NULL CHECK (fee_rupees BETWEEN 0 AND 10000000),
  payment_mode   text NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'card', 'bank', 'cheque')),
  receipt_no     text NOT NULL CHECK (length(receipt_no) BETWEEN 1 AND 60),
  paid_on        date NOT NULL,
  note           text NULL CHECK (note IS NULL OR length(note) <= 500),
  collected_by   uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admission_registrations_inst_idx ON public.admission_registrations (institution_id);
CREATE INDEX IF NOT EXISTS admission_registrations_collected_by_idx ON public.admission_registrations (collected_by);

CREATE TABLE IF NOT EXISTS public.admission_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id     uuid NOT NULL REFERENCES public.admission_enquiries(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  kind           text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'stage', 'follow_up')),
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_by     uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admission_notes_enquiry_idx ON public.admission_notes (enquiry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admission_notes_inst_idx ON public.admission_notes (institution_id);
CREATE INDEX IF NOT EXISTS admission_notes_created_by_idx ON public.admission_notes (created_by);

CREATE TABLE IF NOT EXISTS public.admission_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id     uuid NOT NULL REFERENCES public.admission_enquiries(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  doc_key        text NOT NULL CHECK (doc_key ~ '^[a-z0-9_]{1,60}$'),
  label          text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  collected      boolean NOT NULL DEFAULT false,
  collected_at   timestamptz NULL,
  collected_by   uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  file_path      text NULL,
  file_name      text NULL CHECK (file_name IS NULL OR length(file_name) <= 200),
  file_size      integer NULL CHECK (file_size IS NULL OR file_size BETWEEN 1 AND 10485760),
  uploaded_at    timestamptz NULL,
  uploaded_by    uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT admission_documents_enquiry_doc_key UNIQUE (enquiry_id, doc_key)
);
CREATE INDEX IF NOT EXISTS admission_documents_inst_idx ON public.admission_documents (institution_id);
CREATE INDEX IF NOT EXISTS admission_documents_collected_by_idx ON public.admission_documents (collected_by);
CREATE INDEX IF NOT EXISTS admission_documents_uploaded_by_idx ON public.admission_documents (uploaded_by);
CREATE INDEX IF NOT EXISTS admission_documents_file_path_idx ON public.admission_documents (file_path) WHERE file_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.admissions_overrides (
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  granted_by     uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, institution_id)
);
CREATE INDEX IF NOT EXISTS admissions_overrides_inst_idx ON public.admissions_overrides (institution_id);
CREATE INDEX IF NOT EXISTS admissions_overrides_granted_by_idx ON public.admissions_overrides (granted_by);

-- The public form's rate limit: one row per accepted submission, an IP hash
-- (never the address). Pruned after two days by admission_public_submit.
CREATE TABLE IF NOT EXISTS public.admission_intake_hits (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id uuid NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  ip_hash        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admission_intake_hits_ip_idx ON public.admission_intake_hits (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS admission_intake_hits_inst_idx ON public.admission_intake_hits (institution_id, created_at);
CREATE INDEX IF NOT EXISTS admission_intake_hits_created_idx ON public.admission_intake_hits (created_at);

-- Scans to delete through the Storage API (admission-docs-sweep).
CREATE TABLE IF NOT EXISTS public.admission_document_trash (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  institution_id uuid NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  object_path    text NOT NULL,
  queued_at      timestamptz NOT NULL DEFAULT now(),
  attempts       integer NOT NULL DEFAULT 0,
  last_error     text NULL,
  done_at        timestamptz NULL
);
CREATE INDEX IF NOT EXISTS admission_document_trash_pending_idx ON public.admission_document_trash (queued_at) WHERE done_at IS NULL;
CREATE INDEX IF NOT EXISTS admission_document_trash_inst_idx ON public.admission_document_trash (institution_id);
CREATE INDEX IF NOT EXISTS admission_document_trash_path_idx ON public.admission_document_trash (object_path) WHERE done_at IS NULL;

-- ── 2. personal details ───────────────────────────────────────────────────
ALTER TABLE public.student_personal_details
  ADD COLUMN IF NOT EXISTS gender text NULL,
  ADD COLUMN IF NOT EXISTS blood_group text NULL,
  ADD COLUMN IF NOT EXISTS address text NULL,
  ADD COLUMN IF NOT EXISTS father_name text NULL,
  ADD COLUMN IF NOT EXISTS mother_name text NULL;
ALTER TABLE public.student_personal_details DROP CONSTRAINT IF EXISTS student_personal_details_gender_check;
ALTER TABLE public.student_personal_details ADD CONSTRAINT student_personal_details_gender_check
  CHECK (gender IS NULL OR gender IN ('female', 'male', 'other'));

-- ── 3. who may work the pipeline ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._admissions_admin(_uid uuid, _inst uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND _inst IS NOT NULL
     AND (public.is_super_admin(_uid) OR public.is_institution_admin(_uid, _inst));
$$;

CREATE OR REPLACE FUNCTION public._admissions_can(_uid uuid, _inst uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND _inst IS NOT NULL AND (
    public._admissions_admin(_uid, _inst)
    OR EXISTS (
      SELECT 1
        FROM public.admissions_overrides o
        JOIN public.profiles p ON p.id = o.user_id
       WHERE o.user_id = _uid AND o.institution_id = _inst
         AND p.institution_id = _inst AND p.is_active IS NOT FALSE
         AND NOT public.has_role(_uid, 'student')
    )
  );
$$;

-- For RLS policies, wrapped as (SELECT ...) so it runs once per statement:
-- is the caller admissions staff of their own school.
CREATE OR REPLACE FUNCTION public._admissions_staff_me()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public._admissions_can((SELECT auth.uid()), public.get_user_institution((SELECT auth.uid())));
$$;

CREATE OR REPLACE FUNCTION public.is_admissions_staff(_uid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_inst uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN false;
  END IF;
  v_inst := public.get_user_institution(_uid);
  IF _uid IS DISTINCT FROM v_caller
     AND coalesce(auth.role(), '') <> 'service_role'
     AND NOT public._admissions_admin(v_caller, v_inst) THEN
    RETURN false;
  END IF;
  RETURN public._admissions_can(_uid, v_inst);
END;
$$;

-- <institution>/<enquiry>/<doc_key>.<ext> of a registered or admitted enquiry
-- of that school, and the caller may work it.
CREATE OR REPLACE FUNCTION public._admission_object_ok(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_parts text[] := string_to_array(coalesce(_name, ''), '/');
  v_inst uuid;
  v_enq uuid;
BEGIN
  IF cardinality(v_parts) <> 3
     OR v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR v_parts[3] !~ '^[a-z0-9_]{1,60}\.[a-z0-9]{1,8}$' THEN
    RETURN false;
  END IF;
  v_inst := v_parts[1]::uuid;
  v_enq := v_parts[2]::uuid;
  RETURN EXISTS (SELECT 1 FROM public.admission_enquiries e
                  WHERE e.id = v_enq AND e.institution_id = v_inst AND e.stage IN ('registered', 'admitted'))
     AND public._admissions_can((SELECT auth.uid()), v_inst);
END;
$$;

-- ── 4. RLS, grants, audit, archive registry ───────────────────────────────
ALTER TABLE public.admission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admissions_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_intake_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admission_document_trash ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admission_settings_select ON public.admission_settings;
CREATE POLICY admission_settings_select ON public.admission_settings FOR SELECT TO authenticated
  USING ((SELECT public._admissions_staff_me()) AND institution_id = (SELECT public.get_user_institution((SELECT auth.uid()))));
DROP POLICY IF EXISTS admission_enquiries_select ON public.admission_enquiries;
CREATE POLICY admission_enquiries_select ON public.admission_enquiries FOR SELECT TO authenticated
  USING ((SELECT public._admissions_staff_me()) AND institution_id = (SELECT public.get_user_institution((SELECT auth.uid()))));
DROP POLICY IF EXISTS admission_registrations_select ON public.admission_registrations;
CREATE POLICY admission_registrations_select ON public.admission_registrations FOR SELECT TO authenticated
  USING ((SELECT public._admissions_staff_me()) AND institution_id = (SELECT public.get_user_institution((SELECT auth.uid()))));
DROP POLICY IF EXISTS admission_notes_select ON public.admission_notes;
CREATE POLICY admission_notes_select ON public.admission_notes FOR SELECT TO authenticated
  USING ((SELECT public._admissions_staff_me()) AND institution_id = (SELECT public.get_user_institution((SELECT auth.uid()))));
DROP POLICY IF EXISTS admission_documents_select ON public.admission_documents;
CREATE POLICY admission_documents_select ON public.admission_documents FOR SELECT TO authenticated
  USING ((SELECT public._admissions_staff_me()) AND institution_id = (SELECT public.get_user_institution((SELECT auth.uid()))));
DROP POLICY IF EXISTS admissions_overrides_select ON public.admissions_overrides;
CREATE POLICY admissions_overrides_select ON public.admissions_overrides FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public._admissions_admin((SELECT auth.uid()), institution_id));

REVOKE ALL ON public.admission_settings, public.admission_enquiries, public.admission_registrations,
              public.admission_notes, public.admission_documents, public.admissions_overrides,
              public.admission_intake_hits, public.admission_document_trash FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.admission_settings, public.admission_enquiries, public.admission_registrations,
       public.admission_notes, public.admission_documents, public.admissions_overrides FROM authenticated;
REVOKE ALL ON public.admission_intake_hits, public.admission_document_trash FROM authenticated;
GRANT SELECT ON public.admission_settings, public.admission_enquiries, public.admission_registrations,
                public.admission_notes, public.admission_documents, public.admissions_overrides TO authenticated;
GRANT ALL ON public.admission_settings, public.admission_enquiries, public.admission_registrations,
             public.admission_notes, public.admission_documents, public.admissions_overrides,
             public.admission_intake_hits, public.admission_document_trash TO service_role;

-- The admit form lists the sections of a class.
DROP POLICY IF EXISTS classes_select_admissions_staff ON public.classes;
CREATE POLICY classes_select_admissions_staff ON public.classes FOR SELECT TO authenticated
  USING ((SELECT public._admissions_staff_me()) AND institution_id = (SELECT public.get_user_institution((SELECT auth.uid()))));

-- Activity audit (CLAUDE.md section 11): the shared trigger on every user-facing table.
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.admission_settings;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.admission_settings;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.admission_settings FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission settings', '');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.admission_settings FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission settings', '');
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.admission_enquiries;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.admission_enquiries;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.admission_enquiries FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission enquiry', 'student_name');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.admission_enquiries FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission enquiry', 'student_name');
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.admission_registrations;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.admission_registrations;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.admission_registrations FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission registration', 'receipt_no');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.admission_registrations FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission registration', 'receipt_no');
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.admission_notes;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.admission_notes;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.admission_notes FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission note', '');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.admission_notes FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission note', '');
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.admission_documents;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.admission_documents;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.admission_documents FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission document', 'label');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.admission_documents FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admission document', 'label');
DROP TRIGGER IF EXISTS zzz_audit_ins ON public.admissions_overrides;
DROP TRIGGER IF EXISTS zzz_audit_del ON public.admissions_overrides;
CREATE TRIGGER zzz_audit_ins AFTER INSERT ON public.admissions_overrides FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admissions staff', '');
CREATE TRIGGER zzz_audit_del AFTER DELETE ON public.admissions_overrides FOR EACH ROW EXECUTE FUNCTION public.tg_audit_row('Admissions staff', '');

-- Deleted-user archive (CLAUDE.md section 31): the one new table that cascades from a user.
INSERT INTO dua.table_registry (table_name, label, category, display_columns, notes)
SELECT 'public.admissions_overrides', 'Permission override: admissions staff', 'Roles and assignments',
       ARRAY['created_at'], 'PK is (user_id, institution_id). Added 2026-10-12 with the admissions module.'
 WHERE NOT EXISTS (SELECT 1 FROM dua.table_registry WHERE table_name = 'public.admissions_overrides');

-- ── 5. storage: private bucket for certificate scans ───────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('admission-documents', 'admission-documents', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
                               allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS admission_documents_obj_select ON storage.objects;
CREATE POLICY admission_documents_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'admission-documents' AND public._admission_object_ok(name));
DROP POLICY IF EXISTS admission_documents_obj_insert ON storage.objects;
CREATE POLICY admission_documents_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'admission-documents' AND public._admission_object_ok(name));
DROP POLICY IF EXISTS admission_documents_obj_update ON storage.objects;
CREATE POLICY admission_documents_obj_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'admission-documents' AND public._admission_object_ok(name))
  WITH CHECK (bucket_id = 'admission-documents' AND public._admission_object_ok(name));
-- No DELETE policy: a scan leaves only through admission_remove_document_file.

-- ── 6. small helpers ──────────────────────────────────────────────────────
-- Raise a refusal the desk can read (P0001 + HINT, as the PTM RPCs do).
CREATE OR REPLACE FUNCTION public._admission_refuse(_message text, _hint text DEFAULT 'admission_invalid')
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  RAISE EXCEPTION '%', _message USING ERRCODE = 'P0001', HINT = _hint;
END;
$$;

-- Trimmed text or NULL; longer than _max is refused naming the field.
CREATE OR REPLACE FUNCTION public._admission_text(_v text, _max integer, _what text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE v text := nullif(btrim(coalesce(_v, '')), '');
BEGIN
  IF v IS NOT NULL AND length(v) > _max THEN
    PERFORM public._admission_refuse(format('Keep %s under %s characters.', _what, _max));
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public._admission_date(_v text, _what text)
RETURNS date LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF nullif(btrim(coalesce(_v, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;
  IF btrim(_v) !~ '^\d{4}-\d{2}-\d{2}$' THEN
    PERFORM public._admission_refuse(format('%s needs a date.', _what));
  END IF;
  RETURN btrim(_v)::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
  PERFORM public._admission_refuse(format('%s needs a real date.', _what));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._admission_today(_inst uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE coalesce((SELECT i.timezone FROM public.institutions i WHERE i.id = _inst), 'Asia/Kolkata'))::date;
$$;

-- The April-to-March year a date falls in, as "2026-27".
CREATE OR REPLACE FUNCTION public._admission_year_label(_d date, _offset integer DEFAULT 0)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (y + _offset)::text || '-' || lpad(((y + _offset + 1) % 100)::text, 2, '0')
    FROM (SELECT CASE WHEN extract(month FROM _d) >= 4 THEN extract(year FROM _d)::int
                      ELSE extract(year FROM _d)::int - 1 END AS y) s;
$$;

CREATE OR REPLACE FUNCTION public._admission_note(_enq uuid, _inst uuid, _kind text, _body text, _by uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.admission_notes (enquiry_id, institution_id, kind, body, created_by)
  VALUES (_enq, _inst, _kind, left(_body, 4000), _by);
$$;

-- The settings row, created with the defaults on first use.
CREATE OR REPLACE FUNCTION public._admission_settings_row(_inst uuid)
RETURNS public.admission_settings LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.admission_settings;
BEGIN
  INSERT INTO public.admission_settings (institution_id) VALUES (_inst) ON CONFLICT (institution_id) DO NOTHING;
  SELECT * INTO s FROM public.admission_settings WHERE institution_id = _inst;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION public._admission_settings_json(s public.admission_settings)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'institution_id', s.institution_id,
    'registration_fee_rupees', s.registration_fee_rupees,
    'document_checklist', s.document_checklist,
    'admission_number_prefix', s.admission_number_prefix,
    'next_admission_seq', s.next_admission_seq,
    'enquiry_form_enabled', s.enquiry_form_enabled,
    'form_schema', s.form_schema,
    'updated_at', s.updated_at);
$$;

-- A certificate checklist: [{key, label}], keys [a-z0-9_] and unique.
CREATE OR REPLACE FUNCTION public._admission_checklist_error(_list jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE it jsonb; v_keys text[] := ARRAY[]::text[]; v_key text; v_label text;
BEGIN
  IF jsonb_typeof(_list) <> 'array' THEN RETURN 'The certificate list is not a list.'; END IF;
  IF jsonb_array_length(_list) > 40 THEN RETURN 'Keep the certificate list to 40 items.'; END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(_list) LOOP
    IF jsonb_typeof(it) <> 'object' THEN RETURN 'A certificate in the list is not readable.'; END IF;
    v_key := it->>'key';
    v_label := btrim(coalesce(it->>'label', ''));
    IF v_key IS NULL OR v_key !~ '^[a-z0-9_]{1,60}$' THEN RETURN format('"%s" has no usable key.', left(v_label, 40)); END IF;
    IF v_label = '' OR length(v_label) > 80 THEN RETURN 'Every certificate needs a name under 80 characters.'; END IF;
    IF v_key = ANY (v_keys) THEN RETURN format('"%s" is in the list twice.', left(v_label, 40)); END IF;
    v_keys := v_keys || v_key;
  END LOOP;
  RETURN NULL;
END;
$$;

-- The school's own questions (spec 3.16).
CREATE OR REPLACE FUNCTION public._admission_form_schema_error(_schema jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE q jsonb; v_ids text[] := ARRAY[]::text[]; v_id text; v_label text; v_type text;
        v_opts text[]; v_ask text[]; v_n integer := 0;
BEGIN
  IF jsonb_typeof(_schema) <> 'array' THEN RETURN 'The questions are not a list.'; END IF;
  IF jsonb_array_length(_schema) > 50 THEN RETURN 'Keep to 50 questions.'; END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(_schema) LOOP
    v_n := v_n + 1;
    IF jsonb_typeof(q) <> 'object' THEN RETURN format('Question %s is not readable.', v_n); END IF;
    v_id := q->>'id';
    v_label := btrim(coalesce(q->>'label', ''));
    v_type := q->>'type';
    IF v_id IS NULL OR btrim(v_id) = '' OR length(v_id) > 60 THEN RETURN format('Question %s has no id.', v_n); END IF;
    IF v_id = ANY (v_ids) THEN RETURN format('Question %s repeats an id.', v_n); END IF;
    v_ids := v_ids || v_id;
    IF v_label = '' OR length(v_label) > 200 THEN RETURN format('Question %s needs its text, under 200 characters.', v_n); END IF;
    IF v_type IS NULL OR v_type NOT IN ('short_text', 'long_text', 'number', 'date', 'choice', 'yes_no') THEN
      RETURN format('"%s" has an unknown kind of answer.', left(v_label, 60));
    END IF;
    IF jsonb_typeof(q->'required') IS DISTINCT FROM 'boolean' THEN RETURN format('"%s": say whether it must be answered.', left(v_label, 60)); END IF;
    IF jsonb_typeof(coalesce(q->'options', '[]'::jsonb)) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(q->'options', '[]'::jsonb)) o
                   WHERE jsonb_typeof(o) <> 'string' OR length(o #>> '{}') > 200) THEN
      RETURN format('"%s": the options are not readable.', left(v_label, 60));
    END IF;
    IF jsonb_array_length(coalesce(q->'options', '[]'::jsonb)) > 30 THEN RETURN format('"%s": keep to 30 options.', left(v_label, 60)); END IF;
    IF v_type = 'choice' THEN
      SELECT array_agg(DISTINCT lower(btrim(o #>> '{}'))) INTO v_opts
        FROM jsonb_array_elements(q->'options') o WHERE btrim(o #>> '{}') <> '';
      IF coalesce(cardinality(v_opts), 0) < 2 THEN RETURN format('"%s": add at least two different options.', left(v_label, 60)); END IF;
    END IF;
    IF jsonb_typeof(q->'ask_at') IS DISTINCT FROM 'array' THEN RETURN format('"%s": choose where to ask it.', left(v_label, 60)); END IF;
    SELECT array_agg(a #>> '{}') INTO v_ask FROM jsonb_array_elements(q->'ask_at') a;
    IF coalesce(cardinality(v_ask), 0) = 0
       OR EXISTS (SELECT 1 FROM unnest(v_ask) x WHERE x IS NULL OR x NOT IN ('enquiry', 'admission', 'public')) THEN
      RETURN format('"%s": choose where to ask it.', left(v_label, 60));
    END IF;
    IF q ? 'help' AND jsonb_typeof(q->'help') NOT IN ('string', 'null') THEN RETURN format('"%s": the hint is not readable.', left(v_label, 60)); END IF;
    IF length(coalesce(q->>'help', '')) > 300 THEN RETURN format('"%s": keep the hint under 300 characters.', left(v_label, 60)); END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- The physical form's extra fields and the answers: only known keys, strings.
CREATE OR REPLACE FUNCTION public._admission_form_clean(_form jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE out jsonb := '{}'::jsonb; k text; v_custom jsonb := '{}'::jsonb; e record;
BEGIN
  IF _form IS NULL OR jsonb_typeof(_form) <> 'object' THEN RETURN '{}'::jsonb; END IF;
  FOREACH k IN ARRAY ARRAY['blood_group', 'father_name', 'mother_name', 'address'] LOOP
    IF _form ? k THEN
      out := out || jsonb_build_object(k, public._admission_text(_form->>k, CASE WHEN k = 'address' THEN 500 ELSE 120 END, replace(k, '_', ' ')));
    END IF;
  END LOOP;
  IF _form ? 'custom' AND jsonb_typeof(_form->'custom') = 'object' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(_form->'custom')) > 100 THEN
      PERFORM public._admission_refuse('Too many answers in one form.');
    END IF;
    FOR e IN SELECT key, value FROM jsonb_each(_form->'custom') LOOP
      IF length(e.key) > 60 THEN CONTINUE; END IF;
      IF jsonb_typeof(e.value) NOT IN ('string', 'number', 'boolean') THEN CONTINUE; END IF;
      IF length(e.value #>> '{}') > 2000 THEN PERFORM public._admission_refuse('Keep each answer under 2000 characters.'); END IF;
      IF btrim(e.value #>> '{}') <> '' THEN
        v_custom := v_custom || jsonb_build_object(e.key, btrim(e.value #>> '{}'));
      END IF;
    END LOOP;
    out := out || jsonb_build_object('custom', v_custom);
  END IF;
  RETURN out;
END;
$$;

-- "ENQ-2026-0041": the school's next reference, the settings row lock keeps it unique.
CREATE OR REPLACE FUNCTION public._admission_next_reference(_inst uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seq integer;
BEGIN
  PERFORM public._admission_settings_row(_inst);
  UPDATE public.admission_settings SET next_reference_seq = next_reference_seq + 1
   WHERE institution_id = _inst RETURNING next_reference_seq - 1 INTO v_seq;
  RETURN 'ENQ-' || to_char(public._admission_today(_inst), 'YYYY') || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public._admission_role_label(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.has_role(_uid, 'super_school_admin') OR public.has_role(_uid, 'school_admin') THEN 'Admin'
    WHEN public.has_role(_uid, 'coordinator') THEN 'Coordinator'
    WHEN public.has_role(_uid, 'teacher') THEN 'Teacher'
    WHEN public.has_role(_uid, 'employee') THEN 'Staff'
    ELSE 'Staff' END;
$$;

-- One enquiry as the pipeline row the frontend reads.
CREATE OR REPLACE FUNCTION public._admission_row_json(e public.admission_enquiries)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'reference_no', e.reference_no, 'stage', e.stage, 'stage_changed_at', e.stage_changed_at,
    'source', e.source, 'student_name', e.student_name, 'date_of_birth', e.date_of_birth, 'gender', e.gender,
    'class_group_id', e.class_group_id, 'applying_for_label', e.applying_for_label,
    'academic_year_label', e.academic_year_label, 'parent_name', e.parent_name, 'parent_phone', e.parent_phone,
    'parent_email', e.parent_email, 'previous_school', e.previous_school, 'message', e.message,
    'assigned_to', e.assigned_to,
    'assigned_to_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = e.assigned_to),
    'next_follow_up_on', e.next_follow_up_on, 'dropped_reason', e.dropped_reason,
    'admission_number', e.admission_number, 'admitted_on', e.admitted_on,
    'student_profile_id', e.student_profile_id, 'created_at', e.created_at,
    'registration', (SELECT jsonb_build_object('fee_rupees', r.fee_rupees, 'payment_mode', r.payment_mode,
                                               'receipt_no', r.receipt_no, 'paid_on', r.paid_on)
                       FROM public.admission_registrations r WHERE r.enquiry_id = e.id),
    'documents_collected', (SELECT count(*) FROM public.admission_documents d WHERE d.enquiry_id = e.id AND d.collected),
    'documents_total', (SELECT count(*) FROM public.admission_documents d WHERE d.enquiry_id = e.id),
    'other_enquiries', (SELECT jsonb_agg(jsonb_build_object('id', o.id, 'student_name', o.student_name,
                                                            'stage', o.stage, 'created_at', o.created_at)
                                         ORDER BY o.created_at DESC)
                          FROM (SELECT o2.* FROM public.admission_enquiries o2
                                 WHERE o2.institution_id = e.institution_id AND o2.parent_phone = e.parent_phone
                                   AND o2.id <> e.id
                                 ORDER BY o2.created_at DESC LIMIT 5) o));
$$;

-- Apply [{doc_key, collected}] to an enquiry's checklist: keys on the row or in
-- the school's current list; others ignored.
CREATE OR REPLACE FUNCTION public._admission_apply_ticks(_enq uuid, _inst uuid, _ticks jsonb, _by uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE t jsonb; v_key text; v_on boolean; v_label text; v_n integer := 0; v_list jsonb;
BEGIN
  IF _ticks IS NULL OR jsonb_typeof(_ticks) = 'null' THEN RETURN 0; END IF;
  IF jsonb_typeof(_ticks) <> 'array' OR jsonb_array_length(_ticks) > 60 THEN
    PERFORM public._admission_refuse('The certificate ticks are not readable.');
  END IF;
  v_list := (public._admission_settings_row(_inst)).document_checklist;
  FOR t IN SELECT value FROM jsonb_array_elements(_ticks) LOOP
    v_key := t->>'doc_key';
    IF v_key IS NULL OR jsonb_typeof(t->'collected') IS DISTINCT FROM 'boolean' THEN CONTINUE; END IF;
    v_on := (t->>'collected')::boolean;
    SELECT d.label INTO v_label FROM public.admission_documents d WHERE d.enquiry_id = _enq AND d.doc_key = v_key;
    IF NOT FOUND THEN
      SELECT x->>'label' INTO v_label FROM jsonb_array_elements(v_list) x WHERE x->>'key' = v_key LIMIT 1;
      IF v_label IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.admission_documents (enquiry_id, institution_id, doc_key, label)
      VALUES (_enq, _inst, v_key, left(v_label, 80)) ON CONFLICT (enquiry_id, doc_key) DO NOTHING;
    END IF;
    UPDATE public.admission_documents d
       SET collected = v_on,
           collected_at = CASE WHEN v_on AND NOT d.collected THEN now() WHEN v_on THEN d.collected_at ELSE NULL END,
           collected_by = CASE WHEN v_on AND NOT d.collected THEN _by WHEN v_on THEN d.collected_by ELSE NULL END
     WHERE d.enquiry_id = _enq AND d.doc_key = v_key AND d.collected IS DISTINCT FROM v_on;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Queue a scan for deletion and nudge the sweeper (pg_net sends after commit).
CREATE OR REPLACE FUNCTION public._admission_trash(_inst uuid, _path text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _path IS NULL OR _path = '' THEN RETURN; END IF;
  INSERT INTO public.admission_document_trash (institution_id, object_path) VALUES (_inst, _path);
  PERFORM public.admission_docs_sweep_kick();
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_docs_sweep_kick()
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_secret text; v_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admission_document_trash t WHERE t.done_at IS NULL AND t.attempts < 10) THEN
    RETURN NULL;
  END IF;
  SELECT s.decrypted_secret INTO v_secret FROM vault.decrypted_secrets s WHERE s.name = 'webhook_secret';
  IF v_secret IS NULL THEN
    RAISE WARNING 'admission_docs_sweep_kick: Vault secret "webhook_secret" is missing; scans stay queued.';
    RETURN NULL;
  END IF;
  SELECT net.http_post(
           url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/admission-docs-sweep',
           body := '{}'::jsonb,
           headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
           timeout_milliseconds := 20000)
    INTO v_id;
  RETURN v_id;
END;
$$;

-- For the sweeper: queued paths no row points at any more. A path a fresh
-- upload took back is closed instead of deleted.
CREATE OR REPLACE FUNCTION public.admission_docs_trash_pending(_limit integer DEFAULT 100)
RETURNS TABLE (id bigint, object_path text) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.admission_document_trash t SET done_at = now(), last_error = 'kept: a newer upload uses this path'
   WHERE t.done_at IS NULL
     AND EXISTS (SELECT 1 FROM public.admission_documents d WHERE d.file_path = t.object_path);
  RETURN QUERY
  UPDATE public.admission_document_trash t SET attempts = t.attempts + 1
   WHERE t.id IN (SELECT t2.id FROM public.admission_document_trash t2
                   WHERE t2.done_at IS NULL AND t2.attempts < 10
                   ORDER BY t2.queued_at LIMIT greatest(1, least(coalesce(_limit, 100), 500))
                   FOR UPDATE SKIP LOCKED)
  RETURNING t.id, t.object_path;
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_docs_trash_result(_done bigint[], _failed bigint[], _error text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.admission_document_trash SET done_at = now(), last_error = NULL WHERE id = ANY (coalesce(_done, ARRAY[]::bigint[]));
  UPDATE public.admission_document_trash SET last_error = left(_error, 500) WHERE id = ANY (coalesce(_failed, ARRAY[]::bigint[]));
$$;

-- ── 7. settings and staff ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admission_get_settings(_institution_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._admissions_can(auth.uid(), _institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can open admissions.' USING ERRCODE = '42501';
  END IF;
  RETURN public._admission_settings_json(public._admission_settings_row(_institution_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_set_settings(_institution_id uuid, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := coalesce(_patch, '{}'::jsonb);
  s public.admission_settings;
  v_err text;
  v_prefix text;
BEGIN
  IF NOT public._admissions_admin(v_uid, _institution_id) THEN
    RAISE EXCEPTION 'Only a school admin can change the admissions settings.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) <> 'object' THEN PERFORM public._admission_refuse('The settings are not readable.'); END IF;
  s := public._admission_settings_row(_institution_id);
  SELECT * INTO s FROM public.admission_settings WHERE institution_id = _institution_id FOR UPDATE;

  IF p ? 'registration_fee_rupees' THEN
    IF jsonb_typeof(p->'registration_fee_rupees') <> 'number'
       OR (p->>'registration_fee_rupees')::numeric <> trunc((p->>'registration_fee_rupees')::numeric)
       OR (p->>'registration_fee_rupees')::numeric NOT BETWEEN 0 AND 10000000 THEN
      PERFORM public._admission_refuse('Enter the registration fee in whole rupees.');
    END IF;
    s.registration_fee_rupees := (p->>'registration_fee_rupees')::integer;
  END IF;
  IF p ? 'admission_number_prefix' THEN
    v_prefix := nullif(btrim(coalesce(p->>'admission_number_prefix', '')), '');
    IF v_prefix IS NOT NULL AND v_prefix !~ '^[A-Za-z0-9/._ -]{1,20}$' THEN
      PERFORM public._admission_refuse('Use letters, numbers, / . _ - or spaces in the prefix, up to 20.');
    END IF;
    s.admission_number_prefix := v_prefix;
  END IF;
  IF p ? 'next_admission_seq' THEN
    IF jsonb_typeof(p->'next_admission_seq') <> 'number'
       OR (p->>'next_admission_seq')::numeric <> trunc((p->>'next_admission_seq')::numeric)
       OR (p->>'next_admission_seq')::numeric NOT BETWEEN 1 AND 99999999 THEN
      PERFORM public._admission_refuse('The next admission number must be a whole number from 1.');
    END IF;
    s.next_admission_seq := (p->>'next_admission_seq')::integer;
  END IF;
  IF p ? 'enquiry_form_enabled' THEN
    IF jsonb_typeof(p->'enquiry_form_enabled') <> 'boolean' THEN PERFORM public._admission_refuse('Say whether the online form is on.'); END IF;
    s.enquiry_form_enabled := (p->>'enquiry_form_enabled')::boolean;
  END IF;
  IF p ? 'document_checklist' THEN
    v_err := public._admission_checklist_error(p->'document_checklist');
    IF v_err IS NOT NULL THEN PERFORM public._admission_refuse(v_err); END IF;
    s.document_checklist := (SELECT coalesce(jsonb_agg(jsonb_build_object('key', x->>'key', 'label', btrim(x->>'label')) ORDER BY o), '[]'::jsonb)
                               FROM jsonb_array_elements(p->'document_checklist') WITH ORDINALITY y(x, o));
  END IF;
  IF p ? 'form_schema' THEN
    v_err := public._admission_form_schema_error(p->'form_schema');
    IF v_err IS NOT NULL THEN PERFORM public._admission_refuse(v_err, 'admission_form_schema_invalid'); END IF;
    s.form_schema := (SELECT coalesce(jsonb_agg(jsonb_build_object(
                         'id', q->>'id', 'label', btrim(q->>'label'), 'type', q->>'type',
                         'required', (q->>'required')::boolean,
                         'options', CASE WHEN q->>'type' = 'choice'
                                         THEN (SELECT coalesce(jsonb_agg(btrim(o #>> '{}') ORDER BY i), '[]'::jsonb)
                                                 FROM jsonb_array_elements(q->'options') WITH ORDINALITY z(o, i)
                                                WHERE btrim(o #>> '{}') <> '')
                                         ELSE '[]'::jsonb END,
                         'ask_at', (SELECT jsonb_agg(st ORDER BY array_position(ARRAY['enquiry', 'admission', 'public'], st))
                                      FROM (SELECT DISTINCT a #>> '{}' AS st FROM jsonb_array_elements(q->'ask_at') a) w),
                         'help', nullif(btrim(coalesce(q->>'help', '')), '')) ORDER BY o), '[]'::jsonb)
                        FROM jsonb_array_elements(p->'form_schema') WITH ORDINALITY y(q, o));
  END IF;

  UPDATE public.admission_settings
     SET registration_fee_rupees = s.registration_fee_rupees,
         admission_number_prefix = s.admission_number_prefix,
         next_admission_seq = s.next_admission_seq,
         enquiry_form_enabled = s.enquiry_form_enabled,
         document_checklist = s.document_checklist,
         form_schema = s.form_schema,
         updated_at = now(),
         updated_by = v_uid
   WHERE institution_id = _institution_id
  RETURNING * INTO s;
  RETURN public._admission_settings_json(s);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_list_staff(_institution_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._admissions_can(auth.uid(), _institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can see this.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', x.id, 'full_name', x.full_name, 'role', x.role_label)
                                    ORDER BY x.full_name), '[]'::jsonb)
            FROM (SELECT p.id, p.full_name, public._admission_role_label(p.id) AS role_label
                    FROM public.admissions_overrides o
                    JOIN public.profiles p ON p.id = o.user_id
                   WHERE o.institution_id = _institution_id
                   ORDER BY p.full_name LIMIT 200) x);
END;
$$;

-- Staff an admin may name: active, non-student, not an admin, of this school.
CREATE OR REPLACE FUNCTION public.admission_staff_options(_institution_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._admissions_admin(auth.uid(), _institution_id) THEN
    RAISE EXCEPTION 'Only a school admin can choose admissions staff.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', x.id, 'full_name', x.full_name, 'role', x.role_label)
                                    ORDER BY x.full_name), '[]'::jsonb)
            FROM (SELECT p.id, p.full_name, public._admission_role_label(p.id) AS role_label
                    FROM public.profiles p
                   WHERE p.institution_id = _institution_id AND p.is_active IS NOT FALSE
                     AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id
                                    AND ur.role IN ('teacher', 'coordinator', 'employee'))
                     AND NOT public.has_role(p.id, 'student')
                     AND NOT public.is_institution_admin(p.id, _institution_id)
                   ORDER BY p.full_name LIMIT 500) x);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_set_staff(_institution_id uuid, _user_ids uuid[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_ids uuid[] := ARRAY(SELECT DISTINCT u FROM unnest(coalesce(_user_ids, ARRAY[]::uuid[])) u WHERE u IS NOT NULL);
        v_bad integer;
BEGIN
  IF NOT public._admissions_admin(v_uid, _institution_id) THEN
    RAISE EXCEPTION 'Only a school admin can choose admissions staff.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(v_ids) > 200 THEN PERFORM public._admission_refuse('Name at most 200 admissions staff.'); END IF;
  SELECT count(*) INTO v_bad FROM unnest(v_ids) u
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = u AND p.institution_id = _institution_id AND p.is_active IS NOT FALSE)
      OR public.has_role(u, 'student');
  IF v_bad > 0 THEN
    PERFORM public._admission_refuse(format('%s of the people chosen are not staff of this school.', v_bad));
  END IF;
  DELETE FROM public.admissions_overrides o WHERE o.institution_id = _institution_id AND NOT (o.user_id = ANY (v_ids));
  INSERT INTO public.admissions_overrides (user_id, institution_id, granted_by)
  SELECT u, _institution_id, v_uid FROM unnest(v_ids) u
  ON CONFLICT (user_id, institution_id) DO NOTHING;
END;
$$;

-- ── 8. enquiries ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admission_create_enquiry(_institution_id uuid, _fields jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  f jsonb := coalesce(_fields, '{}'::jsonb);
  v_name text; v_parent text; v_phone text; v_email text; v_label text; v_year text; v_source text;
  v_group uuid; v_group_name text; v_assignee uuid; v_dob date; v_gender text; v_follow date;
  v_prev text; v_msg text; v_form jsonb; v_id uuid; v_ref text; v_today date;
BEGIN
  IF NOT public._admissions_can(v_uid, _institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can add an enquiry.' USING ERRCODE = '42501';
  END IF;
  v_today := public._admission_today(_institution_id);
  v_name := public._admission_text(f->>'student_name', 120, 'the child''s name');
  v_parent := public._admission_text(f->>'parent_name', 120, 'the parent''s name');
  v_phone := regexp_replace(coalesce(f->>'parent_phone', ''), '\D', '', 'g');
  v_email := lower(public._admission_text(f->>'parent_email', 200, 'the email'));
  v_label := public._admission_text(f->>'applying_for_label', 80, 'the class');
  v_year := btrim(coalesce(f->>'academic_year_label', ''));
  v_source := coalesce(nullif(f->>'source', ''), 'walk_in');
  v_prev := public._admission_text(f->>'previous_school', 200, 'the previous school');
  v_msg := public._admission_text(f->>'message', 2000, 'the message');
  v_dob := public._admission_date(f->>'date_of_birth', 'Date of birth');
  v_follow := public._admission_date(f->>'next_follow_up_on', 'The follow-up');
  v_gender := nullif(f->>'gender', '');
  IF v_name IS NULL THEN PERFORM public._admission_refuse('Enter the child''s name.'); END IF;
  IF v_parent IS NULL THEN PERFORM public._admission_refuse('Enter the parent''s name.'); END IF;
  IF v_phone !~ '^\d{10}$' THEN PERFORM public._admission_refuse('Enter the parent''s 10-digit mobile number.'); END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN PERFORM public._admission_refuse('That email address does not look right.'); END IF;
  IF v_year !~ '^\d{4}-\d{2}$' THEN PERFORM public._admission_refuse('Choose the academic year.'); END IF;
  IF v_source NOT IN ('walk_in', 'phone', 'referral', 'other') THEN PERFORM public._admission_refuse('Choose how the parent reached the school.'); END IF;
  IF v_gender IS NOT NULL AND v_gender NOT IN ('female', 'male', 'other') THEN PERFORM public._admission_refuse('Choose the gender.'); END IF;
  IF v_dob IS NOT NULL AND v_dob > v_today THEN PERFORM public._admission_refuse('The date of birth is in the future.'); END IF;
  IF nullif(f->>'class_group_id', '') IS NOT NULL THEN
    SELECT g.id, g.name INTO v_group, v_group_name FROM public.class_groups g
     WHERE g.id::text = f->>'class_group_id' AND g.institution_id = _institution_id;
    IF v_group IS NULL THEN PERFORM public._admission_refuse('That class is not one of this school''s.'); END IF;
    v_label := coalesce(v_label, v_group_name);
  END IF;
  IF v_label IS NULL THEN PERFORM public._admission_refuse('Choose the class the child is applying for.'); END IF;
  IF nullif(f->>'assigned_to', '') IS NOT NULL THEN
    v_assignee := (f->>'assigned_to')::uuid;
    IF NOT public._admissions_can(v_assignee, _institution_id) THEN PERFORM public._admission_refuse('That person does not work on admissions.'); END IF;
  END IF;
  v_form := public._admission_form_clean(f->'form');

  -- A double tap or a retry returns the enquiry it already made.
  PERFORM pg_advisory_xact_lock(hashtext('admission_create:' || v_uid::text || ':' || v_phone));
  SELECT e.id, e.reference_no INTO v_id, v_ref FROM public.admission_enquiries e
   WHERE e.institution_id = _institution_id AND e.created_by = v_uid AND e.parent_phone = v_phone
     AND lower(e.student_name) = lower(v_name) AND e.academic_year_label = v_year
     AND e.created_at > now() - interval '60 seconds'
   ORDER BY e.created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_id, 'reference_no', v_ref);
  END IF;

  v_ref := public._admission_next_reference(_institution_id);
  INSERT INTO public.admission_enquiries (institution_id, reference_no, source, student_name, date_of_birth, gender,
                                          class_group_id, applying_for_label, academic_year_label, parent_name,
                                          parent_phone, parent_email, previous_school, message, assigned_to,
                                          next_follow_up_on, form, created_by)
  VALUES (_institution_id, v_ref, v_source, v_name, v_dob, v_gender, v_group, v_label, v_year, v_parent,
          v_phone, v_email, v_prev, v_msg, v_assignee, v_follow, v_form, v_uid)
  RETURNING id INTO v_id;
  PERFORM public._admission_note(v_id, _institution_id, 'stage', 'Enquiry received.', v_uid);
  RETURN jsonb_build_object('id', v_id, 'reference_no', v_ref);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_update_enquiry(_id uuid, _fields jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  f jsonb := coalesce(_fields, '{}'::jsonb);
  e public.admission_enquiries;
  n public.admission_enquiries;
  v_group_name text;
  v_today date;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(v_uid, e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can change an enquiry.' USING ERRCODE = '42501';
  END IF;
  v_today := public._admission_today(e.institution_id);
  n := e;
  IF f ? 'student_name' THEN n.student_name := public._admission_text(f->>'student_name', 120, 'the child''s name');
    IF n.student_name IS NULL THEN PERFORM public._admission_refuse('Enter the child''s name.'); END IF; END IF;
  IF f ? 'parent_name' THEN n.parent_name := public._admission_text(f->>'parent_name', 120, 'the parent''s name');
    IF n.parent_name IS NULL THEN PERFORM public._admission_refuse('Enter the parent''s name.'); END IF; END IF;
  IF f ? 'parent_phone' THEN n.parent_phone := regexp_replace(coalesce(f->>'parent_phone', ''), '\D', '', 'g');
    IF n.parent_phone !~ '^\d{10}$' THEN PERFORM public._admission_refuse('Enter the parent''s 10-digit mobile number.'); END IF; END IF;
  IF f ? 'parent_email' THEN n.parent_email := lower(public._admission_text(f->>'parent_email', 200, 'the email'));
    IF n.parent_email IS NOT NULL AND n.parent_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN PERFORM public._admission_refuse('That email address does not look right.'); END IF; END IF;
  IF f ? 'academic_year_label' THEN n.academic_year_label := btrim(coalesce(f->>'academic_year_label', ''));
    IF n.academic_year_label !~ '^\d{4}-\d{2}$' THEN PERFORM public._admission_refuse('Choose the academic year.'); END IF; END IF;
  IF f ? 'class_group_id' THEN
    IF nullif(f->>'class_group_id', '') IS NULL THEN n.class_group_id := NULL;
    ELSE
      SELECT g.id, g.name INTO n.class_group_id, v_group_name FROM public.class_groups g
       WHERE g.id::text = f->>'class_group_id' AND g.institution_id = e.institution_id;
      IF n.class_group_id IS NULL THEN PERFORM public._admission_refuse('That class is not one of this school''s.'); END IF;
    END IF;
  END IF;
  IF f ? 'applying_for_label' THEN n.applying_for_label := coalesce(public._admission_text(f->>'applying_for_label', 80, 'the class'), v_group_name);
    IF n.applying_for_label IS NULL THEN PERFORM public._admission_refuse('Choose the class the child is applying for.'); END IF; END IF;
  IF f ? 'date_of_birth' THEN n.date_of_birth := public._admission_date(f->>'date_of_birth', 'Date of birth');
    IF n.date_of_birth > v_today THEN PERFORM public._admission_refuse('The date of birth is in the future.'); END IF; END IF;
  IF f ? 'gender' THEN n.gender := nullif(f->>'gender', '');
    IF n.gender IS NOT NULL AND n.gender NOT IN ('female', 'male', 'other') THEN PERFORM public._admission_refuse('Choose the gender.'); END IF; END IF;
  IF f ? 'previous_school' THEN n.previous_school := public._admission_text(f->>'previous_school', 200, 'the previous school'); END IF;
  IF f ? 'message' THEN n.message := public._admission_text(f->>'message', 2000, 'the message'); END IF;
  -- An online-form enquiry keeps its source; the desk may correct its own.
  IF f ? 'source' AND e.source <> 'public_form' THEN n.source := coalesce(nullif(f->>'source', ''), e.source);
    IF n.source NOT IN ('walk_in', 'phone', 'referral', 'other') THEN
      PERFORM public._admission_refuse('Choose how the parent reached the school.');
    END IF; END IF;
  IF f ? 'assigned_to' THEN
    n.assigned_to := nullif(f->>'assigned_to', '')::uuid;
    IF n.assigned_to IS NOT NULL AND n.assigned_to IS DISTINCT FROM e.assigned_to
       AND NOT public._admissions_can(n.assigned_to, e.institution_id) THEN
      PERFORM public._admission_refuse('That person does not work on admissions.');
    END IF;
  END IF;
  IF f ? 'next_follow_up_on' THEN n.next_follow_up_on := public._admission_date(f->>'next_follow_up_on', 'The follow-up'); END IF;
  IF f ? 'form' THEN n.form := e.form || public._admission_form_clean(f->'form'); END IF;

  IF e.stage = 'admitted' AND (
       n.student_name IS DISTINCT FROM e.student_name OR n.parent_name IS DISTINCT FROM e.parent_name
    OR n.parent_phone IS DISTINCT FROM e.parent_phone OR n.parent_email IS DISTINCT FROM e.parent_email
    OR n.academic_year_label IS DISTINCT FROM e.academic_year_label OR n.class_group_id IS DISTINCT FROM e.class_group_id
    OR n.applying_for_label IS DISTINCT FROM e.applying_for_label OR n.date_of_birth IS DISTINCT FROM e.date_of_birth
    OR n.gender IS DISTINCT FROM e.gender OR n.previous_school IS DISTINCT FROM e.previous_school
    OR n.message IS DISTINCT FROM e.message OR n.source IS DISTINCT FROM e.source OR n.form IS DISTINCT FROM e.form) THEN
    PERFORM public._admission_refuse('This child is already admitted. Change the details on the student''s profile.', 'admission_wrong_stage');
  END IF;

  UPDATE public.admission_enquiries SET
    student_name = n.student_name, parent_name = n.parent_name, parent_phone = n.parent_phone,
    parent_email = n.parent_email, academic_year_label = n.academic_year_label, class_group_id = n.class_group_id,
    applying_for_label = n.applying_for_label, date_of_birth = n.date_of_birth, gender = n.gender,
    previous_school = n.previous_school, message = n.message, source = n.source, assigned_to = n.assigned_to,
    next_follow_up_on = n.next_follow_up_on, form = n.form, updated_at = now()
  WHERE id = _id;

  IF n.next_follow_up_on IS DISTINCT FROM e.next_follow_up_on THEN
    PERFORM public._admission_note(_id, e.institution_id, 'follow_up',
      CASE WHEN n.next_follow_up_on IS NULL THEN 'Follow-up cleared.'
           ELSE 'Follow-up on ' || to_char(n.next_follow_up_on, 'DD Mon YYYY') || '.' END, v_uid);
  END IF;
  IF n.assigned_to IS DISTINCT FROM e.assigned_to THEN
    PERFORM public._admission_note(_id, e.institution_id, 'follow_up',
      CASE WHEN n.assigned_to IS NULL THEN 'No one is handling it now.'
           ELSE 'Handled by ' || coalesce((SELECT p.full_name FROM public.profiles p WHERE p.id = n.assigned_to), 'a colleague') || '.' END, v_uid);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_add_note(_id uuid, _body text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_inst uuid; v_body text := btrim(coalesce(_body, ''));
BEGIN
  SELECT e.institution_id INTO v_inst FROM public.admission_enquiries e WHERE e.id = _id;
  IF v_inst IS NULL THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(v_uid, v_inst) THEN
    RAISE EXCEPTION 'Only admissions staff can add a note.' USING ERRCODE = '42501';
  END IF;
  IF v_body = '' THEN PERFORM public._admission_refuse('Write the note first.'); END IF;
  IF length(v_body) > 2000 THEN PERFORM public._admission_refuse('Keep a note under 2000 characters.'); END IF;
  -- A double tap does not post the same note twice.
  IF EXISTS (SELECT 1 FROM public.admission_notes n WHERE n.enquiry_id = _id AND n.created_by = v_uid
               AND n.body = v_body AND n.created_at > now() - interval '15 seconds') THEN
    RETURN;
  END IF;
  PERFORM public._admission_note(_id, v_inst, 'note', v_body, v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public._admission_stage_refusal(_stage text, _wanted text)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM public._admission_refuse(CASE
    WHEN _stage = 'admitted' THEN 'This child is already admitted.'
    WHEN _stage = 'dropped' THEN 'This enquiry was dropped. Reopen it first.'
    WHEN _stage = 'registered' AND _wanted = 'register' THEN 'This enquiry is already registered.'
    WHEN _stage = 'enquiry' THEN 'Register this enquiry first.'
    ELSE 'This enquiry has moved on. Refresh and try again.' END, 'admission_wrong_stage');
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_register(_id uuid, _fee_rupees integer, _payment_mode text, _receipt_no text,
                                                     _paid_on date, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); e public.admission_enquiries; v_receipt text; v_note text; s public.admission_settings;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(v_uid, e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can register an enquiry.' USING ERRCODE = '42501';
  END IF;
  IF e.stage <> 'enquiry' THEN PERFORM public._admission_stage_refusal(e.stage, 'register'); END IF;
  IF _fee_rupees IS NULL OR _fee_rupees NOT BETWEEN 0 AND 10000000 THEN PERFORM public._admission_refuse('Enter the fee amount.'); END IF;
  IF _payment_mode IS NULL OR _payment_mode NOT IN ('cash', 'upi', 'card', 'bank', 'cheque') THEN PERFORM public._admission_refuse('Choose how the fee was paid.'); END IF;
  v_receipt := public._admission_text(_receipt_no, 60, 'the receipt number');
  IF v_receipt IS NULL THEN PERFORM public._admission_refuse('Enter the receipt number.'); END IF;
  IF _paid_on IS NULL THEN PERFORM public._admission_refuse('Enter the date the fee was paid.'); END IF;
  IF _paid_on > public._admission_today(e.institution_id) + 1 THEN PERFORM public._admission_refuse('The payment date is in the future.'); END IF;
  v_note := public._admission_text(_note, 500, 'the note');

  INSERT INTO public.admission_registrations (enquiry_id, institution_id, fee_rupees, payment_mode, receipt_no, paid_on, note, collected_by)
  VALUES (_id, e.institution_id, _fee_rupees, _payment_mode, v_receipt, _paid_on, v_note, v_uid);
  s := public._admission_settings_row(e.institution_id);
  INSERT INTO public.admission_documents (enquiry_id, institution_id, doc_key, label)
  SELECT _id, e.institution_id, x->>'key', left(x->>'label', 80)
    FROM jsonb_array_elements(s.document_checklist) x
   WHERE x->>'key' ~ '^[a-z0-9_]{1,60}$' AND btrim(coalesce(x->>'label', '')) <> ''
  ON CONFLICT (enquiry_id, doc_key) DO NOTHING;
  UPDATE public.admission_enquiries SET stage = 'registered', stage_changed_at = now(), updated_at = now() WHERE id = _id;
  PERFORM public._admission_note(_id, e.institution_id, 'stage',
    'Registered: Rs ' || _fee_rupees::text || ' paid by ' ||
    CASE _payment_mode WHEN 'upi' THEN 'UPI' WHEN 'bank' THEN 'bank transfer' ELSE _payment_mode END ||
    ', receipt ' || v_receipt || '.', v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_set_documents(_id uuid, _ticks jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); e public.admission_enquiries;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(v_uid, e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can tick certificates.' USING ERRCODE = '42501';
  END IF;
  IF e.stage NOT IN ('registered', 'admitted') THEN PERFORM public._admission_stage_refusal(e.stage, 'documents'); END IF;
  PERFORM public._admission_apply_ticks(_id, e.institution_id, _ticks, v_uid);
  UPDATE public.admission_enquiries SET updated_at = now() WHERE id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_set_document_file(_id uuid, _doc_key text, _file_path text, _file_name text, _file_size integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); e public.admission_enquiries; v_label text; v_old text; v_name text;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(v_uid, e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can upload certificates.' USING ERRCODE = '42501';
  END IF;
  IF e.stage NOT IN ('registered', 'admitted') THEN PERFORM public._admission_stage_refusal(e.stage, 'documents'); END IF;
  IF _doc_key IS NULL OR _doc_key !~ '^[a-z0-9_]{1,60}$' THEN PERFORM public._admission_refuse('That certificate is not on the list.'); END IF;
  IF _file_path IS NULL OR _file_path !~ ('^' || e.institution_id::text || '/' || e.id::text || '/' || _doc_key || '\.[a-z0-9]{1,8}$') THEN
    PERFORM public._admission_refuse('That file is not stored where this enquiry keeps its certificates.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'admission-documents' AND o.name = _file_path) THEN
    PERFORM public._admission_refuse('The upload did not finish. Try again.');
  END IF;
  IF _file_size IS NULL OR _file_size NOT BETWEEN 1 AND 10485760 THEN PERFORM public._admission_refuse('Keep each file under 10 MB.'); END IF;
  v_name := left(coalesce(nullif(btrim(coalesce(_file_name, '')), ''), split_part(_file_path, '/', 3)), 200);

  SELECT d.label, d.file_path INTO v_label, v_old FROM public.admission_documents d WHERE d.enquiry_id = _id AND d.doc_key = _doc_key;
  IF NOT FOUND THEN
    SELECT x->>'label' INTO v_label FROM jsonb_array_elements((public._admission_settings_row(e.institution_id)).document_checklist) x
     WHERE x->>'key' = _doc_key LIMIT 1;
    IF v_label IS NULL THEN PERFORM public._admission_refuse('That certificate is not on the list.'); END IF;
    INSERT INTO public.admission_documents (enquiry_id, institution_id, doc_key, label)
    VALUES (_id, e.institution_id, _doc_key, left(v_label, 80)) ON CONFLICT (enquiry_id, doc_key) DO NOTHING;
  END IF;
  -- A fresh upload at this path takes it back from a pending delete.
  UPDATE public.admission_document_trash t SET done_at = now(), last_error = 'kept: a newer upload uses this path'
   WHERE t.done_at IS NULL AND t.object_path = _file_path;
  UPDATE public.admission_documents d
     SET file_path = _file_path, file_name = v_name, file_size = _file_size, uploaded_at = now(), uploaded_by = v_uid,
         collected = true, collected_at = coalesce(d.collected_at, now()), collected_by = coalesce(d.collected_by, v_uid)
   WHERE d.enquiry_id = _id AND d.doc_key = _doc_key;
  IF v_old IS NOT NULL AND v_old <> _file_path THEN
    PERFORM public._admission_trash(e.institution_id, v_old);
  END IF;
  UPDATE public.admission_enquiries SET updated_at = now() WHERE id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_remove_document_file(_id uuid, _doc_key text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); e public.admission_enquiries; v_path text;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(v_uid, e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can remove a certificate.' USING ERRCODE = '42501';
  END IF;
  SELECT d.file_path INTO v_path FROM public.admission_documents d WHERE d.enquiry_id = _id AND d.doc_key = _doc_key FOR UPDATE;
  IF v_path IS NULL THEN RETURN; END IF;  -- already gone: a second tap is a no-op
  UPDATE public.admission_documents
     SET file_path = NULL, file_name = NULL, file_size = NULL, uploaded_at = NULL, uploaded_by = NULL
   WHERE enquiry_id = _id AND doc_key = _doc_key;
  PERFORM public._admission_trash(e.institution_id, v_path);
  UPDATE public.admission_enquiries SET updated_at = now() WHERE id = _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_drop(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); e public.admission_enquiries; v_reason text;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(v_uid, e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can drop an enquiry.' USING ERRCODE = '42501';
  END IF;
  IF e.stage = 'dropped' THEN PERFORM public._admission_refuse('This enquiry is already dropped.', 'admission_wrong_stage'); END IF;
  IF e.stage NOT IN ('enquiry', 'registered') THEN PERFORM public._admission_stage_refusal(e.stage, 'drop'); END IF;
  v_reason := public._admission_text(_reason, 500, 'the reason');
  IF v_reason IS NULL THEN PERFORM public._admission_refuse('Say why the enquiry is dropped.'); END IF;
  UPDATE public.admission_enquiries
     SET stage = 'dropped', stage_before_drop = e.stage, dropped_reason = v_reason, stage_changed_at = now(), updated_at = now()
   WHERE id = _id;
  PERFORM public._admission_note(_id, e.institution_id, 'stage', 'Dropped: ' || v_reason, v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_reopen(_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); e public.admission_enquiries; v_to text;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(v_uid, e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can reopen an enquiry.' USING ERRCODE = '42501';
  END IF;
  IF e.stage <> 'dropped' THEN PERFORM public._admission_refuse('This enquiry is not dropped.', 'admission_wrong_stage'); END IF;
  v_to := CASE WHEN e.stage_before_drop = 'registered'
                    AND EXISTS (SELECT 1 FROM public.admission_registrations r WHERE r.enquiry_id = _id)
               THEN 'registered' ELSE 'enquiry' END;
  UPDATE public.admission_enquiries
     SET stage = v_to, stage_before_drop = NULL, dropped_reason = NULL, stage_changed_at = now(), updated_at = now()
   WHERE id = _id;
  PERFORM public._admission_note(_id, e.institution_id, 'stage',
    'Reopened as ' || CASE v_to WHEN 'registered' THEN 'registered' ELSE 'an enquiry' END || '.', v_uid);
END;
$$;

-- ── 9. reads ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admission_pipeline(_institution_id uuid, _stage text DEFAULT NULL, _class_group_id uuid DEFAULT NULL,
                                                     _academic_year_label text DEFAULT NULL, _q text DEFAULT NULL,
                                                     _limit integer DEFAULT 50, _offset integer DEFAULT 0, _assigned_to uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(_limit, 50), 100));
  v_offset integer := greatest(0, least(coalesce(_offset, 0), 100000));
  v_q text := nullif(btrim(left(coalesce(_q, ''), 80)), '');
  v_like text;
  v_digits text;
BEGIN
  IF NOT public._admissions_can(auth.uid(), _institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can see enquiries.' USING ERRCODE = '42501';
  END IF;
  IF v_q IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := regexp_replace(v_q, '\D', '', 'g');
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(public._admission_row_json(x.r) ORDER BY x.created_at DESC, x.id DESC), '[]'::jsonb)
      FROM (SELECT e1 AS r, e1.created_at, e1.id FROM public.admission_enquiries e1
             WHERE e1.institution_id = _institution_id
               AND (_stage IS NULL OR e1.stage = _stage)
               AND (_class_group_id IS NULL OR e1.class_group_id = _class_group_id)
               AND (_academic_year_label IS NULL OR e1.academic_year_label = _academic_year_label)
               AND (_assigned_to IS NULL OR e1.assigned_to = _assigned_to)
               AND (v_q IS NULL
                    OR e1.student_name ILIKE v_like OR e1.parent_name ILIKE v_like
                    OR e1.reference_no ILIKE v_like OR coalesce(e1.admission_number, '') ILIKE v_like
                    OR (length(v_digits) >= 3 AND e1.parent_phone LIKE '%' || v_digits || '%'))
             ORDER BY e1.created_at DESC, e1.id DESC
             LIMIT v_limit OFFSET v_offset) x);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_stage_counts(_institution_id uuid, _academic_year_label text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._admissions_can(auth.uid(), _institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can see enquiries.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object(
            'enquiry', count(*) FILTER (WHERE e.stage = 'enquiry'),
            'registered', count(*) FILTER (WHERE e.stage = 'registered'),
            'admitted', count(*) FILTER (WHERE e.stage = 'admitted'),
            'dropped', count(*) FILTER (WHERE e.stage = 'dropped'))
            FROM public.admission_enquiries e
           WHERE e.institution_id = _institution_id
             AND (_academic_year_label IS NULL OR e.academic_year_label = _academic_year_label));
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_enquiry_detail(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.admission_enquiries; v_list jsonb;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(auth.uid(), e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can see enquiries.' USING ERRCODE = '42501';
  END IF;
  v_list := coalesce((SELECT s.document_checklist FROM public.admission_settings s WHERE s.institution_id = e.institution_id), '[]'::jsonb);
  RETURN public._admission_row_json(e) || jsonb_build_object(
    'form', e.form,
    'documents', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'doc_key', d.doc_key, 'label', d.label, 'collected', d.collected, 'collected_at', d.collected_at,
                     'file_path', d.file_path, 'file_name', d.file_name, 'file_size', d.file_size, 'uploaded_at', d.uploaded_at)
                     ORDER BY coalesce((SELECT o FROM jsonb_array_elements(v_list) WITH ORDINALITY x(item, o)
                                         WHERE x.item->>'key' = d.doc_key), 999), d.label), '[]'::jsonb)
                    FROM public.admission_documents d WHERE d.enquiry_id = e.id),
    'notes', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body,
                                                          'created_by_name', p.full_name, 'created_at', n.created_at)
                                       ORDER BY n.created_at DESC), '[]'::jsonb)
                FROM (SELECT * FROM public.admission_notes n1 WHERE n1.enquiry_id = e.id
                       ORDER BY n1.created_at DESC LIMIT 200) n
                LEFT JOIN public.profiles p ON p.id = n.created_by));
END;
$$;

-- ── 10. admission (service role only: called by admin-operations) ─────────
CREATE OR REPLACE FUNCTION public._admission_number_holder(_number text)
RETURNS TABLE (holder_id uuid, holder_name text, holder_inst uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, p.institution_id FROM public.profiles p
   WHERE p.admission_number IS NOT NULL AND p.admission_number <> ''
     AND lower(p.admission_number) = lower(_number)
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._admission_number_taken(_inst uuid, _number text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE h record;
BEGIN
  SELECT * INTO h FROM public._admission_number_holder(_number);
  IF NOT FOUND THEN RETURN; END IF;
  IF h.holder_inst = _inst THEN
    PERFORM public._admission_refuse(format('Admission number %s is already with %s.', _number, coalesce(left(h.holder_name, 80), 'another student')),
                                     'admission_number_taken');
  END IF;
  PERFORM public._admission_refuse(format('Admission number %s is already used by another school on SALCI. Use a different number, for example with your school''s prefix.', _number),
                                   'admission_number_taken');
END;
$$;

-- Checks an admission can go ahead and resolves the number, writing nothing;
-- admin-operations calls it before it makes the sign-in account.
CREATE OR REPLACE FUNCTION public.admission_admit_check(_id uuid, _actor uuid, _class_id uuid, _admission_number text, _is_auto boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.admission_enquiries; s public.admission_settings; v_num text; v_seq integer; v_guard integer := 0;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(_actor, e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can admit a student.' USING ERRCODE = '42501';
  END IF;
  IF e.stage <> 'registered' THEN PERFORM public._admission_stage_refusal(e.stage, 'admit'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.classes c WHERE c.id = _class_id AND c.institution_id = e.institution_id AND c.is_active IS NOT FALSE) THEN
    PERFORM public._admission_refuse('Choose an active section of this school.');
  END IF;
  SELECT * INTO s FROM public.admission_settings WHERE institution_id = e.institution_id;
  IF coalesce(_is_auto, false) THEN
    IF s.admission_number_prefix IS NULL THEN PERFORM public._admission_refuse('Set the admission number prefix in Admissions settings first.'); END IF;
    v_seq := s.next_admission_seq;
    LOOP
      v_num := s.admission_number_prefix || lpad(v_seq::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public._admission_number_holder(v_num));
      v_seq := v_seq + 1; v_guard := v_guard + 1;
      IF v_guard > 5000 THEN PERFORM public._admission_refuse('No free admission number after the prefix. Change the next number in Settings.'); END IF;
    END LOOP;
  ELSE
    v_num := public._admission_text(_admission_number, 40, 'the admission number');
    IF v_num IS NULL THEN PERFORM public._admission_refuse('Enter the admission number.'); END IF;
    PERFORM public._admission_number_taken(e.institution_id, v_num);
  END IF;
  RETURN jsonb_build_object('ok', true, 'admission_number', v_num);
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_admit_tx(_id uuid, _profile_id uuid, _actor uuid, _fields jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f jsonb := coalesce(_fields, '{}'::jsonb);
  e public.admission_enquiries;
  s public.admission_settings;
  v_today date;
  v_name text; v_dob date; v_gender text; v_gname text; v_gphone text; v_gemail text; v_class uuid;
  v_class_label text; v_group uuid; v_num text; v_auto boolean; v_on date; v_prev text; v_form jsonb;
  v_seq integer; v_guard integer := 0; v_email text;
BEGIN
  SELECT * INTO e FROM public.admission_enquiries WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That enquiry was not found.' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._admissions_can(_actor, e.institution_id) THEN
    RAISE EXCEPTION 'Only admissions staff can admit a student.' USING ERRCODE = '42501';
  END IF;
  IF e.stage <> 'registered' THEN PERFORM public._admission_stage_refusal(e.stage, 'admit'); END IF;
  v_today := public._admission_today(e.institution_id);

  v_name := public._admission_text(f->>'full_name', 120, 'the child''s name');
  v_dob := public._admission_date(f->>'date_of_birth', 'Date of birth');
  v_gender := nullif(f->>'gender', '');
  v_gname := public._admission_text(f->>'guardian_name', 120, 'the guardian''s name');
  v_gphone := regexp_replace(coalesce(f->>'guardian_phone', ''), '\D', '', 'g');
  v_gemail := lower(public._admission_text(f->>'guardian_email', 200, 'the email'));
  v_on := coalesce(public._admission_date(f->>'admitted_on', 'The admission date'), v_today);
  v_prev := public._admission_text(f->>'previous_school', 200, 'the previous school');
  v_auto := coalesce((f->>'admission_number_is_auto')::boolean, false);
  IF v_name IS NULL THEN PERFORM public._admission_refuse('Enter the child''s full name.'); END IF;
  IF v_dob IS NULL THEN PERFORM public._admission_refuse('Enter the date of birth.'); END IF;
  IF v_dob > v_today THEN PERFORM public._admission_refuse('The date of birth is in the future.'); END IF;
  IF v_gender IS NULL OR v_gender NOT IN ('female', 'male', 'other') THEN PERFORM public._admission_refuse('Choose the gender.'); END IF;
  IF v_gname IS NULL THEN PERFORM public._admission_refuse('Enter the guardian''s name.'); END IF;
  IF v_gphone !~ '^\d{10}$' THEN PERFORM public._admission_refuse('Enter the guardian''s 10-digit mobile number.'); END IF;
  IF v_gemail IS NOT NULL AND v_gemail !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN PERFORM public._admission_refuse('That email address does not look right.'); END IF;
  BEGIN
    v_class := nullif(f->>'class_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN v_class := NULL;
  END;
  SELECT c.id, c.class_group_id, c.name || coalesce(' ' || nullif(c.section, ''), '') INTO v_class, v_group, v_class_label
    FROM public.classes c WHERE c.id = v_class AND c.institution_id = e.institution_id AND c.is_active IS NOT FALSE;
  IF v_class IS NULL THEN PERFORM public._admission_refuse('Choose an active section of this school.'); END IF;
  v_form := public._admission_form_clean(f->'form');

  -- The sign-in account the edge function just made: only a fresh one.
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = _profile_id;
  IF v_email IS NULL THEN PERFORM public._admission_refuse('The sign-in account was not made. Try again.'); END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _profile_id) THEN
    PERFORM public._admission_refuse('That sign-in account is already in use.');
  END IF;

  -- The number: the next free one when auto, else the typed one if free.
  s := public._admission_settings_row(e.institution_id);
  SELECT * INTO s FROM public.admission_settings WHERE institution_id = e.institution_id FOR UPDATE;
  IF v_auto THEN
    IF s.admission_number_prefix IS NULL THEN PERFORM public._admission_refuse('Set the admission number prefix in Admissions settings first.'); END IF;
    v_seq := s.next_admission_seq;
    LOOP
      v_num := s.admission_number_prefix || lpad(v_seq::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public._admission_number_holder(v_num));
      v_seq := v_seq + 1; v_guard := v_guard + 1;
      IF v_guard > 5000 THEN PERFORM public._admission_refuse('No free admission number after the prefix. Change the next number in Settings.'); END IF;
    END LOOP;
    UPDATE public.admission_settings SET next_admission_seq = v_seq + 1 WHERE institution_id = e.institution_id;
  ELSE
    v_num := public._admission_text(f->>'admission_number', 40, 'the admission number');
    IF v_num IS NULL THEN PERFORM public._admission_refuse('Enter the admission number.'); END IF;
    PERFORM public._admission_number_taken(e.institution_id, v_num);
    IF s.admission_number_prefix IS NOT NULL
       AND lower(v_num) = lower(s.admission_number_prefix || lpad(s.next_admission_seq::text, 3, '0')) THEN
      UPDATE public.admission_settings SET next_admission_seq = s.next_admission_seq + 1 WHERE institution_id = e.institution_id;
    END IF;
  END IF;

  BEGIN
    -- handle_new_user pre-created the profile; upsert ON id (CLAUDE.md section 11).
    INSERT INTO public.profiles (id, full_name, email, institution_id, admission_number, must_reset_password, is_active)
    VALUES (_profile_id, v_name, v_email, e.institution_id, v_num, true, true)
    ON CONFLICT (id) DO UPDATE
      SET full_name = EXCLUDED.full_name, institution_id = EXCLUDED.institution_id,
          admission_number = EXCLUDED.admission_number, must_reset_password = true, is_active = true;
  EXCEPTION WHEN unique_violation THEN
    PERFORM public._admission_refuse(format('Admission number %s was just given to someone else. Try again.', v_num), 'admission_number_taken');
  END;
  INSERT INTO public.user_roles (user_id, role, institution_id, granted_by)
  VALUES (_profile_id, 'student', e.institution_id, _actor)
  ON CONFLICT (user_id, role, institution_id) DO NOTHING;
  INSERT INTO public.class_assignments (user_id, class_id, role, assigned_by)
  VALUES (_profile_id, v_class, 'student', _actor);
  INSERT INTO public.student_personal_details (profile_id, date_of_birth, guardian_name, guardian_phone, guardian_email,
                                               gender, blood_group, address, father_name, mother_name, updated_by)
  VALUES (_profile_id, v_dob, v_gname, v_gphone, v_gemail, v_gender,
          v_form->>'blood_group', v_form->>'address', v_form->>'father_name', v_form->>'mother_name', _actor)
  ON CONFLICT (profile_id) DO UPDATE
    SET date_of_birth = EXCLUDED.date_of_birth, guardian_name = EXCLUDED.guardian_name,
        guardian_phone = EXCLUDED.guardian_phone, guardian_email = EXCLUDED.guardian_email,
        gender = EXCLUDED.gender, blood_group = EXCLUDED.blood_group, address = EXCLUDED.address,
        father_name = EXCLUDED.father_name, mother_name = EXCLUDED.mother_name, updated_by = EXCLUDED.updated_by;

  PERFORM public._admission_apply_ticks(_id, e.institution_id, f->'documents', _actor);

  UPDATE public.admission_enquiries
     SET student_name = v_name, date_of_birth = v_dob, gender = v_gender, previous_school = coalesce(v_prev, previous_school),
         class_group_id = coalesce(v_group, class_group_id), form = form || v_form,
         admission_number = v_num, admitted_on = v_on, student_profile_id = _profile_id,
         stage = 'admitted', stage_changed_at = now(), updated_at = now()
   WHERE id = _id;
  PERFORM public._admission_note(_id, e.institution_id, 'stage', 'Admitted to ' || v_class_label || ' as ' || v_num || '.', _actor);

  -- In-app note to the school's admins (spec 5.4), not to the person who did it.
  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  SELECT p.id, 'admission_admitted', 'New admission',
         left(v_name, 80) || ' admitted to ' || v_class_label || ' (' || v_num || ').', '/school/admissions',
         jsonb_build_object('enquiry_id', _id, 'institution_id', e.institution_id, 'student_id', _profile_id)
    FROM public.profiles p
   WHERE p.institution_id = e.institution_id AND p.is_active IS NOT FALSE AND p.id <> _actor
     AND public.is_institution_admin(p.id, e.institution_id)
   LIMIT 20;

  RETURN jsonb_build_object('profile_id', _profile_id, 'admission_number', v_num, 'class_label', v_class_label, 'student_name', v_name);
END;
$$;

-- ── 11. the public enquiry form (service role only: admission-enquiry-intake) ─
CREATE OR REPLACE FUNCTION public._admission_public_school(_code text)
RETURNS TABLE (id uuid, name text, logo_url text, enabled boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.name, i.logo_url,
         EXISTS (SELECT 1 FROM public.institution_features f WHERE f.institution_id = i.id AND f.feature_id = 'admissions' AND f.is_enabled)
         AND coalesce((SELECT s.enquiry_form_enabled FROM public.admission_settings s WHERE s.institution_id = i.id), true)
    FROM public.institutions i
   WHERE upper(i.code) = upper(btrim(_code)) AND i.is_active IS NOT FALSE AND NOT i.is_system
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._admission_public_classes(_inst uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.ord NULLS LAST, x.name), '[]'::jsonb)
    FROM (SELECT DISTINCT ON (lower(g.name)) g.id, g.name, gl.display_order AS ord
            FROM public.class_groups g
            LEFT JOIN public.grade_levels gl ON gl.id = g.grade_level_id
           WHERE g.institution_id = _inst AND g.is_active
           ORDER BY lower(g.name), g.academic_year DESC, g.created_at DESC
           LIMIT 60) x;
$$;

CREATE OR REPLACE FUNCTION public.admission_public_context(_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sc record; v_today date; v_schema jsonb;
BEGIN
  SELECT * INTO sc FROM public._admission_public_school(_code);
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT sc.enabled THEN
    RETURN jsonb_build_object('school_name', sc.name, 'logo_url', sc.logo_url, 'enabled', false,
                              'classes', '[]'::jsonb, 'academic_years', '[]'::jsonb, 'questions', '[]'::jsonb);
  END IF;
  v_today := public._admission_today(sc.id);
  v_schema := coalesce((SELECT s.form_schema FROM public.admission_settings s WHERE s.institution_id = sc.id), '[]'::jsonb);
  RETURN jsonb_build_object(
    'school_name', sc.name, 'logo_url', sc.logo_url, 'enabled', true,
    'classes', public._admission_public_classes(sc.id),
    'academic_years', jsonb_build_array(public._admission_year_label(v_today, 0), public._admission_year_label(v_today, 1),
                                        public._admission_year_label(v_today, 2)),
    'questions', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', q->>'id', 'label', q->>'label', 'type', q->>'type',
                                                               'required', coalesce((q->>'required')::boolean, false),
                                                               'options', coalesce(q->'options', '[]'::jsonb),
                                                               'ask_at', jsonb_build_array('public'),
                                                               'help', q->'help') ORDER BY o), '[]'::jsonb)
                    FROM jsonb_array_elements(v_schema) WITH ORDINALITY y(q, o)
                   WHERE q->'ask_at' ? 'public'));
END;
$$;

CREATE OR REPLACE FUNCTION public.admission_public_submit(_code text, _ip_hash text, _fields jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f jsonb := coalesce(_fields, '{}'::jsonb);
  sc record; v_today date; v_schema jsonb; q jsonb;
  v_name text; v_parent text; v_phone text; v_email text; v_label text; v_year text; v_prev text; v_msg text;
  v_group uuid; v_group_name text; v_answers jsonb := '{}'::jsonb; v_a text; v_id uuid; v_ref text;
BEGIN
  SELECT * INTO sc FROM public._admission_public_school(_code);
  IF NOT FOUND OR NOT sc.enabled THEN
    PERFORM public._admission_refuse('This school is not taking online enquiries.', 'admission_form_closed');
  END IF;
  IF _ip_hash IS NULL OR length(_ip_hash) < 16 THEN PERFORM public._admission_refuse('That request is not readable.'); END IF;

  DELETE FROM public.admission_intake_hits WHERE created_at < now() - interval '2 days';
  IF (SELECT count(*) FROM public.admission_intake_hits h WHERE h.ip_hash = _ip_hash AND h.created_at > now() - interval '10 minutes') >= 5
     OR (SELECT count(*) FROM public.admission_intake_hits h WHERE h.institution_id = sc.id AND h.created_at > now() - interval '1 hour') >= 100 THEN
    PERFORM public._admission_refuse('Too many enquiries from here just now. Please try again later or call the school.', 'admission_rate_limited');
  END IF;

  v_today := public._admission_today(sc.id);
  v_name := public._admission_text(f->>'student_name', 120, 'the child''s name');
  v_parent := public._admission_text(f->>'parent_name', 120, 'the parent''s name');
  v_phone := regexp_replace(coalesce(f->>'parent_phone', ''), '\D', '', 'g');
  v_email := lower(public._admission_text(f->>'parent_email', 200, 'the email'));
  v_label := public._admission_text(f->>'applying_for', 80, 'the class');
  v_year := btrim(coalesce(f->>'academic_year', ''));
  v_prev := public._admission_text(f->>'previous_school', 200, 'the previous school');
  v_msg := public._admission_text(f->>'message', 1000, 'the message');
  IF v_name IS NULL THEN PERFORM public._admission_refuse('Enter the child''s name.'); END IF;
  IF v_parent IS NULL THEN PERFORM public._admission_refuse('Enter the parent''s name.'); END IF;
  IF v_phone !~ '^\d{10}$' THEN PERFORM public._admission_refuse('Enter the parent''s 10-digit mobile number.'); END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN PERFORM public._admission_refuse('That email address does not look right.'); END IF;
  IF v_year NOT IN (public._admission_year_label(v_today, 0), public._admission_year_label(v_today, 1), public._admission_year_label(v_today, 2)) THEN
    PERFORM public._admission_refuse('Choose the academic year.');
  END IF;
  IF nullif(f->>'class_group_id', '') IS NOT NULL THEN
    SELECT g.id, g.name INTO v_group, v_group_name FROM public.class_groups g
     WHERE g.id::text = f->>'class_group_id' AND g.institution_id = sc.id AND g.is_active;
    IF v_group IS NULL THEN PERFORM public._admission_refuse('Choose a class from the list.'); END IF;
    v_label := v_group_name;
  END IF;
  IF v_label IS NULL THEN PERFORM public._admission_refuse('Choose the class the child is applying for.'); END IF;

  -- The school's public questions: required ones answered, each answer in shape.
  v_schema := coalesce((SELECT s.form_schema FROM public.admission_settings s WHERE s.institution_id = sc.id), '[]'::jsonb);
  FOR q IN SELECT value FROM jsonb_array_elements(v_schema) WHERE value->'ask_at' ? 'public' LOOP
    v_a := CASE WHEN jsonb_typeof(f->'answers'->(q->>'id')) IN ('string', 'number', 'boolean')
                THEN btrim(f->'answers'->>(q->>'id')) END;
    IF coalesce(v_a, '') = '' THEN
      IF coalesce((q->>'required')::boolean, false) THEN PERFORM public._admission_refuse(format('Answer "%s".', left(q->>'label', 80))); END IF;
      CONTINUE;
    END IF;
    IF length(v_a) > 500 THEN PERFORM public._admission_refuse(format('Keep the answer to "%s" under 500 characters.', left(q->>'label', 80))); END IF;
    IF q->>'type' = 'number' AND v_a !~ '^-?\d+(\.\d+)?$' THEN PERFORM public._admission_refuse(format('"%s" needs a number.', left(q->>'label', 80))); END IF;
    IF q->>'type' = 'date' AND v_a !~ '^\d{4}-\d{2}-\d{2}$' THEN PERFORM public._admission_refuse(format('"%s" needs a date.', left(q->>'label', 80))); END IF;
    IF q->>'type' = 'yes_no' AND v_a NOT IN ('yes', 'no') THEN PERFORM public._admission_refuse(format('Answer yes or no to "%s".', left(q->>'label', 80))); END IF;
    IF q->>'type' = 'choice' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(q->'options', '[]'::jsonb)) o WHERE btrim(o) = v_a) THEN
      PERFORM public._admission_refuse(format('Choose one of the options for "%s".', left(q->>'label', 80)));
    END IF;
    v_answers := v_answers || jsonb_build_object(q->>'id', v_a);
  END LOOP;

  -- A double submit (same connection, child and phone) returns the first reference.
  PERFORM pg_advisory_xact_lock(hashtext('admission_public:' || sc.id::text || ':' || v_phone));
  SELECT e.id, e.reference_no INTO v_id, v_ref FROM public.admission_enquiries e
   WHERE e.institution_id = sc.id AND e.source = 'public_form' AND e.parent_phone = v_phone
     AND lower(e.student_name) = lower(v_name) AND e.created_at > now() - interval '10 minutes'
   ORDER BY e.created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('reference_no', v_ref);
  END IF;

  INSERT INTO public.admission_intake_hits (institution_id, ip_hash) VALUES (sc.id, _ip_hash);
  v_ref := public._admission_next_reference(sc.id);
  INSERT INTO public.admission_enquiries (institution_id, reference_no, source, student_name, class_group_id,
                                          applying_for_label, academic_year_label, parent_name, parent_phone,
                                          parent_email, previous_school, message, form, created_by)
  VALUES (sc.id, v_ref, 'public_form', v_name, v_group, v_label, v_year, v_parent, v_phone, v_email, v_prev, v_msg,
          jsonb_build_object('custom', v_answers), NULL)
  RETURNING id INTO v_id;
  PERFORM public._admission_note(v_id, sc.id, 'stage', 'Enquiry received from the online form.', NULL);

  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  SELECT p.id, 'admission_enquiry_received', 'New enquiry',
         left(v_name, 80) || ' for ' || left(v_label, 40) || ' (' || v_year || ').', '/school/admissions',
         jsonb_build_object('enquiry_id', v_id, 'institution_id', sc.id)
    FROM public.profiles p
   WHERE p.institution_id = sc.id AND p.is_active IS NOT FALSE AND public._admissions_can(p.id, sc.id)
     AND (public.is_institution_admin(p.id, sc.id)
          OR EXISTS (SELECT 1 FROM public.admissions_overrides o WHERE o.user_id = p.id AND o.institution_id = sc.id))
   LIMIT 50;

  RETURN jsonb_build_object('reference_no', v_ref);
END;
$$;

-- ── 12. grants (CLAUDE.md section 26: REVOKE anon BY NAME) ───────────────
DO $grants$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'admission\_%' OR p.proname LIKE '\_admission%' OR p.proname IN ('is_admissions_staff'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$grants$;

-- What the browser calls (and the two helpers the RLS / storage policies call).
GRANT EXECUTE ON FUNCTION public.is_admissions_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._admissions_staff_me() TO authenticated;
GRANT EXECUTE ON FUNCTION public._admission_object_ok(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_get_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_set_settings(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_list_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_staff_options(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_set_staff(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_create_enquiry(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_update_enquiry(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_add_note(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_register(uuid, integer, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_set_documents(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_set_document_file(uuid, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_remove_document_file(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_drop(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_reopen(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_pipeline(uuid, text, uuid, text, text, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_stage_counts(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admission_enquiry_detail(uuid) TO authenticated;
-- _admissions_can / _admissions_admin are also asked by admin-operations (service role).
REVOKE ALL ON FUNCTION public._admissions_can(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admissions_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admissions_can(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._admissions_admin(uuid, uuid) TO service_role;

-- ── 13. cron: retry queued scan deletes ───────────────────────────────────
DO $cron$
BEGIN
  PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'admission-docs-sweep-10min';
  PERFORM cron.schedule('admission-docs-sweep-10min', '*/10 * * * *', 'SELECT public.admission_docs_sweep_kick();');
END
$cron$;

NOTIFY pgrst, 'reload schema';
