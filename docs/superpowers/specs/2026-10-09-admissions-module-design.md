# Admissions module: enquiry, registration, admission

**Date:** 2026-10-09
**Status:** Design. Frontend to be built on `naman-erp` behind a schema probe (the page renders a
"setup pending" state until the tables exist); every table, RPC and edge function in section 5 is
`NEEDS DB` / `NEEDS EDGE FN` (Tushar). Nothing here touches an existing table except two optional
columns on `student_personal_details` (5.1) and one new feature id.

## 1. Why, and the workflow in Naman's words (2026-10-09)

The ERP roadmap, the expansion plan and the in-app builder guide all name Admissions and Enquiry as
the largest unbuilt gap, with no upstream dependency: it feeds the whole student lifecycle. Naman
described how the schools actually run it:

> "up to enquiry you are right, then move student to registration where 1000 rs fee is collected
> and then the admission goes on, may be immediate or after some time or days, but the registration
> being saved, and then when parent finally came for admission they filled a physical form with all
> the data and receptionist has tick and select option that which certificates has been collected
> and then the student got an admission number"

So the pipeline is three real steps, not the generic application / test / offer ladder of the
builder guide:

1. **Enquiry.** A parent asks about a seat: from the school's public enquiry link, or the front
   desk types it in after a call or a walk-in. Name of the child, class applying for, academic
   year, parent name and phone, optional email, previous school, how they heard. The desk follows
   up (notes, a next follow-up date, who is handling it).
