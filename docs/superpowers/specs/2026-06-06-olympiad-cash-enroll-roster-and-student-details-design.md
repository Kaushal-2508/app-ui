# Olympiad Cash-Enroll — Roster-Driven Form + Student Personal-Details Write-Back

**Date:** 2026-06-06
**Status:** Approved design — ready for implementation plan
**Branch:** `feat/olympiad-cash-enroll-roster-writeback`

## 1. Goal

Restructure the Olympiad **"Enroll cash student"** form (shown to existing-SALCI-school teachers) from a generic free-text form into cascading **Class → Section → Student** dropdowns that map each enrollment to a real SALCI student (`profiles` row). Then **persist the collected date-of-birth + guardian contact to the student's SALCI identity** (new table) and surface it read-only on the student's Profile page, so the data lives with the student rather than only in the isolated Olympiad snapshot.

## 2. Scope boundary

This applies **only to existing-SALCI schools** (`oly_schools.is_existing_salci_school = true`). Net-new (non-SALCI) Olympiad schools have no `profiles` rows to pick from or link to, so `CashEnrollSheet` keeps today's manual free-text form for them. The component branches on the flag.

## 3. Background & key findings (from exploration)

These are the load-bearing facts the design depends on. They are NOT obvious from a casual read of the code.

- **`oly_students.profile_id`** (`uuid REFERENCES profiles(id) ON DELETE SET NULL`, indexed `idx_oly_students_profile`) already exists but the cash-enroll edge function **never sets it**.
- **The student-side Olympiad portal already resolves by `profile_id`.** [useOlympiadStudentEnrollment.ts](../../../src/hooks/olympiad/useOlympiadStudentEnrollment.ts) does `.or(auth_user_id.eq.${user.id}, profile_id.eq.${user.id})` and sets `is_olympiad_only: profile_id == null`. So linking `profile_id` (= the student's `profiles.id`, which *is* their auth uid) means the student sees their Olympiad enrollment when logged in with their **normal SALCI credentials** — no synthetic `ddmmyy` account.
- **The cash-enroll edge fn already self-skips synthetic-auth creation when `profile_id` is set** ([oly-cash-enroll/index.ts:32](../../../supabase/functions/oly-cash-enroll/index.ts)). So setting `profile_id` is sufficient; no auth changes needed.
- **`profiles` has NO `date_of_birth` and NO guardian/parent columns.** Authoritative column list (generated `types.ts`): `id, institution_id, full_name, email, phone, avatar_url, is_active, admission_number, roll_number, onboarding_completed, mascot_*, password_*, tour_steps_completed, created_at, updated_at`. Every `date_of_birth` in the schema is on `oly_students` / `oly_enrollment_pending` only.
- **Regular SALCI students have parent/guardian contact stored nowhere.** `parent_student_links` links a parent *profile* to a student profile but holds **no contact fields**. There is no `parent` app_role.
- **Latent bug:** `oly_lookup_salci_student` (migration `20260526050916`) does `SELECT p.date_of_birth FROM profiles p`. The column does not exist; PL/pgSQL bodies are not schema-validated at `CREATE`, so it compiles but **throws at runtime the moment a matching student is found**. The existing-school *parent online* enrollment ([EnrollmentFormSalci.tsx](../../../src/components/olympiad/public/EnrollmentFormSalci.tsx)) "Find" button depends on it. We fix it as part of this work.
- **`profiles` UPDATE RLS:** allowed for self, `school_admin`, and `coordinator` (migrations `20260502120000` etc.) — **teachers cannot** update another profile. But the cash-enroll **edge function runs with the service role**, so it can persist student details regardless; no new teacher-facing write RLS is required.
- **Student-facing surface today:** [ProfilePage.tsx](../../../src/pages/ProfilePage.tsx) (`useProfileData`) shows name/email/phone/class/institution/account-status only. It does not surface DOB, guardian contact, admission no, or roll no.
- **`oly_is_teacher_for_class(p_uid, p_oly_school_id, p_grade_level_id)`** and **`oly_is_school_admin_for(p_uid, p_oly_school_id)`** are the existing SECURITY DEFINER authz helpers; `is_super_admin(user_id)` exists too.
- **Class hierarchy (§22):** `class_groups` (parent, has `grade_level_id` + `institution_id`) → `classes` (sections, `class_group_id`, `section`) → `class_assignments(user_id, class_id, role='student')` → `profiles`. Olympiad teacher assignment is **grade-level** (`oly_teacher_class_assignments(oly_school_id, grade_level_id, campaign_id)`), not section-level.
- **`useSubjectsForGrade` short-circuits to `[]` when `subjectIds.length === 0`** ([OlympiadTeacherClassPage.tsx:64](../../../src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx)). Today the cash form's `availableSubjects` is derived from *already-enrolled* students' subjects, so an empty class shows no subject picker. The restructure replaces this with a dedicated grade-subjects hook.

## 4. Part 1 — Form restructure (existing-school branch)

`CashEnrollSheet` is mounted in exactly one place ([OlympiadTeacherClassPage.tsx:250](../../../src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx)). It remains a `MobileSheet`. When `is_existing_salci_school` is true it renders the new cascading flow; otherwise the existing manual form (unchanged).

### Field flow (existing-school)

1. **Class (grade)** — `Select` of the teacher's Olympiad grades from `useOlympiadAssignedClasses()` (filtered to the current `oly_school_id`). Defaults to the page's `gradeLevelId`. If the teacher has exactly one grade for this school, it is auto-selected and shown as a single locked value. Changing it refetches subjects + roster and resets the student/section selection. `class_label` is derived as `"Class {grade_number}"`.
2. **Section** — `Select` of all distinct sections in that grade for the school, derived client-side from the roster RPC payload. Auto-selected if there is exactly one. An **"All sections"** option sits at the top (lets a teacher unsure of section see the whole grade). This control is **purely a filter for the student list** — it does not itself set the enrollment's section.
3. **Student** — searchable dropdown (shadcn `Command`/combobox) of students in the grade, filtered by the chosen section (all sections when "All sections" is active, in which case each row shows its section to disambiguate), each rendered `Full Name · ADMISSION_NO` (e.g. "Aarav Sharma · AIS2932"; admission no omitted gracefully if null). Already-enrolled students appear **disabled** with their roll number. Selecting one captures `profile_id`, `full_name`, `admission_number`, the student's **own `section_label`** (from the roster row — this is what gets written, not the filter selection), and **pre-fills DOB + guardian contact** from the roster row when previously stored.
4. **Date of birth** — always shown for existing students (no DOB on profiles). Pre-filled if previously stored (`student_personal_details.date_of_birth`), else the teacher enters it. Required (`oly_students.date_of_birth` is NOT NULL).
5. **Subjects** — unchanged `SubjectPicker`, exactly 3, sourced from the **new** `useOlympiadGradeSubjects(selectedGradeLevelId)`.
6. **Guardian contact** — name, phone (`^[6-9]\d{9}$`), email optional; pre-filled from the roster row if previously stored.
7. **Fee collected** — unchanged required checkbox.

`canSubmit` (existing-school) requires: `profileId` selected, `dob`, `subjectIds.length === 3`, `guardianName`, valid phone, `feeCollected`. There is **no free-text student name path** in this branch (dropdown-only per product decision).

### Submit payload

`form_data` gains **`profile_id`**; `section_label` is the **selected student's own section** (from the roster row, may be null if the student's class row has no section); `class_label` is `"Class {grade_number}"`; `parent_name/phone/email` carry the guardian fields. Everything else as today.

