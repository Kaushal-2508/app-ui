# PTM Notifications (in-app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every PTM event (scheduled, rescheduled, cancelled, slot booked, day-before reminder) write an in-app `notifications` row to the right teachers and students, so the bell actually surfaces PTM.

**Architecture:** The fanout lives in the database as AFTER triggers on `ptm_schedules` / `ptm_bookings` plus one hourly pg_cron pass, all sharing a single audience resolver (`ptm_audience`) and a single claim-then-write helper (`_ptm_fanout`). No client-side fanout loop, and no edge function: with web push out of scope the work never leaves Postgres.

**Tech Stack:** Postgres (Supabase project `gyymkgohcijeksmrzuyw`), pg_cron, React 18 + TypeScript, TanStack Query v5, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-15-ptm-notifications-design.md` — read it before Task 1. The plan argues from it; where they disagree, the spec wins.

**Branch:** `ptm-notifications` (already created, spec committed as `1e4079cb`).

## Global Constraints

- **Web push is OUT.** Never add a `send-web-push` call, a `push_subscriptions` read, or a `public/sw.js` edit anywhere in this plan. In-app only, by explicit request.
- **No em-dashes in user-facing text.** Notification titles/messages, toasts, button labels, confirm copy. Ranges use " to ". (Code comments and .md docs are exempt.)
- **Every trigger body is exception-wrapped.** `EXCEPTION WHEN OTHERS THEN RETURN NULL;` — a notification failure must never abort the PTM write.
- **Every new function:** `SECURITY DEFINER`, `SET search_path TO 'public', 'pg_temp'`, and `REVOKE ALL ... FROM PUBLIC` **and** `FROM anon` **by name** (CLAUDE.md §26: Supabase grants EXECUTE to `anon` by default and `REVOKE FROM PUBLIC` does not strip it).
- **Institution-local time only.** `(now() AT TIME ZONE COALESCE(i.timezone,'Asia/Kolkata'))::date`. A bare `CURRENT_DATE` / `now()::date` / `AT TIME ZONE 'UTC'` is a §24 regression.
- **Notification link** is always `/school/communication?tab=ptm`; **metadata** is always `{"ptm_id": "<uuid>"}`.
- **`ptm_bookings.parent_id` holds the STUDENT's `profiles.id`.** SALCI has no parent role. Never render the word "parent" from it.
- **§5a gate before every frontend commit:** `npm run typecheck`, `npx eslint <changed files>`, `npx vite build`. `prefer-const` and `no-explicit-any` are hard errors: never `as any`, never `: any`, never `eslint-disable`.

## What "test" means in this repo

**There is no test runner.** No vitest/jest/playwright config, no `test` script in `package.json`. Do not scaffold one; that is out of scope. Verification is:

- **Database tasks (1 to 3):** a real red/green cycle. Write a `.sql` assertion script that FAILS before the migration (missing relation/function) and PASSES after. Run both through `powershell -File scripts/run-sql.ps1 -SqlFile <path>` (CLAUDE.md §26: the migration ledger is NOT maintained; assert against `pg_proc` / `pg_indexes` / `information_schema`, never against `supabase_migrations.schema_migrations`). Assertions use `DO $$ BEGIN IF NOT (...) THEN RAISE EXCEPTION '...'; END IF; END $$;` so a failure is a non-zero result, not a row you have to eyeball.
- **Frontend tasks (4 to 6):** the §5a gate above, plus manual verification at 375px and in dark mode (§20).
- **Never** apply a migration with `supabase db push`. Tushar applies prod SQL through `scripts/run-sql.ps1`.

Put scratch SQL in `scripts/ptm-notifications/` so it is reviewable and re-runnable.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260915100000_ptm_notifications_foundation.sql` | `ptm_notifications_sent` table, `ptm_audience()`, `_ptm_fanout()`, `ptm_update` RLS `WITH CHECK` |
| `supabase/migrations/20260915100100_ptm_notification_triggers.sql` | the three trigger functions + triggers |
| `supabase/migrations/20260915100200_ptm_reminder_cron.sql` | `ptm_send_day_before_reminders()` + `cron.schedule` |
| `scripts/ptm-notifications/verify-*.sql` | the assertion scripts for each DB task |
| `src/components/layout/NotificationPanel.tsx` | 5 new `TYPE_VISUALS` entries (modify) |
| `src/hooks/usePTM.ts` | hardened hooks + a new update/cancel mutation (modify) |
| `src/components/communication/PTMSchedulePanel.tsx` | error state, real types, cancel/reschedule UI (modify) |

---

### Task 1: Foundation (table, audience resolver, fanout helper, RLS fix)

**Files:**
- Create: `supabase/migrations/20260915100000_ptm_notifications_foundation.sql`
- Create: `scripts/ptm-notifications/verify-01-foundation.sql`

**Interfaces:**
- Consumes: nothing (first task).
- Produces, relied on by Tasks 2 and 3:
  - `public.ptm_audience(_ptm_id uuid) RETURNS TABLE (user_id uuid, is_teacher boolean)`
  - `public._ptm_fanout(_ptm_id uuid, _type text, _title text, _message text, _recipients uuid[]) RETURNS integer`
  - table `public.ptm_notifications_sent (id, ptm_id, recipient_id, notification_type, sent_at)` with `UNIQUE (ptm_id, recipient_id, notification_type)`

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/ptm-notifications/verify-01-foundation.sql`:

```sql
DO $$
BEGIN
  IF to_regclass('public.ptm_notifications_sent') IS NULL THEN
    RAISE EXCEPTION 'FAIL: table ptm_notifications_sent is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='ptm_audience') THEN
    RAISE EXCEPTION 'FAIL: function ptm_audience is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='_ptm_fanout') THEN
    RAISE EXCEPTION 'FAIL: function _ptm_fanout is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname='public' AND tablename='ptm_notifications_sent'
                    AND indexdef ILIKE '%(recipient_id)%') THEN
    RAISE EXCEPTION 'FAIL: recipient_id index is missing (CLAUDE.md 23: every new FK gets an index)';
  END IF;
  -- anon must not be able to execute any of the new functions
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND grantee='anon'
                AND routine_name IN ('ptm_audience','_ptm_fanout')) THEN
    RAISE EXCEPTION 'FAIL: anon still holds EXECUTE (CLAUDE.md 26)';
  END IF;
  -- the UPDATE policy must now carry an explicit WITH CHECK
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='ptm_schedules'
                    AND policyname='ptm_update' AND with_check IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: ptm_update has no WITH CHECK (CLAUDE.md 26)';
  END IF;
  RAISE NOTICE 'PASS: foundation objects present and locked down';
END $$;
```

- [ ] **Step 2: Run it and confirm it FAILS**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/ptm-notifications/verify-01-foundation.sql
```

