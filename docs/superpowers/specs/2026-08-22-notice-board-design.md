# Notice Board — design

**Date:** 2026-08-22
**Area:** Communication module (`src/pages/school/CommunicationPage.tsx`, `src/components/communication/`,
`src/hooks/useCirculars.ts`, `circulars` / `circular_acknowledgements`)

## Problem

The Communication tab ships a "Circulars" panel that is broken in three independent ways.

**1. Scope is decorative.** `circulars` stores `scope` (`institution` / `class` / `wing`) plus
`target_class_id` / `target_wing_id`, but the RLS policy ignores every one of them:

```sql
CREATE POLICY "circ_select" ON public.circulars FOR SELECT
  USING (public.get_user_institution(auth.uid()) = institution_id);
```

Any class- or wing-targeted circular is readable by **every user in the school, students included**.
The attachment bucket is worse: `circular-attachments` is a public bucket whose SELECT policy is
`USING (bucket_id = 'circular-attachments')` — no membership check at all, so any attachment is
world-readable by URL.

**2. There is no hierarchy.** `circ_insert` lets any teacher publish an institution-wide circular.
There is no way for a coordinator to address their wing, no way for a teacher to address their own
students, and no way for anyone senior to see whether a notice landed.

**3. Reach is unknowable.** `circular_acknowledgements` records only people who pressed the
Acknowledge button. There is no denominator — nothing records who was *addressed* — so
"12 acknowledged" is a number with no meaning.

Separately, `useCirculars.ts` violates four §23 rules (`select("*")`, no `staleTime`, JWT-less
`getUser()`, `toast.error(error.message)`), and `CommunicationAnalytics` fires six unbounded
`select()` calls and counts the rows client-side.

## Requirements

1. "Circulars" becomes **Notice Board** everywhere — UI, tables, feature flag, route.
2. Every role reaches it: admin, coordinator, teacher, student.
3. Issuing follows the hierarchy. Admin addresses anyone; a coordinator addresses their wings; a
   teacher addresses their own students.
4. Choosing a class drives the audience: its students receive the notice, its **wing coordinator is
   auto-added and cannot be removed**, and the author picks which of that class's teachers are
   included (default: all of them).
5. Opening a notice records a read automatically. When the author ticks *Require acknowledgement*,
   recipients additionally get an explicit Acknowledge button.
6. Reach reporting is visible to the author **and everyone above them**: a teacher sees their own
   notices, a coordinator sees every notice targeting their wings, an admin sees the whole school.

## Data model

### Rename map

| Now | After |
|---|---|
| `circulars` | `notices` |
| `circular_acknowledgements` | `notice_recipients` (rebuilt, not renamed) |
| `target_class_id`, `target_wing_id` (single) | `notice_target_classes`, `notice_target_wings` (multi) |
| `attachment_urls` jsonb (public URLs) | `attachments` jsonb `[{path,name,size,mime}]` |
| bucket `circular-attachments` (public) | bucket `notice-attachments` (private) |
| feature id `circulars` | feature id `notice_board` |

### Materialised recipients, not evaluated rules

The audience could be stored as *rules* (scope + class ids + audience roles) and evaluated at read
time by a `SECURITY DEFINER` helper. It is instead **expanded into rows at publish time**.

The deciding factor is the hot path. The notice list is loaded by every user on every visit, so its
RLS predicate runs per row per user. Rule evaluation costs several `EXISTS` lookups per notice row
(role intersection, then wing or class membership); a materialised recipient row costs one index
lookup. Publishing is the cold path, and there the fan-out is a single `INSERT ... SELECT` — for
Alliance, the largest institution on prod, a whole-school notice is ~1,500 rows in one statement.

Merging "who was addressed" and "who has read it" into **one row per (notice, person)** falls out of
that choice and pays for itself again:

- The reach denominator is `count(*)`, the numerator `count(*) FILTER (WHERE read_at IS NOT NULL)` —
  one server-side aggregate, satisfying §23 "aggregate server-side".