## 5. Part 2 — `student_personal_details` table

```sql
create table public.student_personal_details (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  date_of_birth  date,
  guardian_name  text,
  guardian_phone text,
  guardian_email text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id) on delete set null
);
```

- 1:1 with the student; `profile_id` is PK **and** FK, so it is indexed (satisfies §23 "every FK indexed"). `updated_by` is `ON DELETE SET NULL` per §21 (non-ownership author column).
- `ON DELETE CASCADE` on `profile_id` so the row is removed when the student is deleted (§21 ownership column).
- `updated_at` maintained by the standard `set_updated_at` trigger pattern used across the repo.

### RLS (all via SECURITY DEFINER helpers — §23.1)

- **SELECT** — student reads own (`auth.uid() = profile_id`); institution staff read their institution's students via a helper `public.can_view_student_details(_profile_id, _uid)` that checks the viewer shares the student's `institution_id` and holds `school_admin`/`coordinator`/`teacher` (wraps the cross-table EXISTS in a SECURITY DEFINER function — no inline cross-table EXISTS in the policy).
- **INSERT/UPDATE** — `school_admin`/`coordinator` for the student's institution (mirrors the existing `profiles` write policies), via helper. The **enroll write goes through the service-role edge function** and bypasses RLS — these policies exist so a future admin-edit UI works without further migration. No teacher or student write policy (school-managed, read-only to student).