Expected: `FAIL: table ptm_notifications_sent is missing`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915100000_ptm_notifications_foundation.sql`:

```sql
-- =====================================================================
-- PTM notifications, part 1 of 3: the shared foundation.
-- Spec: docs/superpowers/specs/2026-09-15-ptm-notifications-design.md
-- In-app only. Deliberately no web push: see the spec's "Deliberately
-- excluded" section before adding any outbound call here.
-- =====================================================================

-- ── Idempotency ledger ───────────────────────────────────────────────
-- Mirrors homework_notifications_sent. Every writer claims through this
-- table, so a re-run, a double-click or a repeated cron pass is a no-op.
CREATE TABLE IF NOT EXISTS public.ptm_notifications_sent (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ptm_id            uuid NOT NULL REFERENCES public.ptm_schedules(id) ON DELETE CASCADE,
  recipient_id      uuid NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  notification_type text NOT NULL,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ptm_notifications_sent_uniq UNIQUE (ptm_id, recipient_id, notification_type)
);

-- The UNIQUE already covers ptm_id as its leading column; recipient_id
-- needs its own so a profile delete cascade does not seq-scan.
CREATE INDEX IF NOT EXISTS idx_ptm_notifications_sent_recipient
  ON public.ptm_notifications_sent(recipient_id);

-- RLS on with NO policies: deny-by-default. Only the SECURITY DEFINER
-- functions below ever touch this table; no client reads it.
ALTER TABLE public.ptm_notifications_sent ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ptm_notifications_sent IS
  'Claim ledger for PTM notifications. Writers INSERT ... ON CONFLICT DO NOTHING RETURNING, then notify only what they actually claimed. ptm_rescheduled rows are deleted by the update trigger before re-claiming so a SECOND reschedule still notifies.';
