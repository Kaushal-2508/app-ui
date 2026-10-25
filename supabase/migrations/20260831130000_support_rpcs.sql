-- ============================================================================
-- Salci Support, Phase 2: the RPC layer
--
-- Design: docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md
-- Depends on Phase 1 (20260831120000_support_messages_and_thread.sql) having
-- reached PROD.
--
-- Contract, in one line each:
--   _support_apply_status          the ONE write path for a status change
--   list_my_support_tickets        reporter's own tickets, bounded, unread computed,
--                                  plus unclamped counts for the stat tiles
--   get_support_thread             cursor-paginated thread, internal rows hidden
--   post_support_message           the ONE write path for a message
--   set_support_ticket_status      inbox entry point, wrapper, DROPPED and recreated
--   resolve_support_task           /tasks entry point, wrapper, signature preserved
--   mark_support_ticket_read       per-side read stamp
--   support_inbox_counts           awaiting_salci + a p_status scope, DROPPED and recreated
--   get_support_ticket_transcript  super admin, everything including internal
--   create_support_task            now writes category + priority + message 1
--
-- Two entry points for a status change (the inbox and /tasks), ONE write path.
-- Building a second divergent path is exactly the mistake that produced the
-- two disconnected note stores this design removes.
--
-- Every function below is SECURITY DEFINER and every one is revoked from
-- PUBLIC *and* anon by name at the bottom of this file. Both revokes are
-- required: revoking anon alone leaves the PUBLIC grant, and revoking PUBLIC
-- alone leaves an explicit anon grant. Verify with
-- has_function_privilege(role, oid, 'EXECUTE'), which expands PUBLIC membership
-- and role inheritance; information_schema.routine_privileges does not, and a
-- NULL proacl means PUBLIC still holds EXECUTE.
--
-- ---------------------------------------------------------------------------
-- FOUR RULINGS CARRIED IN FROM THE PHASE 1 REVIEW, IMPLEMENTED HERE
--
-- 1. ONE NOTE, ONE PLANE. The live resolve_support_task writes the same note
--    text into BOTH public.task_comments and public.support_messages. Those two
--    have OPPOSITE visibility: the task_comments SELECT policy admits
--    get_task_assigner(task_id) = auth.uid(), and on a support ticket the
--    assigner IS the reporter, so that copy is public, while the
--    support_messages copy was written is_internal = true and is private. One
--    string, two visibilities, is a latent privacy inversion; it is inert today
--    only because no caller passes a note. The task_comments INSERT is DELETED
--    below and never reappears: the note goes to support_messages ONLY.
--
-- 2. THE STATUS NOTE IS is_internal = false. It is the resolution explanation
--    the reporter is meant to read, and the inbox already labels the box
--    "Shared with the reporter on this ticket". The Phase 1 interim bodies
--    wrote true, which made that label a lie. A genuinely private note is a
--    different action with its own path: post_support_message(p_is_internal
--    => true), which Phase 4's composer toggle drives.
--
-- 3. last_message_at IS MAINTAINED ON EVERY MESSAGE WRITE. It drives unread on
--    both sides and awaiting_salci in the inbox. The interim bodies inserted
--    into support_messages without bumping it. Section 7 re-derives it once for
--    any row that drifted.
--
-- 4. NOTE INSERTS ARE IDEMPOTENT. The interim bodies passed client_token
--    implicitly NULL, so the partial unique index uq_support_messages_client_token
--    never engaged and a network retry duplicated the note. See the two-layer
--    guard inside _support_apply_status.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Preflight. Fail loudly rather than create RPCs against a half-migrated
-- schema: the migration ledger (supabase_migrations.schema_migrations) is not
-- maintained in this project, so file presence proves nothing.
-- ---------------------------------------------------------------------------
DO $preflight$
BEGIN
  IF to_regclass('public.support_messages') IS NULL THEN
    RAISE EXCEPTION 'Phase 1 has not been applied: public.support_messages is missing.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reported_issues'
      AND column_name = 'admin_notes'
  ) THEN
    RAISE EXCEPTION 'Phase 1 has not been applied: reported_issues.admin_notes still exists.';
  END IF;

  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reported_issues'
      AND column_name IN ('category','priority','last_message_at',
                          'reporter_last_read_at','salci_last_read_at',
                          'first_response_at','resolved_at')
  ) <> 7 THEN
    RAISE EXCEPTION 'Phase 1 has not been applied: reported_issues is missing the new columns.';
  END IF;

  -- The idempotency guarantee below is only as real as this index.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'support_messages'
      AND indexname = 'uq_support_messages_client_token'
  ) THEN
    RAISE EXCEPTION 'Phase 1 has not been applied: uq_support_messages_client_token is missing.';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- _support_apply_status: the ONE place a support ticket's status moves.
