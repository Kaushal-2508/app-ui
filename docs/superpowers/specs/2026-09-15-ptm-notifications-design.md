# PTM Notifications (in-app) — Design

**Date:** 2026-09-15
**Status:** Approved, ready for implementation plan
**Scope:** In-app notifications only. Web push is explicitly OUT (see "Deliberately excluded").

## Problem

`ptm_schedules` / `ptm_bookings` exist and work, but **nothing in the PTM flow
writes a `notifications` row**. An admin schedules a Parent-Teacher Meeting and
no teacher or student is told; a student books a slot and the teacher finds out
only by opening the PTM tab. The bell never mentions PTM at all.

## Deliberately excluded: web push

The platform already has a complete, working web-push stack that PTM does not
use: `push_subscriptions`, the `send-web-push` edge function (VAPID, Bearer
`WEBHOOK_SECRET`, dead-endpoint cleanup on 404/410), `public/sw.js` `push` +
`notificationclick` handlers, and subscribe/unsubscribe UI in `SettingsPage`.

Wiring PTM into it would be a handful of `fetch` calls copied from
`homework-notify-pass`. **This was considered and rejected by the requester:
in-app only.** Do not add `send-web-push` calls to anything in this design.
If push is ever wanted for PTM, the hook point is the same three trigger
functions, and it becomes an edge-function job (a trigger must not make
outbound HTTP calls on the writer's transaction).

## Audience rules (decided)

| PTM shape | Students notified | Teachers notified |
|---|---|---|
| `class_id` set | students of that class | **every teacher assigned to that class** |
| `class_id` NULL (school-wide) | `institution_student_ids(institution_id)` | every teacher of that institution |

"Teacher assigned to that class" = distinct `class_assignments.user_id` where
`class_id = ptm.class_id AND role = 'teacher'`. A teacher has one row per
subject they teach in the class, so the DISTINCT matters.

**The actor is always excluded.** The admin who creates, reschedules or cancels
a PTM is not notified about their own action, and neither is the student who
books a slot. This matters because of the dual-role case (§25): an admin may
also teach, so an admin who teaches the class would otherwise land in their own
audience. Exclude `auth.uid()` from the recipient set in every trigger, and fall
back to `created_by` when `auth.uid()` is NULL (a service-role or script write).

School-wide fanout at Alliance is roughly 1,400 student rows + 80 teacher rows.
That is one `INSERT ... SELECT` statement, not a loop, and it is the literal
meaning of "notify the students".

## Events

| Event | Type | Recipients | Mechanism |
|---|---|---|---|
| PTM scheduled | `ptm_scheduled` | full audience | AFTER INSERT trigger |
| PTM cancelled | `ptm_cancelled` | full audience | AFTER UPDATE trigger |
| PTM rescheduled | `ptm_rescheduled` | full audience | AFTER UPDATE trigger |
| Slot booked | `ptm_slot_booked` | the booked teacher only | AFTER INSERT trigger |
| Day-before reminder | `ptm_reminder` | students in scope + teachers **with a booking** | pg_cron, hourly |

All five link to `/school/communication?tab=ptm`, a deep link the page already
honours (`tabs.some(t => t.value === tabParam)` in `CommunicationPage`, and the
PTM tab is pushed for every role that can reach the page).

## Why triggers and not client code

The PTM create path is a plain client `INSERT` from `usePTM.ts`. Fanning out
from the client would mean a loop writing N notification rows (a direct §23
violation), and any future writer — a bulk import, an admin script, a second
UI — would silently skip notifications.

The notification is a property of the row change, so it belongs on the row.
This also matches where the repo already went on 2026-09-14, when audit capture
moved from client calls to `tg_audit_row` triggers on 24 tables.

**Every trigger body is wrapped in `BEGIN ... EXCEPTION WHEN OTHERS THEN NULL`.**
A failure to notify must never abort the PTM write itself. This is the same
guard the audit triggers use, and it is not optional: a PTM that cannot be
created because a notification insert hit a constraint is a worse bug than a
missing notification.

## Database objects

### 1. `ptm_notifications_sent` (idempotency)

Mirrors `homework_notifications_sent`:

```
ptm_id            uuid NOT NULL REFERENCES ptm_schedules(id) ON DELETE CASCADE
recipient_id      uuid NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE
notification_type text NOT NULL
sent_at           timestamptz NOT NULL DEFAULT now()
UNIQUE (ptm_id, recipient_id, notification_type)
```

Plus an index on `recipient_id` (§23: every new FK gets an index in the same
migration; the UNIQUE covers `ptm_id` as its leading column, but
`recipient_id` needs its own).

Strictly only the cron needs this, but **every** writer claims through it, so a
reschedule, a re-run, or a double-click cannot double-notify. Writers use
`INSERT ... ON CONFLICT DO NOTHING ... RETURNING recipient_id` and notify only
the rows that were actually claimed — the same claim-then-notify shape as
`homework-notify-pass`, which makes the whole path idempotent (§23.5).

Note `ptm_rescheduled` is intentionally re-notifiable: the claim key includes
the type, and a second genuine reschedule should notify again. The plan must
delete the prior `ptm_rescheduled` claims for that PTM as part of the same
statement, or the second reschedule goes silent. **This is the single easiest
thing to get wrong in this design.**

### 2. `ptm_audience(_ptm_id uuid)`

`RETURNS TABLE (user_id uuid, is_teacher boolean)`, `STABLE`, `SECURITY
DEFINER`, `SET search_path TO 'public', 'pg_temp'`.

Resolves the table in "Audience rules" above. Called by all three triggers and
by the cron, so the rule lives in exactly one place.

`REVOKE ALL ... FROM PUBLIC` **and** `REVOKE ALL ... FROM anon` **by name**
(§26: Supabase default privileges grant EXECUTE to `anon`, and `REVOKE FROM
PUBLIC` does not strip it). Verify with `information_schema.routine_privileges`,
not by assumption.

### 3. The three triggers

| Name | Timing | Guard |
|---|---|---|
| `tg_ptm_notify_scheduled` | AFTER INSERT ON `ptm_schedules` | none (every new PTM notifies) |
| `tg_ptm_notify_changed` | AFTER UPDATE ON `ptm_schedules` | see below |
| `tg_ptm_notify_booking` | AFTER INSERT ON `ptm_bookings` | none |

`tg_ptm_notify_changed` fires only on a real change:

- `NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'`
  → `ptm_cancelled`
- otherwise, if any of `scheduled_date` / `start_time` / `end_time`
  `IS DISTINCT FROM` its OLD value → `ptm_rescheduled`

Editing a title or description notifies nobody. `status` is free TEXT with no
CHECK constraint, so compare against the literal `'cancelled'` the UI writes.

Copy (no em-dashes, per the repo-wide rule — ranges use "to"):

| Type | Title | Message |
|---|---|---|
| `ptm_scheduled` | PTM scheduled | `"<title>" on 20 Sep 2026, 10:00 to 13:00.` (+ ` for <class>` when scoped) |
| `ptm_rescheduled` | PTM rescheduled | `"<title>" has moved to 22 Sep 2026, 10:00 to 13:00.` |
| `ptm_cancelled` | PTM cancelled | `"<title>" on 20 Sep 2026 has been cancelled.` |
| `ptm_slot_booked` | PTM slot booked | `<Student name> booked 10:30 for "<title>".` |
| `ptm_reminder` | PTM tomorrow | `"<title>" is tomorrow, 10:00 to 13:00.` |

Dates via `to_char(scheduled_date, 'DD Mon YYYY')`, times via
`to_char(start_time, 'HH24:MI')`. `metadata` carries `{"ptm_id": "<uuid>"}` on
every row so a future surface can deep-link to the specific PTM.

### 4. `ptm_send_day_before_reminders()` + pg_cron

`SECURITY DEFINER`, returns the number of rows written (for log triage).

**§24 is the trap in this function.** "Tomorrow" is per institution:

```sql
JOIN public.institutions i ON i.id = ps.institution_id
WHERE ps.status = 'scheduled'
  AND ps.scheduled_date
      = (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date + 1
```

A bare `CURRENT_DATE` or `AT TIME ZONE 'UTC'` here re-introduces the 2026-05-25
bug that left attendance auto-mark dead for every IST school until 13:30 IST.
Copy the `dash_*` idiom exactly.

Recipients: students in scope (full audience minus teachers), plus **only those
teachers who actually have a booking** for that PTM. A teacher nobody booked
does not need a reminder.

Scheduled hourly, not daily, because the idempotency table makes re-runs free
and an hourly job crossing every institution's local evening is simpler than
per-timezone scheduling. Unlike the homework cron, this needs **no edge function
and no `net.http_post`** — with push out of scope the work never leaves the
database, so `cron.schedule` calls the SQL function directly.

Follow the `do $$ ... perform cron.unschedule(...) ... exception when others
then null; end; $$;` preamble from `20260601095000_homework_notify_cron.sql` so
the migration is re-runnable.

## Frontend

### 1. `NotificationPanel.tsx` — five `TYPE_VISUALS` entries

```
ptm_scheduled   -> CalendarClock, "teal"
ptm_reminder    -> BellRing,      "peach"
ptm_slot_booked -> CalendarCheck, "sky"
ptm_cancelled   -> CalendarX,     "rose"
ptm_rescheduled -> RefreshCw,     "peach"
```

All five icons are already imported in that file. Without these the rows still
render (there is a `FALLBACK_VISUAL` bell), so this is polish, not function.

### 2. Cancel / reschedule UI in `PTMSchedulePanel.tsx` (admin only)

`ptm_cancelled` and `ptm_rescheduled` cannot fire today because the panel has
no way to update a PTM. This is the only genuinely new surface in the design:

- An action on each PTM card, admin-only (`roleInfo?.isSchoolAdmin`), opening a
  `MobileSheet` (§20: sheets, not Dialog) with date / start / end.
- A "Cancel PTM" action that **confirms first and names what it does**, including
  that everyone will be told (§9a: any save that removes or invalidates existing
  rows must confirm first, naming what it will remove).
- Both go through `useMutation` + `toastError` (§19), single-flight via
  `isPending` (§23.5).

The existing `ptm_update` RLS policy is `USING (is_institution_admin(...))` with
no `WITH CHECK`. Postgres falls back to USING for the check, so this is not
broken today, but this change makes it the first real UPDATE writer: add the
explicit `WITH CHECK` (§26) rather than relying on the fallback.

### 3. Bounded cleanup of the files being touched (§5a)

`usePTM.ts` and `PTMSchedulePanel.tsx` are MVP-grade and violate standing
contracts. Since both are being edited, §5a makes them in scope — but **only
these specific fixes, not a module rewrite**:

- `toast.error("...: " + error.message)` → `toastError(err, { fallback, context })` (§19)
- `select("*")` → explicit column lists (§23.4)
- add `staleTime` to all three `useQuery` calls (§23.3)
- render an **error state before the empty state** (§6 — the single most common
  defect in this repo; the panel currently shows "No PTM schedules yet" when the
  query fails)
- replace `(ptm: any)` / `(b: any)` with real row types (§5a: `any` is a hard error)

Explicitly NOT in scope: redesigning the panel, adding pagination to the PTM
list, or touching booking/feedback flows.

## Testing

Because triggers are the mechanism, most verification is SQL against a scratch
institution, run through `scripts/run-sql.ps1` (§26 — the migration ledger is
not maintained; verify against `pg_proc` / `pg_indexes` / `information_schema`):

1. **Class-scoped insert** — create a PTM for one class, assert one notification
   row per distinct student and per distinct teacher of that class, and zero for
   a teacher of a different class.
2. **Teacher de-duplication** — a teacher teaching 3 subjects in the class gets
   exactly 1 row, not 3. This is the DISTINCT that the `class_assignments`
   one-row-per-subject shape makes easy to miss.
3. **School-wide insert** — count matches `institution_student_ids()` exactly.
4. **Reschedule twice** — both changes notify (the claim-delete above).
5. **Description-only edit** — notifies nobody.
6. **Cancel** — full audience, once; a second UPDATE to `cancelled` is silent.
7. **Booking** — exactly one row, to `teacher_id` only.
8. **Reminder cron with a non-IST institution** — set `institutions.timezone` to
   something far from UTC and assert the PTM is picked up on the institution's
   local "tomorrow", not UTC's. This is the §24 regression test.
9. **Trigger resilience** — force a failure inside the notify path and assert the
   `ptm_schedules` INSERT still commits.
10. **Anon cannot execute** `ptm_audience` or the reminder function
    (`information_schema.routine_privileges`).

Frontend: §5a gate (`npm run typecheck`, `npx eslint <changed>`, `npx vite build`),
plus the bell rendering each of the five types at 375px and in dark mode (§20).

## Risks

- **The reschedule claim-delete.** Get it wrong and reschedules notify once, ever.
  Called out again here because it is the one silent failure in the design.
- **Notification volume.** A school-wide PTM writes ~1,500 rows. That is intended,
  but if an admin creates and cancels repeatedly it is 1,500 rows each time. The
  idempotency table bounds duplicates per type, not per event count.
- **`parent_id` is really the student.** `ptm_bookings.parent_id` holds the
  booking student's `profiles.id` (SALCI has no parent role; students book).
  The booking message must render the student's name and must not say "parent".
