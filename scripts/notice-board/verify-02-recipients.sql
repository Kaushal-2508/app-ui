SELECT
  (to_regclass('public.notice_recipients') IS NOT NULL)                            AS ok_recipients_table,
  (to_regclass('public.notice_target_classes') IS NOT NULL)                        AS ok_target_classes,
  (to_regclass('public.notice_target_wings') IS NOT NULL)                          AS ok_target_wings,
  (to_regclass('public.circular_acknowledgements') IS NULL)                        AS ok_old_acks_dropped,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='notices'
       AND column_name IN ('target_class_id','target_wing_id')) = 0                AS ok_legacy_cols_dropped,
  (SELECT count(*) FROM public.notice_target_classes) = 0                          AS ok_class_targets_copied,
  (SELECT count(*) FROM public.notice_target_wings) = 0                            AS ok_wing_targets_copied,
  (SELECT count(*) FROM public.notices n
     WHERE n.recipient_count <> (SELECT count(*) FROM public.notice_recipients r
                                  WHERE r.notice_id = n.id)) = 0                   AS ok_counts_agree,
  (SELECT count(*) FROM public.notices WHERE recipient_count = 0) = 0              AS ok_no_empty_audience,
  (SELECT count(*) FROM public.notice_recipients
     WHERE acknowledged_at IS NOT NULL) = 1                                        AS ok_acks_migrated,
  (SELECT count(*) FROM public.notice_recipients
     WHERE acknowledged_at IS NOT NULL AND read_at IS NULL) = 0                    AS ok_ack_implies_read,
  (SELECT count(*) FROM public.notice_recipients r
     JOIN public.notices n ON n.id = r.notice_id
    WHERE r.user_id = n.published_by) = 0                                          AS ok_author_excluded,
  (SELECT count(*) FROM (
      SELECT notice_id, user_id FROM public.notice_recipients
      GROUP BY 1,2 HAVING count(*) > 1) d) = 0                                     AS ok_no_duplicates,
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
            AND indexname='notice_recipients_user_id_idx')                         AS ok_user_index,
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
            AND indexname='notice_target_classes_class_id_idx')                    AS ok_class_index;
