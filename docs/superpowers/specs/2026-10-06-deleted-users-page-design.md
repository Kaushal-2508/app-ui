# Deleted Users page: design

Date: 2026-10-06. Owner: Tushar. This supersedes [2026-09-25-deleted-user-archive-design.md](2026-09-25-deleted-user-archive-design.md), which was approved in approach but never built.

The research behind it was a read-only, 5-agent workflow on prod (deletion paths, the full cascade inventory, the traces left by past deletions, UI patterns, and a completeness critic). The evidence is preserved outside the repo, because it contains deleted people's emails, at `D:/Salci Projects/Salci-Main-Portal/salci-evidence/deleted-users-research-2026-10-06/`. Census files: `population.json`, `ids_status.json`. Table inventory: `final_tables.json`.

## What Tushar asked for

> "A new separate page for all the deleted users, with filters, and with all the records related to that user. This tab will be very important for us, so make sure everything is perfect, with real and complete data. Nothing should be skipped."

**Success means:**
1. **Every future deletion is captured completely,** whichever path deletes the account (app, Supabase dashboard, service-key tool, SQL), and the completeness is proven, not assumed.
2. **Every past deletion that can be proven is listed:** at least 2,087 accounts, not just the 388 with a `user_deleted` audit row. Each entry shows every fact that genuinely survives, says where each fact came from, and is marked as partial history.
3. **Real data only.** Nothing is invented. Facts that cannot be known exactly, such as deletion dates in the spring, are shown as ranges or "unknown".
4. **One page,** Monitoring → Deleted Users, with filters, a complete per-person record, files and export. Only team@salci.in can open it.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | People deleted before the archive | **Listed** with every real trace, marked "Partial history". (Tushar) |
| 2 | Reason-for-deletion field | **No.** (Tushar) |
| 3 | If the archive cannot be saved at deletion time | **Block the deletion**, so nothing is lost. Tushar left this to us. It starts in `best_effort` and switches to `required` only after a clean rolled-back pass over every account. Tushar has an off switch. |
| 4 | Olympiad | **Out of scope:** "Olympiad is different, leave it" (Tushar). See section 6 for the exact rule. |
| 5 | People who request their own deletion (/delete-account) | **No copy kept** (Tushar). A minimal entry remains (date, school, role, deleted by, "at their request"). The delete dialog gets one checkbox for this. |
| 6 | Who can open the page, and retention | **Only team@salci.in, kept forever.** (Tushar) A SQL-only redact/purge function exists per entry, so a legal retention rule (India's DPDP Act, minors) can be applied later without a redesign. |
| 7 | Second factor (MFA) for the page | **No.** (Tushar) |
| 8 | On-request deletions: also delete their files and scrub logs | **No.** Uploaded files are the school's data and stay, and logs are not scrubbed. On-request only means no archive copy. (Tushar) |
| 9 | Delete dialogs preview what will be removed before confirming | **Yes.** (Tushar) The preview shows both lists: "Will be deleted: ..." and "Stays with the school: 118 exams, 332 questions, ...". |
| 10 | Restore the one deletion still inside the 7-day backup (a test-looking student, deleted 2026-10-05) | **No, let it go.** (Tushar) |
| 11 | Records a staff member PRODUCED for the school, which are deleted with them today: lesson plans and period logs (~6,100 rows), substitution history for classes they covered (~46,000), remarks about students (~23), task comments (~550), appointments | **Keep with the school** like exams, shown as "Former staff: name". (Tushar: "the data which that teacher produces should remain") |
| 12 | Staff HR records, deleted with them today: payslips, salary assignment, staff attendance (~6,000), leave requests and balances, staff documents, targets | **Keep with the school, with the person's name.** (Tushar) Payroll and attendance history are records a school must keep. The Deleted Users page has them too. |

## Architecture

### 1. Capture at delete time: in the database, so no path can bypass it

There are five GoTrue `deleteUser` call sites in code, plus the dashboard, service-key tools and direct SQL. Since July, 19 deletions came through Auth API paths outside the app and 2 through SQL. An app-only archive would have missed them.

So the capture is a **`BEFORE DELETE FOR EACH ROW` trigger on `auth.users`**. Its function `dua.capture_user_delete()`:
- is owned by postgres, `SECURITY DEFINER`, with `SET search_path = ''`;
- lives in schema `dua`, not in `auth`;
- has EXECUTE revoked from PUBLIC, anon and authenticated.

Precedent: `on_auth_user_created` already runs a postgres-owned definer function in GoTrue sessions. GoTrue deletes as `supabase_auth_admin` with a 120 s statement timeout.

For each deleted user, unless they are skipped (section 6), the function:
1. **Walks the live FK graph** from `auth.users`. It re-reads `pg_constraint` every run, so new tables are captured automatically. Today that is 116 tables, depth up to 4, plus the `teacher_targets` self-loop. Every walked row is locked `FOR UPDATE`.
2. **Copies every row image.**
   - Sensitive columns are removed by a **per-column allowlist** for each table that has one (section 7).
   - Auth tables other than `auth.users` (stripped) and `auth.identities` are stored as **counts only**, so future GoTrue credential tables are counts-only by default.
3. **Records the authored records that survive with their author cleared:** 58 tables, 123 SET NULL FKs. For each, it stores the primary keys and a title snapshot. `question_bank` stores ids and a count only: one admin authored 77,093 questions.
4. **Snapshots labels** for every id a reader wants named, following the research's `label_resolution` list:
   - exam, class and section, subject, school, wing, homework, task, PTM, fee structure;
   - **the question text, options, correct answer and maximum marks for every answered question**, so archived answers stay readable after the exam is deleted;
   - the deleting actor's name and roles.
5. **Header facts computed before the cascade:**
   - name, email, phone, admission number, roles with school;
   - class/section, wing, subjects taught;
   - account created, `last_sign_in_at`, **last active** (latest `auth.sessions` refresh, and the last day in `student_activity_daily` / `user_activity_log`);
   - deleted at, deleted by, source.
6. **File manifest,** built from a per-column map of the 19+ path columns (bare paths, public URLs, jsonb lists) to `{bucket, path}`, plus `storage.objects` owned by the user or with their id in the path. Files are never deleted with a user and stay in their buckets.
7. **Non-FK traces:**
   - their `class_assignment_deletions` rows;
   - the trigger-audit row images written during this delete;
   - `dashboard_flags` keyed by their id;
   - `onboarding_snapshots` entries.
8. **Indexes every archived row by every person id it contains.** A teacher's archive holds remarks about students and their students' online-PTM entries, so a later lookup or scrub can find those rows.

**Attribution (revised 2026-10-07 while planning).** `admin-operations` calls a small service_role-only RPC, `dua_note_delete(_user_ids, _actor_id, _source, _on_request)`, just before GoTrue's `deleteUser`.
- The RPC writes a delete intent to `dua.delete_intents`. The capture trigger uses the newest intent for that user from the last 10 minutes that is neither used nor cancelled, then marks it used. A failed `deleteUser` cancels it through `dua_cancel_delete_intent`.
- A SQL operator can set `salci.delete_actor`, `salci.delete_source` and `salci.delete_on_request` by hand instead.
- The DELETE stays in GoTrue, which keeps its 120 s budget and its auth audit event.
  - The first version had an RPC run the DELETE itself. PostgREST runs RPCs under `authenticator`, which has `statement_timeout=8s` (checked on prod 2026-10-07).
  - A function-level `SET statement_timeout` cannot extend the statement already running.
- `admin-operations` still writes exactly one `user_deleted` audit row, as today, so the §29 alerts are not double-counted.

**Sources**, with `session_user` and `application_name` stored raw:
- **App (actor named)**;
- **Auth API, no app actor** (dashboard, service-key tools);
- **Direct SQL**.

### 2. Proof of completeness

- A `BEFORE DELETE FOR EACH STATEMENT` trigger records the `pg_stat_xact_user_tables` deleted and updated counts.
- An `AFTER DELETE FOR EACH STATEMENT` trigger runs after the whole cascade and compares the deltas with what was archived. The comparison is de-duplicated across users in one statement.
- Equal counts mark the archive `complete`. Otherwise it is `partial`, with the tables listed. A partial result never blocks.
- **Known side effects are listed as "expected", not "missing".** For example, `tg_ptm_online_participant_removed` cancels other students' online bookings when a teacher is deleted.
- **It is proven before anyone relies on it.** The plan's first task watches the counters move inside a real cascade, on prod in a rolled-back transaction, before any badge depends on them.

### 3. Failure handling (decision 3)

- `dua.settings.capture_mode` is set by SQL only, by Tushar. It starts as `best_effort`: an error is logged, a header marked "capture failed" is written, and the delete proceeds.
- It switches to `required` after the rolled-back capture passes on every account. In `required`, any error in copying **public-schema rows** aborts the delete with a translated message, writes `user_delete_blocked` and sends the alert email. Gaps in auth-table counts or the file manifest are recorded but never block.
- **A daily rolled-back canary capture** of the heaviest accounts warns before a new table or a timeout can start blocking real deletes.

### 4. Closing the side doors, and a witness for what cannot be closed

- **Direct `profiles` deletes** cascade 76 tables without `auth.users`:
  - remove DELETE from the super-admin ALL policy;
  - revoke it from anon and authenticated;
  - add a `BEFORE DELETE` guard that refuses while the auth row exists. That is cascade-safe.
- **TRUNCATE:** guard triggers on `auth.users` and `profiles` raise.
- **Witness.** A daily snapshot of `auth.users` ids, with name, email and school, is kept in `dua`. Any id that disappears without an archive header (a dropped trigger, replica mode, a platform operation) raises an alert and gets a "captured from roster snapshot" entry. This runs in the §29 deletion-alert pass.

### 5. School deletions and bulk deletes become background jobs

`delete_institution` deletes up to 1,643 users in one edge-function request. It already stops halfway: on 2026-09-02, 6 runs failed after their users were gone. The request is also cut off at 150 s, and capture adds time.

Both actions become **jobs**:
- the request enqueues the job and returns its id, and the UI polls (§23);
- members are paged with `range()`;
- one archive per user, plus a job record;
- the school row is deleted only after every member is gone.

### 5b. What stays with the school when staff are deleted (decisions 11 and 12)

Today 13 staff-owned tables are `ON DELETE CASCADE` (verified on prod 2026-10-06):

| Kind | Table | Column today |
|---|---|---|
| Produced for the school | `tt_lesson_plans` | `owner_teacher_id` (nullable) |
| Produced for the school | `tt_substitutions` | `substitute_teacher_id` (nullable) |
| Produced for the school | `student_remarks` | `teacher_id` NOT NULL |
| Produced for the school | `task_comments` | `user_id` NOT NULL |
| Produced for the school | `appointments` | `teacher_id` NOT NULL |
| HR | `payroll_entries` | `user_id` |
| HR | `staff_salary_assignments` | `user_id` |
| HR | `staff_attendance_records` | `staff_id` |
| HR | `staff_leave_requests` | `user_id` |
| HR | `staff_leave_balances` | `user_id` |
| HR | `staff_documents` | `user_id` |
| HR | `teacher_targets` | `owner_id` |
| HR | `teacher_target_periods` | `teacher_id` |

All the HR columns are NOT NULL today.

**Change for each of the 13 tables:**
1. The FK becomes `ON DELETE SET NULL`, with `DROP NOT NULL` where needed.
2. The table gains a `former_user_id uuid` column. It is indexed and has no FK.
3. The capture trigger fills `former_user_id` for that person's rows **before** the cascade, so the row keeps who it belonged to.

**`public.former_staff` register:**
- One row per deleted staff member, written by the capture trigger: `user_id`, name, email, roles, school, deleted at.
- School admins and coordinators can read their own school's rows through RLS, via a SECURITY DEFINER helper.
- Screens show **"Former staff: Ms X"** wherever such a row is displayed.
- On-request deletions (decision 5) still get a register row. The HR and teaching records are the school's data (decision 8), and the person's name on them is part of that record.

**Every screen that reads these tables** must handle a NULL owner without crashing and show the former-staff name. That covers the timetable and substitution views, lesson-plan and syllabus-progress views, remarks, task comments, appointments, payroll and HR pages, and targets. The plan lists each one, and each is checked with real data.

The research inventory's other staff-keyed CASCADE tables stay as they are, because they are the person's own account data or derived numbers:
- notifications, badges, preferences, devices, AI quotas;
- class and wing assignments, which are logged in `class_assignment_deletions`;
- permission overrides;
- engagement and effectiveness aggregates, which are recomputed;
- Olympiad assignments;
- the linked Google account.

They are all in the archive.

### 5c. The delete preview (decision 9)

`dua_delete_preview(_user_ids uuid[])` is read-only. It runs the same FK walk and returns counts by category in two lists:
- **Will be deleted**, for example "46 exam attempts, 32 attendance days";
- **Stays with the school**, for example "118 exams, 332 questions, 63 lesson plans, 22 payslips".

It authorizes the caller with the same rules as `admin-operations` `delete_user`, revokes anon, and is bounded: bulk previews sum per category, capped at 200 users per call. Every delete dialog shows it before the confirm button. That is Teachers, Students, Coordinators, Manage Admins and super-admin Users, single and bulk.

### 6. Olympiad and self-requested deletions

**Olympiad rule (decision 4)**, quantified from prod during the research:
- **Skip** when the account is an Olympiad login (an `oly_students.auth_user_id`) or belongs only to Olympiad-only schools.
- **Never skip** an account that holds any role in a SALCI school. A SALCI student enrolled in the Olympiad is always archived.
- The dormancy purge stays a deliberate wipe. It has purged 0 accounts so far.

**On request (decision 5):**
- When `salci.delete_on_request` is on, only a minimal header is stored: date, school, role, deleted by, "at their request". No name, email, rows or files.
- The checkbox is in every delete dialog: Teachers, Students, Coordinators, Manage Admins, and super-admin Users, single and bulk.
- Their uploaded files and the logs stay untouched, because those are the school's data (decision 8). The section 5b behaviour (records kept with the school, plus a `former_staff` row) applies as usual.

### 7. Never stored

- **From `auth.users`:** the password hash and every token column.
- **Credential tables, counts only:** sessions, refresh_tokens, mfa_*, webauthn_*, one_time_tokens, oauth_*, flow_state, push subscriptions, hybrid pairing tokens.
- **Per-column exclusions:**
  - bank account number, IFSC and PAN (`staff_salary_assignments`);
  - fingerprint template and face descriptor (biometric tables);
  - Google tokens and Meet links;
  - anything matching the guarded name patterns: token, secret, pin, hmac, fingerprint, descriptor, pan, ifsc, bank, meet.
- **A schema check fails the build** when a new column matching those patterns appears and is not classified.
- The `salci_backups` password snapshot never reaches the page. Only the admission number is taken from it.

### 8. Past deletions: the census backfill (decision 1)

One entry is created per proven deleted id. That is **at least 2,087**: 2,026 with a database trace, 60 only in the platform log, and 1 in an LMS backup. **Every field records its source.**

| Fact | Coverage | Source |
|---|---|---|
| Name | 2,026 of 2,026 | `user_deleted` / `user_created` audit rows |
| Email | 2,085 of 2,086 | `user_created` new_values; GoTrue log (90 days) |
| Role | 2,025 of 2,026 | `user_created`; `role_deleted` trigger rows |
| School, with name | 2,026 of 2,026 | audit rows, `institution_deleted` names |
| Account created | 2,024 of 2,026 | `user_created`; role grants; GoTrue signup |
| Admission number | 678 | synthetic @temp.local emails (validated); one backup |
| Class / section | 359 | `class_assignment_deletions` |
| Deleted at | exact for 490; a range for 1,233; "before 2026-08-24" for the rest | audit rows, GoTrue log, re-creation bounds |
| Deleted by | 414, plus 102 from function logs | `user_deleted` / `institution_deleted` actors; admin-operations logs |
| Last sign-in | 13 | GoTrue log (90 days) only |
| Files | 10 people, 158 objects, 119 MB | still in their buckets |
| Records (attempts, results, attendance, homework...) | **0: these were destroyed by the cascade, and no copy exists** | none |

Rules for these entries:
- **Live again.** 1,492 people (74%) have the same email, or the same @temp.local admission number in the same school, on a live account. They are marked **Live again** and linked to that account. The KPI row separates "gone" from "live again", so the 1,576 spring re-imports at Alliance are not read as lost students.
- **Exclusions and tags.** Ids still present in `auth.users` are excluded (5 ids the log marks deleted are live; those deletes rolled back). Test accounts are tagged by email domain.
- **Expiring evidence is copied into `dua` first** (plan task 0). The platform log keeps 90 days. It is the only record of emails for 60 people, exact times for 71, the deleter for 102 (the 2026-09-02 evidence expires around 2026-12-01), and last sign-in for 13.

### 9. Storage of the archive

- **Schema `dua`.** It is not exposed to the API, has no grants to PUBLIC, anon or authenticated, and no FKs to live tables.
- **Tables:**
  - `users` (header plus per-field sources);
  - `rows` (one compressed jsonb array per table);
  - `links`;
  - `files`;
  - `traces`;
  - `people_index` (archived row to person ids);
  - `legacy_evidence`;
  - `roster_snapshots`;
  - `viewers` (the allowlist, holding team@salci.in);
  - `view_log`;
  - `settings`;
  - `jobs`.
- **View logs stay inside `dua`.** `system_audit_logs` rows are readable by school admins.
- **Protection.**
  - The daily pass checks that archive row counts never drop.
  - `dua` is kept out of routine migrations.
  - Optionally, an encrypted periodic export to storage Tushar controls. Backups here are 7 days with no PITR.

### 10. Reading: RPCs that check `dua.can_view()`

`dua.can_view()` requires both a super admin and membership of `dua.viewers` (decision 7: no MFA). It fails closed on a NULL uid, revokes anon by name, and logs each view to `dua.view_log`.

| RPC | Returns |
|---|---|
| `dua_list(filters, limit ≤ 50, keyset)` | Rows, a server-side total, and facet counts for every filter. |
| `dua_detail(id)` | Header with sources; per-category and per-table counts; links; files; completeness, mismatches and expected side effects. |
| `dua_rows(id, table, limit ≤ 50, keyset)` | One page of rows with labels resolved from the snapshot. |
| `dua_links(id, table, ...)` | Authored records still live, with their current title or the snapshot. |
| `dua-file-url` (edge function) | A 300 s signed URL, only for a `(bucket, path)` listed in that archive's manifest. It checks whether the file still exists ("File removed after deletion"). |
| `dua_export(id)` | The full JSON. The Excel workbook is built client-side, one sheet per table. |

**Filters** (all server-side, with counts):
- search by name, email or admission number;
- role;
- school;
- class/section;
- deleted by;
- source;
- deleted date range (range-aware for past entries);
- entry type (Complete / Partial history / At their request / Capture failed);
- Live again or gone;
- has files;
- completeness flagged;
- test accounts shown or hidden.

### 11. The page

**Route and access.**
- `/admin/deleted-users` is lazy-loaded, behind `ProtectedRoute allowedRoles={["super_admin"]}`, plus `dua.can_view()`.
- The item Monitoring → Deleted Users (after Activity Logs) shows only for the allowed viewer.
- The detail route is `/admin/deleted-users/:id`.

**List page** (mirrors ActivityLogsPage):
- PageShell, plus a compact PageHeader with Export.
- StatCells: deleted (gone), live again, this month, students, staff, partial history.
- The ActivityFilterBar pattern, with active filter chips.
- ListRows with:
  - the archived avatar;
  - name and email;
  - role chips and school;
  - "Deleted 5 Oct 2026 · by Ms X", or a date range;
  - badges: Complete / Partial history / At their request / Live again / Flagged.

**Detail** (the NonSalciSchoolDetailPage pattern, MobileTabs):
- **Overview:**
  - identity, with a source for each field;
  - timeline: created, last sign-in, last active, deleted;
  - roles;
  - class/section, wing, subjects;
  - deleted by and source;
  - completeness;
  - the Live again link.
- **Records:** every captured table, grouped by a **generated table registry** (human label, category, display columns, label resolution) built from the research inventory:
  - Academics: attempts, answers with question text, AI evaluations, overrides, results, offline marks, snapshots, passport, mastery;
  - Attendance;
  - Homework;
  - Fees;
  - Staff and HR;
  - Communication;
  - PTM;
  - Tasks and targets;
  - Timetable and lesson plans;
  - Roles and assignments;
  - Account and devices (counts only);
  - **Other**, the fallback for any table the registry does not know yet. A CI check compares the registry with the live closure.

  Each table is paginated, with a "Show all fields" toggle.
- **Authored, still live.**
- **Files.**
- **Raw:** every table's full JSON.

**Design system rules:**
- 375px, dark mode, tokens only, no em-dashes.
- Error state before empty state.
- `toastError`.
- `staleTime` 60 s on the list and 5 min on archive pages.
- **`meta: { persist: false }` on every archive query.**
- Downloads through `@/lib/native`.

## Scale Gate (for the plan)

| Item | Approach |
|---|---|
| Bounded lists | ≤ 50 per page, keyset. |
| Counts and facets | Server-side. |
| `staleTime` | Set on every query. |
| `select("*")` | None. |
| Atomicity | Capture and delete in one transaction. |
| Indexes | Every new FK indexed. Before launch, `CREATE INDEX CONCURRENTLY` on the large unindexed user-FK columns the research found: `question_bank.created_by`, `attendance_records.marked_by` and `substitution_id`, the `tt_substitutions` user columns, `student_exam_attempts.finalized_by`, `final_results.published_by`, `teacher_overrides.evaluated_by` and the rest of the list. |
| Lock timeout | Bounded on the RPC path. |
| School and bulk deletes | Run as background jobs. |
| Normal traffic | Untouched: only the delete path changes, and one person reads the page. |

## Testing (before `required` mode)

0. **Expiring evidence** is copied into `dua.legacy_evidence`, and the copy is verified against the preserved research files.
1. **The counter check is proven** inside a real cascade on prod, rolled back.
2. **Rolled-back capture of all 3,405 accounts**, in batches of 100 to 200. Every capture succeeds and verifies `complete`, apart from listed expected side effects. Worst-case timing is recorded for the heaviest accounts through both paths (60 s RPC, 120 s GoTrue).
3. **Display checks** against live data before the rollback: label and question-text resolution and the registry, for a heavy student, a teacher, a coordinator, a dual-role user and an admin.
4. **Access:** anon, a school admin and a non-allowlisted super admin are denied; team@salci.in is allowed.
4b. **Kept records (decisions 11 and 12):**
   - Delete a real teacher and an HR-heavy staff member, rolled back.
   - Their lesson plans, substitutions, remarks, task comments, appointments, payslips, attendance, leave, documents and targets still exist with `former_user_id` set.
   - The `former_staff` row is readable by that school's admin and no other school's.
   - Every listed screen renders "Former staff: name" with no crash, verified with real data.
4c. **Preview:** the counts for a heavy student, a teacher and a bulk selection match the rolled-back delete exactly.
5. **Paths:**
   - app RPC with actor;
   - GoTrue admin API;
   - SQL multi-row;
   - direct `profiles` delete (refused);
   - TRUNCATE (refused);
   - the Olympiad skip;
   - the on-request minimal entry;
   - a school-deletion job.
6. **Failure handling:** an injected error blocks in `required` mode and is flagged in `best_effort` mode. The witness alerts on a simulated bypass.
7. **The census backfill:** the totals reconcile with the research (2,087), every entry carries sources, live-again links resolve, and no live id appears.
8. **The UI** at 375px and in dark mode, with real data, covering every tab's error, empty and loaded states.
9. **End to end after release:** a throwaway account is deleted from the app and appears **Complete**.

## Out of scope

- Restoring deleted users.
- Olympiad accounts.
- A deletion-reason field.
- Copying files (they are never deleted; the page links to them).
- Fixing the existing privacy gaps outside this feature: `system_audit_logs` row images that school admins can read, and the wording of the /delete-account page. These are noted for a separate decision.
