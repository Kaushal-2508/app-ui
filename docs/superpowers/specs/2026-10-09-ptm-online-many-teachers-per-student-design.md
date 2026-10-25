# Online PTM: Separately only, and a student with several teachers

**Date:** 2026-10-09
**Status:** Frontend on `naman-erp` (`e9d4897d`), tolerant of either server (section 5.5).
**Server half ON PROD since 2026-10-09 (Tushar, `20261009110000`, main `1e5bd6b3`; status note
items 41 to 49).** Differences from section 5, all compatible with the frontend as pushed: a second
booking with the same teacher is refused as P0001 `ptm_already_booked` ("You already have a slot
with this teacher. Change it instead."; the sheet never sends one, it moves with `_replace`);
`ptm_online_pick_options` drops `taken_by_name` (the frontend reads it only on a `taken` row, which
no longer occurs); `ptm_online_my_sessions` is capped at 100 rows; `swap_ptm_online_teacher`'s
`merged_students` is always 0 because the new teacher may not already be in the PTM (unchanged
rule); the family's feedback context names every teacher they were with. The two Together PTMs on
prod were converted to Separately. Probed read-only from the public key: `book_ptm_slot` with
`_teacher_id` exists (42501 for anon, not PGRST202).

## 1. Why (Naman, 2026-10-09)

> "we want a major change in online ptm, so it would only work like separately so admin will select
> the teachers and note a same student can be selected by multiple teachers and then student will
> see different slots and then he will book the slots and then continues"

Two decisions, both final:

1. **Together is withdrawn.** There is one way an online PTM runs: every teacher has their own
   student list, their own slot grid and their own rooms (what the form called "Separately"). The
   format switch, the single teacher checklist and the shared grid of 2026-10-07 go. The admin still
   picks the classes and, per class, the teachers (the class sessions of
   [2026-10-06-ptm-online-class-sessions-design.md](2026-10-06-ptm-online-class-sessions-design.md)).
2. **A student may be on several teachers' lists in one PTM.** The maths teacher and the English
   teacher each pick the same child; the family sees one set of slots per teacher, books a slot
   with each, and joins each room in turn. "One teacher per student per PTM" (decision 4 of the
   2026-10-03 spec) is reversed.

## 2. The model

An online PTM is a date, a window, a slot length, a gap, and a set of **teacher sessions**. In an
admin-made PTM a teacher session belongs to a class session (its hours, its class); in a
teacher-made PTM there is exactly one. Each teacher session has its own **student list** and its
own **slot grid**. A student is on the list of every teacher who picked them. A family holds **one
active booking per teacher** they are with, each in that teacher's grid; the two bookings of one
family may not overlap in time. Rooms stay one per booking.

## 3. Permutations and the rule for each

| # | Case | Rule |
|---|---|---|
| 1 | A student with one teacher | Unchanged: the card says "Online with Meera Nair", one slot, one Join. |
| 2 | A student with two teachers | The card says "Online with Meera Nair and Ravi Kumar" and lists one row per teacher: "With Meera Nair: 3:40 PM" or "With Ravi Kumar: no slot yet", each booked row with its own Join. "Book a slot" opens the booking sheet on the first teacher without a slot; a row of pills switches teacher, each pill showing the booked time. After a booking the sheet moves on to the next teacher without a slot, and closes when every teacher has one. |
| 3 | Two of a family's slots at the same time | Refused by the server (P0001 `ptm_family_double_booked`: "You have a slot with Meera Nair at 3:40 PM. Pick another time."). The sheet greys those tiles beforehand ("Past" style, labelled "your slot with Meera Nair"). |
| 4 | A teacher picks a student already with another teacher | Allowed. The picker shows "Also with Ravi Kumar" under the name as information; the row stays tickable. On today's server the row is greyed "With Ravi Kumar" and the server refuses it by name, as before (section 5.5). |
| 5 | A teacher unticks a student who is also with another teacher | Only this teacher's row goes, and only the booking with this teacher is cancelled. The other teacher's place and booking stay. |
| 6 | Moving or cancelling a slot | Per teacher: "Change your slot" and "Cancel my slot" act on the booking with the teacher shown in the sheet. `can_change` is per booking (until that slot starts). |
| 7 | Swap a teacher (admin) | The leaving teacher's rows move to the new teacher. A student the new teacher already has keeps that place; their booking with the leaving teacher moves too unless the family already holds one with the new teacher, in which case it is cancelled, counted, and the family told. |
| 8 | Change classes (admin) | Unchanged: a teacher with bookings is kept and named; a removed teacher's students lose only that teacher's place. |
| 9 | Teacher's Overview and Bookings | Unchanged: own rows, own grid. A shared student counts in each teacher's `student_count`. |
| 10 | Reminders and rooms | Per booking, unchanged: a family with two slots gets two 15-minute reminders and two rooms. |
| 11 | Feedback | One family feedback per PTM, unchanged. |
| 12 | Notifications | `ptm_online_invited` once per (teacher, student): "Meera Nair has invited you to Hostel PTM. Book a slot." `ptm_booking_confirmed` names the teacher. |

## 4. What each role sees (frontend, built)

- **Admin or coordinator, create:** Step 1 Date and time, Step 2 Classes and teachers, one box per
  class with its hours and that class's teachers, a teacher greyed where their hours overlap another
  box or another PTM. No format choice. "Change classes" on an existing PTM edits the same boxes.
- **Teacher:** Edit holds the student picker (one list per class session they are in). A student on
  another teacher's list shows "Also with <name>" and stays tickable; on today's server the row is
  greyed with "With <name>" instead.
- **Family (student account):** the card names every teacher the child is with and shows one slot
  row per teacher, each with its Join. The booking sheet has a teacher row of pills when there are
  two or more, books one teacher at a time, and sends the teacher only when there are two or more
  (section 5.5).

## 5. Server contract (`NEEDS DB`, Tushar)

### 5.1 Schema

```sql
-- One row per (PTM, teacher, student); the same student may appear under several teachers.
ALTER TABLE public.ptm_online_participants
  DROP CONSTRAINT <the UNIQUE (ptm_id, student_id)>,
  ALTER COLUMN teacher_id SET NOT NULL,                       -- it was NULL only for Together
  ADD CONSTRAINT ptm_online_participants_ptm_teacher_student_key UNIQUE (ptm_id, teacher_id, student_id);
CREATE INDEX IF NOT EXISTS ptm_online_participants_ptm_student_idx ON public.ptm_online_participants(ptm_id, student_id);

-- One active booking per (PTM, student, teacher) instead of per (PTM, student).
DROP INDEX public.<_one_per_student>;
CREATE UNIQUE INDEX ptm_bookings_one_per_student_teacher
  ON public.ptm_bookings(ptm_id, student_id, teacher_id) WHERE status = 'active' AND teacher_id IS NOT NULL;
-- The in-person rule (one per (ptm_id, student_id) WHERE teacher_id IS NULL) stays.

-- Together retired: convert any 'panel' PTM to 'separate' (test data only), then narrow the CHECK.
UPDATE public.ptm_schedules SET online_format = 'separate' WHERE online_format = 'panel';
ALTER TABLE public.ptm_schedules DROP CONSTRAINT <online_format check>,
  ADD CONSTRAINT ptm_schedules_online_format_check CHECK (online_format = 'separate');
```

The Together-only behaviour of items 36 to 40 of the server status note (PTM-wide grid, one booking
per `(ptm_id, slot_time)`, any teacher cancels any booking, `teacher_name` listing the PTM's
teachers) is retired with it.

### 5.2 RPCs

- `book_ptm_slot(_ptm_id, _slot_time, _replace, _teacher_id uuid DEFAULT NULL)`. Online: the
  teacher must be one the student is with on this PTM (else 42501, HINT `ptm_not_participant`);
  NULL means the student's only teacher there, and raises P0001 HINT `ptm_teacher_ambiguous`
  ("Say which teacher you are booking with.") when there are several. `_replace` moves only the
  booking with that teacher. Refuses a slot that overlaps, gap included, another active booking of
  the same student on this PTM (P0001 HINT `ptm_family_double_booked`, message names the other
  teacher and time). Capacity stays one family per (teacher, slot).
- `ptm_online_booking_grid(_ptm_id, _teacher_id DEFAULT NULL, _class_session_id DEFAULT NULL)` for
  a student: `_teacher_id` as above (NULL = the only teacher, `ptm_teacher_ambiguous` otherwise);
  `is_mine` marks the student's booking with THAT teacher; `meet_uri` on that row only.
- `cancel_ptm_booking(_booking_id)`: unchanged (by booking id, so per teacher already).
- `set_ptm_online_students(_ptm_id, _student_ids, _teacher_id, _class_session_id)`: insert
  `ON CONFLICT (ptm_id, teacher_id, student_id) DO NOTHING`; the `taken` refusal disappears
  (`not_your_class`, `not_a_student`, `no_single_class` stay); removing a student cancels only the
  booking with this teacher; `ptm_online_invited` goes once per (teacher, student).
- `swap_ptm_online_teacher`: moves the leaving teacher's participant rows and bookings to the new
  teacher; where the new teacher already has the student, the duplicate participant row is dropped
  and a duplicate booking is cancelled (new result field `merged_students int`; `moved_bookings`
  counts only what moved). The family is told of a cancelled slot as today.
- `set_ptm_online_class_sessions`, `set_ptm_online_teachers`, `create_online_ptm`: unchanged in
  shape. `create_online_ptm` ignores `_online_format` (always `separate`); the frontend no longer
  sends it.

### 5.3 Reads

- `ptm_online_my_sessions()`: one row per (PTM, teacher) the student is with, ordered by PTM then
  teacher name; `teacher_name` is that teacher's name; `booking_id`, `slot_time`, `meet_uri`,
  `meet_ready`, `slot_starts_at`, `slot_ends_at`, `can_change` are the booking with that teacher.
- `ptm_my_bookings()`: one row per active booking (already carries `teacher_id` and `meet_uri`).
- `ptm_online_pick_options(_ptm_id, _teacher_id, _class_session_id)`: `state` in `free | mine`
  only; new column `with_teachers text[]`, the names of the PTM's OTHER teachers who have this
  student (empty array otherwise). `taken` and `taken_by_name` are retired (the frontend still
  reads them so an older server keeps greying).
- `ptm_online_sessions(_ptm_id)`: unchanged; a shared student counts in each teacher's
  `student_count`. The `format` column may be dropped from the row or left as `'separate'`; the
  frontend no longer reads it.
- `ptm_feedback_summary.total_slots`: the Separately sum, unchanged.

### 5.4 Notifications

`ptm_online_invited` per (teacher, student); `ptm_booking_confirmed` and `ptm_reminder_15m` per
booking, naming the teacher; `ptm_slot_booked` to that teacher. Unchanged otherwise.

### 5.5 How the frontend tells the two servers apart (no probe)

Nothing new is probed. The frontend reads the row shapes:

- `ptm_online_pick_options`: a row with `state = 'taken'` is greyed and named (today's server); a
  row with `with_teachers` non-empty is tickable and says "Also with ..." (this contract).
- `ptm_online_my_sessions`: several rows for one PTM means several teachers. `_teacher_id` is sent
  on `book_ptm_slot` and on the student's grid call ONLY when the family has two or more teachers on
  that PTM. Today's server never returns two, so it never receives the parameter it does not know.
- `ptm_my_bookings`: read as a list per PTM; today's server returns at most one row per PTM.

## 6. Frontend map (built on `naman-erp`)

| Piece | What changed |
|---|---|
| `src/lib/ptmClassSessions.ts` | `OnlineFormat` and the `format` option are gone; a teacher in two boxes at overlapping hours is always a clash |
| `src/components/ptm/ClassSessionBox.tsx` | the Together teacher list and `teachersFromList` are gone; every box has hours and its own teacher picker |
| `src/components/ptm/ClassSessionsSheet.tsx` | no format; the confirm counts each removed teacher's students |
| `src/components/ptm/ResidentialPTMSheet.tsx` | no "How teachers meet families" radio, no `_online_format`; the Students copy says a student may be with other teachers too |
| `src/components/ptm/ResidentialStudentPicker.tsx` | `with_teachers` → "Also with ..." note, row tickable; `taken` still greyed for the older server |
| `src/hooks/ptm/usePTMOnline.ts` | `with_teachers?` on the pick row; `format` and `onlineFormat` removed; student refusals named per reason |
| `src/hooks/ptm/usePTMBookings.ts` | `useBookPTMSlot` takes `teacherId?` (sent as `_teacher_id` when given) and `teacherName?` for the toast |
| `src/components/ptm/PTMPanel.tsx` | sessions and bookings grouped per PTM as lists |
| `src/components/ptm/PTMCard.tsx` | `mySessions` / `myBookings`; one slot row and Join per teacher; "Online with A and B" |
| `src/components/ptm/BookSlotSheet.tsx` | `mySessions`; teacher pills when 2+; grid per teacher; greys tiles that clash with the family's other slot; moves on to the next teacher after a booking |
| `src/components/ptm/OnlineDetailTabs.tsx` | every Together branch removed: per-teacher counts, Swap on every row, teachers see their own grid |

## 7. Verification

- Node asserts over `ptmClassSessions.ts`: the permutation rows of the 2026-10-06 spec minus the
  Together case (6b removed; a teacher in two boxes at overlapping hours is a clash in every PTM).
- Browser harness (`ptm-preview`): the admin create flow has no format radio and sends no
  `_online_format`; the teacher's picker greys `taken` rows on the old stub and offers "Also with"
  rows on the new one (`shared=1`); the family with two teachers (`multi=1`) sees both names, books
  with each in turn (`_teacher_id` sent each time, the clashing tile greyed), and gets two Join
  buttons; the family with one teacher sends no `_teacher_id` (unchanged payload). 375px, light and
  dark.
- Gate: typecheck, eslint, `vite build`, `test:cache`, stale-import pass.

## 8. Out of scope (named so they are not assumed)

- Together, in any form. If it ever returns it is a new design, not a flag.
- Feedback per teacher (one family feedback per PTM stays).
- A per-teacher booking cutoff (the PTM's applies to every teacher).
