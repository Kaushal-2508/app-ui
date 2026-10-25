-- Behavioural test for the Phase 2 RPCs, against PROD, rolled back at the end.
-- Nothing here is committed. The DO block raises on the first failed assertion,
-- which aborts the transaction; a clean run means every assertion held.
--
-- auth.uid() reads request.jwt.claims, so each impersonation is one
-- set_config(..., true) call. The RPCs are SECURITY DEFINER and run as postgres
-- regardless, so this exercises the RPC logic, not RLS.
--
-- Side effects are transactional. The notifications table carries the
-- send_push_on_notification webhook trigger, which calls net.http_post; pg_net
-- enqueues into net.http_request_queue rather than making a synchronous call,
-- and that insert rolls back with everything else. No push is delivered.
BEGIN;

DO $test$
DECLARE
  v_admin    uuid;
  v_reporter uuid;
  v_other    uuid;
  v_ticket   uuid;
  v_res      jsonb;
  v_res2     jsonb;
  v_token    uuid := gen_random_uuid();
  v_before   int;
  v_after    int;
  v_have     int;
  v_i        int;
  v_status   text;
  v_leaked   int;
BEGIN
  SELECT ur.user_id INTO v_admin
  FROM public.user_roles ur
  WHERE ur.role = 'super_admin'
  ORDER BY ur.user_id
  LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP: no super admin found.';
  END IF;

  SELECT ri.id, ri.reporter_id INTO v_ticket, v_reporter
  FROM public.reported_issues ri
  WHERE ri.reporter_id IS NOT NULL
    AND ri.reporter_id <> v_admin
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = ri.reporter_id)
  ORDER BY ri.created_at DESC
  LIMIT 1;
  IF v_ticket IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP: no ticket with a live reporter profile found.';
  END IF;

  -- --- 1. A super admin can post an internal note, and it moves nothing -----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  UPDATE public.reported_issues SET status = 'open' WHERE id = v_ticket;

  v_res := public.post_support_message(v_ticket, 'Internal triage note.', true, '[]'::jsonb, NULL);

  SELECT status INTO v_status FROM public.reported_issues WHERE id = v_ticket;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'FAIL 1a: an internal note moved the status to %.', v_status;
  END IF;
  IF v_res -> 'notify' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'FAIL 1b: an internal note produced a notify payload.';
  END IF;

  -- --- 2. A public SALCI reply on an open ticket moves it to in_progress ----
  v_res := public.post_support_message(v_ticket, 'We are looking into this.', false, '[]'::jsonb, NULL);
  IF v_res ->> 'status' <> 'in_progress' THEN
    RAISE EXCEPTION 'FAIL 2a: expected in_progress, got %.', v_res ->> 'status';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_messages
                 WHERE ticket_id = v_ticket AND kind = 'system'
                   AND body = 'SALCI started working on this.') THEN
    RAISE EXCEPTION 'FAIL 2b: no system row for the implicit in_progress move.';
  END IF;

  -- --- 3. The reporter never sees the internal note ------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_reporter, 'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_leaked
  FROM jsonb_array_elements(public.get_support_thread(v_ticket, 100, NULL) -> 'messages') m
  WHERE (m ->> 'is_internal')::boolean;
  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'FAIL 3: the reporter thread contains % internal rows.', v_leaked;
  END IF;

  -- --- 4. client_token makes the post idempotent ---------------------------
  SELECT count(*) INTO v_before FROM public.support_messages WHERE ticket_id = v_ticket;
  v_res  := public.post_support_message(v_ticket, 'Any update please.', false, '[]'::jsonb, v_token);
  v_res2 := public.post_support_message(v_ticket, 'Any update please.', false, '[]'::jsonb, v_token);
  SELECT count(*) INTO v_after FROM public.support_messages WHERE ticket_id = v_ticket;
  IF v_res ->> 'message_id' <> v_res2 ->> 'message_id' THEN
    RAISE EXCEPTION 'FAIL 4a: the repeated client_token returned a different message.';
  END IF;
  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL 4b: the repeated client_token inserted a second row.';
  END IF;

  -- --- 5. A reporter cannot post an internal note --------------------------
  BEGIN
    PERFORM public.post_support_message(v_ticket, 'Sneaky.', true, '[]'::jsonb, NULL);
    RAISE EXCEPTION 'FAIL 5: a reporter was allowed to post an internal note.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%internal note%' THEN
      RAISE;
    END IF;
  END;

  -- --- 6. A reporter reply on a resolved ticket reopens it -----------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM public.set_support_ticket_status(v_ticket, 'resolved', NULL);

  SELECT ri.status INTO v_status
  FROM public.reported_issues ri WHERE ri.id = v_ticket;
  IF v_status <> 'resolved' THEN
    RAISE EXCEPTION 'FAIL 6a: expected resolved, got %.', v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reported_issues
                 WHERE id = v_ticket AND resolved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL 6b: resolved_at was not stamped.';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_reporter, 'role', 'authenticated')::text, true);
  v_res := public.post_support_message(v_ticket, 'This is still happening.', false, '[]'::jsonb, NULL);
  IF v_res ->> 'status' <> 'open' THEN
    RAISE EXCEPTION 'FAIL 6c: the reply did not reopen the ticket, status is %.', v_res ->> 'status';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reported_issues
             WHERE id = v_ticket AND resolved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL 6d: resolved_at was not cleared on reopen.';
  END IF;
  IF v_res ->> 'notify' IS NULL THEN
    RAISE EXCEPTION 'FAIL 6e: the reopen produced no notify payload.';
  END IF;

  -- --- 7. list_my_support_tickets is bounded and self-scoped ---------------
  v_res := public.list_my_support_tickets(200, 0);
  IF jsonb_array_length(v_res -> 'tickets') > 100 THEN
    RAISE EXCEPTION 'FAIL 7a: p_limit was not clamped to 100.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_res -> 'tickets') t
    JOIN public.reported_issues ri ON ri.id = (t ->> 'id')::uuid
    WHERE ri.reporter_id IS DISTINCT FROM v_reporter
  ) THEN
    RAISE EXCEPTION 'FAIL 7b: the list returned another reporter''s ticket.';
  END IF;
  IF v_res -> 'counts' IS NULL THEN
    RAISE EXCEPTION 'FAIL 7c: the list returned no counts object.';
  END IF;
  IF (v_res -> 'counts' ->> 'total')::int
     IS DISTINCT FROM (SELECT count(*)::int FROM public.reported_issues
                       WHERE reporter_id = v_reporter) THEN
    RAISE EXCEPTION 'FAIL 7d: counts.total does not match the reporter''s ticket count.';
  END IF;
  IF (v_res -> 'counts' ->> 'active')::int
     IS DISTINCT FROM (SELECT count(*)::int FROM public.reported_issues
                       WHERE reporter_id = v_reporter
                         AND status IN ('open', 'in_progress')) THEN
    RAISE EXCEPTION 'FAIL 7e: counts.active does not match the reporter''s open work.';
  END IF;

  -- --- 8. A reporter cannot export a transcript ---------------------------
  BEGIN
    PERFORM public.get_support_ticket_transcript(v_ticket);
    RAISE EXCEPTION 'FAIL 8: a reporter exported a transcript.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only SALCI support%' THEN
      RAISE;
    END IF;
  END;

  -- --- 9. awaiting_salci exists, and p_status scopes it without ------------
  --        disturbing the per-status tab counts.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_res := public.support_inbox_counts(
             p_institution_id => NULL, p_role => NULL, p_status => NULL);
  IF v_res -> 'awaiting_salci' IS NULL THEN
    RAISE EXCEPTION 'FAIL 9a: support_inbox_counts has no awaiting_salci key.';
  END IF;

  v_res2 := public.support_inbox_counts(
              p_institution_id => NULL, p_role => NULL, p_status => 'open');
  IF (v_res2 ->> 'awaiting_salci')::int > (v_res ->> 'awaiting_salci')::int THEN
    RAISE EXCEPTION
      'FAIL 9b: p_status = open widened awaiting_salci (% vs %) instead of narrowing it.',
      v_res2 ->> 'awaiting_salci', v_res ->> 'awaiting_salci';
  END IF;
  IF (v_res2 ->> 'open')        IS DISTINCT FROM (v_res ->> 'open')
  OR (v_res2 ->> 'in_progress') IS DISTINCT FROM (v_res ->> 'in_progress')
  OR (v_res2 ->> 'resolved')    IS DISTINCT FROM (v_res ->> 'resolved')
  OR (v_res2 ->> 'closed')      IS DISTINCT FROM (v_res ->> 'closed')
  OR (v_res2 ->> 'total')       IS DISTINCT FROM (v_res ->> 'total') THEN
    RAISE EXCEPTION 'FAIL 9c: p_status changed the per-status tab counts.';
  END IF;

  BEGIN
    PERFORM public.support_inbox_counts(
              p_institution_id => NULL, p_role => NULL, p_status => 'archived');
    RAISE EXCEPTION 'FAIL 9d: an unknown status filter was accepted.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Unknown support status filter%' THEN
      RAISE;
    END IF;
  END;

  -- --- 10. An unrelated reporter cannot read this ticket or its thread ------
  --        This is the assertion the whole confidentiality design rests on.
  --        can_access_support_ticket() allows a super admin or the ticket's own
  --        reporter and nobody else, so the second identity must be neither.
  SELECT p.id INTO v_other
  FROM public.profiles p
  WHERE p.id <> v_reporter
    AND p.id <> v_admin
    AND NOT public.is_super_admin(p.id)
  ORDER BY p.id
  LIMIT 1;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'TEST SETUP: no second, non-super-admin profile found.';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.get_support_thread(v_ticket, 50, NULL);
    RAISE EXCEPTION 'FAIL 10a: an unrelated reporter read another reporter''s thread.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%do not have access to this support request%' THEN
      RAISE;
    END IF;
  END;

  SELECT count(*) INTO v_leaked
  FROM jsonb_array_elements(public.list_my_support_tickets(100, 0) -> 'tickets') t
  WHERE (t ->> 'id')::uuid = v_ticket;
  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'FAIL 10b: another reporter''s ticket appeared in an unrelated reporter''s list.';
  END IF;

  -- --- 11. The 31st message from one author within an hour is refused ------
  --        post_support_message counts support_messages.author_id over the last
  --        hour and refuses at 30. author_id is the caller's profiles id, and an
  --        earlier guard in the same function rejects a caller with no profiles
  --        row, so the throttle always counts a column that is populated and can
  --        never be sidestepped by a NULL author_id. Each probe carries its own
  --        p_client_token, otherwise the idempotency branch would keep returning
  --        the first message and the loop would never reach the limit.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_reporter, 'role', 'authenticated')::text, true);

  SELECT count(*)::int INTO v_have
  FROM public.support_messages m
  WHERE m.author_id = v_reporter
    AND m.created_at > now() - interval '1 hour';

  v_i := v_have;
  WHILE v_i < 30 LOOP
    PERFORM public.post_support_message(
      v_ticket, 'Throttle probe ' || v_i::text || '.', false, '[]'::jsonb, gen_random_uuid());
    v_i := v_i + 1;
  END LOOP;

  SELECT count(*)::int INTO v_have
  FROM public.support_messages m
  WHERE m.author_id = v_reporter
    AND m.created_at > now() - interval '1 hour';
  IF v_have < 30 THEN
    RAISE EXCEPTION 'FAIL 11a: only % messages landed for the reporter, the throttle was never reached.', v_have;
  END IF;

  BEGIN
    PERFORM public.post_support_message(
      v_ticket, 'One message too many.', false, '[]'::jsonb, gen_random_uuid());
    RAISE EXCEPTION 'FAIL 11b: the 31st message within an hour was accepted.';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%30 support messages in the last hour%' THEN
      RAISE;
    END IF;
  END;

  -- --- 12. B-3: the status note is REPORTER-VISIBLE, not internal -----------
  --        The Phase 1 interim bodies wrote is_internal = true while the inbox
  --        told the admin the note was shared with the reporter. This is the
  --        assertion that keeps that label honest.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_res := public.set_support_ticket_status(
             v_ticket, 'resolved', 'Fixed in this morning''s release.', NULL);

  IF NOT EXISTS (SELECT 1 FROM public.support_messages
                 WHERE ticket_id = v_ticket
                   AND body = 'Fixed in this morning''s release.'
                   AND author_side = 'salci'
                   AND is_internal = false) THEN
    RAISE EXCEPTION 'FAIL 12a: the status note was not filed as a reporter-visible salci message.';
  END IF;

  -- B-2: and it reached exactly ONE plane.
  IF EXISTS (SELECT 1 FROM public.task_comments
             WHERE content = 'Fixed in this morning''s release.') THEN
    RAISE EXCEPTION 'FAIL 12b: the status note was also written to task_comments.';
  END IF;

  -- The reporter can actually read it.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_reporter, 'role', 'authenticated')::text, true);
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(public.get_support_thread(v_ticket, 100, NULL) -> 'messages') m
    WHERE m ->> 'body' = 'Fixed in this morning''s release.'
  ) THEN
    RAISE EXCEPTION 'FAIL 12c: the reporter cannot see the note the UI promised them.';
  END IF;

  -- --- 13. B-4: last_message_at tracks the newest message ------------------
  IF EXISTS (
    SELECT 1 FROM public.reported_issues ri
    JOIN (SELECT ticket_id, max(created_at) AS mx
          FROM public.support_messages GROUP BY ticket_id) m ON m.ticket_id = ri.id
    WHERE ri.last_message_at IS NULL OR ri.last_message_at < m.mx
  ) THEN
    RAISE EXCEPTION 'FAIL 13: a ticket''s last_message_at lags its newest message.';
  END IF;

  -- --- 14. B-6: an untokenised repeat note does not duplicate --------------
  --        resolve_support_task cannot pass a client_token (its signature is
  --        frozen by the live TaskDetailPanel call site), so the 30-second
  --        identical-note guard is what stands between a retried request and a
  --        duplicated note. Two identical calls, one note.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  SELECT count(*)::int INTO v_before
  FROM public.support_messages
  WHERE ticket_id = v_ticket AND body = 'Retried note.';

  PERFORM public.set_support_ticket_status(v_ticket, 'closed', 'Retried note.', NULL);
  PERFORM public.set_support_ticket_status(v_ticket, 'closed', 'Retried note.', NULL);

  SELECT count(*)::int INTO v_after
  FROM public.support_messages
  WHERE ticket_id = v_ticket AND body = 'Retried note.';

  IF v_after <> v_before + 1 THEN
    RAISE EXCEPTION 'FAIL 14: an untokenised repeat note produced % copies, expected 1.',
      v_after - v_before;
  END IF;

  RAISE NOTICE 'All support RPC behaviour assertions held.';
END
$test$;

ROLLBACK;
