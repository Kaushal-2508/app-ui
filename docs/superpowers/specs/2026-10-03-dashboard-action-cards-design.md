# Dashboard action cards: check-in, substitution, leave, check-out

Status: design approved in chat by Tushar on 2026-10-03; written spec approved ("go") the same day.
Revised 2026-10-05 after the plan's independent review (layout breakpoint, refresh moments, the
dashboard's attendance-pass kick, the coordinator view's staff leave, 12-hour card times); each
change is marked in place. Plan: docs/superpowers/plans/2026-10-03-dashboard-action-cards.md.

## 1. Goal

The top of every staff dashboard is today a decorative 3D banner (the "Clay School",
`SchoolSceneIllustration`). When the signed-in person has something to do today, that slot shows
**floating action cards** instead, in a fixed order the person can swipe through:

1. **Check-in**: you have not checked in today.
2. **Substitution**: periods in your scope still need a substitute today.
3. **Leave**: leave applications are waiting for your decision.
4. **Check-out**: check-out time has come and you have not checked out.

When nothing is waiting, the 3D banner shows as it does now. A card disappears as soon as its
work is done (checked in, substitutes assigned, leave decided, checked out).

Success means: the first thing a teacher, coordinator or school admin sees in the morning is a
one-tap check-in; an admin or coordinator learns about uncovered periods and pending leave without
opening Workday; nobody is nagged on a holiday or a leave day; and the dashboard stays as fast as it
is today.

## 2. Decisions made by the owner (2026-10-03)

| Question | Decision |
|---|---|
| Until when does the check-in card show? | Until the person checks in, or until the school's check-out time passes, whichever is first. A late check-in is still allowed (recorded as late). |
| Who sees the leave card? | Only people who decide. **Student leave:** the teachers of the student's section (subject teachers and the class teacher) and the section's wing coordinator. **Not school admins.** **Staff leave:** the wing coordinator (for teachers in their wing) and school admins. Never your own request. |
| Schools whose staff never check in (the engine flags every period as needing cover every day) | The substitution card counts covers only on days when the school has real check-ins (at least one staff check-in today). Otherwise no substitution card. |
| How do the substitution and leave cards act? | They show the count and the most urgent item, and open the existing screen at the right tab (Workday > Substitutions, Workday > Staff Leaves, Attendance > Student Leaves). Check-in and check-out act in the card. |

Decisions taken in the approved design (not asked separately):

- The cards **replace** the banner; the 3D engine is not downloaded while cards show.
- All due cards sit in one row in the order above. Below 1024 px (phones, and tablets beside the
  open sidebar, where three cards cannot fit): one card at a time, swipe, with dots. From 1024 px:
  side by side, equal width. (Revised 2026-10-05 from 768 px.)
