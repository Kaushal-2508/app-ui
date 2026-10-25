# Online (residential) PTM: server status (2026-10-05)

The database half of the `NEEDS DB` in naman-erp `61a0087a` is live on prod. Your contract is in
`docs/superpowers/specs/2026-10-03-ptm-online-residential-design.md`; this file lists only what
exists and where it differs from that contract.

## Live

| Migration | Contents |
|---|---|
| `20261005160000_ptm_online_schema` | `ptm_schedules.mode`, `slot_buffer_minutes`; `ptm_online_teachers`; `ptm_online_participants`; `ptm_bookings.mode`; `ptm_booking_meet`; `user_google_accounts` |
| `20261005160100_ptm_online_mode_branches` | the mode branches of section 5.2 |
| `20261005160200_ptm_online_teacher_guard` | the busy guard, `ptm_teacher_busy_windows` |
| `20261005160300_ptm_online_rpcs` | `create_online_ptm`, `set_ptm_online_students`, `set_ptm_online_teachers`, `swap_ptm_online_teacher`, `ptm_online_pick_options`, `ptm_online_teacher_options`, `ptm_online_sessions`, `ptm_online_booking_grid`, `ptm_online_my_sessions`, `set_google_email`, `get_google_email` |

All four were applied in one transaction. Tests: `scripts/test-ptm-online.sql`.

Meet rooms: since 2026-10-06, items 18 to 24 below.

## Differences from your contract

1. **No `meet_*` columns on `ptm_bookings`.** Room data is in `ptm_booking_meet`, which the browser
   cannot read. The RPCs return `meet_uri` / `meet_ready` with the shapes of section 5.4.
2. **No `google_email` on `profiles`.** It is in `user_google_accounts`, which the browser cannot
   read. Read: `get_google_email(_user_id uuid DEFAULT NULL)` (self, or a school admin for someone
   in their school). Write: `set_google_email` as specified.
3. `ptm_online_pick_options` returns one jsonb array (same fields), not a set of rows.
4. `ptm_online_booking_grid` and `ptm_online_my_sessions` also return `slot_starts_at` and
   `slot_ends_at` (timestamptz).