## 6. Part 3 — Roster RPC `oly_list_salci_roster_for_grade`

```
oly_list_salci_roster_for_grade(p_oly_school_id uuid, p_grade_level_id uuid)
  returns table(
    profile_id uuid, full_name text, admission_number text,
    section_label text, date_of_birth date,
    guardian_name text, guardian_phone text, guardian_email text,
    already_enrolled boolean, enrolled_roll_number text
  )
language plpgsql stable security definer set search_path = public
```

- **Authz (internal, since DEFINER bypasses RLS):** caller must satisfy `oly_is_teacher_for_class(auth.uid(), p_oly_school_id, p_grade_level_id)` OR `oly_is_school_admin_for(auth.uid(), p_oly_school_id)` OR `is_super_admin(auth.uid())`; otherwise `RAISE EXCEPTION` (or return empty).
- Resolve `v_institution_id := oly_schools.institution_id` for `p_oly_school_id`.
- Walk `class_groups cg` (where `cg.institution_id = v_institution_id AND cg.grade_level_id = p_grade_level_id`) → `classes c (c.class_group_id = cg.id)` → `class_assignments ca (ca.class_id = c.id AND ca.role = 'student')` → `profiles p`.
- `DISTINCT ON (p.id)` ordered by `p.id, ca.assigned_at DESC` to pick one (latest) section per student; project `c.section` as `section_label`.
- `LEFT JOIN student_personal_details spd ON spd.profile_id = p.id` for DOB + guardian pre-fill.
- `already_enrolled` / `enrolled_roll_number` via `LEFT JOIN oly_students os ON os.oly_school_id = p_oly_school_id AND os.campaign_id = <school's campaign> AND (os.profile_id = p.id OR os.admission_number = p.admission_number) AND os.status <> 'removed'`.
- Final ordering: `section_label NULLS FIRST, full_name`.
- Bounded by a single grade in a single school (typically < 300 rows); the student picker is a searchable combobox so the payload is usable. `GRANT EXECUTE ... TO authenticated`.

Hook: **`useOlympiadSalciRoster(olySchoolId, gradeLevelId)`** — `supabase.rpc(...)`, `staleTime: 60_000`, `enabled` only when both ids present and the school is an existing-SALCI school.

## 7. Part 4 — `oly-cash-enroll` edge-fn changes

- `FormData` gains `profile_id?: string | null`.
- On the `oly_students` insert, set `profile_id: form_data.profile_id ?? null`.
- Extend the existing-school duplicate guard to also match `profile_id` (in addition to `admission_number`).
- After a successful insert, **when `profile_id` is present**, `upsert` into `student_personal_details` `{ profile_id, date_of_birth, guardian_name: parent_name, guardian_phone: parent_phone, guardian_email: parent_email, updated_by: userId }` `on_conflict: profile_id`. Service role bypasses RLS.
- The synthetic `oly_enrollment_pending` row, receipt trigger, and audit log are unchanged. Synthetic-auth creation already self-skips when `profile_id` is set.
- Errors on the `student_personal_details` upsert are logged but **must not** fail the enrollment (the enrollment is the primary effect); surface via `console.error`, continue. (The enrollment succeeded; details write-back is best-effort and re-runnable.)

## 8. Part 5 — Fix `oly_lookup_salci_student`

Rewrite so DOB is read from the new table instead of the non-existent `profiles.date_of_birth`:

```sql
select p.id, p.full_name, spd.date_of_birth
  into v_profile_id, v_full_name, v_dob
  from public.profiles p
  left join public.student_personal_details spd on spd.profile_id = p.id
 where ...
```

No signature/return-shape change; `EnrollmentFormSalci` keeps working and now actually returns a DOB when one is stored.

## 9. Part 6 — Student Profile-page display