--
-- Called by set_support_ticket_status (the inbox) and by resolve_support_task
-- (the /tasks panel). Both entry points therefore produce identical system
-- rows, identical resolved_at stamps and identical notifications.
--
-- The task mirroring below is preserved VERBATIM from
-- 20260814150000_support_harden_grants_and_resolve.sql:167-191, including:
--   * the completed-task guard (the trigger raises 'Completed tasks cannot be
--     modified', so a completed task is never touched), and
--   * the done_pending_approval step-off (that state needs the ASSIGNER to
--     approve, and the assigner is the reporter, who a RESTRICTIVE policy
--     blocks, so the ticket would be stuck forever while the UPDATE matched
--     zero rows and reported_issues flipped anyway: a silent divergence).
--
-- DEPENDENCY, unchanged by this migration: validate_task_state_transition() is
-- a check-list with no trailing ELSE, so (open|in_progress) -> completed and
-- open -> rejected are unguarded. Hardening that trigger breaks support
-- resolution unless those pairs are added to its allow-list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._support_apply_status(
  p_ticket_id    uuid,
  p_status       text,
  p_note         text,
  p_client_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_prev        text;
  v_task        uuid;
  v_task_status public.task_status;
  v_note        text;
  v_reporter    uuid;
  v_subject     text;
  v_actor       uuid;
  v_actor_name  text;
  v_label       text;
  v_changed     boolean;
  v_wrote       boolean := false;
  v_note_new    boolean := false;
  v_existing    uuid;
  v_has_profile boolean := false;
  v_to_email    text;
  v_to_name     text;
  v_kind        text;
  v_preview     text;
  v_notify      jsonb := NULL;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can update a support request.';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown status for a support request.';
  END IF;

  v_note := nullif(btrim(coalesce(p_note, '')), '');

  SELECT ri.status, ri.task_id, ri.reporter_id, ri.subject
    INTO v_prev, v_task, v_reporter, v_subject
  FROM public.reported_issues ri
  WHERE ri.id = p_ticket_id;

  -- subject is NOT NULL on the table, so a NULL here means "no such row".
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  v_changed := v_prev IS DISTINCT FROM p_status;

  -- The actor snapshot. author_id references profiles(id); resolve it rather
  -- than assuming auth.uid() has a profiles row.
  SELECT p.id, p.full_name INTO v_actor, v_actor_name
  FROM public.profiles p WHERE p.id = v_uid;

  v_label := CASE p_status
               WHEN 'open'        THEN 'reopened'
               WHEN 'in_progress' THEN 'in progress'
               WHEN 'resolved'    THEN 'resolved'
               ELSE                    'closed'
             END;

  -- resolved_at is stamped on entry to resolved/closed and cleared otherwise.
  -- It exists because updated_at is bumped by a trigger on every edit and so
  -- cannot serve as a resolution timestamp. coalesce keeps the FIRST
  -- resolution time across a resolved -> closed move.
  UPDATE public.reported_issues
  SET status      = p_status,
      resolved_at = CASE WHEN p_status IN ('resolved', 'closed')
                         THEN coalesce(resolved_at, now())
                         ELSE NULL END,
      updated_at  = now()
  WHERE id = p_ticket_id;

  -- The system row is NOT tokenised, deliberately. v_changed already makes it
  -- idempotent: a retry sees the status it just wrote and inserts nothing. A
  -- content-derived token would be worse than nothing here, because a genuine
  -- open -> resolved -> open -> resolved sequence must produce TWO 'resolved'
  -- system rows and a deterministic token would silently swallow the second.
  IF v_changed THEN
    INSERT INTO public.support_messages (
      ticket_id, author_id, author_name, author_side, kind, body, is_internal
    ) VALUES (
      p_ticket_id, v_actor, coalesce(v_actor_name, 'SALCI Support'),
      'system', 'system',
      CASE WHEN p_status = 'open'
           THEN 'SALCI reopened this request.'
           ELSE 'SALCI marked this request ' || v_label || '.' END,
      false
    );
    v_wrote := true;
  END IF;

  -- The note is is_internal = false: it is the resolution explanation, and the
  -- inbox promises the reporter can read it. A private note is a different
  -- action, post_support_message(p_is_internal => true).
  --
  -- Idempotency, in two layers:
  --   1. p_client_token supplied (the inbox generates one per send attempt):
  --      uq_support_messages_client_token turns a retry into a lookup.
  --   2. p_client_token NULL: resolve_support_task cannot supply one, because
  --      its signature is frozen by the live TaskDetailPanel call site. So skip
  --      a note byte-identical to one this same actor already filed on this
  --      ticket within the last 30 seconds. That is the network-retry window,
  --      and unlike a content-derived token it cannot swallow a deliberate
  --      repeat of the same sentence minutes or days later.
  IF v_note IS NOT NULL THEN
    IF p_client_token IS NOT NULL THEN
      SELECT m.id INTO v_existing
      FROM public.support_messages m
      WHERE m.client_token = p_client_token;
    ELSE
      SELECT m.id INTO v_existing
      FROM public.support_messages m
      WHERE m.ticket_id = p_ticket_id
        AND m.author_side = 'salci'
        AND m.kind = 'message'
        AND m.is_internal = false
        AND m.body = v_note
        AND m.author_id IS NOT DISTINCT FROM v_actor
        AND m.created_at > now() - interval '30 seconds'
      ORDER BY m.created_at DESC
      LIMIT 1;
    END IF;

    IF v_existing IS NULL THEN
      INSERT INTO public.support_messages (
        ticket_id, author_id, author_name, author_side, kind, body, is_internal, client_token
      ) VALUES (
        p_ticket_id, v_actor, coalesce(v_actor_name, 'SALCI Support'),
        'salci', 'message', v_note, false, p_client_token
      );
      v_wrote    := true;
      v_note_new := true;
    END IF;
  END IF;

  -- last_message_at drives unread on both sides and awaiting_salci in the
  -- inbox. Every path that writes a message has to bump it.
  IF v_wrote THEN
    UPDATE public.reported_issues
    SET last_message_at   = now(),
        first_response_at = CASE WHEN v_note_new
                                 THEN coalesce(first_response_at, now())
                                 ELSE first_response_at END
    WHERE id = p_ticket_id;
  END IF;

  -- --- linked task mirroring, preserved verbatim -----------------------------
  IF v_task IS NOT NULL THEN
    SELECT t.status INTO v_task_status FROM public.tasks t WHERE t.id = v_task;

    IF v_task_status IS NOT NULL AND v_task_status <> 'completed' THEN
      -- Step off the approval dead-end before closing.
      IF v_task_status = 'done_pending_approval' AND p_status IN ('resolved', 'closed') THEN
        UPDATE public.tasks SET status = 'in_progress' WHERE id = v_task;
        v_task_status := 'in_progress';
      END IF;

      IF p_status = 'resolved' THEN
        UPDATE public.tasks SET status = 'completed'
        WHERE id = v_task AND status IN ('open', 'in_progress', 'rejected');
      ELSIF p_status = 'closed' THEN
        UPDATE public.tasks SET status = 'rejected'
        WHERE id = v_task AND status IN ('open', 'in_progress');
      ELSIF p_status = 'in_progress' THEN
        UPDATE public.tasks SET status = 'in_progress'
        WHERE id = v_task AND status = 'open';
      END IF;
    END IF;
  END IF;

  -- --- reporter notification -------------------------------------------------
  -- Gated on v_note_new, not on "a note was passed", so a deduped retry does
  -- not deliver a second notification for a note it did not write.
  --
  -- notifications.user_id is NOT NULL and references profiles(id), while
  -- reported_issues.reporter_id references auth.users(id). Check for the
  -- profile before inserting rather than betting on the FK.
  IF v_reporter IS NOT NULL AND (v_changed OR v_note_new) THEN
    SELECT p.email, p.full_name, true INTO v_to_email, v_to_name, v_has_profile
    FROM public.profiles p WHERE p.id = v_reporter;
  END IF;

  IF coalesce(v_has_profile, false) AND v_reporter <> v_uid THEN
    v_kind := CASE
                WHEN v_changed AND p_status = 'open' THEN 'support_reopened'
                WHEN v_changed                       THEN 'support_status_changed'
                ELSE                                      'support_reply'
              END;

    v_preview := left(coalesce(v_note,
                   CASE WHEN p_status = 'open'
                        THEN 'Your request has been reopened.'
                        ELSE 'Your request is now ' || v_label || '.' END), 160);

    INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
    VALUES (
      v_reporter,
      v_kind,
      CASE WHEN v_changed
           THEN 'Support request ' || v_label
           ELSE 'SALCI replied to your support request' END,
      left(v_subject, 80) || ': ' || v_preview,
      '/support?ticket=' || p_ticket_id::text,
      jsonb_build_object('ticket_id', p_ticket_id, 'status', p_status)
    );

    v_notify := jsonb_build_object(
      'to_user_id', v_reporter,
      'to_email',   v_to_email,
      'to_name',    v_to_name,
      'kind',       v_kind,
      'ticket_id',  p_ticket_id,
      'subject',    v_subject,
      'preview',    v_preview
    );
  END IF;

  RETURN jsonb_build_object(
    'ticket_id', p_ticket_id,
    'status',    p_status,
    'notify',    v_notify
  );
END;
$$;

COMMENT ON FUNCTION public._support_apply_status(uuid, text, text, uuid) IS
  'Internal. The ONE write path for a Salci Support status change: intake row, resolved_at, system message, optional REPORTER-VISIBLE note, linked task mirror, reporter notification. The note reaches support_messages only, never task_comments. Called only by set_support_ticket_status and resolve_support_task. Not callable by authenticated.';

-- ---------------------------------------------------------------------------
-- list_my_support_tickets: the reporter's own tickets.
--
-- The reporter has NO direct SELECT on reported_issues after Phase 1; this RPC
-- is their only read path, and it returns an explicit column list so a future
-- column cannot leak by accident.
--
-- Scale gate: p_limit is clamped to 100, one extra row is fetched to compute
-- has_more, and message_count / has_unread are computed in Postgres. Nothing
-- is counted by shipping rows to the browser.
--
-- The 'counts' key exists for the same reason: the reporter page shows Active /
-- Awaiting reply / Resolved stat tiles, and counting the returned page in the
-- browser would both violate the scale gate and go silently wrong past the
-- 100-row clamp. counts is aggregated over ALL of the caller's tickets and is
-- deliberately NOT bounded by p_limit / p_offset.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_my_support_tickets(
  p_limit  int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_limit    int;
  v_offset   int;
  v_tickets  jsonb;
  v_has_more boolean;
  v_counts   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to view your support requests.';
  END IF;

  v_limit  := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  WITH page AS (
    SELECT ri.id,
           ri.subject,
           ri.description,
           ri.status,
           ri.category,
           ri.priority,
           ri.reporter_name,
           ri.reporter_email,
           ri.reporter_role,
           ri.institution_name,
           ri.created_at,
           ri.last_message_at,
           ri.resolved_at,
           ri.first_response_at,
           ri.reporter_last_read_at
    FROM public.reported_issues ri
    WHERE ri.reporter_id = v_uid
    ORDER BY coalesce(ri.last_message_at, ri.created_at) DESC, ri.id
    LIMIT v_limit + 1
    OFFSET v_offset
  ),
  ranked AS (
    -- row_number is computed before LIMIT at the same query level, so it has
    -- to be applied in an OUTER query or a non-zero p_offset shifts it.
    SELECT p.*,
           row_number() OVER (ORDER BY coalesce(p.last_message_at, p.created_at) DESC, p.id) AS rn
    FROM page p
  )
  SELECT
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',                r.id,
          'subject',           r.subject,
          'description',       r.description,
          'status',            r.status,
          'category',          r.category,
          'priority',          r.priority,
          'reporter_name',     r.reporter_name,
          'reporter_email',    r.reporter_email,
          'reporter_role',     r.reporter_role,
          'institution_name',  r.institution_name,
          'created_at',        r.created_at,
          'last_message_at',   r.last_message_at,
          'resolved_at',       r.resolved_at,
          'first_response_at', r.first_response_at,
          'message_count',     (SELECT count(*) FROM public.support_messages m
                                WHERE m.ticket_id = r.id AND m.is_internal = false),
          'has_unread',        EXISTS (SELECT 1 FROM public.support_messages m
                                       WHERE m.ticket_id = r.id
                                         AND m.is_internal = false
                                         AND m.author_side <> 'reporter'
                                         AND m.created_at > coalesce(r.reporter_last_read_at,
                                                                     'epoch'::timestamptz))
        )
        ORDER BY r.rn
      ) FILTER (WHERE r.rn <= v_limit),
      '[]'::jsonb
    ),
    count(*) FILTER (WHERE r.rn > v_limit) > 0
  INTO v_tickets, v_has_more
  FROM ranked r;

  -- Aggregated over EVERY ticket this reporter owns, not just the page above.
  SELECT jsonb_build_object(
    'active',   count(*) FILTER (WHERE status IN ('open', 'in_progress')),
    'awaiting', count(*) FILTER (
                  WHERE last_message_at > coalesce(reporter_last_read_at, 'epoch'::timestamptz)),
    'resolved', count(*) FILTER (WHERE status IN ('resolved', 'closed')),
    'total',    count(*)
  )
  INTO v_counts
  FROM public.reported_issues
  WHERE reporter_id = v_uid;

  RETURN jsonb_build_object(
    'tickets',  coalesce(v_tickets, '[]'::jsonb),
    'has_more', coalesce(v_has_more, false),
    'counts',   coalesce(v_counts,
                  jsonb_build_object('active', 0, 'awaiting', 0, 'resolved', 0, 'total', 0))
  );