- Students and super admins never get cards (the banner as today, no new request). The `employee`
  role has no dashboard today and is out of scope. Timetable-manager override holders (teachers) get
  no substitution card, because teachers do not arrange cover (owner's rule).
- Dual-role accounts (CLAUDE.md §25): check-in and check-out are per person and show on every view;
  substitution and leave follow the active view and never union scopes. An account that is both
  school admin and coordinator has no view switch today (`ActiveRoleContext` offers none), so it
  lands on the admin dashboard and gets the admin cards. An admin who also teaches and coordinates
  can switch to the coordinator view; its staff leave is then the wing rung only (§3.3).
- Check-in and check-out cards hide on holidays, non-working days and approved-leave days.
- The small check-in/check-out button in the greeting stays (leaving early must stay possible, and
  check-out is never blocked). It hides while a check-in or check-out card is on screen, so there are
  never two identical buttons, and it gains an "On leave" state.
- Admin and coordinator dashboards run the existing attendance pass once per browser session per
  day after the cutoff, sharing Workday's guard, so covers appear within about a minute of the
  cutoff instead of up to 15 minutes later. The dashboard waits a random 20 to 60 seconds first (all
  of a school's admin and coordinator dashboards turn due at the same moment, and two passes at once
  can collide) and does not report a failure (the 15-minute cron is the safety net); Workday's kick
  still runs at once and still reports one. (Revised 2026-10-05.)
- A failed check shows an error card with Retry, never a silent fall back to the banner (§6).

## 3. The cards

All times and dates are the **institution's** (CLAUDE.md §24): `now() AT TIME ZONE
institutions.timezone`, default `Asia/Kolkata`. Check-in and check-out times come from
`attendance_settings` (`staff_check_in_time`, `staff_check_out_time`, `staff_late_grace_minutes`), or
the existing defaults 08:00, 16:00 and 30 minutes when a school has no row.

"Working day" means the school's working dates as `_staff_leave_workdays(institution, today, today)`
already defines them for staff leave: weekdays in `tt_period_structures.working_days` (Monday to
Saturday when none), minus `cal_events` holidays.

Who counts as staff: anyone holding `teacher`, `coordinator`, `school_admin` or
`super_school_admin` in the institution. All four cards also require the institution's `attendance`
feature (the flag that already gates check-in, Workday and leave pages).

Card times use the 12-hour clock with AM/PM (and so do the greeting button and the Workday card).

### 3.1 Check-in card (any staff view)

Shows when all of these hold:
- today is a working day;
- today's `staff_attendance_records` row for the person either does not exist, or exists without
  `check_in_at` and with status `absent` (see below);
- the local time is before `staff_check_out_time`.

States:
- **Due** (no row): "Check in for today". Detail before `staff_check_in_time`: "Check in by
  8:00 AM". From that minute on: "Checking in now is recorded as late." (Today's classification
  already stores any check-in after `staff_check_in_time` as late, grace or not.) The line is chosen
  on the device from the school's clock, so it changes at check-in time without a new request.
  Button **Check in**.
- **Marked absent** (row with status `absent`, no `check_in_at`): "Marked absent today". Detail:
  "Ask your admin to change it." No button, because a self check-in would collide with the row.

Never shown when the row is `on_leave` or `holiday`, when `check_in_at` is set, on non-working days,
or after check-out time.

The **Check in** button runs the existing `useCheckInStaff` mutation, with the same present/late
classification and the same follow-up (teachers get `CheckInBacklogSheet` when they have unlogged
days). The check-in behaviour is not reimplemented; the existing logic in `StaffCheckInCard` moves
into one shared hook that both the greeting button and the card use.

### 3.2 Substitution card (admin view and coordinator view only)

Shows when all of these hold:
- the active view is admin (the person is a school admin) or coordinator (the person holds the
  coordinator role);
- the school has at least one staff check-in today (`staff_attendance_records` with `check_in_at`
  set, today, this institution);
- at least one `tt_substitutions` row exists with `status = 'pending'`, `date = today`, whose period
  has not ended yet (`tt_period_slots.end_time > local time`), whose class is active, and which is in
  the viewer's scope:
  - admin view: every class of the institution;
  - coordinator view: classes mapped to **any** wing the person holds (`wing_assignments` x
    `wing_class_mappings`). A coordinator with no wing gets nothing (fail closed, never the whole
    school).

This is the same queue the Workday Substitutions tab shows, narrowed to periods not yet over, and the
same people `tt_user_can_edit_class_slots` lets assign a cover. The Workday list also shows periods
that are already over (it has no time filter), so its total can be higher than the card's; the card
counts only covers that can still help.

Content: "4 periods need a substitute". Detail: "Next: Period 3, 8 - B at 10:40 AM" (the earliest
such period by start time; the class through `formatClassName`). Button **Assign** opens
`/staff/workday?tab=substitutions`.

It disappears when every such period has a substitute (assigned, cancelled by a late check-in, or
over).

### 3.3 Leave card (per view)

Counts **pending** requests the viewer may decide, by view:

| View | Student leave (`leave_requests`) | Staff leave (`staff_leave_requests`) |
|---|---|---|
| teacher | sections the person teaches (any `class_assignments` teacher row on the class: subject teachers and the class teacher) | none |
| coordinator | sections in any of the person's wings | `can_review_staff_leave`'s coordinator rung only: teachers of classes in their wings who are neither admins nor coordinators (revised 2026-10-05: calling the whole helper would hand an admin who also coordinates the whole school in the coordinator view) |
| admin | **none** (owner's rule) | requests `can_review_staff_leave` allows (everyone but themselves) |

Student requests count only when `student_in_class(student_id, class_id)` still holds, so a request
stranded by a class move (which nobody can decide) never pins the card.

Content: "3 leave requests waiting". Detail: "2 students, 1 staff · oldest 3 days" ("oldest 1 day";
"filed today" when every request is from today). Buttons:
- only student requests: **Review** opens `/school/attendance?tab=leaves`;
- only staff requests: **Review** opens `/staff/workday?tab=staff-leaves`;
- both: **Students** and **Staff**, one per destination.

It disappears when nothing is pending for the viewer.

### 3.4 Check-out card (any staff view)

Shows when today's row has `check_in_at`, has no `check_out_at`, and the local time is at or after
`staff_check_out_time`. It stays until the person checks out or the day ends.

Content: "Time to check out". Detail: "Check-out opened at 4:00 PM". Button **Check out** runs the
existing `useCheckOutStaff` (recorded on the tap for everyone), then teachers get the dismissible
`CheckOutSyllabusSheet`, exactly as today. Nothing is ever required before or after.

### 3.5 Order, layout and the banner

- Order is fixed: check-in, substitution, leave, check-out. A card that is not due is simply absent,
  so the first due card is always first.
- The card row takes the banner's exact box (`h-28 sm:h-32 md:h-36 lg:h-40 xl:h-44`), so the page
  never shifts when cards appear or give way to the banner.
- Below 1024 px: one card per view, CSS scroll-snap, position dots inside the box's bottom edge (each
  dot a button with a 24 px hit area). From 1024 px: all due cards side by side, equal width.
- Look: the clay style of the dashboard tiles (`ClayPebble` icon, clay tone per card: check-in teal,
  substitution peach, leave violet, check-out mint), a soft floating shadow from 1024 px (a flat one
  below, where the swipe row would clip it), no `backdrop-filter` (the app's WebViews re-composite it
  while scrolling), both themes, no em-dashes in any text.
- The row is a labelled region ("Things to do today"), not `aria-hidden` like the banner; cards are
  real buttons and links.
- When no card is due, the slot renders `SchoolSceneIllustration` (without its second fade-in, since
  the sky box it replaces is the same gradient). While the first answer is loading, the slot shows the
  banner's plain sky box (no 3D), so the 3D engine never starts and stops on the way to showing cards.
- Cards appear only on each role's landing dashboard (teacher hub, coordinator dashboard, school admin
  landing). The admin category sub-grids keep the banner.

## 4. Data: one read-only RPC

Every staff dashboard load is the morning peak (3-5K concurrent users, CLAUDE.md §23), so the cards
come from **one** server call, not from the four client hooks that serve the full screens.

```sql
public.my_dashboard_actions(p_view text DEFAULT NULL) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  -- the logic: public._my_dashboard_actions(p_uid uuid, p_view text, p_now timestamptz), plpgsql
```

- The caller is `auth.uid()` only; no user or institution argument. A NULL caller, a student, a
  super admin, anyone without a staff role, or a person with no institution gets an empty payload
  (no cards).
- `p_view` (`'admin' | 'coordinator' | 'teacher'`) is a request that can only narrow: it is honoured
  only when the person holds that role (admin = `is_institution_admin`), otherwise the default view
  is used: admin for a school admin, else teacher, else coordinator, which is the same default
  `ActiveRoleContext` picks. The effective view is echoed back. This is the
  `task_status_counts(p_scope)` pattern. Each dashboard passes its own view (teacher hub `teacher`,
  coordinator dashboard `coordinator`, admin landing `admin`), not the raw `activeViewRole`, which
  reads "teacher" for single-role accounts.
- A private twin `_my_dashboard_actions(p_uid uuid, p_view text, p_now timestamptz)` holds the logic,
  so the SQL test can pin the clock; the public function passes `auth.uid()` and `now()`. The twin is
  executable by nobody but its owner.
- Grants: `REVOKE ALL ... FROM PUBLIC`, `REVOKE ... FROM anon` **by name**, `GRANT EXECUTE ... TO
  authenticated` (CLAUDE.md §26). Verified in `information_schema.routine_privileges` after applying.
- It reuses the existing helpers and indexes: `get_user_institution`, `is_super_admin`,
  `is_institution_admin`, `can_review_staff_leave` (admin view), `student_in_class`,
  `_staff_leave_workdays`, and the indexes
  on `tt_substitutions (status, date)`, `leave_requests (institution_id, status)`,
  `staff_leave_requests (institution_id, status, created_at)` and `staff_attendance_records
  (staff_id, date)` / `(institution_id, date)`. No per-row free-teacher ranking.
- It returns counts and one line of context, never row lists:

```json
{
  "v": 1,
  "date": "2026-10-03",
  "view": "coordinator",
  "check_in":  { "state": "due", "by": "08:00", "until": "16:00" },
  "cover":     { "pending": 4,
                 "next": { "label": "Period 3", "class_name": "8", "section": "B", "start": "10:40" } },
  "leave":     { "students": 2, "staff": 1, "oldest_days": 3 },
  "check_out": null,
  "pass_due": true,
  "refresh_in_s": 1740
}
```

  Each card key is `null` when that card is not due. `check_in.state` is `"due"` or `"absent"`.
  `class_name` and `section` are the raw `classes` columns, shown through `formatClassName`.
  `check_out` is `{ "record_id": "<today's staff_attendance_records id>", "since": "16:00" }`; the
  card checks out that row only. `pass_due` is true for the admin and coordinator views when the
  school has an `attendance_settings` row, today is a working day, and the local time is at or past
  `staff_check_in_time` plus grace (no grace when late check-in is off), the moment the attendance
  pass starts marking. `refresh_in_s` is the number of seconds until the next moment the answer can
  change by the clock alone, or `null`: the earliest of the next pending period ending, check-out
  time (while today's check-in or check-out is still open), the attendance-pass cutoff (admin and
  coordinator views, until it passes) and local midnight. Check-in time is not one of them: the
  check-in card chooses its late line on the device (§3.1). (Revised 2026-10-05.) An answer whose
  `v` is not 1 is an error on the client, never "nothing due".

The migration lands in `supabase/migrations/`, is applied to prod with `scripts/run-sql.ps1`
(CLAUDE.md §26) **before** the frontend ships, and its entry in `src/integrations/supabase/types.ts`
is spliced in by hand (never a wholesale regeneration).

## 5. Client

- **Hook** `useMyDashboardActions(view)`: key
  `['staff-attendance', 'my-actions', userId, view, institutionLocalDate]`, `staleTime: 60_000`,
  plain JSON (persisted like other queries; the date in the key stops yesterday's answer from being
  restored the next morning). Enabled only for staff views with the `attendance` feature on.
- **Freshness**: nesting the key under `['staff-attendance']` means the writes that already
  invalidate that root refresh the cards with no change: check-in, check-out, the admin attendance
  override, the attendance pass, and both staff-leave decision hooks (`useReviewStaffLeave` and the
  HR copy in `useStaffLeave`). Two places gain the key: `invalidateSubstitutionCaches` (both
  cover-assign paths) and `invalidateAttendanceCaches` (student leave decisions). A timer refetches
  one second after the moment `refresh_in_s` names, counted from when that answer arrived, never
  sooner than 30 s and with a random 0 to 20 s added per dashboard (a school's dashboards share those
  moments). A return to the tab or the app (`onAppStateChange`, which also covers the native shell)
  refetches when the data is older than a minute. No realtime channel and no polling. A successful
  check-in or check-out drops its card from the cached answer at once, so there is no second tap in
  the gap before the refetch lands.
- **Slot** `DashboardTopSlot`: takes the dashboard's view; renders the banner for student and super
  admin and when the attendance feature is off (then it makes no check-in requests at all);
  otherwise the sky box while loading, the error card whenever the latest fetch failed (even if an
  earlier answer is still cached, so old cards never stand in for a failed check), the card row when
  any card is due, and `SchoolSceneIllustration` when none is. While the error card shows, the
  greeting button stays, so check-in and check-out remain possible.
- **Check-in flow**: `StaffCheckInCard`'s state and post-action sheets move into one shared hook used
  by the greeting button and the cards. The greeting button hides while a check-in or check-out card
  shows and gains an "On leave" pill for `on_leave` rows.
- **Deep links**: `WorkdayPage` and `SchoolAttendancePage` read an initial `?tab=` (`substitutions`,
  `staff-leaves`, `leaves`) and ignore a value the viewer's role does not have.
- **Attendance pass kick**: Workday's once-per-session-per-day kick moves into a shared hook with the
  same `sessionStorage` key, so a dashboard visit and a Workday visit share one guard. On the
  dashboard it fires only when the payload says `pass_due` (admin and coordinator views, judged on
  the institution's clock), 20 to 60 s later and without a toast; Workday fires only once the school's
  own `attendance_settings` row has loaded, so neither page spends the shared guard on the defaults
  or before the cutoff. (Revised 2026-10-05.)
- **Bundle**: the cards use CSS scroll-snap, not the unused embla carousel. The Dashboard chunk cap in
  `scripts/check-banner-chunk.mjs` (52.5 kB) is raised only by what the cards measurably add, with the
  reason recorded in the script.

## 6. Scale Gate (enterprise-code-quality.md)

1. Bounded: the RPC returns counts and one row of context; every count is a filtered aggregate. Pass.
2. Aggregated server-side: counts are SQL `count(*)`, never client `.length`. Pass.
3. `staleTime: 60_000` on the new hook. Pass.
4. No `select("*")`: the RPC selects named columns. Pass.
5. Mutations: none new; check-in/out reuse the existing idempotent mutations (23505 handled). Pass.
6. No multi-write: the feature adds no write. Pass.
7. Migration adds a function only, no FK; helpers are SECURITY DEFINER. Pass.
8. Errors: an error card with Retry renders before the empty state. Pass.
9. No `auth.getUser()`. Pass.
10. No `refetchInterval`; the refresh timer and resume listener are cleaned up. Pass.

## 7. Testing

- **SQL** `scripts/test-dashboard-actions.sql`, transaction rolled back, in the style of
  `scripts/test-substitutions.sql`, calling `_my_dashboard_actions` with pinned times: check-in
  due / absent / on leave / holiday / non-working day / after check-out time; check-out before and
  after check-out time; cover counts for admin and coordinator views (wing scope, ended periods
  excluded, no check-ins today means no card, coordinator without a wing gets nothing); leave counts
  per view (admin gets no student leave and never their own staff request; teacher only taught
  sections; stranded request excluded); `p_view` cannot widen; student and super admin get empty.
- **Client** pure helpers (payload to ordered cards, copy, refresh delay) in an import-free module,
  tested with `node --experimental-strip-types` like `test:banner-tod`.
- **Browser**: dev server with real sign-ins for a teacher, a coordinator and a school admin, at
  375, 768, 1024 and 1440 px, light and dark: cards in order, each dashboard sending its own view,
  text kept inside its card, swipe and dots below 1024 px, side by side from 1024 px, one write per
  double tap on Check in / Check out, links open the right tab, the banner returns when nothing is
  due, the 3D engine is not requested while cards show (forced live in headless Chrome so the check
  can fail), and the error card appears when the RPC fails, also after an earlier good answer.
- **Gate**: `npm run typecheck`, `npx eslint` on changed files, the stale-import pass, `npx vite
  build`, `npm run check:banner-chunk`, `npm run test:cache`, `npm run test:banner`, plus the two new
  tests.

## 8. Rollout

1. Apply the migration to prod and verify (`pg_proc`, `routine_privileges`).
2. Ship the frontend. If the RPC were missing, the slot would show its error card, not break the page.
3. Nothing else changes: no settings, no flags, no data backfill.

## 9. Not in this release

- Notifications to reviewers when leave is filed or covers are raised (nothing sends them today).
- Approve, reject or assign inside the card.
- Cards for applicants ("your leave is pending"), students, super admins and the `employee` role.
- Substitution cards for timetable-manager override holders.
- Moving check-in/out to a server RPC that stamps the time (today the device clock is used, and staff
  can update their own row; known, unchanged here).