```

- [ ] **Step 4: Append the audience resolver to the same migration**

```sql
-- ── Audience resolver ────────────────────────────────────────────────
-- THE definition of "who cares about this PTM". Called by all three
-- triggers and the reminder cron, so the rule lives in exactly one place.
--   class-scoped -> students + teachers of that one class
--   school-wide  -> institution_student_ids() + every teacher of the school
-- A teacher has one class_assignments row PER SUBJECT they teach in the
-- class, so the DISTINCT is load-bearing: without it a teacher of three
-- subjects gets three notifications.
CREATE OR REPLACE FUNCTION public.ptm_audience(_ptm_id uuid)
RETURNS TABLE (user_id uuid, is_teacher boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH ptm AS (
    SELECT id, institution_id, class_id
      FROM public.ptm_schedules
     WHERE id = _ptm_id
  )
  SELECT DISTINCT ca.user_id, (ca.role = 'teacher') AS is_teacher
    FROM ptm
    JOIN public.class_assignments ca ON ca.class_id = ptm.class_id
    JOIN public.profiles p           ON p.id = ca.user_id
   WHERE ptm.class_id IS NOT NULL
     AND ca.role IN ('teacher', 'student')
     AND p.is_active IS NOT FALSE

  UNION

  SELECT s.student_id, false
    FROM ptm
   CROSS JOIN LATERAL public.institution_student_ids(ptm.institution_id) s
   WHERE ptm.class_id IS NULL

  UNION

  SELECT DISTINCT ca.user_id, true
    FROM ptm
    JOIN public.classes c            ON c.institution_id = ptm.institution_id
    JOIN public.class_assignments ca ON ca.class_id = c.id
    JOIN public.profiles p           ON p.id = ca.user_id
   WHERE ptm.class_id IS NULL
     AND ca.role = 'teacher'
     AND p.is_active IS NOT FALSE
$function$;

REVOKE ALL ON FUNCTION public.ptm_audience(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ptm_audience(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.ptm_audience(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_audience(uuid) TO service_role;
```

- [ ] **Step 5: Append the fanout helper and the RLS fix to the same migration**

```sql
-- ── Claim-then-write helper ──────────────────────────────────────────
-- ONE statement: claim the recipients that have not had this (ptm, type)
-- yet, then write a notifications row for exactly those. Returns how many
-- were written, so callers can be logged/triaged.
-- NOT callable by clients: it writes arbitrary notification text to
-- arbitrary users, so authenticated is revoked too, not just anon.
CREATE OR REPLACE FUNCTION public._ptm_fanout(
  _ptm_id     uuid,
  _type       text,
  _title      text,
  _message    text,
  _recipients uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_written integer := 0;
BEGIN
  IF _recipients IS NULL OR array_length(_recipients, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH claimed AS (
    INSERT INTO public.ptm_notifications_sent (ptm_id, recipient_id, notification_type)
    SELECT _ptm_id, r, _type FROM unnest(_recipients) AS r
    ON CONFLICT (ptm_id, recipient_id, notification_type) DO NOTHING
    RETURNING recipient_id
  ), written AS (
    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    SELECT c.recipient_id, _type, _title, _message,
           '/school/communication?tab=ptm',
           jsonb_build_object('ptm_id', _ptm_id)
      FROM claimed c
    RETURNING 1
  )
  SELECT count(*) INTO v_written FROM written;

  RETURN v_written;
END;
$function$;

REVOKE ALL ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._ptm_fanout(uuid, text, text, text, uuid[]) TO service_role;

-- ── RLS: give ptm_update an explicit WITH CHECK ──────────────────────
-- Task 6 makes this the first real UPDATE writer. Postgres falls back to
-- USING when WITH CHECK is absent, so this is not broken today, but
-- CLAUDE.md 26 requires both halves to be explicit: a missing WITH CHECK
-- silently rejected 100% of teachers' offline-marks saves for two days.
DROP POLICY IF EXISTS "ptm_update" ON public.ptm_schedules;
CREATE POLICY "ptm_update" ON public.ptm_schedules FOR UPDATE
  USING      (public.is_institution_admin(auth.uid(), institution_id))
  WITH CHECK (public.is_institution_admin(auth.uid(), institution_id));
```

- [ ] **Step 6: Apply the migration and re-run the assertion script**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915100000_ptm_notifications_foundation.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/ptm-notifications/verify-01-foundation.sql
```

Expected: `PASS: foundation objects present and locked down`.

If the anon assertion fails, the REVOKE did not take. Do NOT work around it by dropping the assertion: re-run the `REVOKE ... FROM anon` by name and check `information_schema.routine_privileges` again.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260915100000_ptm_notifications_foundation.sql scripts/ptm-notifications/verify-01-foundation.sql
git commit -m "feat(ptm): notification ledger, audience resolver and fanout helper"
```

---

### Task 2: The three triggers

**Files:**
- Create: `supabase/migrations/20260915100100_ptm_notification_triggers.sql`
- Create: `scripts/ptm-notifications/verify-02-triggers.sql`

**Interfaces:**
- Consumes: `ptm_audience(uuid)`, `_ptm_fanout(uuid, text, text, text, uuid[])`, `ptm_notifications_sent` from Task 1.
- Produces: triggers `tg_ptm_notify_scheduled`, `tg_ptm_notify_changed` on `ptm_schedules`; `tg_ptm_notify_booking` on `ptm_bookings`. Nothing later depends on their names except the verify script.

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/ptm-notifications/verify-02-triggers.sql`:

```sql
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(t.name, ', ') INTO v_missing
    FROM (VALUES ('tg_ptm_notify_scheduled'), ('tg_ptm_notify_changed'),
                 ('tg_ptm_notify_booking')) AS t(name)
   WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t.name AND NOT tgisinternal);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: missing triggers: %', v_missing;
  END IF;
  RAISE NOTICE 'PASS: all three PTM triggers installed';
END $$;
```

- [ ] **Step 2: Run it and confirm it FAILS**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/ptm-notifications/verify-02-triggers.sql
```

Expected: `FAIL: missing triggers: tg_ptm_notify_scheduled, tg_ptm_notify_changed, tg_ptm_notify_booking`.

- [ ] **Step 3: Write the trigger migration**

Create `supabase/migrations/20260915100100_ptm_notification_triggers.sql`:

```sql
-- =====================================================================
-- PTM notifications, part 2 of 3: the triggers.
-- Every function body is exception-wrapped. A notification failure must
-- NEVER abort the PTM write: a PTM that cannot be created because a
-- notification hit a constraint is a worse bug than a missing bell row.
-- =====================================================================

-- ── 1. PTM scheduled ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_ptm_notify_scheduled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- The actor never notifies themselves. auth.uid() is NULL for a
  -- service-role or script write, hence the created_by fallback. This
  -- also covers the dual-role case (CLAUDE.md 25): an admin who also
  -- teaches the class would otherwise land in their own audience.
  v_actor uuid := COALESCE(auth.uid(), NEW.created_by);
  v_class text;
BEGIN
  SELECT ' for ' || c.name || COALESCE(' ' || c.section, '')
    INTO v_class
    FROM public.classes c
   WHERE c.id = NEW.class_id;

  PERFORM public._ptm_fanout(
    NEW.id,
    'ptm_scheduled',
    'PTM scheduled',
    '"' || NEW.title || '"' || COALESCE(v_class, '') || ' on '
      || to_char(NEW.scheduled_date, 'DD Mon YYYY') || ', '
      || to_char(NEW.start_time, 'HH24:MI') || ' to '
      || to_char(NEW.end_time,   'HH24:MI') || '.',
    ARRAY(SELECT a.user_id FROM public.ptm_audience(NEW.id) a
           WHERE a.user_id IS DISTINCT FROM v_actor)
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tg_ptm_notify_scheduled ON public.ptm_schedules;
CREATE TRIGGER tg_ptm_notify_scheduled
AFTER INSERT ON public.ptm_schedules
FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_notify_scheduled();

-- ── 2. PTM cancelled or rescheduled ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_ptm_notify_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := COALESCE(auth.uid(), NEW.created_by);
  v_audience uuid[];
BEGIN
  v_audience := ARRAY(SELECT a.user_id FROM public.ptm_audience(NEW.id) a
                       WHERE a.user_id IS DISTINCT FROM v_actor);

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    PERFORM public._ptm_fanout(
      NEW.id, 'ptm_cancelled', 'PTM cancelled',
      '"' || NEW.title || '" on '
        || to_char(NEW.scheduled_date, 'DD Mon YYYY') || ' has been cancelled.',
      v_audience
    );

  ELSIF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
     OR NEW.start_time     IS DISTINCT FROM OLD.start_time
     OR NEW.end_time       IS DISTINCT FROM OLD.end_time THEN

    -- LOAD-BEARING: the claim key is (ptm, recipient, type), so without
    -- clearing the previous reschedule claims a SECOND reschedule would
    -- claim nothing and notify nobody, silently. See the spec's Risks.
    DELETE FROM public.ptm_notifications_sent
     WHERE ptm_id = NEW.id AND notification_type = 'ptm_rescheduled';

    PERFORM public._ptm_fanout(
      NEW.id, 'ptm_rescheduled', 'PTM rescheduled',
      '"' || NEW.title || '" has moved to '
        || to_char(NEW.scheduled_date, 'DD Mon YYYY') || ', '
        || to_char(NEW.start_time, 'HH24:MI') || ' to '
        || to_char(NEW.end_time,   'HH24:MI') || '.',
      v_audience
    );
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tg_ptm_notify_changed ON public.ptm_schedules;
CREATE TRIGGER tg_ptm_notify_changed
AFTER UPDATE ON public.ptm_schedules
FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_notify_changed();

-- ── 3. Slot booked ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_ptm_notify_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_student text;
  v_title   text;
BEGIN
  -- parent_id holds the STUDENT's profiles.id: SALCI has no parent role,
  -- students book their own slots. Never render the word "parent" here.
  SELECT p.full_name INTO v_student
    FROM public.profiles p WHERE p.id = NEW.parent_id;

  SELECT ps.title INTO v_title
    FROM public.ptm_schedules ps WHERE ps.id = NEW.ptm_id;

  -- Only the booked teacher. Not the audience, not the admin.
  PERFORM public._ptm_fanout(
    NEW.ptm_id, 'ptm_slot_booked', 'PTM slot booked',
    COALESCE(v_student, 'A student') || ' booked '
      || to_char(NEW.slot_time, 'HH24:MI')
      || ' for "' || COALESCE(v_title, 'PTM') || '".',
    ARRAY[NEW.teacher_id]
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS tg_ptm_notify_booking ON public.ptm_bookings;
CREATE TRIGGER tg_ptm_notify_booking
AFTER INSERT ON public.ptm_bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_ptm_notify_booking();
```

- [ ] **Step 4: Apply the migration and re-run the structural assertion**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915100100_ptm_notification_triggers.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/ptm-notifications/verify-02-triggers.sql
```

Expected: `PASS: all three PTM triggers installed`.

- [ ] **Step 5: Write and run the BEHAVIOURAL test (this is the real one)**

Structural presence proves nothing about fanout correctness. This script creates a real PTM against a real class, asserts the counts, then **raises at the end to roll the whole thing back** — a `DO` block is atomic, so the test PTM and its notifications never persist.

Create `scripts/ptm-notifications/verify-02-behaviour.sql`:

```sql
DO $$
DECLARE
  v_class uuid; v_inst uuid; v_admin uuid; v_ptm uuid;
  v_expected int; v_actual int; v_teacher_rows int; v_dupes int;
BEGIN
  -- A class that genuinely has both students and teachers assigned.
  SELECT c.id, c.institution_id INTO v_class, v_inst
    FROM public.classes c
   WHERE EXISTS (SELECT 1 FROM public.class_assignments ca
                  WHERE ca.class_id=c.id AND ca.role='student')
     AND EXISTS (SELECT 1 FROM public.class_assignments ca
                  WHERE ca.class_id=c.id AND ca.role='teacher')
   LIMIT 1;
  IF v_class IS NULL THEN RAISE EXCEPTION 'SETUP: no class with both students and teachers'; END IF;

  SELECT id INTO v_admin FROM public.profiles WHERE institution_id = v_inst LIMIT 1;

  INSERT INTO public.ptm_schedules
    (institution_id, title, scheduled_date, start_time, end_time, class_id, created_by)
  VALUES (v_inst, 'ZZ TEST PTM', current_date + 7, '10:00', '13:00', v_class, v_admin)
  RETURNING id INTO v_ptm;

  -- auth.uid() is NULL here, so the actor is created_by (v_admin).
  SELECT count(*) INTO v_expected
    FROM public.ptm_audience(v_ptm) a WHERE a.user_id IS DISTINCT FROM v_admin;
  SELECT count(*) INTO v_actual
    FROM public.notifications WHERE metadata->>'ptm_id' = v_ptm::text;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION 'FAIL: notified % but audience is %', v_actual, v_expected;
  END IF;
  IF v_actual = 0 THEN RAISE EXCEPTION 'FAIL: nobody was notified'; END IF;

  -- A teacher of N subjects in this class must get exactly ONE row.
  SELECT count(*) INTO v_dupes FROM (
    SELECT user_id FROM public.notifications
     WHERE metadata->>'ptm_id' = v_ptm::text
     GROUP BY user_id HAVING count(*) > 1) d;
  IF v_dupes > 0 THEN RAISE EXCEPTION 'FAIL: % recipients got duplicate rows', v_dupes; END IF;

  -- The creating admin must NOT be in their own audience.
  IF EXISTS (SELECT 1 FROM public.notifications
              WHERE metadata->>'ptm_id' = v_ptm::text AND user_id = v_admin) THEN
    RAISE EXCEPTION 'FAIL: the actor notified themselves';
  END IF;

  -- A description-only edit must notify nobody new.
  UPDATE public.ptm_schedules SET description = 'edited' WHERE id = v_ptm;
  SELECT count(*) INTO v_teacher_rows
    FROM public.notifications WHERE metadata->>'ptm_id' = v_ptm::text;
  IF v_teacher_rows <> v_actual THEN
    RAISE EXCEPTION 'FAIL: a description edit notified % extra', v_teacher_rows - v_actual;
  END IF;

  -- Rescheduling TWICE must notify BOTH times (the claim-delete).
  UPDATE public.ptm_schedules SET scheduled_date = current_date + 8 WHERE id = v_ptm;
  UPDATE public.ptm_schedules SET scheduled_date = current_date + 9 WHERE id = v_ptm;
  SELECT count(*) INTO v_teacher_rows
    FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type = 'ptm_rescheduled';
  IF v_teacher_rows <> v_expected * 2 THEN
    RAISE EXCEPTION 'FAIL: two reschedules produced % rows, expected % (the claim-delete is missing)',
      v_teacher_rows, v_expected * 2;
  END IF;

  RAISE EXCEPTION 'PASS-ROLLBACK: audience=% dupes=0 reschedules=% (rolling back)', v_expected, v_teacher_rows;
END $$;
```

Run:

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/ptm-notifications/verify-02-behaviour.sql
```

Expected: the message starts with `PASS-ROLLBACK:`. **Any message starting with `FAIL:` is a real failure.** A `PASS-ROLLBACK` is still an exception, so nothing is written: confirm with
`SELECT count(*) FROM ptm_schedules WHERE title = 'ZZ TEST PTM';` returning 0.

- [ ] **Step 5b: Cover the remaining spec test cases**

Step 5 covers spec tests 1, 2, 4 and 5. These four close the rest. Create `scripts/ptm-notifications/verify-02-behaviour-2.sql`:

```sql
-- Spec test 9: trigger resilience, asserted statically. All three trigger
-- functions MUST carry the catch-all, or a failed notification can abort a
-- PTM write. Checked against pg_proc rather than by deliberately breaking
-- _ptm_fanout, because this runs against prod.
DO $$
DECLARE v_unguarded text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_unguarded
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('tg_ptm_notify_scheduled','tg_ptm_notify_changed','tg_ptm_notify_booking')
     AND p.prosrc NOT ILIKE '%EXCEPTION WHEN OTHERS%';
  IF v_unguarded IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: unguarded trigger functions: %', v_unguarded;
  END IF;
  RAISE NOTICE 'PASS: all three trigger functions are exception-wrapped';
END $$;

-- Spec tests 3, 6, 7: school-wide count, cancel-once, booking isolation.
DO $$
DECLARE
  v_inst uuid; v_admin uuid; v_teacher uuid; v_student uuid;
  v_ptm uuid; v_roster int; v_got int; v_before int;
BEGIN
  SELECT c.institution_id INTO v_inst
    FROM public.classes c
    JOIN public.class_assignments ca ON ca.class_id = c.id AND ca.role='student'
   GROUP BY c.institution_id ORDER BY count(*) DESC LIMIT 1;
  SELECT id INTO v_admin FROM public.profiles WHERE institution_id = v_inst LIMIT 1;

  -- class_id NULL = school-wide.
  INSERT INTO public.ptm_schedules
    (institution_id, title, scheduled_date, start_time, end_time, created_by)
  VALUES (v_inst, 'ZZ SCHOOLWIDE', current_date + 7, '10:00', '13:00', v_admin)
  RETURNING id INTO v_ptm;

  -- Spec test 3: the student half must equal the canonical roster exactly.
  SELECT count(*) INTO v_roster FROM public.institution_student_ids(v_inst);
  SELECT count(*) INTO v_got
    FROM public.notifications n
    JOIN public.institution_student_ids(v_inst) s ON s.student_id = n.user_id
   WHERE n.metadata->>'ptm_id' = v_ptm::text;
  IF v_got <> v_roster THEN
    RAISE EXCEPTION 'FAIL: school-wide reached % students, canonical roster is %', v_got, v_roster;
  END IF;

  -- Spec test 6: cancel notifies once; a second cancel is silent.
  UPDATE public.ptm_schedules SET status='cancelled' WHERE id = v_ptm;
  SELECT count(*) INTO v_before FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type='ptm_cancelled';
  IF v_before = 0 THEN RAISE EXCEPTION 'FAIL: cancel notified nobody'; END IF;
  UPDATE public.ptm_schedules SET status='cancelled' WHERE id = v_ptm;
  SELECT count(*) INTO v_got FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type='ptm_cancelled';
  IF v_got <> v_before THEN
    RAISE EXCEPTION 'FAIL: a second cancel notified % extra', v_got - v_before;
  END IF;

  -- Spec test 7: a booking notifies the booked teacher and NOBODY else.
  SELECT ca.user_id INTO v_teacher FROM public.class_assignments ca
    JOIN public.classes c ON c.id = ca.class_id
   WHERE c.institution_id = v_inst AND ca.role='teacher' LIMIT 1;
  SELECT s.student_id INTO v_student FROM public.institution_student_ids(v_inst) s LIMIT 1;

  INSERT INTO public.ptm_bookings (ptm_id, parent_id, teacher_id, slot_time)
  VALUES (v_ptm, v_student, v_teacher, '10:30');

  SELECT count(*) INTO v_got FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type='ptm_slot_booked';
  IF v_got <> 1 THEN RAISE EXCEPTION 'FAIL: booking wrote % rows, expected 1', v_got; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications
                  WHERE metadata->>'ptm_id' = v_ptm::text
                    AND type='ptm_slot_booked' AND user_id = v_teacher) THEN
    RAISE EXCEPTION 'FAIL: the booked teacher was not the recipient';
  END IF;

  RAISE EXCEPTION 'PASS-ROLLBACK: schoolwide=% cancel=% booking=1 (rolling back)', v_roster, v_before;
END $$;
```

Run it and expect a `PASS-ROLLBACK:` message. If the school-wide count is off, do NOT relax the assertion to match: a mismatch means `ptm_audience` and `institution_student_ids()` disagree, which is the "253 vs 252" defect CLAUDE.md warns about.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915100100_ptm_notification_triggers.sql scripts/ptm-notifications/verify-02-*.sql
git commit -m "feat(ptm): notify on schedule, reschedule, cancel and slot booking"
```

---

### Task 3: Day-before reminder + cron

**Files:**
- Create: `supabase/migrations/20260915100200_ptm_reminder_cron.sql`
- Create: `scripts/ptm-notifications/verify-03-reminder.sql`

**Interfaces:**
- Consumes: `ptm_audience(uuid)`, `_ptm_fanout(...)` from Task 1.
- Produces: `public.ptm_send_day_before_reminders() RETURNS integer` (count of rows written) and the cron job `ptm-day-before-reminders`.

- [ ] **Step 1: Write the failing assertion script**

Create `scripts/ptm-notifications/verify-03-reminder.sql`:

```sql
DO $$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='ptm_send_day_before_reminders';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'FAIL: ptm_send_day_before_reminders is missing';
  END IF;
  -- CLAUDE.md 24: the 2026-05-25 regression test. The function MUST read
  -- "tomorrow" in the institution's timezone, never the server's.
  IF v_src NOT ILIKE '%AT TIME ZONE%COALESCE(i.timezone%' THEN
    RAISE EXCEPTION 'FAIL: reminder does not use institution-local time (section 24)';
  END IF;
  IF v_src ~* '\mCURRENT_DATE\M' THEN
    RAISE EXCEPTION 'FAIL: reminder uses CURRENT_DATE (section 24 regression)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='ptm-day-before-reminders') THEN
    RAISE EXCEPTION 'FAIL: cron job ptm-day-before-reminders is not scheduled';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.routine_privileges
              WHERE routine_schema='public' AND grantee IN ('anon','authenticated')
                AND routine_name='ptm_send_day_before_reminders') THEN
    RAISE EXCEPTION 'FAIL: anon/authenticated can run the reminder pass';
  END IF;
  RAISE NOTICE 'PASS: reminder function is institution-local and scheduled';
END $$;
```

- [ ] **Step 2: Run it and confirm it FAILS**

```
powershell -File scripts/run-sql.ps1 -SqlFile scripts/ptm-notifications/verify-03-reminder.sql
```

Expected: `FAIL: ptm_send_day_before_reminders is missing`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260915100200_ptm_reminder_cron.sql`:

```sql
-- =====================================================================
-- PTM notifications, part 3 of 3: the day-before reminder.
-- No edge function and no net.http_post: web push is out of scope, so
-- the work never leaves the database (unlike homework-notify-pass).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.ptm_send_day_before_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r       record;
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT ps.id, ps.title, ps.start_time, ps.end_time
      FROM public.ptm_schedules ps
      JOIN public.institutions  i ON i.id = ps.institution_id
     WHERE ps.status = 'scheduled'
       -- CLAUDE.md 24 (CRITICAL): "tomorrow" is per institution. A bare
       -- CURRENT_DATE here re-introduces the 2026-05-25 bug that left
       -- attendance auto-mark dead for every IST school until 13:30 IST.
       AND ps.scheduled_date
           = (now() AT TIME ZONE COALESCE(i.timezone, 'Asia/Kolkata'))::date + 1
  LOOP
    v_total := v_total + public._ptm_fanout(
      r.id,
      'ptm_reminder',
      'PTM tomorrow',
      '"' || r.title || '" is tomorrow, '
        || to_char(r.start_time, 'HH24:MI') || ' to '
        || to_char(r.end_time,   'HH24:MI') || '.',
      -- Students in scope, plus ONLY the teachers somebody actually
      -- booked. A teacher with no bookings needs no reminder.
      ARRAY(
        SELECT a.user_id FROM public.ptm_audience(r.id) a WHERE a.is_teacher = false
        UNION
        SELECT b.teacher_id FROM public.ptm_bookings b WHERE b.ptm_id = r.id
      )
    );
  END LOOP;

  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.ptm_send_day_before_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ptm_send_day_before_reminders() FROM anon;
REVOKE ALL ON FUNCTION public.ptm_send_day_before_reminders() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ptm_send_day_before_reminders() TO service_role;

-- Hourly, not daily: ptm_notifications_sent makes re-runs free, so one
-- job crossing every institution's local evening beats per-tz scheduling.
DO $$
BEGIN
  PERFORM cron.unschedule('ptm-day-before-reminders');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'ptm-day-before-reminders',
  '0 * * * *',
  $job$ SELECT public.ptm_send_day_before_reminders(); $job$
);
```

- [ ] **Step 4: Apply and re-run the assertion**

```
powershell -File scripts/run-sql.ps1 -SqlFile supabase/migrations/20260915100200_ptm_reminder_cron.sql
powershell -File scripts/run-sql.ps1 -SqlFile scripts/ptm-notifications/verify-03-reminder.sql
```

Expected: `PASS: reminder function is institution-local and scheduled`.

- [ ] **Step 5: Prove the timezone behaviour with a non-IST institution**

This is the §24 regression test and it must be run, not assumed. Rolls back via the same raise-at-the-end trick as Task 2:

```sql
DO $$
DECLARE v_inst uuid; v_old text; v_ptm uuid; v_admin uuid; v_hits int;
BEGIN
  SELECT id, timezone INTO v_inst, v_old FROM public.institutions LIMIT 1;
  SELECT id INTO v_admin FROM public.profiles WHERE institution_id = v_inst LIMIT 1;

  -- Pacific/Kiritimati is UTC+14: its "tomorrow" differs from UTC's.
  UPDATE public.institutions SET timezone = 'Pacific/Kiritimati' WHERE id = v_inst;

  INSERT INTO public.ptm_schedules
    (institution_id, title, scheduled_date, start_time, end_time, created_by)
  VALUES (v_inst, 'ZZ TZ TEST',
          (now() AT TIME ZONE 'Pacific/Kiritimati')::date + 1,
          '10:00', '13:00', v_admin)
  RETURNING id INTO v_ptm;

  PERFORM public.ptm_send_day_before_reminders();

  SELECT count(*) INTO v_hits FROM public.notifications
   WHERE metadata->>'ptm_id' = v_ptm::text AND type = 'ptm_reminder';
  IF v_hits = 0 THEN
    RAISE EXCEPTION 'FAIL: institution-local tomorrow was not picked up (section 24)';
  END IF;

  RAISE EXCEPTION 'PASS-ROLLBACK: reminder fired for % recipients (rolling back)', v_hits;
END $$;
```

Expected: `PASS-ROLLBACK:`. The raise also restores the original `timezone`, since the UPDATE is in the same aborted transaction.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260915100200_ptm_reminder_cron.sql scripts/ptm-notifications/verify-03-reminder.sql
git commit -m "feat(ptm): day-before reminder pass on an hourly cron"
```

---

### Task 4: Bell icons for the five PTM types

**Files:**
- Modify: `src/components/layout/NotificationPanel.tsx:55-91` (the `TYPE_VISUALS` map)

**Interfaces:**
- Consumes: the five `type` strings written by Tasks 2 and 3 — `ptm_scheduled`, `ptm_rescheduled`, `ptm_cancelled`, `ptm_slot_booked`, `ptm_reminder`.
- Produces: nothing other tasks consume.

Without this the rows still render (there is a `FALLBACK_VISUAL` bell at line 93), so this is polish. Do it anyway: five unlabelled grey bells is how the bell stops being scannable.

- [ ] **Step 1: Add the five entries**

In `TYPE_VISUALS`, immediately after the `homework_closed` line, insert:

```ts
  ptm_scheduled: { icon: CalendarClock, tone: "teal" },
  ptm_rescheduled: { icon: RefreshCw, tone: "peach" },
  ptm_cancelled: { icon: CalendarX, tone: "rose" },
  ptm_slot_booked: { icon: CalendarCheck, tone: "sky" },
  ptm_reminder: { icon: BellRing, tone: "peach" },
```

All five icons (`CalendarClock`, `RefreshCw`, `CalendarX`, `CalendarCheck`, `BellRing`) are **already imported** at the top of this file. Do not add imports; a duplicate import is a build error.

Valid `tone` values are exactly `teal | violet | peach | mint | sky | rose` (`src/components/shared/design-system.ts:8-17`). Anything else fails typecheck.

- [ ] **Step 2: Run the gate**

```bash
npm run typecheck
npx eslint src/components/layout/NotificationPanel.tsx
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/NotificationPanel.tsx
git commit -m "feat(ptm): icons and tones for the five PTM notification types"
```

---

### Task 5: Harden `usePTM.ts` and add the update mutation

**Files:**
- Modify: `src/hooks/usePTM.ts` (whole file)

**Interfaces:**
- Consumes: nothing from earlier tasks (the triggers fire server-side; the client just writes rows).
- Produces, relied on by Task 6:
  - `type PTMSchedule` (exported)
  - `usePTMSchedules(institutionId: string | null)` returning `{ schedules: PTMSchedule[], isLoading: boolean, isError: boolean, refetch: () => void, createSchedule }`
  - `useUpdatePTMSchedule()` returning a mutation taking `{ id: string; scheduled_date?: string; start_time?: string; end_time?: string; status?: string }`

This file currently breaks five standing contracts: `toast.error(error.message)` (§19), `select("*")` and no `staleTime` (§23), bare `supabase.auth.getUser()` (§23), and it never surfaces `error`. §5a makes all of that in scope because the file is being edited. **Scope is these fixes only — do not redesign the PTM feature.**

- [ ] **Step 1: Replace the imports and add shared types**

Replace lines 1-3 with:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { requireCurrentUser } from "@/lib/auth";

/** PostgREST types a to-one embed as `T | T[]`; collapse it to the object. */
const pickOne = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? v[0] ?? null : v ?? null;

type EmbeddedClass = { id: string; name: string; section: string | null };
type EmbeddedPerson = { id: string; full_name: string | null };

export type PTMSchedule = {
  id: string;
  institution_id: string;
  title: string;
  description: string | null;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  class_id: string | null;
  slot_duration_minutes: number;
  status: string;
  class: EmbeddedClass | null;
};

export type PTMBooking = {
  id: string;
  ptm_id: string;
  slot_time: string;
  notes: string | null;
  feedback: string | null;
  rating: number | null;
  status: string;
  /** NOTE: `parent_id` holds the STUDENT's profile. SALCI has no parent
   *  role; students book their own slots. Never label this "parent". */
  student: EmbeddedPerson | null;
  teacher: EmbeddedPerson | null;
};

const PTM_COLUMNS =
  "id, institution_id, title, description, scheduled_date, start_time, " +
  "end_time, class_id, slot_duration_minutes, status";

const BOOKING_COLUMNS = "id, ptm_id, slot_time, notes, feedback, rating, status";
```

- [ ] **Step 2: Rewrite `usePTMSchedules`**

```ts
export function usePTMSchedules(institutionId: string | null) {
  const queryClient = useQueryClient();

  const schedulesQuery = useQuery({
    queryKey: ["ptm-schedules", institutionId],
    queryFn: async (): Promise<PTMSchedule[]> => {
      if (!institutionId) return [];
      const { data, error } = await supabase
        .from("ptm_schedules")
        .select(`${PTM_COLUMNS}, class:classes(id, name, section)`)
        .eq("institution_id", institutionId)
        .order("scheduled_date", { ascending: false })
        // A school runs a handful of PTMs a term, but "a filter is not a
        // bound" (CLAUDE.md 23): PostgREST silently caps at 1000 anyway.
        .range(0, 99);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        class: pickOne<EmbeddedClass>(row.class),
      })) as PTMSchedule[];
    },
    enabled: !!institutionId,
    staleTime: 60_000,
  });

  const createSchedule = useMutation({
    mutationFn: async (schedule: {
      institution_id: string;
      title: string;
      description?: string;
      scheduled_date: string;
      start_time: string;
      end_time: string;
      class_id?: string;
      slot_duration_minutes?: number;
    }) => {
      const user = await requireCurrentUser();
      const { error } = await supabase
        .from("ptm_schedules")
        .insert({ ...schedule, created_by: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
      // The notification fanout is a DB trigger, so it has already run in
      // the same transaction by the time we get here.
      toast.success("PTM scheduled. Teachers and students have been notified.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't schedule the PTM.", context: "createPTM" }),
  });

  return {
    schedules: schedulesQuery.data ?? [],
    isLoading: schedulesQuery.isLoading,
    isError: schedulesQuery.isError,
    refetch: schedulesQuery.refetch,
    createSchedule,
  };
}
```

- [ ] **Step 3: Rewrite `usePTMBookings` with the same treatment**

```ts
export function usePTMBookings(ptmId: string | null) {
  const queryClient = useQueryClient();

  const bookingsQuery = useQuery({
    queryKey: ["ptm-bookings", ptmId],
    queryFn: async (): Promise<PTMBooking[]> => {
      if (!ptmId) return [];
      const { data, error } = await supabase
        .from("ptm_bookings")
        .select(
          `${BOOKING_COLUMNS}, ` +
            `student:profiles!ptm_bookings_parent_id_fkey(id, full_name), ` +
            `teacher:profiles!ptm_bookings_teacher_id_fkey(id, full_name)`,
        )
        .eq("ptm_id", ptmId)
        .order("slot_time", { ascending: true })
        .range(0, 499);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        student: pickOne<EmbeddedPerson>(row.student),
        teacher: pickOne<EmbeddedPerson>(row.teacher),
      })) as PTMBooking[];
    },
    enabled: !!ptmId,
    staleTime: 60_000,
  });

  const bookSlot = useMutation({
    mutationFn: async ({ ptmId: id, teacherId, slotTime, notes }: {
      ptmId: string; teacherId: string; slotTime: string; notes?: string;
    }) => {
      const user = await requireCurrentUser();
      const { error } = await supabase.from("ptm_bookings").insert({
        ptm_id: id,
        parent_id: user.id,
        teacher_id: teacherId,
        slot_time: slotTime,
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ptm-bookings"] });
      toast.success("Slot booked. Your teacher has been notified.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't book that slot.", context: "bookPTMSlot" }),
  });

  return {
    bookings: bookingsQuery.data ?? [],
    isLoading: bookingsQuery.isLoading,
    isError: bookingsQuery.isError,
    bookSlot,
  };
}
```

**Note the embed alias changed from `parent:` to `student:`.** The FK hint
`profiles!ptm_bookings_parent_id_fkey` must stay exactly as-is (it names the
constraint), but the alias is ours. Task 6 updates the one consumer.

- [ ] **Step 4: Add the update mutation (new)**

```ts
/**
 * The only write path for changing an existing PTM. Reschedule (date/time)
 * and cancel (status) both land here; which notification goes out is decided
 * by the `tg_ptm_notify_changed` trigger, not by this hook.
 */
export function useUpdatePTMSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      scheduled_date?: string;
      start_time?: string;
      end_time?: string;
      status?: string;
    }) => {
      const { id, ...patch } = input;
      const { data, error } = await supabase
        .from("ptm_schedules")
        .update(patch)
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // An UPDATE blocked by RLS returns zero rows and NO error, exactly
      // like the DELETE case in CLAUDE.md 6. Rows-came-back is the only
      // success signal.
      if (!data || data.length === 0) {
        throw new Error("You don't have permission to change this PTM.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ptm-schedules"] });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update the PTM.", context: "updatePTM" }),
  });
}
```

- [ ] **Step 5: Run the gate**

```bash
npm run typecheck
npx eslint src/hooks/usePTM.ts
```

Expected: both clean, with no fallout in `PTMSchedulePanel.tsx`. The rename from
`parent:` to `student:` is safe here because the panel does **not** consume
`usePTMBookings` for its bookings list (it runs its own inline query, which Task
6 removes), and `PTMBookingDialog` destructures only `bookSlot`. If typecheck
does report an error in another file, stop and read it: something else consumes
these hooks that this plan did not account for.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/usePTM.ts
git commit -m "refactor(ptm): explicit columns, staleTime, toastError and an update mutation"
```

