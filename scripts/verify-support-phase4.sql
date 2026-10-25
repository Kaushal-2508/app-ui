-- Contracts the Phase 4 (SALCI inbox) and Phase 5 (notification email)
-- frontend depends on.
--
-- Run:  powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile scripts/verify-support-phase4.sql -OutFile out.json
-- Read the result file with encoding utf-8-sig (run-sql.ps1 writes a UTF-8 BOM).
--
-- Every row must read PASS. A FAIL means Phase 1 or Phase 2 is not actually in
-- prod, regardless of what the on-disk migrations say: the ledger
-- supabase_migrations.schema_migrations is not maintained in this project.
--
-- RECONCILED against production on 2026-09-02. The original draft of this file
-- asserted 'admin_notes dropped'. That is no longer the contract: the column
-- WAS dropped, then re-added EMPTY as a hotfix because the still-deployed
-- frontend named it in its own select list and every super admin's
-- /admin/issues broke. The column must stay until that deploy is retired, so
-- the contract this file pins is "present and carrying no data, read by
-- nothing" rather than "gone".

SELECT 'admin_notes present as an empty hotfix column' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'reported_issues'
           AND column_name = 'admin_notes'
       ) THEN 'PASS' ELSE 'FAIL' END AS result

UNION ALL
-- The whole point of the hotfix column is that it is inert. A non-null value
-- means something started writing it again, and internal notes are leaking
-- back onto a row the reporter can read.
SELECT 'admin_notes carries no data',
       CASE WHEN (
         SELECT count(*) FROM public.reported_issues WHERE admin_notes IS NOT NULL
       ) = 0 THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'seven new reported_issues columns present',
       CASE WHEN (
         SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'reported_issues'
           AND column_name IN ('category','priority','last_message_at',
                               'reporter_last_read_at','salci_last_read_at',
                               'first_response_at','resolved_at')
       ) = 7 THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'reporter_id is nullable',
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'reported_issues'
           AND column_name = 'reporter_id'
           AND is_nullable = 'YES'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'set_support_ticket_status returns jsonb',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'set_support_ticket_status'
           AND pg_get_function_result(p.oid) = 'jsonb'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- The live signature carries a fourth, defaulted p_client_token. The client
-- calls it by name and passes three, so the default is load-bearing: drop it
-- and every status change from the inbox fails to resolve an overload.
SELECT 'set_support_ticket_status p_client_token is optional',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'set_support_ticket_status'
           AND pg_get_function_identity_arguments(p.oid)
               = 'p_ticket_id uuid, p_status text, p_note text, p_client_token uuid'
           AND p.pronargdefaults >= 2
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- Pin the extracted expression, not the mere presence of the word: the chip
-- reads this key, and the FILTER is what scopes it to the active tab.
SELECT 'support_inbox_counts builds awaiting_salci as a filtered count',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'support_inbox_counts'
           AND pg_get_functiondef(p.oid) LIKE '%''awaiting_salci'', count(*) FILTER (%'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- The role comparison is the access control on the whole inbox, so assert the
-- comparison itself rather than that the function mentions a role somewhere.
SELECT 'support_inbox_counts is gated on is_super_admin(auth.uid())',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'support_inbox_counts'
           AND pg_get_functiondef(p.oid)
               LIKE '%IF NOT public.is_super_admin(auth.uid()) THEN%'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- One overload only, and it takes p_status. The chip on the inbox passes the
-- active tab so its number and the rows it filters measure the same set; a
-- surviving two-argument version would silently answer with the old
-- platform-wide figure.
SELECT 'support_inbox_counts is (uuid,text,text) and only that',
       CASE WHEN (
         SELECT count(*) FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'support_inbox_counts'
           AND pg_get_function_identity_arguments(p.oid)
               = 'p_institution_id uuid, p_role text, p_status text'
       ) = 1
       AND (
         SELECT count(*) FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'support_inbox_counts'
       ) = 1
       THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'mark_support_ticket_read exists',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'mark_support_ticket_read'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- Frozen on purpose: TaskDetailPanel is a live call site. RETURNS void is part
-- of the freeze, and it is why the /tasks path sends no email.
SELECT 'resolve_support_task still (uuid,text,text) returning void',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'resolve_support_task'
           AND pg_get_function_identity_arguments(p.oid) = 'p_task_id uuid, p_outcome text, p_note text'
           AND pg_get_function_result(p.oid) = 'void'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- Phase 5. The support-notify-email edge function proves the caller is a
-- participant by calling this under the CALLER's own JWT, so it must exist,
-- return boolean, and be executable by authenticated.
SELECT 'can_access_support_ticket(uuid) returns boolean to authenticated',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'can_access_support_ticket'
           AND pg_get_function_identity_arguments(p.oid) = 'p_ticket uuid'
           AND pg_get_function_result(p.oid) = 'boolean'
           AND p.prosecdef
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- _support_apply_status is the shared write routine behind both entry points
-- and must stay unreachable from a client: it takes a ticket id and moves it
-- with no role check of its own.
SELECT '_support_apply_status is not executable by authenticated or anon',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = '_support_apply_status'
           AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                OR has_function_privilege('anon', p.oid, 'EXECUTE'))
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
SELECT 'no PUBLIC execute on the support RPCs',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('post_support_message','get_support_thread',
                             'list_my_support_tickets','mark_support_ticket_read',
                             'set_support_ticket_status','support_inbox_counts',
                             'get_support_ticket_transcript','resolve_support_task',
                             'can_access_support_ticket')
           AND array_to_string(p.proacl, ',') ~ '(^|,)=X/'
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- has_function_privilege, not a proacl regex: it also catches EXECUTE reaching
-- anon through PUBLIC or through a role grant rather than a direct entry.
SELECT 'no anon execute on the support RPCs',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('post_support_message','get_support_thread',
                             'list_my_support_tickets','mark_support_ticket_read',
                             'set_support_ticket_status','support_inbox_counts',
                             'get_support_ticket_transcript','resolve_support_task',
                             'can_access_support_ticket','_support_apply_status',
                             'create_support_task','get_support_institution_id',
                             'get_support_owner_id','is_support_ticket_reporter')
           AND has_function_privilege('anon', p.oid, 'EXECUTE')
       ) THEN 'PASS' ELSE 'FAIL' END

UNION ALL
-- Phase 5 again, and the reason internal notes send no mail: the notify
-- payload is built inside the NOT-internal branch. Assert the branch
-- expression, not that the identifier appears somewhere in the body.
SELECT 'post_support_message gates the notification on NOT v_internal',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'post_support_message'
           AND pg_get_function_result(p.oid) = 'jsonb'
           AND pg_get_functiondef(p.oid) LIKE '%IF NOT v_internal THEN%'
       ) THEN 'PASS' ELSE 'FAIL' END;
