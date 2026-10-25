# PTM module

Parent-teacher meetings: schedule them, let families book a slot with the teachers, collect
feedback by QR code, and read the results by class. Design and database contracts:
[specs/2026-09-28-ptm-module-design.md](superpowers/specs/2026-09-28-ptm-module-design.md).

**Status (2026-10-05).** In-person PTMs are live end to end (database applied 2026-09-28 and
2026-09-29). The **residential (online) mode**'s database half is live too (Tushar, 2026-10-05,
migrations `20261005160000` to `160300`); the frontend on `naman-erp` follows it. What does not exist
yet is anything that creates Meet rooms (migration 5 and the `ptm-meet-create` edge function, waiting
on the Google Workspace service account), so every Join button says "Link not ready yet" until then.
Design: [specs/2026-10-03-ptm-online-residential-design.md](superpowers/specs/2026-10-03-ptm-online-residential-design.md);
server status: [specs/2026-10-05-ptm-online-server-status.md](superpowers/specs/2026-10-05-ptm-online-server-status.md).

## Who does what

| Role | Schedules for | Edits or cancels | Sees bookings and feedback for |
|---|---|---|---|
| School admin | the whole school, a wing, or any classes | any PTM | every class |
| Coordinator | their wing, or classes inside it | a teacher's PTM in their wing, and their own | their wing's classes |
| Teacher | the classes they teach | only the class PTM they created | those classes, every family in them |
| Student (the family account) | nothing | nothing | books one slot, sends one feedback per PTM |

There is no class teacher in the system: a teacher acts on every section they have a teacher row on,
with or without a subject (Naman's ask, Tushar's rule, live since 2026-09-29 as
`20260929170000_ptm_teacher_scope.sql`). Every teacher of a section can schedule a PTM for it and
sees its family feedback, booking names and voice notes; each edits and cancels only the PTMs they
created. This is whole-section on purpose, like attendance (CLAUDE.md section 25). Dual-role staff
act under the hat chosen in the app bar. The server
enforces all of this; the UI only hides what the server would refuse.

## Online PTMs

For students who board (the code still says "residential"; the screen says "Online PTM" since
2026-10-05). "Schedule PTM" asks Regular or Online. A **teacher** creating one picks the students
from all students of the classes they teach (a class-level tick picks a whole class; there is no
residency flag, the teacher knows), then date, times, slot length and the gap between slots. An **admin or coordinator** sets the date and times first, then the classes: every class they tick
gets a **box** with its own hours inside the meeting (default: the whole meeting) and the teachers of
that class (any of them; a teacher's Google account is their login email unless they set another, so
nobody is blocked for lacking one). The admin never picks students: the teachers do, afterwards,
from the PTM's Edit. Each box has its own teacher picker, where a teacher already in another box at
an overlapping time, or in another PTM then, is greyed with the reason and one free at another time
shows an "Also in ..." note; each teacher then runs their own slot grid and picks their own students.
Hours edited into an overlap error in both boxes and block Create. The class boxes need the server
half of
[specs/2026-10-06-ptm-online-class-sessions-design.md](superpowers/specs/2026-10-06-ptm-online-class-sessions-design.md)
(live on prod since 2026-10-06 afternoon; before it the boxes are sent as the flat teacher list
with own hours). The "Together" format of 2026-10-07 was withdrawn on 2026-10-09: every online PTM
runs teacher by teacher. **A student may be with several teachers in one PTM** (2026-10-09,
[specs/2026-10-09-ptm-online-many-teachers-per-student-design.md](superpowers/specs/2026-10-09-ptm-online-many-teachers-per-student-design.md),
server half live on prod since 2026-10-09, status note items 41 to 49): the picker shows "Also with X" on such a row and keeps it tickable (an older
server greys it "With X" and refuses it), the family's card names every teacher with one slot row
and Join each, and the booking sheet books with each teacher in turn, greying a tile that clashes
with the family's other slot. Families book a slot with each of their child's teachers until the meeting starts, and get
a Join button that reads "On hold · Your turn at 3:40 PM" until two minutes before their slot, "Join
now" during it, and "Your slot is over" after. SALCI makes one Google Meet room per booked slot about
an hour before it (open access, no recordings), owned by team@salci.in: Google Meet caps a call at an
hour, so the teacher moves to the next room when one is done. The co-host API is not available on
our Workspace edition (checked 2026-10-06), so the teacher joins each room as a guest like the
family does; the app, not Meet, keeps families apart (one room per slot, Join only in your slot). The Bookings tab opens on
every booked meeting of everyone in scope, soonest first, each row naming the teacher and the
class (Naman, 2026-10-09: "show all the booked meetings and then if any filter is applied"); the
Class and Teacher selects narrow it, and one teacher alone shows their whole grid, free slots
included, with its own Join per booking, all "On hold" except the one in progress (marked "Now").
The everyone view is one bounded grid call per teacher with students, sharing the single-grid
cache (a `ptm_online_bookings(_ptm_id)` read would make it one call; PERF-DEBT). On the PTM list the
"Past and cancelled" section has Status, Kind and time filters (any time, last 7 or 30 days, last 3
months, this year; Naman, 2026-10-09), applied to the page already fetched, with a Clear all. A teacher's
Google account is their login email unless they set another under Settings. Only the creator or an admin edits or
cancels; a teacher changes only their own student list, from the **Students** button beside Edit (its
own sheet; Edit holds the PTM's details alone; a teacher in an admin-made PTM gets Students and
no Edit; Naman, 2026-10-09: "give a separate button instead of edit"). An admin can change the teacher list, or the classes
and their hours once the class sessions are live (a teacher with bookings stays until swapped), and
hand one teacher's whole session, students and bookings included, to another. The Overview shows
four short facts and one row per teacher (students, booked, attended, hours), grouped by class once
class sessions exist. Feedback afterwards is the in-app form.