---

### Task 6: Cancel and reschedule UI, and the panel's error state

**Files:**
- Modify: `src/components/communication/PTMSchedulePanel.tsx`

**Interfaces:**
- Consumes: `PTMSchedule`, `PTMBooking`, `usePTMSchedules`, `useUpdatePTMSchedule` from Task 5.
- Produces: nothing downstream.

This task makes `ptm_cancelled` and `ptm_rescheduled` reachable at all: the panel has no way to update a PTM today, so those two triggers can never fire without it.

- [ ] **Step 1: Render the error state BEFORE the empty state**

The panel currently renders "No PTM schedules yet" when the query **fails**, which is CLAUDE.md §6's single most common defect in this repo. Pull `isError` and `refetch` from the hook and branch on it first:

```tsx
const { schedules, isLoading, isError, refetch } = usePTMSchedules(institutionId);
```

```tsx
{isLoading ? (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="h-8 w-8 animate-spin text-ink-500" aria-label="Loading" />
  </div>
) : isError ? (
  <EmptyState
    icon={<AlertTriangle className="h-7 w-7" />}
    tone="rose"
    reason="error"
    title="Couldn't load PTM schedules"
    description="Check your connection and try again."
    action={{ label: "Retry", onClick: () => refetch() }}
  />
) : schedules.length === 0 ? (
  <EmptyState
    icon={<Calendar className="h-7 w-7" />}
    reason="noData"
    title="No PTM scheduled yet"
    description="Scheduled meetings will appear here."
  />
) : (
  /* ...existing grid... */
)}
```

