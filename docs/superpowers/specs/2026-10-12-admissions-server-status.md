# Admissions: server status (2026-10-12)

The server half of the `NEEDS DB` / `NEEDS EDGE FN` in naman-erp `e0d3c99a`, `e2112713`,
`a4c829cc` and `9648ea07` is live on prod. Your contract is
`docs/superpowers/specs/2026-10-09-admissions-module-design.md`, section 5; this file lists only what
exists and where it differs from that contract.

## Live

| Piece | Contents |
|---|---|
| `20261012120000_admissions` | `admission_settings`, `admission_enquiries`, `admission_registrations`, `admission_notes`, `admission_documents` (with the scan columns), `admissions_overrides`, `admission_intake_hits`, `admission_document_trash`; the five `student_personal_details` columns; every RPC of section 5.2; bucket `admission-documents`; cron `admission-docs-sweep-10min` |
| edge fn `admission-enquiry-intake` | actions `context` and `submit` (section 5.3), deployed without JWT check |
| edge fn `admission-docs-sweep` | deletes queued scans through the Storage API (internal, webhook secret) |
| edge fn `admin-operations` | action `admit_student` |

Applied in one transaction, then `20261012130000` (item 13). Tests: `scripts/test-admissions.sql`
(99 checks, rolled back).
NEEDS CORE routes (`/school/admissions` for every staff role, `/enquire/:schoolCode` public) are added
in `App.tsx` at merge time.

## Signatures

All `authenticated`, none `anon`:

- `is_admissions_staff(_uid uuid) -> boolean`
- `admission_get_settings(_institution_id uuid) -> jsonb` (creates the defaults on first read)
- `admission_set_settings(_institution_id uuid, _patch jsonb) -> jsonb` (admins only; returns the new settings)
- `admission_list_staff(_institution_id uuid) -> jsonb` `[{user_id, full_name, role}]`, at most 200
- `admission_staff_options(_institution_id uuid) -> jsonb` same shape, admins only, at most 500
- `admission_set_staff(_institution_id uuid, _user_ids uuid[]) -> void` (admins only; replaces the list)
- `admission_create_enquiry(_institution_id uuid, _fields jsonb) -> jsonb` `{id, reference_no}`
- `admission_update_enquiry(_id uuid, _fields jsonb) -> void`
- `admission_add_note(_id uuid, _body text) -> void`
- `admission_register(_id uuid, _fee_rupees integer, _payment_mode text, _receipt_no text, _paid_on date, _note text DEFAULT NULL) -> void`
- `admission_set_documents(_id uuid, _ticks jsonb) -> void`
- `admission_set_document_file(_id uuid, _doc_key text, _file_path text, _file_name text, _file_size integer) -> void`
- `admission_remove_document_file(_id uuid, _doc_key text) -> void`
- `admission_drop(_id uuid, _reason text) -> void`, `admission_reopen(_id uuid) -> void`
- `admission_pipeline(_institution_id uuid, _stage text, _class_group_id uuid, _academic_year_label text, _q text, _limit integer, _offset integer, _assigned_to uuid DEFAULT NULL) -> jsonb` (an array of rows)
- `admission_stage_counts(_institution_id uuid, _academic_year_label text DEFAULT NULL) -> jsonb`
- `admission_enquiry_detail(_id uuid) -> jsonb`

Refusals are P0001 with a HINT: `admission_invalid`, `admission_wrong_stage`, `admission_number_taken`,
`admission_form_schema_invalid` (from the intake: also `admission_form_closed`,
`admission_rate_limited`). Not admissions staff: 42501. No such enquiry: P0002.

## Differences from your contract

