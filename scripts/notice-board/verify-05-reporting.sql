-- Exercises mark_notice_read, notice_reach, notice_recipient_list, notice_inbox
-- and notice_outbox against real prod rows.
--
-- Results come back as ROWS, not a RAISE: the Supabase Management API returns
-- an EMPTY BODY on a SQL error, which makes a raised assertion invisible.
--
-- The read stamp it writes is UNDONE at the end, so prod read state is
-- unchanged and the script is re-runnable.

CREATE TEMP TABLE _nb_rep(check_name text, ok boolean, detail text) ON COMMIT DROP;

DO $$
DECLARE
  _nid     uuid;
  _uid     uuid;
  _author  uuid;
  _t       integer;
  _r       integer;
  _r_after integer;
  _stamp   timestamptz;
  _rows    integer;
BEGIN
  -- The recipient must not be an institution admin, or the oversight-boundary
  -- assertion at the end would fail for the right reason and read as a bug.
  SELECT r.notice_id, r.user_id, n.published_by INTO _nid, _uid, _author
    FROM public.notice_recipients r
    JOIN public.notices n ON n.id = r.notice_id
   WHERE r.read_at IS NULL
     AND NOT public.is_institution_admin(r.user_id, n.institution_id)
   LIMIT 1;

  INSERT INTO _nb_rep VALUES
    ('fixture_built', _nid IS NOT NULL, 'notice=' || coalesce(left(_nid::text,8),'-'));
  IF _nid IS NULL THEN RETURN; END IF;

  -- notice_reach and notice_recipient_list are gated on notice_can_oversee(),
  -- which needs an identity. auth.uid() reads request.jwt.claims, and this
  -- session is otherwise postgres with no claims at all -- without this the
  -- gate returns false and every assertion below reads as "empty" rather than
  -- "broken". Impersonate the notice's author, who always oversees it.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _author, 'role', 'authenticated')::text, true);

  SELECT coalesce(sum(total),0), coalesce(sum(read_count),0)
    INTO _t, _r FROM public.notice_reach(_nid);
  INSERT INTO _nb_rep VALUES
    ('reach_returns_totals', _t > 0, 'total=' || _t || ' read=' || _r);

  -- mark read AS THAT RECIPIENT, through the real RPC
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  PERFORM public.mark_notice_read(_nid, false);

  SELECT read_at INTO _stamp FROM public.notice_recipients
   WHERE notice_id=_nid AND user_id=_uid;
  INSERT INTO _nb_rep VALUES ('mark_read_stamps', _stamp IS NOT NULL, coalesce(_stamp::text,'NULL'));

  -- idempotency: a second mark must not move the stamp
  PERFORM public.mark_notice_read(_nid, false);
  INSERT INTO _nb_rep VALUES
    ('mark_read_idempotent',
     (SELECT read_at FROM public.notice_recipients WHERE notice_id=_nid AND user_id=_uid) = _stamp,
     'stamp unchanged');

  -- acknowledging does not un-set the read stamp, and is itself idempotent
  PERFORM public.mark_notice_read(_nid, true);
  PERFORM public.mark_notice_read(_nid, true);
  INSERT INTO _nb_rep VALUES
    ('acknowledge_sets_once',
     (SELECT count(*) FROM public.notice_recipients
       WHERE notice_id=_nid AND user_id=_uid
         AND acknowledged_at IS NOT NULL AND read_at = _stamp) = 1, '');

  -- reach reflects the new read, seen as the author
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _author, 'role', 'authenticated')::text, true);
  SELECT coalesce(sum(read_count),0) INTO _r_after FROM public.notice_reach(_nid);
  INSERT INTO _nb_rep VALUES
    ('reach_advances', _r_after = _r + 1, 'before=' || _r || ' after=' || _r_after);

  -- recipient list respects _limit and its status filter
  SELECT count(*) INTO _rows FROM public.notice_recipient_list(_nid, 'all', NULL, NULL, 5);
  INSERT INTO _nb_rep VALUES ('recipient_list_limit', _rows <= 5, 'returned ' || _rows);

  INSERT INTO _nb_rep VALUES
    ('unread_filter_clean',
     NOT EXISTS (SELECT 1 FROM public.notice_recipient_list(_nid,'unread',NULL,NULL,500)
                  WHERE read_at IS NOT NULL), '');

  -- outbox reaches the author and carries server-side aggregates
  SELECT count(*) INTO _rows FROM public.notice_outbox(NULL, NULL, 20);
  INSERT INTO _nb_rep VALUES ('outbox_returns_rows', _rows > 0, _rows || ' notices');

  -- inbox reaches the recipient
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO _rows FROM public.notice_inbox(NULL, NULL, 20);
  INSERT INTO _nb_rep VALUES ('inbox_returns_rows', _rows > 0, _rows || ' notices');

  -- oversight boundary: a plain recipient is NOT an overseer, so reporting must
  -- come back empty for them. "Author + everyone above" is the whole rule.
  INSERT INTO _nb_rep VALUES
    ('reach_denied_to_recipient',
     NOT EXISTS (SELECT 1 FROM public.notice_reach(_nid)), ''),
    ('roster_denied_to_recipient',
     NOT EXISTS (SELECT 1 FROM public.notice_recipient_list(_nid,'all',NULL,NULL,50)), '');

  -- undo the read/ack stamps so prod state is untouched
  UPDATE public.notice_recipients
     SET read_at = NULL, acknowledged_at = NULL
   WHERE notice_id = _nid AND user_id = _uid;
  INSERT INTO _nb_rep VALUES
    ('fixture_restored',
     (SELECT read_at IS NULL AND acknowledged_at IS NULL
        FROM public.notice_recipients WHERE notice_id=_nid AND user_id=_uid), '');
END $$;

SELECT check_name, ok, detail FROM _nb_rep ORDER BY check_name;