Import `EmptyState` from `@/components/shared/surfaces` and `AlertTriangle` from `lucide-react`.

- [ ] **Step 2: Replace the panel's private bookings query, then drop every `any`**

**Read this before editing:** the panel does NOT use `usePTMBookings` for the
expanded bookings list. It has its own inline `useQuery` at
`PTMSchedulePanel.tsx:36-49` (query key `["ptm-bookings-expanded", expandedPtmId]`)
with `select("*")`, no `staleTime`, no error handling, and the old `parent:`
alias. That duplicate query is what renders `b.parent?.full_name`.

Delete the inline query entirely and use the hook instead, so there is one
bookings path rather than two that can drift:

```tsx
const { bookings, isError: bookingsError } = usePTMBookings(expandedPtmId);
```

Then drop the now-unused `useQuery` and `supabase` imports **only if nothing
else in the file still uses them** (check first: an unused import is not
flagged here, because this repo sets `@typescript-eslint/no-unused-vars` to
`off`; catch it with
`npx eslint --rule '{"@typescript-eslint/no-unused-vars":["error",{"argsIgnorePattern":"^_"}]}' src/components/communication/PTMSchedulePanel.tsx`).

Now the `any`s go away on their own:

- `schedules.map((ptm: any) =>` becomes `schedules.map((ptm) =>`, inferred as `PTMSchedule`
- `bookings.map((b: any) =>` becomes `bookings.map((b) =>`, inferred as `PTMBooking`
- the four `b.parent?.…` reads at lines 141, 164 and 169 become `b.student?.…`

