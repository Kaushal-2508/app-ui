# Online PTM, admin flow: class sessions (a box per class, own hours, own teachers)

**Date:** 2026-10-06
**Status:** Frontend built on `naman-erp` behind the PTM schema probe (new level `sessions`); every
table, column and RPC below is `NEEDS DB` (Tushar). Until the probe sees `ptm_online_class_sessions`
the form still shows the boxes but sends today's flat payload (section 6), so nothing breaks on the
live server and nothing is lost silently.
> **Server half ON PROD since 2026-10-06 ~16:33 (Tushar; probed from the frontend's public key, the
> migration file is not on `main` yet):** `ptm_online_class_sessions` (id, ptm_id, class_id,
> start_time, end_time, created_at), `ptm_schedules.online_format`, `ptm_bookings.class_session_id`,
> `set_ptm_online_class_sessions(_ptm_id, _class_sessions)` and `create_online_ptm(...,
> _online_format, _class_sessions)` all exist. One difference from section 5.1: the teachers of a
> session live in a link table `ptm_online_session_teachers`, not in a `class_session_id` column on
> `ptm_online_teachers`; the frontend never reads either table directly (everything goes through
> the RPCs), so nothing changes here. The probe now treats a permission error on the table as
> "present" (only "does not exist" keeps the flat shapes). The row shapes of `ptm_online_sessions`
> and `ptm_online_my_sessions` (section 5.3) can only be confirmed from a signed-in session or from
> the migration once it is pushed.