2. **Registration.** The parent pays the registration fee (the school's default, Rs 1000 today).
   The desk records amount, mode, receipt number and date. The enquiry is now **registered** and
   stays so for days or weeks; nothing else is needed yet.
3. **Admission.** The parent comes with the filled physical form. The receptionist enters all the
   data, ticks which certificates were collected, picks the class and section, gives the
   **admission number**, and the child becomes a student: account, profile, role, class, personal
   details, in ONE server transaction. From then on the child is in Manage Users like anyone else.

An enquiry can be **dropped** at either of the first two steps with a reason, and reopened.

## 2. The model

| Record | Meaning |
|---|---|
| `admission_settings` | one row per school: default registration fee, the certificate checklist, the admission-number scheme, whether the public form is on, and `form_schema`: the school's own questions (3.16) |
| `admission_enquiries` | one row per child enquiring, with its **stage** (`enquiry`, `registered`, `admitted`, `dropped`); the registration and admission facts hang off it; `student_profile_id` points at the created student after admission |
| `admission_registrations` | the fee record of a registered enquiry (one per enquiry) |
| `admission_notes` | follow-up notes and stage changes, newest first |
| `admission_documents` | the certificate checklist of an enquiry, one row per document key, ticked or not |

Stages move only forward (`enquiry` → `registered` → `admitted`), with `dropped` reachable from the
first two and `reopen` returning a dropped enquiry to the stage it was dropped from. `admitted` is
final: the student exists; undoing it means deleting the student (existing, audited flow).

## 3. Permutations and the rule for each

| # | Case | Rule |
|---|---|---|
| 1 | Parent fills the public form | Row with `source = public_form`, `created_by` NULL, stage `enquiry`; admissions staff get an in-app notification; the form shows a reference number and "the school will call you". |
| 2 | Front desk enters an enquiry | Same row, `source` in `walk_in`, `phone`, `referral`, `other`, `created_by` = the desk user. |
| 3 | Same phone enquires twice | Allowed (siblings, repeat calls), but the list shows "Also enquired: <child> on <date>" under the row, from a server match on `parent_phone`. Never auto-merged. |
| 4 | Register | Only from `enquiry`. Fee defaults to the school's setting, editable; mode in `cash`, `upi`, `card`, `bank`, `cheque`; receipt number required (free text; the school writes its own book numbers); date defaults to today. One registration per enquiry (`UNIQUE (enquiry_id)`); a second attempt is refused and named. |
| 5 | Admit | Only from `registered`. Needs: full name, date of birth, gender, guardian name and phone, class **section**, admission number, at least the checklist saved (unticked items are allowed, they show as "pending" on the student). Creates the student in one transaction (5.2). |
| 6 | Admission number already used in the school | Refused before anything is created: "Admission number 2026/041 is already with Riya Patel." (`profiles.admission_number` is unique per institution today through the roster validation; the RPC checks it under a lock). |
| 7 | Auto numbering (Naman, 2026-10-09: "auto from a school prefix") | The school sets a prefix and the next number once, in Settings. The admit form pre-fills `<prefix><seq>` (for example `2026/041`), editable; at commit the server takes the next free number when the field was left as pre-filled, so two desks never get the same one, and keeps a typed override after the uniqueness check. Until the prefix is set the field is empty and the sheet links to Settings. |
| 8 | Student login after admission | As today for a student made from Manage Users: login by admission number (`resolve-login-identifier` already supports it) or email when given; a temporary password is returned once and printed on the admission slip; `must_reset_password` is set. A student with no email gets the `@temp.local` placeholder the create-user action already synthesises. |
| 9 | Guardian details | Go to `student_personal_details` (DOB, guardian name, phone, email: existing columns). Gender, blood group, address, father's and mother's names: new nullable columns there (5.1), the natural home, still school-managed and read-only for the student. |
| 10 | Documents | The checklist comes from settings (default: birth certificate, transfer certificate, previous report card, Aadhaar of the child, Aadhaar of a parent, passport photos, address proof, category certificate, medical certificate). Ticks are saved any time after registration, before or at admission. **Scans (Naman, 2026-10-12: "an option to upload the documents as well"):** each row takes one photo or PDF (10 MB) into the private bucket `admission-documents` at `<school>/<enquiry>/<doc_key>.<ext>` (a second upload replaces it); uploading ticks the certificate; View opens a 5-minute signed link; Remove clears the row and deletes the object in one RPC. |
| 11 | Drop | From `enquiry` or `registered`, reason required; a registered child keeps the fee record (refund is outside the system). Reopen puts it back where it was. |
| 12 | Academic year and class | "Applying for" is a **class group** (grade) of the school and an academic year label (the next year, usually); the **section** is chosen only at admission, through the existing `set_student_class`. Class groups live in `class_groups` (CLAUDE.md section 22). |
| 13 | Who may work the pipeline | School admins always; any other staff account named in `admissions_overrides` (a receptionist is usually an `employee`), checked by `is_admissions_staff(uid)` on every RPC. Teachers and students never. |
| 14 | Feature gating | New feature id `admissions` (operations, default off). Sidebar entry, dashboard tile and the route all gate on it; the public form checks `enquiry_form_enabled` in settings instead (a parent has no login). |
| 16 | The school's own questions (Naman, 2026-10-12: "edited like we create a google form, different schools, different things, so they can design accordingly"; then "simplify this form, from a new person's point of view it is very confusing"; then "make it very simplified like in google form"; then "a little professional, nothing can be understood in this") | Settings holds `form_schema`: an ordered list of questions, each `{id, label, type, required, options, ask_at, help}` with `type` in `short_text`, `long_text`, `number`, `date`, `choice`, `yes_no` and `ask_at` a subset of `enquiry` (the desk's New enquiry), `admission` (the admit form), `public` (the online form). The built-in fields never move. The designer is a small labelled form per question, so every control says what it is: a "Question N" header, then Question, Answer type (Text, Long text, Number, Date, Pick one, Yes / No), Hint (optional), Asked on (four everyday choices: Everywhere, Online form only, At the school only, Admission form only; any other stored combination shows as "Some places" and is kept), the Choices of a Pick one as editable rows with "Add a choice", a line saying what the parent answers with otherwise, and a footer with "Must answer", Move up, Move down and Remove in plain sight. No hidden menus, no drag and drop. Answers live in `admission_enquiries.form.custom` keyed by question id; a form at a stage replaces the answers of the questions it asked and keeps the rest, so an enquiry edit never wipes admission-time answers. The record lists the answers by question label (a removed question's answer stays in the row but is not shown). Required is checked by the client and, for the public form, by the intake function. |
| 15 | Counts | Stage counts and "this year" totals come from `admission_stage_counts` (server-side), never from the fetched page. |
| 16 | Lists | `admission_pipeline` is paginated (`range`), filtered by stage, class group, academic year, assignee and a search on child name or parent phone; the page shows 50 at a time. |
| 17 | Audit | `tg_audit_row` on every new table (CLAUDE.md section 11); admission conversion also writes the existing user-creation audit through `admin-operations`. |

## 4. What each role sees (frontend)

**Admin, and staff in `admissions_overrides`.** `/school/admissions`:

- Header "Admissions", primary action "New enquiry", kebab: "Enquiry link" (copy or QR of the
  public form), "Settings" (fee default, checklist, numbering, the school's own questions (3.16),
  staff, public form on or off).
- Clay stat tiles for the chosen academic year: Enquiries, Registered, Admitted, Dropped.
- Stage pills (All, Enquiry, Registered, Admitted, Dropped), a class-group and year filter, a
  search box, then a `ListRow` list: child's name, "Class 5 · 2027-28", parent phone, stage badge,
  and a second line with the next follow-up or "registered 12 days ago". Error state before empty
  state; paginated "Show more".
- **Enquiry detail sheet.** A centred record: a lifted status bar (stage badge, source, date,
  Edit details, the three-step stepper), then four cards on a faintly tinted backdrop, each with a
  2px top edge in its tone, a faintly tinted header strip with a small tinted icon square beside
  the title, and a deeper shadow (Naman, 2026-10-12: "make it more distinguished", then "more
  professional, currently looking a bit childish", then "highlight the boxes more": the clay
  pebbles and gradient bands stay on the FORMS, never on the record), read
  ACROSS on a wide screen (Naman, 2026-10-12: "make it horizontal view"): the sheet widens to `max-w-6xl`
  from `lg`, Details (teal), Registration fee (mint, the amount as a figure) and Activity
  (violet, the notes timeline) share one row, and Certificates (peach) runs full width under
  them with its rows in three ruled columns (two at `md`, one on a phone; names never cut,
  icon-only Upload and View). On a phone the order is Details, Certificates, Fee, Activity. The
  local ticks follow the server's whenever they change, so the ticks made on the admit form show
  as soon as the record refreshes. The actions of its stage sit in the footer: Enquiry → Register, Drop;
  Registered → Admit, Documents, Drop; Admitted → Open student; Dropped → Reopen. Every action is a
  `MobileSheet` with a confirm where something irreversible happens (Admit, Drop).
- **Admit sheet** is the physical form: student (name, DOB, gender, blood group), guardian (father,
  mother, guardian name, phone, email, address), schooling (previous school, class group, section),
  the school's own questions marked for the admission form, the certificate checklist, the admission
  number (pre-filled when auto numbering is on), the admission date. On success: a slip view with
  the admission number, the login id and the one-time password, with Print and Copy. New enquiry
  likewise ends with the questions marked for the desk.

**Parent (no login).** `/enquire/:schoolCode`: the school's name and logo, a short form (child's
name, class applying for, academic year, parent name, phone, email, previous school, the school's
own questions marked for the online form, message), mobile-first, works at 375px, honeypot field,
submit once; a success screen with a reference number.
Off when the school turns the form off ("This school takes enquiries at the front desk.").