- "Who hasn't read it" is `WHERE read_at IS NULL`, not an anti-join against a computed audience.
- There is no insert-vs-upsert race on first open; marking read is an `UPDATE` of a row that already
  exists.

**Accepted consequence:** the audience is a snapshot. A student who joins 9-A on Wednesday does not
see Monday's 9-A notice. This is deliberate — a notice board does not deliver back-mail, and the
frozen denominator is the honest one for an audit trail ("these 1,500 people were addressed on
12 Aug"). If back-filling later joiners is ever wanted, it is a new `resync_notice_recipients` RPC,
not a change of shape.

### `notices`

Renamed in place, so all nine production rows and their ids survive. Constraints and indexes are
renamed explicitly, because PostgREST embed syntax names them (`circulars_published_by_fkey` →
`notices_published_by_fkey`).

```sql
ALTER TABLE public.circulars RENAME TO notices;

ALTER TABLE public.notices
  ADD COLUMN audience_roles           text[]  NOT NULL DEFAULT ARRAY['student']::text[],
  ADD COLUMN requires_acknowledgement boolean NOT NULL DEFAULT false,
  ADD COLUMN recipient_count          integer NOT NULL DEFAULT 0,
  ADD COLUMN attachments              jsonb   NOT NULL DEFAULT '[]'::jsonb;
```

`recipient_count` is a snapshot written by `publish_notice`, so a list row never runs a COUNT.

Legacy values are normalised before the CHECK constraints go on (counts are current prod):

| Column | Legacy | Normalised to |
|---|---|---|
| `scope` | `all` (2 rows) | `institution` |
| `priority` | `high` (1 row) | `important` |
| `type` | `announcement`, `notice` (1 row each) | `general` |

Final domains: `scope ∈ (institution, wing, class)`, `priority ∈ (normal, important, urgent)`,
`type ∈ (general, academic, event, ptm)`. `priority = 'important'` is new and replaces the `high`
value that `ImportantCircularsCard` already filtered on but no writer ever produced.

`target_class_id`, `target_wing_id` and `attachment_urls` are dropped **after** their contents are
copied into the junction tables and `attachments`.

### Target junctions

```sql
CREATE TABLE public.notice_target_classes (
  notice_id uuid NOT NULL REFERENCES public.notices(id) ON DELETE CASCADE,
  class_id  uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  PRIMARY KEY (notice_id, class_id)
);
CREATE INDEX notice_target_classes_class_id_idx ON public.notice_target_classes (class_id);
```

`notice_target_wings` is identical against `wings(id)`. The primary key indexes the `notice_id` side;
the explicit index covers the `class_id` / `wing_id` side, satisfying §23 "every new FK gets an index
in the same migration".

These exist for **display and oversight**, not delivery — delivery is `notice_recipients`. They are
what lets a card read "Class 9-A, 9-B" and what lets `notice_can_oversee` decide whether a
coordinator's wings intersect a notice.

### `notice_recipients`

```sql
CREATE TABLE public.notice_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id       uuid NOT NULL REFERENCES public.notices(id)  ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_role  text NOT NULL CHECK (recipient_role IN ('coordinator','teacher','student')),
  added_reason    text NOT NULL CHECK (added_reason IN
                    ('audience_role','class_student','class_teacher',
                     'wing_coordinator_auto','wing_member')),
  read_at         timestamptz,
  acknowledged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, user_id)
);
CREATE INDEX notice_recipients_user_id_idx    ON public.notice_recipients (user_id);
CREATE INDEX notice_recipients_unread_idx     ON public.notice_recipients (notice_id)
  WHERE read_at IS NULL;
```

`user_id` is an ownership column, so it is `ON DELETE CASCADE` per §21. The `UNIQUE (notice_id,
user_id)` index serves notice-first lookups (reach, recipient list); `notice_recipients_user_id_idx`
serves the inbox; the partial index serves "who hasn't read".

`added_reason` is not decoration — it is what renders "Added because Class 9-A is in Senior Wing" on
the locked coordinator chip, and what makes an unexpected recipient debuggable.

## Who receives what

`publish_notice` expands the audience in a single transaction.

| Scope | Expansion |
|---|---|
| `class` | students of the chosen classes · the teachers picked (default: **all** teachers of those classes) · **wing coordinators of those classes, auto-added and locked** |
| `wing` | members of the chosen wings, filtered by the ticked `audience_roles` |
| `institution` | institution members filtered by the ticked `audience_roles`; class and teacher fields do not render |

Every branch filters on `profiles.is_active` and on the author's own `institution_id`, and excludes
the author (they reach their own notice through oversight, not their inbox).

A person who qualifies twice — a coordinator who also teaches the class — collapses to one row via
`DISTINCT ON (user_id)` ordered by role priority `coordinator > teacher > student`, so their
`recipient_role` is deterministic rather than dependent on UNION ordering.

`notices.audience_roles` is author-chosen **only for `wing` and `institution` scope**. Under `class`
scope the audience is implied by the shape of the flow (students always, teachers via the picker,
coordinator forced), so the RPC writes `audience_roles` itself from what it actually expanded. It is
a record of the audience, never a second, contradictory input.

### Authority, enforced in the RPC

`SECURITY DEFINER` bypasses RLS, so `publish_notice` re-checks everything the old INSERT policy
checked and adds the scoping the old policy never had:

| Author | May target | Audience roles |
|---|---|---|
| `school_admin` / `super_school_admin` / `super_admin` | any class, wing, or whole school in their institution | coordinator, teacher, student |
| `coordinator` | only classes/wings reachable from their `wing_assignments` | coordinator, teacher, student — within those wings |
| `teacher` | only classes in their `class_assignments` where `role = 'teacher'` | **student only**, plus the forced auto coordinator |

A teacher cannot address teachers. The teacher-picker does not render for a teacher author, and the
RPC rejects a non-student `audience_roles` from one. This reads "teacher issues to their students"
literally; widening it later is a single branch in the RPC plus showing the field.

The UI mirrors these limits by only offering pickable classes, but the UI is a convenience — the RPC
is the enforcement point.

## Seen and reporting

### Marking read

```sql
mark_notice_read(_notice_id uuid, _acknowledge boolean DEFAULT false) RETURNS void
```

```sql
UPDATE public.notice_recipients
   SET read_at         = COALESCE(read_at, now()),
       acknowledged_at = CASE WHEN _acknowledge
                              THEN COALESCE(acknowledged_at, now())
                              ELSE acknowledged_at END
 WHERE notice_id = _notice_id
   AND user_id   = (SELECT auth.uid());
```

Idempotent by construction: a double-click, a retry, or a second open cannot move a timestamp that
is already set. `notice_recipients` gets **no** direct UPDATE grant, so this RPC is the only path —
nobody can stamp an acknowledgement they did not make, or edit their own `recipient_role`.

Acknowledgement is only offered when `notices.requires_acknowledgement` is true.

### Reporting RPCs

- `notice_reach(_notice_id)` → one row per `recipient_role` with `total / read_count / ack_count`.
- `notice_recipient_list(_notice_id, _status, _after_name, _after_id, _limit)` → keyset-paginated
  drill-down, `_status ∈ (all, unread, read, acknowledged)`.

Both are gated on `notice_can_oversee`. Keyset (`_after_name`, `_after_id`) rather than OFFSET, per
§23.

## RLS

Four `SECURITY DEFINER` `STABLE` helpers carry every policy — no inline cross-table `EXISTS`, per the
2026-04-26 recursion incident:

| Helper | True when |
|---|---|
| `notice_is_recipient(_notice_id, _user_id)` | a `notice_recipients` row exists |
| `notice_can_oversee(_notice_id, _user_id)` | author, or institution admin, or a coordinator whose `wing_assignments` intersect the notice's target classes/wings |
| `can_view_notice(_notice_id, _user_id)` | `notice_is_recipient` **or** `notice_can_oversee` |
| `can_publish_notices(_user_id)` | holds `school_admin` / `super_school_admin` / `coordinator` / `teacher` |

Oversight is deliberately *downward only*. A coordinator does not oversee an `institution`-scope
notice issued by the principal — it has no target classes or wings for their assignments to
intersect, so they receive it in their inbox like anyone else but get no reach report for it. Only
institution admins see reach on school-wide notices.

Policies:

| Table | Command | Predicate |
|---|---|---|
| `notices` | SELECT | `public.can_view_notice(id, (SELECT auth.uid()))` |
| `notices` | INSERT | none — writes go through `publish_notice` only |
| `notices` | UPDATE | `published_by = (SELECT auth.uid()) OR is_institution_admin(...)` — title/content/priority/expiry only; audience is immutable after publish |
| `notices` | DELETE | `is_institution_admin((SELECT auth.uid()), institution_id)` |
| `notice_recipients` | SELECT | `user_id = (SELECT auth.uid()) OR public.notice_can_oversee(notice_id, (SELECT auth.uid()))` |
| `notice_target_classes` / `_wings` | SELECT | `public.can_view_notice(notice_id, (SELECT auth.uid()))` |

Every `auth.uid()` is wrapped as `(SELECT auth.uid())` so Postgres evaluates it once per statement
rather than once per row (§23.13). Every new RPC gets `REVOKE EXECUTE ... FROM anon` **by name**,
verified afterwards against `information_schema.routine_privileges` — `REVOKE FROM PUBLIC` does not
strip the default `anon` grant.

Audience is immutable after publish because the recipient set is materialised; editing the audience
would mean re-running fan-out and reconciling reads already recorded. Wrong audience means delete and
re-issue.

## Attachments

New **private** bucket `notice-attachments`, path `{notice_id}/{uuid}-{filename}`.

The notice id is generated **client-side** so attachments can be uploaded before the notice row
exists, and `publish_notice` takes it as `_notice_id`. That also buys idempotency for free: a
double-submit finds the id already present and returns it instead of publishing twice.

```sql
-- returns NULL instead of raising when the first path segment is not a uuid
CREATE FUNCTION public.notice_id_from_path(_name text) RETURNS uuid ...
```

| Command | Predicate |
|---|---|
| INSERT | `bucket_id = 'notice-attachments' AND public.can_publish_notices((SELECT auth.uid()))` |
| SELECT | `bucket_id = 'notice-attachments' AND public.can_view_notice(public.notice_id_from_path(name), (SELECT auth.uid()))` |
| DELETE | `bucket_id = 'notice-attachments' AND public.notice_can_oversee(public.notice_id_from_path(name), (SELECT auth.uid()))` |

`can_view_notice(NULL, …)` is false, so a malformed path denies rather than errors. Clients read
through `createSignedUrl(path, 300)`; no public URL is ever minted. `attachments` stores paths, not
URLs — a stored public URL is what made the old bucket unfixable without a data migration.

### Legacy attachments

`attachment_urls` has a **dual shape** in production: an `array` of public URLs on one row, and an
empty `object` (`{}`) on the two seed rows. Any backfill must guard with
`jsonb_typeof(attachment_urls) = 'array'` before iterating — treating `{}` as an array raises and
aborts the migration.

Exactly one real attachment exists, on a test notice titled "ewj", and its physical file lives in the
old public bucket. Moving bytes between buckets needs the Storage API, not a `storage.objects` row
update — a row update desyncs the record from the file. Rather than run that dance for one junk file,
the entry is preserved as `{"legacy_url": "...", "name": "..."}` and `NoticeDetail` renders any entry
carrying `legacy_url` as a plain anchor instead of minting a signed URL. New attachments only ever use
the `{path,...}` shape. Once someone confirms "ewj" is disposable, that row and the old bucket can be
deleted and the legacy branch removed with them.

## Read RPCs

Both feeds are single keyset-paginated RPCs rather than PostgREST embeds, so a list never N+1s to
fetch per-notice read state or reach.

- `notice_inbox(_before_published_at, _before_id, _limit)` — notices addressed to me, each with my
  `read_at` / `acknowledged_at`, ordered `published_at DESC, id DESC`. Filters out future
  `published_at` and past `expires_at`. Scheduling is **not** offered in the composer — a notice
  publishes immediately — but the future-dated guard stays because `published_at` is writable and
  `ImportantCircularsCard` already defends against it today.
- `notice_outbox(_before_published_at, _before_id, _limit)` — notices I can oversee, each with
  `recipient_count / read_count / ack_count` aggregated server-side.
- `notice_audience_preview(_scope, _class_ids, _wing_ids, _audience_roles, _teacher_ids)` — per-role
  counts for the composer's live "Reaches 84 students · 12 teachers · 1 coordinator" line. Same
  expansion logic as `publish_notice`, counting instead of inserting.
- `communication_overview(_institution_id)` — replaces the six unbounded client-side selects in
  `CommunicationAnalytics` with one server-side aggregate.

`publish_notice`, `notice_audience_preview` and the fan-out inside them share one SQL expansion
expression. It is written once as a set-returning helper, `notice_expand_audience(...)`, and called
by both — the preview must not be able to disagree with what publishing actually does.

## Frontend

`src/hooks/useCirculars.ts` is deleted rather than patched — every line of it violates §23.

**New** `src/hooks/notices/`: `useNoticeInbox`, `useNoticeOutbox` (both `useInfiniteQuery`),
`usePublishNotice`, `useMarkNoticeRead`, `useNoticeReach`, `useNoticeRecipients`,
`useNoticeAudiencePreview`, `useNoticeTargetOptions` (the classes / wings / teachers this author may
pick), plus `index.ts`.

**New** `src/components/notices/`:

| Component | Role |
|---|---|
| `NoticeBoard` | `MobileTabs` — Received · Issued (Issued hidden for students), `MobileFab` "New notice" |
| `NoticeList` | infinite `ListRow` list, `EmptyState` when empty, error state **before** empty state (§6) |
| `NoticeDetail` | `MobileSheet` — content, signed-URL attachments, Acknowledge button, reach panel for overseers |
| `NoticeComposer` | `MobileSheet` — the whole create flow |
| `NoticeAudienceFields` | scope selector, class multi-select, locked auto-coordinator chips, teacher multi-select, audience-role checkboxes |
| `NoticeReachPanel` | `StatTile` per role plus the unread drill-down |
| `NoticeRecipientList` | keyset-paginated recipients with read / acknowledged state |

Composer fields, in order: Title · Content · Type · Priority · Scope · (Class multi-select → locked
coordinator chips → teacher multi-select) *or* (Wing multi-select + audience roles) *or* (audience
roles) · Require acknowledgement · Expires at · Attachments · live audience preview.

The teacher multi-select defaults to "All teachers (N)" with a radio flip to a checkbox list showing
each teacher's subject. The audience preview is debounced 300 ms and has an explicit `staleTime`.

Design-system compliance: `PageShell` (never `AppLayout`), `MobileSheet` (never `Dialog` — the
project's `DialogContent` ScrollArea fork), `MobileTabs` (never shadcn `Tabs`), `ListRow`,
`EmptyState`, `StatTile`, `text-ink-*` only, `surface-card frosted-shadow rounded-card`, works at
375 px, dark mode flips, `toastError` on every `onError`, `data-dirty="true"` on the composer form so
a service-worker update cannot discard a half-written notice.

### Surfacing

`CommunicationPage`'s tab becomes **Notice Board** (`value="notices"`) and renders `<NoticeBoard />`.
A dedicated route `/school/notices` renders `NoticeBoardPage`, which wraps the same component — one
implementation, two entry points.

| File | Change |
|---|---|
| `App.tsx` | lazy route `/school/notices`, roles: admin, super_school_admin, coordinator, teacher, student, super_admin |
| `featuresData.ts` | feature id `circulars` → `notice_board`, name "Notice Board"; `FEATURE_URL_MAP` gains `/school/notices` → `notice_board` |
| `AppSidebar.tsx` | "Notice Board" item in the admin, coordinator and teacher **Operations/Academics** groups; student group "Diary & Circulars" → "Diary & Notices" with a "Notice Board" item; matching `GROUP_ICONS` key |
| `ImportantCircularsCard` | → `ImportantNoticesCard`, backed by `useNoticeInbox` (priority filter server-side; the old client-side `.filter().slice()` chain goes). Its gate in `ComprehensiveStudentDashboard` moves from `communication` to `notice_board` — the card is a notice surface, and a school can now run one without the other |
| `RoleBasedDashboard`, `SchoolAdminCommandCenter` | tile description "Messaging, circulars & PTM" → "Messaging, notices & PTM" |
| `CommunicationAnalytics` | six client-side selects → `communication_overview` RPC |

Feature gating stays in sync across all three layers — `FEATURE_URL_MAP` feeds `ProtectedRoute`,
`AppSidebar.filterItemsByFeature` and `NavigationHub` (ui-invariants §2). The renamed sidebar group
needs its `GROUP_ICONS` entry or the collapsible parent row falls back to a generic icon
(ui-invariants §2a).

**Not touched:** Messaging, PTM, Templates, Bulk Send, Communication Settings.

## Migration

Production holds 9 notices, 3 acknowledgements, 1 attachment object and 12 `institution_features`
rows — small enough that the migration is exact rather than best-effort.

1. Rename `circulars` → `notices`; rename its constraints, indexes and trigger to match.
2. Normalise legacy `scope` / `priority` / `type` values, then add the CHECK constraints.
3. Add the new `notices` columns; create `notice_target_classes`, `notice_target_wings`,
   `notice_recipients` with their indexes.
4. Copy `target_class_id` / `target_wing_id` into the junctions; drop both columns.
5. Backfill `notice_recipients` for all 9 notices by expanding each row's original scope, then merge
   the 3 acknowledgements in as `read_at = acknowledged_at = circular_acknowledgements.acknowledged_at`.
   Set `recipient_count` from the result. Drop `circular_acknowledgements`.
6. Create the helpers, the RPCs, the policies; `REVOKE ... FROM anon` by name and verify against
   `information_schema.routine_privileges`.
7. Create the private `notice-attachments` bucket and its three policies. Convert `attachment_urls`
   to `attachments`, guarding on `jsonb_typeof(...) = 'array'`; the one real entry becomes a
   `legacy_url` record (see *Legacy attachments*). `circular-attachments` stays in place as a
   deprecated public shell so that one file keeps resolving.
8. `UPDATE institution_features SET feature_id = 'notice_board' WHERE feature_id = 'circulars'`
   (12 rows).
9. Regenerate `src/integrations/supabase/types.ts` from prod.

The migration ledger `supabase_migrations.schema_migrations` is not maintained on this project, so
the migration is applied through the Management API (`scripts/run-sql.ps1`) and verified against
`pg_proc` / `information_schema` — never `supabase db push` blind.

## Verification

Per role, at 375 px and in dark mode:

| Check | Expected |
|---|---|
| Teacher publishes to their class | students + auto coordinator receive it; no teachers unless the author is admin/coordinator; teacher cannot select a class they do not teach |
| Coordinator publishes to their wing | wing teachers + students receive it; classes outside their wings are not selectable and are rejected by the RPC |
| Admin publishes school-wide | all ticked roles receive it |
| Student opens a notice | `read_at` stamps once; a second open does not change it |
| Acknowledge required | button appears only then; double-click does not double-stamp |
| **Scope leak (the original bug)** | a student in 9-A cannot read a 9-B notice by id, and cannot fetch its attachment |
| Attachment | resolves only through a signed URL; the raw storage path 403s for a non-recipient |
| Reach rollup | teacher sees own only · coordinator sees own + wing · admin sees all |
| Feature flag off | route blocked, sidebar item hidden, dashboard tile hidden |

Gate before completion: `npm run typecheck` exit 0, `npx eslint <touched paths>` clean,
`npx vite build` exit 0, and the §23 Scale Gate walked item by item.