> **Together corrected 2026-10-07 (Naman, testing on localhost: "admin can choose any number of
> teachers and all the teachers are able to see the same slots and meeting links").** The
> per-class model below is for **Separately**. **Together is ONE grid for the whole PTM:** families
> from every chosen class book one shared set of slots, one family at a time, and every ticked
> teacher joins every family's room. So, for `online_format = 'panel'`: a teacher in two chosen
> classes is never a clash and the form no longer refuses it; class sessions have no hours of their
> own (always NULL = the meeting's); the form still sends one `_class_sessions` entry per class
> (scope for booking and for the teachers' student lists) with `teacher_ids` = the ticked teachers
> who teach that class. **NEEDS DB (Tushar), panel only:** (a) capacity is one family per
> `(ptm_id, slot_time)` across ALL class sessions, not per session; (b) `ptm_online_booking_grid`
> for a panel returns the PTM-wide grid (every booking of every session) with `meet_uri` to every
> teacher of the PTM, and `ptm_online_my_sessions` / the reminders treat every ticked teacher as
> attending every booked slot; (c) the "teacher must teach that class" check does not apply to a
> panel's rooms (a teacher listed on any session of the PTM joins all of them); (d) per-session
> hours are ignored for a panel. The 1-hour Meet cap still means one room per booking.

> **Tushar's merge review, 2026-10-07, frontend fixes (all on `naman-erp`):** Change teachers and
> Change classes seed only once the sessions have loaded and ask before any save that removes a
> teacher or class, naming them and the students who lose their place; Join polls once a minute
> while a booked slot's room is due (status note item 19) so it goes live without a reload; a
> family's Change / Cancel follow the server's `can_change` (gone once their slot starts); the
> Google-account copy no longer claims SALCI makes the teacher host (item 18: rooms are OPEN, no
> co-host); the Swap copy says rooms are kept (item 21) and Swap is not offered on a Together row
> (nothing of a teacher's own to move); a teacher's Together / per-class student save is applied as
> their adds and removes on top of the fresh server list, so two teachers of one class cannot
> overwrite each other; a failed teacher list shows N/A tiles and the error card; a failed family
> session list shows "Couldn't load your slot" with Retry instead of "booking closed"; a teacher's
> Bookings tab offers only their own grid. Outside the PTM: the phone field keeps typed prefixes
> until they resolve and refuses landlines (6 to 9 rule); P0001 messages written as plain
> capitalised sentences show verbatim (identifier guards unchanged).

**Builds on:** [2026-10-03-ptm-online-residential-design.md](2026-10-03-ptm-online-residential-design.md)
(the online mode, its status block, and the per-teacher hours of 2026-10-06). The "Panel format"
paragraph of that status block is superseded by this document: the format switch survives, but it
lives inside the class sessions below.

> **Together withdrawn 2026-10-09 (Naman: "it would only work like separately").** The format
> switch, the single teacher checklist and the shared grid are gone from the frontend; every online
> PTM runs teacher by teacher, so the clash rule (cases 4 to 6) applies to every PTM. A student may
> now be on several teachers' lists, and a family books one slot per teacher. Contract and NEEDS DB
> (participants unique per teacher, bookings per teacher, `book_ptm_slot(..., _teacher_id)`,
> `with_teachers` on the pick options, `online_format` narrowed to `separate`):
> [2026-10-09-ptm-online-many-teachers-per-student-design.md](2026-10-09-ptm-online-many-teachers-per-student-design.md).
> Every Together sentence below is history.

## 1. Why (Naman, 2026-10-06)

> "Suppose an admin selects classes from 1st to 10th and then chooses teachers. When a single class
> is chosen a new box appears with the teachers of that class; after selecting another class another
> teacher box appears. If a teacher is already selected they cannot be reselected: greyed, 'teacher is
> already busy'. Make a clean plan after applying all permutations."

Picker decision: **a session per class with its own hours**, not a visual grouping. Class 5-A 12:00
to 1:00 with teachers X and Y; Class 6-B 1:00 to 2:00 with Y and Z. A teacher may sit in two classes
only when those hours do not overlap (gap included).

Earlier the same day Naman described the original workflow ("admin is selecting teachers for the same
meeting ... a single Meet link for all the selected teachers and a single student; for the 2nd
student another link") and chose, by picker, that the admin decides per PTM: **Together** (a panel:
one student list per class, one grid, every teacher of the class in each family's room) or
**Separately** (each teacher their own students and grid, today's model).

## 2. The model

An admin- or coordinator-made online PTM has a date, a window, a slot length, a gap (as today), a
**format** (`separate` | `panel`, chosen once per PTM) and a list of **class sessions**. Each class
session is:

| Field | Meaning |
|---|---|
| class | one class of the maker's scope (`ptm_manageable_scope`) |
| hours | inside the PTM window; NULL = the whole window; at least one slot long |
| teachers | one or more teachers of that class (`notice_class_staff`), each held for the session's hours plus the gap |
| students | never picked by the admin (Naman, later the same day: "to select students, give this option in hand of teachers"). Separately: each teacher picks their own, within the class. Together: any teacher of the session picks the class's shared list. Both from the PTM's Edit. |

Slots come from the session's hours. A family books inside its own class session (its child's
class). Rooms stay **one per booking** (Google Meet caps a call at an hour). A teacher-made PTM is
unchanged: one teacher, students from all their classes, one grid, no class sessions.

## 3. Permutations and the rule for each

| # | Case | Rule |
|---|---|---|
| 1 | One class, one teacher | One box. Separately and Together behave the same. |
| 2 | One class, several teachers | Together: all in each room, one grid; the admin ticks them in ONE list of the chosen classes' teachers. Separately: parallel grids; families pick a teacher. |
| 2b | Together, several classes sharing a teacher | Never a clash: one grid for the whole PTM, every ticked teacher in every room. (Separately applies cases 4 to 6.) |
| 3 | Several classes, disjoint teachers, same hours | Parallel sessions. Nothing greyed. |
| 4 | A teacher teaches two chosen classes, hours overlap (gap included) | In the second box the teacher is greyed with "In Class 5 - A, 12:00 PM to 1:00 PM". Listed, not hidden. |
| 5 | Same teacher, hours do not overlap | Selectable in both; each row shows "Also in Class 5 - A, 12:00 PM to 1:00 PM" as information. |
| 6 | Hours edited later so two of a teacher's sessions overlap | Both boxes show an inline error naming the teacher and the other class; Create disabled until fixed. Nothing is auto-removed. |
| 7 | Teacher busy in ANOTHER PTM that day | Greyed only when that window overlaps THIS box's hours plus gap: "Busy 3:00 PM to 5:05 PM with 'Hostel PTM 6B'". Narrowing the box's hours can free them. The server refuses regardless (P0001 `ptm_teacher_busy`). A ticked teacher who becomes busy after an hours change is an inline error (as 6). |
| 8 | Class unticked | Its box, teachers and students go; those teachers become selectable again elsewhere. |
| 9 | PTM window changed | Boxes on the meeting's hours follow it; a box with own hours now outside says "Must be within the meeting" and blocks Create (`teacherWindowError`, reused). |
| 10 | Slot length or gap changed | Every box's slot count recomputes; a box shorter than one slot errors. |
| 11 | Class with no teacher assigned | Box says "No teacher is assigned to this class yet"; Create blocked while it is there. |
| 12 | Students at creation | Never required, in either format: the teachers pick them afterwards from Edit (a teacher in several class sessions gets one list per session). |
| 13 | Teacher without a Google account | Selectable, marked "Google account not set"; Meet uses their login email (unchanged). |
| 14 | Coordinator | Classes limited to their wing (manageable scope); the same boxes. |
| 15 | Teacher-made PTM | Unchanged. |
| 16 | Edit after creation (admin) | The same boxes in a "Classes and teachers" sheet (one RPC, `set_ptm_online_class_sessions`); a change that would strand a booked family is refused and named. Swap stays for handing one teacher's session over. |
| 17 | Family | Card: "Online with Class 5 - A teachers" (Together) or "with Meera Nair" (Separately), from `teacher_name`; the booking sheet shows the session's hours; Join on hold until their slot (unchanged). |

## 4. What the admin sees (frontend, built)

The busy check needs the date and the hours, so the time comes first.

1. **Step 1 of 2: Date and time.** Title, "Add a description" (folded), date, starts, ends, slot
   length, gap, feedback window. Next needs a title and a valid window.
2. **Step 2 of 2: Classes and teachers.** "How teachers meet families": Separately (default) or
   Together. A Class multi-select. Under it **one box per chosen class**: the class name; a hours row
   ("Meeting hours, 3:00 PM to 5:40 PM · 8 slots" with "Own hours" opening From / To, the same row as
   the per-teacher hours had); and the teachers. **Separately:** a Teachers multi-select per box,
   limited to that class, where a teacher who is in another box at an overlapping time, or busy in
   another PTM then, is greyed with the reason as the row's description, and a teacher free for both
   shows "Also in ..." as a note. **Together:** ONE checklist above the boxes with every teacher of
   the chosen classes and the classes each teaches among them; a ticked teacher joins every chosen
   class they teach, and the box just names who from the list teaches it. Nobody picks students
   here. Errors sit under the box they belong to. "Schedule online PTM" is on this step and stays
   disabled while any box has an error.

Compact on purpose (Naman: "too much empty space"): no who-strip, no breadcrumb, boxes are the
summary; the format choice is two short cards side by side.

## 5. Server contract (`NEEDS DB`, Tushar)

Names follow the existing `ptm_online_*` family. Nothing here changes a teacher-made PTM.

### 5.1 Schema

```sql
CREATE TABLE public.ptm_online_class_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ptm_id      uuid NOT NULL REFERENCES public.ptm_schedules(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  start_time  time NULL,   -- NULL = the PTM window
  end_time    time NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ptm_id, class_id),
  CHECK ((start_time IS NULL) = (end_time IS NULL)),
  CHECK (start_time IS NULL OR end_time > start_time)
);
CREATE INDEX ptm_online_class_sessions_ptm_id_idx   ON public.ptm_online_class_sessions(ptm_id);
CREATE INDEX ptm_online_class_sessions_class_id_idx ON public.ptm_online_class_sessions(class_id);
-- Trigger (like ptm_hours_outside): hours inside the PTM window and >= 1 slot.

ALTER TABLE public.ptm_schedules
  ADD COLUMN online_format text NOT NULL DEFAULT 'separate'
  CHECK (online_format IN ('separate', 'panel'));          -- 'panel' only with mode = 'online'

ALTER TABLE public.ptm_online_teachers
  ADD COLUMN class_session_id uuid NULL REFERENCES public.ptm_online_class_sessions(id) ON DELETE CASCADE;
CREATE INDEX ptm_online_teachers_class_session_id_idx ON public.ptm_online_teachers(class_session_id);
-- UNIQUE (class_session_id, teacher_id) WHERE class_session_id IS NOT NULL.
-- The per-teacher start_time / end_time of 20261006140000 stay for compatibility; for a PTM with
-- class sessions the SESSION carries the hours and the teacher columns are NULL.

ALTER TABLE public.ptm_online_participants ADD COLUMN class_session_id uuid NULL
  REFERENCES public.ptm_online_class_sessions(id) ON DELETE CASCADE;   -- teacher_id NULL in a Together session
CREATE INDEX ptm_online_participants_class_session_id_idx ON public.ptm_online_participants(class_session_id);

ALTER TABLE public.ptm_bookings ADD COLUMN class_session_id uuid NULL
  REFERENCES public.ptm_online_class_sessions(id) ON DELETE CASCADE;
CREATE INDEX ptm_bookings_class_session_id_idx ON public.ptm_bookings(class_session_id);
-- Capacity: Separately one family per (teacher_id, slot_time) (exists); Together one family per
-- (class_session_id, slot_time) WHERE teacher_id IS NULL (new partial unique index).
```

RLS: the new table is readable by staff of the institution and by a student for the sessions of
their own class, through SECURITY DEFINER helpers only (CLAUDE.md section 23).

### 5.2 RPCs

- `create_online_ptm(..., _online_format text DEFAULT 'separate', _class_sessions jsonb DEFAULT NULL)`
  with `_class_sessions = [{class_id, start_time, end_time, teacher_ids uuid[], student_ids uuid[]}]`
  (`start_time` / `end_time` NULL = the window; the frontend always sends `student_ids: []`, the
  teachers pick afterwards through `set_ptm_online_students(..., _class_session_id)`). When given,
  `_teacher_ids`, `_teacher_windows` and `_student_ids` are ignored for the admin flow. Validation,
  each a P0001 with a HINT: every class in the hat's scope (`ptm_scope_denied`); every teacher
  teaches that class (`ptm_teacher_not_in_class`); hours inside the window and at least one slot
  (`ptm_hours_outside` / `ptm_hours_invalid`); a teacher's sessions in this PTM must not overlap, gap
  included (`ptm_teacher_double_booked`, message names the teacher and both classes); the busy guard
  per teacher per session hours (existing `_ptm_assert_teachers_free`, fed the session windows,
  `ptm_teacher_busy`). Writes the session rows, the teacher rows with `class_session_id`, the
  participants (Together), and sends `ptm_online_assigned` per teacher and `ptm_online_invited` per
  Together student.
- `set_ptm_online_class_sessions(_ptm_id uuid, _class_sessions jsonb)` → `{added int, removed int,
  kept int, hours_changed int, refused jsonb}`; `refused = [{class_id, class_name, teacher_id,
  full_name, reason}]`. Diffs per class in one transaction with the same validation. Refuses, by
  name, removing a class or a teacher with active bookings (`has_bookings`) and hours that would
  strand a booking (`hours_has_bookings`). Admin or the creating coordinator; `anon` revoked by name.
- `set_ptm_online_students(_ptm_id, _student_ids, _teacher_id DEFAULT NULL, _class_session_id DEFAULT NULL)`:
  Together → the session's list (admin, creator, any teacher of the session); Separately → that
  teacher's list, within the session's class.
- Slots per session: `_ptm_slots(_ptm_id, _class_session_id)`. `ptm_online_booking_grid(_ptm_id,
  _class_session_id DEFAULT NULL, _teacher_id DEFAULT NULL)`: Separately needs the teacher, Together
  ignores it; `meet_uri` to every teacher of the session, the admin and the creator. `book_ptm_slot`
  derives the session from the student's class (`_ptm_student_scope`) and refuses a slot outside the
  session's hours ("That time is not one of this class's slots.").
- Busy windows of a PTM with class sessions = each session's hours plus gap, per teacher
  (`ptm_teacher_busy_windows` unchanged in shape).

### 5.3 Reads

- `ptm_online_sessions(_ptm_id)` → one row per (session, teacher), adding `class_session_id,
  class_id, class_name, class_section, start_time, end_time` (the session's effective hours) and
  `format`; `student_count` / `booked_count` / `attended_count` are the session's in a Together
  row and the teacher's in a Separately row. A PTM without class sessions keeps today's rows
  (`class_session_id` NULL).
- `ptm_online_my_sessions` adds `class_session_id, session_start_time, session_end_time, format`;
  `teacher_name` is "Class 5 - A teachers" for Together (the frontend prints it as is).
- `ptm_online_pick_options(_ptm_id, _teacher_id DEFAULT NULL, _class_session_id DEFAULT NULL)`.
- `ptm_feedback_summary.total_slots` = sum over sessions × teachers (Separately) or sessions (Together).

### 5.4 Rooms, reminders, feedback

Unchanged: one room per booking (`ptm-meet-create`), the 15-minute reminder to each teacher of the
session before its first booked slot, the family's reminder per slot, the in-app feedback form.

### 5.5 Probe

The frontend adds level `sessions` when `select id from ptm_online_class_sessions limit 0`
succeeds (42P01 → stays `online`). It then sends `_online_format` + `_class_sessions`, reads the
new fields, and shows the per-class Overview and the class-sessions editor. Below that level it
sends the flat payload of section 6.

## 6. Frontend map (built on `naman-erp`)

| Piece | What |
|---|---|
| `src/lib/ptmClassSessions.ts` | pure: `ClassSessionDraft`, `sessionHours`, `sessionSlotCount`, `sessionsClash`, `teacherAvailability` (cases 4, 5, 7), `classSessionErrors` (6, 9 to 12), `classSessionsPayload`, `flattenForLegacyServer` |
| `src/components/ptm/ClassSessionBox.tsx` | one box: class header, hours row (`HoursRow`), teacher picker with `disabledReason` / `noteFor` (Separately) or the names from the list (Together), errors; `ClassSessionsEditor` with the Together single teacher list |
| `src/components/ptm/HoursRow.tsx` | the "Meeting hours / Own hours" row, extracted from `TeacherWindowsFields` (which keeps using it) |
| `src/components/ptm/ParticipatingTeacherPicker.tsx` | new props `disabledReason(teacherId)` and `noteFor(teacherId)` |
| `src/components/ptm/ResidentialPTMSheet.tsx` | admin flow: Step 1 Date and time, Step 2 Classes and teachers; teacher flow unchanged; Edit (teacher): the student picker lives here, one list per class session I am in (`usePTMOnlinePickOptionsBySession`, saved per session with `_class_session_id`) |
| `src/components/ptm/ClassSessionsSheet.tsx` | Edit after creation at level `sessions` (one RPC) |
| `src/hooks/ptm/usePTMOnline.ts` | `classSessions` / `onlineFormat` on the create input, `useSetPTMOnlineClassSessions`, the new optional read fields |
| `src/hooks/ptm/usePTMSchedules.ts` | probe level `sessions` |
| `OnlineDetailTabs.tsx` | Overview: compact facts, per-class cards at level `sessions`, no "Edit my students" button (Edit does it); Bookings: Class select when there are 2+ class sessions |

**Flat payload before the server lands (level `online`).** `flattenForLegacyServer`: the union of
teachers goes as `_teacher_ids`; a teacher whose session hours differ from the meeting's gets them as
`_teacher_windows`; a teacher in two non-overlapping boxes gets the envelope (earliest start to
latest end) and the form shows the note "Until the server update, X runs one session 12:00 PM to
2:00 PM" before Create. **Together is disabled below level `sessions`** ("after the next server
update"), so no student list is ever dropped silently.

## 7. Verification

- Node asserts over the pure helper: one per row of the permutation table (1 to 12), the flat
  payload envelopes, the clash and busy detection; each shown to fail with the rule removed.
- Browser harness (`ptm-preview`, stub with `notice_class_staff` / `notice_class_students` per
  class, busy windows for Ravi Kumar on 2026-10-12, probe flag `level=sessions`), 375px light + dark.
- Gate: typecheck, eslint, `vite build`, `test:cache`, stale-import pass.

## 8. Out of scope (named so they are not assumed)

- Per-teacher hours inside one session (hours are per class session now).
- A different format per session (format is per PTM).
- Rooms per session instead of per booking (Meet's one-hour cap decided that).