END;
$$;

COMMENT ON FUNCTION public.list_my_support_tickets(int, int) IS
  'The caller''s own Salci Support tickets, newest activity first, plus unclamped counts (active, awaiting, resolved, total). p_limit clamped to 100. The reporter''s only read path onto reported_issues.';

-- ---------------------------------------------------------------------------
-- get_support_thread: ticket header plus one cursor page of messages.
--
-- Internal rows are omitted for anyone who is not a super admin. That omission
-- happens here, in the RPC, so the reporter surface can never render one even
-- by mistake: it never receives one.
--
-- Cursor, not offset: p_before is the created_at of the oldest message the
-- client already holds. Messages come back oldest-first for direct rendering.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_support_thread(
  p_ticket_id uuid,
  p_limit     int DEFAULT 50,
  p_before    timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_limit    int;
  v_ticket   jsonb;
  v_messages jsonb;
  v_has_more boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to view a support request.';
  END IF;

  IF NOT public.can_access_support_ticket(p_ticket_id) THEN
    RAISE EXCEPTION 'You do not have access to this support request.';
  END IF;

  v_is_admin := public.is_super_admin(v_uid);
  v_limit    := least(greatest(coalesce(p_limit, 50), 1), 100);

  SELECT jsonb_build_object(
    'id',                ri.id,
    'subject',           ri.subject,
    'description',       ri.description,
    'status',            ri.status,
    'category',          ri.category,
    'priority',          ri.priority,
    'reporter_name',     ri.reporter_name,
    'reporter_email',    ri.reporter_email,
    'reporter_role',     ri.reporter_role,
    'institution_name',  ri.institution_name,
    'created_at',        ri.created_at,
    'last_message_at',   ri.last_message_at,
    'resolved_at',       ri.resolved_at,
    'first_response_at', ri.first_response_at,
    'message_count',     (SELECT count(*) FROM public.support_messages m
                          WHERE m.ticket_id = ri.id
                            AND (v_is_admin OR m.is_internal = false)),
    'has_unread',        EXISTS (
                           SELECT 1 FROM public.support_messages m
                           WHERE m.ticket_id = ri.id
                             AND (v_is_admin OR m.is_internal = false)
                             AND m.author_side <> CASE WHEN v_is_admin THEN 'salci' ELSE 'reporter' END
                             AND m.created_at > coalesce(
                                   CASE WHEN v_is_admin THEN ri.salci_last_read_at
                                        ELSE ri.reporter_last_read_at END,
                                   'epoch'::timestamptz))
  )
  INTO v_ticket
  FROM public.reported_issues ri
  WHERE ri.id = p_ticket_id;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  WITH page AS (
    SELECT m.id,
           m.author_side,
           m.author_name,
           m.kind,
           m.body,
           m.is_internal,
           m.attachments,
           m.created_at
    FROM public.support_messages m
    WHERE m.ticket_id = p_ticket_id
      AND (v_is_admin OR m.is_internal = false)
      AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT v_limit + 1
  ),
  ranked AS (
    SELECT p.*,
           row_number() OVER (ORDER BY p.created_at DESC, p.id DESC) AS rn
    FROM page p
  )
  SELECT
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',          r.id,
          'author_side', r.author_side,
          'author_name', r.author_name,
          'kind',        r.kind,
          'body',        r.body,
          'is_internal', r.is_internal,
          'attachments', coalesce(r.attachments, '[]'::jsonb),
          'created_at',  r.created_at
        )
        ORDER BY r.created_at ASC, r.id ASC
      ) FILTER (WHERE r.rn <= v_limit),
      '[]'::jsonb
    ),
    count(*) FILTER (WHERE r.rn > v_limit) > 0
  INTO v_messages, v_has_more
  FROM ranked r;

  RETURN jsonb_build_object(
    'ticket',   v_ticket,
    'messages', coalesce(v_messages, '[]'::jsonb),
    'has_more', coalesce(v_has_more, false)
  );
