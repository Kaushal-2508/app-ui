# Exam slot booking: no two exams at once for one section

Date: 2026-09-28. Migration: `supabase/migrations/20260928170000_exam_slot_booking.sql`.

## The bug

Two teachers (Hindi and English, say) could each publish an exam for Class 8 A at 14:00, and a
student cannot sit both. Nothing checked, and the Schedule & publish sheet showed nothing about
other exams. Prod on 2026-09-28 held 56 overlapping pairs (8 with the exact same start, 6 of those
by different teachers at Alliance), all in the past.

## The rule

An exam holds `[start_time, occupied_until)` for every section it is linked to, half-open, so
back-to-back exams are fine.

* `occupied_until` = `end_time` (start + late entry + duration, as the current flow saves it).
  With late entry NULL or 0 there is no join window, so `student_eligible_exams` lets students join
  until `end_time`. What happens next depends on the mode:
  * Online attempts are capped at `end_time` (`exam_attempt_remaining_seconds`), so the exam still
    ends there.
  * Hybrid attempts are not capped, so they run until `end_time + duration`.
  * With no `end_time` at all there is no cap either.

  Hybrid adds each student's phone upload window (`hybrid_exam_settings.grace_window_minutes`,
  default 5). One SQL function, `exam_slot_occupied_until`, mirrored by `examSlotOccupiedUntil`
  in `src/lib/examSlots.ts`. Keep the two identical.
* **Checked** (the exam trying to book): status published/active, mode online/hybrid, start_time
  set. **Blocking** (already booked): the same plus status completed. Drafts never book. Offline
  exams carry a date only and never book a time. `is_results_only` is deliberately NOT an
  exemption: every real results-only exam is offline, and an online one is still sittable.
* An online/hybrid exam may not go live, or stay live, without a start time. It would be sittable
  yet book nothing. The 8 legacy live rows that have none are left as they are, because only a
  transition raises.
* A section of another school can never be linked to an exam (`exam_classes_same_school`, drafts
  included). The existing `exam_classes` INSERT policy never compared institutions, and with the
  guard in place that became a cross-school timetable oracle. 0 such rows existed.
* A window that is already over is never checked. That keeps the legacy overlaps editable and
  lets published -> completed (result validation) run untouched.
* **Optional-group alternatives run side by side.** When every subject of both exams sits in ONE
  `optional_groups` row of the section's class group and the two share no subject, no student
  takes both (at most one subject per group), so they do not clash. Maths vs Biology and
  Economics vs Punjabi at Alliance are real cases. Subject names and `is_optional` are not
  signals: Punjabi vs Hindi in Class 8 B is compulsory.

Trade-off, taken knowingly because the ask was "no overlaps": the full window blocks. Alliance uses
late entry up to 540 min, and 44 of the 56 legacy pairs were ones students could sit one after the
other. A long late entry now holds the section for that whole window, and the sheet says so.

## Who sees booked times

`can_view_class_exam_slots(user, class)`: super admin; a school admin or super school admin whose
`user_roles.institution_id` is the class's school; or, in the same school, a coordinator
(role AND `is_coordinator_for_class`) or a teacher with any teacher row on that section
(`is_teacher_for_class`, subject or not, the same set the exam class picker offers).

It is deliberately class-level, not subject-scoped: the Hindi teacher of 9 A must see the English
teacher's 9 A exam or the feature cannot work.

RLS already lets every member of a school read every exam row, students included, so this rule
cannot rest on RLS. `get_exam_slot_bookings` (SECURITY DEFINER, anon revoked) is the only read path
the sheet uses. Sections the caller may not see come back `authorized: false` with no bookings, and
the sheet says they are "not shown, still checked when you publish". A title is returned only for
the caller's own exams. The query is `meta: { persist: false }` so other teachers' bookings never
reach localStorage. Tightening the school-wide exam RLS is separate debt, not part of this change.

## Enforcement (race-safe)

`useSaveExam` writes every child row first and flips `status = 'published'` last, so the guard
lives on that flip. Triggers:

| Trigger | Fires on | Checks |
|---|---|---|
| `exams_slot_guard` (BEFORE) | INSERT, UPDATE OF status/start/end/late/duration/mode | an exam going live, a live exam's window changing, no start time |
| `exam_classes_same_school` (BEFORE) | INSERT, UPDATE of class/exam | the section belongs to the exam's school |
| `exam_classes_slot_guard` (AFTER) | INSERT, UPDATE of class/exam | a section added to a live exam (re-checks the whole sorted section set) |
| `exam_subjects_slot_guard` (AFTER) | INSERT, UPDATE of subject/exam, direct DELETE of the last subject | a subject change that can end an exemption |
| `hybrid_exam_settings_slot_guard` (AFTER) | INSERT, longer grace, row moved to another exam | a longer hybrid hold |

The child-row re-check takes `FOR SHARE` on the exam row first, so it waits for a concurrent
publish or reschedule and then reads the committed status. A subject-delete cascade is recognised
by the subject already being gone. `pg_trigger_depth()` does not distinguish it: the dry run showed
an FK cascade's AFTER trigger firing at depth 1.

