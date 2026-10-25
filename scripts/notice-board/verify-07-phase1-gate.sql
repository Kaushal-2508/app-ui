SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('notice_expand_audience','publish_notice','notice_audience_preview',
                        'mark_notice_read','notice_inbox','notice_outbox','notice_reach',
                        'notice_recipient_list','notice_is_recipient','notice_can_oversee',
                        'can_view_notice','can_publish_notices','notice_id_from_path')) = 13
                                                                          AS ok_all_13_functions,
  (SELECT count(*) FROM information_schema.routine_privileges
    WHERE routine_schema='public' AND grantee='anon'
      AND routine_name IN ('notice_expand_audience','publish_notice','notice_audience_preview',
                           'mark_notice_read','notice_inbox','notice_outbox','notice_reach',
                           'notice_recipient_list','notice_is_recipient','notice_can_oversee',
                           'can_view_notice','can_publish_notices','notice_id_from_path')) = 0
                                                                          AS ok_no_anon_grants,
  (to_regclass('public.circulars') IS NULL
   AND to_regclass('public.circular_acknowledgements') IS NULL)           AS ok_legacy_tables_gone,
  (SELECT count(*) FROM public.institution_features WHERE feature_id='circulars') = 0
                                                                          AS ok_no_legacy_flag,
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN ('notices','notice_recipients',
                        'notice_target_classes','notice_target_wings'))   AS ok_rls_enabled,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
     AND indexname IN ('notice_recipients_user_id_idx','notice_recipients_unread_idx',
                       'notice_target_classes_class_id_idx','notice_target_wings_wing_id_idx')) = 4
                                                                          AS ok_fk_indexes,
  (SELECT count(*) FROM public.notices n
     WHERE n.recipient_count <> (SELECT count(*) FROM public.notice_recipients r
                                  WHERE r.notice_id = n.id)) = 0          AS ok_counts_still_agree;