**Dashboard.** A Feature tile "Admissions" for admins (gated), showing this year's enquiry count.

## 5. Server contract (`NEEDS DB` / `NEEDS EDGE FN`, Tushar)

Names follow the `admission_*` family. Every RPC is SECURITY DEFINER with `REVOKE ... FROM anon`
by name, every policy calls SECURITY DEFINER helpers only, every UPDATE policy has USING and WITH
CHECK, every FK gets an index, every table gets `tg_audit_row` (CLAUDE.md sections 11, 23, 26).

### 5.1 Schema

```sql
CREATE TABLE public.admission_settings (
  institution_id           uuid PRIMARY KEY REFERENCES public.institutions(id) ON DELETE CASCADE,
  registration_fee_rupees  integer NOT NULL DEFAULT 1000 CHECK (registration_fee_rupees >= 0),
  document_checklist       jsonb NOT NULL DEFAULT '[...]',   -- [{key, label}] in display order, the defaults of 3.10
  admission_number_prefix  text NULL,                          -- NULL until the school sets it; the admit form then asks for it
  next_admission_seq       integer NOT NULL DEFAULT 1,
  enquiry_form_enabled     boolean NOT NULL DEFAULT true,
  form_schema              jsonb NOT NULL DEFAULT '[]',     -- 3.16: [{id, label, type, required, options, ask_at, help}] in display order (2026-10-12)
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE public.admission_enquiries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id      uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  reference_no        text NOT NULL,                    -- "ENQ-2026-0041", per school, shown to the parent
  stage               text NOT NULL DEFAULT 'enquiry' CHECK (stage IN ('enquiry','registered','admitted','dropped')),
  stage_before_drop   text NULL,                        -- for reopen
  stage_changed_at    timestamptz NOT NULL DEFAULT now(),
  source              text NOT NULL DEFAULT 'walk_in' CHECK (source IN ('public_form','walk_in','phone','referral','other')),
  student_name        text NOT NULL,
  date_of_birth       date NULL,
  gender              text NULL,
  class_group_id      uuid NULL REFERENCES public.class_groups(id) ON DELETE SET NULL,
  applying_for_label  text NOT NULL,                    -- the grade as typed or chosen, kept if the group goes
  academic_year_label text NOT NULL,                    -- "2027-28"
  parent_name         text NOT NULL,
  parent_phone        text NOT NULL,                    -- 10 digits, normalised as PhoneInput does
  parent_email        text NULL,
  previous_school     text NULL,
  message             text NULL,
  assigned_to         uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  next_follow_up_on   date NULL,
  dropped_reason      text NULL,
  admission_number    text NULL,                        -- set at admission (also on the profile)
  admitted_on         date NULL,
  student_profile_id  uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  form                jsonb NOT NULL DEFAULT '{}',      -- the rest of the physical form (address, father, mother, blood group) and `custom`: {question id: answer} for the school's own questions (3.16)
  created_by          uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,  -- NULL for the public form
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, reference_no)
);
CREATE INDEX ON public.admission_enquiries (institution_id, stage);
CREATE INDEX ON public.admission_enquiries (institution_id, parent_phone);
CREATE INDEX ON public.admission_enquiries (class_group_id);
CREATE INDEX ON public.admission_enquiries (assigned_to);
CREATE INDEX ON public.admission_enquiries (student_profile_id);
CREATE INDEX ON public.admission_enquiries (created_by);

CREATE TABLE public.admission_registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id      uuid NOT NULL UNIQUE REFERENCES public.admission_enquiries(id) ON DELETE CASCADE,
  institution_id  uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  fee_rupees      integer NOT NULL CHECK (fee_rupees >= 0),
  payment_mode    text NOT NULL CHECK (payment_mode IN ('cash','upi','card','bank','cheque')),
  receipt_no      text NOT NULL,
  paid_on         date NOT NULL DEFAULT CURRENT_DATE,  -- the desk's date, entered, not now()
  note            text NULL,
  collected_by    uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.admission_registrations (institution_id);
CREATE INDEX ON public.admission_registrations (collected_by);

CREATE TABLE public.admission_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id  uuid NOT NULL REFERENCES public.admission_enquiries(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','stage','follow_up')),
  body        text NOT NULL,
  created_by  uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.admission_notes (enquiry_id, created_at DESC);
CREATE INDEX ON public.admission_notes (created_by);

CREATE TABLE public.admission_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id    uuid NOT NULL REFERENCES public.admission_enquiries(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  doc_key       text NOT NULL,
  label         text NOT NULL,
  collected     boolean NOT NULL DEFAULT false,
  collected_at  timestamptz NULL,
  collected_by  uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (enquiry_id, doc_key)
);
CREATE INDEX ON public.admission_documents (institution_id);
CREATE INDEX ON public.admission_documents (collected_by);

-- Scans (2026-10-12): one object per certificate, recorded on the row.
ALTER TABLE public.admission_documents
  ADD COLUMN file_path text NULL, ADD COLUMN file_name text NULL, ADD COLUMN file_size integer NULL,
  ADD COLUMN uploaded_at timestamptz NULL, ADD COLUMN uploaded_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX ON public.admission_documents (uploaded_by);
-- Storage: private bucket `admission-documents` (no public read; 10 MB file limit; images and PDF).
-- storage.objects policies for the bucket: INSERT / UPDATE / SELECT / DELETE for authenticated
-- callers where `is_admissions_staff(auth.uid())` and the object's first path segment is the
-- caller's institution id (SECURITY DEFINER helper, no inline cross-table EXISTS).

CREATE TABLE public.admissions_overrides (          -- as tt_/staff_/syllabus_ overrides
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  granted_by     uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, institution_id)
);
CREATE FUNCTION public.is_admissions_staff(_uid uuid) RETURNS boolean ...;   -- admin OR override

ALTER TABLE public.student_personal_details
  ADD COLUMN gender text NULL, ADD COLUMN blood_group text NULL, ADD COLUMN address text NULL,
  ADD COLUMN father_name text NULL, ADD COLUMN mother_name text NULL;
-- `institution_features`: new feature id 'admissions' (frontend registry too, 6).
```