`_exam_slot_assert_free` takes `pg_advisory_xact_lock(hashtextextended('exam_slot:'||class_id,0))`
for every section in sorted order, then runs the overlap check as a new statement. Under READ
COMMITTED that statement sees a rival publish that committed while it waited, so two teachers
publishing in the same second cannot both win. An exclusion constraint was not possible: the
window lives on `exams`, the section on `exam_classes`, and btree_gist is not installed.

The error is P0001 with HINT `exam_slot_conflict`, worded to pass `translateError` verbatim, for
example "Time clash: Class 3 - C already has Hindi from 14:00 to 15:15 on 1 Oct. Pick another
time." It names the clash only to someone who may see that section. Because `exam_classes` INSERT
RLS lets any teacher of the school link any section to a draft, everyone else gets a generic
message, so the guard cannot be used to probe another class's timetable.

## The sheet

`ReviewPublishScreen` > `ExamSchedulePlanner`, fed by `useExamSlotPlan`:

* the exam date is picked from the app's own calendar (not the browser's native picker, which
  cannot carry marks), and every day already holding an exam for the selected sections shows a
  dot per exam, up to 3. The marks come from their own read of the month on screen (at most 44
  days, inside the RPC's 45-day cap); the clash check reads only the chosen day, 2 days back and
  3 forward (a late-entry window can run past a whole day);
* a timeline for the chosen day, one lane per section, the exam being scheduled as a band across
  them (teal when free, red and dashed on a clash);
* the day's bookings as a list (time, subject, sections, teacher or "Your exam", Clash /
  Alongside / mode);
* on a clash, no separate card: a red "This time clashes with another exam" line sits right under
  the "Booked on" heading, the clashing booking is tagged in the list, and free start times that
  fit (on both sides of the clash) sit right under the list;
* notices for a long late entry, a join window already closed, an exam that opens on publish,
  and sections whose bookings are hidden.

Publishing re-reads the bookings first. The sheet stays open until success. A clash the server
caught in a race is shown inline and the bookings refresh. The error state renders before the
empty state, and a failed read never blocks publishing, because the server still decides.

While checking or publishing, every input sits in a disabled fieldset and the sheet cannot close.
After the pre-publish re-read, the publish goes out only if the sheet is still open with the same
slot, and it goes through the latest handler. Single-flight is live
(`queryClient.isMutating({ mutationKey: SAVE_EXAM_MUTATION_KEY })`), not a render-time `isPending`.
Several states render as unknown, never "free": offline (a paused query), a failed read (the day
calendar draws no dots and says so), and "every section hidden".

## Verification

* A rolled-back dry run in prod: the whole migration plus 32 scenario checks inside one DO block
  that raises its results, so nothing persists.
  * **Blocked:** a same-slot publish, a 1-min overlap, a live reschedule, linking a section to a
    live exam, hybrid grace, cross-school links, a results-only flip, no-start publish and clear,
    subject UPDATE, last-subject DELETE, and a hybrid settings move.
  * **Allowed:** back-to-back, a title edit, re-saving existing links, optional alternatives side
    by side, a subject-delete cascade, and a legacy overlap edit plus completion.
  * **RPC scoping:** a class teacher sees bookings, a non-teacher gets `authorized:false`, and a
    call with no JWT gets 42501.
  * **Real client role:** the guard fires under `SET ROLE authenticated`, and only the RPC is
    granted to `authenticated`.
* An adversarial review (4 lenses, each finding checked by a skeptic): 16 findings confirmed, all
  fixed above; 6 refuted.
* Frontend: typecheck, eslint (plus the stale-import pass), vite build, and `test:cache`. Also 23
  unit checks of `examSlots.ts` whose occupancy numbers match the SQL dry run, and screenshots at
  375px and 1440px, light and dark.

## Also fixed on the way

* `useSaveExam` toasted a raw `error.message` (and a duplicate success) under the caller's
  translated toast: every result showed twice. Toasts now belong to the caller.
* A publish that failed after inserting a new draft lost its id, so each retry inserted another
  orphan draft. `onDraftCreated` hands the id back immediately.
* The Continue-to-review soft-save had no single-flight guard.
* The schedule sheet rendered on literal white in dark mode (`MobileSheet` default); it now uses
  `desktopWidth="md"` (surface-card token).
* The sheet claimed late entry 0 meant "students must join exactly at the start time". The student
  view actually lets them join until the end time, and an online attempt is then cut off at the end
  time. The copy now says both.
* CLAUDE.md §10 and a `useSaveExam` comment named a trigger, `prevent_invalid_exam_publish`, that
  does not exist. The real publish gate is `validate_exam_status` -> `validate_exam_status_transition`.

## Not done

* `useUpdateExam` is dead code (nothing imports it). The triggers cover it if it is revived.
* Offline paper exams have no time, so they cannot clash. The sheet lists the day's timed exams
  for reference only.
* No reschedule UI exists for published exams. The guard covers a direct API reschedule.