`: any` is a hard §5a error; never re-add it, and never reach for `as any` to
silence the fallout.

Surface the bookings error too, rather than showing "No bookings yet" on a
failed fetch (§6 again, same defect class):

```tsx
{bookingsError ? (
  <p className="text-xs text-rose-600">Couldn't load bookings.</p>
) : bookings.length === 0 ? (
  <p className="text-xs text-ink-500">No bookings yet</p>
) : (
  /* ...existing booking rows... */
)}
```

- [ ] **Step 3: Add the reschedule sheet (admin only)**

Add state and the mutation near the other hooks:

```tsx
const updatePTM = useUpdatePTMSchedule();
const [editing, setEditing] = useState<PTMSchedule | null>(null);
const [cancelling, setCancelling] = useState<PTMSchedule | null>(null);
const [form, setForm] = useState({ scheduled_date: "", start_time: "", end_time: "" });
```

Render the sheet once, below the existing dialogs. `MobileSheet`, not `Dialog` (§20, and the project's `DialogContent` fork auto-wraps children in a `ScrollArea`):

```tsx
<MobileSheet
  open={!!editing}
  onOpenChange={(o) => !o && setEditing(null)}
  title="Reschedule PTM"
  subtitle={editing?.title}
  icon={<CalendarClock className="h-5 w-5" />}
  primaryAction={{
    label: "Save and notify",
    loading: updatePTM.isPending,
    disabled: updatePTM.isPending || !form.scheduled_date || !form.start_time || !form.end_time,
    onClick: () => {
      if (!editing) return;
      updatePTM.mutate(
        { id: editing.id, ...form },
        {
          onSuccess: () => {
            toast.success("PTM rescheduled. Everyone has been notified.");
            setEditing(null);
          },
        },
      );
    },
  }}
  secondaryAction={{ label: "Keep as is", onClick: () => setEditing(null) }}
>
  <div className="space-y-4 p-4">
    <div className="space-y-2">
      <Label htmlFor="ptm-date">Date</Label>
      <Input id="ptm-date" type="date" value={form.scheduled_date}
        onChange={(e) => setForm((f) => ({ ...f, scheduled_date: e.target.value }))} />
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor="ptm-start">Starts</Label>
        <Input id="ptm-start" type="time" value={form.start_time}
          onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ptm-end">Ends</Label>
        <Input id="ptm-end" type="time" value={form.end_time}
          onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
      </div>
    </div>
  </div>
</MobileSheet>
```

The "Reschedule" button on each card seeds the form from the row, so the sheet opens showing the current values rather than blanks:

```tsx
{canCreate && ptm.status === "scheduled" && (
  <Button variant="outline" size="sm" onClick={() => {
    setForm({
      scheduled_date: ptm.scheduled_date,
      start_time: ptm.start_time,
      end_time: ptm.end_time,
    });
    setEditing(ptm);
  }}>
    Reschedule
  </Button>
)}
```

Imports needed: `MobileSheet` from `@/components/shared/MobileSheet`, `Label` from `@/components/ui/label`, `Input` from `@/components/ui/input`, `CalendarClock` from `lucide-react`. Verify the `MobileSheet` import path with `grep -rn "from .*MobileSheet" src/pages | head -1` before writing it.

- [ ] **Step 4: Add the cancel confirm**

§9a: a save that invalidates existing rows must confirm first and **name what it will do**. Use shadcn `AlertDialog` from `@/components/ui/alert-dialog`:

```tsx
<AlertDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Cancel this PTM?</AlertDialogTitle>
      <AlertDialogDescription>
        {cancelling?.title} will be marked cancelled, and every teacher and
        student it was scheduled for will be notified. Existing slot bookings
        are kept, so you can reschedule instead if the meeting is only moving.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Keep it</AlertDialogCancel>
      <AlertDialogAction
        disabled={updatePTM.isPending}
        onClick={() => {
          if (!cancelling) return;
          updatePTM.mutate(
            { id: cancelling.id, status: "cancelled" },
            {
              onSuccess: () => {
                toast.success("PTM cancelled. Everyone has been notified.");
                setCancelling(null);
              },
            },
          );
        }}
      >
        Cancel PTM
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

`updatePTM.isPending` is the single-flight guard (§23.5); the mutation is idempotent anyway because setting `status` to `cancelled` twice notifies once (the trigger's `OLD.status IS DISTINCT FROM 'cancelled'` guard).

- [ ] **Step 5: Run the full gate**

```bash
npm run typecheck
npx eslint src/components/communication/PTMSchedulePanel.tsx src/hooks/usePTM.ts
npx vite build
```

All three must exit 0. Bundle-size warnings over 500 kB are not failures.

- [ ] **Step 6: Verify in the browser at 375px and in dark mode**

`npm run dev`, sign in as a school admin, go to `/school/communication?tab=ptm`:

1. Schedule a PTM for a class. Sign in as a student of that class: the bell shows "PTM scheduled".
2. Reschedule it. The same student gets "PTM rescheduled". Reschedule a **second** time: they get another one. (If the second is missing, the Task 2 claim-delete is broken.)
3. Book a slot as a student; the booked teacher's bell shows "PTM slot booked" naming the student.
4. Cancel it. The confirm names the PTM and says everyone will be told.
5. Throttle the network to offline and reload the PTM tab: you get "Couldn't load PTM schedules" with a Retry, **not** "No PTM scheduled yet".
6. Repeat at 375px width and with dark mode on. Both screenshots go in the PR.

- [ ] **Step 7: Commit**

```bash
git add src/components/communication/PTMSchedulePanel.tsx
git commit -m "feat(ptm): reschedule and cancel from the PTM panel, with a real error state"
```

---
