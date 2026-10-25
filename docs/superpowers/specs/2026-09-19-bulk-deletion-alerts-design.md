# Bulk deletion alerts

Status: design approved 2026-09-19. Emails the platform owner when someone deletes a
lot of things, or deletes one very important thing.

## Why

On 2026-09-19 a school admin deleted 275 student accounts in 35 minutes. Nobody was
told; it was found only because someone happened to run a usage query that day. The
same blind spot has cost us before:

| Date | What happened | How we found out |
|---|---|---|
| 2026-08-07 | Two Alliance teachers' `class_assignments` wiped, portals went blank | The teachers complained |
| 2026-09-02 | Demo cleanup deleted the SALCI Support container plus four real-looking schools | Support intake was dead for 7 days |
| 2026-09-19 | 275 Vidyabodhini student accounts deleted | Accidental discovery |

Every one was a destructive bulk action by a legitimate, authorised user. This is not
an access-control problem, so no permission change fixes it. It is a **visibility**
problem: nothing watches the audit log.

## Scope

In: detect and email. Out: blocking, rate-limiting, undo. Those are separate decisions
and none of them help if nobody knows the deletion happened.

## Detection

Three rules. All read existing ledgers; none sit on the delete path, so an alert can
never slow or abort a deletion.

### Rule `burst` - threshold 10 in 10 minutes

Ten or more deletions of watched objects by one actor inside a rolling 10-minute window.

Watched `system_audit_logs.entity_type` values:

`user`, `institution`, `Class`, `Class section`, `Subject`, `Subject mapping`, `Exam`, `Wing`

Deliberately NOT watched: `Chapter`, `Study material`, `Question`, `Task`, `Homework`,
`Notice`, `Diary entry`, `Holiday`, `Fee category`, `Fee structure`, `Exam template`,
`Optional group`, `Shared resource`, `Substitution`, `Teacher target`,
`Teacher target period`, `Employee level`, `Wing coordinator`, `Wing class`. These are
routine content work. Chapters alone saw 257 deletions by 28 people in 90 days;
including them would bury the signal.

**`Role` is excluded from the count** and this is load-bearing. `role_deleted` rows are
a cascade side effect of deleting a user, they always carry `actor_id = NULL`, and they
arrive one-per-user. Counting them would double every account deletion and, worse,
collapse every unrelated NULL-actor event into a single bucket. `Role` rows are still
read by the `sensitive` rule, which looks at which role was lost.

### Rule `roster` - threshold 25 in 10 minutes

Twenty-five or more rows removed from `class_assignment_deletions` by one actor in
10 minutes. This is the 2026-08-07 failure: removing a teacher's class and subject rows
blanks their entire portal with no other trace.

It gets its own higher threshold because its baseline is genuinely busier. Saving a
staff-assignment screen legitimately diffs and removes rows, giving 992 events across
90 days. At 25 the rule would have fired 5 times in that period; the largest real burst
was 568 rows touching 423 teachers at once.

### Rule `sensitive` - threshold 1

One is enough. Fires on either:

- an `institution` deletion, or
- a `Role` deletion whose `old_values->>'role'` is `school_admin`,
  `super_school_admin` or `super_admin`

A single institution deletion is what broke Support for a week. These are rare enough
that a threshold of one creates no noise.

## Incidents, not events

A naive implementation emails once per pass and floods the inbox. Instead each breach
opens an **incident**, keyed on rule plus actor:

1. Every pass first closes incidents with no activity for 60 minutes.
2. For each rule, find actors over threshold in the last 10 minutes.
3. If an open incident exists for that rule and actor, extend it: recompute
   `event_count` from `first_event_at` to now, refresh `last_event_at`, merge
   entity types and sample names. Do not email again.
4. Otherwise open a new incident, which will be emailed.
5. Return incidents where `notified_at IS NULL`.

So one continuous deletion spree produces exactly one email. If the same person is
still deleting more than an hour later, the old incident has closed and a new one opens,
producing a second email. That is correct: it means it is still going.

## Components

**Table `deletion_alert_incidents`** - dedup key and permanent incident record.
`actor_key` is `coalesce(actor_id, '00000000-...')` stored as a plain column so the
partial unique index works for NULL actors (system and cron deletions). Unique on
`(rule, actor_key) WHERE closed_at IS NULL`. Read restricted to super admins,
`REVOKE`d from `anon`.

**RPC `sec_scan_deletion_alerts()`** - SECURITY DEFINER. All detection and incident
bookkeeping, returns only incidents needing an email. `REVOKE`d from `PUBLIC` and
`anon` by name (CLAUDE.md section 26).

**Edge function `deletion-alert-pass`** - calls the RPC, sends one Resend email per
incident, stamps `notified_at`. Recipients from secret `ALERT_EMAIL_TO`, comma
separated, defaulting to `tushar@salci.in` so adding people needs no deploy.

**Cron, every 5 minutes** - `net.http_post` to the edge function, matching
`homework-notify-pass-15min`. Worst case from first breach to email is about 5 minutes.
On the 19 September event that is roughly 40 accounts gone instead of 275.

## Failure behaviour

If Resend fails, `notified_at` stays NULL, the error is recorded in `notify_error`, and
the next pass retries. No alert is lost to a transient outage.

If the RPC throws, the cron pass fails and the next one picks up the same window; the
incident table is the only state and it is idempotent.

Detection never writes to the tables it watches.

## The email

Subject names the severity, the actor and the count. Body gives the person, their
school, what kind of objects and how many, the time window, up to ten sample names, and
a link to the activity log filtered to that actor.

## Known gaps

- Slow drips evade every threshold. Deleting 9 accounts every 10 minutes for a day is
  invisible. Accepted for v1; a daily total rule would close it.
- `institutions` has no audit trigger, so institution deletions are seen only via the
  `institution_deleted` row that `admin-operations` writes. A deletion by some other
  path would be missed.
- Alerting only. Nothing here prevents or reverses a deletion.

## Verification

Replay the three historical windows through the detection logic and assert each opens
exactly one incident: 2026-09-19 10:50 (275 accounts), 2026-09-02 17:12 (27
institutions), 2026-09-04 12:20 (81 subjects). Assert a normal day of chapter deletions
opens none.
