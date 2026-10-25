-- ============================================================================
-- Phase 2 assertion (docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md
-- section 4.5), extended with the carried findings from the Batch A review.
--
-- Run BEFORE the migration: expect FAIL rows. Run AFTER: every row must PASS.
--
-- WHY THIS FILE EXTRACTS VALUES RATHER THAN GREPPING FOR SYMBOLS
-- Batch A's assertion checked that each rewritten body *mentions*
-- support_messages twice and admin_notes zero times. A body writing the WRONG
-- boolean into is_internal would have passed that check unchanged, and one did:
-- the interim bodies filed the reporter-facing status note as is_internal=true.
-- So wherever a boolean, a role comparison or a guard ORDER is load-bearing,
-- the check below extracts the expression and compares its VALUE, and prints
-- what it extracted in the `detail` column so the verdict is self-evidencing.
--
-- Privilege checks use has_function_privilege(role, oid, 'EXECUTE'), which
-- expands PUBLIC membership and role inheritance. information_schema.
-- routine_privileges does NOT (it misses a PUBLIC-only grant), and reading
-- proacl by eye misses the NULL case, where default privileges mean PUBLIC
-- holds EXECUTE. The one place proacl is touched here it is via aclexplode(),
-- a structured API, to name PUBLIC (grantee OID 0) specifically.
-- ============================================================================
WITH fns AS (
  SELECT p.oid,
         p.proname,
         p.prorettype,
         p.prosecdef,
         pg_get_functiondef(p.oid) AS src,
         regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g') AS norm,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
         p.proacl IS NULL
           OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                      WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      '_support_apply_status','list_my_support_tickets','get_support_thread',
      'post_support_message','set_support_ticket_status','resolve_support_task',
      'mark_support_ticket_read','support_inbox_counts','get_support_ticket_transcript',
      'create_support_task')
),
checks AS (
  -- ---- existence and shape -------------------------------------------------
  SELECT '01 _support_apply_status exists' AS check_name,
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status') AS ok,
         NULL::text AS detail
  UNION ALL SELECT '02 list_my_support_tickets exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'list_my_support_tickets'), NULL
  UNION ALL SELECT '03 get_support_thread exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'get_support_thread'), NULL
  UNION ALL SELECT '04 post_support_message exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'post_support_message'), NULL
  UNION ALL SELECT '05 mark_support_ticket_read exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'mark_support_ticket_read'), NULL
  UNION ALL SELECT '06 get_support_ticket_transcript exists',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'get_support_ticket_transcript'), NULL
  UNION ALL SELECT '07 set_support_ticket_status returns jsonb',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'set_support_ticket_status'
                   AND prorettype = 'jsonb'::regtype),
         (SELECT format_type(prorettype, NULL) FROM fns WHERE proname = 'set_support_ticket_status')
  UNION ALL SELECT '08 only one set_support_ticket_status remains',
         (SELECT count(*) FROM fns WHERE proname = 'set_support_ticket_status') = 1,
         (SELECT count(*)::text FROM fns WHERE proname = 'set_support_ticket_status')
  UNION ALL SELECT '09 resolve_support_task still returns void',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'resolve_support_task'
                   AND prorettype = 'void'::regtype),
         (SELECT format_type(prorettype, NULL) FROM fns WHERE proname = 'resolve_support_task')

  -- ---- one shared write path -----------------------------------------------
  UNION ALL SELECT '10 resolve_support_task delegates to _support_apply_status',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'resolve_support_task'
                   AND src LIKE '%_support_apply_status%'), NULL
  UNION ALL SELECT '11 set_support_ticket_status delegates to _support_apply_status',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'set_support_ticket_status'
                   AND src LIKE '%_support_apply_status%'), NULL
  UNION ALL SELECT '12 _support_apply_status keeps the done_pending_approval step-off',
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status'
                   AND src LIKE '%done_pending_approval%'), NULL
  UNION ALL SELECT '13 _support_apply_status keeps the completed-task guard',
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status'
                   AND src LIKE '%v_task_status <> ''completed''%'), NULL

  -- ---- inbox counts and intake ---------------------------------------------
  UNION ALL SELECT '14 support_inbox_counts takes p_status and reports awaiting_salci',
         (SELECT count(*) FROM fns WHERE proname = 'support_inbox_counts') = 1
           AND EXISTS (SELECT 1 FROM fns WHERE proname = 'support_inbox_counts'
                         AND src LIKE '%p_status%'
                         AND src LIKE '%awaiting_salci%'), NULL
  UNION ALL SELECT '15 create_support_task writes category and priority onto reported_issues',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'create_support_task'
                   AND norm LIKE '%subject, description, status, task_id, category, priority, last_message_at %'
                   AND norm LIKE '%v_category, v_priority, now()%'), NULL
  UNION ALL SELECT '16 create_support_task stopped stuffing Category into the task text',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'create_support_task'
                   AND src NOT LIKE '%''Category: ''%'), NULL

  -- ---- message write path ---------------------------------------------------
  UNION ALL SELECT '17 post_support_message is idempotent on client_token',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'post_support_message'
                   AND src LIKE '%client_token = p_client_token%'), NULL
  UNION ALL SELECT '18 post_support_message throttles at 30 per hour',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'post_support_message'
                   AND src LIKE '%v_recent >= 30%'), NULL

  -- ---- privileges -----------------------------------------------------------
  UNION ALL SELECT '19 every support function is SECURITY DEFINER',
         NOT EXISTS (SELECT 1 FROM fns WHERE prosecdef = false)
           AND (SELECT count(*) FROM fns) = 10,
         (SELECT coalesce(string_agg(proname, ', '), '(none)') FROM fns WHERE prosecdef = false)
  UNION ALL SELECT '20 no PUBLIC EXECUTE on any support function',
         NOT EXISTS (SELECT 1 FROM fns WHERE public_exec)
           AND (SELECT count(*) FROM fns) = 10,
         (SELECT coalesce(string_agg(proname, ', '), '(none)') FROM fns WHERE public_exec)
  UNION ALL SELECT '21 no anon EXECUTE on any support function',
         NOT EXISTS (SELECT 1 FROM fns WHERE anon_exec)
           AND (SELECT count(*) FROM fns) = 10,
         (SELECT coalesce(string_agg(proname, ', '), '(none)') FROM fns WHERE anon_exec)
  UNION ALL SELECT '22 authenticated keeps EXECUTE on the nine callable RPCs',
         (SELECT count(*) FROM fns WHERE proname <> '_support_apply_status' AND auth_exec) = 9,
         (SELECT coalesce(string_agg(proname, ', '), '(none)') FROM fns
          WHERE proname <> '_support_apply_status' AND NOT auth_exec)
  UNION ALL SELECT '23 _support_apply_status is not callable by authenticated',
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status' AND NOT auth_exec),
         (SELECT auth_exec::text FROM fns WHERE proname = '_support_apply_status')

  UNION ALL SELECT '24 list_my_support_tickets aggregates the stat-tile counts server-side',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'list_my_support_tickets'
                   AND src LIKE '%''counts'',%'
                   AND src LIKE '%''awaiting'', count(*) FILTER%'), NULL

  -- ======================================================================
  -- Carried findings from the Batch A review. These are the checks that
  -- extract a VALUE rather than confirming a symbol is present.
  -- ======================================================================

  -- B-2. One note, one visibility. task_comments SELECT admits
  -- get_task_assigner(task_id) = auth.uid(), and on a support ticket the
  -- assigner IS the reporter, so a task_comments copy of the note is public
  -- while the support_messages copy was private: one string, two visibilities.
  UNION ALL SELECT '25 B-2 resolve_support_task no longer writes to task_comments',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'resolve_support_task'
                   AND src NOT LIKE '%task_comments%'),
         (SELECT CASE WHEN src LIKE '%task_comments%' THEN 'still mentions task_comments'
                      ELSE 'clean' END
          FROM fns WHERE proname = 'resolve_support_task')
  UNION ALL SELECT '26 B-2 the status note reaches exactly one plane',
         NOT EXISTS (SELECT 1 FROM fns
                     WHERE proname IN ('_support_apply_status','set_support_ticket_status',
                                       'resolve_support_task')
                       AND src LIKE '%task_comments%')
           AND EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status'
                         AND src LIKE '%support_messages%'), NULL

  -- B-3. The note accompanying a status change is the resolution explanation
  -- and the UI labels it "Shared with the reporter on this ticket", so it MUST
  -- be is_internal = false. Extract the boolean that follows v_note.
  UNION ALL SELECT '27 B-3 the status note is is_internal = false',
         (SELECT substring(norm from '''salci'', ''message'', v_note, (\w+)')
          FROM fns WHERE proname = '_support_apply_status') = 'false',
         (SELECT coalesce(substring(norm from '''salci'', ''message'', v_note, (\w+)'),
                          '(not extractable)')
          FROM fns WHERE proname = '_support_apply_status')

  -- author_side is frozen from the caller relationship, never derived from
  -- author_id: a super admin can also be the reporter, and prod has 2 such
  -- tickets. Extract both branches.
  UNION ALL SELECT '28 post_support_message freezes author_side from the caller relationship',
         (SELECT substring(norm from 'IF v_is_admin THEN v_side := ''(\w+)''')
          FROM fns WHERE proname = 'post_support_message') = 'salci'
           AND (SELECT substring(norm from 'ELSIF v_is_reporter THEN v_side := ''(\w+)''')
                FROM fns WHERE proname = 'post_support_message') = 'reporter',
         (SELECT coalesce(substring(norm from 'IF v_is_admin THEN v_side := ''(\w+)'''), '?')
                 || ' / ' ||
                 coalesce(substring(norm from 'ELSIF v_is_reporter THEN v_side := ''(\w+)'''), '?')
          FROM fns WHERE proname = 'post_support_message')

  -- B-4. last_message_at drives unread on BOTH sides. Every path that writes a
  -- message has to bump it or unread silently stops working.
  UNION ALL SELECT '29 B-4 _support_apply_status maintains last_message_at',
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status'
                   AND norm LIKE '%SET last_message_at = now()%'), NULL
  UNION ALL SELECT '30 B-4 post_support_message maintains last_message_at',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'post_support_message'
                   AND norm LIKE '%SET last_message_at = CASE WHEN v_internal THEN last_message_at ELSE now() END%'), NULL
  UNION ALL SELECT '31 B-4 no ticket''s last_message_at lags its newest message',
         NOT EXISTS (
           SELECT 1 FROM public.reported_issues ri
           JOIN (SELECT ticket_id, max(created_at) AS mx
                 FROM public.support_messages GROUP BY ticket_id) m ON m.ticket_id = ri.id
           WHERE ri.last_message_at IS NULL OR ri.last_message_at < m.mx),
         (SELECT count(*)::text || ' lagging'
          FROM public.reported_issues ri
          JOIN (SELECT ticket_id, max(created_at) AS mx
                FROM public.support_messages GROUP BY ticket_id) m ON m.ticket_id = ri.id
          WHERE ri.last_message_at IS NULL OR ri.last_message_at < m.mx)

  -- B-5. No ticket may open with an empty thread. Extract the seeded side.
  UNION ALL SELECT '32 B-5 create_support_task seeds a reporter opener',
         (SELECT substring(norm from 'coalesce\(v_name, ''Reporter''\), ''(\w+)'', ''message''')
          FROM fns WHERE proname = 'create_support_task') = 'reporter',
         (SELECT coalesce(substring(norm from 'coalesce\(v_name, ''Reporter''\), ''(\w+)'', ''message'''),
                          '(not extractable)')
          FROM fns WHERE proname = 'create_support_task')
  UNION ALL SELECT '33 B-5 every ticket has at least one message',
         NOT EXISTS (SELECT 1 FROM public.reported_issues ri
                     WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m
                                       WHERE m.ticket_id = ri.id)),
         (SELECT count(*)::text || ' of ' ||
                 (SELECT count(*) FROM public.reported_issues)::text || ' empty'
          FROM public.reported_issues ri
          WHERE NOT EXISTS (SELECT 1 FROM public.support_messages m
                            WHERE m.ticket_id = ri.id))

  -- B-6. A note insert that passes client_token implicitly NULL never engages
  -- uq_support_messages_client_token, so a network retry duplicates the note.
  UNION ALL SELECT '34 B-6 _support_apply_status threads a client_token onto the note insert',
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status'
                   AND norm LIKE '%body, is_internal, client_token %'
                   AND norm LIKE '%v_note, false, p_client_token %'), NULL
  UNION ALL SELECT '35 B-6 _support_apply_status guards an untokenised repeat note',
         EXISTS (SELECT 1 FROM fns WHERE proname = '_support_apply_status'
                   AND norm LIKE '%interval ''30 seconds''%'), NULL

  -- B-7. idx_reported_issues_task_id is a PLAIN index, so task_id is not
  -- unique; an unordered LIMIT 1 picks an arbitrary row.
  UNION ALL SELECT '36 B-7 the ticket lookup by task_id is deterministically ordered',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'resolve_support_task'
                   AND norm LIKE '%WHERE ri.task_id = p_task_id ORDER BY ri.created_at, ri.id LIMIT 1%'), NULL

  -- B-9. author_id is NULL for a caller with no profiles row, and the throttle
  -- counts by author_id, so a profile-less caller would bypass it entirely on
  -- an RPC any authenticated user can reach. The rejection must come FIRST.
  UNION ALL SELECT '37 B-9 post_support_message rejects a profile-less caller before the throttle',
         (SELECT strpos(norm, 'IF v_author IS NULL THEN') > 0
                 AND strpos(norm, 'IF v_recent >= 30 THEN') > 0
                 AND strpos(norm, 'IF v_author IS NULL THEN') < strpos(norm, 'IF v_recent >= 30 THEN')
          FROM fns WHERE proname = 'post_support_message'),
         (SELECT 'profile guard @' || strpos(norm, 'IF v_author IS NULL THEN')::text
                 || ', throttle @' || strpos(norm, 'IF v_recent >= 30 THEN')::text
          FROM fns WHERE proname = 'post_support_message')

  -- ---- authority gates, by extracted predicate ------------------------------
  UNION ALL SELECT '38 _support_apply_status is gated on is_super_admin',
         (SELECT substring(norm from 'IF v_uid IS NULL OR NOT public\.(\w+)\(v_uid\) THEN')
          FROM fns WHERE proname = '_support_apply_status') = 'is_super_admin',
         (SELECT coalesce(substring(norm from 'IF v_uid IS NULL OR NOT public\.(\w+)\(v_uid\) THEN'),
                          '(not extractable)')
          FROM fns WHERE proname = '_support_apply_status')
  UNION ALL SELECT '39 support_inbox_counts and the transcript are super-admin gated',
         (SELECT count(*) FROM fns
          WHERE proname IN ('support_inbox_counts','get_support_ticket_transcript')
            AND norm LIKE '%NOT public.is_super_admin(%') = 2, NULL
  UNION ALL SELECT '40 get_support_thread hides internal rows from a non-super-admin',
         EXISTS (SELECT 1 FROM fns WHERE proname = 'get_support_thread'
                   AND norm LIKE '%(v_is_admin OR m.is_internal = false)%'), NULL
)
SELECT check_name,
       CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result,
       detail
FROM checks
ORDER BY check_name;