END;
$$;

COMMENT ON FUNCTION public.get_support_thread(uuid, int, timestamptz) IS
  'One cursor page of a Salci Support thread, oldest first, plus the ticket header. Internal rows are returned only to super admins.';

-- ---------------------------------------------------------------------------
-- mark_support_ticket_read: stamp the caller's side. Naturally idempotent.
--
-- Unread is computed from these two stamps against support_messages, so there
-- is no per-message read table to keep in step.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_support_ticket_read(p_ticket_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to view a support request.';
  END IF;

  IF public.is_super_admin(v_uid) THEN
    UPDATE public.reported_issues
    SET salci_last_read_at = now()
    WHERE id = p_ticket_id;
  ELSIF public.is_support_ticket_reporter(p_ticket_id) THEN
    UPDATE public.reported_issues
    SET reporter_last_read_at = now()
    WHERE id = p_ticket_id;
  ELSE
    RAISE EXCEPTION 'You do not have access to this support request.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.mark_support_ticket_read(uuid) IS
  'Stamp reporter_last_read_at or salci_last_read_at by caller side. Idempotent.';

-- ---------------------------------------------------------------------------
-- support_inbox_counts, extended with awaiting_salci and a p_status scope.
--
-- The four per-status keys (open, in_progress, resolved, closed) and total are
-- computed across EVERY status and are deliberately NOT affected by p_status,
-- so the inbox tab badges keep working exactly as they do today.
--
-- awaiting_salci is the number behind the Awaiting SALCI chip: the thread moved
-- after SALCI last read it. That chip lives INSIDE one status tab and filters
-- that tab's rows, so the number it prints has to be measured over that same
-- status, or the Closed tab can read "Awaiting SALCI (7)" and then filter to
-- nothing. p_status is what makes them agree: when it is supplied, awaiting_salci
-- counts only tickets in that status; when it is NULL the platform-wide default
-- (open + in_progress) is kept for any caller that wants the whole backlog.
--
-- RULE for anyone touching this later: the count and the list filter it labels
-- must always measure the same set. Change one and you change both.
--
-- MECHANIC: the live function is support_inbox_counts(uuid, text). Adding a
-- third parameter creates a NEW function rather than replacing that one, so the
-- two-argument version is DROPped first. Leaving both behind would give
-- PostgREST two overloads to resolve between, and would leave an over-granted
-- function standing, because the REVOKE block at the bottom of this file names
-- only the three-argument signature.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.support_inbox_counts(uuid, text);

CREATE OR REPLACE FUNCTION public.support_inbox_counts(
  p_institution_id uuid DEFAULT NULL,
  p_role           text DEFAULT NULL,
  p_status         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only SALCI support can view the support inbox.';
  END IF;

  IF p_status IS NOT NULL
     AND p_status NOT IN ('open', 'in_progress', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown support status filter.';
  END IF;

  SELECT jsonb_build_object(
    'open',           count(*) FILTER (WHERE status = 'open'),
    'in_progress',    count(*) FILTER (WHERE status = 'in_progress'),
    'resolved',       count(*) FILTER (WHERE status = 'resolved'),
    'closed',         count(*) FILTER (WHERE status = 'closed'),
    'awaiting_salci', count(*) FILTER (
                        WHERE (CASE
                                 WHEN p_status IS NULL
                                   THEN status IN ('open', 'in_progress')
                                 ELSE status = p_status
                               END)
                          AND last_message_at > coalesce(salci_last_read_at, 'epoch'::timestamptz)),
    'total',          count(*)
  )
  INTO v
  FROM public.reported_issues
  WHERE (p_institution_id IS NULL OR institution_id = p_institution_id)
    AND (p_role IS NULL OR reporter_role = p_role);

  RETURN v;
END;
$$;

COMMENT ON FUNCTION public.support_inbox_counts(uuid, text, text) IS
  'Per-status counts for the Salci Support inbox, plus awaiting_salci. The per-status keys and total always cover every status; p_status scopes awaiting_salci to one tab so the chip count and the list it filters measure the same set. Super admins only.';

-- ---------------------------------------------------------------------------
-- get_support_ticket_transcript: everything, including internal notes.
--
-- Super admin only, and deliberately unpaginated: a transcript is a whole
-- document or it is nothing. A support thread is a conversation between two
-- people, so the row count is bounded in practice by the 30-per-hour throttle
-- in post_support_message rather than by data growth.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_support_ticket_transcript(p_ticket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_ticket   jsonb;
  v_messages jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can export a support transcript.';
  END IF;

  SELECT jsonb_build_object(
    'id',                ri.id,
    'subject',           ri.subject,
    'description',       ri.description,
    'status',            ri.status,
    'category',          ri.category,
    'priority',          ri.priority,
    'reporter_name',     ri.reporter_name,
    'reporter_email',    ri.reporter_email,
    'reporter_role',     ri.reporter_role,
    'institution_name',  ri.institution_name,
    'created_at',        ri.created_at,
    'last_message_at',   ri.last_message_at,
    'resolved_at',       ri.resolved_at,
    'first_response_at', ri.first_response_at,
    'message_count',     (SELECT count(*) FROM public.support_messages m
                          WHERE m.ticket_id = ri.id),
    'has_unread',        ri.last_message_at > coalesce(ri.salci_last_read_at, 'epoch'::timestamptz)
  )
  INTO v_ticket
  FROM public.reported_issues ri
  WHERE ri.id = p_ticket_id;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',          m.id,
        'author_side', m.author_side,
        'author_name', m.author_name,
        'kind',        m.kind,
        'body',        m.body,
        'is_internal', m.is_internal,
        'attachments', coalesce(m.attachments, '[]'::jsonb),
        'created_at',  m.created_at
      )
      ORDER BY m.created_at ASC, m.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_messages
  FROM public.support_messages m
  WHERE m.ticket_id = p_ticket_id;

  RETURN jsonb_build_object('ticket', v_ticket, 'messages', v_messages);
END;
$$;

COMMENT ON FUNCTION public.get_support_ticket_transcript(uuid) IS
  'Full Salci Support ticket transcript including internal notes. Super admins only. Feeds the PDF export.';

-- ---------------------------------------------------------------------------
-- post_support_message: the whole write path for a reply, in one transaction.
--
-- This is the ONLY place a support message is created, and the only place the
-- ticket moves as a side effect of a message. support_messages has no INSERT,
-- UPDATE or DELETE policy at all, so the internal/external split cannot be
-- forged from a client: there is no client write path to forge it through.
--
-- The twelve steps, in order:
--   1  reject an anonymous caller
--   2  resolve the side, freeze it (a super admin who is also the reporter is
--      'salci', matching the two prod tickets the support owner filed)
--   3  reject an internal note from a reporter
--   4  reject an empty body with no attachments
--   5  idempotency: a repeated client_token returns the first message
--   6  resolve the caller's profiles row and reject a caller who has none, and
--      snapshot author_name (profiles RLS hides each side from the other, so a
--      join at read time is impossible; the snapshot is the attribution)
--   7  throttle: 30 messages per caller per hour
--   8  insert the message
--   9  last_message_at, and first_response_at on the first PUBLIC salci reply
--   10 implicit status moves, each with its own system row
--   11 notify the other side, never for an internal note
--   12 return message_id, status and the notify payload for the email function
--
-- STEP 6 MUST STAY AHEAD OF STEP 7. author_id is NULL for a caller with no
-- profiles row, and the step 7 throttle counts rows BY author_id, so a NULL
-- author_id would match nothing and such a caller would post an unlimited
-- number of messages on an RPC every authenticated user can reach.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_support_message(
  p_ticket_id    uuid,
  p_body         text,
  p_is_internal  boolean DEFAULT false,
  p_attachments  jsonb   DEFAULT '[]'::jsonb,
  p_client_token uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_is_admin     boolean;
  v_is_reporter  boolean;
  v_internal     boolean := coalesce(p_is_internal, false);
  v_side         text;
  v_body         text;
  v_atts         jsonb;
  v_status       text;
  v_new_status   text;
  v_reporter     uuid;
  v_subject      text;
  v_task         uuid;
  v_task_status  public.task_status;
  v_author       uuid;
  v_name         text;
  v_msg          uuid;
  v_recent       int;
  v_reopened     boolean := false;
  v_target       uuid;
  v_to_email     text;
  v_to_name      text;
  v_has_profile  boolean := false;
  v_kind         text;
  v_title        text;
  v_link         text;
  v_preview      text;
  v_notify       jsonb := NULL;
BEGIN
  -- 1 -----------------------------------------------------------------------
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to reply to a support request.';
  END IF;

  SELECT ri.status, ri.reporter_id, ri.subject, ri.task_id
    INTO v_status, v_reporter, v_subject, v_task
  FROM public.reported_issues ri
  WHERE ri.id = p_ticket_id;

  -- subject is NOT NULL on the table, so a NULL here means "no such row".
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  -- 2 -----------------------------------------------------------------------
  v_is_admin    := public.is_super_admin(v_uid);
  v_is_reporter := (v_reporter IS NOT NULL AND v_reporter = v_uid);

  IF v_is_admin THEN
    v_side := 'salci';
  ELSIF v_is_reporter THEN
    v_side := 'reporter';
  ELSE
    RAISE EXCEPTION 'You do not have access to this support request.';
  END IF;

  -- 3 -----------------------------------------------------------------------
  IF v_internal AND v_side <> 'salci' THEN
    RAISE EXCEPTION 'Only SALCI support can add an internal note.';
  END IF;

  -- 4 -----------------------------------------------------------------------
  v_body := btrim(coalesce(p_body, ''));
  v_atts := coalesce(p_attachments, '[]'::jsonb);
  IF jsonb_typeof(v_atts) <> 'array' THEN
    v_atts := '[]'::jsonb;
  END IF;

  IF v_body = '' AND jsonb_array_length(v_atts) = 0 THEN
    RAISE EXCEPTION 'Please write a message or attach a file before sending.';
  END IF;

  -- 5 -----------------------------------------------------------------------
  -- Backed by the partial unique index on client_token. A double tap or a
  -- retry after a dropped response returns the first message and writes
  -- nothing at all.
  IF p_client_token IS NOT NULL THEN
    SELECT m.id INTO v_msg
    FROM public.support_messages m
    WHERE m.client_token = p_client_token;

    IF v_msg IS NOT NULL THEN
      RETURN jsonb_build_object(
        'message_id', v_msg,
        'status',     v_status,
        'notify',     NULL
      );
    END IF;
  END IF;

  -- 6 -----------------------------------------------------------------------
  -- author_id references profiles(id), so it is NULL for a caller who has no
  -- profiles row. That MUST be rejected here, before the throttle: the throttle
  -- counts rows by author_id, so a NULL author_id would match nothing and such
  -- a caller would post an unlimited number of messages on an RPC any
  -- authenticated user can reach. Every real SALCI account has a profiles row
  -- (handle_new_user creates it), so this only ever fires on a broken account.
  SELECT p.id, p.full_name INTO v_author, v_name
  FROM public.profiles p WHERE p.id = v_uid;

  IF v_author IS NULL THEN
    RAISE EXCEPTION 'Your account is not set up for support messages yet. Please contact SALCI support.';
  END IF;

  -- 7 -----------------------------------------------------------------------
  -- Backed by idx_support_messages_author. Aggregated server side; no rows
  -- cross the wire to be counted.
  SELECT count(*) INTO v_recent
  FROM public.support_messages m
  WHERE m.author_id = v_author
    AND m.created_at > now() - interval '1 hour';

  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'You have sent 30 support messages in the last hour. Please wait a little before sending another.';
  END IF;

  -- 8 -----------------------------------------------------------------------
  INSERT INTO public.support_messages (
    ticket_id, author_id, author_name, author_side, kind,
    body, is_internal, attachments, client_token
  ) VALUES (
    p_ticket_id,
    v_author,
    coalesce(v_name, CASE WHEN v_side = 'salci' THEN 'SALCI Support' ELSE 'Reporter' END),
    v_side,
    'message',
    v_body,
    v_internal,
    v_atts,
    p_client_token
  )
  RETURNING id INTO v_msg;

  -- 9 -----------------------------------------------------------------------
  -- An internal note must NOT bump last_message_at: awaiting_salci is derived
  -- from it, and SALCI's own private note is not something SALCI is waiting on.
  -- first_response_at is stamped on the first PUBLIC salci message only; an
  -- internal note is not a response.
  UPDATE public.reported_issues
  SET last_message_at   = CASE WHEN v_internal THEN last_message_at ELSE now() END,
      first_response_at = CASE WHEN v_side = 'salci' AND NOT v_internal
                               THEN coalesce(first_response_at, now())
                               ELSE first_response_at END,
      updated_at        = now()
  WHERE id = p_ticket_id;

  -- 10 ----------------------------------------------------------------------
  v_new_status := v_status;

  IF NOT v_internal THEN
    IF v_side = 'salci' AND v_status = 'open' THEN
      v_new_status := 'in_progress';

      UPDATE public.reported_issues
      SET status = 'in_progress', updated_at = now()
      WHERE id = p_ticket_id;

      INSERT INTO public.support_messages (
        ticket_id, author_id, author_name, author_side, kind, body, is_internal
      ) VALUES (
        p_ticket_id, v_author, coalesce(v_name, 'SALCI Support'),
        'system', 'system', 'SALCI started working on this.', false
      );

      -- Mirror onto the linked task with the same mapping and the same
      -- completed-task guard the status RPC uses.
      IF v_task IS NOT NULL THEN
        SELECT t.status INTO v_task_status FROM public.tasks t WHERE t.id = v_task;
        IF v_task_status IS NOT NULL AND v_task_status = 'open' THEN
          UPDATE public.tasks SET status = 'in_progress'
          WHERE id = v_task AND status = 'open';
        END IF;
      END IF;

    ELSIF v_side = 'reporter' AND v_status IN ('resolved', 'closed') THEN
      v_new_status := 'open';
      v_reopened   := true;

      UPDATE public.reported_issues
      SET status = 'open', resolved_at = NULL, updated_at = now()
      WHERE id = p_ticket_id;

      INSERT INTO public.support_messages (
        ticket_id, author_id, author_name, author_side, kind, body, is_internal
      ) VALUES (
        p_ticket_id, v_author, coalesce(v_name, 'Reporter'),
        'system', 'system', 'Reopened by the reporter.', false
      );

      -- The linked task is deliberately NOT touched here. By this point it is
      -- completed or rejected, and the task trigger raises 'Completed tasks
      -- cannot be modified'. The reopen lives on the ticket, which is the
      -- record both surfaces read.
    END IF;
  END IF;

  -- 11 ----------------------------------------------------------------------
  IF NOT v_internal THEN
    IF v_side = 'salci' THEN
      v_target := v_reporter;
      v_kind   := 'support_reply';
      v_title  := 'SALCI replied to your support request';
      v_link   := '/support?ticket=' || p_ticket_id::text;
    ELSE
      v_target := public.get_support_owner_id();
      v_kind   := CASE WHEN v_reopened THEN 'support_reopened' ELSE 'support_reply' END;
      v_title  := CASE WHEN v_reopened
                       THEN 'Support request reopened'
                       ELSE 'New reply on a support request' END;
      v_link   := '/admin/issues?ticket=' || p_ticket_id::text;
    END IF;

    v_preview := left(coalesce(nullif(v_body, ''), 'Sent an attachment.'), 160);

    -- notifications.user_id is NOT NULL and references profiles(id), while
    -- reported_issues.reporter_id references auth.users(id). Check for the
    -- profile row before inserting rather than betting on the FK.
    IF v_target IS NOT NULL AND v_target <> v_uid THEN
      SELECT p.email, p.full_name, true INTO v_to_email, v_to_name, v_has_profile
      FROM public.profiles p WHERE p.id = v_target;
    END IF;

    IF coalesce(v_has_profile, false) THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
      VALUES (
        v_target,
        v_kind,
        v_title,
        left(v_subject, 80) || ': ' || v_preview,
        v_link,
        jsonb_build_object('ticket_id', p_ticket_id, 'message_id', v_msg)
      );

      v_notify := jsonb_build_object(
        'to_user_id', v_target,
        'to_email',   v_to_email,
        'to_name',    v_to_name,
        'kind',       v_kind,
        'ticket_id',  p_ticket_id,
        'subject',    v_subject,
        'preview',    v_preview
      );
    END IF;
  END IF;

  -- 12 ----------------------------------------------------------------------
  RETURN jsonb_build_object(
    'message_id', v_msg,
    'status',     v_new_status,
    'notify',     v_notify
  );
END;
$$;

COMMENT ON FUNCTION public.post_support_message(uuid, text, boolean, jsonb, uuid) IS
  'The only write path for a Salci Support message. Resolves and freezes the author side, rejects an internal note from a reporter, rejects a caller with no profiles row BEFORE the throttle (author_id NULL would otherwise sidestep it), is idempotent on client_token, throttled to 30 per caller per hour, auto-reopens a resolved ticket, moves open to in_progress on the first SALCI reply, and notifies the other side. Returns the notify payload so the client can send the email without a second round trip.';

-- ---------------------------------------------------------------------------
-- set_support_ticket_status: the inbox entry point, now a thin wrapper.
--
-- MECHANIC: the live function RETURNS void. Postgres cannot CREATE OR REPLACE
-- a function with a different return type (42P13), so it must be DROPped
-- first. The drop also resets its ACL, which the REVOKE block at the bottom of
-- this file re-establishes.
--
-- p_client_token is new, and is the reason the drop is not merely a return-type
-- change. It is what makes the note write idempotent: the inbox generates one
-- uuid per send attempt, so a retry after a dropped response is a lookup rather
-- than a duplicate note plus a duplicate notification. It is optional and
-- trails the existing arguments, and the live call site passes arguments by
-- name, so nothing on the client moves.
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE, not CREATE: the DROP above names the THREE-argument
-- signature, so on a second run of this file it matches nothing and a bare
-- CREATE would then fail 42723 against the four-argument function this run
-- leaves behind. Every other statement in this migration is already re-runnable
-- (CREATE OR REPLACE, DROP IF EXISTS, a NOT EXISTS-guarded backfill, a
-- forward-only UPDATE, idempotent REVOKE/GRANT), so this was the one statement
-- standing between the file and being safe to re-apply. That matters here: the
-- migration ledger is not maintained in this repo, so a file can be applied
-- twice by accident.
DROP FUNCTION IF EXISTS public.set_support_ticket_status(uuid, text, text);

CREATE OR REPLACE FUNCTION public.set_support_ticket_status(
  p_ticket_id    uuid,
  p_status       text,
  p_note         text DEFAULT NULL,
  p_client_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._support_apply_status(p_ticket_id, p_status, p_note, p_client_token);
END;
$$;

COMMENT ON FUNCTION public.set_support_ticket_status(uuid, text, text, uuid) IS
  'Move a Salci Support ticket from the inbox. Super admins only. Thin wrapper over _support_apply_status so the inbox and the /tasks panel produce identical system rows, resolved_at stamps and notifications. p_client_token makes a retried send idempotent. Returns { ticket_id, status, notify }.';

-- ---------------------------------------------------------------------------
-- resolve_support_task: the /tasks entry point.
--
-- MUST NOT be dropped and MUST keep RETURNS void: it is live at
-- src/components/tms/TaskDetailPanel.tsx via useResolveSupportRequest, and it
-- is how the support owner resolves a ticket from their habitual surface.
--
-- Rewritten as a wrapper. The outcome vocabulary maps completed -> resolved and
-- rejected -> closed, then the shared routine does everything else, including
-- the done_pending_approval step-off, the completed-task guard, the system row
-- and the reporter notification.
--
-- THE task_comments INSERT IS GONE, DELIBERATELY. The previous body wrote the
-- same note string into BOTH public.task_comments and public.support_messages.
-- The task_comments SELECT policy admits get_task_assigner(task_id) =
-- auth.uid(), and on a support ticket the assigner IS the reporter, so that
-- copy was reporter-visible while the support_messages copy was internal: one
-- string, two visibilities. The note now reaches ONE plane, support_messages,
-- as a reporter-visible message. Do not reintroduce the second write.
--
-- Because the signature stays void, the notify payload is discarded on this
-- path: the in-app notification is still written inside the transaction (it is
-- the durable channel), but no email is sent from /tasks. That is a deliberate
-- trade for not breaking a live call site.
--
-- p_client_token cannot be threaded here for the same reason: the signature is
-- frozen. NULL is passed explicitly, which selects the 30-second identical-note
-- guard inside _support_apply_status instead of the unique-index path. That
-- covers the network-retry window without the collision a content-derived
-- token would introduce.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_support_task(
  p_task_id uuid,
  p_outcome text,
  p_note    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_inst      uuid;
  v_task_inst uuid;
  v_status    text;
  v_ticket    uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'Only SALCI support can resolve a support request.';
  END IF;

  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'rejected') THEN
    RAISE EXCEPTION 'Unknown outcome for a support request.';
  END IF;

  v_status := CASE WHEN p_outcome = 'completed' THEN 'resolved' ELSE 'closed' END;

  -- Authority on the unforgeable marker, not on a client-writable flag: no
  -- client can create a tasks row in the SALCI Support institution, because the
  -- tasks INSERT policy pins institution_id to the author's own school.
  v_inst := public.get_support_institution_id();

  SELECT t.institution_id INTO v_task_inst
  FROM public.tasks t WHERE t.id = p_task_id;

  IF v_task_inst IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  IF v_inst IS NULL OR v_task_inst <> v_inst THEN
    RAISE EXCEPTION 'That task is not a support request.';
  END IF;

  -- reported_issues.task_id carries only a PLAIN index (idx_reported_issues_task_id),
  -- not a unique constraint, so nothing at the schema level stops two intake
  -- rows pointing at one task. An unordered LIMIT 1 would then resolve an
  -- arbitrary one of them, and a different one on the next call. Order the
  -- lookup so the choice is at least deterministic and reproducible.
  SELECT ri.id INTO v_ticket
  FROM public.reported_issues ri
  WHERE ri.task_id = p_task_id
  ORDER BY ri.created_at, ri.id
  LIMIT 1;

  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'That support request no longer exists.';
  END IF;

  PERFORM public._support_apply_status(v_ticket, v_status, p_note, NULL);
END;
$$;

COMMENT ON FUNCTION public.resolve_support_task(uuid, text, text) IS
  'Resolve a Salci Support ticket from the /tasks panel. Super admins only. Signature preserved for the live TaskDetailPanel call site; body is a wrapper over _support_apply_status so both entry points share one write path. No longer writes to task_comments: the note reaches support_messages only.';

-- ---------------------------------------------------------------------------
-- create_support_task: intake, unchanged in signature, three changes in body.
--
--   1. category and priority are written into the new reported_issues columns.
--      They used to survive only as free text inside tasks.description, which
--      is why the inbox could never filter or report on either.
--   2. The 'Category: ' line is no longer appended to tasks.description: the
--      column is now the record.
--   3. Message 1 is seeded into support_messages from the reporter's own text,
--      so a new ticket opens with content instead of an empty thread, and
--      last_message_at is stamped so the inbox orders it correctly.
--
-- The 5-per-hour throttle, the reporter snapshot, the assigner shape and the
-- owner notification are all unchanged.
--
-- The seeded message deliberately carries no client_token. Intake has no retry
-- that could duplicate it WITHIN a ticket: a retried create_support_task
-- creates a whole new tasks + reported_issues + message triple, which the
-- 5-per-hour throttle above bounds. There is nothing for a token to deduplicate
-- against.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_support_task(
  p_subject     text,
  p_description text,
  p_category    text    DEFAULT NULL,
  p_priority    integer DEFAULT 2,
  p_page_url    text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_owner     uuid;
  v_inst      uuid;
  v_recent    integer;
  v_task      uuid;
  v_ticket    uuid;
  v_priority  integer;
  v_category  text;
  v_subject   text;
  v_body      text;
  v_desc      text;
  v_role      text;
  v_classes   text;
  v_author    uuid;
  v_name      text;
  v_email     text;
  v_rep_inst  uuid;
  v_school    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to contact support.';
  END IF;

  v_subject := nullif(btrim(coalesce(p_subject, '')), '');
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'Please add a subject so we know what this is about.';
  END IF;

  v_body := nullif(btrim(coalesce(p_description, '')), '');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Please describe the issue so we can help.';
  END IF;

  -- Urgency arrives as 1..3; clamp rather than trust the client.
  v_priority := least(greatest(coalesce(p_priority, 2), 1), 3);
  v_category := nullif(btrim(coalesce(p_category, '')), '');

  SELECT count(*) INTO v_recent
  FROM public.reported_issues
  WHERE reporter_id = v_uid
    AND created_at > now() - interval '1 hour';

  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'You have already sent 5 support requests in the last hour. Please wait a little before sending another.';
  END IF;

  v_inst := public.get_support_institution_id();
  IF v_inst IS NULL THEN
    RAISE EXCEPTION 'Support is not set up yet. Please contact SALCI directly.';
  END IF;

  v_owner := public.get_support_owner_id();
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No support owner is configured. Please contact SALCI directly.';
  END IF;

  -- Reporter snapshot. Baked in as TEXT so rendering a ticket never needs a
  -- cross-tenant profiles read: profiles RLS hides the reporter from the SALCI
  -- admin and vice versa.
  SELECT p.id, p.full_name, p.email, p.institution_id, i.name
    INTO v_author, v_name, v_email, v_rep_inst, v_school
  FROM public.profiles p
  LEFT JOIN public.institutions i ON i.id = p.institution_id
  WHERE p.id = v_uid;

  SELECT string_agg(DISTINCT ur.role::text, ', ')
    INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id = v_uid;

  SELECT string_agg(DISTINCT btrim(c.name || ' ' || coalesce(c.section, '')), ', ')
    INTO v_classes
  FROM public.class_assignments ca
  JOIN public.classes c ON c.id = ca.class_id
  WHERE ca.user_id = v_uid;

  v_desc := v_body
    || E'\n\n----------------------------------------\n'
    || 'Reported by: ' || coalesce(v_name, 'Unknown')
    || ' (' || coalesce(v_email, 'no email on file') || ')' || E'\n'
    || 'Role: '   || coalesce(v_role, 'unknown') || E'\n'
    || 'School: ' || coalesce(v_school, 'None')  || E'\n'
    || coalesce('Classes: ' || v_classes  || E'\n', '')
    || coalesce('Page: '    || p_page_url || E'\n', '');

  INSERT INTO public.tasks (institution_id, title, description, task_type, status, priority)
  VALUES (
    v_inst,
    left(v_subject, 200),
    v_desc,
    'general'::public.task_type,
    'open'::public.task_status,
    v_priority
  )
  RETURNING id INTO v_task;

  -- Reporter is the assigner. When the support owner files a ticket
  -- themselves, the no_self_assignment CHECK would reject the row, so fall
  -- back to the established NULL-assigner "SALCI System" shape.
  INSERT INTO public.task_assignments (task_id, assignee_id, assigner_id)
  VALUES (v_task, v_owner, CASE WHEN v_uid = v_owner THEN NULL ELSE v_uid END);

  INSERT INTO public.reported_issues (
    reporter_id, reporter_name, reporter_email, reporter_role,
    institution_name, institution_id, classes_assigned,
    subject, description, status, task_id,
    category, priority, last_message_at
  ) VALUES (
    v_uid, v_name, v_email, v_role,
    v_school, v_rep_inst, v_classes,
    v_subject, v_body, 'open', v_task,
    v_category, v_priority, now()
  )
  RETURNING id INTO v_ticket;

  -- Message 1, from the reporter's own text, so the thread never opens empty.
  -- author_id is the resolved profiles row (NULL when there is none); the
  -- snapshot name carries the attribution either way.
  INSERT INTO public.support_messages (
    ticket_id, author_id, author_name, author_side, kind, body, is_internal
  ) VALUES (
    v_ticket, v_author, coalesce(v_name, 'Reporter'),
    'reporter', 'message', v_body, false
  );

  INSERT INTO public.notifications (user_id, type, title, message, link, metadata)
  VALUES (
    v_owner,
    'task_assigned',
    'New support request',
    coalesce(v_name, 'A user')
      || coalesce(' from ' || v_school, '')
      || ': ' || v_subject,
    '/admin/issues?ticket=' || v_ticket::text,
    jsonb_build_object('task_id', v_task, 'ticket_id', v_ticket, 'category', v_category)
  );

  RETURN jsonb_build_object('ticket_id', v_ticket, 'task_id', v_task);
END;
$$;

COMMENT ON FUNCTION public.create_support_task(text, text, text, integer, text) IS
  'Salci Support intake. Creates a task in the SALCI Support institution assigned to the configured owner with the reporter as assigner, records category and priority on reported_issues, and seeds message 1 into support_messages. Throttled to 5 per caller per hour.';

-- ---------------------------------------------------------------------------
-- Catch-up backfill for the empty-thread window. Idempotent, safe to re-run.
--
-- create_support_task did not seed support_messages until the statement above,
-- so every ticket raised between Phase 1 and Phase 2 opened with an EMPTY
-- thread. Production held two when this migration was written, both filed by
-- real users while Phase 1 was being applied section by section:
--   fbc1807e  "Related to syllabus"
--   908fa9db  "Attendance cannot be edited"
--
-- Phase 1 section 5a guarded on "no message with author_side = 'reporter'".
-- This guards on "no message AT ALL", which is the invariant the reporter
-- surface actually depends on: a thread must never render empty. The two
-- guards agree on every historical row and this one is the stricter of the two.
--
-- author_id is resolved by LEFT JOIN against profiles and is NEVER copied from
-- reporter_id: reported_issues.reporter_id references auth.users(id) while
-- support_messages.author_id references profiles(id). A straight copy is an
-- unguarded FK bet. Where no profile row matches, author_id stays NULL and the
-- author_name snapshot carries the attribution.
-- ---------------------------------------------------------------------------
INSERT INTO public.support_messages (
  ticket_id, author_id, author_name, author_side, kind,
  body, is_internal, attachments, client_token, created_at
)
SELECT
  ri.id,
  p.id,                                   -- NULL when no profile row exists
  coalesce(ri.reporter_name, 'Reporter'),
  'reporter',
  'message',
  ri.description,
  false,
  '[]'::jsonb,
  NULL,
  ri.created_at
FROM public.reported_issues ri
LEFT JOIN public.profiles p ON p.id = ri.reporter_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.support_messages m WHERE m.ticket_id = ri.id
);

-- ---------------------------------------------------------------------------
-- One-off re-derivation of last_message_at.
--
-- The Phase 1 interim bodies inserted into support_messages without bumping
-- last_message_at, and the tickets seeded immediately above have no stamp at
-- all. last_message_at drives unread on BOTH sides and awaiting_salci in the
-- inbox, so a stale value silently switches those off for the affected ticket.
--
-- Only ever moves the stamp FORWARD, so re-running cannot rewrite history.
-- reported_issues carries update_reported_issues_updated_at, so this also bumps
-- updated_at on the rows it touches; that column is already documented as
-- "changed at some point", not as a resolution timestamp (which is why
-- resolved_at exists).
-- ---------------------------------------------------------------------------
UPDATE public.reported_issues ri
SET last_message_at = m.mx
FROM (
  SELECT ticket_id, max(created_at) AS mx
  FROM public.support_messages
  GROUP BY ticket_id
) m
WHERE m.ticket_id = ri.id
  AND (ri.last_message_at IS NULL OR ri.last_message_at < m.mx);

-- Fail the migration rather than leave either invariant silently broken.
DO $backfill$
DECLARE
  v_empty   int;
  v_lagging int;
BEGIN
  SELECT count(*) INTO v_empty
  FROM public.reported_issues ri
  WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m WHERE m.ticket_id = ri.id);

  IF v_empty > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % ticket(s) still have an empty thread.', v_empty;
  END IF;

  SELECT count(*) INTO v_lagging
  FROM public.reported_issues ri
  JOIN (SELECT ticket_id, max(created_at) AS mx
        FROM public.support_messages GROUP BY ticket_id) m ON m.ticket_id = ri.id
  WHERE ri.last_message_at IS NULL OR ri.last_message_at < m.mx;

  IF v_lagging > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % ticket(s) have a last_message_at behind their newest message.', v_lagging;
  END IF;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- Privileges.
--
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE to anon on every new
-- function in public, AND functions carry an implicit EXECUTE grant to PUBLIC.
-- Both must be stripped, BY NAME, on every function:
--   * REVOKE FROM PUBLIC alone leaves the explicit anon grant standing.
--   * REVOKE FROM anon alone leaves the PUBLIC grant standing, and anon is a
--     member of PUBLIC. This is the half that bit on 20260814120000.
--
-- Verify with has_function_privilege(role, oid, 'EXECUTE'), which expands
-- PUBLIC membership and role inheritance. Do NOT use
-- information_schema.routine_privileges: it lists explicit grants only and
-- reads clean while PUBLIC still holds EXECUTE. Do NOT read proacl by eye
-- either: proacl IS NULL is the default-privileges case, in which PUBLIC HAS
-- EXECUTE and there is no aclitem to look at.
--
-- _support_apply_status is internal: authenticated is revoked too. The two
-- wrappers are SECURITY DEFINER owned by postgres, so they call it as postgres
-- and are unaffected.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._support_apply_status(uuid, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_my_support_tickets(int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_support_thread(uuid, int, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.post_support_message(uuid, text, boolean, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_support_ticket_status(uuid, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_support_task(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_support_ticket_read(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_support_ticket_transcript(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public._support_apply_status(uuid, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_my_support_tickets(int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_support_thread(uuid, int, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.post_support_message(uuid, text, boolean, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_support_ticket_status(uuid, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_support_task(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_support_ticket_read(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_support_ticket_transcript(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text) FROM anon;

-- Internal only. Reachable exclusively through the two DEFINER wrappers.
REVOKE EXECUTE ON FUNCTION public._support_apply_status(uuid, text, text, uuid) FROM authenticated;

-- Explicit, because DROP FUNCTION reset the ACL on set_support_ticket_status
-- and on support_inbox_counts, and because relying on default privileges is
-- what produced the leak above.
GRANT EXECUTE ON FUNCTION public.list_my_support_tickets(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_thread(uuid, int, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_support_message(uuid, text, boolean, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_support_ticket_status(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_support_task(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_support_ticket_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.support_inbox_counts(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_ticket_transcript(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_support_task(text, text, text, integer, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- In-migration privilege assertion. Fails the migration rather than leaving a
-- silently over-granted function behind.
--
-- Three separate conditions, because each catches a different mistake:
--   * has_function_privilege('anon', ...)  catches BOTH an explicit anon grant
--     and a PUBLIC grant anon inherits. It is the one that matters.
--   * aclexplode grantee = 0               names PUBLIC specifically, so the
--     failure message says which of the two it was.
--   * the count = 10                       catches a function that was never
--     created at all, which would otherwise pass every other check vacuously.
-- ---------------------------------------------------------------------------
DO $acl$
DECLARE
  v_bad   text;
  v_count int;
BEGIN
  SELECT count(*), string_agg(p.proname, ', ') FILTER (
           WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
              OR p.proacl IS NULL
              OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
    INTO v_count, v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      '_support_apply_status','list_my_support_tickets','get_support_thread',
      'post_support_message','set_support_ticket_status','resolve_support_task',
      'mark_support_ticket_read','support_inbox_counts','get_support_ticket_transcript',
      'create_support_task');

  IF v_count <> 10 THEN
    RAISE EXCEPTION 'Expected 10 support functions, found %.', v_count;
  END IF;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLIC or anon still holds EXECUTE on: %', v_bad;
  END IF;

  IF has_function_privilege('authenticated',
       'public._support_apply_status(uuid, text, text, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '_support_apply_status is still callable by authenticated.';
  END IF;

  IF (SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname <> '_support_apply_status'
        AND p.proname IN (
          'list_my_support_tickets','get_support_thread','post_support_message',
          'set_support_ticket_status','resolve_support_task','mark_support_ticket_read',
          'support_inbox_counts','get_support_ticket_transcript','create_support_task')
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 9 THEN
    RAISE EXCEPTION 'A callable support RPC lost its authenticated EXECUTE grant.';
  END IF;
END
$acl$;
