WITH fns AS (
  SELECT p.proname, p.prosecdef,
         EXISTS (SELECT 1 FROM information_schema.routine_privileges rp
                  WHERE rp.routine_schema='public' AND rp.routine_name=p.proname
                    AND rp.grantee='anon' AND rp.privilege_type='EXECUTE') AS anon_can_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('notice_is_recipient','notice_can_oversee','can_view_notice',
                       'can_publish_notices','notice_id_from_path')
)
SELECT
  (SELECT count(*) FROM fns) = 5                                      AS ok_all_five_exist,
  (SELECT count(*) FROM fns WHERE NOT prosecdef) = 1                  AS ok_definer_except_path_helper,
  (SELECT count(*) FROM fns WHERE anon_can_execute) = 0               AS ok_anon_revoked,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notices' AND policyname LIKE 'circ\_%') = 0       AS ok_old_policies_dropped,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notices') = 3                                     AS ok_notices_three_policies,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notices' AND cmd='INSERT') = 0                    AS ok_no_direct_insert,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notice_recipients') = 1                           AS ok_recipients_one_policy,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public'
     AND tablename='notice_recipients' AND cmd='UPDATE') = 0          AS ok_no_direct_read_update,
  -- Every auth.uid() must be the initplan form. Postgres renders it as
  -- "( SELECT auth.uid() AS uid)", so a regex anchored on the preceding
  -- character false-positives on that space. Strip the wrapped form and assert
  -- nothing bare is left over.
  (SELECT count(*) FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN ('notices','notice_recipients',
                        'notice_target_classes','notice_target_wings')
      AND replace(coalesce(qual,'') || ' ' || coalesce(with_check,''),
                  'SELECT auth.uid() AS uid', '') LIKE '%auth.uid()%'
  ) = 0                                                               AS ok_initplan_form,
  (SELECT public.can_view_notice(r.notice_id, r.user_id)
     FROM public.notice_recipients r LIMIT 1) IS TRUE                 AS ok_recipient_sees,
  (SELECT public.can_view_notice(r.notice_id,
            '00000000-0000-0000-0000-000000000000'::uuid)
     FROM public.notice_recipients r LIMIT 1) IS FALSE                AS ok_stranger_blocked,
  (public.can_view_notice(NULL, '00000000-0000-0000-0000-000000000000'::uuid))
     IS NOT TRUE                                                      AS ok_null_notice_denied,
  (public.notice_id_from_path('not-a-uuid/file.pdf') IS NULL)         AS ok_bad_path_null,
  (public.notice_id_from_path('de300004-dddd-4b04-9c04-000000000001/a.pdf')
     = 'de300004-dddd-4b04-9c04-000000000001'::uuid)                  AS ok_good_path_parsed;
