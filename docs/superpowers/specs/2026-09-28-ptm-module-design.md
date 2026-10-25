# PTM Module (scheduling, slot booking, family feedback, dashboard) - Design

**Date:** 2026-09-28
**Status:** Frontend built on `naman-erp` (2026-09-28). The database half and two `App.tsx` routes are
Tushar's: every `NEEDS DB` and `NEEDS CORE` item below. The frontend calls exactly the contracts in
section 6 and renders a "not set up yet" state until they exist.
**Branch reality:** `naman-erp` is frontend only (CLAUDE.md section 28). Every database object below is
`NEEDS DB` and is applied by Tushar through `scripts/run-sql.ps1`. The frontend is built against these
contracts behind a schema probe, so it renders a "not set up yet" state until the objects exist.
**Builds on:** `2026-09-15-ptm-notifications-design.md` (triggers, audience resolver, reminder cron,
multi-class scope). Nothing in that design is undone here.
**Extended by:** [2026-10-03-ptm-online-residential-design.md](2026-10-03-ptm-online-residential-design.md),
the residential (online, Google Meet) mode: a `mode` on `ptm_schedules`, per-teacher sessions and
per-student participants, a teacher busy guard, and the contract for its RPCs, crons and edge function.

> **Status 2026-09-28 (Tushar): the database half is APPLIED to prod** as
> `20260928180000_ptm_module.sql`, verified in the catalog and by `scripts/test-ptm.sql` (90
> assertions under real RLS as a real admin, wing coordinator, class teachers and students,
> rolled back: 90 PASS before applying and again after), and the user-delete blocker probe shows
> nothing new. Both `App.tsx` routes are in. `20260928183000_ptm_tighten.sql` (bookings `class_id`
> NOT NULL, the `ptmb_insert` / `ptmb_update` direct-write policies dropped, `ptm_update` on
> `can_manage_ptm`) was applied the same day once the frontend was live (the retired legacy
> dialog wrote directly), verified by a rolled-back check and the suite again. Built from sections 1 to 6 with these changes: `ptm_bookings.parent_id` was already ON
> DELETE CASCADE (not NO ACTION as section 2 assumed), `teacher_id` moved from CASCADE to SET NULL;
> `create_ptm_schedule` keeps the 8 legacy parameters first with defaults on the 7 new ones (the
> legacy dialog kept working until the deploy); `ptm_classes_for_hat` is internal, not granted to
> `authenticated`; ratings travel as integer; a coordinator must hold the coordinator role, not
> only a wing row; a slot is checked with interval arithmetic so a slot near midnight cannot wrap;
> a legacy PTM's out-of-range slot length may stay unchanged on edit; the two 2026-09-15 trigger
> functions lost their stray PUBLIC grant. One legacy student held two active bookings for one PTM;
> the older was soft-cancelled before the one-per-student index. The CSV export escapes formulas.