Add a read-only **"Personal & guardian details"** `Card` to [ProfilePage.tsx](../../../src/pages/ProfilePage.tsx), rendered only for students (`isStudent`). Fields: Date of birth, Guardian name, Guardian phone, Guardian email, Admission no, Roll no. Admission/roll come from `profiles` (already loaded but currently unsurfaced — extend `useProfileData`'s returned `ProfileData` to include `admission_number` + `roll_number`). DOB + guardian come from a new **`useStudentPersonalDetails()`** hook (selects explicit columns from `student_personal_details` where `profile_id = auth uid`, `staleTime: 60_000`). Empty/unset fields render an em-dash. No realtime — the data is written server-side during enrollment and appears on next profile load ("automatically reflects").

## 10. Data flow

```
Teacher (existing school) opens CashEnrollSheet
  → useOlympiadAssignedClasses (grades) ─┐
  → useOlympiadGradeSubjects(grade)      ├─ populate Class/Subjects
  → useOlympiadSalciRoster(school,grade) ┘  → derive Sections, list Students
  → pick Student (profile_id, prefill dob/guardian) → fill subjects/guardian/fee
  → useOlympiadCashEnroll → oly-cash-enroll (service role):
        insert oly_students (… profile_id)             ← links to SALCI student
        upsert student_personal_details (dob, guardian) ← writes back to student
        (skip synthetic auth; receipt; audit)
Student logs in with SALCI credentials:
  /student/olympiad  → useOlympiadStudentEnrollment (profile_id match) shows enrollment
  /profile           → useProfileData + useStudentPersonalDetails shows dob/guardian/admission/roll
```

## 11. Error handling

- All client `onError`/`catch` routes through `toastError(err, { fallback, context })` (§19). Edge-fn `blocked` responses surface their `message` via `toast.error` as today.
- The roster RPC raising on unauthorized callers is translated by `toastError` (maps `42501`/RLS).
- DOB pre-fill is best-effort; a missing stored DOB simply leaves the field empty.

## 12. Scaling (§23) checklist for this change

- New `useQuery`s set explicit `staleTime: 60_000`.
- No new realtime subscriptions; no `refetchInterval`.
- No `select("*")` in new code (explicit columns / RPC projection).
- New FK (`student_personal_details.profile_id`) is the PK → indexed; `updated_by` FK indexed in-migration.
- New RLS uses SECURITY DEFINER helpers; no inline cross-table EXISTS.
- Roster RPC returns a single bounded grade roster; student picker is searchable (no unbounded client list).

## 13. Out of scope

- Net-new (non-SALCI) school cash-enroll flow — unchanged manual form.
- Mirroring the write-back into the **online** existing-school enroll (`EnrollmentFormSalci` → `oly-payment-verify`/promotion) — only its broken lookup is fixed here; write-back parity is a clean follow-up.
- Admin-edit UI for `student_personal_details` (RLS leaves the door open).
- `SubjectPicker`, roll-number generation, receipt/audit, student-side Olympiad portal — unchanged.
- Dashboard-home card for personal details (chosen surface is the Profile page).

## 14. File-level change list

**Migrations (new):**
- `student_personal_details` table + `set_updated_at` trigger + RLS + helper(s) `can_view_student_details` / `can_write_student_details`.
- `oly_list_salci_roster_for_grade` RPC + `GRANT`.
- `CREATE OR REPLACE` fix for `oly_lookup_salci_student`.

**Edge function:**
- `supabase/functions/oly-cash-enroll/index.ts` — `profile_id` in `FormData` + insert; dup-guard on `profile_id`; `student_personal_details` upsert.

**Frontend:**
- `src/components/olympiad/teacher/CashEnrollSheet.tsx` — existing-school cascading branch; keep net-new manual branch.
- `src/hooks/olympiad/useOlympiadSalciRoster.ts` (new).
- `src/hooks/olympiad/useOlympiadGradeSubjects.ts` (new) — all active subjects for a grade (replaces the roster-derived subject list for the cash form).
- `src/hooks/olympiad/useOlympiadAssignedClasses.ts` — add `grade_number` to the projection/return.
- `src/hooks/useStudentPersonalDetails.ts` (new).
- `src/hooks/useProfileData.ts` — include `admission_number` + `roll_number` in `ProfileData`.
- `src/pages/ProfilePage.tsx` — student "Personal & guardian details" card.
- `src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx` — pass `isExistingSalciSchool` to `CashEnrollSheet` (fetch the flag in `useOlympiadClassMeta`); supply grade list / let the sheet self-fetch.
- `src/integrations/supabase/types.ts` — regenerate or hand-add the `student_personal_details` Row/Insert/Update + the new RPC signature.

## 15. Production-readiness gate (§5a)

`npx tsc --noEmit`, `npx eslint <touched paths>`, `npx vite build` all exit 0 before completion. Edge fn redeploy: `npx supabase@latest functions deploy oly-cash-enroll --project-ref gyymkgohcijeksmrzuyw`. Migration applied via the project's migration path (not hand-run on prod without review).