5. `ptm_my_bookings` returns `teacher_id` and `meet_uri`.
6. The section 5.7 errors are raised as P0001 with the HINTs listed there.
7. `set_ptm_online_teachers` may also refuse with `reason: "busy"`.
8. Online attendance and booking cancel belong to the session teacher (plus the creator and admins;
   attendance also the class's coordinator).
9. `ptmb_select` is now the booking's own student, or staff who may see that class.

## Since 2026-10-06 (`20261006120000`, your NEEDS DB in `0f4b8f15` and `8e7f4d10`)

10. `get_google_email` returns the account that was set, else the login email (`profiles.email`,
    lower-cased). `create_online_ptm`, `set_ptm_online_teachers` and `swap_ptm_online_teacher` no
    longer refuse for a missing Google account (`ptm_teacher_no_google` and the `no_google_email`
    reason are gone). `has_google_email` still means "set explicitly".
11. Online booking is per slot: `book_ptm_slot` refuses only a slot that has started (P0001, HINT
    `ptm_slot_started`), even once the meeting is under way; `booking_cutoff_minutes` does not apply
    online. `_replace` refuses when the family's current slot has started (same HINT). A family may
    cancel until its own slot starts. `ptm_online_my_sessions.booking_closes_at` is the booked slot's
    start (the meeting's end while unbooked), and `can_change` follows it.
12. Your (d) and NEEDS EDGE FN: items 18 to 24.

## Since 2026-10-06 (`20261006140000`, your NEEDS DB in `a23ff4fc`)

13. `ptm_online_teachers.start_time` / `end_time` (time; both NULL = the meeting's window). A
    teacher's slots start at their own start and step by duration plus gap. Hours equal to the
    meeting's are stored as NULL.
14. `create_online_ptm(..., _teacher_windows jsonb DEFAULT NULL)` and
    `set_ptm_online_teachers(_ptm_id, _teacher_ids, _teacher_windows jsonb DEFAULT NULL)` take
    `[{teacher_id, start_time, end_time}]`. In `set_ptm_online_teachers` an entry with both times
    null puts a kept teacher back on the meeting's hours, and a kept teacher with no entry keeps
    theirs. Its result adds `hours_changed`; a kept teacher whose new hours are refused is listed in
    `refused` with reason `hours_has_bookings` or `busy`, and keeps their hours.
15. `set_ptm_online_teacher_hours(_ptm_id uuid, _teacher_id uuid, _start_time time DEFAULT NULL,
    _end_time time DEFAULT NULL)` returns void. Caller: a school admin, `can_manage_ptm`, or that
    teacher. NULLs = the meeting's hours. Refused once the meeting has ended.
16. Errors, P0001 with HINT: `ptm_hours_outside` (outside the meeting, or shorter than one slot;
    `update_ptm_schedule` raises it too when the new window no longer fits a teacher's hours, naming
    them), `ptm_hours_has_bookings` (a booked slot would leave that teacher's grid; names the
    families), `ptm_hours_invalid` (a malformed `_teacher_windows` entry). A busy teacher is
    `ptm_teacher_busy`, judged on their own hours.
17. Per teacher: `ptm_online_booking_grid`; `book_ptm_slot` (online: "That time is not one of this
    teacher's slots."); the busy guard and `ptm_teacher_busy_windows`;
    `ptm_feedback_summary.bookings.total_slots` (the sum over teachers). `ptm_online_sessions` adds
    `start_time`, `end_time`; `ptm_online_my_sessions` adds `teacher_start_time`,
    `teacher_end_time` (NULL when the meeting's). An unbooked family's `booking_closes_at` is the
    teacher's end.

## Since 2026-10-06 (`20261006140100` and edge function `ptm-meet-create`, your NEEDS EDGE FN in `2f337875`)

18. `ptm-meet-create` is deployed with the Google setup in `2f337875`: the impersonated user, both
    scopes, `config` `{ accessType: OPEN, entryPointAccess: ALL, moderation: ON }`, no co-host
    (`meet_cohost_set` is always false). Cron `ptm-meet-rooms-1min` runs `ptm_meet_create_kick()`
    every minute; it calls the function only when there is work.
19. A room is made for each active online booking whose slot starts between 30 minutes ago and 60
    minutes from now and is not yet due to be locked (item 20), at most 5 attempts (`ptm_online_sessions.meet_failed_count` counts the
    bookings that ran out). A booking moved with `_replace` is a new booking and gets a new room.
20. After the slot (its end plus the gap plus 15 minutes), or once the booking or the PTM is
    cancelled, the room is switched to `accessType: RESTRICTED`: the link lets nobody in any more;
    anyone already in the call stays.
21. `swap_ptm_online_teacher` keeps the bookings' rooms.
22. Cron `ptm-15m-reminders-5min`: `ptm_reminder_15m` to the family about 15 minutes before its
    slot (once per booking; `metadata.booking_id`), and to the teacher before their first booked
    slot of the PTM (once per PTM). No Meet link in the text.
23. The `ptm_booking_confirmed` text now ends "Join from the app when your slot starts." (it said
    the Join button opens 10 minutes before).
24. `ptm_meet_claim_due`, `ptm_meet_record`, `ptm_meet_fail`, `ptm_meet_close_due`,
    `ptm_meet_closed`, `ptm_meet_create_kick` and `ptm_send_15m_reminders` are service_role only.

## Since 2026-10-06 (`20261006170000`, your NEEDS DB in `860dacd3`)

25. One difference from your section 5.1: a teacher's place in a class is a row of
    `ptm_online_session_teachers (class_session_id, ptm_id, teacher_id)`, not a `class_session_id`
    column on `ptm_online_teachers`. `ptm_online_teachers` stays one row per teacher per PTM, so a
    teacher in two classes has one row there and two rows here. The rest is as specified:
    `ptm_online_class_sessions` (`id, ptm_id, class_id, start_time, end_time, added_by, created_at`,
    UNIQUE `(ptm_id, class_id)`, readable by school staff and by a student of that class session),
    `ptm_schedules.online_format` (`separate` | `panel`), `class_session_id` on
    `ptm_online_participants` and `ptm_bookings` (`teacher_id` is NULL on both for `panel`), one
    family per (class session, slot) for `panel`. The browser cannot write any of them.
26. `create_online_ptm(..., _teacher_windows, _online_format text DEFAULT 'separate', _class_sessions
    jsonb DEFAULT NULL)`. With `_class_sessions`, `_teacher_ids` and `_teacher_windows` are ignored.
    Refused: `_class_sessions` with the teacher hat (`ptm_teacher_fixed`), `panel` without
    `_class_sessions` (`ptm_sessions_invalid`). A class's hours equal to the meeting's are stored as
    NULL.
27. `set_ptm_online_class_sessions(_ptm_id uuid, _class_sessions jsonb)` returns `{added, removed,
    kept, hours_changed, refused}`. `added` / `removed` / `kept` count (class, teacher) places;
    `hours_changed` counts classes. `refused` reasons: `has_bookings` (a class, `teacher_id` null, or
    one of its teachers), `hours_has_bookings`, `busy`, `double_booked`, `not_in_class`,
    `not_a_teacher`, `out_of_scope`. An empty list, or a class left with no teacher, fails the whole
    call (`ptm_sessions_invalid`). `student_ids` in the entries are ignored. A teacher left in no
    class leaves the PTM (`ptm_online_unassigned`); a teacher new to the PTM gets
    `ptm_online_assigned`. Refused on a PTM made without classes (`ptm_no_class_sessions`).
28. Errors, P0001 with HINT: `ptm_teacher_double_booked` (names the teacher and both classes; DETAIL
    is `{"teacher_id": ...}`), `ptm_teacher_not_in_class`, `ptm_scope_denied`,
    `ptm_sessions_invalid`; a class's hours use `ptm_hours_outside`, `ptm_hours_invalid` and
    `ptm_hours_has_bookings` (also from `update_ptm_schedule`); `ptm_teacher_busy` is judged per
    class. On a PTM by class `set_ptm_online_teachers` and `set_ptm_online_teacher_hours` are refused
    (`ptm_has_class_sessions`).
29. `set_ptm_online_students(_ptm_id, _student_ids, _teacher_id DEFAULT NULL, _class_session_id
    DEFAULT NULL)`. On a PTM by class: Separately, that teacher's students across the classes they
    sit in (or the one class given), each student placed in their own class; Together, the class's
    one list, set by an admin, the PTM's manager or any teacher of the class. Without
    `_class_session_id` a teacher sets the lists of the classes they sit in; anyone else gets "Pick a
    class."
30. `ptm_online_pick_options(_ptm_id, _teacher_id DEFAULT NULL, _class_session_id DEFAULT NULL)`. On
    a PTM by class, only the students of the teacher's classes in it (or the one class). Together:
    `mine` = on that class's list; an admin, the manager or a teacher of the class may name the
    class.
31. `ptm_online_booking_grid(_ptm_id, _teacher_id DEFAULT NULL, _class_session_id DEFAULT NULL)`.
    Together needs the class, or a `_teacher_id` who sits in exactly one class; `meet_uri` goes to
    every teacher of the class, the admin and the manager. Separately with `_class_session_id`: that
    teacher's grid in that class; without it, the teacher's slots across their classes.
32. `book_ptm_slot` on a PTM by class takes only the student's class's slots ("That time is not one
    of this class's slots."). Together: `ptm_slot_booked` goes to every teacher of the class, any of
    them may cancel or mark attendance, and all of them read that class's feedback.
33. Reads. `ptm_online_sessions`: on a PTM by class one row per (class, teacher) with
    `class_session_id, class_id, class_name, class_section, format`; `start_time` / `end_time` there
    are the class's own hours (NULL = the meeting's); the counts are the class's (Together) or that
    teacher's in that class (Separately). `ptm_online_my_sessions` adds `class_session_id,
    session_start_time, session_end_time` (NULL = the meeting's) and `format`; Together `teacher_id`
    is NULL and `teacher_name` is "Class 5 - A teachers". `ptm_feedback_summary.bookings.total_slots`
    is per class times its teachers (Separately) or per class (Together).
34. A teacher is held for each class's hours plus the gap (busy guard and `ptm_teacher_busy_windows`).
    Meet rooms and the 15-minute reminders cover Together bookings; every teacher of the class is
    reminded before their first booked slot. The (class_id, teacher) pairs RPC was not built.

## Since 2026-10-07 (`20261007100000`)

35. Together: the `ptm_online_assigned` a teacher gets from `create_online_ptm` and
    `set_ptm_online_class_sessions` is titled "Online PTM: pick your students" and asks them to
    pick their class's students (it used to say only that families book with all its teachers).

## Since 2026-10-07 (`20261007140000`, your NEEDS DB in `08f1675e`)

36. Together (`online_format = 'panel'`) is one grid for the whole PTM: the meeting's slots, one
    active booking per (`ptm_id`, `slot_time`) across all its classes (`ptm_slot_taken`). A class's
    hours are always stored NULL. A teacher may sit in several of its classes at the same hours (no
    `ptm_teacher_double_booked` for Together); `ptm_teacher_busy` against other PTMs still applies.
37. `ptm_online_booking_grid` on a Together PTM returns that one grid to any caller who may see it,
    ignoring `_teacher_id` and `_class_session_id`: staff get the families' names and classes, and
    `meet_uri` goes to every teacher of the PTM, the admin and the manager; a student gets the grid
    without names and only their own link.
38. On a Together PTM every teacher of the PTM may cancel any booking and mark attendance, reads the
    feedback of all its classes, and gets `ptm_slot_booked`, `ptm_slot_cancelled`, the day-before
    reminder and the 15-minute reminder (before the PTM's first booked slot).
39. `ptm_online_my_sessions.teacher_name` on a Together PTM names the PTM's teachers ("Meera Nair, Ravi
    Kumar and 2 more"), replacing item 33's "Class 5 - A teachers"; the family's 15-minute reminder
    names them the same way, and its invitation reads "with your teachers".
40. `ptm_feedback_summary.bookings.total_slots` on a Together PTM is the meeting's slot count.

## Since 2026-10-09 (`20261009110000`, your NEEDS DB in `e9d4897d`)

41. Together is retired: the two Together PTMs on prod became Separately, `online_format` allows
    only `'separate'`, and `create_online_ptm` ignores `_online_format`. Items 36 to 40 no longer
    apply.
42. A student may be with several teachers in one online PTM: `ptm_online_participants` is unique
    on (`ptm_id`, `teacher_id`, `student_id`) and `teacher_id` is NOT NULL. A family holds one active
    online booking per teacher (in person: still one per PTM).
43. `book_ptm_slot(_ptm_id, _slot_time, _replace DEFAULT false, _teacher_id uuid DEFAULT NULL)`.
    `_teacher_id` must be one of the family's teachers on that PTM (P0001 `ptm_not_participant`
    otherwise); NULL means the only one, and with several it is P0001 `ptm_teacher_ambiguous` ("Say
    which teacher you are booking with."). `_replace` moves only the booking with that teacher. A
    slot overlapping, gap included, the family's booking with another teacher is P0001
    `ptm_family_double_booked` ("You have a slot with Meera Nair at 14:00. Pick another time.").
    A second booking with the same teacher is P0001 `ptm_already_booked` ("You already have a slot
    with this teacher. Change it instead."). `ptm_booking_confirmed` names the teacher.
44. `ptm_online_booking_grid` for a student takes `_teacher_id` by the same rule (NULL = the only
    teacher, `ptm_teacher_ambiguous` with several); `is_mine` and `meet_uri` are the booking with
    that teacher.
45. `set_ptm_online_students` no longer refuses a student another teacher has (`taken` is gone);
    removing a student cancels only the booking with this teacher. `ptm_online_invited` goes once
    per (teacher, student): "Meera Nair has invited you to "Hostel PTM" on 12 Oct. Book a slot in
    the app."
46. `ptm_online_pick_options`: `state` is `free` or `mine` (mine = on this teacher's list);
    `with_teachers` (text[]) names the PTM's other teachers who have the student; `taken_by_name`
    is gone.
47. `ptm_online_my_sessions`: one row per (PTM, teacher), each with the booking with that teacher;
    up to 100 rows.
48. `swap_ptm_online_teacher` returns `merged_students` (always 0: the new teacher must not already
    be in the PTM, as before).
49. The family's feedback context (`my_teacher_name`) names every teacher they were with.