> **DECIDED and APPLIED 2026-09-29 (Tushar): `20260929170000_ptm_teacher_scope.sql`, "with or
> without a subject".** Any teacher row on the class counts, not only one with a subject as step 1
> below first proposed, so the teachers on a subject-less row who could already run a PTM keep that
> right and every subject teacher gains it. Measured after applying, teachers with PTM rights:
> Alliance 3 to 84, Salci National 2 to 51, Vidyabodhini 0 to 24, Vanshika 4 to 11, Product Testing
> 5 to 9. Only the two bodies below changed; grants unchanged (postgres + service_role). CLAUDE.md
> section 25 and the `teacher-authority-scope` skill now name PTMs as the second whole-section
> exception. `scripts/test-ptm.sql` is 100 assertions: the old items reworded, plus section 10, a
> real teacher with only a subject row who schedules, sees names, marks attendance, cancels a
> booking and reads feedback for that class and nothing else. Against the old rule section 10 fails
> ("You can only schedule a PTM for your own classes"); 100 PASS in a rolled-back dry run and again
> after applying. `ptm_class_teachers` and `_ptm_class_teacher_names` are left for a browser still
> on the previous build; drop them in a later release. The block below is the original request.
>
> **Was OPEN 2026-09-29, `NEEDS DB` (Tushar): a teacher's PTM rights follow the classes they teach.**
> Naman: "there is no such thing as class teacher in the whole system, so a teacher has rules on
> the classes he/she teaches." Decision 3 below is withdrawn. The frontend already says this (every
> class-teacher line, column and card is gone, and the teacher copy reads "the classes you teach"),
> but the server still grants the teacher hat ONLY through a subject-less `class_assignments` row,
> which is the one kind of row CLAUDE.md section 25 says grants nothing. At the school Naman tested,
> 1 of 42 classes has such a row, so almost every teacher sees an empty PTM tab under the teacher
> hat and cannot schedule one. Admins and coordinators are unaffected.
>
> **The change, per `20260928180000_ptm_module.sql` (verify the live bodies in `pg_proc` first):**
>
> 1. `is_class_teacher_of(_user, _class)`: true when the user holds an active `class_assignments`
>    row on that class with `role = 'teacher'` and a subject (`subject_id IS NOT NULL`), plus the
>    existing teacher-role and active-profile checks. Replacing the body in place keeps its grants
>    and all of its callers; a rename to something like `teaches_class` is optional tidying.
> 2. `ptm_classes_for_hat`, teacher branch: it also filters `ca.subject_id IS NULL` itself before
>    calling the helper, so that filter must flip too, or the scope picker, create, the dashboard and
>    the feedback list stay empty after step 1.
>
> Everything else follows from those two: `can_manage_ptm`, `can_view_ptm_feedback` (booking grid,
> attendance marking, the feedback SELECT policy, voice-note reads), `cancel_ptm_booking`,
> `ptm_manageable_scope`, `create_ptm_schedule`, `ptm_feedback_summary` and `ptm_feedback_list`.
>
> **Scope is the whole section, not narrowed by subject** (Naman, 2026-09-29): any teacher who
> teaches any subject in a section sees every family of it, the same exception attendance has in
> section 25. The meeting is about the child, not a subject, so `teacher_controls_student` and the
> optional-choice dormancy gate do not apply here.
>
> **Consequences to accept or handle:** several teachers of one section can each schedule a PTM for
> it (`can_manage_ptm` still limits edit and cancel to the creator, so no one edits a colleague's);
> a teacher who stops teaching the class loses edit rights on a PTM they created, as before. The
> 2026-09-15 notification audience already includes every teacher of the class, so nothing changes
> there. `_ptm_class_teacher_names` and `ptm_class_teachers` have no frontend caller left, and the
> `class_teachers` field of the feedback context and summary is ignored; drop them when convenient.
> Test matrix items 1, 4 and 9 below describe the old rule and need rewriting against the new one.

## Decisions taken on 2026-09-28 (Naman)

| # | Question | Decision |
|---|---|---|
| 1 | Who is the parent? | The student login is the family account. Feedback is stored per student with a `submitted_by` column. No parent role. The form copy addresses the parent or guardian; the account is never called a parent. |
| 2 | Draft status? | No. Create means scheduled. Stored status stays `scheduled` or `cancelled`; active and completed are computed. |
| 3 | Class teacher? | **Withdrawn 2026-09-29: there is no class teacher in the system.** A teacher acts on every section they have a teacher row on, with or without a subject (applied 2026-09-29, see the block above). (Was: the teacher row on a class with `subject_id IS NULL`.) |
| 4 | Wing scope? | Resolved to the wing's classes at creation and stored in `ptm_schedule_classes`. The wing id is kept for the label. Classes added to the wing later are not pulled in. |
| 5 | Cutoff and edit window? | Per PTM, two columns with defaults, set on the create form. No settings table. |
| 6 | Feature gate? | Gate the tab, the detail page and the feedback routes on the existing `ptm_scheduling` flag. Tushar enables it per school. |
| 7 | Audio storage? | Private bucket, reads gated by a SECURITY DEFINER helper, signed URLs on the client. |
| 8 | QR while logged out? | The route guard passes the requested path to the login page, and the login page returns to it. |

## What exists today (verified in the tree)

* `ptm_schedules` (title, description, date, start, end, legacy `class_id`, slot duration, free-text
  `status`, `created_by`), `ptm_schedule_classes` (zero rows means school-wide), `ptm_bookings`
  (`parent_id` holds the STUDENT's profile id, `teacher_id` nullable, `slot_time`, `notes`, teacher-side
  `feedback` + `rating`, `status` default `booked`), `ptm_notifications_sent`.
* `create_ptm_schedule(...)`: admin only, one transaction for the PTM plus its classes.
* `ptm_audience(ptm)`, `_ptm_fanout(...)`, `ptm_includes_user_class(ptm, user)`,
  `ptm_class_rows_readable(ptm)`, `ptm_send_day_before_reminders()` on an hourly cron.
* Triggers `tg_ptm_notify_scheduled` (deferred constraint trigger, fires at commit) and
  `tg_ptm_notify_changed` (cancel and reschedule). The slot-booked trigger was retired on 2026-09-15.
* RLS: `ptm_select` hides class-scoped PTMs from students outside those classes; `ptm_update` is
  admin only; `ptmb_insert` lets any student in the institution book any PTM with any time;
  `ptmb_update` lets the student, the named teacher or an admin update a booking.
* Frontend: the PTM tab in `CommunicationPage`, `PTMSchedulePanel` (cards, reschedule sheet,
  cancel dialog, expandable bookings), `CreatePTMDialog` (multi-class), `PTMBookingDialog`
  (free-text time), `PTMFeedbackDialog` (teacher notes on a booking; has an `as any` and a raw
  `toast.error`, both to be cleared).
* Conventions reused: QR via `qrcode.react` (`HybridPairingCard`), MediaRecorder plus storage upload
  (`TaskComments`), CSV via Papa, private bucket read gates (`user-avatars`), `toastError`,
  `MobileSheet`, `PageShell`, `StatTile`, `EmptyState`, `MobileTabs`.

## Permission matrix (enforced server-side, mirrored in the UI)

"Hat" is the `_as_role` argument (`admin`, `coordinator`, `teacher`) the client passes from
`activeViewRole`. Every RPC re-checks that the caller actually holds that role; the hat only narrows,
it never widens. Read policies that cannot know the hat use the OR-union, which is the safe direction
for reads (CLAUDE.md section 25).

| Action | Admin (`is_institution_admin`) | Coordinator (`wing_assignments`) | Teacher | Student |
|---|---|---|---|---|
| Schedule school-wide | yes | no | no | no |
| Schedule for a wing | yes | only a wing they are assigned to | no | no |
| Schedule for classes | yes | only classes inside their wings (`is_coordinator_for_class` for EVERY class) | only classes they teach, any subject or none (EVERY class) | no |
| Edit or cancel a PTM (the plan's "creator, and anyone with higher rights over that scope") | yes, any PTM | a teacher's PTM whose classes are all in their wings; their own wing or class PTM; never an admin's or another coordinator's | only the class PTM they created, while they still teach every class of it | no |
| Cancel after the meeting ended | no one: a completed PTM can be edited but not cancelled | | | |
| See a PTM | yes | yes | yes | only if it includes their class |
| See the booking grid with names | yes | classes in their wings | classes they teach | own class, free or taken only, no names |
| Book, cancel, rebook a slot | no | no | no | own class, one active booking per PTM, until the cutoff |
| Mark a booking attended | yes | classes in their wings | classes they teach | no |
| Submit or edit feedback | no | no | no | own student row, while the window is open |
| Feedback dashboard and list | all classes of the PTM | PTM classes inside their wings, per-class breakdown | only classes they teach | no |
| Export CSV | same scope as the dashboard | same | same | no |
| View, download, print the QR | yes | yes for PTMs they can see | yes for PTMs they can see | no |

A coordinator who forges a class id outside their wing, or a teacher who forges a class they only
teach a subject in, is rejected by the RPC with a short user-facing message, never by the UI alone.

## Time rules (all server-side comparisons in `institutions.timezone`, CLAUDE.md section 24)

Let `local_now = now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata')`.

| Name | Rule |
|---|---|
| effective status | `cancelled` if `status = 'cancelled'`; else `scheduled` while `local_now < date + start_time`; `active` while `date + start_time <= local_now <= date + end_time`; `completed` after `date + end_time`. |
| booking window | `local_now < date + start_time - booking_cutoff_minutes`. |
| feedback window | `date + start_time <= local_now <= date + end_time + feedback_edit_days` and not cancelled. |
| slot grid | slot k has `slot_time = start_time + k * slot_duration_minutes` for every k with `slot_time + slot_duration_minutes <= end_time`. Computed, never stored. |
| day-before reminder | unchanged. |

The frontend computes effective status with browser time for display only, the same concession
`isPastCutoff` already makes. Every gate that matters (book, cancel, submit feedback, active route)
is decided by the RPC in the institution's timezone.

## Database changes (`NEEDS DB`, Tushar)

Names below marked (new) are proposals. Every existing name cited was verified in the tree on
2026-09-28.

### 1. `ptm_schedules`: new columns

| Column | Type | Rule |
|---|---|---|
| `created_as_role` | text NOT NULL DEFAULT `'admin'` | CHECK in (`admin`, `coordinator`, `teacher`). The hat the creator acted under, from `_as_role`; drives the edit rule above. Backfill `'admin'`: every legacy PTM was created through the admin-only RPC. |
| `venue` | text, nullable | free text, shown on cards and the feedback form |
| `scope_type` | text NOT NULL DEFAULT `'school'` | CHECK in (`school`, `wing`, `class`). Backfill: `class` where junction rows or legacy `class_id` exist, else `school`. |
| `scope_wing_id` | uuid, nullable, FK `wings(id)` ON DELETE SET NULL, indexed | label only; the classes are materialised into `ptm_schedule_classes` |
| `slot_booking_enabled` | boolean NOT NULL DEFAULT false | existing rows keep `false`, so a legacy PTM never grows a grid unexpectedly |
| `booking_cutoff_minutes` | integer NOT NULL DEFAULT 60 | CHECK 0..1440 |
| `feedback_edit_days` | integer NOT NULL DEFAULT 3 | CHECK 0..30 |
| `feedback_token` | text NOT NULL UNIQUE DEFAULT `encode(gen_random_bytes(16), 'hex')` | pgcrypto is already installed; 32 hex chars, unguessable, one per PTM |
| `cancelled_at` | timestamptz, nullable | set by `cancel_ptm_schedule` |
| `cancelled_by` | uuid, nullable, FK `profiles(id)` ON DELETE SET NULL, indexed | authorship column: SET NULL per section 21 |
| `cancel_reason` | text, nullable | CHECK `char_length <= 300`; optional reason from the cancel dialog, kept on the record |

Optional but recommended: a CHECK on `status` in (`scheduled`, `cancelled`) after confirming no
production row carries another value (older rows may say `completed`; the frontend already reads
that as completed).

### 2. `ptm_bookings`: new columns, indexes, and the missing delete rules

| Change | Detail |
|---|---|
| `class_id` uuid NOT NULL, FK `classes(id)` ON DELETE CASCADE, indexed | backfill from the student's `class_assignments` row with `role = 'student'`; rows that cannot be resolved get their PTM's single class if it has exactly one, else are soft-cancelled |
| `attended` boolean, nullable | NULL = not marked, true or false once a staff member marks it |
| `cancelled_at` timestamptz, nullable | soft cancel; `status` mirrors it (`booked` / `cancelled`) for legacy readers |
| partial unique index `(ptm_id, class_id, slot_time) WHERE cancelled_at IS NULL` | the capacity rule: one family per class per slot |
| partial unique index `(ptm_id, parent_id) WHERE cancelled_at IS NULL` | one active booking per student per PTM |
| `parent_id` and `teacher_id` delete rules | both FKs were created with no ON DELETE and no migration since has changed them, so they are NO ACTION today and a student with a booking may be undeletable. Set `parent_id` ON DELETE CASCADE (ownership) and `teacher_id` ON DELETE SET NULL (authorship), then run `scripts/probe-user-delete-blockers.sql` and `scripts/probe-user-deletes.sql`. |

### 3. `ptm_feedback` (new)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK | |
| `ptm_id` | uuid NOT NULL FK `ptm_schedules(id)` ON DELETE CASCADE | leading column of the unique below |
| `student_id` | uuid NOT NULL FK `profiles(id)` ON DELETE CASCADE, indexed | the child the feedback is about; equals the caller today |
| `class_id` | uuid NOT NULL FK `classes(id)` ON DELETE CASCADE, indexed | resolved server-side at submit time, never trusted from the client |
| `submitted_by` | uuid, nullable, FK `profiles(id)` ON DELETE SET NULL, indexed | `auth.uid()` at submit; becomes the parent's profile if a parent role ever lands |
| `rating` | smallint NOT NULL | CHECK 1..5 |
| `text_message` | text, nullable | CHECK `char_length <= 1000`; NULL when blank |
| `audio_path` | text, nullable | object name in bucket `ptm-feedback-audio`; must start with `<ptm_id>/<student_id>/` |
| `audio_duration_seconds` | integer, nullable | CHECK 1..120 when set |
| `audio_format` | text, nullable | the MIME type the recorder produced |
| `submitted_at` | timestamptz NOT NULL DEFAULT now() | first submit |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | every edit |
| UNIQUE `(ptm_id, student_id)` | | one feedback per student per PTM; `submit_ptm_feedback` upserts on it |

RLS on. SELECT: `student_id = (select auth.uid()) OR can_view_ptm_feedback((select auth.uid()), ptm_id, class_id)`.
No client INSERT, UPDATE or DELETE policies; writes go through the RPC. `REVOKE ALL FROM anon`.
Attach `tg_audit_row` as `zzz_audit_ins` and `zzz_audit_del` (section 11); do the same for
`ptm_schedules`, which has no audit trigger today.

### 4. Storage bucket `ptm-feedback-audio` (new, private)

* `file_size_limit` 5 MB (5242880). `allowed_mime_types`: `audio/webm`, `audio/mp4`, `audio/ogg`,
  `audio/mpeg`, `audio/wav`, `audio/aac`, `audio/x-m4a`. iOS Safari records `audio/mp4`; Chrome and
  Firefox record `audio/webm` or `audio/ogg`.
* Object name: `<ptm_id>/<student_id>/<uuid>.<ext>`.
* INSERT, UPDATE, DELETE for `authenticated`: bucket matches, segment 2 equals `auth.uid()`, caller
  has the student role, and `ptm_includes_user_class(segment 1, auth.uid())`.
* SELECT for `authenticated`: owner (segment 2 equals `auth.uid()`) OR `ptm_audio_readable(name)`
  (new helper, SECURITY DEFINER, parses the two segments and returns
  `can_view_ptm_feedback(auth.uid(), ptm, class of that student's feedback row)`).
* Same `avatar_owner_from_path` style parser with an EXCEPTION block, so a malformed name yields NULL
  instead of an error.
* A replaced recording leaves the previous object behind; the RPC returns the old path so the client
  deletes it after a successful save. No cleanup cron in this phase.

### 5. Helpers (new, SECURITY DEFINER, `SET search_path TO 'public', 'pg_temp'`, revoked from anon BY NAME)

| Helper | Returns TRUE when |
|---|---|
| `is_class_teacher_of(_user, _class)` | a `class_assignments` row exists with `role = 'teacher'` (any subject or none), the user holds the teacher role in `user_roles`, and `profiles.is_active IS NOT FALSE`. PTM-only, despite the name: it means "teaches this class". Until 2026-09-29 (`20260929170000`) it also required `subject_id IS NULL`. |
| `can_manage_ptm(_user, _ptm)` | same institution AND not cancelled AND (`is_institution_admin` OR (coordinator role AND `scope_type IN ('wing','class')` AND `is_coordinator_for_class` for EVERY class of the PTM AND (`created_as_role = 'teacher'` OR (`created_as_role = 'coordinator'` AND `created_by = _user`))) OR (teacher role AND `scope_type = 'class'` AND `created_as_role = 'teacher'` AND `created_by = _user` AND `is_class_teacher_of` for EVERY class of the PTM)). `is_coordinator_for_class` checks neither role nor institution by itself (noted in the user-avatars migration), so both guards are re-added here. Mirrored for button visibility by `canManagePTM` in `src/lib/ptm.ts`. |
| `can_view_ptm_feedback(_user, _ptm, _class)` | same institution AND the class is one of the PTM's classes (or the PTM is school-wide) AND (`is_institution_admin` OR (coordinator role AND `is_coordinator_for_class`) OR `is_class_teacher_of`) |
| `ptm_classes_for_hat(_user, _as_role)` | not boolean: returns the set of class ids that hat may act on. admin: every active class of the institution; coordinator: classes of the caller's wings; teacher: classes where `is_class_teacher_of`. Raises when the caller does not hold that role. Used by the scope picker and by every dashboard RPC so the scoping rule lives in one place. |

Grant EXECUTE to `authenticated` only for `ptm_classes_for_hat`; the boolean helpers are composed by
policies and RPCs and need `service_role` plus whatever the policies run as. Verify with
`information_schema.routine_privileges` (section 26).

### 6. RPCs (all SECURITY DEFINER, `REVOKE FROM anon` by name, short user-facing error text)

| RPC | Args | Returns | Rules |
|---|---|---|---|
| `ptm_manageable_scope(_as_role text)` | | jsonb `{can_school, wings:[{id,name,class_ids}], classes:[{id,name,section,wing_id}]}` | admin: `can_school = true`, all active wings and classes. coordinator: their wings and the classes in them. teacher: classes from `is_class_teacher_of`. Raises if the caller lacks the role. |
| `create_ptm_schedule(...)` (replace the 2026-09-15 signature) | existing 8 args plus `_as_role text, _scope_type text, _scope_wing_id uuid, _venue text, _slot_booking_enabled boolean, _booking_cutoff_minutes integer, _feedback_edit_days integer` | uuid | `school`: admin only, class list ignored. `wing`: admin, or a coordinator assigned to that wing; the RPC resolves the wing's active classes and writes them to `ptm_schedule_classes`. `class`: non-empty list, every class in `ptm_classes_for_hat`. Validates `end > start`, duration 5..60, cutoff 0..1440, edit days 0..30, every class in the institution. Writes `created_as_role := _as_role` after checking the caller holds that role. One transaction; the deferred notify trigger sees the class rows at commit exactly as today. |
| `update_ptm_schedule(_ptm_id, _title, _description, _venue, _scheduled_date, _start_time, _end_time, _slot_booking_enabled, _slot_duration_minutes, _booking_cutoff_minutes, _feedback_edit_days)` | | void | `can_manage_ptm`; not cancelled. Scope is immutable (cancel and recreate to change who it is for). Changing `slot_duration_minutes`, or turning slot booking off, while active bookings exist is rejected with the count ("6 families have booked. Cancel their slots first."). Date and time changes are allowed and keep bookings; the grid marks any booking that no longer fits as needing a rebook. The existing `tg_ptm_notify_changed` handles the reschedule notice. |
| `cancel_ptm_schedule(_ptm_id, _reason text)` | | void | `can_manage_ptm`; rejected once the meeting has ended ("This meeting has already happened."). Sets `status = 'cancelled'`, `cancelled_at`, `cancelled_by`, and keeps `_reason` (new `cancel_reason text` column, not shown to families yet); bookings are kept (soft); the existing trigger notifies everyone. |
| `ptm_booking_grid(_ptm_id, _class_id)` | | rows `(slot_time, booking_id, student_id, student_name, attended, is_mine, off_grid)` | `_class_id` NULL means the calling student's own class (exactly one `class_assignments` row with `role = 'student'`). Otherwise the caller needs `can_view_ptm_feedback` for that class. Raises "Slot booking is off for this meeting." when it is. Names and student ids are NULL for students. One row per computed slot, plus rows for bookings whose `slot_time` is no longer on the grid (`off_grid = true`). |
| `ptm_class_teachers(_ptm_ids uuid[])` | | rows `(ptm_id, class_id, class_name, class_section, teacher_names)` | at most 100 ids. For a student: only their own class, for each PTM that includes it. For staff in the institution: every class of each PTM (a school-wide PTM means every active class). `teacher_names` is the `is_class_teacher_of` names joined by ", ", NULL when none. Feeds the student card's class teacher line and the detail page's Class teachers card. |
| `ptm_my_bookings()` | | rows `(ptm_id, booking_id, slot_time, class_id)` | the calling student's active bookings, newest PTM first, limit 100. Feeds "Your slot" on the student card. |
| `book_ptm_slot(_ptm_id, _slot_time time, _replace boolean DEFAULT false)` | | uuid | caller holds the student role; class resolved from `class_assignments` (exactly one row with `role = 'student'`, else "Your class is not set up"); PTM includes the class; `slot_booking_enabled`; slot on the grid; booking window open; not cancelled. With `_replace`, the caller's active booking is soft-cancelled in the same transaction. A 23505 on the class-slot index becomes "That slot was just taken. Pick another." A 23505 on the student index becomes "You already have a slot. Cancel it first." |
| `cancel_ptm_booking(_booking_id)` | | void | owner while the booking window is open, or `can_manage_ptm`, or `is_class_teacher_of` the booking's class at any time. Soft: `cancelled_at`, `status = 'cancelled'`. |
| `set_ptm_booking_attended(_booking_id, _attended boolean)` | | void | `can_view_ptm_feedback` for the booking's class. |
| `ptm_resolve_feedback_token(_token text)` | | one row `(ptm_id, title, description, venue, scheduled_date, start_time, end_time, status, scope_type, feedback_token, feedback_edit_days, my_class_id, my_class_name, my_class_section, class_teachers text, window_state, opens_at timestamptz, closes_at timestamptz, my_feedback jsonb)`; `my_feedback` is `{id, rating, text_message, audio_path, audio_duration_seconds, audio_format, submitted_at, updated_at}` or NULL | caller is in the PTM's institution; a student additionally must be in scope (`ptm_includes_user_class`). Staff get the row with the `my_*` fields NULL, so the page can point them at the PTM instead of a form. `window_state` in (`not_open`, `open`, `closed`, `cancelled`). Returns zero rows for an unknown token, never an error that distinguishes "no such token" from "not yours". |
| `ptm_open_for_feedback()` | | rows in the same shape | for the calling student: every PTM including their class whose feedback window is open, newest first. Zero rows means "no active meeting"; two or more means the page shows a picker. |
| `submit_ptm_feedback(_ptm_id, _rating smallint, _text text, _audio_path text, _audio_duration_seconds integer, _audio_format text)` | | jsonb `{feedback_id, previous_audio_path}` | caller holds the student role; `student_id := auth.uid()`; class resolved server-side; PTM includes it; window open; rating 1..5; text trimmed, NULL when blank, max 1000; text or audio or both (rating alone is also accepted, per "text and audio are optional"); `_audio_path` NULL or prefixed `<ptm_id>/<auth.uid()>/`. The client always sends the full audio triple (path, duration, format), including when it keeps the saved recording unchanged, so a plain upsert of all three is correct; `_audio_path` NULL means no voice note and clears duration and format. Upsert on `(ptm_id, student_id)`; returns the previous audio path so the client can delete a replaced recording. |
| `ptm_feedback_summary(_ptm_id, _as_role text)` | | jsonb `{students_in_scope, responses, response_rate (0 to 100, one decimal), avg_rating (one decimal or null), distribution:{"1".."5": count}, per_class:[{class_id, class_name, class_section, class_teachers, students, responses, avg_rating}], bookings:{enabled, total_slots, booked, attended, per_class:[{class_id, total_slots, booked, attended}]}}` | scope = PTM classes intersected with `ptm_classes_for_hat`; a school-wide PTM means every class of the hat with at least one student. `per_class` lists every class in scope, zero-student classes included, so an empty list means "none of your classes" and the UI says so. Counts come from `class_assignments` (`role = 'student'`, active profiles). All aggregation in SQL. |
| `ptm_feedback_list(_ptm_id, _as_role text, _class_id uuid, _rating smallint, _has_audio boolean, _has_text boolean, _sort text, _limit integer, _offset integer)` | | rows `(feedback_id, student_id, student_name, guardian_name, class_id, class_name, class_section, rating, text_message, audio_path, audio_duration_seconds, submitted_at, updated_at, total_count)` | same scope rule; `_limit` capped at 100; `_sort` in (`newest`, `oldest`, `rating_desc`, `rating_asc`); `guardian_name` from `student_personal_details`; `total_count` as a window count so the client pages without a second call. |

`ptm_update` becomes RPC-only in practice: replace its USING and WITH CHECK with
`can_manage_ptm((select auth.uid()), id)` so a direct PostgREST update by a coordinator or teacher is
governed by the same predicate, and keep `ptm_insert` as is (nothing inserts directly). Replace
`ptmb_insert` and `ptmb_update` with deny-all (writes only through the RPCs) and keep `ptmb_select`.

### 7. Notification hook (no new notifications in this phase)

In-app notifications stay exactly as the 2026-09-15 design left them. The two places a future
"slot booked" or "feedback received" notice would plug in are `book_ptm_slot` (after the insert,
recipients = `is_class_teacher_of` rows for the booking's class) and `submit_ptm_feedback` (same
recipients). Both would go through `_ptm_fanout` so the claim ledger keeps them idempotent. SMS, email
and push stay out, per the requester and per the "Deliberately excluded" section of that design.

### 8. Cascade and audit checks after the migration

Run `scripts/probe-user-delete-blockers.sql` and `scripts/probe-user-deletes.sql` (section 21).
Expected: only `support_settings.owner_id` blocks. Verify every new FK has an index (`pg_indexes`),
every new function is revoked from `anon` (`information_schema.routine_privileges`), and the two
partial unique indexes exist (`pg_indexes`, not `pg_constraint`).

## Frontend (built 2026-09-28)

Every surface is gated on `isFeatureEnabled("ptm_scheduling")`: the Communication page drops the PTM
tab, the analytics overview drops its "Upcoming meetings" panel, and the feedback page redirects with
the same toast the route guard uses (`usePTMFeatureGate`, because `FEATURE_URL_MAP` matches exact
pathnames and these carry a token). Until the migration lands, a schema probe (one bounded read of
`ptm_schedules.scope_type`, cached 30 minutes) keeps the list working on the legacy columns, hides
every write, and shows staff a one-line note; the feedback page says it is not set up yet.

| Surface | Where | Who | Built from |
|---|---|---|---|
| PTM list | `/school/communication?tab=ptm` (exists) | everyone the page admits | `PTMPanel`: Upcoming (soonest first) and Past and cancelled sections of `PTMCard`, computed status chip, scope chips, venue; class teacher and "Your slot" for students |
| Create or edit | sheet from the list and the detail view | the hat's `ptm_manageable_scope` | `PTMFormSheet` (`MobileSheet`) with `ScopePicker` (school, wing or classes, limited to the hat), venue, slot booking toggle, slot length, booking cutoff, feedback window. Scope is fixed after creation. |
| Detail | `/school/communication?tab=ptm&ptm=<id>` | staff whose hat covers a class of the PTM | `PTMDetailView`, the Notice Board's `?notice=` pattern, so no route is needed. "All PTMs" steps back through history when the view was opened from the list. |
| Overview tab | | staff | details, Class teachers card, `PTMQRCard` (SVG on screen, a hidden 640px canvas for Download and Print, Copy link), Edit, and Cancel until the meeting ends |
| Bookings tab | | staff in scope | class picker, `SlotGrid` staff mode from `ptm_booking_grid`, attended ticks, off-grid bookings listed separately, Remarks (existing `StudentRemarksPanel`) for the teacher hat |
| Feedback tab | | staff in scope | `FeedbackDashboard` (four StatTiles, rating bars, by-class rows on phones and a table from `sm` up) and `FeedbackList` (FilterSheet for class, rating, has voice note, has message, sort; 20 per page; audio signed only when played; Export CSV) |
| Book a slot | sheet from the student card | student | `BookSlotSheet`: own class's grid, book, move (`_replace`), cancel with confirm, cutoff in words |
| Feedback, in app | sheet from the student card | student | `FeedbackSheet` resolves the card's token and renders `PTMFeedbackForm` |
| Feedback, QR | `/ptm/feedback/:token` and `/ptm/feedback/active` (`NEEDS CORE`) | student login; staff see an explainer | `PTMFeedbackPage` with `mode`, the same `PTMFeedbackForm`: stars (required), message with a 1000 counter, `AudioRecorder` (MediaRecorder, own timer, stop at 2 minutes, refuse over 5 MB, re-record, remove, no-support fallback). Upload first, then the RPC; the client deletes its upload if the RPC fails and deletes the replaced recording after success. Active mode shows a picker when more than one meeting is open. |

Files: `src/lib/ptm.ts` (pure helpers: slot grid, effective status, windows, the hat, the manage
rule, viewable classes), `src/hooks/ptm/*` (one untyped RPC bridge, `ptmKeys`, schedules, bookings,
feedback, the feature gate), `src/components/ptm/*`, `src/pages/PTMFeedbackPage.tsx`,
`src/lib/returnPath.ts`. Retired: `src/hooks/usePTM.ts`, `CreatePTMDialog`, `PTMBookingDialog`,
`PTMSchedulePanel`, and `PTMFeedbackDialog`. The last was the teacher's note on a booking; its button
needed `status = 'completed'`, which nothing ever wrote, so it was unreachable, and its direct UPDATE
cannot survive the RPC-only `ptmb_update` above. `ptm_bookings.feedback` and `rating` stay in the
table, unused by the new UI.

Class labels always come from `formatClassName` on the client; the RPCs return `class_name` and
`class_section`, never a pre-built label, so every screen follows one rule.

QR content is `buildAppUrl("/ptm/feedback/" + token)` (changed 2026-09-29; it was
`window.location.origin`). Never a hard-coded domain: two production frontends share this project
(section 1). The website's build leaves `VITE_PUBLIC_URL` unset, so its QR is unchanged: the page's
own origin. Inside the app that origin is the WebView's (`https://localhost`), which no other phone
can open, so every app build sets `VITE_PUBLIC_URL=https://www.salci.org`. The Android app claims
`https://www.salci.org/ptm/feedback/*` as an App Link, so a scan opens the app on the form when it is
installed and the website otherwise; how it works and how to test it is in
[docs/mobile/README.md](../../mobile/README.md#app-links-the-ptm-feedback-qr).

CSV export pages through `ptm_feedback_list` in chunks of 100 under a hard cap, builds the file with
Papa, and includes signed audio URLs created in one batch call with a 7 day expiry.

### `NEEDS CORE` (Tushar, `src/App.tsx`)

Two routes, nothing else. Staff roles are admitted on purpose: a teacher testing the printed QR gets
an explainer and an "Open this PTM" button instead of a silent bounce to the dashboard.

```tsx
const PTMFeedbackPage = lazy(() => import("./pages/PTMFeedbackPage"));

{/* Family feedback. "active" is the one permanent QR: it opens whichever meeting is taking
    feedback for the student's class. The token route is what each PTM's printed QR carries.
    Static path first, dynamic second. */}
<Route path="/ptm/feedback/active" element={
  <ProtectedRoute allowedRoles={["student", "teacher", "coordinator", "school_admin", "super_school_admin"]}>
    <PTMFeedbackPage mode="active" />
  </ProtectedRoute>
} />
<Route path="/ptm/feedback/:token" element={
  <ProtectedRoute allowedRoles={["student", "teacher", "coordinator", "school_admin", "super_school_admin"]}>
    <PTMFeedbackPage mode="token" />
  </ProtectedRoute>
} />
```

### Login return path (Naman, flagged for Tushar's eye)

Done. `src/components/layout/ProtectedRoute.tsx` now sends a signed-out visitor to `/login` with
`state.from = pathname + search + hash`, and `src/pages/Login.tsx` returns there after sign-in (both
the already-signed-in redirect and the submit path) through `readReturnPath` in
`src/lib/returnPath.ts`. That helper honours only a same-origin path: one leading `/`, no `//`, no
backslash, not an auth page, at most 2048 characters; anything else goes to `/dashboard`. It helps
every deep link, not only the QR. Neither file is on the load-bearing list in section 28, but both
wrap every page, so this is flagged for a look.

**It did not work end to end until 2026-09-29.** A browser run of the real app (stubbed Supabase, 150
ms latency) found two bounces that each landed a signed-out family on the dashboard after sign-in,
on the website as much as in the app:

1. ProtectedRoute's role check also ran for a signed-out visitor. `useUserRole` answers `roles: []`
   without a user, so the check pushed `/dashboard` right after the auth check had sent the visitor
   to `/login`, and the dashboard's own guard then sent them to login with `from: "/dashboard"`. The
   role check now returns early without a user.
2. After sign-in the role cache still held that signed-out answer. `Login` only invalidated it, so
   while the refetch was in flight ProtectedRoute judged `roles: []` and bounced the form to the
   dashboard for a moment (and left it in history). `Login` now calls `resetQueries`, so the guard
   waits for the new user's roles.

Also since then: the login redirect and the return both `replace` (back from the form no longer
lands on a login page that bounces forward again), and Login's already-signed-in redirect is skipped
when the router has already left the page. That last one is for the app: on a slow phone a scanned
QR can navigate between Login's render and its effect, and the late redirect then dropped the family
on the dashboard. Each fix has a scenario that fails with the old file swapped back in.

## Rollout (Tushar)

1. Apply the migration (sections 1 to 6), then run the checks in section 8.
2. Add the two routes above.
3. Turn `ptm_scheduling` on for each school that uses PTM today. **Merging this branch hides the PTM
   tab from every school until its flag is on**, because the tab used to be unconditional.
   The `institution_features` rows for `ptm_scheduling` show who already has it; any school with rows
   in `ptm_schedules` probably wants it too.

## Test data for a scratch institution

Two wings (Primary with 6A, 7A, 7B; Senior with 9A), one coordinator on Primary, a class teacher
(subject-less row) on 6A and 7A, none on 7B, one teacher who teaches a subject in 7B only, and
thirty students per class. PTMs: one school-wide, one Primary wing with slot booking on, one 7A-only
created by the 7A class teacher, one cancelled. A few bookings on the wing PTM, one of them off-grid
after moving the start time, and feedback rows covering every rating, text only, audio only, and
both. This is enough to exercise every row of the permission matrix and every UI state.

## Test matrix (SQL, Tushar, run against a scratch institution and rolled back)

> The matrix as planned on 2026-09-28. What actually runs is `scripts/test-ptm.sql` (real Alliance
> rows, rolled back); its section 10 replaces items 1, 4 and 9 for the 2026-09-29 teacher rule.

1. Teacher who is class teacher of 7A and subject teacher of 7B: `create_ptm_schedule` with
   `[7A]` succeeds; with `[7A, 7B]` fails; with `_scope_type = 'wing'` fails.
2. Coordinator of the Primary wing: `wing` scope for Primary succeeds and materialises exactly the
   wing's active classes; `wing` scope for Senior fails; `class` scope including one Senior class id
   fails even when the rest are Primary.
3. Admin: `school` scope writes zero junction rows and notifies `institution_student_ids` exactly
   (the 2026-09-15 test 3 still passes).
4. `can_manage_ptm`: the creating teacher loses the class-teacher row, then cannot edit or cancel; a
   second class teacher of the same class cannot edit a colleague's PTM; the wing's coordinator can
   edit a teacher's PTM but not another coordinator's or an admin's; nobody can cancel a PTM whose
   end time has passed.
5. Booking: a student of 7B cannot book a 7A-only PTM; two students of 7A cannot hold the same slot
   (second gets the friendly 23505 text); one student cannot hold two active bookings; `_replace`
   moves the booking in one transaction; a slot off the grid is rejected; a booking one minute
   after the cutoff is rejected.
6. Cutoff in a non-IST institution: set `institutions.timezone` far from UTC and assert the cutoff
   flips at the institution's local time, not UTC (the section 24 regression).
7. Feedback: the RPC ignores any client-supplied student id (there is none to supply); a student
   outside the PTM's classes is rejected; token of PTM A never returns PTM B; the window is closed
   before start and after `end + feedback_edit_days`; a second submit updates the same row; an
   `_audio_path` under another student's folder is rejected.
8. Storage: a student cannot INSERT under another student's folder or another PTM's folder; a
   teacher of 7A can SELECT 7A audio and not 7B audio; a coordinator of the wing can SELECT both.
9. Dashboard: `ptm_feedback_summary` under the teacher hat returns only the class-teacher classes;
   under the coordinator hat only the wing's classes; response rate denominators match a manual
   count of active students; the list's `total_count` matches `count(*)` under the same filters.
10. `anon` cannot execute any function in section 5 or 6; every new FK has an index; both partial
    unique indexes exist; the user-delete probes pass.

Frontend: the section 5a gate on every touched file, `npm run test:cache`, the stale-import pass,
and 375px plus dark-mode screenshots of every new surface (section 28).

## Risks

* **The hat argument.** If a dashboard RPC unions scopes instead of taking `_as_role`, a
  teacher-plus-coordinator sees wing data under the teacher hat, the exact trap section 25 names.
  Every scoped RPC takes the hat and re-checks the role.
* **Slot grid drift.** Because slots are computed, changing the duration after bookings exist would
  silently orphan them; hence the RPC rejects it. Date and time changes keep bookings and the grid
  shows off-grid rows rather than hiding them.
* **Audio on iOS.** MediaRecorder on Safari produces `audio/mp4`, sometimes with no duration in the
  blob metadata; the recorder measures duration with its own timer and sends it explicitly.
* **Orphaned recordings.** A successful upload followed by a failed RPC would leave an object behind,
  so the client deletes the object it just uploaded when the RPC fails. A tab closed between the two
  calls can still orphan one; no cleanup cron in this phase.
* **The legacy `parent_id` name.** Kept to avoid churn; every hook aliases it to `student`, and no UI
  string says "parent" about an account.