## Configuration

| Setting | Where | Default |
|---|---|---|
| Module on or off for a school | institution feature `ptm_scheduling` | off: Tushar turns it on per school |
| Slot booking | per PTM, on the create form (always on for online) | off |
| Slot length | per PTM: 5, 10, 15, 20 or 30 minutes | 15 |
| Gap between slots (online) | per PTM: none, 5 or 10 minutes; set at creation | 5 |
| Booking closes | per PTM: at the start, or 30 minutes to 1 day before | 1 hour before (online: at the start) |
| Feedback editable | per PTM: until the end, or 1 to 14 days after | 3 days after |
| Join window (online) | constant in `src/lib/ptm.ts` | 2 minutes before the slot until it ends plus the gap; "On hold" before, "Done" / "Your slot is over" after |
| Teacher's Google account (online) | Settings, or the Teachers page menu for an admin (stored in `user_google_accounts`, read only through `get_google_email`) | the login email (since 2026-10-05; never required to schedule) |
| Message length, voice note length and size | constants in `src/lib/ptm.ts` | 1000 characters, 2 minutes, 5 MB |

## How it behaves

* **Status is computed, never stored.** Upcoming, happening now and completed come from the date and
  times in the school's timezone; only "cancelled" is written. Cancelling is soft: bookings and
  feedback stay. A meeting that has ended can be edited but not cancelled.
* **Slots are computed too.** Start, end and slot length make the grid; a booking is a class plus a
  time, and a unique index is the capacity (one family per slot per class, one slot per student per
  PTM). Moving the start time keeps bookings and lists the ones that no longer fit.
* **Feedback.** Rating 1 to 5 is required; a message and a voice note are optional. It opens when
  the meeting starts. Each PTM has an unguessable token: its QR opens `/ptm/feedback/<token>`. The
  permanent QR `/ptm/feedback/active` opens whichever meeting is taking feedback for the child's
  class, with a picker when there are several. Both render the same form. A signed-out parent is
  sent to the login page and brought back to the form. On an Android phone with the SALCI app
  installed, the scan opens the app on the form instead of the browser (App Link, see
  [mobile/README.md](mobile/README.md#app-links-the-ptm-feedback-qr)); elsewhere it opens the website.
* **Voice notes** live in the private `ptm-feedback-audio` bucket. Staff get a signed link only when
  they press Play; the CSV export carries links valid for 7 days.
* **Dashboard.** Response rate, average rating, rating spread, a per-class breakdown and booking
  stats, all counted in SQL, then a filtered, paged feedback list with CSV export.

## Where the code is

| Path | What |
|---|---|
| `src/lib/ptm.ts` | pure helpers: slot grid (with the online gap), computed status, booking, feedback and join windows, busy windows, the hat, the edit rules |
| `src/lib/ptmClassSessions.ts` | pure helpers for the admin's class boxes: hours, slot counts, who can be ticked where (in another box, busy elsewhere), the errors that block Create, the two payload shapes |
| `src/hooks/ptm/` | queries and mutations, one untyped RPC bridge, query keys, the feature gate, the three-level schema probe; `usePTMOnline.ts` and `useGoogleEmail.ts` for the online mode |
| `src/components/ptm/` | list panel, detail view, the two form sheets (`PTMFormSheet`, `ResidentialPTMSheet`), the mode chooser, the class boxes (`ClassSessionBox`, `ClassSessionsSheet`, `HoursRow`), the student and teacher pickers, slot grid, Join button, QR card, recorder, dashboard, Google-account sheet and card |
| `src/pages/PTMFeedbackPage.tsx` | the two QR routes |
| `src/lib/returnPath.ts` | the validated return path after login |
| `src/lib/appLinks.ts` | the links the Android app claims (the two QR routes), checked before the app opens one |

## Notifications

In-app (and, since the push webhooks, on the phone too), from database triggers added on
2026-09-15: scheduled, rescheduled, cancelled, and a day-before reminder. The online mode adds
invited, booking confirmed and cancelled, slot booked and cancelled (to the teacher), teacher
assigned, unassigned and swapped, and a 15-minute reminder; the icons are in `NotificationPanel.tsx`
and `notificationLink.ts` opens the exact PTM from `metadata.ptm_id`. SMS and email are out of scope.
