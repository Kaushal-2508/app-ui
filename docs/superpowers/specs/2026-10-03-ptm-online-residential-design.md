# Online (residential) PTM mode - Design and server contract

**Date:** 2026-10-03
**Status:** Frontend built on `naman-erp` (2026-10-03), behind a schema probe: nothing online shows
until migration 1 below is live, and the in-person flow is byte-for-byte what it was. Every database
object, cron and the Meet edge function below is `NEEDS DB` / `NEEDS EDGE FN` (Tushar). The frontend
calls exactly the signatures in section 5.
**Builds on:** [2026-09-28-ptm-module-design.md](2026-09-28-ptm-module-design.md) (the in-person
PTM, slot booking, family feedback) and `2026-09-15-ptm-notifications-design.md`. Nothing there is
undone.

> **Status 2026-10-05 (Tushar): migrations 1 to 4 are APPLIED to prod** as `20261005160000` to
> `20261005160300`, in one transaction, verified by `scripts/test-ptm-online.sql` (73) and
> `scripts/test-ptm.sql` (100). What exists and where it differs from section 5 below:
> [2026-10-05-ptm-online-server-status.md](2026-10-05-ptm-online-server-status.md). The frontend
> follows the live shapes since Task 22 (same day): Meet data is in `ptm_booking_meet` and Google
> emails in `user_google_accounts`, neither readable by the browser, so the address is read through
> `get_google_email(_user_id DEFAULT NULL)` (section 5.1's `profiles.google_email` was not built);
> `ptm_online_pick_options` returns one jsonb array; `ptm_online_booking_grid` and
> `ptm_online_my_sessions` also return `slot_starts_at` / `slot_ends_at` in the school's timezone,
> which the Join buttons now prefer over the browser clock; the section 5.7 errors are P0001 with
> their HINTs. Migration 5 and `ptm-meet-create` wait on the Google Workspace setup (we have
> Workspace; the service account, delegation and the owner user are being set up).
>
> **Decision 5 changed the same day (Naman): booking stays open until the meeting starts** (cutoff
> 0, not 4 hours). The frontend sends `_booking_cutoff_minutes: 0`; the server default of 240 is
> never used.
>
> **Decision 5 changed again the same evening (Naman: "after a ptm starts a student still can
> choose a slot"): for an ONLINE PTM, booking stays open for the whole meeting, per slot.** A
> family can book, move or cancel any slot that has not started yet, even while the meeting is
> under way; a slot that has started is greyed "Past" in the grid. Frontend (done on `naman-erp`):
> `ptmBookingWindowOpen` is open until the END for `mode = 'online'`; `PTMCard` offers Book while
> the PTM is `active`; `BookSlotSheet` greys started slots (`slotHasStarted`, `SlotGrid`'s
> `isUnavailable`); the copy reads "Families can book any slot that has not started yet, even after
> the meeting begins" (create form) and "until each slot starts, even once the meeting is under
> way" (card, sheet, Overview). **NEEDS DB (Tushar), `book_ptm_slot` lives in
> `20261005160100_ptm_online_mode_branches.sql` (the "Booking has closed for this meeting." RAISE
> is the one to branch on mode), for `mode = 'online'` only:** (a) `book_ptm_slot` accepts a slot
> while `now() < the slot's start` (school timezone) and the PTM is not cancelled, ignoring
> `booking_cutoff_minutes`; the rebooking (`_replace`) and `cancel_ptm_booking` follow the same
> rule for the slot being left and the slot being taken; (b) `ptm_online_my_sessions.booking_closes_at`
> becomes the booked slot's start (the PTM end while unbooked) and `can_change` follows; (c) the
> in-person rule is unchanged. Until (a) lands the live server refuses a booking after the start
> with "Booking has closed for this meeting", which `toastError` already shows.
>
> **Wording and the admin's first step changed 2026-10-05 (Naman, from the live screens):** the
> user-facing name is **"Online PTM"** everywhere (chooser, sheet titles, "Schedule online PTM",
> toasts, Settings card); "residential" survives only in code and file names. The admin or
> coordinator now picks **the class first, then teachers of that class** (section 3 below). The
> class choice is a filter over the teacher list, read through the notice board's
> `notice_class_staff(_class_ids)`; nothing new is stored and `create_online_ptm` is called exactly
> as before. The date moved off step 1 (no per-day busy greying any more); the overlap check on step
> 2 and the server guard are unchanged. The step breadcrumb and the "Meeting rooms are made about an
> hour before" paragraph were removed, the section titles and hints shortened.
>
> **A Google account is no longer required to schedule (Naman, 2026-10-05, from the live admin
> picker where 5 of 5 teachers were greyed "No Google account yet"):** "admin can select it here, and
> after, when the teacher is able to see the PTM, he/she can add gmail"; and "mostly every teacher
> is logged in as its gmail account, so take that." New rule: **a teacher's Google account is their
> login email unless they set another** (Settings card, or an admin from the Teachers page / the
> list under the picker). The frontend no longer disables or blocks on it anywhere (create sheet,
> Change teachers, Swap, the teacher's own create; the Settings card shows the login email as the
> current value). **NEEDS DB (Tushar), in `20261005160300_ptm_online_rpcs`:** (a) drop the four
> `_ptm_has_google` refusals: `create_online_ptm` teacher branch (HINT `ptm_teacher_no_google`),
> `create_online_ptm` admin branch (same HINT), `set_ptm_online_teachers` (`reason: no_google_email`),
> `swap_ptm_online_teacher`; (b) `get_google_email` returns `COALESCE(user_google_accounts.google_email,
> <login email>)` so the Settings card and the admin's sheet show what Meet will actually use; (c)
> `ptm_online_teacher_options.has_google_email` and `ptm_online_sessions.has_google_email` mean "set
> explicitly" (or are replaced by the effective email); (d) the Meet claim RPC for `ptm-meet-create`
> hands the edge fn the same COALESCE as the co-host email. Until (a) lands the live server still
> refuses: the create sheet catches `ptm_teacher_no_google` and returns to step 1 with the server's
> message, and `set_ptm_online_teachers` names the teacher in the refused toast. Tushar merges the
> branch and applies (a) together, so no user sees the gap.
>
> **Closed 2026-10-06 by Tushar's `20261006120000` (main `4ff3b9e9`):** `get_google_email` falls
> back to the login email and the three online RPCs no longer refuse a teacher without a row
> (`has_google_email` still means "set explicitly"); online booking is per slot until each slot
> starts (`book_ptm_slot` HINT `ptm_slot_started`), `ptm_online_my_sessions.booking_closes_at` /
> `can_change` follow the booked slot. The one-day frontend bridge that wrote the login email
> through `set_google_email` before each call (`28b4dedb`) was removed the same morning; the
> frontend sends exactly what it sent before it.
>
> **Google setup done and proven, 2026-10-06.** Owner / impersonated user is `team@salci.in`
> (existing account, not an admin); service account `salci-ptm-meet@salci-meet.iam.gserviceaccount.com`
> (client id `105886186548955941046`, Cloud project `salci-meet`, Meet REST API enabled, key file
> with Naman for the `GOOGLE_MEET_SERVICE_ACCOUNT_JSON` secret, handed over privately); domain-wide
> delegation for `meetings.space.created` + `meetings.space.settings`; the organisation's default
> `iam.disableServiceAccountKeyCreation` (legacy and managed) overridden to not-enforced for the
> project. A probe from Naman's Mac created two test rooms as team@salci.in
> (`https://meet.google.com/wit-vzag-zah`, `.../bzp-qhyg-pag`). Edition limits: `artifactConfig`,
> `presentRestriction`, `defaultJoinAsViewerType` are `FEATURE_UNAVAILABLE_TO_USER` (defaults are
> already OFF / none), and the members (co-host) API is `404 Method not found`, so **teachers join
> as guests** (accepted by Naman) and rooms stay `OPEN`. The working `config` and the token code
> are in the draft; Tushar builds migration 5 + `ptm-meet-create` from it.
>
> **Server half LANDED 2026-10-06 13:41 (Tushar, main `8a989490`, applied to prod):**
> `20261006140000` (per-teacher hours exactly as asked below, plus `set_ptm_online_teacher_hours`
> and `set_ptm_online_teachers` taking `_teacher_windows`, new HINTs `ptm_hours_outside`,
> `ptm_hours_has_bookings`, `ptm_hours_invalid`, refusal reason `hours_has_bookings`),
> `20261006140100` + edge function `ptm-meet-create` (rooms for bookings whose slot starts between
> 30 minutes ago and 60 minutes from now, cron every minute, locked to RESTRICTED after the slot
> plus gap plus 15 minutes, 15-minute reminders, no co-host). The PGRST202 wording in the
> paragraph below is therefore history. Status note items 13 to 24 are the contract. The frontend
> on `naman-erp` already reads every field named there; what is still missing for production is
> the MERGE of `naman-erp` into `main` (18 commits), which conflicts only on the work-queue doc.
>
> **Class sessions (Naman, 2026-10-06, afternoon): SUPERSEDES the "Panel format" paragraph that stood
> here.** After the server half landed Naman described the original workflow (admin picks teachers for
> the same meeting; one Meet link for all of them and one student, another link for the next student)
> and then, from the live form, the shape he wants: "when a single class is chosen a new box appears
> with the teachers of that class; after selecting another class another teacher box appears; if a
> teacher is already selected they cannot be reselected, greyed, teacher is already busy". Picker: a
> session per class with its own hours. The admin flow is now Step 1 Date and time, Step 2 Classes
> and teachers (one box per class: hours inside the meeting, that class's teachers, and for
> "Together" its students); the format switch (Separately / Together) is per PTM and lives above the
> boxes. The permutation table, the frontend map, the flat payload sent to today's server, and the
> complete `NEEDS DB` contract (`ptm_online_class_sessions`, `ptm_schedules.online_format`,
> `create_online_ptm(..., _online_format, _class_sessions)`, `set_ptm_online_class_sessions`, the
> per-session grid and reads, probe level `sessions`) are in
> [2026-10-06-ptm-online-class-sessions-design.md](2026-10-06-ptm-online-class-sessions-design.md).
> The per-teacher hours below stay for the flat server; with class sessions the SESSION carries the
> hours. The same afternoon the Overview was made compact (four short facts, no "For" chips, no
> "My session" card: each teacher row carries students, booked, attended and hours) and the "Edit my
> students" button went: a teacher's student list is edited from the PTM's Edit sheet, which a
> participating teacher of an admin-made PTM also gets (students only).
>
> **Per-teacher hours (Naman, 2026-10-06: "admin can also choose the slot of teachers, like from
> 12 to 3:00 one teacher"; picker: own window per teacher).** In an admin- or coordinator-made
> online PTM each teacher may run a NARROWER window than the meeting's: Meera 12:00 to 3:00, Ravi
> 3:00 to 6:00, the rest the whole window. Families of a teacher on own hours see only those slots.
> **Frontend (done on `naman-erp`):** step 2 lists the chosen teachers under the times
> (`TeacherWindowsFields`): "Meeting hours, 3:00 PM to 5:40 PM" with an "Own hours" button that
> opens From / To for that teacher (prefilled with the meeting's), a slot count, and inline errors
> ("Must be within the meeting", "Shorter than one slot", "The end must be after the start") that
> block Create. The busy check uses a teacher's own hours. The create payload adds
> `_teacher_windows: [{teacher_id, start_time, end_time}]` ONLY for teachers with own hours, so a
> PTM without them calls the RPC exactly as today; with them, the live server answers PGRST202 and
> the app says "Teachers' own hours aren't available yet. Put every teacher on the meeting hours
> for now." The Bookings tab shows "Own hours: 3:00 PM to 4:00 PM" under the count when
> `ptm_online_sessions` returns the teacher's window; the family's booking sheet subtitle uses
> `ptm_online_my_sessions.teacher_start_time / teacher_end_time` when present.
> **NEEDS DB (Tushar):**
> - `ptm_online_teachers` gains `start_time time`, `end_time time` (both NULL = the meeting's
>   window; CHECK both set or neither, `end_time > start_time`). A trigger or the RPCs keep them
>   inside the PTM's `start_time..end_time` and at least one slot long
>   (`_ptm_slots` for that window non-empty).
> - `create_online_ptm(..., _teacher_windows jsonb DEFAULT NULL)`: array of
>   `{teacher_id uuid, start_time time, end_time time}`; every id must be in `_teacher_ids`;
>   validated as above; stored on the teacher row.
> - `set_ptm_online_teachers(_ptm_id, _teacher_ids, _teacher_windows jsonb DEFAULT NULL)`: same
>   shape; a teacher kept without an entry keeps their current hours; plus
>   `set_ptm_online_teacher_hours(_ptm_id, _teacher_id, _start_time, _end_time)` (NULLs = back to
>   the meeting's) for an admin, the creator, or that teacher, refused while any of that teacher's
>   bookings would fall outside the new hours (name them, like the reschedule check).
> - Slots are per teacher: `_ptm_slots(_ptm_id, _teacher_id)` / `_ptm_slot_ok` use the teacher's
>   effective window; `ptm_online_booking_grid` lists only that window; `book_ptm_slot` and
>   `_replace` refuse a slot outside it ("That time is not one of this teacher's slots.");
>   `_ptm_teacher_bookings` / the busy guard hold a teacher for their own window plus the gap;
>   `ptm_feedback_summary.total_slots` sums per teacher; `update_ptm_schedule` refuses a new PTM
>   window that no longer contains a teacher's hours (name them) rather than clamping silently.
> - Reads: `ptm_online_sessions` adds `start_time`, `end_time` (the effective window; NULL when
>   the meeting's); `ptm_online_my_sessions` adds `teacher_start_time`, `teacher_end_time` (same);
>   `ptm_online_teacher_options` unchanged.
> - Notifications: `ptm_online_assigned` and `ptm_reminder_15m` wording may carry the teacher's
>   hours; nothing else changes.
>
> **Step 2 made compact the same evening (Naman, from a desktop screenshot: "too much empty space
> and very confusing"):** who was picked is one line at the top ("2 teachers: Meera Nair, Ravi
> Kumar · Change", or "3 students across 2 classes"), not a section; the description is folded
> into an "Add a description" link until wanted (always open on edit); slot length and gap sit side
> by side from `sm` up; the feedback window is one row (words left, select right). On a 1280px
> screen the whole step now fits one screen with the Feedback heading visible; nothing changed in
> what is sent.

## 1. Why

Some students board at the school, so their parents cannot come to an in-person PTM. Naman
(2026-10-03): when staff press "Schedule a PTM" they choose Regular (the existing flow) or
Residential (online, Google Meet). A teacher who creates a residential PTM picks the students, then
the timing. An admin or coordinator picks the participating teachers first, then the timing; each
teacher then opens the PTM and picks their own students. Families book a slot with their child's
teacher and join a Meet room from the app.

## 2. Decisions (with Naman, 2026-10-03)

| # | Decision |
|---|---|
| 1 | **Meet rooms are created by SALCI** through the Google Meet REST API with a SALCI service account: one room per booked slot, made about an hour before it, lobby on, no recordings, the teacher as co-host. Not teacher-pasted links. **Reconfirmed 2026-10-05 (Naman): per slot, not per teacher, because Google Meet caps a call at one hour; the teacher moves to the next room when one is done.** What changed is the wording and the margin: every booked slot shows its Join, and all read "On hold" except the one whose turn it is. Join turns on two minutes before the slot (was ten) and off at its end plus the gap. The family hears "On hold · Your turn at 3:40 PM" / "Join now" / "Your slot is over"; the teacher's grid reads "On hold · Slot at 3:40 PM" / "Join now" / "Done", with a "Now" chip on the slot in progress. |
| 2 | **No residency flag.** "A teacher knows who is resident": the picker lists every student of every class the teacher teaches. |
| 3 | The pasted spec's "class teacher only" maps onto the live rule (2026-09-29): any teacher with a teacher row on a class is a teacher of that class. The admin picks the teachers; there is no per-class table. |
| 4 | One teacher per student per PTM. A student already picked by another teacher of the same PTM is greyed in the picker ("With Ms X") and refused by the server. **Reversed 2026-10-09:** a student may be with several teachers, one booking per teacher; see [2026-10-09-ptm-online-many-teachers-per-student-design.md](2026-10-09-ptm-online-many-teachers-per-student-design.md). |
| 5 | Families book until the meeting starts (cutoff 0; changed 2026-10-05 from the pasted spec's 4 hours, which Naman did not want). The room cron runs every 5 minutes, so a late booking still gets its link. The pasted spec's school-level setting is not added: there is no settings table, and decision 5 of the PTM spec already made the cutoff per PTM. |
| 6 | Only the creator (under the hat they created it with) or an admin edits or cancels an online PTM. A participating teacher edits ONLY their own student list, until the meeting ends. |
| 7 | The Join button opens 10 minutes before the slot and closes at slot end plus the gap. Disabled with a reason otherwise. |
| 8 | Feedback after an online PTM is the existing in-app family feedback form. No QR for online PTMs. |
| 9 | Slot gap (buffer) default 5 minutes, set at creation, immutable afterwards. |
| 10 | The pasted spec ended mid-sentence at the Join button; nothing follows it. |

## 3. What the user sees

**Chooser.** "Schedule PTM" opens a centred sheet: Regular PTM ("At the school. Choose the school,
a wing or classes; families book a slot per class.") or Online PTM ("On Google Meet. You pick the
students; families book a slot with you." for a teacher, "On Google Meet. You pick a class and its
teachers; each teacher picks their students." for an admin or coordinator). Before migration 1 is
live the chooser never mounts and the button opens the regular form directly.

**Teacher creates.** Step 1 "Students": every class they teach, each a collapsible with a tri-state
class checkbox (the whole-class shortcut), students beneath, search, taken students greyed with the
other teacher's name. Step 2 "Date and time": title, description, date, start, end, slot length
(5/10/15/20/30), gap (0/5/10), a live preview ("8 slots per teacher from 3:00 PM: 15 minutes each
with a 5-minute gap. Last slot 5:20 PM."), the feedback window; the note under it reads "Families
can book until the meeting starts." A teacher with no Google account set sees a quiet note, "Meet
will use your login email, x@gmail.com" with "Use another account", and schedules anyway.

**Admin or coordinator creates.** Step 1 "Class and teachers" (since 2026-10-05): a Class
multi-select first (the hat's manageable classes from `ptm_manageable_scope`, sorted, "All classes"
on top), then a Teachers multi-select limited to teachers of the chosen classes
(`notice_class_staff(_class_ids)` intersected with `ptm_online_teacher_options`, so the Google flag
still comes from the PTM RPC). Until a class is chosen the teacher field reads "Choose a class to
see its teachers."; a class with no teacher reads "No teacher is assigned to this class yet."
Changing the classes drops any ticked teacher no longer in one of them. Every teacher is selectable;
one with no Google account set reads "Google account not set; joins with their login email", and a
collapsible "N teachers have no Google account set" under the picker lets an admin set one. Hint:
"Each teacher then picks their students." Next needs at least one class and one teacher. Step 2: as above, with the date; chosen teachers whose other PTM overlaps the
entered times are listed as conflicts and block Create until removed. If the server still refuses
(`ptm_teacher_busy`), the sheet returns to step 1 with the busy windows refreshed. The class choice
is not sent anywhere: each teacher's student picker still spans every class they teach (narrowing
it to the admin's classes would need a server change, see section 7).

**Staff detail (online).** Header: status plus an "Online" badge. Overview: Format, For (chips of
the classes the picked students are in, or "No students picked yet"), Slots, Feedback; a "My
session" card for a participating teacher (Students, Booked, "Pick students" / "Edit my students
(N)", a Google-account nudge, a note when rooms failed); a Teachers card listing every session with
counts and a "No Google account" warning. Bookings: a Teacher select instead of the class select,
then the slot grid with the class under each name, a Join button per booked slot, attendance and
Remarks as before. Feedback tab unchanged. Edit opens the residential sheet in one-step mode (who
is in it is read-only; slot length locked once a family has booked; the gap always locked).

**Student (the family account).** The card shows "Online", "Online with Ms X", "Book a slot"; once
booked, "Your slot: 3:40 PM" and the Join button ("Opens at 3:30 PM", "Link not ready yet", "Slot
over", or live). A student sees an online PTM only if a teacher picked them for it. The booking
sheet is titled "Book a slot with Ms X" and shows the teacher's grid. The feedback ticket reads
"Online with Ms X" and asks "How was your online meeting with Ms X?".

**Google account.** Settings gets a card "Online meetings: Google account" for staff (set, change,
remove, email-shape check, copy says it must be the Google account they join Meet with). On the
Teachers page an admin's row menu gains "Google account for online PTMs".

**Notifications.** New types get icons; every `ptm_*` notification with `metadata.ptm_id` now opens
`/school/communication?tab=ptm&ptm=<id>` (staff land on the detail).

## 4. Frontend map (built)

| Path | What |
|---|---|
| `src/lib/ptm.ts` | `PTMMode`, `PTM_ONLINE_DEFAULTS`, `PTM_JOIN_EARLY_MINUTES`, `buildSlotGrid(start, end, duration, buffer = 0)`, `slotBounds`, `joinWindowState`, `joinButtonState`, `ptmBusyWindow`, `windowsOverlap`, `isPtmTeacherBusyError`, `canManagePTM` online branch, `canOpenPTM(..., isParticipant)`, `canEditOwnSession` |
| `src/hooks/ptm/usePTMSchedules.ts` | three-level schema probe (`legacy`, `full`, `online`), the online select (`mode, slot_buffer_minutes, online_teachers:ptm_online_teachers(teacher_id)`), `PTMSchedule.mode / slot_buffer_minutes / online_teacher_ids` |
| `src/hooks/ptm/usePTMOnline.ts` | every online hook, one per RPC in section 5 |
| `src/hooks/ptm/useGoogleEmail.ts` | `useMyGoogleEmail`, `useSetGoogleEmail`, `isPlausibleEmail` |
| `src/hooks/useNow.ts` | 30 s tick plus visibilitychange, for the Join buttons |
| `src/components/ptm/PTMModeChooserSheet.tsx` | the two-card chooser |
| `src/components/ptm/ResidentialPTMSheet.tsx` | create (two steps) and edit (one step) |
| `src/components/ptm/ResidentialStudentPicker.tsx` | classes > students, tri-state, taken greyed |
| `src/components/ptm/ParticipatingTeacherPicker.tsx` | teachers multi-select with busy and no-Google rows |
| `src/components/ptm/OnlineTimingFields.tsx` | date, times, slot length, gap, preview |
| `src/components/ptm/OnlineDetailTabs.tsx` | `OnlineOverviewTab`, `OnlineBookingsTab`, `ResidentialStudentPickerSheet` |
| `src/components/ptm/OnlineTeacherSheets.tsx` | `ChangeTeachersSheet` (admin or the creating coordinator: `set_ptm_online_teachers`, refusals named) and `SwapTeacherSheet` (admin: `swap_ptm_online_teacher`, confirm first, out-of-scope warning) |
| `src/components/ptm/JoinMeetButton.tsx`, `PTMModeBadge.tsx`, `GoogleEmailSheet.tsx`, `GoogleAccountCard.tsx`, `Fact.tsx`, `formParts.tsx`, `formOptions.ts` | shared pieces |
| `PTMPanel`, `PTMDetailView`, `PTMCard` (`highlight` for a notification's `?ptm=`), `BookSlotSheet`, `SlotGrid` (render props), `PTMScopeChips` (`emptyLabel`), `PTMFeedbackForm`, `SettingsPage`, `SchoolTeachersPage`, `NotificationPanel`, `notificationLink.ts` | wired |

Teachers after creation: the Teachers card on the Overview has "Change teachers" (the creator under
their hat or an admin, never on a teacher-made PTM, until the meeting ends) and a "Swap" per row
(admin). A teacher whose families have booked cannot be removed, only swapped; the sheet says so
before the save and the server names them after. The swap list leaves out teachers already in the
PTM, disables those without a Google account or busy at that time, and asks for confirmation naming
the booked families. The Meet edge function has a reference draft in
[2026-10-03-ptm-meet-create-draft.md](2026-10-03-ptm-meet-create-draft.md).

## 5. Server contract (`NEEDS DB` / `NEEDS EDGE FN`, Tushar)

The one trap that runs through all of it: the module reads **zero `ptm_schedule_classes` rows as
"the whole school"** (`ptm_effective_class_ids`, `ptm_includes_user_class` behind `ptm_select`,
`ptm_audience`, `book_ptm_slot`, `ptm_booking_grid`, `_ptm_feedback_context`, `can_manage_ptm`). An
online PTM has no class rows, so every one of those must branch on `mode` **before** the first online
PTM exists (migration 2 ships before migration 4). Online PTMs set `scope_type = 'class'` and keep
zero junction rows; their reach is their participants.

### 5.1 Schema (migration 1, `20261003100000_ptm_online_schema.sql`)

- `ptm_schedules.mode text NOT NULL DEFAULT 'in_person'` CHECK in (`in_person`, `online`);
  `slot_buffer_minutes integer NOT NULL DEFAULT 0` CHECK 0..30; CHECK
  `mode <> 'online' OR (slot_booking_enabled AND scope_type = 'class' AND scope_wing_id IS NULL AND venue IS NULL)`;
  index `(scheduled_date) WHERE mode = 'online' AND status = 'scheduled'` for the crons.
- `ptm_online_teachers (id uuid PK, ptm_id uuid NOT NULL REFERENCES ptm_schedules ON DELETE CASCADE, teacher_id uuid NOT NULL REFERENCES profiles ON DELETE CASCADE, added_by uuid REFERENCES profiles ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (ptm_id, teacher_id))`,
  indexes on `teacher_id` and `added_by`; RLS on, anon revoked; SELECT for the institution's staff
  (`ptm_class_rows_readable(ptm_id) AND NOT has_role((select auth.uid()), 'student')`), **the list
  embed `online_teachers:ptm_online_teachers(teacher_id)` depends on it**; no write policies;
  `tg_audit_row` on insert and delete.
- `ptm_online_participants (id uuid PK, ptm_id uuid NOT NULL, student_id uuid NOT NULL REFERENCES profiles ON DELETE CASCADE, teacher_id uuid NOT NULL, class_id uuid NOT NULL REFERENCES classes ON DELETE CASCADE, added_by uuid REFERENCES profiles ON DELETE SET NULL, created_at, UNIQUE (ptm_id, student_id), FOREIGN KEY (ptm_id, teacher_id) REFERENCES ptm_online_teachers (ptm_id, teacher_id) ON UPDATE CASCADE ON DELETE CASCADE)`,
  indexes on `(ptm_id, teacher_id)`, `student_id`, `class_id`, `added_by`; SELECT for staff as above
  OR `student_id = (select auth.uid())`; audit triggers. `class_id` is the student's class at pick
  time (feedback and the grid read it). Two tables, because a teacher row must exist with zero
  students (the admin flow) and the composite FK makes a teacher swap one UPDATE.
- `ptm_bookings`: `mode text NOT NULL DEFAULT 'in_person'` (set by a trigger from the PTM, never
  by the client); `meet_uri text`, `meet_space_id text`, `meet_created_at timestamptz`,
  `meet_claimed_at timestamptz`, `meet_attempts smallint NOT NULL DEFAULT 0`, `meet_error text`
  (<= 500), `meet_cohost_set boolean NOT NULL DEFAULT false`; `teacher_id` unchanged (SET NULL) and
  set for online bookings from the participant row. Indexes: DROP `ptm_bookings_one_per_class_slot`
  and recreate as `(ptm_id, class_id, slot_time) WHERE cancelled_at IS NULL AND mode = 'in_person'`;
  new `ptm_bookings_one_per_teacher_slot (ptm_id, teacher_id, slot_time) WHERE cancelled_at IS NULL AND mode = 'online'`;
  `ptm_bookings_one_per_student` unchanged (both modes); `(ptm_id, slot_time) WHERE cancelled_at IS NULL AND mode = 'online' AND meet_uri IS NULL`
  for the claim scan. **No CHECK tying `mode` to `teacher_id`**: the teacher-delete cascade sets it
  NULL and a CHECK would abort the delete. Shape trigger `tg_ptm_bookings_online_shape` BEFORE
  INSERT OR UPDATE OF ptm_id, teacher_id, parent_id, class_id, mode: return early on
  `is_user_delete_cascade_update(TG_RELID, to_jsonb(OLD), to_jsonb(NEW))`; on INSERT copy `mode`
  from the PTM; refuse an UPDATE of `mode`; online requires `teacher_id` and a participant row
  `(ptm_id, parent_id, teacher_id)` with `class_id = NEW.class_id`; in-person INSERT requires
  `teacher_id IS NULL`.
- `profiles.google_email text` with CHECK `google_email IS NULL OR (google_email = lower(btrim(google_email)) AND char_length(google_email) <= 254 AND google_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')`.
  A column, not a table: same sensitivity as `profiles.email` and `phone`; only the owner and the
  school's admins read it, every picker returns `has_google_email` only.
- Backfill: defaults only. After migrations 1 and 3 run both user-delete probes.

Slot grid, both modes: slot k = `start_time + k * (slot_duration_minutes + slot_buffer_minutes)` while
`slot_k + slot_duration_minutes <= end_time`. New internal `_ptm_slots(_ptm_id) RETURNS SETOF time` and
`_ptm_slot_ok(_ptm_id, _slot time)` replace the inline arithmetic; `buildSlotGrid(start, end,
duration, buffer = 0)` in `src/lib/ptm.ts` is the mirror (buffer 0 keeps every in-person grid identical).

### 5.2 Mode branches (migration 2, `20261003100100_ptm_online_mode_branches.sql`, CREATE OR REPLACE)

| Function | Online branch |
|---|---|
| `ptm_effective_class_ids` | `SELECT DISTINCT class_id FROM ptm_online_participants WHERE ptm_id = _ptm_id`; empty is empty, never the school |
| `ptm_includes_user_class` (student RLS, audio) | `EXISTS participant WHERE student_id = _user_id` |
| `ptm_audience` | participants (is_teacher false) UNION `ptm_online_teachers` (is_teacher true), same active and role filters |
| `can_manage_ptm` | `is_institution_admin OR (created_by = _user AND _ptm_has_hat(_user, inst, created_as_role))`, never when cancelled (frontend mirror: `canManagePTM`, online branch) |
| `can_view_ptm_feedback` | `OR EXISTS participant WHERE ptm_id AND teacher_id = _user AND class_id = _class` |
| new `_ptm_student_scope(_ptm_id, _user) RETURNS TABLE(class_id, teacher_id)` | in person: `(_ptm_student_class(_user), NULL)` when in the effective classes; online: the participant row; zero rows when out of scope. Used by `book_ptm_slot`, `submit_ptm_feedback`, `_ptm_feedback_context`, `ptm_open_for_feedback`, the two grids |
| `book_ptm_slot(_ptm_id, _slot_time, _replace)` (signature unchanged) | scope from `_ptm_student_scope` (zero rows: 42501 HINT `ptm_not_participant`); **`teacher_id` from the participant row, never from the client**; `class_id` from it too; slot via `_ptm_slot_ok`; insert with `teacher_id`; `unique_violation` on `_one_per_teacher_slot` or `_one_per_class_slot` -> "That slot was just taken. Pick another." (HINT `ptm_slot_taken`), on `_one_per_student` -> "You already have a slot. Cancel it first."; then `ptm_booking_confirmed` to the student and `ptm_slot_booked` to the teacher, keyed by booking id |
| `cancel_ptm_booking` | also allowed for `mode = 'online' AND teacher_id = me`; notifies `ptm_slot_cancelled` (family cancelled) or `ptm_booking_cancelled` (staff cancelled) |
| `update_ptm_schedule` (signature unchanged) | online: `venue := NULL`, `_slot_booking_enabled` must be true (HINT `ptm_online_booking_off`), duration change with bookings refused as today, buffer is not a parameter (immutable); a date or time change runs the busy guard |
| `ptm_booking_grid` | online: RAISE 22023 HINT `ptm_online_grid` "This is an online PTM. Open its sessions instead." |
| `_ptm_feedback_context`, `ptm_resolve_feedback_token`, `ptm_open_for_feedback` | class from `_ptm_student_scope`; `class_teachers` = the assigned teacher's name; **add two output columns `mode text, my_teacher_name text`** (RETURNS TABLE change: DROP + recreate + regrant by exact signature for the two granted ones) |
| `ptm_feedback_summary` | `total_slots = slots * count(ptm_online_teachers)` when online; `students_in_scope` = participants |
| `tg_ptm_notify_scheduled`, `ptm_send_day_before_reminders` | online audience; `ptm_scheduled` goes to the teachers only (students hear through `ptm_online_invited`) |
| `_ptm_fanout` | the one signature change: DROP `(uuid,text,text,text,uuid[])`, recreate as `(_ptm_id uuid, _type text, _title text, _message text, _recipients uuid[], _dedupe_suffix text DEFAULT NULL, _link text DEFAULT NULL, _metadata jsonb DEFAULT NULL) RETURNS integer`; claim key `_type || COALESCE(':' || _dedupe_suffix, '')`, `link = COALESCE(_link, '/school/communication?tab=ptm')`, metadata `{ptm_id} || _metadata`; regrant service_role |

Safety net `tg_ptm_online_participant_removed` AFTER DELETE ON `ptm_online_participants` FOR EACH ROW,
exception-wrapped: cancel the student's active online booking on that PTM, notify
`ptm_booking_cancelled`, delete their `ptm_online_invited` claim so a re-add notifies again. One
mechanism for the RPC removal, a teacher removal, a teacher profile delete and a PTM delete.

### 5.3 Teacher busy guard (migration 3, `20261003100200_ptm_online_teacher_guard.sql`)

No `btree_gist` is installed, so this copies the exam slot guard (`20260928170000`):

- `_ptm_busy_window(_date, _start, _end, _buffer, _tz) RETURNS (starts_at, ends_at)`: half-open
  `[date+start, date+end+buffer)` in the institution's timezone. Mirror: `ptmBusyWindow` in
  `src/lib/ptm.ts`.
- `_ptm_teacher_bookings(_teacher_ids uuid[], _from timestamptz, _to timestamptz, _exclude_ptm uuid) RETURNS TABLE(teacher_id, ptm_id, mode, title, starts_at, ends_at, created_by)`
  STABLE SECURITY DEFINER: (a) every scheduled online PTM the teacher is in `ptm_online_teachers`
  of, UNION (b) every scheduled in-person PTM the teacher is in scope of (`is_class_teacher_of` on
  any effective class; a school-wide PTM holds every teacher); overlap `starts_at < _to AND ends_at > _from`;
  pre-filter by date. Shared by the guard and the read RPC so they cannot disagree.
- `_ptm_assert_teachers_free(_ptm_id, _teacher_ids, _from, _to)` VOLATILE SECURITY DEFINER: return
  when `_to <= now()` or empty; `pg_advisory_xact_lock(hashtextextended('ptm_teacher:' || id::text, 0))`
  per teacher in sorted order; re-read in a fresh statement; on a hit `RAISE EXCEPTION USING
  ERRCODE = 'P0001', HINT = 'ptm_teacher_busy', DETAIL = json {teacher_id, ptm_id, mode, starts_at, ends_at}`,
  MESSAGE `{name <= 30} is already in "{title <= 36}" from HH:MI to HH:MI on DD Mon. Pick another time or teacher.`
- Triggers: `ptm_online_teachers_busy_guard` AFTER INSERT OR UPDATE OF teacher_id, FOR EACH STATEMENT
  with `REFERENCING NEW TABLE` (per PTM: lock the row FOR SHARE, skip unless online and scheduled,
  assert all new teachers free; statement-level so two admins inserting `[A,B]` and `[B,A]` cannot
  deadlock); `ptm_schedules_online_busy_guard` BEFORE INSERT OR UPDATE OF scheduled_date,
  start_time, end_time, slot_buffer_minutes, status, mode FOR EACH ROW (return on the user-delete
  cascade predicate, unless online and scheduled, unless the window is unchanged).
- Only online writes are guarded (editing an in-person PTM onto a teacher's online session is not
  refused; the online session should move). Flip by extending the row trigger if it bites.
- Read RPC (granted): `ptm_teacher_busy_windows(_date date, _teacher_ids uuid[] DEFAULT NULL, _exclude_ptm uuid DEFAULT NULL) RETURNS TABLE(teacher_id uuid, ptm_id uuid, mode text, title text, starts_at timestamptz, ends_at timestamptz, is_own boolean)`
  STABLE SECURITY DEFINER. Caller not a student; `_teacher_ids` NULL = every teacher in the caller's
  scope (admin: the school; coordinator: teachers on a class in their wings; teacher: self), else at
  most 100 ids with out-of-scope ones dropped; the day is the institution's local day; limit 500.
  **The frontend calls it with `_teacher_ids: null`** once per date.

### 5.4 RPCs (migration 4, `20261003100300_ptm_online_rpcs.sql`)

All SECURITY DEFINER, `SET search_path = public, pg_temp`, `REVOKE ALL FROM PUBLIC` and `FROM anon` by
exact signature, `GRANT EXECUTE TO authenticated, service_role`. `me = auth.uid()`.

| RPC | Returns | Who | Rules |
|---|---|---|---|
| `create_online_ptm(_institution_id uuid, _title text, _description text, _scheduled_date date, _start_time time, _end_time time, _slot_duration_minutes integer, _slot_buffer_minutes integer DEFAULT 5, _as_role text DEFAULT 'teacher', _teacher_ids uuid[] DEFAULT NULL, _student_ids uuid[] DEFAULT NULL, _booking_cutoff_minutes integer DEFAULT 240, _feedback_edit_days integer DEFAULT 3)` | `uuid` | the hat holder | duration 5..60, buffer 0..30, cutoff 0..1440, edit days 0..30, end > start, at least one slot. Inserts the schedule (`mode = 'online'`, `scope_type = 'class'`, `slot_booking_enabled = true`, `venue = NULL`, `created_as_role = _as_role`), no junction rows. **Teacher hat:** `_teacher_ids` NULL or `[me]`; me must have `google_email` (else `ptm_teacher_no_google`: "Add your Google account email under Settings before scheduling an online PTM."); each `_student_ids` entry an active student with exactly one class row in a class `is_class_teacher_of(me, class)`, else raise. **Admin or coordinator hat:** `_teacher_ids` required, non-empty, distinct, each holds the teacher hat in the institution, active, has `google_email` (else `ptm_teacher_no_google` naming them), in the hat's scope; `_student_ids` must be NULL (`ptm_students_later`). Teacher rows inserted in one sorted INSERT (the busy trigger asserts them). Fan-out: `ptm_online_invited` to inserted students; `ptm_scheduled` (deferred trigger) to the teachers. |
| `set_ptm_online_students(_ptm_id uuid, _student_ids uuid[], _teacher_id uuid DEFAULT NULL)` | `jsonb {added, removed, kept, cancelled_bookings, refused: [{student_id, full_name, reason}]}` reason in `not_your_class, taken, not_a_student, no_single_class` | `_teacher_id` NULL: me, who must be in `ptm_online_teachers`; non-NULL: `is_institution_admin` | PTM online, scheduled, not ended; `FOR UPDATE` on the PTM row; eligible classes = `ptm_classes_for_hat(teacher, 'teacher')`; eligible student = active, student role, exactly one class row, class eligible. Diff in ONE transaction: insert `ON CONFLICT (ptm_id, student_id) DO NOTHING RETURNING`, an id not returned and not already mine is `taken` (named); removing a student with an active booking cancels it (via the safety net, which notifies) and counts in `cancelled_bookings`; removed students lose their `ptm_online_invited` claim; added students get `ptm_online_invited`. Allowed after the cutoff. **The frontend always sends the full new list.** |
| `set_ptm_online_teachers(_ptm_id uuid, _teacher_ids uuid[])` | `jsonb {added, removed, kept, refused: [{teacher_id, full_name, reason}]}` reason in `no_google_email, not_a_teacher, out_of_scope, busy, has_bookings` | admin, or the creating coordinator | diff in one transaction; a removal is refused by name when that teacher has an active booking (`has_bookings`); removed teachers' participants get `ptm_online_uninvited` before the cascade; additions checked by the busy trigger, caught and reported as `busy`; `ptm_online_assigned` / `ptm_online_unassigned` to the teachers. A teacher-created PTM refuses any change (`ptm_teacher_fixed`). No UI yet. |
| `ptm_online_pick_options(_ptm_id uuid DEFAULT NULL, _teacher_id uuid DEFAULT NULL)` | rows `(student_id uuid, full_name text, class_id uuid, class_name text, class_section text, state text, taken_by_name text, booked boolean)` state in `free, mine, taken` | the teacher (self), admin for another | every active student of the classes the teacher teaches (`ptm_classes_for_hat`), students without exactly one class row excluded; `_ptm_id` NULL = the create flow (everything `free`); `booked` = active booking with this teacher on this PTM; ordered by class then name; cap 2000 |
| `ptm_online_teacher_options(_as_role text)` | rows `(teacher_id uuid, full_name text, has_google_email boolean, class_count integer)` | admin: every active teacher; coordinator: teachers on a class in their wings; teacher: self | never returns the address |
| `ptm_online_sessions(_ptm_id uuid)` | rows `(teacher_id uuid, teacher_name text, has_google_email boolean, student_count integer, booked_count integer, attended_count integer, meet_failed_count integer, is_me boolean)` | any non-student of the institution | `meet_failed_count` = active bookings with `meet_attempts >= 5 AND meet_uri IS NULL` |
| `ptm_online_booking_grid(_ptm_id uuid, _teacher_id uuid DEFAULT NULL)` | rows `(slot_time time, booking_id uuid, student_id uuid, student_name text, class_id uuid, class_name text, class_section text, attended boolean, is_mine boolean, meet_uri text, meet_ready boolean, off_grid boolean)` | student: `_teacher_id` ignored, teacher from `_ptm_student_scope`, names, ids and class NULL, `meet_uri` only on `is_mine`; staff: `_teacher_id` required, caller is that teacher, or `is_institution_admin`, or `can_manage_ptm`, or a coordinator over the teacher; `meet_uri` for all rows to the session teacher, admin and creator, NULL to others | slots from `_ptm_slots`; off-grid rows as today; `meet_ready = meet_uri IS NOT NULL` |
| `ptm_online_my_sessions(_ptm_id uuid DEFAULT NULL)` | rows `(ptm_id uuid, teacher_id uuid, teacher_name text, class_id uuid, booking_id uuid, slot_time time, meet_uri text, meet_ready boolean, booking_closes_at timestamptz, can_change boolean)` | students only; zero rows when not a participant | NULL = every online PTM the student is in with `scheduled_date >= local today - 7`, limit 50. **The frontend calls it with NULL once for the list.** |
| `swap_ptm_online_teacher(_ptm_id uuid, _from_teacher uuid, _to_teacher uuid)` | `jsonb {moved_students, moved_bookings, out_of_scope_students}` | admin | one transaction: UPDATE the session row (roster follows by `ON UPDATE CASCADE`, busy guard runs for `_to`), move active bookings and reset their `meet_*` (new rooms get the new co-host), notify `ptm_teacher_swapped` to the families, `ptm_online_assigned` / `ptm_online_unassigned` to the teachers. No UI yet. |
| `set_google_email(_email text, _user_id uuid DEFAULT NULL)` | `void` | `_user_id` NULL: self, not a student; else `is_institution_admin(me, that user's institution)` | NULL or blank clears; else `lower(btrim())` and the shape CHECK ("Enter a valid email address."). **The frontend sends `_user_id: null` for self.** |
| `ptm_teacher_busy_windows` | section 5.3 | | |

### 5.5 Meet rooms and crons (migration 5, `20261003100400_ptm_online_meet_and_crons.sql`, and edge function `ptm-meet-create`)

**Prerequisite, plainly:** the Meet REST API refuses to create spaces as a bare service account. The
service account must impersonate a **Google Workspace** user through domain-wide delegation (JWT
`sub`), authorised by the Workspace admin for the client id and scope. SALCI needs a Workspace
account (for example `meet@salci.in`) that owns every room. A personal Gmail cannot be impersonated.
Until this exists the booking flow still works; links never appear and the student view says "Link
not ready yet".

- Secrets: `GOOGLE_MEET_SERVICE_ACCOUNT_JSON` (loader as `send-push/index.ts:34-135`),
  `GOOGLE_MEET_IMPERSONATE_USER`, `GOOGLE_MEET_ACCESS_TYPE` (`OPEN` default, `TRUSTED` allowed, never
  `RESTRICTED`: many parents have no Google account), existing `WEBHOOK_SECRET`. Scope
  `https://www.googleapis.com/auth/meetings.space.created` (add `.space.settings` if `config` 403s).
- `POST https://meet.googleapis.com/v2/spaces` with `config`: `accessType`, `entryPointAccess: ALL`,
  `moderation: ON`, `moderationRestrictions` (present hosts only), `artifactConfig` with recording,
  transcription and smart notes `OFF`. Verify the field names against the live reference (several
  were promoted from v2beta during 2025) and fall back to v2beta on a 400. Store `name` ->
  `meet_space_id`, `meetingUri` -> `meet_uri`.
- Co-host: `POST v2beta/{space}/members {email: google_email, role: COHOST}`. **Uncertain**: v2beta,
  Developer Preview enrolment and Workspace-edition gated. On any error log it, `meet_cohost_set =
  false`, continue: under `OPEN` the teacher and the family join without a host (fine for a 1:1
  slot). Under `TRUSTED` without a working co-host a parent would knock with nobody to admit them,
  so `TRUSTED` only once co-host is proven end to end, including a parent with no Google account
  and the Android WebView.
- `ptm_meet_claim_due(_limit integer DEFAULT 20)` (service_role): online, scheduled, not cancelled,
  `teacher_id` set, `meet_uri IS NULL`, `meet_attempts < 5`, unclaimed or claimed over 10 minutes ago,
  slot start within `[now - 30 min, now + 60 min]` in the institution's timezone; `FOR UPDATE SKIP
  LOCKED`; sets `meet_claimed_at`, increments `meet_attempts`; returns booking, PTM title, slot
  start, teacher name and `google_email`, student name. `ptm_meet_record(_booking_id, _space_id,
  _meet_uri, _cohost_set)` (`WHERE meet_uri IS NULL`, a late duplicate is a no-op),
  `ptm_meet_fail(_booking_id, _error)`, `ptm_meet_create_kick()` (Vault-backed `net.http_post`, 8 s,
  returns early when nothing is due). Cron `ptm-meet-create-5min` `*/5 * * * *`. Budget: 20 per
  pass, 4 in flight, stop issuing after 8 s. Never for cancelled or unbooked slots; never a recording.
- `ptm_send_15m_reminders()` on cron `ptm-15m-reminders-5min`: student when
  `slot_start - 15 min <= now < slot_start`; teacher once per PTM at their first active slot.
- One space per teacher per PTM instead of per slot is a one-line change of the claim grain, but
  under `OPEN` a shared room has no lobby, so every family would be in one call: per slot it is.

### 5.6 Notifications

All through `_ptm_fanout`, link `/school/communication?tab=ptm` (the client appends `&ptm=<id>` from
`metadata.ptm_id`), message never carrying the Meet link.

| Type | When | To | Dedupe suffix |
|---|---|---|---|
| `ptm_scheduled` (existing) | create | online: teachers only, minus actor | none |
| `ptm_online_invited` | create (teacher hat), students added | the students | none; claim deleted on removal |
| `ptm_online_uninvited` | a teacher removed from the PTM | that teacher's participants | none |
| `ptm_online_assigned` / `ptm_online_unassigned` | teacher list change, swap | the teacher | none |
| `ptm_booking_confirmed` | `book_ptm_slot` | student | booking id |
| `ptm_slot_booked` (existing icon) | `book_ptm_slot` | teacher | booking id |
| `ptm_booking_cancelled` | staff cancel, participant removed | student | booking id |
| `ptm_slot_cancelled` | family cancel | teacher | booking id |
| `ptm_teacher_swapped` | swap | moved families | none; claims deleted first |
| `ptm_cancelled`, `ptm_rescheduled`, `ptm_reminder` (existing) | existing | online audience | existing |
| `ptm_reminder_15m` | cron | student per slot, teacher once | none |

### 5.7 Error strings (HINT in `error.hint`; all under 160 characters, no em dashes)

| HINT | SQLSTATE | Message |
|---|---|---|
| `ptm_teacher_busy` | P0001 | `{name} is already in "{title}" from HH:MI to HH:MI on DD Mon. Pick another time or teacher.` |
| `ptm_teacher_no_google` | P0001 | `{name} has no Google account email yet. Ask them to add it under Settings first.` / self: `Add your Google account email under Settings before scheduling an online PTM.` |
| `ptm_not_participant` | 42501 | `You are not on the list for this online meeting. Ask your teacher.` |
| `ptm_slot_taken` | 23505 | `That slot was just taken. Pick another.` |
| `ptm_already_booked` | 23505 | `You already have a slot. Cancel it first.` |
| `ptm_online_grid` | 22023 | `This is an online PTM. Open its sessions instead.` |
| `ptm_online_booking_off` | 22023 | `Slot booking is always on for an online PTM.` |
| `ptm_has_bookings` | 22023 | `{n} families have booked with {name}. Swap the teacher or cancel their slots first.` |
| `ptm_teacher_fixed` | 22023 | `A teacher's online PTM has only one teacher: you.` |
| `ptm_students_later` | 22023 | `Teachers pick their own students after the PTM is created.` |

`toastError` shows these verbatim (`isLikelyUserFriendly`); `isPtmTeacherBusyError` keys on the HINT.

### 5.8 Ship order and Tushar's checks

1. Migration 1 (additive). **Must land before any build whose online select names `mode`**; the
   frontend's three-level probe steps down to `full` until it does, so the order is safe either way.
2. Migration 2 (the branches; no behaviour change while no online row exists).
3. Migration 3 (the guard). 4. Migration 4 (the RPCs). 5. Deploy `ptm-meet-create`, set its
   secrets, then migration 5.
- DROP + recreate + regrant: `_ptm_fanout(uuid,text,text,text,uuid[])` (service_role), and the two
  feedback RPCs whose RETURNS TABLE gains `mode, my_teacher_name` (`ptm_resolve_feedback_token(text)`,
  `ptm_open_for_feedback()`, plus the internal `_ptm_feedback_context`). The grant list at
  `20260928180000_ptm_module.sql:1243-1254` is otherwise untouched.
- `scripts/test-ptm-online.sql`, same harness as `scripts/test-ptm.sql`, rolled back: grants; teacher
  creates with students (junction rows 0, participants 2, invited x2, a non-invited student sees no
  row, an invited one does); no-Google refusal; admin creates with teachers (`ptm_scheduled` to
  teachers only; `_student_ids` refused); busy refusal inside the buffer and success back to back
  after it; `ptm_teacher_busy_windows` scoping; taken student refused by name, `not_your_class`;
  two parents race one slot (second gets "just taken"; capacity is per teacher, not per class;
  "already have a slot"; `_replace` moves); booking carries `teacher_id` and `mode`, a direct
  teacher change is refused by the shape trigger; cutoff in `Pacific/Kiritimati`; removal cancels
  the booking and re-adding notifies again; swap; cancel frees a slot and the creating teacher can
  cancel with zero participants; `ptm_meet_claim_due` idempotent, drops out after 5 failures,
  never a cancelled booking; `scripts/test-ptm.sql` still 100/100; both delete probes clean.

## 6. Frontend verification (done 2026-10-03)

- Pure helpers: 36 node assertions (slot grid with and without a gap, slot bounds, the join window
  edges at 15:30 / 16:00 for a 15:40 slot, button copy, busy windows and overlap, the error shape,
  `canManagePTM` online, `canOpenPTM`, `canEditOwnSession`); the suite fails when the pitch drops
  the gap.
- Browser: the real `PTMPanel`, `PTMDetailView` and `GoogleAccountCard` with the real providers, the
  Supabase client aliased to a recording stub (100 ms latency), Playwright at 375x812, light and dark,
  timezone Asia/Kolkata, a faked clock for the Join states: **159 checks, 0 failures** (2026-10-05,
  after the class-first admin step, the "Online PTM" wording and the login-email Google rule; the
  class-first checks were shown to fail against a build with the class filter and the pruning
  removed). Chooser;
  Regular opens the unchanged form; teacher flow (taken greyed and named, tri-state class box, Next
  disabled at zero, 8 slots preview, gap 10 gives 6, the exact `create_online_ptm` payload); admin
  flow (no breadcrumb, no date on step 1, Next disabled until a class and a teacher, the class list
  sorted with All classes on top, only that class's teachers offered, no-Google disabled with the
  reason, no busy note before a date exists, the missing list, a teacher dropped when their class is
  unticked while a shared one stays, All classes offering everyone, the conflict row on step 2
  blocking Create, Remove clearing it, the server `ptm_teacher_busy` refusal returning to step 1,
  the second payload); detail (facts, "No students picked yet", My session, Teachers with You,
  the picker seeded and the booked-removal confirm, the `set_ptm_online_students` payload, the
  refused warning, the Teacher select, the class under the name, Join at 15:25 / 15:52 / 16:12 and
  "Link not ready yet", the popup URL); student (badge, teacher, hidden non-participant PTM, the
  booking sheet title and copy, the `book_ptm_slot` payload with no teacher, the booked card with
  the waiting Join); probe level `full` (regular form directly, no Online option, no badge); the Google
  card and sheet (bad address, lowercased payload, toast); admin detail (no My session card, Change
  teachers seeded with the current three, a Google-less teacher removable from the chip, the exact
  `set_ptm_online_teachers` payload, the saved toast and the named `has_bookings` refusal, Swap with
  the in-PTM teachers left out, the confirm naming the booked families, the `swap_ptm_online_teacher`
  payload, the moved toast and the out-of-scope warning); a student arriving from a notification
  sees that card ringed; zero console errors; scrollWidth 375.
- Gate: typecheck 0, eslint 0 errors, vite build 0, test:cache 14/14, stale-import pass clean for
  the change (the two hits in `SettingsPage.tsx` predate it).

## 7. Risks and open points

- Workspace, delegation and the co-host API edition are the schedule risk; the booking flow ships
  independently.
- `OPEN` access has no lobby; the lobby the pasted spec asked for needs `TRUSTED` plus a working
  co-host.
- Since 2026-10-05 the admin's step 1 has no date, so no per-day busy greying; the exact overlap is
  checked on step 2 and on the server.
- The admin's class choice only filters the teacher list. If Naman wants each teacher's student
  picker limited to those classes, that is a server change: a `ptm_online_classes` table (or the
  existing `ptm_schedule_classes` with the mode branches adjusted) written by `create_online_ptm`
  and read by `ptm_online_pick_options`. Not needed for the current ask.
- A participating teacher who never picks students shows as "No students picked yet"; a server
  reminder to them at T-1 day is optional.
- `ptm_schedules.created_by` is `ON DELETE CASCADE` (pre-existing): deleting a PTM's creator deletes
  it with every session and booking. Consider `DROP NOT NULL` + `SET NULL` separately.
- After a swap, participants may be outside the new teacher's classes (the invariant holds at pick
  time only); `out_of_scope_students` is returned for a warning.
- The Join button opens through `openExternal`; on Android the Custom Tab hands off to the Meet app.
  Verify on a device once a real room exists.