RLS: staff of the institution with `is_admissions_staff` read and write through the RPCs only
(tables readable to them, writable to nobody but the SECURITY DEFINER functions); students and
teachers see nothing; the public form never touches the tables directly (5.3).

### 5.2 RPCs (authenticated, `is_admissions_staff` unless said otherwise)

- `admission_get_settings(_institution_id)` → the settings row, created with defaults on first
  read. `admission_set_settings(_institution_id, _patch jsonb)` (admin only). A `form_schema` in
  the patch is validated before it is stored: an array of at most 50 objects, each with a non-empty
  `id` (unique in the array) and `label`, `type` in the six kinds, boolean `required`, `options`
  an array of strings (at least two distinct ones when `type = 'choice'`), `ask_at` a non-empty
  subset of `enquiry`, `admission`, `public`, and `help` text or null; anything else → P0001 HINT
  `admission_form_schema_invalid`. The client sends the whole list on every save.
- `admission_create_enquiry(_institution_id, _fields jsonb)` → `{id, reference_no}`; allocates
  `reference_no` under a per-school advisory lock; writes a `stage` note "Enquiry received".
  `_fields.form` (when given) is stored as the row's `form`; the client sends `{custom: {...}}`.
- `admission_update_enquiry(_id, _fields jsonb)` (name, DOB, parent, class group, year, follow-up,
  assignee, previous school, message, `form`); refused once `admitted` except `assigned_to` and
  `next_follow_up_on`. `_fields.form` merges at the top level (`form = form || _fields->'form'`),
  so a `custom` object given replaces the stored `custom` whole: the client always sends the full
  answer set (the asked questions' new answers plus every other stored answer).
- `admission_add_note(_id, _body)`.
- `admission_register(_id, _fee_rupees, _payment_mode, _receipt_no, _paid_on, _note)` → stage
  `registered`; P0001 HINT `admission_wrong_stage` ("This enquiry is already registered." /
  "...was dropped. Reopen it first."); seeds `admission_documents` from the school's checklist.
- `admission_set_documents(_id, _ticks jsonb)` with `[{doc_key, collected}]`; only from
  `registered` or `admitted` (the student's checklist can still be completed later).
- `admission_set_document_file(_id, _doc_key, _file_path, _file_name, _file_size)`: records the
  scan the client just uploaded and sets `collected = true` (a scan in hand is the certificate in
  hand); refuses a path outside `<institution_id>/<_id>/`. `admission_remove_document_file(_id,
  _doc_key)`: deletes the object (`DELETE FROM storage.objects`) and clears the file columns in one
  transaction; the tick stays as it was.
- `admission_drop(_id, _reason)`, `admission_reopen(_id)`.
- `admission_admit_tx(_id, _profile_id, _fields jsonb)`: the transactional half of admission,
  called ONLY by the edge function below after the auth user exists: checks stage `registered`,
  checks the admission number is free in the school (`profiles.admission_number`, P0001 HINT
  `admission_number_taken` naming who has it) or takes the next auto number, upserts the profile
  ON id (`handle_new_user` pre-creates it: CLAUDE.md section 11), inserts the `student` role,
  calls `set_student_class(_profile_id, _class_id)`, upserts `student_personal_details`, stamps
  `admission_number`, `admitted_on`, `student_profile_id`, stage `admitted`, writes the stage
  note, bumps `next_admission_seq`. Everything or nothing. `_fields.form` (blood group, parents,
  address, `custom`) merges into the row's `form` the same top-level way as the update RPC.
  `_fields.documents` (`[{doc_key, collected}]`, the ticks of the admit form) is applied to
  `admission_documents` exactly as `admission_set_documents` would (`collected`, `collected_at`,
  `collected_by`; a key the school's list no longer has is ignored) BEFORE the stage flips, so
  the record shows the ticks the desk made at admission (Naman, 2026-10-12: "I have marked some
  certificates as received but it is not showing").
- Reads: `admission_pipeline(_institution_id, _stage, _class_group_id, _academic_year_label,
  _assigned_to, _q, _limit, _offset)` → rows with the registration summary, the document counts
  (collected / total), `other_enquiries` (same phone), and `next_follow_up_on`; `admission_stage_counts(_institution_id, _academic_year_label)` →
  `{enquiry, registered, admitted, dropped}`; `admission_enquiry_detail(_id)` → the row plus
  registration, documents and notes (notes capped at 200).

### 5.3 Edge functions

- `admission-enquiry-intake` (public, unauthenticated, the platform's first unauthenticated
  write). Two actions. `context` `{school_code}` → `{school_name, logo_url, enabled, classes,
  academic_years, questions}` where `questions` is the school's `form_schema` filtered to
  `ask_at ∋ 'public'`, in order, each with only `id, label, type, required, options, help` (the
  frontend calls this on every open of `/enquire/:schoolCode`). `submit` `{school_code,
  student_name, class_group_id, applying_for, academic_year, parent_name, parent_phone,
  parent_email, previous_school, message, answers, website}` (`website` is the honeypot: any
  value → 200 with nothing written). Validates first, resolves the school by `short_code`, refuses
  when `enquiry_form_enabled` is false (404 shape), rate-limits per IP and per school (a small
  `admission_intake_hits` table or the edge runtime's KV; 5 per IP per 10 minutes, 100 per school
  per hour), checks `answers` against the public questions (every `required` one present; a
  `choice` answer among its options; `yes_no` is `yes` or `no`; `number` and `date` well-formed;
  every string at most 500 characters; ids that are not public questions dropped; a bad answer →
  400 naming the question), inserts with `source = 'public_form'` and `form = {custom: answers}`
  through the service role, notifies every `is_admissions_staff` user in-app ("New enquiry: Aarav
  Sharma for Class 5"), returns `{reference_no}`. Never echoes other rows.
- `admin-operations` action `admit_student` (admin or `is_admissions_staff`): creates the auth
  user exactly as `create_user` does for a student (email or the `@temp.local` placeholder,
  temporary password, `must_reset_password`), then calls `admission_admit_tx`; if the RPC raises,
  it deletes the auth user it just made and returns the RPC's message, so a failed admission
  leaves no half-made student. Returns `{profile_id, admission_number, login_id, password}`.

### 5.4 Notifications

In-app only in v1: `admission_enquiry_received` (to admissions staff, from the public form),
`admission_follow_up_due` (daily cron to the assignee, like the PTM reminders), `admission_admitted`
(to admins). Parent messaging (SMS or email on registration and admission) waits for the
communication stack (CLAUDE.md section 11, "Communication → Settings").

### 5.5 Probe

The frontend adds a schema probe `select institution_id from admission_settings limit 0`
(42P01 → the page shows "Admissions switches on once this school's setup is finished", as the PTM
tab did). The public form shows "This school is not taking online enquiries yet" when the intake
function returns 404.

## 6. Frontend map (to build on `naman-erp`)

| Piece | What |
|---|---|
| `src/lib/admissions.ts` | pure: stage machine (`nextStages`, `canRegister`, `canAdmit`), `admissionNumberPreview(prefix, seq)`, checklist defaults, form validation, `phoneToSave` reuse |
| `src/hooks/admissions/` | `useAdmissionsReady` (probe), `useAdmissionSettings`, `useAdmissionPipeline` (paginated), `useAdmissionStageCounts`, `useAdmissionEnquiry`, mutations one per RPC, `useAdmitStudent` (edge action), keys with explicit `staleTime` |
| `src/pages/school/AdmissionsPage.tsx` | the list page of section 4 (`PageShell`, `PageHeader`, `ClayStatTile`, stage pills, `FilterRow`, `ListRow`, error before empty) |
| `src/components/admissions/` | `EnquiryDetailSheet` (centred record), `NewEnquirySheet`, `RegisterSheet`, `AdmitSheet` (+ `AdmissionSlip`), `DocumentChecklist` (ticks plus upload, view, replace, remove per row), `DropSheet`, `AdmissionSettingsSheet`, `FormDesigner` (the school's own questions, 3.16), `CustomQuestions` (renders them as fields on the three forms), `EnquiryLinkSheet` (QR via the existing QR component), `EnquiryRow` (the register row) |
| `src/pages/public/EnquiryPage.tsx` | `/enquire/:schoolCode`, no login, 375px first |
| `featuresData.ts`, `FEATURE_URL_MAP`, `AppSidebar`, dashboard hub | feature id `admissions`, route `/school/admissions`, sidebar under School Management, admin tile |
| `docs/admissions-module.md` | the module doc, written with the first push |

## 7. Verification

- Node asserts over `src/lib/admissions.ts`: every transition of the stage machine (allowed and
  refused), the auto-number preview, the form validation (phone, DOB, required fields), the
  school's-questions rules (question and schema errors, the four "where" presets, answers checked
  per type, the merge that keeps the other stage's answers, reorder, normalisation).
- Browser harness (`ptm-preview` style, stubbed client): the list with the four stages and
  counts; New enquiry; Register with the fee default; Admit end to end with the slip; Drop and
  Reopen; the public form at 375px including the honeypot and the "not taking enquiries" state;
  error state before empty state on every list; the designer at 1280 and 375 (seeded, add, type
  change, options, must answer, where, reorder, remove, the saved `form_schema`) and the questions
  on New enquiry, Admit, the public form and the record. Light and dark.
- Gate: typecheck, eslint, `vite build`, `test:cache`, stale-import pass; screenshots to the
  Desktop.

## 8. Out of scope (named so they are not assumed)

- Entrance tests and interviews (the schools Naman described do not run them at admission).
- AI verification of the uploaded scans (the desk looks at them; nothing reads them).
- Refunds of the registration fee, and posting the fee into Fee Management (a later link from
  `admission_registrations` to `fee_receipts`).
- SMS or email to the parent (section 5.4).
- Transfers, medical records, alumni (the rest of the builder guide's phase 7).

## 9. Decisions still open (defaults stated, Naman can change them)

| Question | Default in this design |
|---|---|
| Admission number | **decided 2026-10-09:** auto from a school prefix and next number (Settings), pre-filled and editable, unique per school |
| Registration receipt number | typed from the school's receipt book, required |
| Who works the pipeline | **decided 2026-10-09:** school admins, plus named staff through `admissions_overrides` (set from Manage Users) |
| Applying for | a class group of the school (grade), section chosen at admission |
