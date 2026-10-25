-- POINT-IN-TIME RECORD, NOT A HEALTH CHECK. Do not re-run this expecting PASS.
--
-- The verdict below hardcodes the state of production on 2026-08-31: 41 tickets,
-- 55 messages, 14 internal notes, 18 with a priority. It was the failing test
-- that gated Phase 1 section 5, and it did its job. Production has moved on
-- (43 tickets by the time Phase 2 landed, and it keeps growing every time a user
-- files a request), so the verdict column is now permanently FAIL by design.
-- The per-column numbers above the verdict are still a useful snapshot.
--
-- The live, relative invariants this once stood for are asserted in
-- scripts/support/assert-support-rpcs.sql, rows 31 and 33:
--   * every ticket has at least one message
--   * no ticket's last_message_at lags its newest message
-- Those hold at any ticket count. Extend THAT file, not this one.
SELECT
  (SELECT count(*) FROM public.reported_issues)                            AS tickets,
  (SELECT count(*) FROM public.reported_issues r
     WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m
                        WHERE m.ticket_id = r.id AND m.author_side = 'reporter'))
                                                                           AS tickets_without_seed,
  (SELECT count(*) FROM public.support_messages WHERE is_internal)         AS internal_messages,
  (SELECT count(*) FROM public.support_messages)                           AS messages_total,
  (SELECT count(*) FROM public.reported_issues WHERE last_message_at IS NULL)
                                                                           AS missing_last_message,
  (SELECT count(*) FROM public.reported_issues
     WHERE status IN ('resolved','closed') AND resolved_at IS NULL)        AS missing_resolved_at,
  (SELECT count(*) FROM public.reported_issues
     WHERE status NOT IN ('resolved','closed') AND resolved_at IS NOT NULL)
                                                                           AS wrongly_resolved_at,
  (SELECT count(*) FROM public.support_messages m
     LEFT JOIN public.profiles p ON p.id = m.author_id
    WHERE m.author_id IS NOT NULL AND p.id IS NULL)                        AS orphan_authors,
  (SELECT count(*) FROM public.reported_issues WHERE priority IS NOT NULL) AS with_priority,
  (SELECT count(*) FROM public.reported_issues WHERE category IS NOT NULL) AS with_category,
  (SELECT count(*) FROM public.reported_issues WHERE first_response_at IS NOT NULL)
                                                                           AS with_first_response,
  CASE
    WHEN (SELECT count(*) FROM public.reported_issues) = 41
     AND (SELECT count(*) FROM public.reported_issues r
            WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m
                               WHERE m.ticket_id = r.id AND m.author_side = 'reporter')) = 0
     AND (SELECT count(*) FROM public.support_messages WHERE is_internal) = 14
     AND (SELECT count(*) FROM public.support_messages) = 55
     AND (SELECT count(*) FROM public.reported_issues WHERE last_message_at IS NULL) = 0
     AND (SELECT count(*) FROM public.reported_issues
            WHERE status IN ('resolved','closed') AND resolved_at IS NULL) = 0
     AND (SELECT count(*) FROM public.reported_issues
            WHERE status NOT IN ('resolved','closed') AND resolved_at IS NOT NULL) = 0
     AND (SELECT count(*) FROM public.support_messages m
            LEFT JOIN public.profiles p ON p.id = m.author_id
           WHERE m.author_id IS NOT NULL AND p.id IS NULL) = 0
     AND (SELECT count(*) FROM public.reported_issues WHERE priority IS NOT NULL) = 18
      THEN 'PASS'
    ELSE 'FAIL'
  END                                                                      AS verdict;