1. **Admission numbers are unique across the whole platform**, not per school:
   `idx_profiles_admission_unique` is on `lower(admission_number)` over every profile (the number is
   a login identifier). A number held in the same school is refused naming the child ("Admission
   number 2026/041 is already with Riya Patel."); one held in another school is refused without a
   name ("...is already used by another school on SALCI. Use a different number, for example with
   your school's prefix."). Auto numbering skips every number already taken anywhere, so the number
   on the slip can be later than the one the form showed.
2. **`admit_student`** (admin-operations): checks everything that can be refused before it makes the
   sign-in account (`admission_admit_check`), then calls `admission_admit_tx`; if that fails, the
   account is removed and the message is returned. The account's email is a placeholder
   `adm.<16 hex>@temp.local`, never the guardian's (siblings share it); `login_id` is the
   admission number. The password is 10 characters (letters and digits, no look-alikes) and the
   account must change it at first sign-in. Returns `{profile_id, admission_number, login_id,
   password}`. The guardian's phone goes to `student_personal_details` only; `profiles.phone` is
   unique across the platform and stays empty. The section is set directly (the new student has
   none), not through `set_student_class`, whose own rights check refuses named staff.
3. **Removing a scan is not instant in Storage.** Storage refuses SQL deletes of `storage.objects`
   (`storage.protect_delete`), so `admission_remove_document_file` clears the row and queues the
   object; `admission-docs-sweep` deletes it within seconds (retried every 10 minutes). Replacing a
   scan with a file of another extension queues the old object the same way. The tick stays.
4. **Bucket `admission-documents`**: private, 10 MB, `image/jpeg`, `image/png`, `image/webp`,
   `image/heic`, `image/heif`, `image/gif`, `application/pdf` (no SVG). Upload, overwrite and read
   only for `<institution>/<enquiry>/<doc_key>.<ext>` of a registered or admitted enquiry of the
   caller's school; there is no delete policy. `admission_set_document_file` refuses a file that is
   not in the bucket ("The upload did not finish. Try again.").
5. **The intake resolves the school by `institutions.code`** (case-insensitive), not `short_code`.
   `context` answers 404 for an unknown code and 200 `{school_name, logo_url, enabled: false,
   classes: [], academic_years: [], questions: []}` when the school's `admissions` feature is off
   or its form is switched off. `classes` are the school's active class groups, one per name.
   `academic_years` are this year and the next two. Each question carries
   `id, label, type, required, options, ask_at, help`, with `ask_at` always `["public"]`.
   `submit` answers `{reference_no}`; 404 `{error}` when closed, 429 `{error}` when rate-limited,
   400 `{error}` naming the field or question. A filled `website` answers 200
   `{reference_no: "ENQ-RECEIVED"}` and writes nothing. The same child and phone within 10 minutes
   returns the first reference.
6. **`is_admissions_staff(_uid)`** answers for another user only to that school's admins (anyone
   else gets `false`). Super admins count as admins of every school.
7. **`admission_update_enquiry`** changes only the keys present in `_fields`. An online-form
   enquiry keeps `source = 'public_form'`. Once admitted, only `assigned_to` and
   `next_follow_up_on` may change (anything else: `admission_wrong_stage`). A changed follow-up or
   handler writes a `follow_up` note.
8. **Repeats are absorbed**: the same caller, child, phone and year within 60 seconds returns the
   first enquiry; the same note within 15 seconds is posted once; a second remove of a scan does
   nothing.
9. **`admission_pipeline`**: `_limit` 1 to 100; `_q` matches the child's and parent's names, the
   reference, the admission number, and 3 or more phone digits; `other_enquiries` is at most 5 per
   row. Reference numbers are `ENQ-<year>-<0001>`, per school.
10. **Notifications**: `admission_enquiry_received` (online form; the school's admins and named staff)
    and `admission_admitted` (the school's admins, not the person who admitted). Not built:
    `admission_follow_up_due`.
11. **Settings**: a checklist item's `key` is `[a-z0-9_]`, 1 to 60 characters, unique, and its label
    is at most 80 characters (at most 40 items). The prefix is up to 20 of letters, digits, `/ . _ -`
    and space. `form_schema` is normalised on save: labels, options and hints are trimmed, blank
    options are dropped, `ask_at` is ordered enquiry, admission, public, and an empty hint becomes
    null.
12. Admissions staff may read every `classes` row of their school (policy
    `classes_select_admissions_staff`).
13. `admissions_overrides` has an `id` primary key; `(user_id, institution_id)` is UNIQUE
    (`20261012130000`, the same day). Its rows are read by their own user and by that school's
    admins.
